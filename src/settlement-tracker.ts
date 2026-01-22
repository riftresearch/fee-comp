import { rift } from './providers/rift.js'
import { logSettlement } from './csv.js'
import type { SwapResult, SettlementResult } from './providers/types.js'

// Pending swaps waiting for settlement
const pendingSwaps = new Map<string, SwapResult>()

// Poll interval for checking settlements
const POLL_INTERVAL_MS = 30_000 // 30 seconds

// Max time to wait for settlement before giving up
const MAX_WAIT_MS = 2 * 60 * 60 * 1000 // 2 hours

/**
 * Add a swap to the pending queue for settlement tracking
 */
export function trackSwap(swap: SwapResult) {
  if (!swap.swapId) {
    console.warn('⚠️  Cannot track swap without swapId')
    return
  }
  pendingSwaps.set(swap.swapId, swap)
  console.log(`📋 Tracking swap ${swap.swapId} for settlement (${pendingSwaps.size} pending)`)
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
  
  // Clear the countdown line and print header
  process.stdout.write('\r' + ' '.repeat(50) + '\r')
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`🔍 Settlement Check (${pendingSwaps.size} pending)`)
  console.log('─'.repeat(60))
  
  for (const [swapId, swap] of pendingSwaps) {
    try {
      const elapsed = Date.now() - swap.timestamp
      const elapsedMins = Math.round(elapsed / 60000)
      
      // Check for timeout
      if (elapsed > MAX_WAIT_MS) {
        console.log(`⏰ ${swap.inputToken}→${swap.outputToken} TIMEOUT (${elapsedMins}m)`)
        logSettlement({
          swapId,
          status: 'timeout',
          payoutTxHash: null,
          actualOutputAmount: null,
          settledAt: Date.now(),
        }, swap)
        pendingSwaps.delete(swapId)
        continue
      }
      
      const settlement = await rift.checkSettlementOnce(swapId, false) // quiet mode
      
      if (settlement && settlement.payoutTxHash) {
        console.log(`✅ ${swap.inputToken}→${swap.outputToken} SETTLED | Tx: ${settlement.payoutTxHash.slice(0, 16)}...`)
        logSettlement(settlement, swap)
        pendingSwaps.delete(swapId)
      } else if (settlement && settlement.status === 'failed') {
        console.log(`❌ ${swap.inputToken}→${swap.outputToken} FAILED`)
        logSettlement(settlement, swap)
        pendingSwaps.delete(swapId)
      } else {
        // Still pending - show compact status
        const statusInfo = await rift.getStatusString(swapId)
        console.log(`⏳ ${swap.inputToken}→${swap.outputToken} (${swap.inputAmount}) | ${elapsedMins}m | ${statusInfo}`)
      }
      
    } catch (err) {
      console.error(`❌ ${swap.inputToken}→${swap.outputToken} Error: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log('─'.repeat(60) + '\n')
}
