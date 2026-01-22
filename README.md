# Fee Comp

Headless TypeScript server for trade fee comparison using the Rift SDK.

## Setup

```bash
pnpm install
```

Create a `.env` file:

```
ETH_PRIVATE_KEY=0x...
BTC_PRIVATE_KEY=K... or L...  # WIF format
ALCHEMY_API_KEY=your-alchemy-api-key
```

## Run

```bash
pnpm go                 # Production run (no hot reload)
pnpm go --execute       # Force execute swaps
pnpm go --no-execute    # Quotes only (no execution)

pnpm dev                # Development with hot reload
```

Shows a live countdown to the next swap cycle:

```
💱 Execute swaps: YES
👀 Settlement watcher started
⏳ Next: EVM → BTC in 1h 59m 45s
```

## Dashboard

Live dashboard at [http://localhost:3456](http://localhost:3456) - auto-refreshes every 5 seconds. Click any row to see full details including transaction hashes.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ETH_PRIVATE_KEY` | EVM private key (0x...) for signing transactions |
| `BTC_PRIVATE_KEY` | Bitcoin private key in **WIF format** (starts with K, L, or 5) |
| `ALCHEMY_API_KEY` | Alchemy API key for Ethereum mainnet |

## Swap Schedule

Runs for **7 days**, alternating every **2 hours** between:

**BTC → EVM:**
| Pair | Amount |
|------|--------|
| BTC → CBBTC | 0.0001 |
| BTC → USDC | 0.0001 |
| BTC → ETH | 0.0001 |

**EVM → BTC:**
| Pair | Amount |
|------|--------|
| CBBTC → BTC | 0.0001 |
| USDC → BTC | 100 |
| ETH → BTC | 0.03 |

## Settlement Tracking

Swaps are executed non-blocking. A background watcher polls for settlement status every 30 seconds:

```
🔍 Checking 1 pending swap(s)...
   CBBTC → BTC (0.0001) | 5m elapsed
   [abc12345...] Status: pending | Deposit: confirmed | MM: waiting
```

Settlements timeout after 2 hours if not completed.

## CSV Output

All activity is logged to `data.csv` in the project root with a `type` column:

- `quote` - Quote data (timestamp, provider, tokens, amounts, fees)
- `swap` - Executed swaps (swap ID, status)
- `settlement` - Settlement results (payout tx hash, actual output amount)

## Project Structure

```
src/
  index.ts              # Entry point & scheduler
  constants.ts          # Timing, swap definitions, config
  account.ts            # Wallet config, BTC/EVM sending
  csv.ts                # CSV logging
  server.ts             # Dashboard HTTP server
  settlement-tracker.ts # Background settlement watcher
  providers/
    index.ts            # Provider exports
    rift.ts             # Rift SDK integration
    types.ts            # Common provider interface
```

## Adding Providers

Implement the `Provider` interface in `src/providers/`:

```typescript
export interface Provider {
  name: string
  getQuote(params: SwapParams): Promise<{ quote: Quote, execute: () => Promise<SwapResult> }>
  checkSettlementOnce(swapId: string): Promise<SettlementResult | null>
}
```
