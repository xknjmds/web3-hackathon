import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFxRate, getFxSafe } from "@/lib/fx";

vi.mock("server-only", () => ({}));

const livePayload = { "usd-coin": { php: 57.1234 } };

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it("returns the live rate and caches it for the TTL window", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => livePayload,
  });
  vi.stubGlobal("fetch", fetchMock);
  const first = await getFxRate(1_000_000);
  expect(first).toEqual({
    pair: "USDC/PHP",
    rate: "57.12",
    source: "live",
    fetchedAt: new Date(1_000_000).toISOString(),
    displayOnly: true,
  });
  const second = await getFxRate(1_000_000 + 30_000);
  expect(second.rate).toBe("57.12");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await getFxRate(1_000_000 + 61_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("falls back to the hardcoded sample rate on upstream failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("network down")),
  );
  const rate = await getFxRate(2_000_000);
  expect(rate.rate).toBe("56.00");
  expect(rate.source).toBe("fallback");
  expect(rate.displayOnly).toBe(true);
});

it("falls back when the response shape is unexpected", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
  expect((await getFxRate(3_000_000)).source).toBe("fallback");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 429 }),
  );
  expect((await getFxSafe(4_000_000)).source).toBe("fallback");
});
