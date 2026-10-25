import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserRequest, RESPONSE_DEADLINE_MS } from "@/lib/browser-api";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("does not dispatch when cancelled already or given no response time", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const controller = new AbortController();
  controller.abort();
  await expect(
    browserRequest("/api/pay", undefined, controller.signal),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(
    browserRequest("/api/pay", undefined, undefined, 0),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("the default deadline also bounds a stalled response body and makes no retry", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return {
        json: () =>
          new Promise((_resolve, reject) =>
            signal!.addEventListener(
              "abort",
              () => reject(new DOMException("Response deadline", "AbortError")),
              { once: true },
            ),
          ),
      };
    }),
  );
  const request = browserRequest("/api/pay", { action: "prepare" });
  const rejected = expect(request).rejects.toThrow("Response deadline");
  await vi.advanceTimersByTimeAsync(RESPONSE_DEADLINE_MS - 1);
  expect(signal!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(signal!.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("external cancellation aborts the request and removes its timer and listener", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        ),
      );
    }),
  );
  const request = browserRequest(
    "/api/pay",
    { action: "status" },
    controller.signal,
  );
  const rejected = expect(request).rejects.toThrow("Cancelled");
  controller.abort();
  await rejected;
  expect(signal!.aborted).toBe(true);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("a completed response clears its deadline and external cancellation listener", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: { ready: true } })),
  );
  await expect(
    browserRequest("/api/integration", undefined, controller.signal),
  ).resolves.toEqual({
    ready: true,
  });
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});
