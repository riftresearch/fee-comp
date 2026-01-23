import { logAccountConfig } from './account.js'
import { rift } from './providers/rift.js'
// import { thorchain } from './providers/thorchain.js'
// import { relay } from './providers/relay.js'
import { type SwapParams, colorToken, colorPair } from './providers/types.js'
import { logQuote, logSwap } from './csv.js'
import { startServer } from './server.js'
import { trackSwap, startSettlementWatcher } from './settlement-tracker.js'
import {
  TWO_HOURS_MS,
  SEVEN_DAYS_MS,
  STARTING_DIRECTION,
  EXECUTE_SWAPS as DEFAULT_EXECUTE_SWAPS,
  evmToBtcSwaps,
  btcToEvmSwaps,
} from './constants.js'

// ============================================================================
// ACTIVE PROVIDERS
// ============================================================================
const PROVIDERS = {
  rift: true,
  // thorchain: true,
  // relay: true,
}

// Parse CLI args: --execute or --no-execute
const args = process.argv.slice(2)
const EXECUTE_SWAPS = args.includes('--execute')
  ? true
  : args.includes('--no-execute')
    ? false
    : DEFAULT_EXECUTE_SWAPS

// main quoting/swapping function
async function executeSwaps(swaps: SwapParams[]) {
  const direction = swaps[0]?.inputToken === 'BTC' 
    ? `${colorToken('BTC')} -> ${colorToken('EVM')}` 
    : `${colorToken('EVM')} -> ${colorToken('BTC')}`
  console.log(`\n${'='.repeat(50)}`)
  console.log(`${direction} | ${new Date().toISOString()}`)
  console.log('='.repeat(50))

  for (const swap of swaps) {
    // ---------------------------------- RIFT --------------------------------------
    if (PROVIDERS.rift) {
      try {
        const { quote, execute } = await rift.getQuote(swap)
        console.log(`\n[${rift.name}] Quote: ${swap.inputAmount} ${colorToken(swap.inputToken)} -> ${quote.outputAmount} ${colorToken(swap.outputToken)}`)
        console.log(`  Fee: $${quote.feeUsd.toFixed(4)} (${quote.feePercent.toFixed(2)}%)`)
        logQuote(quote)

        if (EXECUTE_SWAPS) {
          const result = await execute()
          logSwap(result)

          // Track swap for settlement in background (non-blocking)
          if (result.swapId) {
            trackSwap(result)
          }
        }
      } catch (err) {
        console.error(`  ❌ Rift Error: ${err instanceof Error ? err.message : err}`)
      }
    }

    // ---------------------------------- THORCHAIN --------------------------------------
    // if (PROVIDERS.thorchain) {
    //   try {
    //     const { quote, execute } = await thorchain.getQuote(swap)
    //     console.log(`\n[${thorchain.name}] Quote: ${swap.inputAmount} ${colorToken(swap.inputToken)} -> ${quote.outputAmount} ${colorToken(swap.outputToken)}`)
    //     console.log(`  Fee: $${quote.feeUsd.toFixed(4)} (${quote.feePercent.toFixed(2)}%)`)
    //     logQuote(quote)
    //
    //     if (EXECUTE_SWAPS) {
    //       const result = await execute()
    //       logSwap(result)
    //       if (result.swapId) trackSwap(result)
    //     }
    //   } catch (err) {
    //     console.error(`  ❌ Thorchain Error: ${err instanceof Error ? err.message : err}`)
    //   }
    // }

    // ---------------------------------- RELAY --------------------------------------
    // if (PROVIDERS.relay) {
    //   try {
    //     const { quote, execute } = await relay.getQuote(swap)
    //     console.log(`\n[${relay.name}] Quote: ${swap.inputAmount} ${colorToken(swap.inputToken)} -> ${quote.outputAmount} ${colorToken(swap.outputToken)}`)
    //     console.log(`  Fee: $${quote.feeUsd.toFixed(4)} (${quote.feePercent.toFixed(2)}%)`)
    //     logQuote(quote)
    //
    //     if (EXECUTE_SWAPS) {
    //       const result = await execute()
    //       logSwap(result)
    //       if (result.swapId) trackSwap(result)
    //     }
    //   } catch (err) {
    //     console.error(`  ❌ Relay Error: ${err instanceof Error ? err.message : err}`)
    //   }
    // }
  }
}

async function main() {
  const activeProviders = Object.entries(PROVIDERS).filter(([, v]) => v).map(([k]) => k)
  
  console.log('🚀 Fee Comp Server starting...')
  console.log(`📅 ${new Date().toISOString()}`)
  console.log(`⏱️  Running for 7 days, swapping every 2 hours`)
  console.log(`💱 Execute swaps: ${EXECUTE_SWAPS ? 'YES' : 'NO (quotes only)'}`)
  console.log(`🔌 Providers: ${activeProviders.join(', ') || 'none'}`)
  console.log('')
  logAccountConfig()
  startServer()
  
  // Start background settlement watcher
  if (EXECUTE_SWAPS) {
    startSettlementWatcher()
  }

  const startTime = Date.now()
  let cycleCount = 0

  // determine which set to run, alternating based on starting direction
  const sets = [btcToEvmSwaps, evmToBtcSwaps]
  if (STARTING_DIRECTION === 'EVM→BTC') sets.reverse()
  const getSwaps = () => sets[cycleCount % 2]
  const getNextDirection = () => (getSwaps()[0]?.inputToken === 'BTC' 
    ? `${colorToken('BTC')} -> ${colorToken('EVM')}` 
    : `${colorToken('EVM')} -> ${colorToken('BTC')}`)

  // run the first set immediately
  await executeSwaps(getSwaps())
  cycleCount++
  // TESTING ONLY: execute swaps immediately again to test other direction
  await executeSwaps(getSwaps())
  cycleCount++

  // track next swap time
  let nextSwapTime = Date.now() + TWO_HOURS_MS

  // live countdown timer
  const countdownInterval = setInterval(() => {
    const remaining = nextSwapTime - Date.now()
    if (remaining <= 0) return

    const hours = Math.floor(remaining / (60 * 60 * 1000))
    const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
    const secs = Math.floor((remaining % (60 * 1000)) / 1000)

    process.stdout.write(`\r⏳ Next: ${getNextDirection()} in ${hours}h ${mins}m ${secs}s   `)
  }, 1000)

  // run the next set every 2 hours for 7 days
  const swapInterval = setInterval(async () => {
    const elapsed = Date.now() - startTime

    if (elapsed >= SEVEN_DAYS_MS) {
      clearInterval(countdownInterval)
      clearInterval(swapInterval)
      console.log('\n\n✅ 7 days complete! Shutting down.')
      process.exit(0)
    }

    console.log('\n')
    await executeSwaps(getSwaps())
    cycleCount++

    nextSwapTime = Date.now() + TWO_HOURS_MS
    const daysRemaining = ((SEVEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)).toFixed(2)
    console.log(`\n📅 ${daysRemaining} days remaining...\n`)
  }, TWO_HOURS_MS)
}

main()
