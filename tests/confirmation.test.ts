import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  assertStatus,
  confirmOriginal,
  CONFIRMATION_DEADLINE_MS,
} from "@/lib/confirmation";
import { BrowserRequestError } from "@/lib/browser-api";
const hash = "a".repeat(64);
const result = (status: string) => ({
  txHash: hash,
  network: "testnet",
  status,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("NOT_FOUND, missing replies and UNKNOWN remain unresolved until the original hash succeeds", async () => {
  const lookup = vi
    .fn()
    .mockRejectedValueOnce(
      new BrowserRequestError("Missing history", "NOT_FOUND", 404),
    )
    .mockRejectedValueOnce(new TypeError("Lost reply"))
    .mockResolvedValueOnce(result("UNKNOWN"))
    .mockResolvedValueOnce(result("SUCCESS"));
  const onResult = vi.fn();
  const checking = confirmOriginal({
    txHash: hash,
    signal: new AbortController().signal,
    lookup,
    onResult,
  });
  await vi.advanceTimersByTimeAsync(7000);
  expect(await checking).toBe("final");
  expect(lookup).toHaveBeenCalledTimes(4);
  expect(onResult.mock.calls.map(([r]) => r.status)).toEqual([
    "UNKNOWN",
    "SUCCESS",
  ]);
});
it("the total deadline bounds a lookup even if its transport ignores cancellation", async () => {
  const lookup = vi.fn((_signal: AbortSignal) => new Promise<never>(() => {}));
  const checking = confirmOriginal({
    txHash: hash,
    signal: new AbortController().signal,
    lookup,
    onResult: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(CONFIRMATION_DEADLINE_MS);
  expect(await checking).toBe("unresolved");
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup.mock.calls[0]?.[0].aborted).toBe(true);
});
it("passes the remaining window to later lookups instead of restarting 30 seconds", async () => {
  const lookup = vi.fn((_signal: AbortSignal, _remainingMs: number) =>
    Promise.resolve(result("UNKNOWN")),
  );
  lookup.mockImplementationOnce(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(result("UNKNOWN")), 20000),
      ),
  );
  lookup.mockImplementationOnce(() => new Promise(() => {}));
  const checking = confirmOriginal({
    txHash: hash,
    signal: new AbortController().signal,
    lookup,
    onResult: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(21000);
  expect(lookup.mock.calls.map(([, remainingMs]) => remainingMs)).toEqual([
    30000, 9000,
  ]);
  await vi.advanceTimersByTimeAsync(9000);
  expect(await checking).toBe("unresolved");
  expect(lookup).toHaveBeenCalledTimes(2);
});
it("does not dispatch a lookup after the deadline even when the abort timer has not fired", async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now");
  clock
    .mockReturnValueOnce(now)
    .mockReturnValue(now + CONFIRMATION_DEADLINE_MS);
  const lookup = vi.fn();
  try {
    expect(
      await confirmOriginal({
        txHash: hash,
        signal: new AbortController().signal,
        lookup,
        onResult: vi.fn(),
      }),
    ).toBe("unresolved");
    expect(lookup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    clock.mockRestore();
  }
});
it("abort before starting makes no request and abort during backoff makes no later request", async () => {
  const controller = new AbortController();
  controller.abort();
  const lookup = vi.fn();
  expect(
    await confirmOriginal({
      txHash: hash,
      signal: controller.signal,
      lookup,
      onResult: vi.fn(),
    }),
  ).toBe("cancelled");
  expect(lookup).not.toHaveBeenCalled();
  const next = new AbortController();
  lookup.mockResolvedValue(result("PENDING"));
  const checking = confirmOriginal({
    txHash: hash,
    signal: next.signal,
    lookup,
    onResult: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(0);
  next.abort();
  expect(await checking).toBe("cancelled");
  await vi.advanceTimersByTimeAsync(30000);
  expect(lookup).toHaveBeenCalledTimes(1);
});
it("Retry-After is honored within the total deadline", async () => {
  const lookup = vi
    .fn()
    .mockRejectedValueOnce(
      new BrowserRequestError("Slow down", "RATE_LIMITED", 429, 20000),
    )
    .mockResolvedValue(result("SUCCESS"));
  const checking = confirmOriginal({
    txHash: hash,
    signal: new AbortController().signal,
    lookup,
    onResult: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(19999);
  expect(lookup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await checking).toBe("final");
});
it("mismatched network/hash or unrecognized statuses cannot update original evidence", async () => {
  for (const invalid of [
    { ...result("SUCCESS"), txHash: "b".repeat(64) },
    { ...result("SUCCESS"), network: "mainnet" },
    result("NOT_FOUND"),
  ]) {
    expect(() => assertStatus(invalid, hash)).toThrow(
      "Status evidence mismatch",
    );
  }
  const onResult = vi.fn();
  await expect(
    confirmOriginal({
      txHash: hash,
      signal: new AbortController().signal,
      lookup: async () => ({ ...result("SUCCESS"), txHash: "b".repeat(64) }),
      onResult,
    }),
  ).rejects.toThrow("Status evidence mismatch");
  expect(onResult).not.toHaveBeenCalled();
});
it("a Retry-After beyond the total deadline does not overflow into early requests", async () => {
  const lookup = vi
    .fn()
    .mockRejectedValue(
      new BrowserRequestError("Wait", "RATE_LIMITED", 429, 1e12),
    );
  const checking = confirmOriginal({
    txHash: hash,
    signal: new AbortController().signal,
    lookup,
    onResult: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(CONFIRMATION_DEADLINE_MS);
  expect(await checking).toBe("unresolved");
  expect(lookup).toHaveBeenCalledTimes(1);
});
