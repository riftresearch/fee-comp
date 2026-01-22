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
MAINNET_RPC_URL=https://eth.llamarpc.com
```

## Run

```bash
pnpm dev
```

Shows a live countdown to the next swap cycle:

```
⏳ Next: EVM → BTC in 1h 59m 45s
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ETH_PRIVATE_KEY` | EVM private key (0x...) for signing transactions |
| `BTC_PRIVATE_KEY` | Bitcoin private key (for BTC sends) |
| `MAINNET_RPC_URL` | Ethereum mainnet RPC endpoint |

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

All activity is logged to CSV files in the project root:

- `quotes.csv` - All quotes (timestamp, provider, tokens, amounts, fees)
- `swaps.csv` - All executed swaps (swap ID, amounts, status)

## Project Structure

```
src/
  index.ts          # Entry point & scheduler
  account.ts        # Wallet config & addresses
  csv.ts            # CSV logging
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
