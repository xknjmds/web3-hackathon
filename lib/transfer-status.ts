import "server-only";
import { getCached } from "@/lib/read-cache";
import type { PaymentGateway, PayoutEvent, TxEvidence } from "@/lib/gateway";
import type { TransferRecord } from "@/lib/transfer-types";
import type { TransferStatus } from "@/lib/types";

// Final upstream statuses (CONTRACT.md v1.2). Anything else maps to UNKNOWN,
// which is never permission to create a replacement payment.
export function normalizeStatus(raw: string | undefined): TransferStatus {
  const status = raw?.toUpperCase();
  return status === "SUCCESS" ||
    status === "PENDING" ||
    status === "FAILED" ||
    status === "REJECTED" ||
    status === "UNKNOWN"
    ? status
    : "UNKNOWN";
}

// Status of a transfer that was never submitted. Expiry only describes the
// preparation window; it does not authorize anything.
export function unsubmittedStatus(record: TransferRecord): TransferStatus {
  return Date.now() > Date.parse(record.prep.expiresAt) ? "EXPIRED" : "PREPARED";
}

// PaiFlow reads for a submitted transfer, cached for at least 10 s because
// event ingestion runs 10-20 s behind. Shared by the status and history routes
// so both hit the same cache entry.
export function readTransferBundle(
  record: TransferRecord,
  txHash: string,
  gateway: PaymentGateway,
): Promise<{ tx: TxEvidence | null; events: PayoutEvent[] }> {
  const ttl = Number(process.env.PAIFLOW_READ_CACHE_MS ?? 10_000);
  return getCached(`tx:${record.deploymentId}:${txHash}`, ttl, async () => {
    const tx = await gateway.transaction(record.deploymentId, txHash);
    const events = tx
      ? await gateway.events(record.deploymentId, { txHash })
      : [];
    return { tx, events };
  });
}
