import { beforeEach, afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const calls = vi.hoisted(() => ({
  preparePayment: vi.fn(async () => ({ prepared: true })),
  submitPayment: vi.fn(async () => ({ status: "PENDING" })),
  paymentStatus: vi.fn(async () => ({ status: "UNKNOWN" })),
}));
vi.mock("@/lib/paiflow", () => calls);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  calls.preparePayment.mockResolvedValue({ prepared: true });
  vi.spyOn(Date, "now").mockReturnValue(100_000);
});
afterEach(() => vi.restoreAllMocks());

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://starter.example/api/pay", {
    method: "POST",
    headers: {
      origin: "https://starter.example",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

it("limits preparation without spending the status or submission allowances", async () => {
  const { POST } = await import("@/app/api/pay/route");
  for (const [action, field, value, limit] of [
    ["prepare", "from", "public-account", 20],
    ["status", "txHash", "a".repeat(64), 120],
    ["submit", "signedXdr", "fixture-envelope", 20],
  ] as const) {
    for (let i = 0; i < limit; i++)
      expect((await POST(request({ action, [field]: value }))).status).toBe(
        200,
      );
    const blocked = await POST(
      request(
        { action, [field]: value },
        {
          "x-forwarded-for": "198.51.100.99",
          "x-real-ip": "198.51.100.98",
        },
      ),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED");
  }
  expect(calls.preparePayment).toHaveBeenCalledTimes(20);
  expect(calls.submitPayment).toHaveBeenCalledTimes(20);
  expect(calls.paymentStatus).toHaveBeenCalledTimes(120);
  vi.mocked(Date.now).mockReturnValue(160_000);
  expect(
    (await POST(request({ action: "prepare", from: "public-account" }))).status,
  ).toBe(200);
});

it("also caps invalid traffic before SDK calls or body parsing", async () => {
  const { POST } = await import("@/app/api/pay/route");
  for (let i = 0; i < 240; i++)
    expect((await POST(request({ action: "unknown" }))).status).toBe(400);
  expect((await POST(request({ action: "unknown" }))).status).toBe(429);
  expect(calls.preparePayment).not.toHaveBeenCalled();
  expect(calls.submitPayment).not.toHaveBeenCalled();
});

it("rejects declared oversized bodies before reading them", async () => {
  const { POST } = await import("@/app/api/pay/route");
  const response = await POST(request({}, { "content-length": "210001" }));
  expect(response.status).toBe(413);
  expect(calls.preparePayment).not.toHaveBeenCalled();
});

it("counts streamed bytes and cancels oversized input despite a false length", async () => {
  const { POST } = await import("@/app/api/pay/route");
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("é".repeat(100_000)));
      controller.enqueue(new Uint8Array(10_001));
    },
    cancel,
  });
  const response = await POST(
    new Request("https://starter.example/api/pay", {
      method: "POST",
      headers: {
        origin: "https://starter.example",
        "content-type": "application/json",
        "content-length": "1",
      },
      body: stream,
      duplex: "half",
    } as RequestInit),
  );
  expect(response.status).toBe(413);
  expect(cancel).toHaveBeenCalledOnce();
  expect(calls.submitPayment).not.toHaveBeenCalled();
});

it("returns client errors for malformed JSON, wrong media type and cross-origin requests", async () => {
  const { POST } = await import("@/app/api/pay/route");
  expect(
    (await POST(request({}, { origin: "https://evil.example" }))).status,
  ).toBe(403);
  expect(
    (await POST(request({}, { "content-type": "application/json-evil" })))
      .status,
  ).toBe(415);
  const malformed = request({});
  vi.spyOn(malformed, "body", "get").mockReturnValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.close();
      },
    }),
  );
  expect((await POST(malformed)).status).toBe(400);
  expect(calls.preparePayment).not.toHaveBeenCalled();
});

it("accepts valid JSON at the byte limit and rejects oversized bodies without a declared length", async () => {
  const { readJson } = await import("@/lib/http");
  const value = "x".repeat(209998);
  expect(await readJson(request(value))).toBe(value);
  await expect(readJson(request(value + "x"))).rejects.toMatchObject({
    status: 413,
  });
});

it("reports the remaining delay and keeps failed upstream calls within the budget", async () => {
  const { POST } = await import("@/app/api/pay/route");
  calls.preparePayment.mockRejectedValue(new Error("upstream unavailable"));
  for (let i = 0; i < 20; i++)
    expect(
      (await POST(request({ action: "prepare", from: "public-account" })))
        .status,
    ).toBe(502);
  vi.mocked(Date.now).mockReturnValue(130_001);
  const blocked = await POST(
    request({ action: "prepare", from: "public-account" }),
  );
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("Retry-After")).toBe("30");
});
