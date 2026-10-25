import "server-only";
import { configuration, RealGateway } from "@/lib/paiflow";
import { MockGateway } from "@/lib/mock-paiflow";

// The seam between our routes and PaiFlow. Routes only ever call
// getGateway(); they cannot tell the mock from the real gateway except via
// the `mock` flag, which every response carries when the mock served it.
export type PreparedPayment = {
  xdr: string;
  network: string;
  networkPassphrase: string;
  expiresAt: string;
  prepRequestId?: string; // PaiFlow x-history-request-id
};
export type SubmitResult = { txHash: string; status: string };
export type TxEvidence = { txHash: string; status: string; network: string };
export type PayoutEvent = {
  txHash: string | null;
  occurredAt: string | null;
  data: { recipient: string | null; amount: string | null; asset: string | null };
};

export interface PaymentGateway {
  readonly mock: boolean;
  prepare(
    deploymentId: string,
    input: { from: string; amount: string },
  ): Promise<PreparedPayment>;
  submit(
    deploymentId: string,
    input: { signedXdr: string },
    opts: { preparationRequestId?: string },
  ): Promise<SubmitResult>;
  // null when PaiFlow has no record of the hash (NOT_FOUND is unresolved,
  // never a failure and never permission to replace the payment).
  transaction(deploymentId: string, txHash: string): Promise<TxEvidence | null>;
  events(deploymentId: string, q: { txHash: string }): Promise<PayoutEvent[]>;
}

let gateway: PaymentGateway | null = null;

export function getGateway(): PaymentGateway {
  if (gateway) return gateway;
  if (process.env.PAIFLOW_USE_MOCK === "true") {
    gateway = new MockGateway();
  } else {
    try {
      gateway = new RealGateway(configuration());
    } catch {
      console.warn(
        "PadalaSplit: PaiFlow credentials not configured; using Mock PaiFlow gateway (responses carry mock: true).",
      );
      gateway = new MockGateway();
    }
  }
  return gateway;
}
