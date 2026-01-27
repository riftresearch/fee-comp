import { createClient, getClient, MAINNET_RELAY_API } from '@relayprotocol/relay-sdk'
import {
  mainnetWalletClient,
  EVM_ADDRESS,
  BTC_ADDRESS,
  sendBitcoin,
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
  relayRequestId?: string | null  // The actual Relay API request ID
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

    // Extract output amount and requestId from quote
    const quoteData = quoteResponse as unknown as {
      details?: {
        currencyOut?: { amount?: string }
      }
      steps?: Array<{ requestId?: string }>
    }

    const outputAmount = quoteData.details?.currencyOut?.amount || '0'
    
    // Extract the Relay requestId from the steps
    const relayRequestId = quoteData.steps?.[0]?.requestId || null
    if (relayRequestId) {
      console.log(`   ✅ Found Relay Request ID: ${relayRequestId}`)
    }

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

      // Handle BTC→EVM swaps differently (send BTC to deposit address)
      if (isBtcInput) {
        return await executeBtcToEvm()
      }

      // EVM→BTC: Use SDK execute
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
          onProgress: (progressData) => {
            const { steps, fees, breakdown, currentStep, currentStepItem, txHashes, details } = progressData
            
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
                console.log(`      EVM Recipient: ${d.recipient}`)
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
      
      // Store for settlement tracking (include requestId from quote for API tracking)
      pendingSwaps.set(swapId, {
        status: finalStatus,
        txHashes: finalTxHashes,
        details: finalDetails,
        btcPayoutTxHash,
        ethDepositTxHash,
        relayRequestId,
      })

      console.log(`✅ Relay swap deposited`)
      console.log(`   📋 Swap ID (for CSV): ${swapId}`)
      console.log(`   📋 Relay Request ID (for API): ${relayRequestId}`)
      console.log(`   📋 ETH Deposit Tx: ${ethDepositTxHash || 'N/A'}`)
      console.log(`   Waiting for BTC payout...`)

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

    // BTC→EVM: Send BTC to deposit address from quote
    async function executeBtcToEvm(): Promise<SwapResult> {
      // Extract deposit address from quote steps
      const steps = (quoteResponse as { steps?: Array<{ items?: Array<{ data?: { to?: string } }> }> }).steps
      let depositAddress: string | null = null
      
      // Look for BTC deposit address in steps
      if (steps) {
        for (const step of steps) {
          for (const item of step.items || []) {
            // The deposit address should be a BTC address (starts with bc1, 1, or 3)
            const to = item.data?.to
            if (to && (to.startsWith('bc1') || to.startsWith('1') || to.startsWith('3'))) {
              depositAddress = to
              break
            }
          }
          if (depositAddress) break
        }
      }
      
      // Also check details for deposit address
      if (!depositAddress) {
        const details = (quoteResponse as { details?: { depositAddress?: string } }).details
        depositAddress = details?.depositAddress || null
      }
      
      if (!depositAddress) {
        // Log the quote structure to debug
        console.log(`   ⚠️ Could not find BTC deposit address in quote`)
        console.log(`   Quote keys: ${Object.keys(quoteResponse).join(', ')}`)
        const qr = quoteResponse as Record<string, unknown>
        if (qr.steps) {
          console.log(`   Steps: ${JSON.stringify(qr.steps, null, 2).slice(0, 500)}...`)
        }
        throw new Error('Relay: Could not find BTC deposit address in quote')
      }
      
      console.log(`   📍 BTC Deposit Address: ${depositAddress}`)
      
      // Send BTC to the deposit address
      const amountSats = BigInt(amount)
      console.log(`   📤 Sending ${amountSats} sats to ${depositAddress}...`)
      
      const btcTxHash = await sendBitcoin(depositAddress, amountSats)
      
      console.log(`✅ Relay BTC deposit sent`)
      console.log(`   BTC Tx: ${btcTxHash}`)
      console.log(`   https://mempool.space/tx/${btcTxHash}`)
      console.log(`   Waiting for EVM payout...`)
      
      // Store for settlement tracking
      pendingSwaps.set(btcTxHash, {
        status: 'pending',
        txHashes: [btcTxHash],
        details: null,
        btcPayoutTxHash: btcTxHash,
        ethDepositTxHash: null,
      })
      
      return {
        provider: 'Relay',
        success: true,
        swapId: btcTxHash,
        txHash: btcTxHash,
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
    // Query Relay's requests API to check if BTC payout has been made
    
    interface RelayRequestResponse {
      requests?: Array<{
        id: string
        status: string
        recipient?: string
        data?: {
          outTxs?: Array<{
            hash: string
            chainId: number
            stateChanges?: Array<{
              address: string
              change: {
                balanceDiff: string
              }
            }>
          }>
          metadata?: {
            currencyOut?: {
              amount?: string
              amountFormatted?: string
            }
          }
        }
      }>
    }
    
    try {
      // Check if we have stored info for this swap
      const storedSwap = pendingSwaps.get(swapId)
      
      // Get the Relay Request ID - this is what we need for the API
      const relayRequestId = storedSwap?.relayRequestId
      
      if (!relayRequestId) {
        console.log(`   ⚠️ No Relay Request ID stored for swap ${swapId.slice(0, 16)}...`)
        return null
      }
      
      console.log(`   🔍 Checking Relay Request ID: ${relayRequestId}`)
      
      // Use the relay-api-proxy endpoint with browser-like headers
      const url = `https://relay-api-proxy.relay-link.workers.dev/api/requests/v2?id=${relayRequestId}`
      console.log(`   🔗 https://relay.link/transaction/${relayRequestId}`)
      
      const response = await fetch(url, {
        headers: {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.9',
          'referer': `https://relay.link/transaction/${swapId}`,
          'origin': 'https://relay.link',
        },
      })
      if (!response.ok) {
        console.log(`   ❌ API error: ${response.status}`)
        return null
      }
      
      const data = await response.json() as RelayRequestResponse
      console.log(`   📡 Response status: ${data.requests?.[0]?.status || 'no requests'}`)
      
      const request = data.requests?.[0]
      if (!request) {
        console.log(`   ⚠️ No request found`)
        return null
      }
      
      // Check if swap is complete
      if (request.status === 'success') {
        // Find output transaction - could be BTC (EVM→BTC) or EVM (BTC→EVM)
        const btcOutTx = request.data?.outTxs?.find(tx => tx.chainId === BITCOIN_CHAIN_ID)
        const evmOutTx = request.data?.outTxs?.find(tx => tx.chainId === ETHEREUM_CHAIN_ID)
        
        // Determine payout tx hash based on direction
        const payoutTxHash = btcOutTx?.hash || (evmOutTx?.hash ? `0x${evmOutTx.hash.replace(/^0x/, '')}` : null)
        const isBtcPayout = !!btcOutTx
        
        // Get actual output amount from metadata or stateChanges
        let actualOutput: string | null = null
        
        // Try metadata first
        if (request.data?.metadata?.currencyOut?.amount) {
          actualOutput = request.data.metadata.currencyOut.amount
        }
        
        // Or find from stateChanges (positive balanceDiff to recipient)
        const outTx = btcOutTx || evmOutTx
        if (!actualOutput && outTx?.stateChanges && request.recipient) {
          const recipientChange = outTx.stateChanges.find(
            sc => sc.address.toLowerCase() === request.recipient?.toLowerCase() && 
                  parseInt(sc.change.balanceDiff) > 0
          )
          if (recipientChange) {
            actualOutput = recipientChange.change.balanceDiff
          }
        }
        
        console.log(`   ✅ Relay swap completed!`)
        if (payoutTxHash) {
          const explorer = isBtcPayout 
            ? `https://mempool.space/tx/${payoutTxHash}`
            : `https://etherscan.io/tx/${payoutTxHash}`
          console.log(`   🔗 ${isBtcPayout ? 'BTC' : 'ETH'} Payout Tx: ${payoutTxHash}`)
          console.log(`      ${explorer}`)
        }
        if (actualOutput) {
          console.log(`   💰 Actual Output: ${actualOutput}`)
        }
        
        pendingSwaps.delete(swapId)
        
        return {
          swapId,
          status: 'completed',
          payoutTxHash,
          actualOutputAmount: actualOutput,
          settledAt: Date.now(),
        }
      }
      
      // Still pending
      console.log(`   ⏳ Status: ${request.status}`)
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
    
    // Map internal status to user-friendly display
    const status = swap.status
    if (status === 'complete') return 'confirming'  // Deposit done, awaiting BTC
    if (status === 'pending') return 'processing'
    return status
  },
}
