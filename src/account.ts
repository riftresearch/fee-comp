import 'dotenv/config'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import * as bitcoin from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'

// Initialize ECC library for bitcoinjs-lib (required for Taproot/P2TR addresses)
bitcoin.initEccLib(ecc)

// Initialize ECPair with secp256k1
const ECPair = ECPairFactory(ecc)

// private keys
const ethPrivateKey = process.env.ETH_PRIVATE_KEY as `0x${string}` | undefined
const btcPrivateKey = process.env.BTC_PRIVATE_KEY

// destination addresses
export const BTC_ADDRESS = 'bc1qhnxxeylq3vtzfd6e9me0jtf5xg8jw89c2lav5t'
export const EVM_ADDRESS = '0xF627B6285759e4Fa9Ca1214c31F6748AfAAd766c'
const evmAccount = ethPrivateKey ? privateKeyToAccount(ethPrivateKey) : undefined

// BTC network
const btcNetwork = bitcoin.networks.bitcoin

// log config on startup
export function logAccountConfig() {
  const green = '\x1b[38;5;120m'
  const reset = '\x1b[0m'
  
  console.log(`${green}📍 Account Configuration:${reset}`)
  console.log(`${green}   EVM Address: ${EVM_ADDRESS}${reset}`)
  console.log(`${green}   BTC: ${BTC_ADDRESS}${reset}`)
  console.log(`${green}   Wallet Client: ${mainnetWalletClient ? '✓' : '✗'}${reset}`)
  console.log(`${green}   ETH Key: ${ethPrivateKey ? '✓' : '✗'}${reset}`)
  console.log(`${green}   BTC Key: ${btcPrivateKey ? '✓' : '✗'}${reset}`)
  console.log('')
}

// mainnet clients
const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
export const mainnetPublicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
export const mainnetWalletClient = evmAccount ? createWalletClient({ account: evmAccount, chain: mainnet, transport: http(rpcUrl) }) : undefined

// get destination address based on token
export function getDestinationAddress(outputToken: string): string {
  if (outputToken === 'BTC') {
    if (!BTC_ADDRESS) throw new Error('BTC_ADDRESS not set')
    return BTC_ADDRESS
  }
  const addr = EVM_ADDRESS || evmAccount?.address
  if (!addr) throw new Error('EVM_ADDRESS not set')
  return addr
}

// Token addresses on mainnet
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const CBBTC_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as const

// ERC20 ABI for balanceOf
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// Use shared price fetcher
import { getTokenPrices } from './prices.js'

interface BalanceResult {
  btc: string
  eth: string
  usdc: string
  cbbtc: string
  btcUsd: string
  ethUsd: string
  usdcUsd: string
  cbbtcUsd: string
  totalUsd: string
}

// Fetch all balances
export async function getBalances(): Promise<BalanceResult> {
  const [btcBalance, ethBalance, usdcBalance, cbbtcBalance, prices] = await Promise.all([
    // BTC balance from mempool.space
    fetch(`https://mempool.space/api/address/${BTC_ADDRESS}`)
      .then(r => r.json() as Promise<{ chain_stats: { funded_txo_sum: number; spent_txo_sum: number } }>)
      .then(data => {
        const sats = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum
        return sats / 100_000_000
      })
      .catch(() => 0),
    
    // ETH balance
    mainnetPublicClient.getBalance({ address: EVM_ADDRESS as `0x${string}` })
      .then(bal => Number(bal) / 1e18)
      .catch(() => 0),
    
    // USDC balance (6 decimals)
    mainnetPublicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [EVM_ADDRESS as `0x${string}`],
    })
      .then(bal => Number(bal) / 1e6)
      .catch(() => 0),
    
    // CBBTC balance (8 decimals)
    mainnetPublicClient.readContract({
      address: CBBTC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [EVM_ADDRESS as `0x${string}`],
    })
      .then(bal => Number(bal) / 1e8)
      .catch(() => 0),
    
    // Prices from shared helper
    getTokenPrices(),
  ])

  // Calculate USD values
  const btcUsd = btcBalance * prices.btc
  const ethUsd = ethBalance * prices.eth
  const usdcUsd = usdcBalance // USDC is 1:1
  const cbbtcUsd = cbbtcBalance * prices.btc // cbBTC tracks BTC price
  const totalUsd = btcUsd + ethUsd + usdcUsd + cbbtcUsd

  return {
    btc: btcBalance.toFixed(8),
    eth: ethBalance.toFixed(6),
    usdc: usdcBalance.toFixed(2),
    cbbtc: cbbtcBalance.toFixed(8),
    btcUsd: btcUsd.toFixed(2),
    ethUsd: ethUsd.toFixed(2),
    usdcUsd: usdcUsd.toFixed(2),
    cbbtcUsd: cbbtcUsd.toFixed(2),
    totalUsd: totalUsd.toFixed(2),
  }
}

// UTXO type
interface UTXO {
  txid: string
  vout: number
  value: number
}

// ============================================================================
// DYNAMIC FEE RATE ESTIMATION
// ============================================================================

// Fee rates from mempool.space API
interface FeeRates {
  fastestFee: number    // Next block (~10 min)
  halfHourFee: number   // ~30 min confirmation
  hourFee: number       // ~60 min confirmation
  economyFee: number    // Low priority
  minimumFee: number    // Network minimum
}

// Fee tier selection
export type FeeTier = 'economy' | 'normal' | 'priority'

// Fee rate cache
let feeRateCache: { rates: FeeRates; timestamp: number } | null = null
const FEE_RATE_CACHE_TTL = 60_000 // 1 minute

// Default fee rates if API fails
const DEFAULT_FEE_RATES: FeeRates = {
  fastestFee: 15,
  halfHourFee: 10,
  hourFee: 8,
  economyFee: 5,
  minimumFee: 2,
}

// Minimum fee floor to avoid stuck transactions
const MIN_FEE_RATE = 2

/**
 * Fetch recommended fee rates from mempool.space with caching
 */
