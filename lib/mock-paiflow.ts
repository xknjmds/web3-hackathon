import "server-only";
import { randomUUID } from "node:crypto";
import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { envelopeHash } from "@/lib/transaction";
import { previewPayouts } from "@/lib/preview";
import { findTemplateAny } from "@/lib/templates";
import { getStore } from "@/lib/transfer-store";
import type {
  PaymentGateway,
  PreparedPayment,
  PayoutEvent,
  SubmitResult,
  TxEvidence,
} from "@/lib/gateway";

// Mock PaiFlow gateway. Signing, body checks, storage and idempotency run
// through the exact same code paths as production — prepare returns a real
// unsigned testnet envelope built with the payer as source, so Freighter,
// assertOriginal, fee-bump rejection and the WRONG_WALLET check all behave
// identically. Only the upstream network is faked: statuses are time-based
// and payout events are synthesized from the template's shares after the
// simulated 10-20 s ingestion lag. Every response carries mock: true.
const PENDING_MS = 15_000;
const UNKNOWN_MS = 25_000;
const EVENTS_AFTER_MS = 12_000;

export class MockGateway implements PaymentGateway {
  readonly mock = true;

  async prepare(
    deploymentId: string,
    input: { from: string; amount: string },
  ): Promise<PreparedPayment> {
    const transaction = new TransactionBuilder(
      new Account(input.from, "1"),
      { fee: "100", networkPassphrase: Networks.TESTNET },
    )
      .addOperation(
        Operation.manageData({ name: "paiflow-mock", value: deploymentId }),
      )
      .setTimeout(180)
      .build();
    return {
      xdr: transaction.toXDR(),
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
      prepRequestId: "mock-" + randomUUID(),
    };
  }

  async submit(
    _deploymentId: string,
    input: { signedXdr: string },
  ): Promise<SubmitResult> {
    return { txHash: envelopeHash(input.signedXdr), status: "PENDING" };
  }

  private async submittedRecord(txHash: string) {
    const record = await getStore().findByTxHash(txHash);
    return record?.submitted ? record : null;
  }

  async transaction(
    _deploymentId: string,
    txHash: string,
  ): Promise<TxEvidence | null> {
    const record = await this.submittedRecord(txHash);
    if (!record || !record.submitted) return null;
    const elapsed = Date.now() - Date.parse(record.submitted.submittedAt);
    const status =
      elapsed < PENDING_MS
        ? "PENDING"
        : elapsed < UNKNOWN_MS
          ? "UNKNOWN"
          : "SUCCESS";
    return { txHash, status, network: "testnet" };
  }

  async events(
    _deploymentId: string,
    q: { txHash: string },
  ): Promise<PayoutEvent[]> {
    const record = await this.submittedRecord(q.txHash);
    if (!record || !record.submitted) return [];
    if (Date.now() - Date.parse(record.submitted.submittedAt) < EVENTS_AFTER_MS)
      return [];
    const template = findTemplateAny(record.templateId);
    if (!template) return [];
    const submittedAt = Date.parse(record.submitted.submittedAt);
    return previewPayouts(record.amount, template.recipients).map((payout) => {
      const recipient = template.recipients.find(
        (r) => r.id === payout.recipientId,
      );
      return {
        txHash: q.txHash,
        occurredAt: new Date(submittedAt + EVENTS_AFTER_MS).toISOString(),
        data: {
          recipient: recipient?.walletAddress ?? null,
          amount: payout.amount,
          asset: record.asset,
        },
      };
    });
  }
}
