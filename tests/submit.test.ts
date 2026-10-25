import { beforeEach, expect, it, vi } from "vitest";
import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  fixtureAddress,
  fixtureDeploymentId,
  fixtureKeypair,
  otherAddress,
} from "./padala-fixture";
import { envelopeHash } from "@/lib/transaction";
import { fixtureTransaction } from "./transaction-fixture";
import type { TransferRecord } from "@/lib/transfer-types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/templates")>();
  const { fixtureFile } = await import("./padala-fixture");
  const all = () =>
    actual.resolveTemplates(fixtureFile, { includeDisabled: true });
  return {
    ...actual,
    listTemplates: () => actual.resolveTemplates(fixtureFile),
    getTemplate: (id: string) =>
      all().find((t) => t.id === id) ??
      (() => {
        throw new Error("unknown template");
      })(),
    findTemplateAny: (id: string) => all().find((t) => t.id === id) ?? null,
  };
});

function post(body: unknown, origin = "https://padala.example") {
  return new Request("https://padala.example/api/transfers/submit", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sign(xdr: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  tx.sign(fixtureKeypair);
  return tx.toXDR();
}

async function routes() {
  vi.resetModules();
  const { POST: prepare } = await import(
    "@/app/api/transfers/prepare/route"
  );
  const { POST: submit } = await import("@/app/api/transfers/submit/route");
  const { getStore } = await import("@/lib/transfer-store");
  return { prepare, submit, store: getStore() };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: new Date("2026-10-25T10:00:00Z") });
  vi.stubEnv("PAIFLOW_USE_MOCK", "true");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

it("submits the exact signed envelope and answers resubmission idempotently", async () => {
  const { prepare, submit, store } = await routes();
  const prepared = await prepare(
    new Request("https://padala.example/api/transfers/prepare", {
      method: "POST",
      headers: {
        origin: "https://padala.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        templateId: "monthly-allotment",
        walletAddress: fixtureAddress,
        amount: "100000000",
      }),
    }),
  );
  const { transferId, unsignedXdr } = await prepared.json();
  const signedXdr = sign(unsignedXdr);

  const response = await submit(post({ transferId, signedXdr }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    transferId,
    status: "SUBMITTED",
    txHash: envelopeHash(unsignedXdr),
    mock: true,
  });
  // The exact signed envelope was persisted before submission.
  const record = await store.getTransfer(transferId);
  expect(record!.submitted!.signedXdr).toBe(signedXdr);
  expect(record!.submitted!.resultStatus).toBe("PENDING");

  // Resubmitting the same envelope returns the existing result (never a
  // second payment).
  const again = await submit(post({ transferId, signedXdr }));
  expect(again.status).toBe(200);
  expect((await again.json()).txHash).toBe(body.txHash);
});

it("refuses a different envelope after submission with ALREADY_SUBMITTED", async () => {
  const { prepare, submit } = await routes();
  const prepared = await prepare(
    new Request("https://padala.example/api/transfers/prepare", {
      method: "POST",
      headers: {
        origin: "https://padala.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        templateId: "monthly-allotment",
        walletAddress: fixtureAddress,
        amount: "100000000",
      }),
    }),
  );
  const { transferId, unsignedXdr } = await prepared.json();
  await submit(post({ transferId, signedXdr: sign(unsignedXdr) }));

  const altered = new TransactionBuilder(new Account(fixtureAddress, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "different", value: "body" }))
    .setTimeout(180)
    .build();
  const response = await submit(post({ transferId, signedXdr: altered.toXDR() }));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("ALREADY_SUBMITTED");
});

