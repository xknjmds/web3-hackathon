export const TESTNET = "Test SDF Network ; September 2015";
export const AMOUNT = "10000000";
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
