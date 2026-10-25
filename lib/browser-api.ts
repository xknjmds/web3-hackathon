"use client";
export class BrowserRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "BrowserRequestError";
  }
}
export const RESPONSE_DEADLINE_MS = 30_000;
export async function browserRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = RESPONSE_DEADLINE_MS,
): Promise<T> {
  if (signal?.aborted || timeoutMs <= 0)
    throw new DOMException(
      "Request cancelled or response deadline reached",
      "AbortError",
    );
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, timeoutMs);
  try {
    const response = await fetch(
      path,
      body === undefined
        ? { cache: "no-store", signal: controller.signal }
        : {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const value = await response.json();
    if (!response.ok || value.error)
      throw new BrowserRequestError(
        `${value.error?.code || response.status}: ${value.error?.message || "Unresolved response. Retain the original payment record."}${response.headers.get("x-request-id") ? ` · request ${response.headers.get("x-request-id")}` : ""}`,
        String(value.error?.code || response.status),
        response.status,
        retryAfter(response.headers.get("Retry-After")),
      );
    return value.data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
function retryAfter(raw: string | null): number | undefined {
  if (!raw) return;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(raw) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}
