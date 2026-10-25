import { expect, it, vi } from "vitest";
import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  parseTransferRecord,
  type TransferRecord,
} from "@/lib/transfer-types";
import { getStore, MemoryStore } from "@/lib/transfer-store";
import { envelopeHash } from "@/lib/transaction";
import {
  fixtureAddress,
  fixtureDeploymentId,
  fixtureKeypair,
} from "./padala-fixture";
import { fixtureTransaction } from "./transaction-fixture";

vi.mock("server-only", () => ({}));

const NOW = "2026-10-25T10:00:00.000Z";
const LATER = "2026-10-25T10:03:00.000Z";

function makeRecord(overrides: Partial<TransferRecord> = {}): TransferRecord {
  const unsignedXdr = fixtureTransaction.toXDR();
  return {
    version: 1,
    transferId: "tr_test-1",
    templateId: "monthly-allotment",
    asset: "USDC",
    deploymentId: fixtureDeploymentId,
    walletAddress: fixtureAddress,
    amount: "10000000",
    mock: true,
    createdAt: NOW,
    updatedAt: NOW,
    prep: {
      unsignedXdr,
      txHash: envelopeHash(unsignedXdr),
      networkPassphrase: Networks.TESTNET,
      network: "testnet",
      expiresAt: LATER,
      prepRequestId: "history-request-1",
      preparedAt: NOW,
    },
    ...overrides,
  };
}

function signedXdr(): string {
  const tx = TransactionBuilder.fromXDR(
    fixtureTransaction.toXDR(),
    Networks.TESTNET,
  );
  tx.sign(fixtureKeypair);
  return tx.toXDR();
}

it("round-trips records through the memory store", async () => {
  const store = new MemoryStore();
  const record = makeRecord();
  await store.saveTransfer(record);
  expect(await store.getTransfer(record.transferId)).toEqual(record);
  expect(await store.getTransfer("tr_missing")).toBeNull();
});

it("finds transfers by either the preparation or submission hash", async () => {
  const store = new MemoryStore();
  const record = makeRecord();
  await store.saveTransfer(record);
  expect(await store.findByTxHash(record.prep.txHash)).toEqual(record);
  const signed = signedXdr();
  await store.markSubmitted(record.transferId, {
    signedXdr: signed,
    txHash: record.prep.txHash,
    submittedAt: NOW,
    resultStatus: "",
  });
  expect(await store.findByTxHash(record.prep.txHash)).not.toBeNull();
  expect((await store.getTransfer(record.transferId))!.submitted!.signedXdr).toBe(
    signed,
  );
});

it("markSubmitted is a race-safe one-shot", async () => {
  const store = new MemoryStore();
  const record = makeRecord();
  await store.saveTransfer(record);
  const submitted = {
    signedXdr: signedXdr(),
    txHash: record.prep.txHash,
    submittedAt: NOW,
    resultStatus: "PENDING",
  };
  expect(await store.markSubmitted(record.transferId, submitted)).toBe("saved");
  expect(await store.markSubmitted(record.transferId, submitted)).toBe(
    "already",
  );
});

it("rejects corrupt records on write and read (fail closed)", async () => {
  const store = new MemoryStore();
  const tampered = makeRecord();
  tampered.prep = { ...tampered.prep, txHash: "b".repeat(64) };
  await expect(store.saveTransfer(tampered)).rejects.toThrow("Corrupt");
  expect(await store.getTransfer(tampered.transferId)).toBeNull();

  expect(() =>
    parseTransferRecord({
      ...makeRecord(),
      prep: {
        ...makeRecord().prep,
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      },
    }),
  ).toThrow("Corrupt");
  expect(() =>
    parseTransferRecord({ ...makeRecord(), amount: "-5" }),
  ).toThrow("Corrupt");
  expect(() =>
    parseTransferRecord({ ...makeRecord(), walletAddress: "not-a-wallet" }),
  ).toThrow("Corrupt");
});

it("rejects a submitted envelope whose body differs from the preparation", async () => {
  // Signing with another key does not change the body, so build an actually
  // different transaction (same wallet, different operation).
  const changed = new TransactionBuilder(
    new Account(fixtureAddress, "8"),
    { fee: "100", networkPassphrase: Networks.TESTNET },
  )
    .addOperation(Operation.manageData({ name: "changed", value: "body" }))
    .setTimeout(180)
    .build();
  expect(() =>
    parseTransferRecord({
      ...makeRecord(),
      submitted: {
        signedXdr: changed.toXDR(),
        txHash: makeRecord().prep.txHash,
        submittedAt: NOW,
        resultStatus: "PENDING",
      },
    }),
  ).toThrow(/changed|Corrupt/);
});

it("lists a wallet's transfers newest first, bounded by the limit", async () => {
  const store = new MemoryStore();
  await store.saveTransfer(makeRecord({ transferId: "tr_a", createdAt: NOW }));
  await store.saveTransfer(
    makeRecord({ transferId: "tr_b", createdAt: "2026-10-25T10:01:00.000Z" }),
  );
  await store.saveTransfer(
    makeRecord({ transferId: "tr_c", createdAt: "2026-10-25T10:02:00.000Z" }),
  );
  const ids = async (limit: number) =>
    (await store.listByWallet(fixtureAddress, limit)).map((r) => r.transferId);
  expect(await ids(10)).toEqual(["tr_c", "tr_b", "tr_a"]);
  expect(await ids(2)).toEqual(["tr_c", "tr_b"]);
  expect(
    await store.listByWallet("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", 10),
  ).toEqual([]);
});

it("user upsert is idempotent", async () => {
  const store = new MemoryStore();
  await store.upsertUser(fixtureAddress);
  await store.upsertUser(fixtureAddress);
});

it("getStore falls back to the in-memory store when Supabase env is absent", () => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  expect(getStore()).toBeInstanceOf(MemoryStore);
});
