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
  console.log('📍 Account Configuration:')
  console.log(`   EVM Address: ${EVM_ADDRESS}`)
  console.log(`   EVM Account: ${evmAccount?.address || 'NOT SET'}`)
  console.log(`   Wallet Client: ${mainnetWalletClient ? '✓' : '✗'}`)
  console.log(`   BTC: ${BTC_ADDRESS}`)
  console.log(`   ETH Key: ${ethPrivateKey ? '✓' : '✗'}`)
  console.log(`   BTC Key: ${btcPrivateKey ? '✓' : '✗'}`)
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

// UTXO type
interface UTXO {
  txid: string
  vout: number
  value: number
}

// Fetch UTXOs from mempool.space
async function getUtxos(address: string): Promise<UTXO[]> {
  const res = await fetch(`https://mempool.space/api/address/${address}/utxo`)
  if (!res.ok) throw new Error(`Failed to fetch UTXOs: ${res.statusText}`)
  return res.json() as Promise<UTXO[]>
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

// Send Bitcoin
export async function sendBitcoin(recipient: string, amountSats: bigint): Promise<string> {
  console.log(`📤 BTC send: ${amountSats} sats to ${recipient}`)

  if (!btcPrivateKey) {
    throw new Error('BTC_PRIVATE_KEY not set')
  }

  // Parse private key (WIF format)
  const keyPair = ECPair.fromWIF(btcPrivateKey, btcNetwork)
  
  // Get our address from private key (p2wpkh - native segwit)
  const { address: sourceAddress } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: btcNetwork,
  })
  
  if (!sourceAddress) throw new Error('Could not derive source address')
  console.log(`   From: ${sourceAddress}`)

  // Fetch UTXOs
  const utxos = await getUtxos(sourceAddress)
  if (utxos.length === 0) {
    throw new Error(`No UTXOs found for ${sourceAddress}`)
  }
  console.log(`   UTXOs: ${utxos.length} (total: ${utxos.reduce((s, u) => s + u.value, 0)} sats)`)

  // Higher fee rate to ensure RBF replacement works
  const FEE_RATE = 25 // sat/vbyte (higher to replace stuck txs)
  
  // Calculate vsize: ~10.5 overhead + 68 per input + 31 per output (p2wpkh)
  const calcVsize = (inputs: number, outputs: number) => Math.ceil(10.5 + (68 * inputs) + (31 * outputs))
  
  // Select UTXOs with proper fee calculation
  let selectedUtxos: UTXO[] = []
  let totalInput = 0
  
  // Sort UTXOs by value descending to minimize inputs needed
  const sortedUtxos = [...utxos].sort((a, b) => b.value - a.value)
  
  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo)
    totalInput += utxo.value
    
    // Estimate fee with current inputs (2 outputs: recipient + change)
    const estimatedVsize = calcVsize(selectedUtxos.length, 2)
    const estimatedFee = FEE_RATE * estimatedVsize
    const totalNeeded = Number(amountSats) + estimatedFee
    
    if (totalInput >= totalNeeded) break
  }
  
  // Final fee calculation
  const vsize = calcVsize(selectedUtxos.length, 2)
  const fee = FEE_RATE * vsize

  if (totalInput < Number(amountSats) + fee) {
    throw new Error(`Insufficient funds: have ${totalInput}, need ${Number(amountSats) + fee}`)
  }
  
  console.log(`   Inputs: ${selectedUtxos.length}, vsize: ~${vsize}, fee rate: ${FEE_RATE} sat/vB`)

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
  console.log(`   Fee: ${fee} sats (${actualFeeRate} sat/vB, ${actualVsize} vB)`)

  // Broadcast
  const broadcastedTxid = await broadcastTx(txHex)
  console.log(`   ✅ Broadcasted: ${broadcastedTxid}`)

  return broadcastedTxid
}
