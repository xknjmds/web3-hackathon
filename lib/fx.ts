import "server-only";

// Display-only USDC/PHP estimate (contract §5). The rate is never used for
// settlement. Live rate from CoinGecko with a short cache; any failure falls
// back to the hardcoded sample rate flagged source: "fallback".
export type FxRate = {
  pair: "USDC/PHP";
  rate: string;
  source: "live" | "fallback";
  fetchedAt: string;
  displayOnly: true;
};

const FALLBACK_RATE = "56.00";
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=php";

let cached: FxRate | null = null;

export async function getFxRate(now = Date.now()): Promise<FxRate> {
  const ttl = Number(process.env.FX_CACHE_MS ?? 60_000);
  if (cached && now - Date.parse(cached.fetchedAt) < ttl) return cached;
  try {
    const response = await fetch(COINGECKO_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`fx ${response.status}`);
    const json: unknown = await response.json();
    const value = (json as Record<string, { php?: unknown }> | null)?.[
      "usd-coin"
    ]?.php;
    // The rate itself is display-only; formatting a quoted price to 2dp is
    // presentation, not money arithmetic.
    if (typeof value !== "number" || !(value > 0)) throw new Error("fx shape");
    cached = {
      pair: "USDC/PHP",
      rate: value.toFixed(2),
      source: "live",
      fetchedAt: new Date(now).toISOString(),
      displayOnly: true,
    };
  } catch {
    cached = {
      pair: "USDC/PHP",
      rate: FALLBACK_RATE,
      source: "fallback",
      fetchedAt: new Date(now).toISOString(),
      displayOnly: true,
    };
  }
  return cached;
}

// Never let a display-only FX lookup block or fail a financial step.
export async function getFxSafe(now = Date.now()): Promise<FxRate> {
  try {
    return await getFxRate(now);
  } catch {
    return {
      pair: "USDC/PHP",
      rate: FALLBACK_RATE,
      source: "fallback",
      fetchedAt: new Date(now).toISOString(),
      displayOnly: true,
    };
  }
}
