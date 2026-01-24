import { rift } from './providers/rift.js'
import { relay } from './providers/relay.js'
import { logSettlement } from './csv.js'
import { type SwapResult, type SettlementResult, colorPair } from './providers/types.js'
import { getTokenPrices } from './prices.js'

// Provider-specific settlement checkers
const providerCheckers: Record<string, {
  checkSettlementOnce: (swapId: string, verbose: boolean) => Promise<SettlementResult | null>
  getStatusString: (swapId: string) => Promise<string>
}> = {
  Rift: rift,
  Relay: relay,
}

// Pending swaps waiting for settlement
const pendingSwaps = new Map<string, SwapResult>()

// Poll interval for checking settlements
const POLL_INTERVAL_MS = 30_000 // 30 seconds

// Max time to wait for settlement before giving up
const MAX_WAIT_MS = 24 * 60 * 60 * 1000 // 24 hours

// Provider emoji mapping
const PROVIDER_EMOJI: Record<string, string> = {
  Rift: '⚡',
  Thorchain: '🌀',
  Relay: '🔗',
}

function providerTag(provider: string): string {
  const emoji = PROVIDER_EMOJI[provider] || '📦'
  return `${emoji}${provider}`
}

/**
 * Add a swap to the pending queue for settlement tracking
 */
export function trackSwap(swap: SwapResult) {
  if (!swap.swapId) {
    console.warn('⚠️  Cannot track swap without swapId')
    return
  }
  pendingSwaps.set(swap.swapId, swap)
  // console.log(`📋 Tracking swap ${swap.swapId} for settlement (${pendingSwaps.size} pending)`)
}

/**
 * Get count of pending swaps
 */
export function getPendingCount(): number {
  return pendingSwaps.size
}

/**
 * Start the background settlement watcher
 */
export function startSettlementWatcher() {
  console.log('👀 Settlement watcher started')
  
  // Initial check after 10 seconds
  setTimeout(checkAllPending, 10_000)
  
  // Then check every 30 seconds
  setInterval(checkAllPending, POLL_INTERVAL_MS)
}

/**
 * Check all pending swaps for settlement
 */
async function checkAllPending() {
  if (pendingSwaps.size === 0) return
  
  // Fetch current token prices for settlement logging
  const prices = await getTokenPrices()
  
  // Collect all status lines first, then print them all at once
  // This prevents the countdown timer from interleaving with our output
  const lines: string[] = []
  
  for (const [swapId, swap] of pendingSwaps) {
    try {
      const elapsed = Date.now() - swap.timestamp
      const elapsedMins = Math.round(elapsed / 60000)
      
      const tag = providerTag(swap.provider)
      
      // Check for timeout
      if (elapsed > MAX_WAIT_MS) {
        lines.push(`  ⏰ [${tag}] ${colorPair(swap.inputToken, swap.outputToken)} TIMEOUT (${elapsedMins}m)`)
        logSettlement({
          swapId,
          status: 'timeout',
          payoutTxHash: null,
          actualOutputAmount: null,
          settledAt: Date.now(),
        }, swap, prices)
        pendingSwaps.delete(swapId)
        continue
      }
      
      // Get the provider-specific checker
      const checker = providerCheckers[swap.provider]
      if (!checker) {
        lines.push(`  ⚠️ [${tag}] ${colorPair(swap.inputToken, swap.outputToken)} No settlement checker for provider`)
        continue
      }
      
      const settlement = await checker.checkSettlementOnce(swapId, false) // quiet mode
      
      if (settlement && settlement.payoutTxHash) {
        lines.push(`  ✅ [${tag}] ${colorPair(swap.inputToken, swap.outputToken)} SETTLED | Tx: ${settlement.payoutTxHash.slice(0, 16)}...`)
        logSettlement(settlement, swap, prices)
        pendingSwaps.delete(swapId)
      } else if (settlement && settlement.status === 'failed') {
        lines.push(`  ❌ [${tag}] ${colorPair(swap.inputToken, swap.outputToken)} FAILED`)
        logSettlement(settlement, swap, prices)
        pendingSwaps.delete(swapId)
      } else {
        // Still pending - show compact status
        const statusInfo = await checker.getStatusString(swapId)
        lines.push(`  ⏳ [${tag}] ${colorPair(swap.inputToken, swap.outputToken)} (${swap.inputAmount}) | ${elapsedMins}m | ${statusInfo}`)
      }
      
    } catch (err) {
      lines.push(`  ❌ [${providerTag(swap.provider)}] ${colorPair(swap.inputToken, swap.outputToken)} Error: ${err instanceof Error ? err.message : err}`)
    }
  }
  
  // Clear the countdown line completely, then print all output at once
  process.stdout.write('\r' + ' '.repeat(80) + '\r')
  
  // Print header + all lines + footer as one block
  const output = [
    `\n${'─'.repeat(60)}`,
    `🔍 Settlement Check (${pendingSwaps.size} pending)`,
    '─'.repeat(60),
    ...lines,
    '─'.repeat(60),
    '' // Empty line before countdown resumes
  ].join('\n')
  
  console.log(output)
}