async function getRecommendedFees(): Promise<FeeRates> {
  // Return cached rates if fresh
  if (feeRateCache && Date.now() - feeRateCache.timestamp < FEE_RATE_CACHE_TTL) {
    return feeRateCache.rates
  }

  try {
    const res = await fetch('https://mempool.space/api/v1/fees/recommended')
    if (!res.ok) throw new Error(`Mempool fee API error: ${res.status}`)
    
    const data = await res.json() as FeeRates
    
    // Ensure minimum fee floor
    const rates: FeeRates = {
      fastestFee: Math.max(data.fastestFee || DEFAULT_FEE_RATES.fastestFee, MIN_FEE_RATE),
      halfHourFee: Math.max(data.halfHourFee || DEFAULT_FEE_RATES.halfHourFee, MIN_FEE_RATE),
      hourFee: Math.max(data.hourFee || DEFAULT_FEE_RATES.hourFee, MIN_FEE_RATE),
      economyFee: Math.max(data.economyFee || DEFAULT_FEE_RATES.economyFee, MIN_FEE_RATE),
      minimumFee: Math.max(data.minimumFee || DEFAULT_FEE_RATES.minimumFee, MIN_FEE_RATE),
    }
    
    feeRateCache = { rates, timestamp: Date.now() }
    return rates
  } catch (err) {
    console.warn(`⚠️  Failed to fetch fee rates: ${err instanceof Error ? err.message : err}`)
    // Return cached or default rates
    if (feeRateCache) {
      return feeRateCache.rates
    }
    return DEFAULT_FEE_RATES
  }
}

/**
 * Get fee rate for a specific tier
 */
function getFeeRateForTier(rates: FeeRates, tier: FeeTier): number {
  switch (tier) {
    case 'priority':
      return rates.fastestFee
    case 'economy':
      return rates.economyFee
    case 'normal':
    default:
      return rates.halfHourFee
  }
}

// ============================================================================
// UTXO TRACKING SYSTEM (for concurrent transaction safety)
// ============================================================================

// Track locally reserved UTXOs (not yet in mempool)
const reservedUtxos = new Map<string, { expiresAt: number }>()

// Track UTXOs we've SPENT in broadcast transactions (even if not yet visible to external services)
// Key: "txid:vout", Value: { spentInTxid, spentAt }
const spentUtxos = new Map<string, { spentInTxid: string; spentAt: number }>()

// Track CHANGE UTXOs from our broadcast transactions (available for immediate use)
// These are outputs back to our address that we can spend even before they're confirmed
const pendingChangeUtxos = new Map<string, UTXO>()

// Reservation expiry time (60 seconds - covers broadcast delays)
const UTXO_RESERVATION_TTL = 60_000

// Spent UTXO expiry time (10 minutes - should be confirmed by then)
const SPENT_UTXO_TTL = 10 * 60_000

/**
 * Generate a unique key for a UTXO
 */
function utxoKey(utxo: UTXO): string {
  return `${utxo.txid}:${utxo.vout}`
}

/**
 * Reserve UTXOs for a transaction being built
 */
function reserveUtxos(utxos: UTXO[]): void {
  const expiresAt = Date.now() + UTXO_RESERVATION_TTL
  for (const utxo of utxos) {
    reservedUtxos.set(utxoKey(utxo), { expiresAt })
  }
}

/**
 * Release reserved UTXOs (after broadcast or failure)
 */
function releaseUtxos(utxos: UTXO[]): void {
  for (const utxo of utxos) {
    reservedUtxos.delete(utxoKey(utxo))
  }
}

/**
 * Check if a UTXO is currently reserved locally
 */
function isUtxoReserved(utxo: UTXO): boolean {
  const key = utxoKey(utxo)
  const reservation = reservedUtxos.get(key)
  
  if (!reservation) return false
  
  // Check if reservation has expired
  if (Date.now() > reservation.expiresAt) {
    reservedUtxos.delete(key)
    return false
  }
  
  return true
}

/**
 * Clean up expired UTXO reservations
 */
function cleanupExpiredReservations(): void {
  const now = Date.now()
  for (const [key, reservation] of reservedUtxos) {
    if (now > reservation.expiresAt) {
      reservedUtxos.delete(key)
    }
  }
}

/**
 * Check if a UTXO key is reserved locally
 */
function isUtxoKeyReserved(key: string): boolean {
  const reservation = reservedUtxos.get(key)
  if (!reservation) return false
  if (Date.now() > reservation.expiresAt) {
    reservedUtxos.delete(key)
    return false
  }
  return true
}

/**
 * Record that we've spent UTXOs in a broadcast transaction
 * This is called after successful broadcast so we KNOW these UTXOs are spent
 */
function recordSpentUtxos(utxos: UTXO[], spentInTxid: string): void {
  const spentAt = Date.now()
  for (const utxo of utxos) {
    const key = utxoKey(utxo)
    spentUtxos.set(key, { spentInTxid, spentAt })
    // Remove from reserved since it's now definitively spent
    reservedUtxos.delete(key)
  }
  console.log(`   📊 Recorded ${utxos.length} UTXO(s) as spent in tx ${spentInTxid.slice(0, 12)}...`)
}

/**
 * Record a pending change output from our transaction
 * This UTXO is available for spending even before confirmation
 */
function recordPendingChange(txid: string, vout: number, value: number): void {
  const key = `${txid}:${vout}`
  pendingChangeUtxos.set(key, { txid, vout, value })
  console.log(`   💰 Recorded pending change: ${value} sats at ${txid.slice(0, 12)}...:${vout}`)
}

/**
 * Check if a UTXO has been spent by us (even if not yet in external mempool)
 */
function isUtxoSpentByUs(key: string): { spent: boolean; spentInTxid?: string } {
  const spent = spentUtxos.get(key)
  if (!spent) return { spent: false }
  
  // Check if entry has expired (tx should be confirmed by now)
  if (Date.now() - spent.spentAt > SPENT_UTXO_TTL) {
    spentUtxos.delete(key)
    return { spent: false }
  }
  
  return { spent: true, spentInTxid: spent.spentInTxid }
}

/**
 * Clean up expired spent UTXO records
 */
function cleanupSpentUtxos(): void {
  const now = Date.now()
  for (const [key, record] of spentUtxos) {
    if (now - record.spentAt > SPENT_UTXO_TTL) {
      spentUtxos.delete(key)
    }
  }
  // Also clean up pending change after they should be confirmed
  for (const [key, utxo] of pendingChangeUtxos) {
    // Keep for 10 minutes, then they should be in confirmed UTXO set
    const recordTime = spentUtxos.get(key)?.spentAt
    if (recordTime && now - recordTime > SPENT_UTXO_TTL) {
      pendingChangeUtxos.delete(key)
    }
  }
}

