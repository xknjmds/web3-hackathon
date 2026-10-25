import "server-only";
import { Paiflow } from "@paiflow/sdk";
import { StrKey } from "@stellar/stellar-sdk";
import { AMOUNT, TESTNET } from "@/lib/types";
import type { PublicConfig, Prepared } from "@/lib/types";
import { envelopeHash } from "@/lib/transaction";
export function configuration() {
  const token = process.env.PAIFLOW_API_TOKEN?.trim();
  const deploymentId = process.env.PAIFLOW_DEPLOYMENT_ID?.trim();
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
  if (
    !token ||
    !/^(pfk|pfd)_[a-f0-9]{64}$/.test(token) ||
    !deploymentId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      deploymentId,
    )
  )
    throw new Error(
      "Configure PAIFLOW_API_TOKEN and PAIFLOW_DEPLOYMENT_ID on the server.",
    );
  return { token, deploymentId, baseUrl: url.origin };
}
export function publicConfig(): PublicConfig {
  try {
    const c = configuration();
    return {
      ready: true,
      scope: `${c.baseUrl}/${c.deploymentId}`,
      deploymentUrl: `${c.baseUrl}/deployments/${c.deploymentId}`,
    };
  } catch {
    return {
      ready: false,
      message:
        "Configure the server environment to enable this testnet payment demo.",
    };
  }
}
function deployment() {
  const c = configuration();
  return new Paiflow({ baseUrl: c.baseUrl, token: c.token }).deployment(
    c.deploymentId,
  );
}
export async function paymentReady() {
  const d = deployment();
  const { data } = await d.capabilities.get();
  if (
    data.network !== "testnet" ||
    data.inputAsset?.kind !== "native" ||
    data.triggerType !== "deposit" ||
    data.operations.execute.status !== "supported"
  )
    throw new Error(
      "Use an active testnet native-XLM Receive deployment with execute support.",
    );
  return d;
}
export async function preparePayment(from: string): Promise<Prepared> {
  if (!StrKey.isValidEd25519PublicKey(from))
    throw new Error("Supply a public Stellar account.");
  const d = await paymentReady();
  const response = await d.execute.prepare({ from, amount: AMOUNT });
  const p = response.data;
  if (p.network !== "testnet" || p.networkPassphrase !== TESTNET)
    throw new Error("Only Testnet is allowed.");
  return {
    ...p,
    txHash: envelopeHash(p.xdr),
    preparationRequestId: response.metadata.historyRequestId,
  };
}
export async function submitPayment(
  signedXdr: string,
  preparationRequestId?: string,
) {
  const hash = envelopeHash(signedXdr);
  const d = await paymentReady();
  const { data } = await d.execute.submit(
    { signedXdr },
    { wait: false, preparationRequestId },
  );
  if (data.txHash !== hash)
    throw new Error(
      "Transaction hash mismatch; retain the original envelope and check its status.",
    );
  return data;
}
export async function paymentStatus(txHash: string) {
  if (!/^[a-f0-9]{64}$/.test(txHash))
    throw new Error("Invalid transaction hash.");
  const { data } = await deployment().transactions.get(txHash);
  if (data.txHash !== txHash || data.network !== "testnet")
    throw new Error(
      "Transaction evidence mismatch; retain the original record.",
    );
  return data;
}
