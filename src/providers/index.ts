export * from './types.js'
export { rift } from './rift.js'

// Future providers:
// export { cowswap } from './cowswap.js'
// export { uniswap } from './uniswap.js'
// export { oneinch } from './oneinch.js'
// export { paraswap } from './paraswap.js'
// export { thorchain } from './thorchain.js'

import { rift } from './rift.js'
import type { Provider } from './types.js'

// All enabled providers
export const providers: Provider[] = [
  rift,
  // Add more as implemented
]

// Get provider by name
export function getProvider(name: string): Provider | undefined {
  return providers.find((p) => p.name.toLowerCase() === name.toLowerCase())
}