/**
 * Get the count of UTXOs we've locally marked as spent
 */
export function getSpentUtxoCount(): number {
  return spentUtxos.size
}

/**
 * Get pending change UTXOs (for debugging/status)
 */
export function getPendingChangeCount(): number {
  return pendingChangeUtxos.size
}

/**
 * Initialize UTXO state from mempool on startup
 * This recovers our local state if we restart while transactions are pending
 */
export async function initializeUtxoStateFromMempool(): Promise<{ pendingTxCount: number; spentUtxoCount: number }> {
  if (!btcPrivateKey) {
    console.log(`   ⚠️ No BTC_PRIVATE_KEY - skipping UTXO state recovery`)
    return { pendingTxCount: 0, spentUtxoCount: 0 }
  }

  const keyPair = ECPair.fromWIF(btcPrivateKey, btcNetwork)
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: btcNetwork,
  })

  if (!address) {
    return { pendingTxCount: 0, spentUtxoCount: 0 }
  }

  console.log(`   🔍 Checking mempool for pending transactions from ${address.slice(0, 12)}...`)

  try {
    // Fetch pending mempool transactions
    const res = await fetch(`https://mempool.space/api/address/${address}/txs/mempool`)
    if (!res.ok) {
      console.log(`   ⚠️ Could not fetch mempool state: ${res.status}`)
      return { pendingTxCount: 0, spentUtxoCount: 0 }
    }

    interface MempoolTx {
      txid: string
      vin: { txid: string; vout: number }[]
      vout: { scriptpubkey_address?: string; value: number }[]
    }

    const pendingTxs = await res.json() as MempoolTx[]

    if (pendingTxs.length === 0) {
      console.log(`   ✅ No pending mempool transactions - clean state`)
      return { pendingTxCount: 0, spentUtxoCount: 0 }
    }

    console.log(`   ⚠️ Found ${pendingTxs.length} pending transaction(s) in mempool - recovering state...`)

    let totalSpentUtxos = 0

    for (const tx of pendingTxs) {
      console.log(`   📋 Pending tx: ${tx.txid.slice(0, 16)}...`)
      
      // Record all inputs as spent
      for (const input of tx.vin) {
        const key = `${input.txid}:${input.vout}`
        spentUtxos.set(key, { spentInTxid: tx.txid, spentAt: Date.now() })
        totalSpentUtxos++
      }

      // Record any change outputs back to our address
      for (let vout = 0; vout < tx.vout.length; vout++) {
        const output = tx.vout[vout]
        if (output.scriptpubkey_address === address) {
          const changeKey = `${tx.txid}:${vout}`
          pendingChangeUtxos.set(changeKey, {
            txid: tx.txid,
            vout,
            value: output.value,
          })
          console.log(`      💰 Change output: ${output.value} sats at :${vout}`)
        }
      }
    }

    console.log(`   📊 Recovered state: ${totalSpentUtxos} spent UTXO(s), ${pendingChangeUtxos.size} pending change(s)`)
    
    return { pendingTxCount: pendingTxs.length, spentUtxoCount: totalSpentUtxos }

  } catch (err) {
    console.log(`   ⚠️ Error recovering mempool state: ${err}`)
    return { pendingTxCount: 0, spentUtxoCount: 0 }
  }
}

// ============================================================================
// UTXO FETCHING
// ============================================================================

// Fetch UTXOs from mempool.space
async function getUtxos(address: string): Promise<UTXO[]> {
  const res = await fetch(`https://mempool.space/api/address/${address}/utxo`)
  if (!res.ok) throw new Error(`Failed to fetch UTXOs: ${res.statusText}`)
  return res.json() as Promise<UTXO[]>
}

// Fetch pending transactions to find UTXOs being spent
async function getPendingSpends(address: string): Promise<Set<string>> {
  const spentUtxos = new Set<string>()
  try {
    const res = await fetch(`https://mempool.space/api/address/${address}/txs/mempool`)
    if (!res.ok) return spentUtxos
    const txs = await res.json() as { vin: { txid: string; vout: number }[] }[]
    for (const tx of txs) {
      for (const input of tx.vin) {
        spentUtxos.add(`${input.txid}:${input.vout}`)
      }
    }
  } catch {
    // Ignore errors, just return empty set
  }
  return spentUtxos
}

// Broadcast transaction
async function broadcastTx(txHex: string): Promise<string> {
  const res = await fetch('https://mempool.space/api/tx', {
    method: 'POST',
    body: txHex,
  })
  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Broadcast failed: ${error}`)
  }
  return res.text() // Returns txid
}

// ============================================================================
// MEMPOOL CONFIRMATION WAITING
// ============================================================================

// Configuration for mempool confirmation polling
const MEMPOOL_POLL_INTERVAL_MS = 2000 // Poll every 2 seconds
const MEMPOOL_MAX_WAIT_MS = 60_000 // Max 60 seconds wait
const MEMPOOL_MIN_WAIT_MS = 3000 // Minimum wait before first check

/**
 * Wait for a transaction to be visible in mempool.space
 * This ensures the tx has propagated before we request new quotes from external services
 * Returns true if tx is visible, throws if timeout
 */
export async function waitForMempoolConfirmation(txid: string): Promise<boolean> {
  console.log(`   ⏳ Waiting for tx ${txid.slice(0, 12)}... to appear in mempool`)
  
  const startTime = Date.now()
  
  // Wait a minimum time before first check (mempool propagation delay)
  await new Promise(resolve => setTimeout(resolve, MEMPOOL_MIN_WAIT_MS))
  
  while (Date.now() - startTime < MEMPOOL_MAX_WAIT_MS) {
    try {
      const res = await fetch(`https://mempool.space/api/tx/${txid}`)
      if (res.ok) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`   ✅ Tx visible in mempool after ${elapsed}s`)
        return true
      }
      // 404 means not yet visible - keep polling
    } catch {
      // Network error - keep polling
    }
    
    await new Promise(resolve => setTimeout(resolve, MEMPOOL_POLL_INTERVAL_MS))
  }
  
  // Timeout - but don't fail hard, just warn
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.warn(`   ⚠️ Tx not visible in mempool after ${elapsed}s (may still propagate)`)
  return false
}

