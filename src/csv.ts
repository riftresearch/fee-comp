import { appendFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Quote, SwapResult } from './providers/types.js'

const CSV_DIR = process.cwd()
const QUOTES_FILE = join(CSV_DIR, 'quotes.csv')
const SWAPS_FILE = join(CSV_DIR, 'swaps.csv')

const QUOTES_HEADER = 'timestamp,provider,inputToken,outputToken,inputAmount,expectedOutputAmount,feeUsd,feePercent'
const SWAPS_HEADER = 'timestamp,provider,swapId,txHash,inputToken,outputToken,inputAmount,expectedOutputAmount,feeUsd,status,actualOutputAmount'

function ensureFile(filepath: string, header: string) {
  if (!existsSync(filepath)) {
    writeFileSync(filepath, header + '\n')
  }
}

export function logQuote(quote: Quote) {
  ensureFile(QUOTES_FILE, QUOTES_HEADER)
  const row = [
    new Date().toISOString(),
    quote.provider,
    quote.inputToken,
    quote.outputToken,
    quote.inputAmount,
    quote.outputAmount,
    quote.feeUsd.toFixed(4),
    quote.feePercent.toFixed(4),
  ].join(',')
  appendFileSync(QUOTES_FILE, row + '\n')
  console.log(`📝 Logged quote to ${QUOTES_FILE}`)
}

export function logSwap(swap: SwapResult, status: string = 'executed') {
  ensureFile(SWAPS_FILE, SWAPS_HEADER)
  const row = [
    new Date(swap.timestamp).toISOString(),
    swap.provider,
    swap.swapId || '',
    swap.txHash || '',
    swap.inputToken,
    swap.outputToken,
    swap.inputAmount,
    swap.outputAmount,
    swap.feeUsd.toFixed(4),
    status,
    '', // actualOutputAmount - to be filled later
  ].join(',')
  appendFileSync(SWAPS_FILE, row + '\n')
  console.log(`📝 Logged swap to ${SWAPS_FILE}`)
}
