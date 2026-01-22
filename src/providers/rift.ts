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

    const { quote, executeSwap } = await sdk.getQuote({
      from: fromCurrency,
      to: toCurrency,
      amount,
      mode: 'exact_input',
      destinationAddress,
      // Refund address for BTC input swaps
      ...(inputToken === 'BTC' && { refundAddress: BTC_ADDRESS }),
    })

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

    const execute = async (): Promise<SwapResult> => {
      console.log(`\n🔄 Executing swap...`)
      const swap = await executeSwap()
      
      console.log(`✅ Swap initiated:`)
      console.log(`   Swap ID: ${swap.swapId}`)
      console.log(`   Status: ${swap.status}`)

      return {
        provider: 'Rift',
        success: true,
        swapId: swap.swapId,
        txHash: null,
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
  async checkSettlementOnce(swapId: string): Promise<SettlementResult | null> {
    const sdk = getSdk()
    if (!sdk) {
      throw new Error('Rift: SDK not initialized')
    }

    const status = await sdk.getSwapStatus(swapId)
    
    const riftData = (status as { rift?: { status?: string; mm_deposit_status?: unknown; settlement_status?: unknown } }).rift
    
    // Check if we have settlement/payout info
    const mmDeposit = riftData?.mm_deposit_status as { tx_hash?: string; amount?: string } | undefined
    const settlement = riftData?.settlement_status as { tx_hash?: string; amount?: string } | undefined

    // For EVM -> BTC: mm_deposit_status has BTC payout tx
    // For BTC -> EVM: settlement_status might have EVM tx
    const payoutTxHash = mmDeposit?.tx_hash || settlement?.tx_hash || null
    const actualAmount = mmDeposit?.amount || settlement?.amount || null

    // Check for failure
    if (riftData?.status === 'failed' || status.status === 'failed') {
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
        status: riftData?.status || 'completed',
        payoutTxHash,
        actualOutputAmount: actualAmount,
        settledAt: Date.now(),
      }
    }

    // Still pending
    return null
  },
}
