import { SwapSDK, Chains, Assets } from '@chainflip/sdk/swap'
import {
  mainnetWalletClient,
  mainnetPublicClient,
  EVM_ADDRESS,
  BTC_ADDRESS,
  sendBitcoin,
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

// Initialize Chainflip SDK for mainnet
const sdk = new SwapSDK({ network: 'mainnet' })

// USDC contract address on Ethereum
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const

// ERC20 ABI for approve
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
] as const

// Chainflip asset mapping
// Maps our token names to Chainflip's Chains and Assets enums
const CHAINFLIP_ASSETS: Record<string, { chain: typeof Chains[keyof typeof Chains]; asset: typeof Assets[keyof typeof Assets]; decimals: number }> = {
  BTC: {
    chain: Chains.Bitcoin,
    asset: Assets.BTC,
    decimals: 8,
  },
  ETH: {
    chain: Chains.Ethereum,
    asset: Assets.ETH,
    decimals: 18,
  },
  USDC: {
    chain: Chains.Ethereum,
    asset: Assets.USDC,
    decimals: 6,
  },
  // CBBTC - Chainflip may not support this yet, we'll check at runtime
}

// Check if a token is supported by Chainflip
export function isSupportedToken(token: string): boolean {
  return token in CHAINFLIP_ASSETS
}

// Check if a swap pair is supported by Chainflip
export function isSupportedSwap(inputToken: string, outputToken: string): boolean {
  return isSupportedToken(inputToken) && isSupportedToken(outputToken)
}

// Store for tracking in-progress swaps
const pendingSwaps = new Map<string, {
  swapId: string
  depositTxHash: string | null
  numericSwapId: string | null  // The Chainflip explorer ID (e.g., 1263233)
  srcChain: string
  destChain: string
  expectedAmount: string
  status: string
}>()

export interface ChainflipQuoteResult {
  quote: Quote
  execute: () => Promise<SwapResult>
}

