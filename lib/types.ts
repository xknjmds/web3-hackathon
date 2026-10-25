export const TESTNET = "Test SDF Network ; September 2015";
export const AMOUNT = "10000000";
export type Asset = "USDC" | "XLM";
export type TransferStatus =
  | "PREPARED"
  | "SUBMITTED"
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "REJECTED"
  | "UNKNOWN"
  | "EXPIRED";
export type ChainStatus = "PENDING" | "CONFIRMED" | "FAILED";
export type AmountSource = "transaction" | "event" | "preview";
export type Prepared = {
  xdr: string;
  network: "testnet" | "mainnet";
  networkPassphrase: string;
  expiresAt: string;
  preparationRequestId?: string;
  txHash: string;
};
export type PublicConfig =
  | { ready: false; message: string }
  | { ready: true; scope: string; deploymentUrl: string };
export type Result = { txHash: string; status: string; network?: string };
