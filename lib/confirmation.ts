import { BrowserRequestError } from "@/lib/browser-api";
import type { Result } from "@/lib/types";

export const CONFIRMATION_DEADLINE_MS = 30_000;
export const CONFIRMATION_MAX_ATTEMPTS = 6;
export const CONFIRMATION_PENDING =
  "Confirmation pending—checking the original transaction.";
export const CONFIRMATION_UNRESOLVED =
  "Confirmation is still pending. Original evidence is retained. Use Check original transaction to resume.";

export function assertStatus(result: Result, txHash: string) {
  if (
    result.txHash !== txHash ||
    result.network !== "testnet" ||
    !["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"].includes(
      result.status,
    )
  )
    throw new Error("Status evidence mismatch. Retain the original record.");
}

function abortError() {
  return new DOMException("Original transaction check cancelled", "AbortError");
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(abortError());
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", rejectAbort);
  }
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** Only reads the original hash. Time, errors and missing history never permit replacement. */
export async function confirmOriginal({
  txHash,
  signal,
  lookup,
  onResult,
}: {
  txHash: string;
  signal: AbortSignal;
  lookup: (signal: AbortSignal, remainingMs: number) => Promise<Result>;
  onResult: (result: Result) => void;
}): Promise<"final" | "rejected" | "unresolved" | "cancelled"> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  const deadlineAt = Date.now() + CONFIRMATION_DEADLINE_MS;
  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  const timer = setTimeout(stop, CONFIRMATION_DEADLINE_MS);
  try {
    for (let attempt = 0; attempt < CONFIRMATION_MAX_ATTEMPTS; attempt++) {
      const lookupRemainingMs = remainingMs();
      if (controller.signal.aborted || lookupRemainingMs <= 0) break;
      let result: Result | undefined;
      let retryAfterMs = 0;
      try {
        result = await abortable(
          lookup(controller.signal, lookupRemainingMs),
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) break;
        if (error instanceof BrowserRequestError)
          retryAfterMs = error.retryAfterMs ?? 0;
        // Transport errors and NOT_FOUND are unresolved, not transaction failures.
      }
      if (controller.signal.aborted || remainingMs() <= 0) break;
      if (result) {
        assertStatus(result, txHash);
        onResult(result);
        if (result.status === "SUCCESS" || result.status === "FAILED")
          return "final";
        if (result.status === "REJECTED") return "rejected";
      }
      if (attempt + 1 < CONFIRMATION_MAX_ATTEMPTS)
        await wait(
          Math.min(
            remainingMs(),
            Math.max(Math.min(1000 * 2 ** attempt, 8000), retryAfterMs),
          ),
          controller.signal,
        );
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
  return signal.aborted ? "cancelled" : "unresolved";
}
