import { beforeEach, expect, it, vi } from "vitest";
import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { fixtureAddress, fixtureKeypair } from "./padala-fixture";
import { envelopeHash } from "@/lib/transaction";
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
    getTemplate: (id: string) => {
      const found = all().find((t) => t.id === id);
      if (!found) throw new Error("unknown template");
      return found;
    },
    findTemplateAny: (id: string) => all().find((t) => t.id === id) ?? null,
  };
});

function postPrepare() {
  return new Request("https://padala.example/api/transfers/prepare", {
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
  });
}
function postSubmit(transferId: string, signedXdr: string) {
  return new Request("https://padala.example/api/transfers/submit", {
    method: "POST",
    headers: {
      origin: "https://padala.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ transferId, signedXdr }),
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
  const { GET: status } = await import("@/app/api/transfers/[id]/route");
  const { getStore } = await import("@/lib/transfer-store");
  return { prepare, submit, status, store: getStore() };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: new Date("2026-10-25T10:00:00Z") });
  vi.stubEnv("PAIFLOW_USE_MOCK", "true");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

it("reports PREPARED before signing and EXPIRED after the window", async () => {
  const { prepare, status } = await routes();
  const prepared = await prepare(postPrepare());
  const { transferId } = await prepared.json();
  const early = await status(
    new Request(`https://padala.example/api/transfers/${transferId}`),
    { params: Promise.resolve({ id: transferId }) },
  );
  expect(early.status).toBe(200);
  expect(await early.json()).toMatchObject({
    transferId,
    status: "PREPARED",
    total: "100000000",
    asset: "USDC",
    templateId: "monthly-allotment",
    mock: true,
    payouts: [],
  });
  vi.setSystemTime(new Date("2026-10-25T10:04:00Z"));
  const expired = await status(
    new Request(`https://padala.example/api/transfers/${transferId}`),
    { params: Promise.resolve({ id: transferId }) },
  );
  expect((await expired.json()).status).toBe("EXPIRED");
});

it("walks the mock lifecycle PENDING -> UNKNOWN -> SUCCESS with payouts", async () => {
  const { prepare, submit, status } = await routes();
  const prepared = await prepare(postPrepare());
  const { transferId, unsignedXdr } = await prepared.json();
  await submit(postSubmit(transferId, sign(unsignedXdr)));

  const get = async () =>
    status(
      new Request(`https://padala.example/api/transfers/${transferId}`),
      { params: Promise.resolve({ id: transferId }) },
    );

  const pending = await get();
  expect((await pending.json()).status).toBe("PENDING");

  // The 10 s read cache means a second poll inside the window does not hit
  // the gateway again; time jumps past it for the next state.
  vi.setSystemTime(new Date("2026-10-25T10:00:08Z"));
  expect((await (await get()).json()).status).toBe("PENDING");

  vi.setSystemTime(new Date("2026-10-25T10:00:16Z"));
  expect((await (await get()).json()).status).toBe("UNKNOWN");

  vi.setSystemTime(new Date("2026-10-25T10:00:30Z"));
  const success = await get();
  const body = await success.json();
  expect(body.status).toBe("SUCCESS");
  expect(body.mock).toBe(true);
  // The mock hash is not a real Stellar transaction: never link an explorer.
  expect(body.explorerUrl).toBeUndefined();
  expect(body.txHash).toBe(envelopeHash(unsignedXdr));
  expect(body.payouts).toEqual([
    {
      recipientId: "r-parents",
      name: "Parents",
      amount: "50000000",
      amountSource: "event",
      phpDisplay: "280.00",
      chainStatus: "CONFIRMED",
      txHash: envelopeHash(unsignedXdr),
    },
    {
      recipientId: "r-sister",
      name: "Sister",
      amount: "50000000",
      amountSource: "event",
      phpDisplay: "280.00",
      chainStatus: "CONFIRMED",
      txHash: envelopeHash(unsignedXdr),
    },
  ]);
});

it("returns NOT_FOUND for unknown transfer ids", async () => {
  const { status } = await routes();
  const response = await status(
    new Request("https://padala.example/api/transfers/tr_missing"),
    { params: Promise.resolve({ id: "tr_missing" }) },
  );
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe("NOT_FOUND");
});

it("serves SUCCESS with no payouts when the template cannot be resolved", async () => {
  const { prepare, submit, status, store } = await routes();
  const prepared = await prepare(postPrepare());
  const { transferId, unsignedXdr } = await prepared.json();
  await submit(postSubmit(transferId, sign(unsignedXdr)));
  // The transfer outlives its template.
  const record = (await store.getTransfer(transferId))!;
  await store.saveTransfer({ ...record, templateId: "gone" });
  vi.setSystemTime(new Date("2026-10-25T10:00:30Z"));
  const response = await status(
    new Request(`https://padala.example/api/transfers/${transferId}`),
    { params: Promise.resolve({ id: transferId }) },
  );
  const body = await response.json();
  expect(body.status).toBe("SUCCESS");
  expect(body.payouts).toEqual([]);
});

it("recovers an older record whose outcome is not yet established as UNKNOWN", async () => {
  const { status, store } = await routes();
  // A record "submitted earlier" whose outcome the (mock) network has not
  // established: UNKNOWN means keep checking the original hash, never an
  // error and never permission to replace the payment.
  const local = new TransactionBuilder(new Account(fixtureAddress, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "orphan", value: "x" }))
    .setTimeout(180)
    .build();
  const unsignedXdr = local.toXDR();
  const now = new Date().toISOString();
  const orphan: TransferRecord = {
    version: 1,
    transferId: "tr_orphan",
    templateId: "monthly-allotment",
    asset: "USDC",
    deploymentId: "12345678-1234-1234-1234-123456789abc",
    walletAddress: fixtureAddress,
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
      preparedAt: now,
    },
    submitted: {
      signedXdr: unsignedXdr,
      txHash: envelopeHash(unsignedXdr),
      submittedAt: "2026-10-25T09:59:40.000Z", // 20 s ago: inside the UNKNOWN band
      resultStatus: "",
    },
  };
  await store.saveTransfer(orphan);
  const response = await status(
    new Request("https://padala.example/api/transfers/tr_orphan"),
    { params: Promise.resolve({ id: "tr_orphan" }) },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe("UNKNOWN");
});
