# Fee Comp

Headless TypeScript server for trade fee comparison using the Rift SDK.

## Setup

```bash
pnpm install
```

Create a `.env` file:

```
ETH_PRIVATE_KEY=0x...
BTC_PRIVATE_KEY=...
ALCHEMY_API_KEY=your-alchemy-api-key
```

## Run

```bash
pnpm dev              # Uses default from constants.ts
pnpm dev --execute    # Force execute swaps
pnpm dev --no-execute # Quotes only (no execution)
```

Shows a live countdown to the next swap cycle:

```
💱 Execute swaps: YES
⏳ Next: EVM → BTC in 1h 59m 45s
```

## Dashboard

Live dashboard at [http://localhost:3456](http://localhost:3456) - auto-refreshes every 5 seconds. Click any row to see full details including transaction hashes.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ETH_PRIVATE_KEY` | EVM private key (0x...) for signing transactions |
| `BTC_PRIVATE_KEY` | Bitcoin private key (for BTC sends) |
| `ALCHEMY_API_KEY` | Alchemy API key for Ethereum mainnet |

## Swap Schedule

Runs for **7 days**, alternating every **2 hours** between:

**BTC → EVM:**
| Pair | Amount |
|------|--------|
| BTC → CBBTC | 0.001 |
| BTC → USDC | 0.001 |
| BTC → ETH | 0.001 |

**EVM → BTC:**
| Pair | Amount |
|------|--------|
| CBBTC → BTC | 0.001 |
| USDC → BTC | 100 |
| ETH → BTC | 0.03 |

## CSV Output

All activity is logged to `data.csv` in the project root with a `type` column:

- `quote` - Quote data (timestamp, provider, tokens, amounts, fees)
- `swap` - Executed swaps (swap ID, tx hashes, actual output amounts, status)

## Project Structure

```
src/
  index.ts          # Entry point & scheduler
  constants.ts      # Timing, swap definitions, config
  account.ts        # Wallet config & addresses
  csv.ts            # CSV logging
  server.ts         # Dashboard HTTP server
  providers/
    index.ts        # Provider exports
    rift.ts         # Rift SDK integration
    types.ts        # Common provider interface
```

## Adding Providers

Implement the `Provider` interface in `src/providers/`:

```typescript
export interface Provider {
  name: string
  getQuote(inputToken: string, outputToken: string, inputAmount: string): Promise<Quote>
  executeSwap(params: SwapParams): Promise<SwapResult>
}
```
