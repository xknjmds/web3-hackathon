import { readJson, respond, sameOrigin } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { limitPaymentRequests } from "@/lib/payment-rate-limit";
import { assertOriginal, envelopeSourceAccount } from "@/lib/transaction";
import { getGateway } from "@/lib/gateway";
import { getStore } from "@/lib/transfer-store";
import type { TransferSubmitted } from "@/lib/transfer-types";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["transferId", "signedXdr"];
const SIGNED_XDR_MAX = 200_000;

// POST /api/transfers/submit (CONTRACT.md §3). The exact signed envelope is
// persisted before any upstream call, so a lost submit acknowledgement can be
// reconciled through the status route without ever resubmitting a different
// payment. Resubmitting the same envelope is safe and returns the existing
// result; a different envelope after submission is ALREADY_SUBMITTED.
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    limitPaymentRequests("request");
    const body: unknown = await readJson(request);
    if (typeof body !== "object" || body === null || Array.isArray(body))
      throw new ApiError(400, "VALIDATION_FAILED", "Expected a JSON object.");
    const keys = Object.keys(body);
    if (
      keys.length !== ALLOWED_KEYS.length ||
      !keys.every((key) => ALLOWED_KEYS.includes(key))
    )
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "Body must contain exactly: transferId, signedXdr.",
      );
    const { transferId, signedXdr } = body as Record<string, unknown>;
    if (
      typeof transferId !== "string" ||
      !/^tr_[A-Za-z0-9-]{1,80}$/.test(transferId)
    )
      throw new ApiError(400, "VALIDATION_FAILED", "Invalid transferId.");
    if (
      typeof signedXdr !== "string" ||
      signedXdr.length === 0 ||
      signedXdr.length > SIGNED_XDR_MAX ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(signedXdr)
    )
      throw new ApiError(400, "VALIDATION_FAILED", "Invalid signedXdr.");

    limitPaymentRequests("submit");

    const store = getStore();
    const record = await store.getTransfer(transferId);
    if (!record)
      throw new ApiError(404, "NOT_FOUND", "Unknown transferId.");

    const submittedResponse = (txHash: string, mock: boolean) => ({
      transferId,
      status: "SUBMITTED",
      txHash,
      ...(mock ? { mock: true } : {}),
    });

    // Idempotency first: never a second payment for the same transferId.
    if (record.submitted) {
      if (signedXdr === record.submitted.signedXdr)
        return submittedResponse(record.submitted.txHash, record.mock);
      throw new ApiError(
        409,
        "ALREADY_SUBMITTED",
        "This transfer was already submitted with a different envelope. Check its status; never create a second payment.",
      );
    }

    if (Date.now() > Date.parse(record.prep.expiresAt))
      throw new ApiError(
        410,
        "PREPARE_EXPIRED",
        "The preparation window passed before signing. Expiry alone does not prove the payment failed; check the original transferId.",
      );
    try {
      assertOriginal(record.prep.unsignedXdr, signedXdr, record.prep.txHash);
    } catch {
      throw new ApiError(
        400,
        "SIGNED_BODY_MISMATCH",
        "The signed transaction does not match the prepared transaction. The original envelope was kept; do not submit an altered transaction.",
      );
    }
    if (envelopeSourceAccount(signedXdr) !== record.walletAddress)
      throw new ApiError(
        400,
        "WRONG_WALLET",
        "The signed transaction source differs from the wallet used in prepare.",
      );

    const now = new Date().toISOString();
    const submitted: TransferSubmitted = {
      signedXdr,
      txHash: record.prep.txHash,
      submittedAt: now,
      resultStatus: "",
    };
    const outcome = await store.markSubmitted(transferId, submitted);
    if (outcome === "already") {
      // Lost our race with a concurrent submission: honor whichever envelope
      // won, never submit twice.
      const current = await store.getTransfer(transferId);
      if (current?.submitted && current.submitted.signedXdr === signedXdr)
        return submittedResponse(current.submitted.txHash, current.mock);
      throw new ApiError(
        409,
        "ALREADY_SUBMITTED",
        "This transfer was already submitted. Check its status; never create a second payment.",
      );
    }

    const result = await getGateway().submit(
      record.deploymentId,
      { signedXdr },
      { preparationRequestId: record.prep.prepRequestId },
    );
    if (result.txHash !== record.prep.txHash)
      throw new ApiError(
        503,
        "PAIFLOW_UNAVAILABLE",
        "PaiFlow reported a different transaction hash; retain the original record and check its status.",
      );
    // Best-effort status annotation; the signed envelope is already persisted,
    // so a failure here never risks a duplicate payment.
    try {
      await store.saveTransfer({
        ...record,
        submitted: { ...submitted, resultStatus: result.status },
        updatedAt: now,
      });
    } catch {
      console.warn(
        "PadalaSplit: could not record the submission status; the signed envelope is retained.",
      );
    }
    return submittedResponse(result.txHash, record.mock);
  });
}
