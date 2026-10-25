import { StrKey } from "@stellar/stellar-sdk";
import { respond } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { limitPaymentRequests } from "@/lib/payment-rate-limit";
import { getGateway } from "@/lib/gateway";
import { getStore } from "@/lib/transfer-store";
import {
  normalizeStatus,
  readTransferBundle,
  unsubmittedStatus,
} from "@/lib/transfer-status";
import type { TransferStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Bounds both the response and the PaiFlow reads behind it.
const HISTORY_LIMIT = 20;

// GET /api/transfers?wallet=G... (CONTRACT.md §6, P2 history). Identity is
// the wallet address, so there is no ownership check beyond that (see
// README). Statuses come from the same cached PaiFlow reads as the status
// route; a failed lookup for one row reports UNKNOWN for that row instead of
// failing the list, and UNKNOWN never authorizes a replacement payment.
export async function GET(request: Request) {
  return respond(async () => {
    limitPaymentRequests("status");
    const wallet = new URL(request.url).searchParams.get("wallet");
    if (!wallet || !StrKey.isValidEd25519PublicKey(wallet))
      throw new ApiError(
        400,
        "INVALID_WALLET",
        "wallet is not a valid Stellar public key.",
      );

    const records = await getStore().listByWallet(wallet, HISTORY_LIMIT);
    const gateway = getGateway();
    const transfers = await Promise.all(
      records.map(async (record) => {
        let status: TransferStatus;
        const txHash = record.submitted?.txHash;
        if (!txHash) {
          status = unsubmittedStatus(record);
        } else {
          try {
            const bundle = await readTransferBundle(record, txHash, gateway);
            status = normalizeStatus(bundle.tx?.status);
          } catch {
            status = "UNKNOWN";
          }
        }
        return {
          transferId: record.transferId,
          templateId: record.templateId,
          total: record.amount,
          asset: record.asset,
          status,
          ...(txHash ? { txHash } : {}),
          createdAt: record.createdAt,
          ...(record.mock ? { mock: true } : {}),
        };
      }),
    );

    return { transfers, ...(gateway.mock ? { mock: true } : {}) };
  });
}
