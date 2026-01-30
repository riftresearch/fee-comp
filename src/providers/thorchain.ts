import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  mainnetWalletClient,
  mainnetPublicClient,
  EVM_ADDRESS,
  BTC_ADDRESS,
  sendBitcoinWithMemo,
  waitForMempoolConfirmation,
} from '../account.js'
import {
  type Quote,
  type SwapResult,
  type SwapParams,
  type SettlementResult,
  toSmallestUnit,
  fromSmallestUnit,
  colorToken,
  colorPair,
} from './types.js'
import { parseEther, parseUnits, encodeFunctionData } from 'viem'

// THORChain API endpoints
const THORNODE_API = 'https://thornode.ninerealms.com'
const MIDGARD_API = 'https://midgard.ninerealms.com'

// THORChain asset notation - only tokens THORChain supports
// Reference: https://thornode.ninerealms.com/thorchain/pools
const THORCHAIN_ASSETS: Record<string, { asset: string; decimals: number; isNative: boolean }> = {
  BTC: {
    asset: 'BTC.BTC',
    decimals: 8,
    isNative: true,
  },
  ETH: {
    asset: 'ETH.ETH',
    decimals: 18,
    isNative: true,
  },
  USDC: {
    asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
    decimals: 6,
    isNative: false,
  },
  // Note: CBBTC is NOT supported - it's on Base chain and trading is halted
}

// Check if a token is supported by THORChain
export function isSupportedToken(token: string): boolean {
  return token in THORCHAIN_ASSETS
}

// Check if a swap pair is supported by THORChain
export function isSupportedSwap(inputToken: string, outputToken: string): boolean {
  return isSupportedToken(inputToken) && isSupportedToken(outputToken)
}

// USDC contract address on Ethereum
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const

// ERC20 ABI for approve and transfer
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

