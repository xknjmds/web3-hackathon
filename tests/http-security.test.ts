import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureAddress } from "./padala-fixture";

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

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: new Date("2026-10-25T10:00:00Z") });
  vi.stubEnv("PAIFLOW_USE_MOCK", "true");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => vi.useRealTimers());

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://padala.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://padala.example",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

it("caps prepare, submit and status budgets independently and reports the delay", async () => {
  const { POST: prepare } = await import(
    "@/app/api/transfers/prepare/route"
  );
  const { POST: submit } = await import("@/app/api/transfers/submit/route");
  const { GET: status } = await import("@/app/api/transfers/[id]/route");
  const validPrepare = {
    templateId: "monthly-allotment",
    walletAddress: fixtureAddress,
    amount: "100",
  };
  for (let i = 0; i < 20; i++)
    expect((await prepare(post("/api/transfers/prepare", validPrepare))).status).toBe(200);
  const blockedPrepare = await prepare(
    post("/api/transfers/prepare", validPrepare, {
      "x-forwarded-for": "198.51.100.99",
    }),
  );
  expect(blockedPrepare.status).toBe(429);
  expect(blockedPrepare.headers.get("Retry-After")).toBe("60");
  expect((await blockedPrepare.json()).error).toMatchObject({
    code: "RATE_LIMITED",
    retryAfterSeconds: 60,
  });

  for (let i = 0; i < 20; i++)
    expect(
      (await submit(post("/api/transfers/submit", {
        transferId: "tr_x",
        signedXdr: "AAAA",
      }))).status,
    ).toBe(404); // budget spent, then 429
  expect(
    (
      await submit(post("/api/transfers/submit", {
        transferId: "tr_x",
        signedXdr: "AAAA",
      }))
    ).status,
  ).toBe(429);

  for (let i = 0; i < 120; i++)
    expect(
      (
        await status(
          new Request("https://padala.example/api/transfers/tr_x"),
          { params: Promise.resolve({ id: "tr_x" }) },
        )
      ).status,
    ).toBe(404);
  expect(
    (
      await status(
        new Request("https://padala.example/api/transfers/tr_x"),
        { params: Promise.resolve({ id: "tr_x" }) },
      )
    ).status,
  ).toBe(429);

  // Moving past the window restores service.
  vi.setSystemTime(new Date("2026-10-25T10:01:01Z"));
  expect((await prepare(post("/api/transfers/prepare", validPrepare))).status).toBe(200);
});

it("caps total request volume before any body parsing", async () => {
  const { POST: prepare } = await import(
    "@/app/api/transfers/prepare/route"
  );
  for (let i = 0; i < 240; i++)
    expect((await prepare(post("/api/transfers/prepare", {}))).status).toBe(400);
  const blocked = await prepare(post("/api/transfers/prepare", {}));
  expect(blocked.status).toBe(429);
});

it("rejects declared oversized bodies before reading them", async () => {
  const { POST: prepare } = await import(
    "@/app/api/transfers/prepare/route"
  );
  const response = await prepare(
    post("/api/transfers/prepare", {}, { "content-length": "210001" }),
  );
  expect(response.status).toBe(413);
});

it("counts streamed bytes and cancels oversized input despite a false length", async () => {
  const { POST: prepare } = await import(
    "@/app/api/transfers/prepare/route"
  );
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("é".repeat(100_000)));
      controller.enqueue(new Uint8Array(10_001));
    },
    cancel,
  });
  const response = await prepare(
    new Request("https://padala.example/api/transfers/prepare", {
      method: "POST",
      headers: {
        origin: "https://padala.example",
        "content-type": "application/json",
        "content-length": "1",
      },
      body: stream,
      duplex: "half",
    } as RequestInit),
  );
  expect(response.status).toBe(413);
  expect(cancel).toHaveBeenCalledOnce();
});

it("returns client errors for cross-origin, wrong media type and malformed JSON", async () => {
  const { POST: prepare } = await import(
    "@/app/api/transfers/prepare/route"
  );
  expect(
    (
      await prepare(
        post(
          "/api/transfers/prepare",
          {},
          { origin: "https://evil.example" },
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await prepare(
        post(
          "/api/transfers/prepare",
          {},
          { "content-type": "application/json-evil" },
        ),
      )
    ).status,
  ).toBe(415);
  const malformed = post("/api/transfers/prepare", {});
  vi.spyOn(malformed, "body", "get").mockReturnValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.close();
      },
    }),
  );
  expect((await prepare(malformed)).status).toBe(400);
});

it("GET routes need no Origin header", async () => {
  const { GET: templates } = await import("@/app/api/templates/route");
  const { GET: fx } = await import("@/app/api/fx/route");
  const templatesResponse = await templates();
  expect(templatesResponse.status).toBe(200);
  expect((await templatesResponse.json()).mock).toBe(true);
  const fxResponse = await fx();
  expect(fxResponse.status).toBe(200);
  expect((await fxResponse.json()).displayOnly).toBe(true);
});