export const chainflip = {
  name: 'Chainflip',

  // Check if this provider supports the given swap pair
  supportsSwap(inputToken: string, outputToken: string): boolean {
    return isSupportedSwap(inputToken, outputToken)
  },

  async getQuote(params: SwapParams): Promise<ChainflipQuoteResult> {
    const { inputToken, outputToken, inputAmount } = params

    const srcAsset = CHAINFLIP_ASSETS[inputToken]
    const destAsset = CHAINFLIP_ASSETS[outputToken]

    if (!srcAsset) {
      throw new Error(`Chainflip: ${inputToken} not supported`)
    }
    if (!destAsset) {
      throw new Error(`Chainflip: ${outputToken} not supported`)
    }

    // Determine if this is a vault swap (EVM input) or deposit address swap (BTC input)
    const isVaultSwap = inputToken !== 'BTC'

    // Convert amount to smallest unit
    const amountInSmallestUnit = toSmallestUnit(inputAmount, inputToken)

    console.log(`   🔄 Fetching Chainflip quote...`)
    console.log(`      ${inputAmount} ${inputToken} -> ${outputToken}`)
    console.log(`      Amount in smallest unit: ${amountInSmallestUnit}`)

    // Get quote from Chainflip
    let quotes: any[]
    try {
      const response = await sdk.getQuoteV2({
        srcChain: srcAsset.chain,
        srcAsset: srcAsset.asset,
        destChain: destAsset.chain,
        destAsset: destAsset.asset,
        amount: amountInSmallestUnit,
        ...(isVaultSwap && { isVaultSwap: true }),
      })
      quotes = response.quotes
    } catch (err: any) {
      console.log(`   ❌ Chainflip quote error:`, err?.response?.data || err?.message || err)
      throw err
    }

    // Find regular quote (not DCA)
    const cfQuote = quotes.find((q: any) => q.type === 'REGULAR') as any
    if (!cfQuote) {
      throw new Error('Chainflip: No regular quote available')
    }

    // Convert output amount to human-readable
    const outputAmountSmallest = cfQuote.egressAmount || cfQuote.estimatedEgressAmount || cfQuote.estimatedOutput
    const outputAmount = fromSmallestUnit(outputAmountSmallest, outputToken)

    const quoteResult: Quote = {
      provider: 'Chainflip',
      inputToken,
      outputToken,
      inputAmount,
      outputAmount,
      raw: cfQuote,
    }

    // Execute function
    const execute = async (): Promise<SwapResult> => {
      console.log(`\n🔄 Executing Chainflip swap...`)
      console.log(`   Direction: ${colorPair(inputToken, outputToken)}`)
      console.log(`   Amount: ${inputAmount} ${colorToken(inputToken)}`)

      let swapId: string
      let txHash: string | null = null

      if (inputToken === 'BTC') {
        // BTC -> EVM: Use deposit address method
        const result = await executeBtcSwap(cfQuote, inputToken, outputToken, inputAmount, amountInSmallestUnit)
        swapId = result.swapId
        txHash = result.txHash
      } else {
        // EVM -> BTC: Use vault swap method
        const result = await executeEvmSwap(cfQuote, inputToken, outputToken, inputAmount, amountInSmallestUnit)
        swapId = result.swapId
        txHash = result.txHash
      }

      console.log(`✅ Chainflip swap initiated`)
      console.log(`   Swap ID: ${swapId}`)
      if (txHash) {
        const explorer = inputToken === 'BTC'
          ? `https://mempool.space/tx/${txHash}`
          : `https://etherscan.io/tx/${txHash}`
        console.log(`   Tx: ${txHash}`)
        console.log(`   ${explorer}`)
      }

      // Store for settlement tracking
      pendingSwaps.set(swapId, {
        swapId,
        depositTxHash: txHash,
        numericSwapId: null,  // Will be populated when Chainflip indexes the swap
        srcChain: srcAsset.chain,
        destChain: destAsset.chain,
        expectedAmount: outputAmount,
        status: 'pending',
      })

      return {
        provider: 'Chainflip',
        success: true,
        swapId,
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
   * Check settlement status for a Chainflip swap
   */
  async checkSettlementOnce(swapId: string, verbose = true): Promise<SettlementResult | null> {
    const storedSwap = pendingSwaps.get(swapId)

    if (!storedSwap) {
      // Already settled or not tracked - skip silently
      return null
    }

    console.log(`   🔄 Checking Chainflip swap: ${swapId.slice(0, 16)}...`)

    try {
      const status = await sdk.getStatusV2({ id: swapId })

      if (!status) {
        console.log(`   ⏳ No status found yet`)
        return null
      }

      const state = (status as any).state || (status as any).status
      
      // Extract numeric swap ID for explorer link (e.g., 1263424)
      const numericSwapId = (status as any).swapId
      
      // Store numeric swap ID if we found it
      if (numericSwapId && !storedSwap.numericSwapId) {
        storedSwap.numericSwapId = String(numericSwapId)
      }

      if (state === 'COMPLETE' || state === 'COMPLETED') {
        // Extract egress tx hash from swapEgress.txRef
        const egressTx = (status as any).swapEgress?.txRef || (status as any).egressTxHash || (status as any).destTxHash
        // Extract actual output amount from swapEgress.amount
        const actualAmount = (status as any).swapEgress?.amount || (status as any).egressAmount || (status as any).destAmount

        console.log(`   ✅ Chainflip swap completed!`)
        if (egressTx) {
          const isBtcPayout = storedSwap.destChain === Chains.Bitcoin
          const explorer = isBtcPayout
            ? `https://mempool.space/tx/${egressTx}`
            : `https://etherscan.io/tx/${egressTx}`
          console.log(`   🔗 Payout Tx: ${egressTx}`)
          console.log(`      ${explorer}`)
        }
        if (actualAmount) {
          console.log(`   💰 Actual Output: ${actualAmount}`)
        }

        // Remove from pending swaps
        pendingSwaps.delete(swapId)

        return {
          swapId,
          status: 'completed',
          payoutTxHash: egressTx || null,
          actualOutputAmount: actualAmount || null,
          settledAt: Date.now(),
          chainflipSwapId: numericSwapId ? String(numericSwapId) : null,
        }
      }

      if (state === 'FAILED') {
        console.log(`   ❌ Chainflip swap failed`)
        pendingSwaps.delete(swapId)
        return {
          swapId,
          status: 'failed',
          payoutTxHash: null,
          actualOutputAmount: null,
          settledAt: Date.now(),
        }
      }

      // Still in progress
      console.log(`   ⏳ Status: ${state}`)
      return null

    } catch (error: any) {
      // 404 means Chainflip hasn't indexed the swap yet - this is expected for vault swaps
      if (error?.response?.status === 404 || error?.status === 404) {
        console.log(`   ⏳ Not yet indexed (tx may still be confirming)`)
        return null
      }
      // Log other errors more concisely
      const msg = error?.message || error
      console.log(`   ❌ Error checking status: ${msg}`)
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

  /**
   * Get pending swap info including numeric swap ID (for UI display before settlement)
   */
  getPendingSwapInfo(swapId: string): { numericSwapId: string | null; status: string } | null {
    const swap = pendingSwaps.get(swapId)
    if (!swap) return null
    return {
      numericSwapId: swap.numericSwapId,
      status: swap.status,
    }
  },
}

// Execute BTC -> EVM swap using deposit address
async function executeBtcSwap(
  cfQuote: any,
  inputToken: string,
  outputToken: string,
  inputAmount: string,
  amountInSmallestUnit: string
): Promise<{ swapId: string; txHash: string }> {
  const destAsset = CHAINFLIP_ASSETS[outputToken]

  console.log(`   📥 Requesting deposit address...`)

  // Request deposit address
  const depositAddress = await sdk.requestDepositAddressV2({
    quote: cfQuote,
    destAddress: EVM_ADDRESS,
    fillOrKillParams: {
      refundAddress: BTC_ADDRESS,
      retryDurationBlocks: 100, // ~10 minutes
      slippageTolerancePercent: cfQuote.recommendedSlippageTolerancePercent || 2,
    },
  })

  const depositAddr = (depositAddress as any).depositAddress || (depositAddress as any).address
  const channelId = (depositAddress as any).depositChannelId || (depositAddress as any).channelId

  console.log(`   📍 Deposit address: ${depositAddr}`)

  // Send BTC to the deposit address
  const amountSats = BigInt(amountInSmallestUnit)
  const txHash = await sendBitcoin(depositAddr, amountSats)

  // Wait for mempool confirmation
  await waitForMempoolConfirmation(txHash)

  return {
    swapId: channelId,
    txHash,
  }
}

// Execute EVM -> BTC swap using vault swap
async function executeEvmSwap(
  cfQuote: any,
  inputToken: string,
  outputToken: string,
  inputAmount: string,
  amountInSmallestUnit: string
): Promise<{ swapId: string; txHash: string }> {
  if (!mainnetWalletClient) {
    throw new Error('Chainflip: Wallet client not available')
  }

  console.log(`   📤 Encoding vault swap data...`)

  // Encode vault swap transaction
  const transactionData = await sdk.encodeVaultSwapData({
    quote: cfQuote,
    srcAddress: EVM_ADDRESS,
    destAddress: BTC_ADDRESS,
    fillOrKillParams: {
      refundAddress: EVM_ADDRESS,
      retryDurationBlocks: 100, // ~10 minutes
      slippageTolerancePercent: cfQuote.recommendedSlippageTolerancePercent || 2,
    },
  })

  const txData = transactionData as any
  const vaultAddress = txData.to as `0x${string}`

  // For ERC20 tokens (USDC), we need to approve the vault contract first
  if (inputToken === 'USDC') {
    console.log(`   📤 Approving USDC spend...`)
    
    const approveHash = await mainnetWalletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddress, BigInt(amountInSmallestUnit)],
    })
    await mainnetPublicClient.waitForTransactionReceipt({ hash: approveHash })
    console.log(`   ✓ Approved`)
  }

  console.log(`   📤 Sending to vault contract...`)

  // Send the transaction
  const hash = await mainnetWalletClient.sendTransaction({
    to: vaultAddress,
    data: txData.calldata || txData.data,
    value: BigInt(txData.value || '0'),
  })

  console.log(`   ⏳ Waiting for confirmation...`)
  await mainnetPublicClient.waitForTransactionReceipt({ hash })

  return {
    swapId: hash,
    txHash: hash,
  }
}
