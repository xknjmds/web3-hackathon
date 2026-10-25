import { respond } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { limitPaymentRequests } from "@/lib/payment-rate-limit";
import { getGateway } from "@/lib/gateway";
import { findTemplateAny } from "@/lib/templates";
import { formatPeso, previewPayouts } from "@/lib/preview";
import { getFxSafe } from "@/lib/fx";
import { getStore } from "@/lib/transfer-store";
import {
  normalizeStatus,
  readTransferBundle,
  unsubmittedStatus,
} from "@/lib/transfer-status";

export const dynamic = "force-dynamic";

// GET /api/transfers/:id (CONTRACT.md §4). Resolves the original txHash
// through PaiFlow and reads payout evidence; PaiFlow reads are cached for at
// least 10 s because event ingestion runs 10-20 s behind. NOT_FOUND from
// PaiFlow means UNKNOWN (keep polling the original hash), never an error and
// never permission to replace the payment.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    limitPaymentRequests("status");
    const { id } = await context.params;
    const store = getStore();
    const record = await store.getTransfer(id);
    if (!record)
      throw new ApiError(404, "NOT_FOUND", "Unknown transferId.");

    const gateway = getGateway();
    const base = {
      transferId: record.transferId,
      total: record.amount,
      asset: record.asset,
      templateId: record.templateId,
      ...(record.mock || gateway.mock ? { mock: true } : {}),
    };

    if (!record.submitted) {
      return {
        ...base,
        status: unsubmittedStatus(record),
        payouts: [],
      };
    }

    const txHash = record.submitted.txHash;
    const bundle = await readTransferBundle(record, txHash, gateway);
    const status = normalizeStatus(bundle.tx?.status);
    const fx = await getFxSafe();

    const template = findTemplateAny(record.templateId);
    const payouts: Record<string, unknown>[] = [];
    if (template) {
      const recipientByWallet = new Map(
        template.recipients.map((r) => [r.walletAddress, r]),
      );
      // TODO(A3): amountSource "transaction" requires verifying the actual
      // payout transfers from transaction evidence (RPC/Stellar Expert);
      // until then, event-reported amounts are labeled amountSource "event".
      for (const event of bundle.events) {
        const recipient = event.data.recipient
          ? recipientByWallet.get(event.data.recipient)
          : undefined;
        if (!recipient || !event.data.amount) continue;
        payouts.push({
          recipientId: recipient.id,
          name: recipient.name,
          amount: event.data.amount,
          amountSource: "event",
          phpDisplay: formatPeso(event.data.amount, fx.rate),
          chainStatus: status === "SUCCESS" ? "CONFIRMED" : "PENDING",
          txHash: event.txHash ?? txHash,
        });
      }
      if (payouts.length === 0 && status === "SUCCESS") {
        // Payout events can lag or be absent; on SUCCESS fall back to the
        // preview shares so the confirmation screen is complete.
        for (const payout of previewPayouts(record.amount, template.recipients)) {
          const recipient = template.recipients.find(
            (r) => r.id === payout.recipientId,
          )!;
          payouts.push({
            recipientId: recipient.id,
            name: recipient.name,
            amount: payout.amount,
            amountSource: "preview",
            phpDisplay: formatPeso(payout.amount, fx.rate),
            chainStatus: "CONFIRMED",
            txHash,
          });
        }
      }
    }

    return {
      ...base,
      status,
      txHash,
      // The mock hash is not a real Stellar transaction; never link it.
      ...(record.mock
        ? {}
        : { explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}` }),
      payouts,
    };
  });
}
