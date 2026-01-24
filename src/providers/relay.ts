import { createClient, getClient, MAINNET_RELAY_API } from '@relayprotocol/relay-sdk'
import {
  mainnetWalletClient,
  EVM_ADDRESS,
  BTC_ADDRESS,
} from '../account.js'
import {
  type Quote,
  type SwapResult,
  type SwapParams,
  type SettlementResult,
  toSmallestUnit,
  colorToken,
  colorPair,
} from './types.js'

// Chain IDs
const BITCOIN_CHAIN_ID = 8253038
const ETHEREUM_CHAIN_ID = 1

// Token configuration for Relay
const TOKENS: Record<string, { chainId: number; address: string; decimals: number }> = {
  BTC: {
    chainId: BITCOIN_CHAIN_ID,
    address: 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8',
    decimals: 8,
  },
  ETH: {
    chainId: ETHEREUM_CHAIN_ID,
    address: '0x0000000000000000000000000000000000000000',
    decimals: 18,
  },
  USDC: {
    chainId: ETHEREUM_CHAIN_ID,
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
  },
  CBBTC: {
    chainId: ETHEREUM_CHAIN_ID,
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    decimals: 8,
  },
}

// Initialize Relay client (singleton)
let clientInitialized = false
function ensureClient() {
  if (!clientInitialized) {
    createClient({
      baseApiUrl: MAINNET_RELAY_API,
      source: 'fee-comp',
    })
    clientInitialized = true
  }
  return getClient()
}

// Store for tracking in-progress swaps
const pendingSwaps = new Map<string, {
  status: string
  txHashes: string[]
  details?: unknown
  btcPayoutTxHash?: string | null
  ethDepositTxHash?: string | null
}>()

export interface RelayQuoteResult {
  quote: Quote
  execute: () => Promise<SwapResult>
}

