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
  
  console.log(`\n🔍 Checking ${pendingSwaps.size} pending swap(s) for settlement...`)
  
  for (const [swapId, swap] of pendingSwaps) {
    try {
      // Check for timeout
      const elapsed = Date.now() - swap.timestamp
      if (elapsed > MAX_WAIT_MS) {
        console.log(`\n⏰ Swap ${swapId} timed out after ${Math.round(elapsed / 60000)} minutes`)
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
      
      const settlement = await rift.checkSettlementOnce(swapId)
      
      if (settlement && settlement.payoutTxHash) {
        // Settlement complete!
        console.log(`\n✅ Settlement complete for ${swapId}`)
        console.log(`   Payout Tx: ${settlement.payoutTxHash}`)
        console.log(`   Actual Amount: ${settlement.actualOutputAmount}`)
        
        logSettlement(settlement, swap)
        pendingSwaps.delete(swapId)
        
        console.log(`   (${pendingSwaps.size} swap(s) still pending)`)
      } else if (settlement && settlement.status === 'failed') {
        console.log(`\n❌ Swap ${swapId} failed`)
        logSettlement(settlement, swap)
        pendingSwaps.delete(swapId)
      }
      // If null or no payout yet, keep polling
      
    } catch (err) {
      console.error(`   Error checking ${swapId}: ${err instanceof Error ? err.message : err}`)
    }
  }
}
