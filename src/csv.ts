import { appendFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Quote, SwapResult, SettlementResult } from './providers/types.js'

const CSV_FILE = join(process.cwd(), 'data.csv')
const HEADER = 'timestamp,type,provider,inputToken,outputToken,inputAmount,outputAmount,feeUsd,feePercent,swapId,status,payoutTxHash,actualOutputAmount'

function ensureFile() {
  if (!existsSync(CSV_FILE)) {
    writeFileSync(CSV_FILE, HEADER + '\n')
  }
}

export function logQuote(quote: Quote) {
  ensureFile()
  const row = [
    new Date().toISOString(),
    'quote',
    quote.provider,
    quote.inputToken,
    quote.outputToken,
    quote.inputAmount,
    quote.outputAmount,
    quote.feeUsd.toFixed(4),
    quote.feePercent.toFixed(2),
    '',  // swapId
    '',  // status
    '',  // payoutTxHash
    '',  // actualOutputAmount
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}

export function logSwap(swap: SwapResult) {
  ensureFile()
  const row = [
    new Date(swap.timestamp).toISOString(),
    'swap',
    swap.provider,
    swap.inputToken,
    swap.outputToken,
    swap.inputAmount,
    swap.outputAmount,
    swap.feeUsd.toFixed(4),
    '',  // feePercent
    swap.swapId || '',
    'pending',
    '',  // payoutTxHash
    '',  // actualOutputAmount
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}

export function logSettlement(settlement: SettlementResult, swap: SwapResult) {
  ensureFile()
  const row = [
    new Date(settlement.settledAt || Date.now()).toISOString(),
    'settlement',
    swap.provider,
    swap.inputToken,
    swap.outputToken,
    swap.inputAmount,
    swap.outputAmount,
    swap.feeUsd.toFixed(4),
    '',  // feePercent
    settlement.swapId,
    settlement.status,
    settlement.payoutTxHash || '',
    settlement.actualOutputAmount || '',
  ].join(',')
  appendFileSync(CSV_FILE, row + '\n')
}
