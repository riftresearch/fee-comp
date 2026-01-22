// Common types for all providers

export interface Quote {
  provider: string
  inputToken: string
  outputToken: string
  inputAmount: string
  outputAmount: string
  feeUsd: number
  feePercent: number
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
  outputAmount: string  // expected
  feeUsd: number
  timestamp: number
}

export interface SettlementResult {
  swapId: string
  status: string
  payoutTxHash: string | null
  actualOutputAmount: string | null
  settledAt: number | null
}

export interface SwapParams {
  inputToken: string
  outputToken: string
  inputAmount: string
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
