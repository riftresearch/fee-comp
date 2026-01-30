// Common types for all providers

export interface Quote {
  provider: string
  inputToken: string
  outputToken: string
  inputAmount: string
  outputAmount: string
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
  timestamp: number
  error?: string  // Optional error message for failed/skipped swaps
  relayRequestId?: string | null  // Relay-specific: request ID for tracking
  inputUsd?: number  // USD value of input at swap time (for fee calculation)
}

export interface SettlementResult {
  swapId: string
  status: string
  payoutTxHash: string | null
  actualOutputAmount: string | null
  settledAt: number | null
  chainflipSwapId?: string | null  // Numeric swap ID for Chainflip explorer
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

export function fromSmallestUnit(amount: string, token: string): string {
  const decimals = DECIMALS[token] || 18
  const padded = amount.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals) || '0'
  const frac = padded.slice(-decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

// Terminal color codes for tokens
const RESET = '\x1b[0m'
const TOKEN_COLORS: Record<string, string> = {
  BTC: '\x1b[38;5;208m',   // Orange
  CBBTC: '\x1b[38;5;33m',  // Blue
  ETH: '\x1b[38;5;135m',   // Purple
  EVM: '\x1b[38;5;135m',   // Purple (same as ETH)
  USDC: '\x1b[38;5;34m',   // Green
}

/**
 * Colorize a token name for terminal output
 */
export function colorToken(token: string): string {
  const color = TOKEN_COLORS[token]
  return color ? `${color}${token}${RESET}` : token
}

/**
 * Format a swap pair with colored tokens (e.g., "BTC→ETH")
 */
export function colorPair(inputToken: string, outputToken: string): string {
  return `${colorToken(inputToken)}→${colorToken(outputToken)}`
}
