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

    /* Responsive */
    @media (max-width: 1024px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 768px) {
      .container { padding: 16px; }
      .stats-grid { grid-template-columns: 1fr; }
      .header { flex-direction: column; gap: 16px; }
      .table-card { overflow-x: auto; }
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
      <div class="stat-card">
        <div class="stat-icon orange">💰</div>
        <div class="stat-content">
          <div class="stat-label">Fees</div>
          <div class="stat-value orange" id="totalFees">$0</div>
        </div>
      </div>
    </div>

    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Recent Activity</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>Provider</th>
            <th>Pair</th>
            <th>Input</th>
            <th>Output</th>
            <th>Fee</th>
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
    
    async function loadData() {
      try {
        const res = await fetch('/api/data')
        allData = await res.json()
        
        const tbody = document.getElementById('tbody')
        const quotes = allData.filter(d => d.type === 'quote')
        const swaps = allData.filter(d => d.type === 'swap')
        const settlements = allData.filter(d => d.type === 'settlement')
        const totalFees = allData.reduce((sum, d) => sum + parseFloat(d.feeUsd || 0), 0)
        
        document.getElementById('quoteCount').textContent = quotes.length
        document.getElementById('swapCount').textContent = swaps.length
        document.getElementById('settlementCount').textContent = settlements.length
        document.getElementById('totalFees').textContent = '$' + totalFees.toFixed(2)
        
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
              <td><span class="badge \${badgeClass}">\${row.type}</span></td>
              <td><span class="provider-badge">⚡ \${row.provider}</span></td>
              <td class="pair">\${row.inputToken}<span class="pair-arrow">→</span>\${row.outputToken}</td>
              <td class="amount">\${row.inputAmount}</td>
              <td class="amount">\${row.outputAmount || '-'}</td>
              <td class="fee">$\${parseFloat(row.feeUsd || 0).toFixed(2)}</td>
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
      
      let cowOrderId = ''
      let riftId = row.swapId || ''
      try {
        const decoded = atob(row.swapId || '')
        const parts = decoded.split('|')
        if (parts.length >= 3) {
          cowOrderId = parts[1]
          riftId = parts[2]
        } else if (parts.length === 2) {
          cowOrderId = parts[0]
          riftId = parts[1]
        }
      } catch {}
      
      let html = \`
        <div class="modal-section">
          <div class="modal-section-title">Overview</div>
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
            <span class="modal-value success">\${row.outputAmount} \${row.outputToken}</span>
          </div>
          \${row.actualOutputAmount ? \`
          <div class="modal-row">
            <span class="modal-label">Actual Output</span>
            <span class="modal-value success">\${row.actualOutputAmount} \${row.outputToken}</span>
          </div>
          \` : ''}
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
            <div class="modal-section-title">Transaction Details</div>
            <div class="modal-row">
              <span class="modal-label">Rift ID</span>
              <span class="modal-value">\${riftId || '—'}</span>
            </div>
            \${cowOrderId ? \`
            <div class="modal-row">
              <span class="modal-label">CowSwap</span>
              <span class="modal-value"><a href="https://explorer.cow.fi/orders/\${cowOrderId}" target="_blank">View Order ↗</a></span>
            </div>
            \` : ''}
            <div class="modal-row">
              <span class="modal-label">Payout Tx</span>
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