// THORChain Router ABI for depositWithExpiry
const THORCHAIN_ROUTER_ABI = [
  {
    name: 'depositWithExpiry',
    type: 'function',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'string' },
      { name: 'expiration', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

// Store for tracking in-progress swaps
const pendingSwaps = new Map<string, {
  inboundTxHash: string
  fromAsset: string
  toAsset: string
  expectedAmount: string
  status: string
}>()

// Recover pending THORChain swaps from CSV on startup
export function recoverPendingSwapsFromCSV(): void {
  const csvFile = join(process.cwd(), 'data.csv')
  if (!existsSync(csvFile)) return
  
  const content = readFileSync(csvFile, 'utf-8')
  const lines = content.trim().split('\n')
  if (lines.length < 2) return
  
  const headers = lines[0].split(',')
  const rows = lines.slice(1).map((line: string) => {
    const values = line.split(',')
    const obj: Record<string, string> = {}
    headers.forEach((h: string, i: number) => obj[h] = values[i] || '')
    return obj
  })
  
  // Find Thorchain swaps that don't have a corresponding settlement
  const thorchainSwaps = rows.filter((r: any) => r.type === 'swap' && r.provider === 'Thorchain' && r.swapId)
  const settlements = rows.filter((r: any) => r.type === 'settlement' && r.provider === 'Thorchain')
  const settledSwapIds = new Set(settlements.map((s: any) => s.swapId))
  
  let recovered = 0
  for (const swap of thorchainSwaps) {
    if (!settledSwapIds.has(swap.swapId)) {
      // This swap is pending - add to pendingSwaps map
      const fromAsset = THORCHAIN_ASSETS[swap.inputToken]?.asset || swap.inputToken
      const toAsset = THORCHAIN_ASSETS[swap.outputToken]?.asset || swap.outputToken
      
      pendingSwaps.set(swap.swapId, {
        inboundTxHash: swap.swapId,
        fromAsset,
        toAsset,
        expectedAmount: swap.outputAmount,
        status: 'pending',
      })
      recovered++
    }
  }
  
  if (recovered > 0) {
    console.log(`   🌀 Recovered ${recovered} pending THORChain swap(s) from CSV`)
  }
}

export interface ThorchainQuoteResult {
  quote: Quote
  execute: () => Promise<SwapResult>
}

// Quote response type
interface ThorchainQuoteResponse {
  inbound_address: string
  router?: string
  expiry: number
  memo: string
  expected_amount_out: string
  fees: {
    total: string
    slippage_bps: number
    total_bps: number
  }
  dust_threshold?: string
  recommended_min_amount_in?: string
  recommended_gas_rate?: string
  warning?: string
  notes?: string
  error?: string
}

export const thorchain = {
  name: 'Thorchain',

  // Check if this provider supports the given swap pair
  supportsSwap(inputToken: string, outputToken: string): boolean {
    return isSupportedSwap(inputToken, outputToken)
  },

  async getQuote(params: SwapParams): Promise<ThorchainQuoteResult> {
    const { inputToken, outputToken, inputAmount } = params

    const fromAsset = THORCHAIN_ASSETS[inputToken]
    const toAsset = THORCHAIN_ASSETS[outputToken]

    if (!fromAsset) {
      throw new Error(`Thorchain: ${inputToken} not supported (only BTC, ETH, USDC)`)
    }
    if (!toAsset) {
      throw new Error(`Thorchain: ${outputToken} not supported (only BTC, ETH, USDC)`)
    }

    // Determine destination address based on output token
    const destination = outputToken === 'BTC' ? BTC_ADDRESS : EVM_ADDRESS

    // Convert amount to THORChain format (always 1e8)
    // THORChain uses 8 decimals for ALL amounts internally
    const amountIn1e8 = toSmallestUnit(inputAmount, inputToken)
    // If input has more than 8 decimals (like ETH with 18), we need to adjust
    let thorchainAmount: string
    if (fromAsset.decimals > 8) {
      // Divide by 10^(decimals-8) to get 1e8 format
      const divisor = BigInt(10 ** (fromAsset.decimals - 8))
      thorchainAmount = (BigInt(amountIn1e8) / divisor).toString()
    } else if (fromAsset.decimals < 8) {
      // Multiply by 10^(8-decimals) to get 1e8 format
      const multiplier = BigInt(10 ** (8 - fromAsset.decimals))
      thorchainAmount = (BigInt(amountIn1e8) * multiplier).toString()
    } else {
      thorchainAmount = amountIn1e8
    }

    // Build quote URL
    const quoteUrl = new URL(`${THORNODE_API}/thorchain/quote/swap`)
    quoteUrl.searchParams.set('from_asset', fromAsset.asset)
    quoteUrl.searchParams.set('to_asset', toAsset.asset)
    quoteUrl.searchParams.set('amount', thorchainAmount)
    quoteUrl.searchParams.set('destination', destination)
    quoteUrl.searchParams.set('tolerance_bps', '1000') // 10% slippage tolerance (small amounts need more buffer)

    console.log(`   🌀 Fetching THORChain quote...`)

    const response = await fetch(quoteUrl.toString())
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Thorchain quote failed: ${response.status} - ${errorText}`)
    }

    const quoteData = await response.json() as ThorchainQuoteResponse

    if (quoteData.error) {
      throw new Error(`Thorchain: ${quoteData.error}`)
    }

    // Convert expected_amount_out from 1e8 to human-readable format
    // THORChain always returns amounts in 1e8 (8 decimals)
    // Step 1: Convert from 1e8 to token's native smallest unit
    // Step 2: Convert from smallest unit to human-readable
    let nativeSmallestUnit: string
    if (toAsset.decimals > 8) {
      // Token has more decimals than THORChain - multiply
      const multiplier = BigInt(10 ** (toAsset.decimals - 8))
      nativeSmallestUnit = (BigInt(quoteData.expected_amount_out) * multiplier).toString()
    } else if (toAsset.decimals < 8) {
      // Token has fewer decimals than THORChain - divide
      const divisor = BigInt(10 ** (8 - toAsset.decimals))
      nativeSmallestUnit = (BigInt(quoteData.expected_amount_out) / divisor).toString()
    } else {
      // Same decimals (BTC = 8)
      nativeSmallestUnit = quoteData.expected_amount_out
    }
    // Convert to human-readable (e.g., 21550 sats -> "0.00021550" BTC)
    const outputAmount = fromSmallestUnit(nativeSmallestUnit, outputToken)

    const quoteResult: Quote = {
      provider: 'Thorchain',
      inputToken,
      outputToken,
      inputAmount,
      outputAmount,
      raw: quoteData,
    }

    // Execute function
    const execute = async (): Promise<SwapResult> => {
      console.log(`\n🌀 Executing THORChain swap...`)
      console.log(`   Direction: ${colorPair(inputToken, outputToken)}`)
      console.log(`   Amount: ${inputAmount} ${colorToken(inputToken)}`)
      console.log(`   Destination: ${destination}`)
      console.log(`   Memo: ${quoteData.memo}`)

      let txHash: string

      if (inputToken === 'BTC') {
        // BTC -> EVM: Send BTC with OP_RETURN memo
        txHash = await executeBtcSwap(quoteData, inputAmount)
      } else {
        // EVM -> BTC: Send ETH/USDC to THORChain router
        txHash = await executeEvmSwap(quoteData, inputToken, inputAmount)
      }

      console.log(`✅ THORChain swap initiated`)
      console.log(`   Inbound Tx: ${txHash}`)
      const explorer = inputToken === 'BTC' 
        ? `https://mempool.space/tx/${txHash}`
        : `https://etherscan.io/tx/${txHash}`
      console.log(`   ${explorer}`)

      // Store for settlement tracking
      pendingSwaps.set(txHash, {
        inboundTxHash: txHash,
        fromAsset: fromAsset.asset,
        toAsset: toAsset.asset,
        expectedAmount: outputAmount,
        status: 'pending',
      })

      return {
        provider: 'Thorchain',
        success: true,
        swapId: txHash,
        txHash,
        inputToken,
        outputToken,
        inputAmount,
        outputAmount,
        timestamp: Date.now(),
      }
    }

    return { quote: quoteResult, execute }
  },

  /**
   * Check settlement status for a THORChain swap using Midgard API
   * https://midgard.ninerealms.com/v2/actions?txid=<TXID>
   */
  async checkSettlementOnce(swapId: string, verbose = true): Promise<SettlementResult | null> {
    const storedSwap = pendingSwaps.get(swapId)
    
    if (!storedSwap) {
      // Already settled or not tracked - skip silently
      return null
    }

    // Format txid for THORChain: remove 0x prefix and uppercase
    const formattedTxId = swapId.replace(/^0x/i, '').toUpperCase()
    
    console.log(`   🌀 Checking THORChain tx: ${formattedTxId.slice(0, 16)}...`)

    try {
      // Query Midgard for transaction actions
      const url = `${MIDGARD_API}/v2/actions?txid=${formattedTxId}`
      const response = await fetch(url)
      
      if (!response.ok) {
        console.log(`   ❌ Midgard API error: ${response.status}`)
        return null
      }

      const data = await response.json() as any
      const actions = data.actions || []
      
      if (actions.length === 0) {
        console.log(`   ⏳ No actions found yet (tx may still be confirming)`)
        return null
      }

      const action = actions[0]
      const status = action.status

      if (status === 'success') {
        // Find the outbound transaction
        const outTx = action.out?.[0]
        const payoutTxHash = outTx?.txID || null
        const thorchainAmount = outTx?.coins?.[0]?.amount || null
        
        // THORChain returns all amounts in 1e8 format
        // Convert to the token's native decimals for consistency with other providers
        let actualAmount: string | null = null
        let outputTokenSymbol: string | null = null
        if (thorchainAmount) {
          // Find the output token by matching the THORChain asset
          const outputEntry = Object.entries(THORCHAIN_ASSETS).find(([_, v]) => v.asset === storedSwap.toAsset)
          if (outputEntry) {
            outputTokenSymbol = outputEntry[0]
            const nativeDecimals = outputEntry[1].decimals
            // Convert from 1e8 to native decimals: amount * 10^(nativeDecimals-8)
            const thorDecimals = 8
            if (nativeDecimals === thorDecimals) {
              actualAmount = thorchainAmount
            } else {
              // For USDC (6 decimals): divide by 100 (10^(8-6))
              // For ETH (18 decimals): multiply by 10^10
              const scaleFactor = BigInt(10) ** BigInt(Math.abs(nativeDecimals - thorDecimals))
              const thorBigInt = BigInt(thorchainAmount)
              if (nativeDecimals < thorDecimals) {
                actualAmount = (thorBigInt / scaleFactor).toString()
              } else {
                actualAmount = (thorBigInt * scaleFactor).toString()
              }
            }
          }
        }

        console.log(`   ✅ THORChain swap completed!`)
        if (payoutTxHash) {
          const isBtcPayout = storedSwap.toAsset === 'BTC.BTC'
          const explorer = isBtcPayout
            ? `https://mempool.space/tx/${payoutTxHash}`
            : `https://etherscan.io/tx/${payoutTxHash}`
          console.log(`   🔗 Payout Tx: ${payoutTxHash}`)
          console.log(`      ${explorer}`)
        }
        if (actualAmount && outputTokenSymbol) {
          const humanAmount = fromSmallestUnit(actualAmount, outputTokenSymbol)
          console.log(`   💰 Actual Output: ${humanAmount} ${outputTokenSymbol}`)
        }

        // Remove from pending swaps so we don't check again
        pendingSwaps.delete(swapId)

        return {
          swapId,
          status: 'completed',
          payoutTxHash,
          actualOutputAmount: actualAmount,
          settledAt: Date.now(),
        }
      }

      if (status === 'pending') {
        console.log(`   ⏳ Status: pending (waiting for outbound)`)
        return null
      }

      // Handle refund or other statuses
      console.log(`   ⏳ Status: ${status}`)
      return null

    } catch (error) {
      console.log(`   ❌ Error checking status:`, error)
      return null
    }
  },

  /**
   * Get status string for display
   */
  async getStatusString(swapId: string): Promise<string> {
    const swap = pendingSwaps.get(swapId)
    if (!swap) return 'unknown'
    return swap.status
  },
}

// Execute BTC -> EVM swap
async function executeBtcSwap(
  quoteData: ThorchainQuoteResponse,
  inputAmount: string
): Promise<string> {
  const amountSats = BigInt(toSmallestUnit(inputAmount, 'BTC'))
  
  // Send BTC with memo to THORChain inbound address
  const txHash = await sendBitcoinWithMemo(
    quoteData.inbound_address,
    amountSats,
    quoteData.memo
  )

  // Wait for mempool confirmation
  await waitForMempoolConfirmation(txHash)

  return txHash
}

// Execute EVM -> BTC swap
async function executeEvmSwap(
  quoteData: ThorchainQuoteResponse,
  inputToken: string,
  inputAmount: string
): Promise<string> {
  if (!mainnetWalletClient) {
    throw new Error('Thorchain: Wallet client not available')
  }

  const router = quoteData.router
  if (!router) {
    throw new Error('Thorchain: No router address in quote')
  }

  const asset = THORCHAIN_ASSETS[inputToken]
  const inboundAddress = quoteData.inbound_address as `0x${string}`
  const routerAddress = router as `0x${string}`
  const expiry = BigInt(quoteData.expiry)

  if (inputToken === 'ETH') {
    // Native ETH deposit
    const amountWei = parseEther(inputAmount)
    
    console.log(`   📤 Sending ${inputAmount} ETH to THORChain router...`)
    
    const hash = await mainnetWalletClient.writeContract({
      address: routerAddress,
      abi: THORCHAIN_ROUTER_ABI,
      functionName: 'depositWithExpiry',
      args: [
        inboundAddress,
        '0x0000000000000000000000000000000000000000' as `0x${string}`, // ETH = zero address
        amountWei,
        quoteData.memo,
        expiry,
      ],
      value: amountWei,
    })

    // Wait for confirmation
    console.log(`   ⏳ Waiting for confirmation...`)
    await mainnetPublicClient.waitForTransactionReceipt({ hash })

    return hash
  } else if (inputToken === 'USDC') {
    // ERC20 deposit - need to approve first
    const amountUnits = parseUnits(inputAmount, 6)
    
    console.log(`   📤 Approving USDC spend...`)
    
    // Approve router to spend USDC
    const approveHash = await mainnetWalletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [routerAddress, amountUnits],
    })
    await mainnetPublicClient.waitForTransactionReceipt({ hash: approveHash })
    console.log(`   ✓ Approved`)

    console.log(`   📤 Depositing ${inputAmount} USDC to THORChain router...`)
    
    const hash = await mainnetWalletClient.writeContract({
      address: routerAddress,
      abi: THORCHAIN_ROUTER_ABI,
      functionName: 'depositWithExpiry',
      args: [
        inboundAddress,
        USDC_ADDRESS,
        amountUnits,
        quoteData.memo,
        expiry,
      ],
      value: 0n,
    })

    // Wait for confirmation
    console.log(`   ⏳ Waiting for confirmation...`)
    await mainnetPublicClient.waitForTransactionReceipt({ hash })

    return hash
  }

  throw new Error(`Thorchain: Unsupported input token ${inputToken}`)
}
