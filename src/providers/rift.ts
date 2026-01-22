import { RiftSdk, BTC, type Currency } from '@riftresearch/sdk'
import {
  mainnetPublicClient,
  mainnetWalletClient,
  getDestinationAddress,
  sendBitcoin,
  BTC_ADDRESS,
} from '../account.js'
import { type Quote, type SwapResult, type SwapParams, type SettlementResult, toSmallestUnit } from './types.js'

// Currency definitions for Rift (mainnet only)
const USDC_MAINNET: Currency = {
  chain: { kind: 'EVM', chainId: 1 },
  token: {
    kind: 'TOKEN',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
  },
}

const CBBTC_MAINNET: Currency = {
  chain: { kind: 'EVM', chainId: 1 },
  token: {
    kind: 'TOKEN',
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    decimals: 8,
  },
}

const ETH_MAINNET: Currency = {
  chain: { kind: 'EVM', chainId: 1 },
  token: { kind: 'NATIVE', decimals: 18 },
}

const CURRENCIES: Record<string, Currency> = {
  BTC: BTC,
  CBBTC: CBBTC_MAINNET,
  USDC: USDC_MAINNET,
  ETH: ETH_MAINNET,
}

function getSdk(): RiftSdk | null {
  if (!mainnetWalletClient) return null

  return new RiftSdk({
    publicClient: mainnetPublicClient,
    walletClient: mainnetWalletClient,
    sendBitcoin: async ({ recipient, amountSats }) => {
      await sendBitcoin(recipient, BigInt(amountSats))
    },
  })
}

export interface RiftQuoteResult {
  quote: Quote
  execute: () => Promise<SwapResult>
}