/**
 * Check if a transaction is visible in mempool (non-blocking, single check)
 */
export async function isTxInMempool(txid: string): Promise<boolean> {
  try {
    const res = await fetch(`https://mempool.space/api/tx/${txid}`)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Wait for all pending transactions from an address to be visible in mempool
 * Useful before requesting quotes to ensure external services see our latest state
 */
export async function waitForPendingTxsVisible(address: string): Promise<void> {
  const pendingSpends = await getPendingSpends(address)
  if (pendingSpends.size === 0) return
  
  console.log(`   📡 Checking ${pendingSpends.size} pending tx(s) are visible in mempool...`)
  // We just need the pending spends to be there - they already are if getPendingSpends found them
  // This function is mainly a sanity check
}

// ============================================================================
// PSBT VALIDATION (for external PSBTs like from Relay)
// ============================================================================

interface PsbtUtxoConflict {
  txid: string
  vout: number
  reason: 'spent_locally' | 'mempool' | 'reserved'
  spentInTxid?: string // If spent_locally, which tx spent it
}

/**
 * Extract UTXO inputs from a PSBT for reservation purposes
 */
function extractUtxosFromPsbt(psbtHex: string): UTXO[] {
  const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: btcNetwork })
  const utxos: UTXO[] = []
  
  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.txInputs[i]
    // txid is stored as reversed buffer in bitcoinjs
    const txid = Buffer.from(input.hash).reverse().toString('hex')
    const vout = input.index
    // Value is not strictly needed for reservation, but we can try to get it from witnessUtxo
    const witnessUtxo = psbt.data.inputs[i]?.witnessUtxo
    const value = witnessUtxo ? Number(witnessUtxo.value) : 0
    utxos.push({ txid, vout, value })
  }
  
  return utxos
}

/**
 * Reserve UTXOs from an external PSBT (like from Relay)
 * This prevents concurrent operations from using the same UTXOs
 */
export function reservePsbtUtxos(psbtHex: string): UTXO[] {
  const utxos = extractUtxosFromPsbt(psbtHex)
  reserveUtxos(utxos)
  console.log(`   🔒 Reserved ${utxos.length} UTXO(s) from PSBT`)
  return utxos
}

/**
 * Release UTXOs that were reserved from a PSBT
 */
export function releasePsbtUtxos(utxos: UTXO[]): void {
  releaseUtxos(utxos)
  console.log(`   🔓 Released ${utxos.length} UTXO(s)`)
}

/**
 * Validate that a PSBT's input UTXOs are still available
 * Returns array of conflicts (empty if all inputs are valid)
 * 
 * Priority order:
 * 1. Check our LOCAL spent UTXO list (authoritative - we know what we've spent)
 * 2. Check local reservations
 * 3. Check mempool.space (fallback for external detection)
 */
export async function validatePsbtUtxos(psbtHex: string): Promise<PsbtUtxoConflict[]> {
  // Clean up expired entries
  cleanupExpiredReservations()
  cleanupSpentUtxos()
  
  // Parse the PSBT
  const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: btcNetwork })
  
  // Extract input txid:vout pairs from the PSBT
  const inputUtxos: { txid: string; vout: number; key: string }[] = []
  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.txInputs[i]
    // txid is stored as reversed buffer in bitcoinjs
    const txid = Buffer.from(input.hash).reverse().toString('hex')
    const vout = input.index
    inputUtxos.push({ txid, vout, key: `${txid}:${vout}` })
  }
  
  // Check each input for conflicts - LOCAL FIRST (no network calls needed)
  const conflicts: PsbtUtxoConflict[] = []
  let hasLocalConflict = false
  
  for (const utxo of inputUtxos) {
    // 1. Check if we've already spent this UTXO (our local knowledge)
    const spentCheck = isUtxoSpentByUs(utxo.key)
    if (spentCheck.spent) {
      conflicts.push({ 
        txid: utxo.txid, 
        vout: utxo.vout, 
        reason: 'spent_locally',
        spentInTxid: spentCheck.spentInTxid
      })
      hasLocalConflict = true
      continue
    }
    
    // 2. Check if locally reserved
    if (isUtxoKeyReserved(utxo.key)) {
      conflicts.push({ txid: utxo.txid, vout: utxo.vout, reason: 'reserved' })
      hasLocalConflict = true
    }
  }
  
  // If we found local conflicts, return immediately (no need to check mempool)
  if (hasLocalConflict) {
    return conflicts
  }
  
  // 3. Fallback: Check mempool.space for spends we might not know about
  const keyPair = ECPair.fromWIF(btcPrivateKey!, btcNetwork)
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: btcNetwork,
  })
  
  const pendingSpends = address ? await getPendingSpends(address) : new Set<string>()
  
  for (const utxo of inputUtxos) {
    if (pendingSpends.has(utxo.key)) {
      conflicts.push({ txid: utxo.txid, vout: utxo.vout, reason: 'mempool' })
    }
  }
  
  return conflicts
}

