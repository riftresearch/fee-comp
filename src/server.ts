import { createServer } from 'http'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getBalances, BTC_ADDRESS, EVM_ADDRESS } from './account.js'

const CSV_HEADER = 'timestamp,type,provider,inputToken,outputToken,inputAmount,outputAmount,swapId,txHash,status,payoutTxHash,actualOutputAmount,btcPrice,cbbtcPrice,usdcPrice,ethPrice,relayRequestId,chainflipSwapId,inputUsd,outputUsd,usdLost,feeBips'

const PORT = 3457

function parseCSV(filepath: string): object[] {
  if (!existsSync(filepath)) return []
  const content = readFileSync(filepath, 'utf-8')
  const lines = content.trim().split('\n')
  if (lines.length < 2) return []
  
  const headers = lines[0].split(',')
  return lines.slice(1).map(line => {
    const values = line.split(',')
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => obj[h] = values[i] || '')
    return obj
  })
}

export function startServer() {
  const server = createServer((req, res) => {
    const csvFile = join(process.cwd(), 'data.csv')

    if (req.url === '/api/data') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Access-Control-Allow-Origin', '*')
      const data = parseCSV(csvFile)
      res.end(JSON.stringify(data))
      return
    }

    if (req.url === '/api/clear' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Access-Control-Allow-Origin', '*')
      writeFileSync(csvFile, CSV_HEADER + '\n')
      res.end(JSON.stringify({ success: true }))
      return
    }

    if (req.url === '/api/balances') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Access-Control-Allow-Origin', '*')
      getBalances()
        .then(balances => res.end(JSON.stringify(balances)))
        .catch(() => res.end(JSON.stringify({ btc: '0', eth: '0', usdc: '0', cbbtc: '0' })))
      return
    }

    if (req.url === '/api/addresses') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(JSON.stringify({ btc: BTC_ADDRESS, evm: EVM_ADDRESS }))
      return
    }

    // Serve HTML page
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rift Fee Comparison</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #050508;
      --bg-secondary: #0c0c12;
      --bg-card: #101018;
      --bg-card-hover: #14141e;
      --border: #1a1a28;
      --border-light: #252538;
      --text-primary: #f0f0f5;
      --text-secondary: #8888a0;
      --text-muted: #555568;
      --accent-cyan: #00e5ff;
      --accent-purple: #a855f7;
      --accent-green: #22c55e;
      --accent-orange: #f59e0b;
      --accent-red: #ef4444;
      --accent-blue: #3b82f6;
      --gradient-1: linear-gradient(135deg, #00e5ff 0%, #a855f7 100%);
      --gradient-2: linear-gradient(135deg, #0c0c12 0%, #1a1a28 100%);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 32px;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 40px;
    }

    .header-left h1 {
      font-size: 2rem;
      font-weight: 700;
      color: var(--accent-orange);
      margin-bottom: 8px;
    }

    .header-left .subtitle {
      color: var(--text-muted);
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .live-indicator {
      width: 8px;
      height: 8px;
      background: var(--accent-orange);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.1); }
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }

    .btn {
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 500;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 1px solid var(--border);
    }

    .btn-secondary {
      background: var(--bg-card);
      color: var(--text-secondary);
    }

    .btn-secondary:hover {
      background: var(--bg-card-hover);
      color: var(--text-primary);
      border-color: var(--border-light);
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.1);
      color: var(--accent-red);
      border-color: rgba(239, 68, 68, 0.2);
    }

    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.3);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin-bottom: 32px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .stat-card:hover {
      border-color: var(--border-light);
      transform: translateY(-2px);
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 3px;
      background: var(--accent-orange);
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .stat-card:hover::before {
      opacity: 1;
    }

    .stat-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      flex-shrink: 0;
    }

    .stat-icon.orange { background: rgba(245, 158, 11, 0.1); color: var(--accent-orange); }
    .stat-icon.green { background: rgba(34, 197, 94, 0.1); color: var(--accent-green); }
    .stat-icon.blue { background: rgba(59, 130, 246, 0.15); color: var(--accent-blue); }
    .stat-icon.gray { background: rgba(136, 136, 160, 0.1); color: var(--text-secondary); }

    .stat-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .stat-label {
      color: var(--text-muted);
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1;
    }

    .stat-value.orange { color: var(--accent-orange); }
    .stat-value.green { color: var(--accent-green); }
    .stat-value.blue { color: var(--accent-blue); }
    .stat-value.gray { color: var(--text-secondary); }

    .stat-usd {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* Table Card */
    .table-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
    }

    .table-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .table-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead th {
      text-align: left;
      padding: 14px 20px;
      background: var(--bg-secondary);
      color: var(--text-muted);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }

    tbody tr {
      cursor: pointer;
      transition: all 0.15s ease;
    }

    tbody tr:hover {
      background: var(--bg-card-hover);
    }

    tbody td {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .badge-quote {
      background: rgba(136, 136, 160, 0.1);
      color: var(--text-secondary);
    }

    .badge-swap {
      background: rgba(245, 158, 11, 0.1);
      color: var(--accent-orange);
    }

    .badge-settlement {
      background: rgba(34, 197, 94, 0.1);
      color: var(--accent-green);
    }

    .provider-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(245, 158, 11, 0.1);
      font-weight: 500;
    }
    
    .provider-badge.relay {
      background: rgba(168, 85, 247, 0.1);
      color: var(--accent-purple);
    }
    
    .provider-badge.rift {
      background: rgba(59, 130, 246, 0.1);
      color: var(--accent-blue);
    }
    
    .provider-badge.thorchain {
      background: rgba(34, 197, 94, 0.1);
      color: var(--accent-green);
    }
    
    .provider-badge.chainflip {
      background: rgba(0, 229, 255, 0.1);
      color: var(--accent-cyan);
      border-radius: 6px;
      color: var(--accent-orange);
      font-size: 0.8rem;
      font-weight: 500;
    }

    .pair {
      font-family: 'Fira Code', monospace;
      font-weight: 500;
    }

    .pair-arrow {
      color: var(--text-muted);
      margin: 0 6px;
    }

    .amount {
      font-family: 'Fira Code', monospace;
      color: var(--accent-green);
    }

    .fee {
      font-family: 'Fira Code', monospace;
      color: var(--accent-orange);
    }

    .tx-hash {
      font-family: 'Fira Code', monospace;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .empty-state {
      padding: 80px 40px;
      text-align: center;
      color: var(--text-muted);
    }

    .empty-state-icon {
      font-size: 3rem;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(5, 5, 8, 0.9);
      backdrop-filter: blur(8px);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-overlay.active { display: flex; }

    .modal {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      width: 90%;
      max-width: 560px;
      max-height: 85vh;
      overflow: hidden;
      animation: slideUp 0.3s ease;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .modal-header {
      padding: 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--bg-secondary);
    }

    .modal-title {
      font-size: 1.2rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .modal-close {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      transition: all 0.2s ease;
    }

    .modal-close:hover {
      background: var(--bg-card-hover);
      color: var(--text-primary);
      border-color: var(--border-light);
    }

    .modal-body {
      padding: 24px;
      overflow-y: auto;
      max-height: calc(85vh - 80px);
    }

    .modal-section {
      margin-bottom: 24px;
    }

    .modal-section:last-child {
      margin-bottom: 0;
    }

    .modal-section-title {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    .modal-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 12px 0;
    }

    .modal-row:not(:last-child) {
      border-bottom: 1px solid rgba(26, 26, 40, 0.5);
    }

    .modal-label {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .modal-value {
      font-size: 0.9rem;
      color: var(--text-primary);
      text-align: right;
      max-width: 60%;
      word-break: break-all;
      font-family: 'Fira Code', monospace;
    }

    .modal-value.highlight { color: var(--accent-orange); }
    .modal-value.success { color: var(--accent-green); }
    .modal-value.warning { color: var(--accent-orange); }

    .modal-value a {
      color: var(--accent-orange);
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .modal-value a:hover {
      color: var(--accent-orange);
      text-decoration: underline;
    }

    /* Address Bar */
    .address-bar {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .address-item {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      flex: 1;
      min-width: 280px;
    }

    .address-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .address-value {
      font-family: 'Fira Code', monospace;
      font-size: 0.8rem;
      color: var(--text-secondary);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .address-copy {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 0.75rem;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .address-copy:hover {
      background: var(--bg-card-hover);
      color: var(--text-primary);
      border-color: var(--border-light);
    }

    .address-copy.copied {
      background: rgba(34, 197, 94, 0.1);
      border-color: var(--accent-green);
      color: var(--accent-green);
    }

    /* Swap Journey Cards */
    .journeys-section {
      margin-bottom: 32px;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .section-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .journey-filters {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .journey-filters select {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 6px 12px;
      color: var(--text-primary);
      font-size: 0.85rem;
      cursor: pointer;
      outline: none;
    }

    .journey-filters select:hover {
      border-color: var(--text-muted);
    }

    .journey-filters select:focus {
      border-color: var(--accent-blue);
    }

    .journey-header-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 16px;
      font-size: 0.7rem;
      text-transform: uppercase;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
    }

    .journey-header-label {
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .journeys-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .journey-row {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      transition: all 0.15s ease;
      cursor: pointer;
    }

    .journey-row:hover {
      border-color: var(--border-light);
      background: rgba(255, 255, 255, 0.02);
    }

    .journey-row.settled {
      border-left: 3px solid var(--accent-green);
    }

    .journey-row.pending {
      border-left: 3px solid var(--accent-orange);
    }

    .journey-row.stuck {
      border-left: 3px solid var(--accent-red);
    }

    .journey-provider {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      min-width: 50px;
    }

    .journey-provider.rift { color: var(--accent-blue); }
    .journey-provider.relay { color: var(--accent-purple); }
    .journey-provider.thorchain { color: var(--accent-green); }
    .journey-provider.chainflip { color: var(--accent-cyan); }

    .journey-direction {
      font-family: 'Fira Code', monospace;
      font-size: 0.85rem;
      color: var(--text-primary);
      min-width: 120px;
    }

    .journey-amount {
      font-family: 'Fira Code', monospace;
      font-size: 0.8rem;
      color: var(--accent-green);
      min-width: 100px;
    }

    .journey-steps {
      display: flex;
      align-items: center;
      gap: 24px;
      flex: 1;
    }

    .journey-step {
      font-size: 0.75rem;
      font-family: 'Fira Code', monospace;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .journey-step.active {
      color: var(--text-secondary);
    }

    .journey-step.inactive {
      opacity: 0.5;
    }

    .journey-time {
      font-size: 0.75rem;
      color: var(--text-muted);
      min-width: 60px;
      text-align: right;
    }

    .journey-status {
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 4px;
      min-width: 70px;
      text-align: center;
    }

    .journey-status.settled {
      background: rgba(34, 197, 94, 0.1);
      color: var(--accent-green);
    }

    .journey-status.pending {
      background: rgba(245, 158, 11, 0.1);
      color: var(--accent-orange);
    }

    .journey-status.stuck {
      background: rgba(239, 68, 68, 0.1);
      color: var(--accent-red);
    }

    /* Responsive */
    @media (max-width: 1024px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 768px) {
      .container { padding: 16px; }
      .stats-grid { grid-template-columns: 1fr; }
      .header { flex-direction: column; gap: 16px; }
      .table-card { overflow-x: auto; }
      .address-bar { flex-direction: column; }
      .address-item { min-width: unset; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <h1>⚡ Rift Fee Comp</h1>
        <div class="subtitle">
          <span class="live-indicator"></span>
          <span>Live • Auto-refresh every 5s</span>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-danger" onclick="clearData()">Clear Data</button>
        <button class="btn btn-secondary" onclick="loadData()">↻ Refresh</button>
      </div>
    </div>

    <div class="address-bar">
      <div class="address-item">
        <span class="address-label" style="color: #f7931a;">BTC</span>
        <span class="address-value" id="btcAddress">—</span>
        <button class="address-copy" onclick="copyAddress('btc')" id="btcCopyBtn">
          <span>Copy</span>
        </button>
      </div>
      <div class="address-item">
        <span class="address-label" style="color: #627eea;">EVM</span>
        <span class="address-value" id="evmAddress">—</span>
        <button class="address-copy" onclick="copyAddress('evm')" id="evmCopyBtn">
          <span>Copy</span>
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon gray">📊</div>
        <div class="stat-content">
          <div class="stat-label">Quotes</div>
          <div class="stat-value gray" id="quoteCount">0</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue">🔄</div>
        <div class="stat-content">
          <div class="stat-label">Swaps</div>
          <div class="stat-value blue" id="swapCount">0</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">✓</div>
        <div class="stat-content">
          <div class="stat-label">Settled</div>
          <div class="stat-value green" id="settlementCount">0</div>
        </div>
      </div>
    </div>

    <div class="stats-grid" style="margin-bottom: 24px;">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(247, 147, 26, 0.1); color: #f7931a;">₿</div>
        <div class="stat-content">
          <div class="stat-label">BTC</div>
          <div class="stat-value" style="color: #f7931a;" id="btcBalance">—</div>
          <div class="stat-usd" id="btcUsd"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(98, 126, 234, 0.1); color: #627eea;">Ξ</div>
        <div class="stat-content">
          <div class="stat-label">ETH</div>
          <div class="stat-value" style="color: #627eea;" id="ethBalance">—</div>
          <div class="stat-usd" id="ethUsd"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(38, 161, 123, 0.1); color: #26a17b;">$</div>
        <div class="stat-content">
          <div class="stat-label">USDC</div>
          <div class="stat-value" style="color: #26a17b;" id="usdcBalance">—</div>
          <div class="stat-usd" id="usdcUsd"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(0, 82, 255, 0.1); color: #0052ff;">◈</div>
        <div class="stat-content">
          <div class="stat-label">cbBTC</div>
          <div class="stat-value" style="color: #0052ff;" id="cbbtcBalance">—</div>
          <div class="stat-usd" id="cbbtcUsd"></div>
        </div>
      </div>
    </div>

    <div class="journeys-section">
      <div class="section-header">
        <div class="section-title">Swap Journeys</div>
        <div class="journey-filters">
          <select id="directionFilter" onchange="applyFilters()">
            <option value="all">All Directions</option>
            <option value="btc-evm">BTC → EVM</option>
            <option value="evm-btc">EVM → BTC</option>
          </select>
          <select id="providerFilter" onchange="applyFilters()">
            <option value="all">All Providers</option>
          </select>
          <span style="color: var(--text-muted); font-size: 0.8rem;" id="journeyCount">0 swaps</span>
        </div>
      </div>
      <div class="journey-header-row">
        <span class="journey-header-label" style="min-width: 50px;">Provider</span>
        <span class="journey-header-label" style="min-width: 120px;">Direction</span>
        <span class="journey-header-label" style="min-width: 100px;">Amount</span>
        <span class="journey-header-label" style="flex: 1;">Quote → Swap → Settlement</span>
        <span class="journey-header-label" style="min-width: 60px; text-align: right;">Elapsed</span>
        <span class="journey-header-label" style="min-width: 70px; text-align: center;">Status</span>
      </div>
      <div class="journeys-grid" id="journeysGrid">
        <div style="color: var(--text-muted); padding: 40px; text-align: center;">Loading...</div>
      </div>
    </div>

    <div class="table-card">
      <div class="table-header">
        <div class="table-title">All Activity (Raw)</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Pair</th>
            <th>Type</th>
            <th>Provider</th>
            <th>Input</th>
            <th>Output</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
  </div>

  <div class="modal-overlay" id="modal" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title" id="modalTitle">
          <span id="modalIcon">📊</span>
          <span id="modalTitleText">Details</span>
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" id="modalContent"></div>
    </div>
  </div>

  <script>
    let allData = []
    let allJourneys = []
    
    // Copy text to clipboard with feedback
    async function copyToClipboard(text, btn) {
      try {
        await navigator.clipboard.writeText(text)
        const originalText = btn.textContent
        btn.textContent = 'Copied!'
        btn.style.color = 'var(--accent-green)'
        setTimeout(() => {
          btn.textContent = originalText
          btn.style.color = ''
        }, 1500)
      } catch (e) {
        console.error('Failed to copy:', e)
      }
    }
    
    // Build swap journeys by grouping quote -> swap -> settlement
    function buildJourneys(data) {
      const journeys = new Map() // swapId -> journey object
      const quotes = data.filter(d => d.type === 'quote')
      const swaps = data.filter(d => d.type === 'swap')
      const settlements = data.filter(d => d.type === 'settlement')
      
      // First, create journeys from swaps
      for (const swap of swaps) {
        if (!swap.swapId) continue
        
        // Find matching quote (same tokens, within 2 minutes before the swap)
        const swapTime = new Date(swap.timestamp).getTime()
        const matchingQuote = quotes.find(q => {
          const quoteTime = new Date(q.timestamp).getTime()
          const timeDiff = swapTime - quoteTime
          const matches = q.inputToken === swap.inputToken && 
            q.outputToken === swap.outputToken &&
            timeDiff >= 0 && timeDiff < 120000
          // Debug log for CBBTC swaps
          if (swap.inputToken === 'CBBTC' || swap.outputToken === 'CBBTC') {
            console.log('Quote match check:', { 
              swapPair: swap.inputToken + '->' + swap.outputToken,
              quotePair: q.inputToken + '->' + q.outputToken, 
              timeDiff: timeDiff/1000 + 's',
              matches 
            })
          }
          return matches
        })
        
        // Find matching settlement
        const matchingSettlement = settlements.find(s => s.swapId === swap.swapId)
        
        journeys.set(swap.swapId, {
          swapId: swap.swapId,
          quote: matchingQuote || null,
          swap: swap,
          settlement: matchingSettlement || null,
          inputToken: swap.inputToken,
          outputToken: swap.outputToken,
          inputAmount: swap.inputAmount,
          outputAmount: swap.outputAmount,
          provider: swap.provider,
          startTime: matchingQuote?.timestamp || swap.timestamp,
          relayRequestId: swap.relayRequestId || null,
        })
      }
      
      // Sort by start time descending (newest first)
      return Array.from(journeys.values()).sort((a, b) => 
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      )
    }
    
    function getFilteredJourneys() {
      const directionFilter = document.getElementById('directionFilter').value
      const providerFilter = document.getElementById('providerFilter').value
      
      return allJourneys.filter(j => {
        // Direction filter
        if (directionFilter !== 'all') {
          const isBtcToEvm = j.inputToken === 'BTC'
          if (directionFilter === 'btc-evm' && !isBtcToEvm) return false
          if (directionFilter === 'evm-btc' && isBtcToEvm) return false
        }
        
        // Provider filter
        if (providerFilter !== 'all' && j.provider !== providerFilter) return false
        
        return true
      })
    }
    
    function applyFilters() {
      const filtered = getFilteredJourneys()
      const journeysGrid = document.getElementById('journeysGrid')
      
      document.getElementById('journeyCount').textContent = filtered.length + ' swap' + (filtered.length !== 1 ? 's' : '')
      
      if (filtered.length === 0) {
        journeysGrid.innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center; grid-column: 1 / -1;">No swaps match the selected filters.</div>'
      } else {
        // Need to map to original indices for detail view
        journeysGrid.innerHTML = filtered.map(j => {
          const originalIdx = allJourneys.indexOf(j)
          return renderJourneyCard(j, originalIdx)
        }).join('')
      }
    }
    
    function populateProviderFilter() {
      const providers = [...new Set(allJourneys.map(j => j.provider))].sort()
      const select = document.getElementById('providerFilter')
      select.innerHTML = '<option value="all">All Providers</option>' + 
        providers.map(p => \`<option value="\${p}">\${p}</option>\`).join('')
    }
    
    function getJourneyStatus(journey) {
      if (journey.settlement) {
        // If we have a settlement record, check if it failed or succeeded
        if (journey.settlement.status === 'timeout') {
          return 'timeout'
        }
        if (journey.settlement.status === 'failed') {
          return 'failed'
        }
        // If there's a payout tx hash or status is completed, it's settled
        if (journey.settlement.payoutTxHash || journey.settlement.status === 'completed') {
          return 'settled'
        }
        // Settlement exists but no payout yet - still settled (in progress)
        return 'settled'
      }
      // No settlement record - check if swap is stuck (more than 24 hours without settlement)
      const swapTime = new Date(journey.swap.timestamp).getTime()
      const elapsed = Date.now() - swapTime
      if (elapsed > 24 * 60 * 60 * 1000) return 'stuck'
      return 'pending'
    }
    
    function formatElapsed(ms) {
      if (ms < 60000) return Math.floor(ms / 1000) + 's'
      if (ms < 3600000) return Math.floor(ms / 60000) + 'm'
      return Math.floor(ms / 3600000) + 'h ' + Math.floor((ms % 3600000) / 60000) + 'm'
    }
    
    function renderJourneyCard(journey, idx) {
      const status = getJourneyStatus(journey)
      const statusLabels = {
        settled: 'Settled',
        pending: 'Pending', 
        stuck: 'Stuck',
        timeout: 'Timeout',
        failed: 'Failed'
      }
      const statusLabel = statusLabels[status] || status
      const statusClass = ['timeout', 'failed', 'stuck'].includes(status) ? 'stuck' : status
      const startTime = new Date(journey.startTime)
      const elapsed = journey.settlement 
        ? new Date(journey.settlement.timestamp).getTime() - startTime.getTime()
        : Date.now() - startTime.getTime()
      
      const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
      
      const providerClass = journey.provider.toLowerCase()
      const providerEmoji = { Rift: '🌀', Relay: '🔗', Thorchain: '⚡', Chainflip: '🔄' }[journey.provider] || '⚡'
      const quoteTime = journey.quote ? formatTime(journey.quote.timestamp) : '—'
      const swapTime = formatTime(journey.swap.timestamp)
      const settlementTime = journey.settlement ? formatTime(journey.settlement.timestamp) : '—'
      
      return \`
        <div class="journey-row \${statusClass}" onclick="showJourneyDetails(\${idx})">
          <span class="journey-provider \${providerClass}">\${providerEmoji} \${journey.provider}</span>
          <span class="journey-direction">\${journey.inputToken} → \${journey.outputToken}</span>
          <span class="journey-amount">\${journey.inputAmount} \${journey.inputToken}</span>
          <div class="journey-steps">
            <span class="journey-step \${journey.quote ? 'active' : 'inactive'}">📊 \${quoteTime}</span>
            <span class="journey-step active">🔄 \${swapTime}</span>
            <span class="journey-step \${journey.settlement ? 'active' : 'inactive'}">\${journey.settlement ? '✅' : '⏳'} \${settlementTime}</span>
          </div>
          <span class="journey-time">\${formatElapsed(elapsed)}</span>
          <span class="journey-status \${statusClass}">\${statusLabel}</span>
        </div>
      \`
    }
    
    function showJourneyDetails(idx) {
      const journey = allJourneys[idx]
      if (!journey) return
      
      const modal = document.getElementById('modal')
      const icon = document.getElementById('modalIcon')
      const titleText = document.getElementById('modalTitleText')
      const content = document.getElementById('modalContent')
      
      const status = getJourneyStatus(journey)
      icon.textContent = status === 'settled' ? '✅' : status === 'stuck' ? '❌' : '🔄'
      titleText.textContent = 'Swap Journey'
      
      const formatTime = (ts) => ts ? new Date(ts).toLocaleString() : '—'
      const formatShortTime = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
      
      // Helper to get price for a token from a record
      const getPrice = (record, token) => {
        if (!record) return null
        const key = token.toLowerCase() + 'Price'
        return record[key] ? parseFloat(record[key]) : null
      }
      
      // Format prices for display
      const formatPrices = (record) => {
        if (!record) return ''
        const btc = getPrice(record, 'btc')
        const eth = getPrice(record, 'eth')
        if (!btc && !eth) return ''
        const parts = []
        if (btc) parts.push(\`BTC: $\${btc.toLocaleString()}\`)
        if (eth) parts.push(\`ETH: $\${eth.toLocaleString()}\`)
        return parts.join(' · ')
      }
      
      // Decode swap ID based on provider
      let riftId = ''
      let cowswapOrder = ''
      let relayTxHash = ''
      const isRift = journey.provider === 'Rift'
      const isRelay = journey.provider === 'Relay'
      
      if (isRift) {
        try {
          const decoded = atob(journey.swapId || '')
          const parts = decoded.split('|')
          if (parts.length >= 3 && parts[0] === 'r') {
            riftId = parts[1]
          } else if (parts.length >= 3 && parts[0] === 'c') {
            cowswapOrder = parts[1]
            riftId = parts[2]
          } else if (parts.length === 2) {
            riftId = parts[1] || parts[0]
          } else {
            riftId = decoded
          }
        } catch { riftId = journey.swapId?.slice(0, 30) || '' }
      } else if (isRelay) {
        // Relay swap ID is the deposit tx hash
        relayTxHash = journey.swapId || ''
      }
      
      const isBtcOutput = journey.outputToken === 'BTC'
      const explorerBase = isBtcOutput ? 'https://mempool.space/tx/' : 'https://etherscan.io/tx/'
      const ethExplorer = 'https://etherscan.io/tx/'
      
      const copyBtn = (text, label) => text ? \`<button onclick="event.stopPropagation(); copyToClipboard('\${text}', this)" style="background:transparent;border:1px solid var(--border);border-radius:4px;padding:2px 8px;cursor:pointer;color:var(--text-muted);font-size:0.7rem;margin-left:8px;">Copy</button>\` : ''
      
      const startTime = new Date(journey.startTime).getTime()
      const endTime = journey.settlement ? new Date(journey.settlement.timestamp).getTime() : Date.now()
      const totalElapsed = formatElapsed(endTime - startTime)
      
      let html = \`
        <div class="modal-section">
          <div class="modal-section-title">Overview</div>
          <div class="modal-row">
            <span class="modal-label">Direction</span>
            <span class="modal-value">\${journey.inputToken} → \${journey.outputToken}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Amount</span>
            <span class="modal-value success">\${journey.inputAmount} \${journey.inputToken}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Expected Output</span>
            <span class="modal-value success">\${journey.outputAmount} \${journey.outputToken === 'BTC' ? 'sats' : journey.outputToken}</span>
          </div>
          \${journey.settlement?.actualOutputAmount ? \`
          <div class="modal-row">
            <span class="modal-label">Actual Output</span>
            <span class="modal-value success">\${journey.settlement.actualOutputAmount} \${journey.outputToken === 'BTC' ? 'sats' : journey.outputToken}</span>
          </div>
          \` : ''}
          <div class="modal-row">
            <span class="modal-label">Status</span>
            <span class="modal-value \${status === 'settled' ? 'success' : status === 'stuck' ? '' : 'warning'}" style="\${status === 'stuck' ? 'color:var(--accent-red)' : ''}">\${status.toUpperCase()}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Total Time</span>
            <span class="modal-value">\${totalElapsed}</span>
          </div>
        </div>
        
        <div class="modal-section">
          <div class="modal-section-title">IDs & Transactions</div>
          \${isRift ? \`
          <div class="modal-row">
            <span class="modal-label">Swap ID</span>
            <span class="modal-value" style="font-size:0.75rem;">\${journey.swapId?.slice(0, 20) || '—'}...\${copyBtn(journey.swapId, 'Swap ID')}</span>
          </div>
          \${riftId ? \`
          <div class="modal-row">
            <span class="modal-label">Rift ID</span>
            <span class="modal-value">\${riftId}\${copyBtn(riftId, 'Rift ID')}</span>
          </div>
          \` : ''}
          \${cowswapOrder ? \`
          <div class="modal-row">
            <span class="modal-label">CowSwap Order</span>
            <span class="modal-value" style="font-size:0.75rem;">\${cowswapOrder.slice(0, 16)}...\${copyBtn(cowswapOrder, 'CowSwap')}</span>
          </div>
          \` : ''}
          \` : ''}
          \${isRelay && relayTxHash ? \`
          <div class="modal-row">
            <span class="modal-label">\${journey.inputToken === 'BTC' ? 'BTC Deposit Tx' : 'ETH Deposit Tx'}</span>
            <span class="modal-value"><a href="\${journey.inputToken === 'BTC' ? 'https://mempool.space/tx/' : ethExplorer}\${relayTxHash}" target="_blank">\${relayTxHash.slice(0, 16)}...</a>\${copyBtn(relayTxHash, 'Deposit Tx')}</span>
          </div>
          \` : ''}
          \${isRelay && journey.relayRequestId ? \`
          <div class="modal-row">
            <span class="modal-label">Relay Journey</span>
            <span class="modal-value"><a href="https://relay.link/transaction/\${journey.relayRequestId}" target="_blank">View on Relay</a>\${copyBtn(journey.relayRequestId, 'Request ID')}</span>
          </div>
          \` : ''}
          \${journey.provider === 'Thorchain' && journey.swap?.swapId ? (() => {
            const thorTxId = journey.swap.swapId.replace(/^0x/i, '').toUpperCase();
            const isBtcInput = journey.inputToken === 'BTC';
            const depositExplorer = isBtcInput 
              ? \`https://mempool.space/tx/\${journey.swap.swapId}\`
              : \`https://etherscan.io/tx/\${journey.swap.swapId}\`;
            return \`
          <div class="modal-row">
            <span class="modal-label">\${isBtcInput ? 'BTC' : 'ETH'} Deposit Tx</span>
            <span class="modal-value"><a href="\${depositExplorer}" target="_blank">\${journey.swap.swapId.slice(0, 16)}...</a>\${copyBtn(journey.swap.swapId, 'Deposit Tx')}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">THORChain Tx</span>
            <span class="modal-value">
              <a href="https://viewblock.io/thorchain/tx/\${thorTxId}" target="_blank">ViewBlock</a>
              &nbsp;|&nbsp;
              <a href="https://track.ninerealms.com/\${thorTxId}" target="_blank">9R Tracker</a>
              \${copyBtn(thorTxId, 'Tx ID')}
            </span>
          </div>
          \`;
          })() : ''}
          \${journey.provider === 'Chainflip' && journey.swap?.swapId ? (() => {
            const isBtcInput = journey.inputToken === 'BTC';
            const depositTxHash = journey.swap.txHash || journey.swap.swapId;
            const depositExplorer = isBtcInput 
              ? \`https://mempool.space/tx/\${depositTxHash}\`
              : \`https://etherscan.io/tx/\${depositTxHash}\`;
            // Use chainflipSwapId from settlement if available, otherwise show pending
            const cfSwapId = journey.settlement?.chainflipSwapId;
            return \`
          <div class="modal-row">
            <span class="modal-label">\${isBtcInput ? 'BTC' : 'ETH'} Deposit Tx</span>
            <span class="modal-value"><a href="\${depositExplorer}" target="_blank">\${depositTxHash.slice(0, 16)}...</a>\${copyBtn(depositTxHash, 'Deposit Tx')}</span>
          </div>
          \${cfSwapId ? \`
          <div class="modal-row">
            <span class="modal-label">Chainflip Swap</span>
            <span class="modal-value">
              <a href="https://scan.chainflip.io/swaps/\${cfSwapId}" target="_blank">#\${cfSwapId}</a>
              \${copyBtn(cfSwapId, 'Swap ID')}
            </span>
          </div>
          \` : \`
          <div class="modal-row">
            <span class="modal-label">Chainflip Swap</span>
            <span class="modal-value" style="color: var(--text-muted)">Pending indexing...</span>
          </div>
          \`}
          \`;
          })() : ''}
          \${journey.settlement?.payoutTxHash ? \`
          <div class="modal-row">
            <span class="modal-label">\${isBtcOutput ? 'BTC Payout Tx' : 'Payout Tx'}</span>
            <span class="modal-value"><a href="\${explorerBase}\${journey.settlement.payoutTxHash}" target="_blank">\${journey.settlement.payoutTxHash.slice(0, 16)}...</a>\${copyBtn(journey.settlement.payoutTxHash, 'Payout Tx')}</span>
          </div>
          \` : ''}
        </div>
        
        <div class="modal-section">
          <div class="modal-section-title">Timeline</div>
          \${journey.quote ? \`
          <div class="modal-row">
            <span class="modal-label">📊 Quote</span>
            <span class="modal-value">\${formatTime(journey.quote.timestamp)}</span>
          </div>
          \${formatPrices(journey.quote) ? \`
          <div class="modal-row">
            <span class="modal-label" style="color:var(--text-muted);font-size:0.75rem;">Prices</span>
            <span class="modal-value" style="color:var(--text-muted);font-size:0.75rem;">\${formatPrices(journey.quote)}</span>
          </div>
          \` : ''}
          \` : ''}
          <div class="modal-row">
            <span class="modal-label">🔄 Swap Initiated</span>
            <span class="modal-value">\${formatTime(journey.swap.timestamp)}</span>
          </div>
          \${formatPrices(journey.swap) ? \`
          <div class="modal-row">
            <span class="modal-label" style="color:var(--text-muted);font-size:0.75rem;">Prices</span>
            <span class="modal-value" style="color:var(--text-muted);font-size:0.75rem;">\${formatPrices(journey.swap)}</span>
          </div>
          \` : ''}
          \${journey.settlement ? \`
          <div class="modal-row">
            <span class="modal-label">\${(journey.settlement.payoutTxHash || journey.settlement.status === 'completed' || (journey.settlement.status && journey.settlement.status !== 'timeout' && journey.settlement.status !== 'failed')) ? '✅' : '❌'} Settlement</span>
            <span class="modal-value">\${formatTime(journey.settlement.timestamp)}</span>
          </div>
          \${formatPrices(journey.settlement) ? \`
          <div class="modal-row">
            <span class="modal-label" style="color:var(--text-muted);font-size:0.75rem;">Prices</span>
            <span class="modal-value" style="color:var(--text-muted);font-size:0.75rem;">\${formatPrices(journey.settlement)}</span>
          </div>
          \` : ''}
          \` : \`
          <div class="modal-row">
            <span class="modal-label">⏳ Settlement</span>
            <span class="modal-value" style="color:var(--text-muted)">Waiting...</span>
          </div>
          \`}
        </div>
        
        <div class="modal-section">
          <div class="modal-section-title">Provider</div>
          <div class="modal-row">
            <span class="modal-label">Provider</span>
            <span class="modal-value" style="color: var(--accent-\${{ Relay: 'purple', Rift: 'blue', Thorchain: 'green', Chainflip: 'cyan' }[journey.provider] || 'orange'})">\${{ Rift: '🌀', Relay: '🔗', Thorchain: '⚡', Chainflip: '🔄' }[journey.provider] || '⚡'} \${journey.provider}</span>
          </div>
        </div>
      \`
      
      content.innerHTML = html
      modal.classList.add('active')
    }
    
    async function loadData() {
      try {
        const res = await fetch('/api/data')
        allData = await res.json()
        
        const tbody = document.getElementById('tbody')
        const journeysGrid = document.getElementById('journeysGrid')
        const quotes = allData.filter(d => d.type === 'quote')
        const swaps = allData.filter(d => d.type === 'swap')
        const settlements = allData.filter(d => d.type === 'settlement')
        
        document.getElementById('quoteCount').textContent = quotes.length
        document.getElementById('swapCount').textContent = swaps.length
        document.getElementById('settlementCount').textContent = settlements.length
        
        // Build and render journeys
        allJourneys = buildJourneys(allData)
        populateProviderFilter()
        
        if (allJourneys.length === 0) {
          document.getElementById('journeyCount').textContent = '0 swaps'
          journeysGrid.innerHTML = '<div style="color: var(--text-muted); padding: 40px; text-align: center; grid-column: 1 / -1;">No swaps yet. Execute some swaps to track them here.</div>'
        } else {
          applyFilters()
        }
        
        // Render raw table
        if (allData.length === 0) {
          tbody.innerHTML = \`
            <tr>
              <td colspan="8">
                <div class="empty-state">
                  <div class="empty-state-icon">📭</div>
                  <div>No data yet. Start running swaps to see activity here.</div>
                </div>
              </td>
            </tr>
          \`
          return
        }
        
        tbody.innerHTML = allData.slice().reverse().map((row, idx) => {
          const realIdx = allData.length - 1 - idx
          const time = new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          const badgeClass = row.type === 'settlement' ? 'badge-settlement' : row.type === 'swap' ? 'badge-swap' : 'badge-quote'
          const status = row.type === 'settlement' ? (row.status || 'pending') : row.type === 'swap' ? 'pending' : '-'
          
          return \`
            <tr onclick="showDetails(\${realIdx})">
              <td style="color: var(--text-muted)">\${time}</td>
              <td class="pair">\${row.inputToken}<span class="pair-arrow">→</span>\${row.outputToken}</td>
              <td><span class="badge \${badgeClass}">\${row.type}</span></td>
              <td><span class="provider-badge \${row.provider.toLowerCase()}">\${{ Rift: '🌀', Relay: '🔗', Thorchain: '⚡', Chainflip: '🔄' }[row.provider] || '⚡'} \${row.provider}</span></td>
              <td class="amount">\${row.inputAmount}</td>
              <td class="amount">\${row.outputAmount || '-'}</td>
              <td><span class="badge \${status === 'completed' ? 'badge-settlement' : 'badge-quote'}">\${status}</span></td>
            </tr>
          \`
        }).join('')
      } catch (e) {
        console.error('Failed to load data:', e)
      }
    }
    
    function showDetails(idx) {
      const row = allData[idx]
      if (!row) return
      
      const modal = document.getElementById('modal')
      const icon = document.getElementById('modalIcon')
      const titleText = document.getElementById('modalTitleText')
      const content = document.getElementById('modalContent')
      
      const typeConfig = {
        settlement: { icon: '✅', title: 'Settlement Details' },
        swap: { icon: '🔄', title: 'Swap Details' },
        quote: { icon: '📊', title: 'Quote Details' }
      }
      
      const config = typeConfig[row.type] || typeConfig.quote
      icon.textContent = config.icon
      titleText.textContent = config.title
      
      const formatTime = (ts) => new Date(ts).toLocaleString()
      const formatHash = (hash, type) => {
        if (!hash || hash === '-') return '<span style="color:var(--text-muted)">—</span>'
        const explorer = type === 'btc' 
          ? 'https://mempool.space/tx/' 
          : 'https://etherscan.io/tx/'
        return \`<a href="\${explorer}\${hash}" target="_blank">\${hash.slice(0, 16)}...</a>\`
      }
      
      const isBtcInput = row.inputToken === 'BTC'
      const payoutType = isBtcInput ? 'eth' : 'btc'
      
      const isRift = row.provider === 'Rift'
      const isRelay = row.provider === 'Relay'
      let riftId = ''
      let relayTxHash = ''
      
      if (isRift && row.swapId) {
        try {
          const decoded = atob(row.swapId || '')
          const parts = decoded.split('|')
          if (parts.length >= 3 && parts[0] === 'r') {
            riftId = parts[1]
          } else if (parts.length === 2) {
            riftId = parts[1] || parts[0]
          } else {
            riftId = decoded
          }
        } catch { riftId = row.swapId?.slice(0, 30) || '' }
      } else if (isRelay) {
        relayTxHash = row.swapId || ''
      }
      
      let html = \`
        <div class="modal-section">
          <div class="modal-section-title">Overview</div>
          <div class="modal-row">
            <span class="modal-label">Type</span>
            <span class="modal-value highlight">\${row.type?.toUpperCase()}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Provider</span>
            <span class="modal-value" style="color: var(--accent-\${{ Relay: 'purple', Rift: 'blue', Thorchain: 'green', Chainflip: 'cyan' }[row.provider] || 'orange'})">\${{ Rift: '🌀', Relay: '🔗', Thorchain: '⚡', Chainflip: '🔄' }[row.provider] || '⚡'} \${row.provider}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Time</span>
            <span class="modal-value">\${formatTime(row.timestamp)}</span>
          </div>
        </div>
        
        <div class="modal-section">
          <div class="modal-section-title">Trade</div>
          <div class="modal-row">
            <span class="modal-label">Direction</span>
            <span class="modal-value">\${row.inputToken} → \${row.outputToken}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Input</span>
            <span class="modal-value success">\${row.inputAmount} \${row.inputToken}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Expected Output</span>
            <span class="modal-value success">\${row.outputAmount} \${row.outputToken === 'BTC' ? 'sats' : row.outputToken}</span>
          </div>
          \${row.actualOutputAmount ? \`
          <div class="modal-row">
            <span class="modal-label">Actual Output</span>
            <span class="modal-value success">\${row.actualOutputAmount} \${row.outputToken === 'BTC' ? 'sats' : row.outputToken}</span>
          </div>
          \` : ''}
        </div>
        
      \`
      
      if (row.type === 'swap' || row.type === 'settlement') {
        html += \`
          <div class="modal-section">
            <div class="modal-section-title">Transaction Details</div>
            \${isRift && riftId ? \`
            <div class="modal-row">
              <span class="modal-label">Rift ID</span>
              <span class="modal-value">\${riftId}</span>
            </div>
            \` : ''}
            \${isRelay && relayTxHash ? \`
            <div class="modal-row">
              <span class="modal-label">Deposit Tx</span>
              <span class="modal-value">\${formatHash(relayTxHash, 'eth')}</span>
            </div>
            \` : ''}
            <div class="modal-row">
              <span class="modal-label">\${isBtcInput ? 'Payout Tx' : 'BTC Payout Tx'}</span>
              <span class="modal-value">\${formatHash(row.payoutTxHash, payoutType)}</span>
            </div>
            <div class="modal-row">
              <span class="modal-label">Status</span>
              <span class="modal-value \${row.status === 'completed' ? 'success' : ''}">\${row.status || 'pending'}</span>
            </div>
          </div>
        \`
      }
      
      content.innerHTML = html
      modal.classList.add('active')
    }
    
    function closeModal(event) {
      if (event && event.target !== event.currentTarget) return
      document.getElementById('modal').classList.remove('active')
    }
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal()
    })
    
    async function clearData() {
      if (!confirm('Clear all data?')) return
      await fetch('/api/clear', { method: 'POST' })
      loadData()
    }
    
    async function loadBalances(retries = 2) {
      try {
        const res = await fetch('/api/balances')
        const bal = await res.json()
        document.getElementById('btcBalance').textContent = bal.btc
        document.getElementById('ethBalance').textContent = bal.eth
        document.getElementById('usdcBalance').textContent = bal.usdc
        document.getElementById('cbbtcBalance').textContent = bal.cbbtc
        
        const btcUsd = Number(bal.btcUsd)
        const ethUsd = Number(bal.ethUsd)
        const usdcUsd = Number(bal.usdcUsd)
        const cbbtcUsd = Number(bal.cbbtcUsd)
        
        document.getElementById('btcUsd').textContent = btcUsd > 0 ? '$' + btcUsd.toLocaleString() : '...'
        document.getElementById('ethUsd').textContent = ethUsd > 0 ? '$' + ethUsd.toLocaleString() : '...'
        document.getElementById('usdcUsd').textContent = usdcUsd > 0 ? '$' + usdcUsd.toLocaleString() : '...'
        document.getElementById('cbbtcUsd').textContent = cbbtcUsd > 0 ? '$' + cbbtcUsd.toLocaleString() : '...'
        
        // Retry if USD values are 0 (prices not loaded)
        if (retries > 0 && btcUsd === 0 && ethUsd === 0) {
          setTimeout(() => loadBalances(retries - 1), 2000)
        }
      } catch (e) {
        console.error('Failed to load balances:', e)
        if (retries > 0) setTimeout(() => loadBalances(retries - 1), 2000)
      }
    }
    
    let addresses = { btc: '', evm: '' }
    
    async function loadAddresses() {
      try {
        const res = await fetch('/api/addresses')
        addresses = await res.json()
        document.getElementById('btcAddress').textContent = addresses.btc || '—'
        document.getElementById('evmAddress').textContent = addresses.evm || '—'
      } catch (e) {
        console.error('Failed to load addresses:', e)
      }
    }
    
    async function copyAddress(type) {
      const address = type === 'btc' ? addresses.btc : addresses.evm
      if (!address) return
      
      try {
        await navigator.clipboard.writeText(address)
        const btn = document.getElementById(type + 'CopyBtn')
        btn.classList.add('copied')
        btn.querySelector('span').textContent = 'Copied!'
        setTimeout(() => {
          btn.classList.remove('copied')
          btn.querySelector('span').textContent = 'Copy'
        }, 2000)
      } catch (e) {
        console.error('Failed to copy:', e)
      }
    }
    
    loadData()
    loadBalances()
    loadAddresses()
    setInterval(loadData, 5000)
    setInterval(loadBalances, 30000) // Refresh balances every 30s
  </script>
</body>
</html>`)
  })

  server.listen(PORT, () => {
    console.log(`📊 Dashboard running at http://localhost:${PORT}`)
  })
}
