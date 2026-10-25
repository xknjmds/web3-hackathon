import { beforeEach, expect, it, vi } from "vitest";
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { fixtureAddress, fixtureKeypair, otherAddress } from "./padala-fixture";
import { envelopeHash } from "@/lib/transaction";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/templates")>();
  const { fixtureFile } = await import("./padala-fixture");
  const all = () =>
    actual.resolveTemplates(fixtureFile, { includeDisabled: true });
  return {
    ...actual,
    listTemplates: () => actual.resolveTemplates(fixtureFile),
    getTemplate: (id: string) => {
      const found = all().find((t) => t.id === id);
      if (!found) throw new Error("unknown template");
      return found;
    },
    findTemplateAny: (id: string) => all().find((t) => t.id === id) ?? null,
  };
});

function postPrepare(amount = "100000000") {
  return new Request("https://padala.example/api/transfers/prepare", {
    method: "POST",
    headers: {
      origin: "https://padala.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      templateId: "monthly-allotment",
      walletAddress: fixtureAddress,
      amount,
    }),
  });
}
function postSubmit(transferId: string, signedXdr: string) {
  return new Request("https://padala.example/api/transfers/submit", {
    method: "POST",
    headers: {
      origin: "https://padala.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ transferId, signedXdr }),
  });
}
function sign(xdr: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  tx.sign(fixtureKeypair);
  return tx.toXDR();
}
const historyRequest = (query: string) =>
  new Request(`https://padala.example/api/transfers${query}`);

async function routes() {
  vi.resetModules();
  const { POST: prepare } = await import(
    "@/app/api/transfers/prepare/route"
  );
  const { POST: submit } = await import("@/app/api/transfers/submit/route");
  const { GET: history } = await import("@/app/api/transfers/route");
  const { getGateway } = await import("@/lib/gateway");
  return { prepare, submit, history, gateway: getGateway() };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: new Date("2026-10-25T10:00:00Z") });
  vi.stubEnv("PAIFLOW_USE_MOCK", "true");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

it("lists a wallet's transfers newest first with resolved statuses", async () => {
  const { prepare, submit, history } = await routes();
  const first = await (await prepare(postPrepare("100000000"))).json();
  await submit(postSubmit(first.transferId, sign(first.unsignedXdr)));
  vi.setSystemTime(new Date("2026-10-25T10:00:05Z"));
  const second = await (await prepare(postPrepare("20000000"))).json();

  vi.setSystemTime(new Date("2026-10-25T10:00:30Z"));
  const response = await history(historyRequest(`?wallet=${fixtureAddress}`));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.mock).toBe(true);
  expect(body.transfers).toEqual([
    {
      transferId: second.transferId,
      templateId: "monthly-allotment",
      total: "20000000",
      asset: "USDC",
      status: "PREPARED",
      createdAt: "2026-10-25T10:00:05.000Z",
      mock: true,
    },
    {
      transferId: first.transferId,
      templateId: "monthly-allotment",
      total: "100000000",
      asset: "USDC",
      status: "SUCCESS",
      txHash: envelopeHash(first.unsignedXdr),
      createdAt: "2026-10-25T10:00:00.000Z",
      mock: true,
    },
  ]);
  // Server-only fields never leave the server.
  const raw = JSON.stringify(body);
  for (const secret of ["deploymentId", "walletAddress", "Xdr", "prep"])
    expect(raw).not.toContain(secret);
});

it("reports EXPIRED for unsigned transfers past the window", async () => {
  const { prepare, history } = await routes();
  await prepare(postPrepare());
  vi.setSystemTime(new Date("2026-10-25T10:04:00Z"));
  const body = await (
    await history(historyRequest(`?wallet=${fixtureAddress}`))
  ).json();
  expect(body.transfers.map((t: { status: string }) => t.status)).toEqual([
    "EXPIRED",
  ]);
});

it("only returns the requested wallet's transfers", async () => {
  const { prepare, history } = await routes();
  await prepare(postPrepare());
  const body = await (
    await history(historyRequest(`?wallet=${otherAddress}`))
  ).json();
  expect(body.transfers).toEqual([]);
});

it("rejects a missing or invalid wallet", async () => {
  const { history } = await routes();
  for (const query of ["", "?wallet=", "?wallet=GNOTAWALLET"]) {
    const response = await history(historyRequest(query));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_WALLET");
  }
});

it("reports UNKNOWN for a row whose PaiFlow lookup fails", async () => {
  const { prepare, submit, history, gateway } = await routes();
  const prepared = await (await prepare(postPrepare())).json();
  await submit(postSubmit(prepared.transferId, sign(prepared.unsignedXdr)));
  vi.spyOn(gateway, "transaction").mockRejectedValue(new Error("upstream"));
  const response = await history(historyRequest(`?wallet=${fixtureAddress}`));
  expect(response.status).toBe(200);
  const [row] = (await response.json()).transfers;
  expect(row.status).toBe("UNKNOWN");
  expect(row.txHash).toBe(envelopeHash(prepared.unsignedXdr));
});