// Send Bitcoin with dynamic fee estimation and UTXO locking
export async function sendBitcoin(
  recipient: string,
  amountSats: bigint,
  feeTier: FeeTier = 'normal'
): Promise<string> {
  console.log(`📤 BTC send: ${amountSats} sats to ${recipient}`)

  if (!btcPrivateKey) {
    throw new Error('BTC_PRIVATE_KEY not set')
  }

  // Clean up expired UTXO reservations
  cleanupExpiredReservations()

  // Parse private key (WIF format)
  const keyPair = ECPair.fromWIF(btcPrivateKey, btcNetwork)
  
  // Get our address from private key (p2wpkh - native segwit)
  const { address: sourceAddress } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: btcNetwork,
  })
  
  if (!sourceAddress) throw new Error('Could not derive source address')
  console.log(`   From: ${sourceAddress}`)

  // Fetch UTXOs, pending spends, and recommended fees in parallel
  const [allUtxos, pendingSpends, feeRates] = await Promise.all([
    getUtxos(sourceAddress),
    getPendingSpends(sourceAddress),
    getRecommendedFees(),
  ])
  
  // Filter out UTXOs that are:
  // 1. Being spent in pending mempool transactions
  // 2. Locally reserved by concurrent transactions
  // 3. Already spent by us (tracked locally after broadcast)
  const availableUtxos = allUtxos.filter(u => {
    const key = `${u.txid}:${u.vout}`
    if (pendingSpends.has(key)) return false
    if (isUtxoReserved(u)) return false
    if (isUtxoSpentByUs(key).spent) return false
    return true
  })
  
  if (allUtxos.length === 0) {
    throw new Error(`No UTXOs found for ${sourceAddress}`)
  }
  
  const mempoolPendingCount = allUtxos.filter(u => pendingSpends.has(`${u.txid}:${u.vout}`)).length
  const localReservedCount = allUtxos.filter(u => isUtxoReserved(u)).length
  const locallySpentCount = allUtxos.filter(u => isUtxoSpentByUs(`${u.txid}:${u.vout}`).spent).length
  
  if (availableUtxos.length === 0) {
    throw new Error(
      `No available UTXOs. Total: ${allUtxos.length}, ` +
      `mempool pending: ${mempoolPendingCount}, ` +
      `locally reserved: ${localReservedCount}, ` +
      `locally spent: ${locallySpentCount}. ` +
      `Wait for confirmation or reservation expiry.`
    )
  }
  
  const totalAvailable = availableUtxos.reduce((s, u) => s + u.value, 0)
  console.log(`   UTXOs: ${availableUtxos.length} available (${mempoolPendingCount} mempool pending, ${localReservedCount} reserved, ${locallySpentCount} spent)`)
  console.log(`   Total available: ${totalAvailable} sats`)

  // Get dynamic fee rate based on tier
  const feeRate = getFeeRateForTier(feeRates, feeTier)
  console.log(`   Fee rates: fastest=${feeRates.fastestFee}, halfHour=${feeRates.halfHourFee}, economy=${feeRates.economyFee}`)
  console.log(`   Using ${feeTier} tier: ${feeRate} sat/vB`)
  
  // Calculate vsize: ~10.5 overhead + 68 per input + 31 per output (p2wpkh)
  const calcVsize = (inputs: number, outputs: number) => Math.ceil(10.5 + (68 * inputs) + (31 * outputs))
  
  // Select UTXOs with proper fee calculation
  let selectedUtxos: UTXO[] = []
  let totalInput = 0
  
  // Sort UTXOs by value descending to minimize inputs needed
  const sortedUtxos = [...availableUtxos].sort((a, b) => b.value - a.value)
  
  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo)
    totalInput += utxo.value
    
    // Estimate fee with current inputs (2 outputs: recipient + change)
    const estimatedVsize = calcVsize(selectedUtxos.length, 2)
    const estimatedFee = feeRate * estimatedVsize
    const totalNeeded = Number(amountSats) + estimatedFee
    
    if (totalInput >= totalNeeded) break
  }
  
  // Final fee calculation
  const vsize = calcVsize(selectedUtxos.length, 2)
  const fee = feeRate * vsize

  if (totalInput < Number(amountSats) + fee) {
    throw new Error(`Insufficient funds: have ${totalInput}, need ${Number(amountSats) + fee}`)
  }
  
  console.log(`   Inputs: ${selectedUtxos.length}, vsize: ~${vsize}, fee: ${fee} sats (${feeRate} sat/vB)`)

  // Reserve selected UTXOs to prevent concurrent transactions from using them
  reserveUtxos(selectedUtxos)

  try {
    // Build transaction
    const psbt = new bitcoin.Psbt({ network: btcNetwork })

    // Add inputs
    for (const utxo of selectedUtxos) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: Buffer.from(keyPair.publicKey),
            network: btcNetwork,
          }).output!,
          value: BigInt(utxo.value),
        },
      })
    }

    // Add recipient output
    psbt.addOutput({
      address: recipient,
      value: amountSats,
    })

    // Add change output if needed
    const change = totalInput - Number(amountSats) - fee
    if (change > 546) { // dust threshold
      psbt.addOutput({
        address: sourceAddress,
        value: BigInt(change),
      })
    }

    // Sign all inputs
    for (let i = 0; i < selectedUtxos.length; i++) {
      psbt.signInput(i, keyPair)
    }

    // Finalize and extract
    psbt.finalizeAllInputs()
    const tx = psbt.extractTransaction()
    const txHex = tx.toHex()
    const txid = tx.getId()

    const actualVsize = tx.virtualSize()
    const actualFeeRate = (fee / actualVsize).toFixed(1)
    console.log(`   Tx ID: ${txid}`)
    console.log(`   Fee: ${fee} sats (${actualFeeRate} sat/vB actual, ${actualVsize} vB)`)

    // Broadcast
    const broadcastedTxid = await broadcastTx(txHex)
    console.log(`   ✅ Broadcasted: ${broadcastedTxid}`)

    // Record spent UTXOs for local tracking (prevents UTXO conflicts before mempool propagation)
    recordSpentUtxos(selectedUtxos, broadcastedTxid)
    
    // Record change output if we have one (available for immediate spending)
    if (change > 546) {
      recordPendingChange(broadcastedTxid, 1, change) // Change is output index 1
    }
    
    return broadcastedTxid
  } catch (err) {
    // Release UTXOs on failure so they can be used by other transactions
    releaseUtxos(selectedUtxos)
    throw err
  }
}

// THORChain dust threshold for BTC (minimum amount to process swap)
const THORCHAIN_BTC_DUST_THRESHOLD = 10000n // 10k sats

