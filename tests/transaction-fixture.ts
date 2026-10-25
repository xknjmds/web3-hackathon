import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
// Deterministic test-only public account; no signing key is stored or needed.
export const fixtureAddress = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 7),
).publicKey();
export const fixtureTransaction = new TransactionBuilder(
  new Account(fixtureAddress, "1"),
  {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  },
)
  .addOperation(Operation.manageData({ name: "test", value: "fixture" }))
  .setTimeout(180)
  .build();
export const fixturePrepared = {
  xdr: fixtureTransaction.toXDR(),
  network: "testnet" as const,
  networkPassphrase: Networks.TESTNET,
  expiresAt: "2026-10-13T00:00:00Z",
};
