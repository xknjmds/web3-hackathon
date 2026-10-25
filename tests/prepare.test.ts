import { beforeEach, expect, it, vi } from "vitest";
import { TransactionBuilder, Networks } from "@stellar/stellar-sdk";
import { fixtureAddress, fixtureFile, fixtureKeypair } from "./padala-fixture";
import { ApiError } from "@/lib/errors";
import type { MemoryStore, TransferStore } from "@/lib/transfer-store";
import { envelopeSourceAccount } from "@/lib/transaction";
import { GET } from "@/app/api/templates/route";
import { POST } from "@/app/api/transfers/prepare/route";

vi.mock("server-only", () => ({}));

// Swap the checked-in seed for the fixture file (keeps the TODO_ placeholders
// out) while keeping the real module's error semantics. Deliberately NO
// vi.resetModules(): a single module generation keeps instanceof ApiError
// working between the mocked templates module and the routes.
vi.mock("@/lib/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/templates")>();
  const { fixtureFile } = await import("./padala-fixture");
  const all = () =>
    actual.resolveTemplates(fixtureFile, { includeDisabled: true });
  return {
    ...actual,
    listTemplates: () => actual.resolveTemplates(fixtureFile),
    getTemplate: (id: string) => {
      if (!fixtureFile.templates.some((t) => t.id === id))
        throw new ApiError(404, "UNKNOWN_TEMPLATE", "Unknown template.");
      const resolved = actual
        .resolveTemplates(fixtureFile)
        .find((t) => t.id === id);
      if (!resolved)
        throw new ApiError(
          403,
          "TEMPLATE_DISABLED",
          "This template is not enabled yet.",
        );
      return resolved;
    },
    findTemplateAny: (id: string) => all().find((t) => t.id === id) ?? null,
  };
});

// Per-test transfer store: a fresh MemoryStore each test, plus a switchable
// failing store to prove prepare fails closed when persistence breaks.
const storeState = vi.hoisted(() => ({
  fail: false,
  store: null as MemoryStore | null,
}));
vi.mock("@/lib/transfer-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/transfer-store")>();
  return {
    ...actual,
    getStore: (): TransferStore => {
      if (storeState.fail) {
        return {
          upsertUser: async () => {},
          saveTransfer: async () => {
            throw new ApiError(503, "PAIFLOW_UNAVAILABLE", "storage down");
          },
          getTransfer: async () => null,
          findByTxHash: async () => null,
          listByWallet: async () => [],
          markSubmitted: async () => "already" as const,
        };
      }
      return (storeState.store ??= new actual.MemoryStore());
    },
  };
});

function store(): MemoryStore {
  return storeState.store!;
}

function post(body: unknown, origin = "https://padala.example") {
  return new Request("https://padala.example/api/transfers/prepare", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  storeState.store = null;
  storeState.fail = false;
  vi.stubEnv("PAIFLOW_USE_MOCK", "true");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

it("prepares a transfer end-to-end with the mock gateway and persists it", async () => {
  const response = await POST(
    post({
      templateId: "monthly-allotment",
      walletAddress: fixtureAddress,
      amount: "100000000",
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    status: "PREPARED",
    networkPassphrase: "Test SDF Network ; September 2015",
    mock: true,
    preview: {
      total: "100000000",
      payouts: [
        {
          recipientId: "r-parents",
          amount: "50000000",
          phpDisplay: "280.00",
          amountSource: "preview",
        },
        {
          recipientId: "r-sister",
          amount: "50000000",
          phpDisplay: "280.00",
          amountSource: "preview",
        },
      ],
    },
    fx: { rate: "56.00", source: "fallback", displayOnly: true },
  });
  expect(typeof body.transferId).toBe("string");
  expect(body.transferId).toMatch(/^tr_/);
  expect(typeof body.expiresAt).toBe("string");
  // The mock envelope is a real testnet transaction sourced by the payer, so
  // the same wallet/body checks that production uses already apply.
  expect(envelopeSourceAccount(body.unsignedXdr)).toBe(fixtureAddress);
  // The preparation was persisted before the response: the status route can
  // recover it straight away.
  const record = await store().getTransfer(body.transferId);
  expect(record).not.toBeNull();
  expect(record!.walletAddress).toBe(fixtureAddress);
  expect(record!.prep.prepRequestId).toMatch(/^mock-/);
});

it("rejects bodies with missing or extra keys before any gateway work", async () => {
  for (const body of [
    {},
    { templateId: "monthly-allotment", walletAddress: fixtureAddress },
    {
      templateId: "monthly-allotment",
      walletAddress: fixtureAddress,
      amount: "100",
      extra: true,
    },
  ]) {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
  }
});

it("maps wallet and amount problems to their contract codes", async () => {
  const badWallet = await POST(
    post({ templateId: "monthly-allotment", walletAddress: "nope", amount: "100" }),
  );
  expect(badWallet.status).toBe(400);
  expect((await badWallet.json()).error.code).toBe("INVALID_WALLET");
  for (const amount of ["0", "-5", "1.5", "abc", "", "9".repeat(40)]) {
    const response = await POST(
      post({ templateId: "monthly-allotment", walletAddress: fixtureAddress, amount }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
  }
});

it("distinguishes unknown templates from disabled or undeployed ones", async () => {
  const unknown = await POST(
    post({ templateId: "nope", walletAddress: fixtureAddress, amount: "100" }),
  );
  expect(unknown.status).toBe(404);
  expect((await unknown.json()).error.code).toBe("UNKNOWN_TEMPLATE");
  for (const templateId of ["school-opening", "invalid-deployment"]) {
    const response = await POST(
      post({ templateId, walletAddress: fixtureAddress, amount: "100" }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("TEMPLATE_DISABLED");
  }
});

it("fails closed when the preparation cannot be persisted", async () => {
  storeState.fail = true;
  const response = await POST(
    post({
      templateId: "monthly-allotment",
      walletAddress: fixtureAddress,
      amount: "100000000",
    }),
  );
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("PAIFLOW_UNAVAILABLE");
});

it("signing the prepared envelope with Freighter's key round-trips", async () => {
  const response = await POST(
    post({
      templateId: "monthly-allotment",
      walletAddress: fixtureAddress,
      amount: "100000000",
    }),
  );
  const { unsignedXdr } = await response.json();
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(fixtureKeypair);
  const signed = tx.toXDR();
  expect(envelopeSourceAccount(signed)).toBe(fixtureAddress);
});

it("lists templates without leaking server-only fields", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.mock).toBe(true);
  expect(body.templates.map((t: { id: string }) => t.id)).toEqual([
    "monthly-allotment",
  ]);
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain("deploymentId");
  expect(serialized).not.toContain("walletAddress");
  expect(serialized).not.toContain(fixtureFile.recipients[0]!.walletAddress);
});
