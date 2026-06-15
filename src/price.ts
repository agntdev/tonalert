export interface PriceResult {
  price: number;
  change1h?: number;
  change24h?: number;
  timestamp: number;
  source: string;
}

export interface PriceSource {
  name: string;
  fetch(symbol: string): Promise<PriceResult>;
}

export interface PriceFetchOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<PriceFetchOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  fnLabel: string,
  options?: PriceFetchOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      console.error(
        `[price] ${fnLabel} attempt ${attempt}/${opts.maxRetries} failed:`,
        error instanceof Error ? error.message : error,
      );

      if (attempt === opts.maxRetries) {
        throw error;
      }

      const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);
      const jitter = Math.random() * 0.3 * delay;
      await sleep(delay + jitter);
    }
  }

  throw new Error(`retry: max attempts exceeded for ${fnLabel}`);
}

export async function fetchPrice(
  symbol: string,
  primarySource: PriceSource,
  fallbackSources: PriceSource[],
  onAdminNotify?: (message: string) => void,
): Promise<PriceResult | null> {
  try {
    const result = await retryWithBackoff(
      () => primarySource.fetch(symbol),
      `${primarySource.name}(${symbol})`,
    );
    return result;
  } catch (primaryError) {
    console.error(
      `[price] Primary source ${primarySource.name} failed for ${symbol}:`,
      primaryError instanceof Error ? primaryError.message : primaryError,
    );

    if (fallbackSources.length === 0) {
      onAdminNotify?.(
        `Price feed error: All sources failed for ${symbol} (no fallback configured)`,
      );
      return null;
    }
  }

  for (const fallback of fallbackSources) {
    try {
      console.error(`[price] Trying fallback source ${fallback.name} for ${symbol}`);
      const result = await retryWithBackoff(
        () => fallback.fetch(symbol),
        `${fallback.name}(${symbol})`,
      );
      return result;
    } catch (fallbackError) {
      console.error(
        `[price] Fallback source ${fallback.name} failed for ${symbol}:`,
        fallbackError instanceof Error ? fallbackError.message : fallbackError,
      );
    }
  }

  onAdminNotify?.(
    `Price feed error: All sources (primary + ${fallbackSources.length} fallback(s)) failed for ${symbol}`,
  );

  return null;
}

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

function buildCoinGeckoUrl(symbol: string): string {
  return `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(symbol.toLowerCase())}&vs_currencies=usd&include_24hr_change=true`;
}

export const coinGeckoSource: PriceSource = {
  name: "CoinGecko",
  async fetch(symbol: string): Promise<PriceResult> {
    const url = buildCoinGeckoUrl(symbol);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`CoinGecko returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, { usd: number; usd_24h_change?: number }>;
    const tokenData = data[symbol.toLowerCase()];

    if (!tokenData) {
      throw new Error(`CoinGecko: no price data for ${symbol}`);
    }

    return {
      price: tokenData.usd,
      change24h: tokenData.usd_24h_change ?? undefined,
      timestamp: Date.now(),
      source: "CoinGecko",
    };
  },
};

export const dexscreenerSource: PriceSource = {
  name: "DexScreener",
  async fetch(_symbol: string): Promise<PriceResult> {
    throw new Error("DexScreener source not implemented");
  },
};

export const tonSwapSource: PriceSource = {
  name: "TonSwap",
  async fetch(_symbol: string): Promise<PriceResult> {
    throw new Error("TonSwap source not implemented");
  },
};