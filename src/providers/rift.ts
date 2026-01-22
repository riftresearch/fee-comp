import { RiftSdk, BTC, type Currency } from '@riftresearch/sdk'
import {
  mainnetPublicClient,
  mainnetWalletClient,
  getDestinationAddress,
  sendBitcoin,
} from '../account.js'
import { type Provider, type Quote, type SwapResult, type SwapParams, toSmallestUnit } from './types.js'

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

export const rift: Provider = {
  name: 'Rift',

  async getQuote(inputToken: string, outputToken: string, inputAmount: string): Promise<Quote> {
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

    const { quote } = await sdk.getQuote({
      from: fromCurrency,
      to: toCurrency,
      amount,
      mode: 'exact_input',
      destinationAddress,
    })

    return {
      provider: 'Rift',
      inputToken,
      outputToken,
      inputAmount,
      outputAmount: quote.to.amount,
      feeUsd: quote.fees.totalUsd,
      feePercent: (quote.fees.totalUsd / parseFloat(inputAmount)) * 100,
      raw: quote,
    }
  },

  async executeSwap(params: SwapParams): Promise<SwapResult> {
    const fromCurrency = CURRENCIES[params.inputToken]
    const toCurrency = CURRENCIES[params.outputToken]

    if (!fromCurrency || !toCurrency) {
      throw new Error(`Rift: Unknown token`)
    }

    const sdk = getSdk()
    if (!sdk) {
      throw new Error('Rift: SDK not initialized')
    }

    const amount = toSmallestUnit(params.inputAmount, params.inputToken)
    const destinationAddress = getDestinationAddress(params.outputToken)

    const { quote, executeSwap } = await sdk.getQuote({
      from: fromCurrency,
      to: toCurrency,
      amount,
      mode: 'exact_input',
      destinationAddress,
    })

    const swap = await executeSwap()

    return {
      provider: 'Rift',
      success: true,
      swapId: swap.swapId,
      txHash: null,
      inputToken: params.inputToken,
      outputToken: params.outputToken,
      inputAmount: params.inputAmount,
      outputAmount: quote.to.amount,
      feeUsd: quote.fees.totalUsd,
      timestamp: Date.now(),
    }
  },
}
