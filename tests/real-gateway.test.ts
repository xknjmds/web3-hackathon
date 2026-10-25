import { beforeEach, expect, it, vi } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import { PaiflowApiError } from "@paiflow/sdk";
import { RealGateway, configuration } from "@/lib/paiflow";
import { clearReadCache } from "@/lib/read-cache";
import { ApiError } from "@/lib/errors";
import { envelopeHash } from "@/lib/transaction";
import { fixtureAddress, fixtureDeploymentId } from "./padala-fixture";
import { fixturePrepared } from "./transaction-fixture";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  status: vi.fn(),
  events: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock("@paiflow/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paiflow/sdk")>();
  return {
    ...actual,
    Paiflow: class {
      constructor(options: unknown) {
        mocks.constructor(options);
      }
      deployment() {
        return {
          capabilities: { get: mocks.get },
          execute: { prepare: mocks.prepare, submit: mocks.submit },
          transactions: { get: mocks.status },
          events: { list: mocks.events },
        };
      }
    },
  };
});

function apiError(status: number, code: string, message: string, retryAfter?: string) {
  return new PaiflowApiError(status, code, message, null, null, {
    status,
    requestId: "req-1",
    retryAfter,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  clearReadCache();
  vi.stubEnv("PAIFLOW_BASE_URL", "https://beta.app.paiflow.xyz");
  vi.stubEnv("PAIFLOW_API_TOKEN", "pfd_" + "a".repeat(64));
  mocks.get.mockResolvedValue({
    data: {
      network: "testnet",
      inputAsset: { kind: "known", symbol: "USDC" },
      triggerType: "deposit",
      operations: { execute: { status: "supported" } },
    },
  });
  mocks.prepare.mockResolvedValue({
    data: fixturePrepared,
    metadata: { historyRequestId: "history-request-1" },
  });
  mocks.submit.mockResolvedValue({
    data: { txHash: envelopeHash(fixturePrepared.xdr), status: "PENDING" },
  });
});

function gateway() {
  return new RealGateway(configuration());
}

it("prepare returns the unsigned envelope with the history request id", async () => {
  const prepared = await gateway().prepare(fixtureDeploymentId, {
    from: fixtureAddress,
    amount: "100000000",
  });
  expect(prepared).toEqual({
    xdr: fixturePrepared.xdr,
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    expiresAt: fixturePrepared.expiresAt,
    prepRequestId: "history-request-1",
  });
  expect(mocks.prepare).toHaveBeenCalledWith({
    from: fixtureAddress,
    amount: "100000000",
  });
});

it("accepts native XLM and testnet USDC deployments but refuses anything else", async () => {
  // Distinct deployment ids so each case gets its own capabilities cache entry.
  for (const [deploymentId, inputAsset] of [
    ["dep-native", { kind: "native" }],
    ["dep-usdc", { kind: "known", symbol: "USDC" }],
  ] as const) {
    mocks.get.mockResolvedValueOnce({
      data: {
        network: "testnet",
        inputAsset,
        triggerType: "deposit",
        operations: { execute: { status: "supported" } },
      },
    });
    await expect(
      gateway().prepare(deploymentId, {
        from: fixtureAddress,
        amount: "1",
      }),
    ).resolves.toBeDefined();
  }
  for (const [deploymentId, data] of [
    [
      "dep-mainnet",
      {
        network: "mainnet",
        inputAsset: { kind: "native" },
        triggerType: "deposit",
        operations: { execute: { status: "supported" } },
      },
    ],
    [
      "dep-btc",
      {
        network: "testnet",
        inputAsset: { kind: "known", symbol: "BTC" },
        triggerType: "deposit",
        operations: { execute: { status: "supported" } },
      },
    ],
    [
      "dep-unsupported",
      {
        network: "testnet",
        inputAsset: { kind: "native" },
        triggerType: "deposit",
        operations: { execute: { status: "unsupported" } },
      },
    ],
  ] as const) {
    mocks.get.mockResolvedValueOnce({ data });
    await expect(
      gateway().prepare(deploymentId, {
        from: fixtureAddress,
        amount: "1",
      }),
    ).rejects.toMatchObject({ code: "PAIFLOW_UNAVAILABLE" });
  }
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
});

it("maps PaiFlow errors to contract codes, keeping upstream validation messages", async () => {
  mocks.prepare.mockRejectedValue(
    apiError(422, "VALIDATION", "Trustline missing for account GABC..."),
  );
  const validation = await gateway()
    .prepare(fixtureDeploymentId, { from: fixtureAddress, amount: "1" })
    .catch((e) => e);
  expect(validation).toBeInstanceOf(ApiError);
  expect(validation).toMatchObject({
    status: 400,
    code: "VALIDATION_FAILED",
    message: "Trustline missing for account GABC...",
  });

  mocks.prepare.mockRejectedValue(
    apiError(429, "RATE_LIMITED", "slow down", "30"),
  );
  const limited = await gateway()
    .prepare(fixtureDeploymentId, { from: fixtureAddress, amount: "1" })
    .catch((e) => e);
  expect(limited).toMatchObject({ status: 429, code: "RATE_LIMITED" });

  mocks.prepare.mockRejectedValue(apiError(502, "UPSTREAM_RPC", "rpc down"));
  await expect(
    gateway().prepare(fixtureDeploymentId, { from: fixtureAddress, amount: "1" }),
  ).rejects.toMatchObject({ status: 503, code: "PAIFLOW_UNAVAILABLE" });

  // Token validity never leaks.
  mocks.prepare.mockRejectedValue(
    apiError(401, "UNAUTHENTICATED", "bad token"),
  );
  const unauthorized = await gateway()
    .prepare(fixtureDeploymentId, { from: fixtureAddress, amount: "1" })
    .catch((e) => e);
  expect(unauthorized).toMatchObject({
    status: 503,
    code: "PAIFLOW_UNAVAILABLE",
  });
  expect(unauthorized.message).not.toContain("token");
});

it("refuses a preparation built for another network", async () => {
  mocks.prepare.mockResolvedValue({
    data: {
      ...fixturePrepared,
      network: "mainnet",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    },
    metadata: {},
  });
  await expect(
    gateway().prepare(fixtureDeploymentId, { from: fixtureAddress, amount: "1" }),
  ).rejects.toMatchObject({ status: 400, code: "WRONG_NETWORK" });
});

it("submits the exact envelope with the preparation request id and checks the hash", async () => {
  const signedXdr = fixturePrepared.xdr;
  const result = await gateway().submit(
    fixtureDeploymentId,
    { signedXdr },
    { preparationRequestId: "history-request-1" },
  );
  expect(result).toEqual({
    txHash: envelopeHash(signedXdr),
    status: "PENDING",
  });
  expect(mocks.submit).toHaveBeenCalledWith(
    { signedXdr },
    { wait: false, preparationRequestId: "history-request-1" },
  );

  mocks.submit.mockResolvedValue({
    data: { txHash: "b".repeat(64), status: "SUCCESS" },
  });
  await expect(
    gateway().submit(fixtureDeploymentId, { signedXdr }, {}),
  ).rejects.toMatchObject({ status: 503, code: "PAIFLOW_UNAVAILABLE" });
});

it("treats a 404 transaction lookup as unresolved (null), and FAILED as HTTP 200", async () => {
  const hash = envelopeHash(fixturePrepared.xdr);
  mocks.status.mockRejectedValue(apiError(404, "NOT_FOUND", "missing"));
  expect(await gateway().transaction(fixtureDeploymentId, hash)).toBeNull();

  mocks.status.mockResolvedValue({
    data: { txHash: hash, status: "FAILED", network: "testnet" },
  });
  expect(await gateway().transaction(fixtureDeploymentId, hash)).toEqual({
    txHash: hash,
    status: "FAILED",
    network: "testnet",
  });

  mocks.status.mockResolvedValue({
    data: { txHash: "b".repeat(64), status: "SUCCESS", network: "testnet" },
  });
  await expect(
    gateway().transaction(fixtureDeploymentId, hash),
  ).rejects.toMatchObject({ status: 503, code: "PAIFLOW_UNAVAILABLE" });
});

it("filters and maps PAYOUT events", async () => {
  mocks.events.mockResolvedValue({
    data: {
      items: [
        {
          kind: "PAYOUT",
          txHash: "a".repeat(64),
          occurredAt: "2026-10-25T10:00:10Z",
          data: { recipient: fixtureAddress, amount: "50000000", asset: "USDC" },
        },
        { kind: "STATUS_CHANGE", data: { status: "SUCCESS" } },
        { kind: "PAYOUT", txHash: null, occurredAt: null, data: null },
      ],
    },
  });
  const events = await gateway().events(fixtureDeploymentId, {
    txHash: "a".repeat(64),
  });
  expect(events).toHaveLength(2);
  expect(events[0]).toEqual({
    txHash: "a".repeat(64),
    occurredAt: "2026-10-25T10:00:10Z",
    data: { recipient: fixtureAddress, amount: "50000000", asset: "USDC" },
  });
  expect(events[1]).toEqual({
    txHash: null,
    occurredAt: null,
    data: { recipient: null, amount: null, asset: null },
  });
});
