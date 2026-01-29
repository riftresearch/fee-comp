import { appendFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Quote, SwapResult, SettlementResult } from './providers/types.js'
import type { TokenPrices } from './prices.js'

const CSV_FILE = join(process.cwd(), 'data.csv')
const HEADER = 'timestamp,type,provider,inputToken,outputToken,inputAmount,outputAmount,swapId,status,payoutTxHash,actualOutputAmount,btcPrice,cbbtcPrice,usdcPrice,ethPrice,relayRequestId'

function ensureFile() {
  if (!existsSync(CSV_FILE)) {
    writeFileSync(CSV_FILE, HEADER + '\n')
  }
}

export function logQuote(quote: Quote, prices: TokenPrices) {
  ensureFile()
  const row = [
    new Date().toISOString(),
    'quote',
    quote.provider,
    quote.inputToken,
    quote.outputToken,
    quote.inputAmount,
    quote.outputAmount,
    '',  // swapId
    '',  // status
    '',  // payoutTxHash
    '',  // actualOutputAmount
    prices.btc.toFixed(2),
    prices.cbbtc.toFixed(2),
    prices.usdc.toFixed(4),
    prices.eth.toFixed(2),
    '',  // relayRequestId
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}

export function logSwap(swap: SwapResult, prices: TokenPrices) {
  ensureFile()
  const row = [
    new Date(swap.timestamp).toISOString(),
    'swap',
    swap.provider,
    swap.inputToken,
    swap.outputToken,
    swap.inputAmount,
    swap.outputAmount,
    swap.swapId || '',
    'pending',
    '',  // payoutTxHash
    '',  // actualOutputAmount
    prices.btc.toFixed(2),
    prices.cbbtc.toFixed(2),
    prices.usdc.toFixed(4),
    prices.eth.toFixed(2),
    swap.relayRequestId || '',
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}

export function logSettlement(settlement: SettlementResult, swap: SwapResult, prices: TokenPrices) {
  ensureFile()
  const row = [
    new Date(settlement.settledAt || Date.now()).toISOString(),
    'settlement',
    swap.provider,
    swap.inputToken,
    swap.outputToken,
    swap.inputAmount,
    swap.outputAmount,
    settlement.swapId,
    settlement.status,
    settlement.payoutTxHash || '',
    settlement.actualOutputAmount || '',
    prices.btc.toFixed(2),
    prices.cbbtc.toFixed(2),
    prices.usdc.toFixed(4),
    prices.eth.toFixed(2),
    swap.relayRequestId || '',
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}
