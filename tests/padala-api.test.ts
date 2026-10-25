import { beforeEach, expect, it, vi } from "vitest";
import { BrowserRequestError } from "@/lib/browser-api";
import { getTransfer, prepareTransfer } from "@/lib/padala-api";

beforeEach(() => {
  vi.unstubAllGlobals();
});

it("posts JSON to same-origin routes and returns the bare contract body", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({ transferId: "tr_1", status: "PREPARED" }),
  );
  vi.stubGlobal("fetch", fetch);
  const body = await prepareTransfer({
    templateId: "monthly-allotment",
    walletAddress: "G".padEnd(56, "A"),
    amount: "10000000",
  });
  expect(body.transferId).toBe("tr_1");
  const [path, init] = fetch.mock.calls[0]!;
  expect(path).toBe("/api/transfers/prepare");
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(init.body)).toEqual({
    templateId: "monthly-allotment",
    walletAddress: "G".padEnd(56, "A"),
    amount: "10000000",
  });
});

it("maps the contract error envelope to BrowserRequestError with retry delay", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        { error: { code: "RATE_LIMITED", message: "Slow down.", retryAfterSeconds: 7 } },
        { status: 429 },
      ),
    ),
  );
  const error = await getTransfer("tr_1").catch((e) => e);
  expect(error).toBeInstanceOf(BrowserRequestError);
  expect(error).toMatchObject({
    code: "RATE_LIMITED",
    message: "Slow down.",
    status: 429,
    retryAfterMs: 7000,
  });
});

it("a network failure is not a BrowserRequestError (outcome unknown)", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  const error = await getTransfer("tr_1").catch((e) => e);
  expect(error).not.toBeInstanceOf(BrowserRequestError);
});

it("passes the caller's abort signal to fetch", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: "PENDING" }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await getTransfer("tr_1", controller.signal);
  const signal: AbortSignal = fetch.mock.calls[0]![1].signal;
  expect(signal.aborted).toBe(false);
  controller.abort();
  expect(signal.aborted).toBe(true);
});
