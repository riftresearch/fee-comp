import { createServer } from 'http'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'

const CSV_HEADER = 'timestamp,type,provider,inputToken,outputToken,inputAmount,outputAmount,feeUsd,feePercent,swapId,status,payoutTxHash,actualOutputAmount'

const PORT = 3456

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

    // Serve HTML page
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Fee Comp Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      padding: 24px;
      min-height: 100vh;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 8px;
      color: #00d4ff;
    }
    .meta {
      color: #666;
      font-size: 0.85rem;
      margin-bottom: 24px;
    }
    .stats {
      display: flex;
      gap: 24px;
      margin-bottom: 24px;
    }
    .stat {
      background: #12121a;
      border: 1px solid #1e1e2e;
      border-radius: 8px;
      padding: 16px 24px;
    }
    .stat-label { color: #666; font-size: 0.75rem; text-transform: uppercase; }
    .stat-value { font-size: 1.5rem; color: #00d4ff; margin-top: 4px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th {
      text-align: left;
      padding: 12px 16px;
      background: #12121a;
      color: #888;
      font-weight: 500;
      text-transform: uppercase;
      font-size: 0.7rem;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #1e1e2e;
    }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid #1a1a24;
    }
    tr:hover { background: #12121a; }
    .type-quote { color: #888; }
    .type-swap { color: #00d4ff; }
    .provider { color: #a78bfa; }
    .pair { color: #fff; }
    .amount { color: #4ade80; }
    .fee { color: #f97316; }
    .refresh { 
      position: fixed; 
      top: 24px; 
      right: 24px; 
      background: #1e1e2e;
      border: 1px solid #2e2e3e;
      color: #888;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
    }
    .refresh:hover { background: #2e2e3e; color: #fff; }
    .clear { 
      position: fixed; 
      top: 24px; 
      right: 120px; 
      background: #2a1515;
      border: 1px solid #3e2020;
      color: #f87171;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
    }
    .clear:hover { background: #3e2020; }
    .empty { color: #444; text-align: center; padding: 48px; }
    tr { cursor: pointer; transition: background 0.15s; }
    
    /* Modal styles */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(4px);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: #12121a;
      border: 1px solid #2e2e3e;
      border-radius: 12px;
      padding: 24px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #2e2e3e;
    }
    .modal-title {
      font-size: 1.1rem;
      color: #00d4ff;
    }
    .modal-close {
      background: none;
      border: none;
      color: #666;
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0;
      line-height: 1;
    }
    .modal-close:hover { color: #fff; }
    .modal-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #1a1a24;
    }
    .modal-row:last-child { border-bottom: none; }
    .modal-label {
      color: #666;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .modal-value {
      color: #e0e0e0;
      font-size: 0.9rem;
      word-break: break-all;
      text-align: right;
      max-width: 65%;
    }
    .modal-value.highlight { color: #00d4ff; }
    .modal-value.success { color: #4ade80; }
    .modal-value.warning { color: #f97316; }
    .modal-value a {
      color: #a78bfa;
      text-decoration: none;
    }
    .modal-value a:hover { text-decoration: underline; }
    .modal-section {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #2e2e3e;
    }
    .modal-section-title {
      color: #888;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <h1>Fee Comp Dashboard</h1>
  <div class="meta">Auto-refreshes every 5 seconds</div>
  
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Total Quotes</div>
      <div class="stat-value" id="quoteCount">0</div>
    </div>
    <div class="stat">
      <div class="stat-label">Total Swaps</div>
      <div class="stat-value" id="swapCount">0</div>
    </div>
  </div>

  <button class="clear" onclick="clearData()">Clear</button>
  <button class="refresh" onclick="loadData()">Refresh</button>

  <div class="modal-overlay" id="modal" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title" id="modalTitle">Settlement Details</div>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div id="modalContent"></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Type</th>
        <th>Provider</th>
        <th>Pair</th>
        <th>Input</th>
        <th>Expected</th>
        <th>Actual</th>
        <th>Fee</th>
        <th>Payout Tx</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>

  <script>
    let allData = []
    
    async function loadData() {
      try {
        const res = await fetch('/api/data')
        allData = await res.json()
        
        const tbody = document.getElementById('tbody')
        const quotes = allData.filter(d => d.type === 'quote')
        const swaps = allData.filter(d => d.type === 'swap')
        
        document.getElementById('quoteCount').textContent = quotes.length
        document.getElementById('swapCount').textContent = swaps.length
        
        if (allData.length === 0) {
          tbody.innerHTML = '<tr><td colspan="9" class="empty">No data yet</td></tr>'
          return
        }
        
        tbody.innerHTML = allData.slice().reverse().map((row, idx) => {
          const realIdx = allData.length - 1 - idx
          const payoutTx = row.payoutTxHash ? row.payoutTxHash.slice(0, 10) + '...' : '-'
          const actualOut = row.actualOutputAmount || '-'
          return \`
            <tr onclick="showDetails(\${realIdx})">
              <td>\${new Date(row.timestamp).toLocaleTimeString()}</td>
              <td class="type-\${row.type}">\${row.type}</td>
              <td class="provider">\${row.provider}</td>
              <td class="pair">\${row.inputToken} -> \${row.outputToken}</td>
              <td class="amount">\${row.inputAmount}</td>
              <td class="amount">\${row.outputAmount}</td>
              <td class="amount">\${actualOut}</td>
              <td class="fee">$\${parseFloat(row.feeUsd || 0).toFixed(2)}</td>
              <td>\${payoutTx}</td>
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
      const title = document.getElementById('modalTitle')
      const content = document.getElementById('modalContent')
      
      title.textContent = row.type === 'settlement' ? 'Settlement Details' 
        : row.type === 'swap' ? 'Swap Details' : 'Quote Details'
      
      const formatTime = (ts) => new Date(ts).toLocaleString()
      const formatHash = (hash, type) => {
        if (!hash || hash === '-') return '<span style="color:#444">-</span>'
        const explorer = type === 'btc' 
          ? 'https://mempool.space/tx/' 
          : 'https://etherscan.io/tx/'
        return \`<a href="\${explorer}\${hash}" target="_blank">\${hash}</a>\`
      }
      
      // Determine if this is BTC->EVM or EVM->BTC
      const isBtcInput = row.inputToken === 'BTC'
      const payoutType = isBtcInput ? 'eth' : 'btc'
      const depositType = isBtcInput ? 'btc' : 'eth'
      
      let html = \`
        <div class="modal-row">
          <span class="modal-label">Type</span>
          <span class="modal-value highlight">\${row.type?.toUpperCase()}</span>
        </div>
        <div class="modal-row">
          <span class="modal-label">Provider</span>
          <span class="modal-value">\${row.provider}</span>
        </div>
        <div class="modal-row">
          <span class="modal-label">Time</span>
          <span class="modal-value">\${formatTime(row.timestamp)}</span>
        </div>
        
        <div class="modal-section">
          <div class="modal-section-title">Trade Info</div>
          <div class="modal-row">
            <span class="modal-label">Direction</span>
            <span class="modal-value">\${row.inputToken} → \${row.outputToken}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Input Amount</span>
            <span class="modal-value success">\${row.inputAmount} \${row.inputToken}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Expected Output</span>
            <span class="modal-value success">\${row.outputAmount} \${row.outputToken}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Actual Output</span>
            <span class="modal-value \${row.actualOutputAmount ? 'success' : ''}">\${row.actualOutputAmount || '-'} \${row.actualOutputAmount ? row.outputToken : ''}</span>
          </div>
        </div>
        
        <div class="modal-section">
          <div class="modal-section-title">Fees</div>
          <div class="modal-row">
            <span class="modal-label">Fee (USD)</span>
            <span class="modal-value warning">$\${parseFloat(row.feeUsd || 0).toFixed(4)}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Fee %</span>
            <span class="modal-value warning">\${parseFloat(row.feePercent || 0).toFixed(4)}%</span>
          </div>
        </div>
      \`
      
      if (row.type === 'swap' || row.type === 'settlement') {
        html += \`
          <div class="modal-section">
            <div class="modal-section-title">Transaction Hashes</div>
            <div class="modal-row">
              <span class="modal-label">Swap ID</span>
              <span class="modal-value">\${row.swapId || '-'}</span>
            </div>
            <div class="modal-row">
              <span class="modal-label">Payout Tx</span>
              <span class="modal-value">\${formatHash(row.payoutTxHash, payoutType)}</span>
            </div>
            <div class="modal-row">
              <span class="modal-label">Status</span>
              <span class="modal-value \${row.status === 'completed' ? 'success' : ''}">\${row.status || '-'}</span>
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
    
    loadData()
    setInterval(loadData, 5000)
  </script>
</body>
</html>`)
  })

  server.listen(PORT, () => {
    console.log(`📊 Dashboard running at http://localhost:${PORT}`)
  })
}
