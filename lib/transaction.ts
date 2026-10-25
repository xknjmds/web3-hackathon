import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
export function envelopeHash(xdr: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  if (tx instanceof FeeBumpTransaction)
    throw new Error("Fee-bump envelopes are not supported.");
  return Array.from(tx.hash(), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
// The base source account of the envelope (muxed-aware). Used to verify the
// signer matches the wallet that the transfer was prepared for (WRONG_WALLET).
export function envelopeSourceAccount(xdr: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  if (tx instanceof FeeBumpTransaction)
    throw new Error("Fee-bump envelopes are not supported.");
  return tx.source;
}
export function assertOriginal(
  unsigned: string,
  signed: string,
  expectedHash: string,
) {
  if (
    envelopeHash(unsigned) !== expectedHash ||
    envelopeHash(signed) !== expectedHash
  )
    throw new Error(
      "Wallet changed the original transaction body. Keep recovery evidence; do not submit.",
    );
}