it("rejects a changed transaction body with SIGNED_BODY_MISMATCH", async () => {
  const { prepare, submit } = await routes();
  const prepared = await prepare(
    new Request("https://padala.example/api/transfers/prepare", {
      method: "POST",
      headers: {
        origin: "https://padala.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        templateId: "monthly-allotment",
        walletAddress: fixtureAddress,
        amount: "100000000",
      }),
    }),
  );
  const { transferId } = await prepared.json();
  // An envelope for the same wallet but a different body (e.g. another
  // preparation's envelope).
  const changed = TransactionBuilder.fromXDR(
    fixtureTransaction.toXDR(),
    Networks.TESTNET,
  );
  changed.sign(fixtureKeypair);
  const response = await submit(
    post({ transferId, signedXdr: changed.toXDR() }),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("SIGNED_BODY_MISMATCH");
});

it("rejects an envelope whose source is not the prepared wallet", async () => {
  const { submit, store } = await routes();
  const unsignedXdr = fixtureTransaction.toXDR(); // source is fixtureAddress
  const now = new Date().toISOString();
  const record: TransferRecord = {
    version: 1,
    transferId: "tr_wrong-wallet",
    templateId: "monthly-allotment",
    asset: "USDC",
    deploymentId: fixtureDeploymentId,
    walletAddress: otherAddress, // prepared for a different wallet
    amount: "100000000",
    mock: true,
    createdAt: now,
    updatedAt: now,
    prep: {
      unsignedXdr,
      txHash: envelopeHash(unsignedXdr),
      networkPassphrase: Networks.TESTNET,
      network: "testnet",
      expiresAt: "2026-10-25T10:03:00.000Z",
      prepRequestId: "mock-x",
      preparedAt: now,
    },
  };
  await store.saveTransfer(record);
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(fixtureKeypair);
  const response = await submit(
    post({ transferId: record.transferId, signedXdr: tx.toXDR() }),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("WRONG_WALLET");
});

it("refuses submission after the preparation window with PREPARE_EXPIRED", async () => {
  const { prepare, submit } = await routes();
  const prepared = await prepare(
    new Request("https://padala.example/api/transfers/prepare", {
      method: "POST",
      headers: {
        origin: "https://padala.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        templateId: "monthly-allotment",
        walletAddress: fixtureAddress,
        amount: "100000000",
      }),
    }),
  );
  const { transferId, unsignedXdr } = await prepared.json();
  vi.setSystemTime(new Date("2026-10-25T10:05:00Z"));
  const response = await submit(post({ transferId, signedXdr: sign(unsignedXdr) }));
  expect(response.status).toBe(410);
  expect((await response.json()).error.code).toBe("PREPARE_EXPIRED");
});

it("returns NOT_FOUND for unknown transfer ids and validates the body first", async () => {
  const { submit } = await routes();
  const missing = await submit(post({ transferId: "tr_nope", signedXdr: "AAAA" }));
  expect(missing.status).toBe(404);
  expect((await missing.json()).error.code).toBe("NOT_FOUND");
  for (const body of [
    {},
    { transferId: "tr_x" },
    { transferId: "tr_x", signedXdr: "AAAA", extra: 1 },
    { transferId: 5, signedXdr: "AAAA" },
  ]) {
    const response = await submit(post(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
  }
});

it("honors a concurrent submission that won the race instead of paying twice", async () => {
  const { prepare, submit, store } = await routes();
  const prepared = await prepare(
    new Request("https://padala.example/api/transfers/prepare", {
      method: "POST",
      headers: {
        origin: "https://padala.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        templateId: "monthly-allotment",
        walletAddress: fixtureAddress,
        amount: "100000000",
      }),
    }),
  );
  const { transferId, unsignedXdr } = await prepared.json();
  const signedXdr = sign(unsignedXdr);
  // Another request wins the race after our route validated the envelope.
  expect(
    await store.markSubmitted(transferId, {
      signedXdr,
      txHash: envelopeHash(unsignedXdr),
      submittedAt: new Date().toISOString(),
      resultStatus: "",
    }),
  ).toBe("saved");
  const response = await submit(post({ transferId, signedXdr }));
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe("SUBMITTED");
});