// Send Bitcoin with OP_RETURN memo (for THORChain swaps)
// Output order is critical for THORChain:
//   VOUT0: Asgard vault (recipient)
//   VOUT1: Change back to sender (VIN0) - THORChain identifies user by VIN0 for refunds
//   VOUT2: OP_RETURN with memo
export async function sendBitcoinWithMemo(
  recipient: string,
  amountSats: bigint,
  memo: string,
  feeTier: FeeTier = 'normal'
): Promise<string> {
  console.log(`📤 BTC send with memo: ${amountSats} sats to ${recipient}`)
  console.log(`   Memo: ${memo}`)

  if (!btcPrivateKey) {
    throw new Error('BTC_PRIVATE_KEY not set')
  }

  // THORChain requires swap amount to exceed dust threshold (10k sats for BTC)
  if (amountSats <= THORCHAIN_BTC_DUST_THRESHOLD) {
    throw new Error(`Amount ${amountSats} sats is below THORChain dust threshold (${THORCHAIN_BTC_DUST_THRESHOLD} sats)`)
  }

  // Validate memo length (BTC OP_RETURN max is 80 bytes)
  const memoBuffer = Buffer.from(memo, 'utf8')
  if (memoBuffer.length > 80) {
    throw new Error(`Memo too long: ${memoBuffer.length} bytes (max 80)`)
  }

  // Clean up expired UTXO reservations
  cleanupExpiredReservations()

  // Parse private key (WIF format)
  const keyPair = ECPair.fromWIF(btcPrivateKey, btcNetwork)
  
  // Get our address from private key (p2wpkh - native segwit)
  const { address: sourceAddress } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: btcNetwork,
  })
  
  if (!sourceAddress) throw new Error('Could not derive source address')
  console.log(`   From: ${sourceAddress}`)

  // Fetch UTXOs, pending spends, and recommended fees in parallel
  const [allUtxos, pendingSpends, feeRates] = await Promise.all([
    getUtxos(sourceAddress),
    getPendingSpends(sourceAddress),
    getRecommendedFees(),
  ])
  
  // Filter out UTXOs that are pending or reserved
  const availableUtxos = allUtxos.filter(u => {
    const key = `${u.txid}:${u.vout}`
    if (pendingSpends.has(key)) return false
    if (isUtxoReserved(u)) return false
    if (isUtxoSpentByUs(key).spent) return false
    return true
  })
  
  if (availableUtxos.length === 0) {
    throw new Error(`No available UTXOs for ${sourceAddress}`)
  }
  
  const totalAvailable = availableUtxos.reduce((s, u) => s + u.value, 0)
  console.log(`   UTXOs: ${availableUtxos.length} available (${totalAvailable} sats total)`)

  // Get dynamic fee rate based on tier
  const feeRate = getFeeRateForTier(feeRates, feeTier)
  console.log(`   Fee rate: ${feeRate} sat/vB (${feeTier})`)
  
  // Calculate vsize: ~10.5 overhead + 68 per input + 31 per p2wpkh output + OP_RETURN size
  // OP_RETURN output: 1 (value) + 1-2 (script length) + 1 (OP_RETURN) + 1 (push) + memo length
  const opReturnSize = 1 + 1 + 1 + 1 + memoBuffer.length + 8 // +8 for value (0 sats)
  const calcVsize = (inputs: number, regularOutputs: number) => 
    Math.ceil(10.5 + (68 * inputs) + (31 * regularOutputs) + opReturnSize)
  
  // Select UTXOs with proper fee calculation
  let selectedUtxos: UTXO[] = []
  let totalInput = 0
  
  // Sort UTXOs by value descending to minimize inputs needed
  const sortedUtxos = [...availableUtxos].sort((a, b) => b.value - a.value)
  
  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo)
    totalInput += utxo.value
    
    // 3 outputs: recipient, change, OP_RETURN (but OP_RETURN counted separately)
    const estimatedVsize = calcVsize(selectedUtxos.length, 2)
    const estimatedFee = feeRate * estimatedVsize
    const totalNeeded = Number(amountSats) + estimatedFee
    
    if (totalInput >= totalNeeded) break
  }
  
  // Final fee calculation
  const vsize = calcVsize(selectedUtxos.length, 2)
  const fee = Math.ceil(feeRate * vsize)

  if (totalInput < Number(amountSats) + fee) {
    throw new Error(`Insufficient funds: have ${totalInput}, need ${Number(amountSats) + fee}`)
  }
  
  console.log(`   Inputs: ${selectedUtxos.length}, vsize: ~${vsize}, fee: ${fee} sats`)

  // Reserve selected UTXOs to prevent concurrent transactions from using them
  reserveUtxos(selectedUtxos)

  try {
    // Build transaction
    const psbt = new bitcoin.Psbt({ network: btcNetwork })

    // Add inputs
    for (const utxo of selectedUtxos) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: Buffer.from(keyPair.publicKey),
            network: btcNetwork,
          }).output!,
          value: BigInt(utxo.value),
        },
      })
    }

    // Output 1 (VOUT0): Asgard vault - MUST be first output
    psbt.addOutput({
      address: recipient,
      value: amountSats,
    })

    // Output 2 (VOUT1): Change back to sender (VIN0 address)
    // THORChain identifies user by VIN0 for refunds - change MUST go back to same address
    const change = totalInput - Number(amountSats) - fee
    if (change > 546) { // 546 = BTC network dust threshold
      psbt.addOutput({
        address: sourceAddress, // Same as VIN0
        value: BigInt(change),
      })
    }

    // Output 3 (VOUT2): OP_RETURN with memo - specifies swap intent
    const opReturnScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_RETURN,
      memoBuffer,
    ])
    psbt.addOutput({
      script: opReturnScript,
      value: 0n,
    })

    // Sign all inputs
    for (let i = 0; i < selectedUtxos.length; i++) {
      psbt.signInput(i, keyPair)
    }

    // Finalize and extract
    psbt.finalizeAllInputs()
    const tx = psbt.extractTransaction()
    const txHex = tx.toHex()
    const txid = tx.getId()

    const actualVsize = tx.virtualSize()
    const actualFeeRate = (fee / actualVsize).toFixed(1)
    console.log(`   Tx ID: ${txid}`)
    console.log(`   Fee: ${fee} sats (${actualFeeRate} sat/vB actual, ${actualVsize} vB)`)

    // Broadcast
    const broadcastedTxid = await broadcastTx(txHex)
    console.log(`   ✅ Broadcasted: ${broadcastedTxid}`)

    // Record spent UTXOs
    recordSpentUtxos(selectedUtxos, broadcastedTxid)
    
    // Record change output if we have one
    if (change > 546) {
      // Change is output index 1 (after recipient)
      recordPendingChange(broadcastedTxid, 1, change)
    }
    
    return broadcastedTxid
  } catch (err) {
    // Release UTXOs on failure so they can be used by other transactions
    releaseUtxos(selectedUtxos)
    throw err
  }
}

