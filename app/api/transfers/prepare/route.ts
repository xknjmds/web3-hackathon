import { randomUUID } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { readJson, respond, sameOrigin } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { limitPaymentRequests } from "@/lib/payment-rate-limit";
import { isStroops } from "@/lib/amount";
import { envelopeHash, envelopeSourceAccount } from "@/lib/transaction";
import { getGateway } from "@/lib/gateway";
import { getTemplate } from "@/lib/templates";
import { formatPeso, previewPayouts } from "@/lib/preview";
import { getFxSafe } from "@/lib/fx";
import { getStore } from "@/lib/transfer-store";
import { TESTNET } from "@/lib/types";
import type { TransferRecord } from "@/lib/transfer-types";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["templateId", "walletAddress", "amount"];

// POST /api/transfers/prepare (CONTRACT.md §2). The preparation is persisted
// before the response is returned; a storage failure refuses the step
// (fail closed) so nothing half-created exists.
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    limitPaymentRequests("request");
    const body: unknown = await readJson(request);
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    )
      throw new ApiError(400, "VALIDATION_FAILED", "Expected a JSON object.");
    const keys = Object.keys(body);
    if (
      keys.length !== ALLOWED_KEYS.length ||
      !keys.every((key) => ALLOWED_KEYS.includes(key))
    )
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "Body must contain exactly: templateId, walletAddress, amount.",
      );
    const { templateId, walletAddress, amount } = body as Record<
      string,
      unknown
    >;
    if (typeof templateId !== "string" || templateId.length > 100)
      throw new ApiError(400, "VALIDATION_FAILED", "Invalid templateId.");
    if (
      typeof walletAddress !== "string" ||
      !StrKey.isValidEd25519PublicKey(walletAddress)
    )
      throw new ApiError(
        400,
        "INVALID_WALLET",
        "walletAddress is not a valid Stellar public key.",
      );
    if (!isStroops(amount))
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "amount must be a positive integer stroop string.",
      );

    limitPaymentRequests("prepare");

    const template = getTemplate(templateId); // UNKNOWN_TEMPLATE / TEMPLATE_DISABLED
    const store = getStore();
    await store.upsertUser(walletAddress);

    const gateway = getGateway();
    const prepared = await gateway.prepare(template.deploymentId, {
      from: walletAddress,
      amount,
    });
    if (prepared.networkPassphrase !== TESTNET)
      throw new ApiError(
        400,
        "WRONG_NETWORK",
        "The deployment is not on the Stellar testnet.",
      );
    let txHash: string;
    let source: string;
    try {
      txHash = envelopeHash(prepared.xdr);
      source = envelopeSourceAccount(prepared.xdr);
    } catch {
      throw new ApiError(
        503,
        "PAIFLOW_UNAVAILABLE",
        "PaiFlow returned an unreadable transaction; no payment was created.",
      );
    }
    if (source !== walletAddress)
      throw new ApiError(
        503,
        "PAIFLOW_UNAVAILABLE",
        "PaiFlow returned a transaction for a different account; no payment was created.",
      );

    const now = new Date().toISOString();
    const record: TransferRecord = {
      version: 1,
      transferId: `tr_${randomUUID()}`,
      templateId: template.id,
      asset: template.asset,
      deploymentId: template.deploymentId,
      walletAddress,
      amount,
      mock: gateway.mock,
      createdAt: now,
      updatedAt: now,
      prep: {
        unsignedXdr: prepared.xdr,
        txHash,
        networkPassphrase: prepared.networkPassphrase,
        network: "testnet",
        expiresAt: prepared.expiresAt,
        prepRequestId: prepared.prepRequestId,
        preparedAt: now,
      },
    };
    await store.saveTransfer(record);

    // Display-only peso estimates; an FX failure must never block prepare.
    const fx = await getFxSafe();
    const payouts = previewPayouts(amount, template.recipients).map((p) => ({
      recipientId: p.recipientId,
      amount: p.amount,
      phpDisplay: formatPeso(p.amount, fx.rate),
      amountSource: "preview" as const,
    }));

    return {
      transferId: record.transferId,
      status: "PREPARED",
      unsignedXdr: prepared.xdr,
      networkPassphrase: prepared.networkPassphrase,
      expiresAt: prepared.expiresAt,
      preview: { total: amount, payouts },
      fx: { rate: fx.rate, source: fx.source, displayOnly: true },
      ...(gateway.mock ? { mock: true } : {}),
    };
  });
}
