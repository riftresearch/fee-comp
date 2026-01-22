import 'dotenv/config'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

// private keys
const ethPrivateKey = process.env.ETH_PRIVATE_KEY as `0x${string}` | undefined
const btcPrivateKey = process.env.BTC_PRIVATE_KEY

// destination addresses
export const BTC_ADDRESS = 'bc1qhnxxeylq3vtzfd6e9me0jtf5xg8jw89c2lav5t'
export const EVM_ADDRESS = '0xF627B6285759e4Fa9Ca1214c31F6748AfAAd766c'
const evmAccount = ethPrivateKey ? privateKeyToAccount(ethPrivateKey) : undefined

// log config on startup
export function logAccountConfig() {
  console.log('📍 Account Configuration:')
  console.log(`   EVM: ${EVM_ADDRESS}`)
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

// placeholder for btc sending - will implement with proper wallet later
export async function sendBitcoin(recipient: string, amountSats: bigint): Promise<string> {
  console.log(`📤 BTC send requested: ${amountSats} sats to ${recipient}`)
  // TODO: Implement with BTC wallet library
  throw new Error('BTC sending not yet implemented - need wallet integration')
}