/**
 * Sign and broadcast a PSBT provided by an external service (like Relay)
 * The PSBT should already have the inputs and outputs defined
 * 
 * This function:
 * 1. Validates UTXO availability (checks mempool and local reservations)
 * 2. Reserves the UTXOs to prevent concurrent conflicts
 * 3. Signs and broadcasts the transaction
 * 4. Keeps UTXOs reserved (they're now in mempool)
 * 5. Releases UTXOs on failure
 */
export async function signAndBroadcastPsbt(psbtHex: string): Promise<string> {
  console.log(`📝 Signing external PSBT...`)
  
  const btcPrivateKey = process.env.BTC_PRIVATE_KEY
  if (!btcPrivateKey) {
    throw new Error('BTC_PRIVATE_KEY not set')
  }
  
  // Clean up expired reservations first
  cleanupExpiredReservations()
  
  // Validate UTXO availability before signing (prevents cryptic RBF errors)
  const conflicts = await validatePsbtUtxos(psbtHex)
  if (conflicts.length > 0) {
    // Build detailed error message
    const details = conflicts.map(c => {
      const utxoId = `${c.txid.slice(0, 8)}...:${c.vout}`
      if (c.reason === 'spent_locally' && c.spentInTxid) {
        return `${utxoId} (spent in ${c.spentInTxid.slice(0, 12)}...)`
      }
      return `${utxoId} (${c.reason})`
    }).join(', ')
    
    // Include the spending tx in the error for relay.ts to use
    const spentInTx = conflicts.find(c => c.spentInTxid)?.spentInTxid
    const error = new Error(`UTXO conflict: ${conflicts.length} input(s) unavailable - ${details}`)
    ;(error as any).spentInTxid = spentInTx
    ;(error as any).isLocalConflict = conflicts.some(c => c.reason === 'spent_locally')
    throw error
  }
  
  // Extract and reserve UTXOs from the PSBT to prevent concurrent operations
  const reservedUtxosList = extractUtxosFromPsbt(psbtHex)
  reserveUtxos(reservedUtxosList)
  console.log(`   🔒 Reserved ${reservedUtxosList.length} UTXO(s) for broadcast`)
  
  try {
    // Parse private key
    const keyPair = ECPair.fromWIF(btcPrivateKey, btcNetwork)
    
    // Parse the PSBT from hex
    const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: btcNetwork })
    
    console.log(`   Inputs: ${psbt.inputCount}, Outputs: ${psbt.txOutputs.length}`)
    
    // Sign all inputs
    for (let i = 0; i < psbt.inputCount; i++) {
      try {
        psbt.signInput(i, keyPair)
        console.log(`   ✓ Signed input ${i}`)
      } catch (err) {
        console.log(`   ⚠️ Could not sign input ${i}: ${err}`)
      }
    }
    
    // Finalize all inputs
    psbt.finalizeAllInputs()
    
    // Extract and broadcast
    const tx = psbt.extractTransaction()
    const txHex = tx.toHex()
    const txid = tx.getId()
    
    console.log(`   Tx ID: ${txid}`)
    console.log(`   Broadcasting...`)
    
    const broadcastedTxid = await broadcastTx(txHex)
    console.log(`   ✅ Broadcasted: ${broadcastedTxid}`)
    
    // IMPORTANT: Record these UTXOs as definitively SPENT by us
    // This is our authoritative local state - no need to wait for mempool propagation
    recordSpentUtxos(reservedUtxosList, broadcastedTxid)
    
    // Find and record any change output back to our address
    const { address: ourAddress } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: btcNetwork,
    })
    
    if (ourAddress) {
      // Check each output to see if it's back to our address (change)
      for (let vout = 0; vout < psbt.txOutputs.length; vout++) {
        const output = psbt.txOutputs[vout]
        try {
          const outputAddress = bitcoin.address.fromOutputScript(output.script, btcNetwork)
          if (outputAddress === ourAddress) {
            // This is a change output back to us - record it as available
            recordPendingChange(broadcastedTxid, vout, Number(output.value))
          }
        } catch {
          // Could not decode output address - skip
        }
      }
    }
    
    return broadcastedTxid
  } catch (err) {
    // Release UTXOs on failure so they can be used by other transactions
    releaseUtxos(reservedUtxosList)
    console.log(`   🔓 Released ${reservedUtxosList.length} UTXO(s) due to error`)
    throw err
  }
}

// ============================================================================
// BUILD TX FROM RELAY PSBT OUTPUTS
// ============================================================================

interface RelayPsbtOutput {
  script: Buffer
  value: bigint
  address?: string  // Decoded address if available
  isOpReturn: boolean
}

/**
 * Parse a Relay PSBT and extract its outputs.
 * We'll use these outputs to build our own transaction with fresh UTXOs.
 */
function extractOutputsFromPsbt(psbtHex: string): RelayPsbtOutput[] {
  const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: btcNetwork })
  const outputs: RelayPsbtOutput[] = []
  
  for (const output of psbt.txOutputs) {
    const isOpReturn = output.script[0] === 0x6a // OP_RETURN opcode
    let address: string | undefined
    
    if (!isOpReturn) {
      try {
        address = bitcoin.address.fromOutputScript(output.script, btcNetwork)
      } catch {
        // Could not decode address
      }
    }
    
    outputs.push({
      script: Buffer.from(output.script),
      value: BigInt(output.value),
      address,
      isOpReturn,
    })
  }
  
  return outputs
}

/**
 * Build and broadcast a transaction using Relay's PSBT outputs but our own UTXOs.
 * 
 * This solves the UTXO conflict problem: Relay constructs PSBTs with stale UTXO info,
 * but we only need their outputs (deposit address + OP_RETURN with order ID).
 * We select our own fresh UTXOs for the inputs.
 * 
 * @param psbtHex - The PSBT hex from Relay's quote response
 * @param feeTier - Fee tier to use for UTXO selection
 * @returns The broadcast transaction ID
 */
