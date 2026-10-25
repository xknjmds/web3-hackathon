"use client";
import { BrowserRequestError, RESPONSE_DEADLINE_MS } from "@/lib/browser-api";
import type { TemplateDto } from "@/lib/templates";
import type { AmountSource, ChainStatus, TransferStatus } from "@/lib/types";

// Browser client for the PadalaSplit API (CONTRACT.md v1.2). Success bodies
// are bare JSON; errors are { error: { code, message, retryAfterSeconds? } }
// and surface as BrowserRequestError, so the starter's confirmation backoff
// honours retryAfterSeconds. Only our own same-origin routes are called;
// PaiFlow is never reached from the browser.
export type { TemplateDto };
export type Fx = { rate: string; source: "live" | "fallback" };
export type Payout = {
  recipientId: string;
  name?: string;
  amount: string;
  amountSource: AmountSource;
  phpDisplay: string;
  chainStatus?: ChainStatus;
  txHash?: string;
};
export type PrepareResponse = {
  transferId: string;
  status: "PREPARED";
  unsignedXdr: string;
  networkPassphrase: string;
  expiresAt: string;
  preview: { total: string; payouts: Payout[] };
  fx: Fx & { displayOnly: true };
  mock?: true;
};
export type SubmitResponse = {
  transferId: string;
  status: string;
  txHash: string;
  mock?: true;
};
export type StatusResponse = {
  transferId: string;
  status: TransferStatus;
  txHash?: string;
  explorerUrl?: string;
  total: string;
  asset: string;
  templateId: string;
  mock?: true;
  payouts: Payout[];
};

// A network failure or deadline throws something other than
// BrowserRequestError: the outcome is then unknown, and the caller must
// re-check the original transfer rather than start a new one.
async function call<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = RESPONSE_DEADLINE_MS,
): Promise<T> {
  const deadline = AbortSignal.timeout(Math.max(1, timeoutMs));
  const response = await fetch(path, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok || value?.error) {
    const retryAfter = value?.error?.retryAfterSeconds;
    throw new BrowserRequestError(
      value?.error?.message ??
        "Unexpected response. Re-check the original transfer before trying again.",
      String(value?.error?.code ?? response.status),
      response.status,
      typeof retryAfter === "number" ? retryAfter * 1000 : undefined,
    );
  }
  return value as T;
}

export const getTemplates = (signal?: AbortSignal) =>
  call<{ templates: TemplateDto[]; mock?: true }>(
    "/api/templates",
    undefined,
    signal,
  );
export const getFx = (signal?: AbortSignal) =>
  call<Fx>("/api/fx", undefined, signal);
export const prepareTransfer = (
  input: { templateId: string; walletAddress: string; amount: string },
  signal?: AbortSignal,
) => call<PrepareResponse>("/api/transfers/prepare", input, signal);
export const submitTransfer = (
  input: { transferId: string; signedXdr: string },
  signal?: AbortSignal,
) => call<SubmitResponse>("/api/transfers/submit", input, signal);
export const getTransfer = (
  transferId: string,
  signal?: AbortSignal,
  timeoutMs?: number,
) =>
  call<StatusResponse>(
    `/api/transfers/${encodeURIComponent(transferId)}`,
    undefined,
    signal,
    timeoutMs,
  );
