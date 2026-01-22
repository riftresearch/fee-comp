// Common types for all providers

export interface Quote {
  provider: string
  inputToken: string
  outputToken: string
  inputAmount: string
  outputAmount: string
  feeUsd: number
  feePercent: number
  expiresAt?: number
  raw?: unknown
}

export interface SwapResult {
  provider: string
  success: boolean
  swapId: string | null
  txHash: string | null
  inputToken: string
  outputToken: string
  inputAmount: string
  outputAmount: string
  feeUsd: number
  timestamp: number
}

export interface SwapParams {
  inputToken: string
  outputToken: string
  inputAmount: string
}

export interface Provider {
  name: string
  getQuote(inputToken: string, outputToken: string, inputAmount: string): Promise<Quote>
  executeSwap(params: SwapParams): Promise<SwapResult>
}

// Token decimals
export const DECIMALS: Record<string, number> = {
  BTC: 8,
  CBBTC: 8,
  USDC: 6,
  ETH: 18,
}

export function toSmallestUnit(amount: string, token: string): string {
  const decimals = DECIMALS[token] || 18
  const [whole, frac = ''] = amount.split('.')
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + paddedFrac).toString()
}

export function fromSmallestUnit(amount: string, token: string): string {
  const decimals = DECIMALS[token] || 18
  const padded = amount.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals) || '0'
  const frac = padded.slice(-decimals)
  return `${whole}.${frac}`.replace(/\.?0+$/, '')
}
