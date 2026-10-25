import "server-only";
import { RequestError } from "@/lib/http";

type Bucket = { count: number; resetAt: number };
const limits = { request: 240, prepare: 20, submit: 20, status: 120 } as const;
const buckets = new Map<keyof typeof limits, Bucket>();
const windowMs = 60_000;

// Global per-process budgets cannot be evaded by spoofing forwarding headers.
// Keep recovery separate from preparation; no per-wallet/IP maps to grow unbounded.
export function limitPaymentRequests(action: keyof typeof limits) {
  const now = Date.now();
  let bucket = buckets.get(action);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(action, bucket);
  }
  if (bucket.count >= limits[action]) {
    throw new RequestError(
      429,
      "RATE_LIMITED",
      "Too many requests. Retain the original payment record and retry after the indicated delay.",
      Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    );
  }
  bucket.count += 1;
}
