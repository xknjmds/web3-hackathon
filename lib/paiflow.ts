import "server-only";
import { Paiflow, PaiflowApiError } from "@paiflow/sdk";
import { ApiError, mapPaiflowError } from "@/lib/errors";
import { TESTNET } from "@/lib/types";
import { envelopeHash } from "@/lib/transaction";
import { getCached } from "@/lib/read-cache";
import type {
  PaymentGateway,
  PreparedPayment,
  PayoutEvent,
  SubmitResult,
  TxEvidence,
} from "@/lib/gateway";

// Server-only PaiFlow configuration. Deployment IDs come from templates.json
// (server-only), never from env; one token is used across deployments. The
// token and origin never leave this module.
export function configuration() {
  const token = process.env.PAIFLOW_API_TOKEN?.trim();
  const url = new URL(
    process.env.PAIFLOW_BASE_URL || "https://beta.app.paiflow.xyz",
  );
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("Configure a secure platform origin.");
  if (!token || !/^(pfk|pfd)_[a-f0-9]{64}$/.test(token))
    throw new Error("Configure PAIFLOW_API_TOKEN on the server.");
  return { token, baseUrl: url.origin };
}

// PaiFlow capabilities are cached per deployment for 60 s to stay well under
// the 60/min capabilities budget with several deployments.
const CAPABILITIES_TTL_MS = 60_000;

type RawEventItem = {
  kind?: string;
  txHash?: string | null;
  occurredAt?: string | null;
  data?: unknown;
};

// TODO(A3 VERIFY): exact PAYOUT event data shape; the recipient field name;
// whether amounts are literal transfers or shares (affects amountSource).
// Only this function changes when real event shapes are confirmed.
export function toPayoutEvents(items: unknown): PayoutEvent[] {
  if (!Array.isArray(items)) return [];
  const out: PayoutEvent[] = [];
  for (const item of items as RawEventItem[]) {
    if (item?.kind !== "PAYOUT") continue;
    const data = (
      item.data && typeof item.data === "object" ? item.data : null
    ) as Record<string, unknown> | null;
    out.push({
      txHash: item.txHash ?? null,
      occurredAt: item.occurredAt ?? null,
      data: {
        recipient: typeof data?.recipient === "string" ? data.recipient : null,
        amount: typeof data?.amount === "string" ? data.amount : null,
        asset: typeof data?.asset === "string" ? data.asset : null,
      },
    });
  }
  return out;
}

export class RealGateway implements PaymentGateway {
  readonly mock = false;
  private readonly client: Paiflow;

  constructor(config: { token: string; baseUrl: string }) {
    this.client = new Paiflow({ baseUrl: config.baseUrl, token: config.token });
  }

  private deployment(deploymentId: string) {
    return this.client.deployment(deploymentId);
  }

  // Wrap upstream calls so PaiflowApiError never leaks past this module:
  // routes only ever see contract ApiError instances.
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof PaiflowApiError) throw mapPaiflowError(error);
      throw error;
    }
  }

  // Contract-driven deviation from the starter (AGENTS.md): testnet USDC
  // known-asset Split deployments are accepted alongside native XLM. Mainnet
  // is always refused.
  private async assertReady(deploymentId: string) {
    await getCached(`caps:${deploymentId}`, CAPABILITIES_TTL_MS, async () => {
      const { data } = await this.deployment(deploymentId).capabilities.get();
      const inputAsset = data.inputAsset as
        | { kind?: string; symbol?: string }
        | undefined;
      const acceptableAsset =
        inputAsset?.kind === "native" ||
        (inputAsset?.kind === "known" && inputAsset?.symbol === "USDC");
      if (
        data.network !== "testnet" ||
        data.triggerType !== "deposit" ||
        data.operations.execute.status !== "supported" ||
        !acceptableAsset
      )
        throw new ApiError(
          503,
          "PAIFLOW_UNAVAILABLE",
          "The configured deployment is not an active testnet deposit deployment with execute support.",
        );
      return true;
    });
  }

  async prepare(
    deploymentId: string,
    input: { from: string; amount: string },
  ): Promise<PreparedPayment> {
    await this.call(() => this.assertReady(deploymentId));
    const response = await this.call(() =>
      this.deployment(deploymentId).execute.prepare({
        from: input.from,
        amount: input.amount,
      }),
    );
    const p = response.data;
    if (p.network !== "testnet" || p.networkPassphrase !== TESTNET)
      throw new ApiError(
        400,
        "WRONG_NETWORK",
        "The deployment is not on the Stellar testnet.",
      );
    return {
      xdr: p.xdr,
      network: p.network,
      networkPassphrase: p.networkPassphrase,
      expiresAt: p.expiresAt,
      prepRequestId: response.metadata.historyRequestId,
    };
  }

  async submit(
    deploymentId: string,
    input: { signedXdr: string },
    opts: { preparationRequestId?: string },
  ): Promise<SubmitResult> {
    const hash = envelopeHash(input.signedXdr);
    const { data } = await this.call(() =>
      this.deployment(deploymentId).execute.submit(
        { signedXdr: input.signedXdr },
        { wait: false, preparationRequestId: opts.preparationRequestId },
      ),
    );
    if (data.txHash !== hash)
      throw new ApiError(
        503,
        "PAIFLOW_UNAVAILABLE",
        "PaiFlow reported a different transaction hash; retain the original record and check its status.",
      );
    return { txHash: data.txHash, status: data.status };
  }

  async transaction(
    deploymentId: string,
    txHash: string,
  ): Promise<TxEvidence | null> {
    if (!/^[a-f0-9]{64}$/.test(txHash))
      throw new ApiError(400, "VALIDATION_FAILED", "Invalid transaction hash.");
    try {
      const { data } = await this.deployment(deploymentId).transactions.get(
        txHash,
      );
      // FAILED arrives as HTTP 200 with data.status === "FAILED": the body,
      // not the status code, carries the outcome.
      if (data.txHash !== txHash || data.network !== "testnet")
        throw new ApiError(
          503,
          "PAIFLOW_UNAVAILABLE",
          "Transaction evidence mismatch; retain the original record.",
        );
      return { txHash: data.txHash, status: data.status, network: data.network };
    } catch (error) {
      // Missing history is unresolved, not a failure: the caller keeps the
      // transfer UNKNOWN and keeps polling the original hash.
      if (error instanceof PaiflowApiError && error.status === 404)
        return null;
      if (error instanceof PaiflowApiError) throw mapPaiflowError(error);
      throw error;
    }
  }

  async events(
    deploymentId: string,
    q: { txHash: string },
  ): Promise<PayoutEvent[]> {
    const { data } = await this.call(() =>
      this.deployment(deploymentId).events.list({ txHash: q.txHash, limit: 100 }),
    );
    return toPayoutEvents(data?.items);
  }
}
