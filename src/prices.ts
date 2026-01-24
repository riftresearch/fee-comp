/**
 * Token price fetching utility using DefiLlama API
 */

const DEFILLAMA_URL = 'https://coins.llama.fi/prices/current'

// Tokens to track (coingecko IDs via DefiLlama)
const PRICE_TOKENS = {
  btc: 'coingecko:bitcoin',
  eth: 'coingecko:ethereum',
  cbbtc: 'coingecko:coinbase-wrapped-btc',
  usdc: 'coingecko:usd-coin',
}

export interface TokenPrices {
  btc: number
  cbbtc: number
  usdc: number
  eth: number
}

// Price cache
let priceCache: { prices: TokenPrices; timestamp: number } | null = null
const PRICE_CACHE_TTL = 30_000 // 30 seconds

// Fallback prices if API fails
const FALLBACK_PRICES: TokenPrices = {
  btc: 100000,
  cbbtc: 100000,
  usdc: 1,
  eth: 3000,
}

/**
 * Fetch current token prices from DefiLlama
 * Uses 30-second cache to avoid rate limits
 */
export async function getTokenPrices(): Promise<TokenPrices> {
  // Return cached prices if fresh
  if (priceCache && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
    return priceCache.prices
  }

  try {
    const coins = Object.values(PRICE_TOKENS).join(',')
    const url = `${DEFILLAMA_URL}/${coins}`
    
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`DefiLlama error: ${res.status}`)
    }

    const data = await res.json() as { coins: Record<string, { price: number }> }

    const prices: TokenPrices = {
      btc: data.coins[PRICE_TOKENS.btc]?.price ?? priceCache?.prices.btc ?? FALLBACK_PRICES.btc,
      eth: data.coins[PRICE_TOKENS.eth]?.price ?? priceCache?.prices.eth ?? FALLBACK_PRICES.eth,
      cbbtc: data.coins[PRICE_TOKENS.cbbtc]?.price ?? priceCache?.prices.cbbtc ?? FALLBACK_PRICES.cbbtc,
      usdc: data.coins[PRICE_TOKENS.usdc]?.price ?? priceCache?.prices.usdc ?? FALLBACK_PRICES.usdc,
    }

    priceCache = { prices, timestamp: Date.now() }
    return prices
  } catch (error) {
    console.error('Failed to fetch token prices:', error)
    
    // Return cached prices if available, otherwise fallback
    if (priceCache) {
      return priceCache.prices
    }
    return FALLBACK_PRICES
  }
}

/**
 * Get a single token price by symbol
 */
export async function getTokenPrice(token: 'btc' | 'cbbtc' | 'usdc' | 'eth'): Promise<number> {
  const prices = await getTokenPrices()
  return prices[token]
}