export const rift = {
  name: 'Rift',

  async getQuote(params: SwapParams): Promise<RiftQuoteResult> {
    const { inputToken, outputToken, inputAmount } = params
    const fromCurrency = CURRENCIES[inputToken]
    const toCurrency = CURRENCIES[outputToken]

    if (!fromCurrency || !toCurrency) {
      throw new Error(`Rift: Unknown token ${!fromCurrency ? inputToken : outputToken}`)
    }

    const sdk = getSdk()
    if (!sdk) {
      throw new Error('Rift: SDK not initialized - check ETH_PRIVATE_KEY')
    }

    const amount = toSmallestUnit(inputAmount, inputToken)
    const destinationAddress = getDestinationAddress(outputToken)

    const quoteRequest = {
      from: fromCurrency,
      to: toCurrency,
      amount,
      mode: 'exact_input' as const,
      destinationAddress,
      ...(inputToken === 'BTC' && { refundAddress: BTC_ADDRESS }),
    }
    
    // console.log(`\n📝 Quote request:`, JSON.stringify(quoteRequest, null, 2))

    const { quote, executeSwap } = await sdk.getQuote(quoteRequest)

    const quoteResult: Quote = {
      provider: 'Rift',
      inputToken,
      outputToken,
      inputAmount,
      outputAmount: quote.to.amount,
      feeUsd: quote.fees.totalUsd,
      feePercent: (quote.fees.totalUsd / parseFloat(inputAmount)) * 100,
      raw: quote,
    }
    // console.log(quoteResult)

    const execute = async (): Promise<SwapResult> => {
      console.log(`\n🔄 Executing swap...`)
      console.log(`   Direction: ${inputToken} → ${outputToken}`)
      console.log(`   Amount: ${inputAmount} ${inputToken}`)
      console.log(`   Destination: ${destinationAddress}`)
      
      let swap
      try {
        swap = await executeSwap()
      } catch (execError) {
        console.error(`   ❌ executeSwap() threw:`, execError)
        throw execError
      }
      
      // Decode swap ID: format is "c|<cowOrderId>|<riftId>" or "<cowOrderId>|<riftId>"
      let cowOrderId = ''
      let riftId = ''
      try {
        const decoded = Buffer.from(swap.swapId, 'base64').toString('utf-8')
        const parts = decoded.split('|')
        console.log(`   Decoded parts (${parts.length}):`, parts.map(p => p.slice(0, 20) + '...'))
        
        if (parts.length >= 3) {
          // Format: c|<cowOrderId>|<riftId>
          cowOrderId = parts[1]
          riftId = parts[2]
        } else if (parts.length === 2) {
          // Format: <cowOrderId>|<riftId>
          cowOrderId = parts[0]
          riftId = parts[1]
        }
      } catch (e) {
        console.log(`   Failed to decode swap ID:`, e)
      }
      
      console.log(`✅ Swap initiated:`)
      console.log(`   Rift ID: ${riftId || swap.swapId.slice(0, 30) + '...'}`)
      console.log(`   Status: ${swap.status}`)
      if (cowOrderId) {
        console.log(`   CowSwap: https://explorer.cow.fi/orders/${cowOrderId}`)
      }
      
      // Check for deposit tx hash
      const swapAny = swap as unknown as Record<string, unknown>
      const depositTxHash = swapAny.depositTxHash || swapAny.txHash || swapAny.transactionHash || null
      if (depositTxHash) {
        console.log(`   Deposit Tx: ${depositTxHash}`)
      } else {
        // console.log(`   ⚠️  No deposit transaction hash returned!`)
      }

      return {
        provider: 'Rift',
        success: true,
        swapId: swap.swapId,
        txHash: depositTxHash as string | null,
        inputToken,
        outputToken,
        inputAmount,
        outputAmount: quote.to.amount,
        feeUsd: quote.fees.totalUsd,
        timestamp: Date.now(),
      }
    }

    return { quote: quoteResult, execute }
  },

  /**
   * Single check for settlement status (non-blocking)
   * Returns SettlementResult if settled/failed, null if still pending
   */
  async checkSettlementOnce(swapId: string, verbose = true): Promise<SettlementResult | null> {
    const sdk = getSdk()
    if (!sdk) {
      throw new Error('Rift: SDK not initialized')
    }

    const status = await sdk.getSwapStatus(swapId)
    
    const riftData = (status as { rift?: { status?: string; mm_deposit_status?: unknown; settlement_status?: unknown; user_deposit_status?: unknown } }).rift
    const currentStatus = riftData?.status || status.status || 'unknown'
    
    // Log current status if verbose
    if (verbose) {
      const userDeposit = riftData?.user_deposit_status as { status?: string; tx_hash?: string } | undefined
      const mmDepositStatus = riftData?.mm_deposit_status as { status?: string } | undefined
      
      let statusLine = `   [${swapId.slice(0, 8)}...] Status: ${currentStatus}`
      if (userDeposit?.status) statusLine += ` | Deposit: ${userDeposit.status}`
      if (userDeposit?.tx_hash) statusLine += ` (${userDeposit.tx_hash.slice(0, 10)}...)`
      if (mmDepositStatus?.status) statusLine += ` | MM: ${mmDepositStatus.status}`
      console.log(statusLine)
    }
    
    // Check if we have settlement/payout info
    const mmDeposit = riftData?.mm_deposit_status as { tx_hash?: string; amount?: string } | undefined
    const settlement = riftData?.settlement_status as { tx_hash?: string; amount?: string } | undefined

    // For EVM -> BTC: mm_deposit_status has BTC payout tx
    // For BTC -> EVM: settlement_status might have EVM tx
    const payoutTxHash = mmDeposit?.tx_hash || settlement?.tx_hash || null
    const actualAmount = mmDeposit?.amount || settlement?.amount || null

    // Check for failure
    if (riftData?.status === 'failed' || currentStatus === 'failed') {
      console.log(`\n❌ Swap ${swapId} failed. Full status:`)
      console.log(JSON.stringify(status, null, 2))
      return {
        swapId,
        status: 'failed',
        payoutTxHash: null,
        actualOutputAmount: null,
        settledAt: Date.now(),
      }
    }

    // Check if settled
    if (payoutTxHash) {
      return {
        swapId,
        status: currentStatus,
        payoutTxHash,
        actualOutputAmount: actualAmount,
        settledAt: Date.now(),
      }
    }

    // Still pending
    return null
  },

  /**
   * Get current status string for a swap (for display)
   */
  async getStatusString(swapId: string): Promise<string> {
    const sdk = getSdk()
    if (!sdk) return 'sdk_error'

    try {
      const status = await sdk.getSwapStatus(swapId)
      const riftData = (status as { rift?: { status?: string } }).rift
      return riftData?.status || status.status || 'unknown'
    } catch {
      return 'error'
    }
  },
}
