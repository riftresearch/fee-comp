import { logAccountConfig, initializeUtxoStateFromMempool } from './account.js'
import { rift } from './providers/rift.js'
import { thorchain, recoverPendingSwapsFromCSV as recoverThorchainSwaps } from './providers/thorchain.js'
import { relay } from './providers/relay.js'
import { type SwapParams, colorToken, colorPair } from './providers/types.js'
import { logQuote, logSwap } from './csv.js'
import { startServer } from './server.js'
import { trackSwap, startSettlementWatcher } from './settlement-tracker.js'
import { getTokenPrices } from './prices.js'
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
  rift: false,
  relay: false,
  thorchain: true,
}

// parse CLI args (--execute)
const args = process.argv.slice(2)
const EXECUTE_SWAPS = args.includes('--execute') ? true : args.includes('--no-execute') ? false : DEFAULT_EXECUTE_SWAPS

// Note: Delays between swaps removed - Relay provider now handles UTXO conflicts
// with automatic retry and fresh quote fetching

// Execute a single swap for a provider
async function executeProviderSwap(
  provider: { name: string; getQuote: (swap: SwapParams) => Promise<{ quote: { outputAmount: string }; execute: () => Promise<{ swapId?: string }> }> },
  swap: SwapParams,
  prices: Awaited<ReturnType<typeof getTokenPrices>>
) {
  const { quote, execute } = await provider.getQuote(swap)
  console.log(`\n[${provider.name}] Quote: ${swap.inputAmount} ${colorToken(swap.inputToken)} -> ${quote.outputAmount} ${colorToken(swap.outputToken)}`)
  logQuote(quote as Parameters<typeof logQuote>[0], prices)
  
  if (EXECUTE_SWAPS) {
    const result = await execute()
    logSwap(result as Parameters<typeof logSwap>[0], prices)
    if (result.swapId) trackSwap(result as Parameters<typeof trackSwap>[0])
    return true // executed
  }
  return false // quote only
}

// main quoting/swapping function
async function executeSwaps(swaps: SwapParams[]) {
  const isBtcToEvm = swaps[0]?.inputToken === 'BTC'
  const direction = isBtcToEvm ? `${colorToken('BTC')} -> ${colorToken('EVM')}` : `${colorToken('EVM')} -> ${colorToken('BTC')}`
  console.log(`\n${'='.repeat(50)}\n${direction} | ${new Date().toISOString()}\n${'='.repeat(50)}`)

  // fetch current token prices
  const prices = await getTokenPrices()

  // For BTC→EVM swaps: must be sequential quote+execute to avoid UTXO conflicts
  // Relay constructs PSBTs at quote time, so we need fresh quotes after each execution
  if (isBtcToEvm && EXECUTE_SWAPS) {
    console.log(`\n📋 BTC→EVM: Using sequential quote+execute (UTXO safety)`)
    
    for (const swap of swaps) {
      // ---------------------------------- RIFT (sequential) --------------------------------------
      if (PROVIDERS.rift) {
        try {
          await executeProviderSwap(rift as Parameters<typeof executeProviderSwap>[0], swap, prices)
        } catch (err) {
          console.error(`  ❌ Rift Error: ${err instanceof Error ? err.message : err}`)
        }
      }

      // ---------------------------------- RELAY (sequential) --------------------------------------
      if (PROVIDERS.relay) {
        try {
          await executeProviderSwap(relay as Parameters<typeof executeProviderSwap>[0], swap, prices)
        } catch (err) {
          console.error(`  ❌ Relay Error: ${err instanceof Error ? err.message : err}`)
        }
      }

      // ---------------------------------- THORCHAIN (sequential) --------------------------------------
      if (PROVIDERS.thorchain && thorchain.supportsSwap(swap.inputToken, swap.outputToken)) {
        try {
          await executeProviderSwap(thorchain as Parameters<typeof executeProviderSwap>[0], swap, prices)
        } catch (err) {
          console.error(`  ❌ Thorchain Error: ${err instanceof Error ? err.message : err}`)
        }
      }
    }
    return
  }

  // For EVM→BTC swaps (or quote-only mode): can batch quotes since no UTXO conflict on EVM side
  for (const swap of swaps) {
    // ---------------------------------- RIFT --------------------------------------
    if (PROVIDERS.rift) {
      try {
        await executeProviderSwap(rift as Parameters<typeof executeProviderSwap>[0], swap, prices)
      } catch (err) {
        console.error(`  ❌ Rift Error: ${err instanceof Error ? err.message : err}`)
      }
    }

    // ---------------------------------- RELAY --------------------------------------
    if (PROVIDERS.relay) {
      try {
        await executeProviderSwap(relay as Parameters<typeof executeProviderSwap>[0], swap, prices)
      } catch (err) {
        console.error(`  ❌ Relay Error: ${err instanceof Error ? err.message : err}`)
      }
    }

    // ---------------------------------- THORCHAIN --------------------------------------
    if (PROVIDERS.thorchain && thorchain.supportsSwap(swap.inputToken, swap.outputToken)) {
      try {
        await executeProviderSwap(thorchain as Parameters<typeof executeProviderSwap>[0], swap, prices)
      } catch (err) {
        console.error(`  ❌ Thorchain Error: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
}

async function main() {
  const activeProviders = Object.entries(PROVIDERS).filter(([, v]) => v).map(([k]) => k)
  
  const green = '\x1b[38;5;120m'
  const yellow = '\x1b[33m'
  const white = '\x1b[97m'
  const reset = '\x1b[0m'
  
  console.log(`${green}🚀 Fee Comp Server starting...${reset}`)
  console.log(`${green}⏱️  Running for ${yellow}7 days${green}, swapping every ${yellow}2 hours${reset}`)
  console.log(`${green}💱 Execute swaps: ${EXECUTE_SWAPS ? `${green}YES` : `${yellow}NO (quotes only)`}${reset}`)
  console.log(`${green}🔌 Providers: ${white}${activeProviders.join(', ') || 'none'}${reset}`)
  console.log('')
  logAccountConfig()
  startServer()
  
  // Start background settlement watcher
  if (EXECUTE_SWAPS) {
    startSettlementWatcher()
    
    // Initialize UTXO state from mempool (recovers state if restarted while txs pending)
    console.log(`\n📊 Initializing UTXO state...`)
    const { pendingTxCount, spentUtxoCount } = await initializeUtxoStateFromMempool()
    
    if (pendingTxCount > 0) {
      console.log(`   ⚠️ Found ${pendingTxCount} pending tx(s) - will use recovered state to avoid conflicts`)
      console.log('')
    }
    
    // Recover pending THORChain swaps from CSV for settlement tracking
    if (PROVIDERS.thorchain) {
      recoverThorchainSwaps()
    }
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
  let countdownPaused = false

  // Export function to pause countdown while logging
  ;(global as any).pauseCountdown = () => {
    countdownPaused = true
    process.stdout.write('\r' + ' '.repeat(60) + '\r') // Clear the line
  }
  ;(global as any).resumeCountdown = () => {
    countdownPaused = false
  }

  // live countdown timer - only updates when not paused
  console.log('')
  const countdownInterval = setInterval(() => {
    if (countdownPaused) return
    const remaining = nextSwapTime - Date.now()
    if (remaining <= 0) return

    const hours = Math.floor(remaining / (60 * 60 * 1000))
    const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
    const secs = Math.floor((remaining % (60 * 1000)) / 1000)

    process.stdout.write(`\r⏳ Next: ${getNextDirection()} in ${hours}h ${mins}m ${secs}s      `)
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
