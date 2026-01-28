import 'dotenv/config'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import * as bitcoin from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'

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
// UTXO LOCKING SYSTEM (for concurrent transaction safety)
// ============================================================================

// Track locally reserved UTXOs (not yet in mempool)
const reservedUtxos = new Map<string, { expiresAt: number }>()

// Reservation expiry time (60 seconds - covers broadcast delays)
const UTXO_RESERVATION_TTL = 60_000

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
// PSBT VALIDATION (for external PSBTs like from Relay)
// ============================================================================

interface PsbtUtxoConflict {
  txid: string
  vout: number
  reason: 'mempool' | 'reserved'
}

/**
 * Validate that a PSBT's input UTXOs are still available
 * Returns array of conflicts (empty if all inputs are valid)
 */
export async function validatePsbtUtxos(psbtHex: string): Promise<PsbtUtxoConflict[]> {
  // Clean up expired reservations first
  cleanupExpiredReservations()
  
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
  
  // Get our BTC address to check pending spends
  const keyPair = ECPair.fromWIF(btcPrivateKey!, btcNetwork)
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: btcNetwork,
  })
  
  // Fetch pending spends from mempool
  const pendingSpends = address ? await getPendingSpends(address) : new Set<string>()
  
  // Check each input for conflicts
  const conflicts: PsbtUtxoConflict[] = []
  
  for (const utxo of inputUtxos) {
    // Check if spent in mempool
    if (pendingSpends.has(utxo.key)) {
      conflicts.push({ txid: utxo.txid, vout: utxo.vout, reason: 'mempool' })
      continue
    }
    
    // Check if locally reserved
    if (isUtxoKeyReserved(utxo.key)) {
      conflicts.push({ txid: utxo.txid, vout: utxo.vout, reason: 'reserved' })
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
  const availableUtxos = allUtxos.filter(u => 
    !pendingSpends.has(`${u.txid}:${u.vout}`) && !isUtxoReserved(u)
  )
  
  if (allUtxos.length === 0) {
    throw new Error(`No UTXOs found for ${sourceAddress}`)
  }
  
  const mempoolPendingCount = allUtxos.filter(u => pendingSpends.has(`${u.txid}:${u.vout}`)).length
  const localReservedCount = allUtxos.filter(u => isUtxoReserved(u)).length
  
  if (availableUtxos.length === 0) {
    throw new Error(
      `No available UTXOs. Total: ${allUtxos.length}, ` +
      `mempool pending: ${mempoolPendingCount}, ` +
      `locally reserved: ${localReservedCount}. ` +
      `Wait for confirmation or reservation expiry.`
    )
  }
  
  const totalAvailable = availableUtxos.reduce((s, u) => s + u.value, 0)
  console.log(`   UTXOs: ${availableUtxos.length} available (${mempoolPendingCount} mempool pending, ${localReservedCount} locally reserved)`)
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

    // Keep UTXOs reserved (they're now in mempool, will be filtered by getPendingSpends)
    // Reservations will auto-expire after TTL as a safety net
    
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
 */
export async function signAndBroadcastPsbt(psbtHex: string): Promise<string> {
  console.log(`📝 Signing external PSBT...`)
  
  const btcPrivateKey = process.env.BTC_PRIVATE_KEY
  if (!btcPrivateKey) {
    throw new Error('BTC_PRIVATE_KEY not set')
  }
  
  // Validate UTXO availability before signing (prevents cryptic RBF errors)
  const conflicts = await validatePsbtUtxos(psbtHex)
  if (conflicts.length > 0) {
    const details = conflicts.map(c => 
      `${c.txid.slice(0, 8)}...${c.txid.slice(-4)}:${c.vout} (${c.reason})`
    ).join(', ')
    throw new Error(`UTXO conflict: ${conflicts.length} input(s) unavailable - ${details}`)
  }
  
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
  
  return broadcastedTxid
}