export async function buildTxFromRelayOutputs(
  psbtHex: string,
  feeTier: FeeTier = 'normal'
): Promise<string> {
  console.log(`🔧 Building TX from Relay outputs with our own UTXOs...`)
  
  if (!btcPrivateKey) {
    throw new Error('BTC_PRIVATE_KEY not set')
  }
  
  // Clean up expired reservations
  cleanupExpiredReservations()
  cleanupSpentUtxos()
  
  // Parse private key
  const keyPair = ECPair.fromWIF(btcPrivateKey, btcNetwork)
  
  // Get our address
  const { address: sourceAddress } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: btcNetwork,
  })
  
  if (!sourceAddress) throw new Error('Could not derive source address')
  
  // Extract outputs from Relay's PSBT
  const relayOutputs = extractOutputsFromPsbt(psbtHex)
  console.log(`   📋 Extracted ${relayOutputs.length} output(s) from Relay PSBT:`)
  
  // Log and calculate total output value (excluding change back to us)
  let totalOutputValue = 0n
  const outputsToInclude: RelayPsbtOutput[] = []
  
  for (const out of relayOutputs) {
    if (out.isOpReturn) {
      console.log(`      - OP_RETURN (${out.script.length} bytes)`)
      outputsToInclude.push(out)
    } else if (out.address === sourceAddress) {
      // Skip Relay's change output - we'll calculate our own
      console.log(`      - Change to us: ${out.value} sats (skipping, will recalculate)`)
    } else {
      console.log(`      - ${out.address}: ${out.value} sats`)
      outputsToInclude.push(out)
      totalOutputValue += out.value
    }
  }
  
  console.log(`   💰 Total to send: ${totalOutputValue} sats`)
  
  // Fetch our UTXOs
  const [allUtxos, pendingSpends, feeRates] = await Promise.all([
    getUtxos(sourceAddress),
    getPendingSpends(sourceAddress),
    getRecommendedFees(),
  ])
  
  // Filter to available UTXOs (not in mempool, not reserved, not spent by us)
  const availableUtxos = allUtxos.filter(u => {
    const key = `${u.txid}:${u.vout}`
    if (pendingSpends.has(key)) return false
    if (isUtxoReserved(u)) return false
    if (isUtxoSpentByUs(key).spent) return false
    return true
  })
  
  if (availableUtxos.length === 0) {
    throw new Error(`No available UTXOs for ${sourceAddress}`)
  }
  
  const totalAvailable = availableUtxos.reduce((s, u) => s + u.value, 0)
  console.log(`   📦 UTXOs: ${availableUtxos.length} available (${totalAvailable} sats total)`)
  
  // Get fee rate
  const feeRate = getFeeRateForTier(feeRates, feeTier)
  console.log(`   ⛽ Fee rate: ${feeRate} sat/vB (${feeTier})`)
  
  // Calculate vsize: ~10.5 overhead + 68 per input + 31 per p2wpkh output + actual OP_RETURN size
  const opReturnSize = outputsToInclude.filter(o => o.isOpReturn).reduce((s, o) => s + o.script.length + 9, 0)
  const calcVsize = (inputs: number, regularOutputs: number) => 
    Math.ceil(10.5 + (68 * inputs) + (31 * regularOutputs) + opReturnSize)
  
  // Select UTXOs
  let selectedUtxos: UTXO[] = []
  let totalInput = 0
  const sortedUtxos = [...availableUtxos].sort((a, b) => b.value - a.value)
  
  // We'll have: Relay outputs + our change output
  const numRegularOutputs = outputsToInclude.filter(o => !o.isOpReturn).length + 1 // +1 for change
  
  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo)
    totalInput += utxo.value
    
    const estimatedVsize = calcVsize(selectedUtxos.length, numRegularOutputs)
    const estimatedFee = feeRate * estimatedVsize
    const totalNeeded = Number(totalOutputValue) + estimatedFee
    
    if (totalInput >= totalNeeded) break
  }
  
  // Final fee calculation
  const vsize = calcVsize(selectedUtxos.length, numRegularOutputs)
  const fee = Math.ceil(feeRate * vsize)
  
  if (totalInput < Number(totalOutputValue) + fee) {
    throw new Error(`Insufficient funds: have ${totalInput}, need ${Number(totalOutputValue) + fee}`)
  }
  
  const change = totalInput - Number(totalOutputValue) - fee
  console.log(`   🔢 Inputs: ${selectedUtxos.length}, Fee: ${fee} sats, Change: ${change} sats`)
  
  // Reserve UTXOs
  reserveUtxos(selectedUtxos)
  
  try {
    // Build the transaction
    const psbt = new bitcoin.Psbt({ network: btcNetwork })
    
    // Add OUR inputs
    for (const utxo of selectedUtxos) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: Buffer.from(keyPair.publicKey),
            network: btcNetwork,
          }).output!,
          value: BigInt(utxo.value),
        },
      })
    }
    
    // Add RELAY's outputs (deposit address + OP_RETURN)
    for (const out of outputsToInclude) {
      if (out.isOpReturn) {
        // OP_RETURN output - add using raw script
        psbt.addOutput({
          script: out.script,
          value: 0n,
        })
      } else if (out.address) {
        // Regular output to Relay's deposit address
        psbt.addOutput({
          address: out.address,
          value: out.value,
        })
      }
    }
    
    // Add OUR change output (if above dust threshold)
    if (change > 546) {
      psbt.addOutput({
        address: sourceAddress,
        value: BigInt(change),
      })
    }
    
    // Sign all inputs
    for (let i = 0; i < selectedUtxos.length; i++) {
      psbt.signInput(i, keyPair)
    }
    
    // Finalize and extract
    psbt.finalizeAllInputs()
    const tx = psbt.extractTransaction()
    const txHex = tx.toHex()
    const txid = tx.getId()
    
    const actualVsize = tx.virtualSize()
    const actualFeeRate = (fee / actualVsize).toFixed(1)
    console.log(`   📝 Tx ID: ${txid}`)
    console.log(`   ⛽ Fee: ${fee} sats (${actualFeeRate} sat/vB actual, ${actualVsize} vB)`)
    
    // Broadcast
    const broadcastedTxid = await broadcastTx(txHex)
    console.log(`   ✅ Broadcasted: ${broadcastedTxid}`)
    
    // Record spent UTXOs
    recordSpentUtxos(selectedUtxos, broadcastedTxid)
    
    // Record change output if we have one
    if (change > 546) {
      const changeVout = psbt.txOutputs.length - 1 // Change is last output
      recordPendingChange(broadcastedTxid, changeVout, change)
    }
    
    return broadcastedTxid
    
  } catch (err) {
    releaseUtxos(selectedUtxos)
    throw err
  }
}
