import { appendFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { type Quote, type SwapResult, type SettlementResult, fromSmallestUnit } from './providers/types.js'
import type { TokenPrices } from './prices.js'

const CSV_FILE = join(process.cwd(), 'data.csv')
const HEADER = 'timestamp,type,provider,inputToken,outputToken,inputAmount,outputAmount,swapId,txHash,status,payoutTxHash,actualOutputAmount,btcPrice,cbbtcPrice,usdcPrice,ethPrice,relayRequestId,chainflipSwapId,inputUsd,outputUsd,usdLost,feeBips'

// Helper to get USD price for a token
function getPriceForToken(token: string, prices: TokenPrices): number {
  const priceMap: Record<string, number> = {
    BTC: prices.btc,
    CBBTC: prices.cbbtc,
    USDC: prices.usdc,
    ETH: prices.eth,
  }
  return priceMap[token] || 0
}

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
    '',  // txHash
    '',  // status
    '',  // payoutTxHash
    '',  // actualOutputAmount
    prices.btc.toFixed(2),
    prices.cbbtc.toFixed(2),
    prices.usdc.toFixed(4),
    prices.eth.toFixed(2),
    '',  // relayRequestId
    '',  // chainflipSwapId
    '',  // inputUsd
    '',  // outputUsd
    '',  // usdLost
    '',  // feeBips
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}

export function logSwap(swap: SwapResult, prices: TokenPrices) {
  ensureFile()
  
  // Calculate input USD value and store on swap for later settlement calculation
  const inputPrice = getPriceForToken(swap.inputToken, prices)
  const inputUsd = parseFloat(swap.inputAmount) * inputPrice
  swap.inputUsd = inputUsd  // Store for settlement tracking
  
  const row = [
    new Date(swap.timestamp).toISOString(),
    'swap',
    swap.provider,
    swap.inputToken,
    swap.outputToken,
    swap.inputAmount,
    swap.outputAmount,
    swap.swapId || '',
    swap.txHash || '',
    'pending',
    '',  // payoutTxHash
    '',  // actualOutputAmount
    prices.btc.toFixed(2),
    prices.cbbtc.toFixed(2),
    prices.usdc.toFixed(4),
    prices.eth.toFixed(2),
    swap.relayRequestId || '',
    '',  // chainflipSwapId - populated on settlement
    inputUsd.toFixed(2),  // inputUsd
    '',  // outputUsd - calculated on settlement
    '',  // usdLost - calculated on settlement
    '',  // feeBips - calculated on settlement
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}

export function logSettlement(settlement: SettlementResult, swap: SwapResult, prices: TokenPrices) {
  ensureFile()
  
  // Calculate fee metrics
  // Convert actual output amount from smallest unit to human-readable
  const actualOutputHuman = settlement.actualOutputAmount 
    ? parseFloat(fromSmallestUnit(settlement.actualOutputAmount, swap.outputToken))
    : parseFloat(swap.outputAmount)
  
  // Calculate USD values
  const inputPrice = getPriceForToken(swap.inputToken, prices)
  const outputPrice = getPriceForToken(swap.outputToken, prices)
  
  // Use stored inputUsd from swap if available, otherwise recalculate
  const inputUsd = swap.inputUsd || (parseFloat(swap.inputAmount) * inputPrice)
  const outputUsd = actualOutputHuman * outputPrice
  const usdLost = inputUsd - outputUsd
  const feeBips = inputUsd > 0 ? (usdLost / inputUsd) * 10000 : 0
  
  const row = [
    new Date(settlement.settledAt || Date.now()).toISOString(),
    'settlement',
    swap.provider,
    swap.inputToken,
    swap.outputToken,
    swap.inputAmount,
    swap.outputAmount,
    settlement.swapId,
    swap.txHash || '',
    settlement.status,
    settlement.payoutTxHash || '',
    settlement.actualOutputAmount || '',
    prices.btc.toFixed(2),
    prices.cbbtc.toFixed(2),
    prices.usdc.toFixed(4),
    prices.eth.toFixed(2),
    swap.relayRequestId || '',
    settlement.chainflipSwapId || '',
    inputUsd.toFixed(2),
    outputUsd.toFixed(2),
    usdLost.toFixed(2),
    feeBips.toFixed(0),
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}
