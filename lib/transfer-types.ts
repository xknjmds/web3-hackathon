import { envelopeHash, assertOriginal } from "@/lib/transaction";
import { isStroops } from "@/lib/amount";
import { TESTNET, type Asset } from "@/lib/types";

// Server-side transfer record (CONTRACT.md §2-4). The preparation is
// persisted before signing and the exact signed envelope before submission;
// the original hash and PaiFlow correlation metadata are retained for
// recovery. Records are validated fail-closed on every read.
export const TRANSFER_VERSION = 1 as const;

export type TransferPrep = {
  unsignedXdr: string;
  txHash: string;
  networkPassphrase: string;
  network: "testnet";
  expiresAt: string;
  prepRequestId?: string;
  preparedAt: string;
};

export type TransferSubmitted = {
  signedXdr: string;
  txHash: string;
  submittedAt: string;
  resultStatus: string;
};

export type TransferRecord = {
  version: typeof TRANSFER_VERSION;
  transferId: string;
  templateId: string;
  asset: Asset;
  deploymentId: string; // server-only, never returned by the API
  walletAddress: string;
  amount: string; // stroops
  mock: boolean;
  createdAt: string;
  updatedAt: string;
  prep: TransferPrep;
  submitted?: TransferSubmitted;
};

const HASH = /^[a-f0-9]{64}$/;
const WALLET = /^G[A-Z2-7]{55}$/;

function fail(): never {
  throw new Error("Corrupt transfer record.");
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown, max = 200_000): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}
function iso(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}
function optionalStr(v: unknown): v is string | undefined {
  return v === undefined || (typeof v === "string" && v.length > 0);
}

export function parseTransferRecord(raw: unknown): TransferRecord {
  if (!isRecord(raw)) fail();
  if (raw.version !== TRANSFER_VERSION) fail();
  if (!str(raw.transferId, 100) || !raw.transferId.startsWith("tr_")) fail();
  if (!str(raw.templateId, 100)) fail();
  if (raw.asset !== "USDC" && raw.asset !== "XLM") fail();
  if (!str(raw.deploymentId, 100)) fail();
  if (typeof raw.walletAddress !== "string" || !WALLET.test(raw.walletAddress))
    fail();
  if (!isStroops(raw.amount)) fail();
  if (typeof raw.mock !== "boolean") fail();
  if (!iso(raw.createdAt) || !iso(raw.updatedAt)) fail();
  if (!isRecord(raw.prep)) fail();
  const prep = raw.prep;
  if (!str(prep.unsignedXdr)) fail();
  if (typeof prep.txHash !== "string" || !HASH.test(prep.txHash)) fail();
  if (prep.networkPassphrase !== TESTNET) fail();
  if (prep.network !== "testnet") fail();
  if (!iso(prep.expiresAt) || !iso(prep.preparedAt)) fail();
  if (!optionalStr(prep.prepRequestId)) fail();
  // Re-derive the original hash from the stored unsigned envelope. A record
  // whose evidence does not match is never trusted.
  if (envelopeHash(prep.unsignedXdr as string) !== prep.txHash) fail();

  let submitted: TransferSubmitted | undefined;
  if (raw.submitted !== undefined) {
    if (!isRecord(raw.submitted)) fail();
    if (!str(raw.submitted.signedXdr)) fail();
    if (
      typeof raw.submitted.txHash !== "string" ||
      !HASH.test(raw.submitted.txHash)
    )
      fail();
    if (!iso(raw.submitted.submittedAt)) fail();
    if (typeof raw.submitted.resultStatus !== "string") fail();
    assertOriginal(
      prep.unsignedXdr as string,
      raw.submitted.signedXdr,
      prep.txHash as string,
    );
    submitted = raw.submitted as unknown as TransferSubmitted;
  }

  return raw as unknown as TransferRecord;
}