export const relay = {
  name: 'Relay',

  async getQuote(params: SwapParams): Promise<RelayQuoteResult> {
    const { inputToken, outputToken, inputAmount } = params

    const fromToken = TOKENS[inputToken]
    const toToken = TOKENS[outputToken]

    if (!fromToken || !toToken) {
      throw new Error(`Relay: Unknown token ${!fromToken ? inputToken : outputToken}`)
    }

    const client = ensureClient()
    if (!client) {
      throw new Error('Relay: Client not initialized')
    }

    // Convert amount to smallest unit (wei/sats)
    const amount = toSmallestUnit(inputAmount, inputToken)

    // Determine user and recipient based on swap direction
    const isBtcInput = inputToken === 'BTC'
    const isBtcOutput = outputToken === 'BTC'

    // User is where funds come from, recipient is where they go
    const user = isBtcInput ? BTC_ADDRESS : EVM_ADDRESS
    const recipient = isBtcOutput ? BTC_ADDRESS : EVM_ADDRESS

    // Get quote from Relay
    const quoteResponse = await client.actions.getQuote({
      chainId: fromToken.chainId,
      toChainId: toToken.chainId,
      currency: fromToken.address,
      toCurrency: toToken.address,
      amount,
      tradeType: 'EXACT_INPUT',
      user,
      recipient,
    })

    if (!quoteResponse) {
      throw new Error('Relay: No quote returned')
    }

    // Extract output amount from quote
    const quoteData = quoteResponse as unknown as {
      details?: {
        currencyOut?: { amount?: string }
      }
    }

    const outputAmount = quoteData.details?.currencyOut?.amount || '0'

    const quoteResult: Quote = {
      provider: 'Relay',
      inputToken,
      outputToken,
      inputAmount,
      outputAmount,
      raw: quoteResponse,
    }

    const execute = async (): Promise<SwapResult> => {
      console.log(`\n🔄 Executing Relay swap...`)
      console.log(`   Direction: ${colorPair(inputToken, outputToken)}`)
      console.log(`   Amount: ${inputAmount} ${colorToken(inputToken)}`)
      console.log(`   Recipient: ${recipient}`)

      if (!mainnetWalletClient) {
        throw new Error('Relay: Wallet client not available')
      }

      let finalTxHashes: string[] = []
      let finalDetails: unknown = null
      let finalStatus = 'pending'
      let detailsLogged = false
      let lastStepId = ''
      let btcPayoutTxHash: string | null = null
      let ethDepositTxHash: string | null = null

      try {
        await client.actions.execute({
          quote: quoteResponse,
          wallet: mainnetWalletClient as any,
          depositGasLimit: '1000000', // Higher gas limit for complex swaps
          onProgress: ({ steps, fees, breakdown, currentStep, currentStepItem, txHashes, details }) => {
            
            // store data
            finalTxHashes = (txHashes || []).map((tx: { txHash: string }) => tx.txHash)
            finalDetails = details
            
            // Extract BTC and ETH tx hashes by chainId
            if (txHashes) {
              for (const tx of txHashes as Array<{ txHash: string; chainId?: number }>) {
                if (tx.chainId === 8253038) {
                  btcPayoutTxHash = tx.txHash
                } else if (tx.chainId === 1 && !ethDepositTxHash) {
                  ethDepositTxHash = tx.txHash
                }
              }
            }
            
            // Log swap details once when first available
            if (details && !detailsLogged) {
              detailsLogged = true
              const d = details as {
                currencyIn?: { amount?: string; amountFormatted?: string; currency?: { symbol?: string } }
                currencyOut?: { amount?: string; amountFormatted?: string; currency?: { symbol?: string } }
                rate?: string
                recipient?: string
                txHashes?: Array<{ txHash: string; chainId?: number }>
              }
              console.log(`   📋 Swap Details:`)
              if (d.currencyIn) {
                console.log(`      Input: ${d.currencyIn.amountFormatted || d.currencyIn.amount} ${d.currencyIn.currency?.symbol || ''}`)
              }
              if (d.currencyOut) {
                console.log(`      Output: ${d.currencyOut.amountFormatted || d.currencyOut.amount} ${d.currencyOut.currency?.symbol || ''}`)
              }
              if (d.rate) {
                console.log(`      Rate: ${d.rate}`)
              }
              if (d.recipient) {
                console.log(`      BTC Recipient: ${d.recipient}`)
              }
              // Check if details has txHashes with BTC
              if (d.txHashes) {
                for (const tx of d.txHashes) {
                  if (tx.chainId === 8253038) {
                    btcPayoutTxHash = tx.txHash
                    console.log(`      BTC Tx: ${tx.txHash}`)
                  }
                }
              }
            }
            
            // Log step progress (only when step changes)
            if (currentStep && currentStepItem) {
              const stepItem = currentStepItem as { 
                status?: string
                txHashes?: Array<{ txHash: string; chainId?: number }>
                error?: string
              }
              const stepKey = `${currentStep.id}-${stepItem.status}`
              if (stepKey !== lastStepId) {
                lastStepId = stepKey
                const status = stepItem.status || 'processing'
                const statusIcon = status === 'complete' ? '✓' : status === 'incomplete' ? '⏳' : '⚡'
                let txInfo = ''
                if (stepItem.txHashes?.length) {
                  const tx = stepItem.txHashes[0]
                  const isBtc = tx.chainId === 8253038 || !tx.txHash.startsWith('0x')
                  const chain = isBtc ? 'BTC' : tx.chainId === 1 ? 'ETH' : `chain:${tx.chainId}`
                  txInfo = ` [${chain}: ${tx.txHash.slice(0, 12)}...]`
                  // Capture BTC tx if found
                  if (isBtc) {
                    btcPayoutTxHash = tx.txHash
                  }
                }
                console.log(`   ${statusIcon} ${currentStep.id}: ${status}${txInfo}`)
                if (stepItem.error) {
                  console.log(`      Error: ${stepItem.error}`)
                }
              }
            }
            
            // Look for BTC tx in steps
            if (steps) {
              for (const step of steps as Array<{ items?: Array<{ txHashes?: Array<{ txHash: string; chainId?: number }> }> }>) {
                for (const item of step.items || []) {
                  for (const tx of item.txHashes || []) {
                    if (tx.chainId === 8253038 || !tx.txHash.startsWith('0x')) {
                      btcPayoutTxHash = tx.txHash
                    }
                  }
                }
              }
            }
            
            // Check if completed
            const allComplete = steps?.every(s => 
              s.items?.every((item: { status?: string }) => item.status === 'complete')
            )
            if (allComplete && finalStatus !== 'complete') {
              finalStatus = 'complete'
              // Log final transactions
              console.log(`   🔗 Transactions:`)
              if (ethDepositTxHash) {
                console.log(`      ETH Deposit: ${ethDepositTxHash}`)
                console.log(`         https://etherscan.io/tx/${ethDepositTxHash}`)
              }
              if (btcPayoutTxHash) {
                console.log(`      BTC Payout: ${btcPayoutTxHash}`)
                console.log(`         https://mempool.space/tx/${btcPayoutTxHash}`)
              }
            }
          },
        })
      } catch (execError: any) {
        console.error(`   ❌ Relay execute error:`, execError?.message || execError)
        // Log more details if available
        if (execError?.receipt) {
          console.error(`   Transaction: ${execError.receipt.transactionHash}`)
          console.error(`   Status: ${execError.receipt.status}`)
        }
        throw execError
      }

      const swapId = ethDepositTxHash || finalTxHashes[0] || `relay-${Date.now()}`
      
      // Store for settlement tracking
      pendingSwaps.set(swapId, {
        status: finalStatus,
        txHashes: finalTxHashes,
        details: finalDetails,
        btcPayoutTxHash,
        ethDepositTxHash,
      })

      console.log(`✅ Relay swap ${finalStatus === 'complete' ? 'completed' : 'initiated'}`)
      console.log(`   Deposit Tx (ETH): ${ethDepositTxHash || 'N/A'}`)
      if (btcPayoutTxHash) {
        console.log(`   Payout Tx (BTC): ${btcPayoutTxHash}`)
        console.log(`   https://mempool.space/tx/${btcPayoutTxHash}`)
      }

      return {
        provider: 'Relay',
        success: true,
        swapId,
        txHash: finalTxHashes[0] || null,
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
   * Check settlement status for a Relay swap by polling Relay's API
   */
  async checkSettlementOnce(swapId: string, verbose = true): Promise<SettlementResult | null> {
    // swapId is the ETH deposit tx hash
    // Query Relay's intents/status API to check if BTC payout has been made
    
    interface RelayStatusResponse {
      status?: string
      txHashes?: Array<string | { txHash: string; chainId?: number }>
      outTxs?: Array<{ txHash: string; chainId?: number }>
      amountOut?: string
      [key: string]: unknown
    }
    
    try {
      // Try multiple API endpoints/params to find the right one
      const endpoints = [
        `https://api.relay.link/intents/status?txHash=${swapId}`,
        `https://api.relay.link/intents/status/v2?txHash=${swapId}`,
        `https://api.relay.link/requests/${swapId}/status`,
      ]
      
      let data: RelayStatusResponse | null = null
      
      for (const url of endpoints) {
        console.log(`   🔍 Trying: ${url}`)
        const response = await fetch(url)
        if (response.ok) {
          data = await response.json() as RelayStatusResponse
          console.log(`   📡 Response:`)
          console.log(JSON.stringify(data, null, 2).split('\n').map(l => '      ' + l).join('\n'))
          if (data && data.status && data.status !== 'unknown') {
            break // Found valid response
          }
        } else {
          console.log(`      ❌ ${response.status}`)
        }
      }
      
      if (!data || data.status === 'unknown') {
        console.log(`   ⚠️ No valid status found from Relay API`)
        return null
      }
      
      // Check if swap is complete
      if (data.status === 'success' || data.status === 'complete') {
        // Look for BTC tx in txHashes (output transactions)
        let btcTxHash: string | null = null
        let actualOutput: string | null = null
        
        // txHashes contains output transactions
        if (data.txHashes && Array.isArray(data.txHashes)) {
          for (const tx of data.txHashes) {
            // BTC txs don't have 0x prefix
            if (typeof tx === 'string' && !tx.startsWith('0x')) {
              btcTxHash = tx
            } else if (typeof tx === 'object' && tx.txHash) {
              if (tx.chainId === BITCOIN_CHAIN_ID || !tx.txHash.startsWith('0x')) {
                btcTxHash = tx.txHash
              }
            }
          }
        }
        
        // Also check for outTxs or similar fields
        if (!btcTxHash && data.outTxs) {
          for (const tx of data.outTxs) {
            if (tx.chainId === BITCOIN_CHAIN_ID || (tx.txHash && !tx.txHash.startsWith('0x'))) {
              btcTxHash = tx.txHash
            }
          }
        }
        
        // Try to get actual output amount
        if (data.amountOut) {
          actualOutput = data.amountOut
        }
        
        if (verbose && btcTxHash) {
          console.log(`   ✅ BTC Payout Tx: ${btcTxHash}`)
          console.log(`      https://mempool.space/tx/${btcTxHash}`)
        }
        
        pendingSwaps.delete(swapId)
        
        return {
          swapId,
          status: 'completed',
          payoutTxHash: btcTxHash,
          actualOutputAmount: actualOutput,
          settledAt: Date.now(),
        }
      }
      
      // Still pending
      if (verbose) {
        console.log(`   [${swapId.slice(0, 8)}...] Status: ${data.status || 'pending'}`)
      }
      
      return null
    } catch (error) {
      if (verbose) {
        console.log(`   [${swapId.slice(0, 8)}...] Error checking status:`, error)
      }
      return null
    }
  },

  /**
   * Get status string for display
   */
  async getStatusString(swapId: string): Promise<string> {
    const swap = pendingSwaps.get(swapId)
    return swap?.status || 'unknown'
  },
}
