import { logAccountConfig } from './account.js'
import { rift, type SwapParams } from './providers/index.js'
import { logQuote, logSwap } from './csv.js'

const TWO_HOURS_MS = 2 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// starting direction - 'BTC→EVM' or 'EVM→BTC'
const STARTING_DIRECTION: string = 'BTC→EVM'

// BTC → EVM Swaps
const btcToEvmSwaps: SwapParams[] = [
  // $~100 - SMALL TIER SWAPS
  { inputToken: 'BTC', outputToken: 'CBBTC', inputAmount: '0.001' },
  { inputToken: 'BTC', outputToken: 'USDC', inputAmount: '0.001' },
  { inputToken: 'BTC', outputToken: 'ETH', inputAmount: '0.001' },

  // // $~1,000 - MEDIUM TIER SWAPS
  // { inputToken: 'BTC', outputToken: 'CBBTC', inputAmount: '0.01' },
  // { inputToken: 'BTC', outputToken: 'USDC', inputAmount: '0.01' },
  // { inputToken: 'BTC', outputToken: 'ETH', inputAmount: '0.01' },

  // // $~10,000 - LARGE TIER SWAPS
  // { inputToken: 'BTC', outputToken: 'CBBTC', inputAmount: '0.1' },
  // { inputToken: 'BTC', outputToken: 'USDC', inputAmount: '0.1' },
  // { inputToken: 'BTC', outputToken: 'ETH', inputAmount: '0.1' },
]

// EVM → BTC Swaps
const evmToBtcSwaps: SwapParams[] = [
  // $~100 - SMALL TIER SWAPS
  { inputToken: 'CBBTC', outputToken: 'BTC', inputAmount: '0.001' },
  { inputToken: 'USDC', outputToken: 'BTC', inputAmount: '100' },
  { inputToken: 'ETH', outputToken: 'BTC', inputAmount: '0.03' },

  // // $~1,000 - MEDIUM TIER SWAPS
  // { inputToken: 'CBBTC', outputToken: 'BTC', inputAmount: '0.01' },
  // { inputToken: 'USDC', outputToken: 'BTC', inputAmount: '1000' },
  // { inputToken: 'ETH', outputToken: 'BTC', inputAmount: '0.3' },

  // // $~10,000 - LARGE TIER SWAPS
  // { inputToken: 'CBBTC', outputToken: 'BTC', inputAmount: '0.1' },
  // { inputToken: 'USDC', outputToken: 'BTC', inputAmount: '10000' },
  // { inputToken: 'ETH', outputToken: 'BTC', inputAmount: '3' },
]

async function getQuotesAndExecuteSwaps(swaps: SwapParams[]) {
  const direction = swaps[0]?.inputToken === 'BTC' ? 'BTC → EVM' : 'EVM → BTC'
  console.log(`\n${'='.repeat(50)}`)
  console.log(`${direction} | ${new Date().toISOString()}`)
  console.log('='.repeat(50))

  for (const swap of swaps) {
    try {
      // Get quote
      const quote = await rift.getQuote(swap.inputToken, swap.outputToken, swap.inputAmount)
      console.log(`\n[${rift.name}] Quote: ${swap.inputAmount} ${swap.inputToken} → ${quote.outputAmount} ${swap.outputToken}`)
      console.log(`  Fee: $${quote.feeUsd.toFixed(4)} (${quote.feePercent.toFixed(2)}%)`)
      logQuote(quote)

      // Execute swap
      const result = await rift.executeSwap(swap)
      console.log(`  Swap ID: ${result.swapId}`)
      logSwap(result)
    } catch (err) {
      console.error(`  ❌ Error: ${err instanceof Error ? err.message : err}`)
    }
  }
}

async function main() {
  // 0 - log initial setup & account info
  console.log('🚀 Fee Comp Server starting...')
  console.log(`📅 ${new Date().toISOString()}`)
  console.log(`⏱️  Running for 7 days, swapping every 2 hours`)
  console.log('')
  logAccountConfig()

  const startTime = Date.now()
  let cycleCount = 0

  // 1 - determine which set to run, alternating based on starting direction
  const sets = [btcToEvmSwaps, evmToBtcSwaps]
  if (STARTING_DIRECTION === 'EVM→BTC') sets.reverse()
  const getSwaps = () => sets[cycleCount % 2]
  const getNextDirection = () => (getSwaps()[0]?.inputToken === 'BTC' ? 'BTC → EVM' : 'EVM → BTC')

  // 2 - run the first set immediately
  // await getQuotesAndExecuteSwaps(getSwaps())
  cycleCount++

  // 3 - track next swap time
  let nextSwapTime = Date.now() + TWO_HOURS_MS

  // 4 - live countdown timer
  const countdownInterval = setInterval(() => {
    const remaining = nextSwapTime - Date.now()
    if (remaining <= 0) return

    const hours = Math.floor(remaining / (60 * 60 * 1000))
    const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
    const secs = Math.floor((remaining % (60 * 1000)) / 1000)

    process.stdout.write(`\r⏳ Next: ${getNextDirection()} in ${hours}h ${mins}m ${secs}s   `)
  }, 1000)

  // 5 - run the next set every 2 hours for 7 days
  const swapInterval = setInterval(async () => {
    const elapsed = Date.now() - startTime

    // shut down after 7 days
    if (elapsed >= SEVEN_DAYS_MS) {
      clearInterval(countdownInterval)
      clearInterval(swapInterval)
      console.log('\n\n✅ 7 days complete! Shutting down.')
      process.exit(0)
    }

    // run next set
    console.log('\n')
    await getQuotesAndExecuteSwaps(getSwaps())
    cycleCount++

    // reset next swap time
    nextSwapTime = Date.now() + TWO_HOURS_MS

    const daysRemaining = ((SEVEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)).toFixed(2)
    console.log(`\n📅 ${daysRemaining} days remaining...\n`)
  }, TWO_HOURS_MS)
}

main()
