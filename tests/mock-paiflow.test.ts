import { beforeEach, expect, it, vi } from "vitest";
import {
  Account,
  FeeBumpTransaction,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { MockGateway } from "@/lib/mock-paiflow";
import { MemoryStore } from "@/lib/transfer-store";
import { envelopeHash } from "@/lib/transaction";
import type { TransferRecord } from "@/lib/transfer-types";
import { fixtureAddress, fixtureDeploymentId } from "./padala-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/templates")>();
  const { fixtureFile } = await import("./padala-fixture");
  return {
    ...actual,
    findTemplateAny: (id: string) =>
      actual
        .resolveTemplates(fixtureFile, { includeDisabled: true })
        .find((t) => t.id === id) ?? null,
  };
});

const state = vi.hoisted(() => ({ store: null as MemoryStore | null }));
vi.mock("@/lib/transfer-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/transfer-store")>();
  return {
    ...actual,
    getStore: () => (state.store ??= new actual.MemoryStore()),
  };
});

let store: MemoryStore;
let gateway: MockGateway;

const NOW = "2026-10-25T10:00:00.000Z";

async function seedSubmitted(ageMs: number) {
  const tx = new TransactionBuilder(new Account(fixtureAddress, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "seed", value: "x" }))
    .setTimeout(180)
    .build();
  const unsignedXdr = tx.toXDR();
  const submittedAt = new Date(Date.parse(NOW) - ageMs).toISOString();
  const record: TransferRecord = {
    version: 1,
    transferId: "tr_mock-1",
    templateId: "monthly-allotment",
    asset: "USDC",
    deploymentId: fixtureDeploymentId,
    walletAddress: fixtureAddress,
    amount: "100000000",
    mock: true,
    createdAt: NOW,
    updatedAt: NOW,
    prep: {
      unsignedXdr,
      txHash: envelopeHash(unsignedXdr),
      networkPassphrase: Networks.TESTNET,
      network: "testnet",
      expiresAt: "2026-10-25T10:03:00.000Z",
      prepRequestId: "mock-x",
      preparedAt: NOW,
    },
    submitted: {
      signedXdr: unsignedXdr,
      txHash: envelopeHash(unsignedXdr),
      submittedAt,
      resultStatus: "PENDING",
    },
  };
  await store.saveTransfer(record);
  return record;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
  state.store = new MemoryStore();
  store = state.store;
  gateway = new MockGateway();
});

it("prepare returns a real unsigned testnet envelope sourced by the payer", async () => {
  const prepared = await gateway.prepare(fixtureDeploymentId, {
    from: fixtureAddress,
    amount: "100000000",
  });
  const tx = TransactionBuilder.fromXDR(
    prepared.xdr,
    prepared.networkPassphrase,
  );
  if (tx instanceof FeeBumpTransaction) throw new Error("unexpected fee bump");
  expect(tx.source).toBe(fixtureAddress);
  expect(prepared.networkPassphrase).toBe(Networks.TESTNET);
  expect(prepared.network).toBe("testnet");
  expect(Date.parse(prepared.expiresAt)).toBeGreaterThan(Date.now());
  expect(prepared.prepRequestId).toMatch(/^mock-/);
});

it("submit echoes the envelope hash as PENDING", async () => {
  const prepared = await gateway.prepare(fixtureDeploymentId, {
    from: fixtureAddress,
    amount: "1",
  });
  const result = await gateway.submit(fixtureDeploymentId, {
    signedXdr: prepared.xdr,
  });
  expect(result).toEqual({
    txHash: envelopeHash(prepared.xdr),
    status: "PENDING",
  });
});

it("transaction is time-based PENDING then UNKNOWN then SUCCESS", async () => {
  const record = await seedSubmitted(2_000);
  const txHash = record.prep.txHash;
  expect(await gateway.transaction(fixtureDeploymentId, txHash)).toMatchObject(
    { txHash, status: "PENDING" },
  );
  vi.setSystemTime(Date.parse(NOW) + 16_000);
  expect(await gateway.transaction(fixtureDeploymentId, txHash)).toMatchObject(
    { status: "UNKNOWN" },
  );
  vi.setSystemTime(Date.parse(NOW) + 30_000);
  expect(await gateway.transaction(fixtureDeploymentId, txHash)).toMatchObject(
    { status: "SUCCESS" },
  );
  expect(
    await gateway.transaction(fixtureDeploymentId, "a".repeat(64)),
  ).toBeNull();
});

it("events are empty during ingestion lag, then carry the template shares", async () => {
  const record = await seedSubmitted(2_000);
  const txHash = record.prep.txHash;
  expect(await gateway.events(fixtureDeploymentId, { txHash })).toEqual([]);
  vi.setSystemTime(Date.parse(NOW) + 13_000);
  const events = await gateway.events(fixtureDeploymentId, { txHash });
  // Fixture template: two recipients at 5000 bps each of 100000000.
  expect(events).toHaveLength(2);
  expect(events.map((e) => e.data.amount).sort()).toEqual([
    "50000000",
    "50000000",
  ]);
  expect(events.every((e) => e.data.asset === "USDC")).toBe(true);
  expect(events.every((e) => e.txHash === txHash)).toBe(true);
});

it("the gateway is flagged as mock", () => {
  expect(gateway.mock).toBe(true);
});
