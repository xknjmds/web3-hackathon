import { assertOriginal, envelopeHash } from "@/lib/transaction";
import { TESTNET } from "@/lib/types";
import type { Prepared } from "@/lib/types";
export type Recovery = {
  version: 2;
  scope: string;
  address: string;
  prepared: Prepared;
  signedXdr?: string;
  signing?: boolean;
  attempted?: boolean;
  status?: string;
};
export function readRecovery(scope: string, raw: string): Recovery {
  const r = JSON.parse(raw) as Recovery;
  if (
    !r ||
    r.version !== 2 ||
    r.scope !== scope ||
    typeof r.address !== "string" ||
    !/^G[A-Z2-7]{55}$/.test(r.address) ||
    !r.prepared ||
    r.prepared.network !== "testnet" ||
    r.prepared.networkPassphrase !== TESTNET ||
    !Number.isFinite(Date.parse(r.prepared.expiresAt)) ||
    !/^[a-f0-9]{64}$/.test(r.prepared.txHash) ||
    (r.signing !== undefined && typeof r.signing !== "boolean") ||
    (r.attempted !== undefined && typeof r.attempted !== "boolean") ||
    (r.status !== undefined &&
      !["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"].includes(
        r.status,
      ))
  )
    throw new Error(
      "Invalid recovery record. Retain storage for support; do not start another payment.",
    );
  if (envelopeHash(r.prepared.xdr) !== r.prepared.txHash)
    throw new Error("Stored transaction mismatch.");
  if (r.signedXdr !== undefined)
    assertOriginal(r.prepared.xdr, r.signedXdr, r.prepared.txHash);
  return r;
}
export function saveRecovery(
  storage: Pick<Storage, "setItem" | "getItem">,
  key: string,
  r: Recovery,
) {
  const raw = JSON.stringify(r);
  readRecovery(r.scope, raw);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw)
    throw new Error("Recovery storage unavailable. Payment stopped.");
}
export function terminal(r: Recovery) {
  return r.status === "SUCCESS" || r.status === "FAILED";
}

/** Old API operations and other configured deployments must be reconciled first. */
export function assertNoConflictingRecovery(
  storage: Pick<Storage, "length" | "key" | "getItem">,
  currentKey: string,
) {
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !storage.getItem(key)) continue;
    if (key.startsWith("paiflow:operation:v1:"))
      throw new Error(
        "Legacy API payment evidence remains in this browser. Use legacy/api-2026-10-17 at the same origin to reconcile it before switching to the SDK starter. Do not delete the record.",
      );
    if (key.startsWith("paiflow-sdk-payment-v2:") && key !== currentKey) {
      const foreignScope = key.slice("paiflow-sdk-payment-v2:".length);
      const foreign = readRecovery(foreignScope, storage.getItem(key)!);
      if (terminal(foreign)) continue;
      throw new Error(
        "Payment evidence for another environment or deployment remains. Restore that configuration and reconcile the original record before starting another payment.",
      );
    }
  }
}
