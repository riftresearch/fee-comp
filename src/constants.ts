import { type SwapParams } from './providers/types.js'

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// starting direction - 'BTC→EVM' or 'EVM→BTC'
export const STARTING_DIRECTION: string = 'BTC→EVM'

// set to true to execute swaps, false for quotes only
export const EXECUTE_SWAPS = false

// EVM → BTC Swaps
export const evmToBtcSwaps: SwapParams[] = [
  // $~10 - TEST SWAPS
  // { inputToken: 'CBBTC', outputToken: 'BTC', inputAmount: '0.0001' },
  // { inputToken: 'USDC', outputToken: 'BTC', inputAmount: '10' },
  // { inputToken: 'ETH', outputToken: 'BTC', inputAmount: '0.003' },

  // // $~100 - SMALL TIER SWAPS
  // { inputToken: 'CBBTC', outputToken: 'BTC', inputAmount: '0.001' },
  // { inputToken: 'USDC', outputToken: 'BTC', inputAmount: '100' },
  // { inputToken: 'ETH', outputToken: 'BTC', inputAmount: '0.03' },

  // // $~1,000 - MEDIUM TIER SWAPS
  // { inputToken: 'CBBTC', outputToken: 'BTC', inputAmount: '0.01' },
  // { inputToken: 'USDC', outputToken: 'BTC', inputAmount: '1000' },
  // { inputToken: 'ETH', outputToken: 'BTC', inputAmount: '0.3' },

  // // $~10,000 - LARGE TIER SWAPS
  // { inputToken: 'CBBTC', outputToken: 'BTC', inputAmount: '0.1' },
  // { inputToken: 'USDC', outputToken: 'BTC', inputAmount: '10000' },
  // { inputToken: 'ETH', outputToken: 'BTC', inputAmount: '3' },
]

// BTC → EVM Swaps
export const btcToEvmSwaps: SwapParams[] = [
  // $~10 - TEST SWAPS
  { inputToken: 'BTC', outputToken: 'CBBTC', inputAmount: '0.0001' },
  { inputToken: 'BTC', outputToken: 'USDC', inputAmount: '0.0001' },
  { inputToken: 'BTC', outputToken: 'ETH', inputAmount: '0.0001' },

  // // $~100 - SMALL TIER SWAPS
  // { inputToken: 'BTC', outputToken: 'CBBTC', inputAmount: '0.001' },
  // { inputToken: 'BTC', outputToken: 'USDC', inputAmount: '0.001' },
  // { inputToken: 'BTC', outputToken: 'ETH', inputAmount: '0.001' },

  // // $~1,000 - MEDIUM TIER SWAPS
  // { inputToken: 'BTC', outputToken: 'CBBTC', inputAmount: '0.01' },
  // { inputToken: 'BTC', outputToken: 'USDC', inputAmount: '0.01' },
  // { inputToken: 'BTC', outputToken: 'ETH', inputAmount: '0.01' },

  // // $~10,000 - LARGE TIER SWAPS
  // { inputToken: 'BTC', outputToken: 'CBBTC', inputAmount: '0.1' },
  // { inputToken: 'BTC', outputToken: 'USDC', inputAmount: '0.1' },
  // { inputToken: 'BTC', outputToken: 'ETH', inputAmount: '0.1' },
]
