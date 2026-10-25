import "server-only";
import { PaiflowApiError } from "@paiflow/sdk";
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

// Limit bytes while streaming, before decoding or parsing the complete body.
export async function readJson(request: Request): Promise<unknown> {
  const limit = 210_000;
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit)
    throw new RequestError(413, "REQUEST_TOO_LARGE", "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "VALIDATION", "Expected JSON.");
  const bytes = new Uint8Array(limit);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) {
        await reader.cancel();
        throw new RequestError(413, "REQUEST_TOO_LARGE", "Request too large.");
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
    );
  } catch {
    throw new RequestError(400, "VALIDATION", "Invalid JSON.");
  }
}

export async function handle(action: () => Promise<unknown>) {
  try {
    return Response.json({ data: await action() });
  } catch (error) {
    if (error instanceof RequestError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        {
          status: error.status,
          headers: error.retryAfter
            ? { "Retry-After": String(error.retryAfter) }
            : undefined,
        },
      );
    }
    if (error instanceof PaiflowApiError) {
      const headers = new Headers();
      if (error.metadata.requestId)
        headers.set("x-request-id", error.metadata.requestId);
      if (error.metadata.retryAfter)
        headers.set("Retry-After", error.metadata.retryAfter);
      return Response.json(
        {
          error: {
            code: error.code,
            message:
              "Paiflow request failed. Retain the original payment record and check its status.",
          },
        },
        { status: error.status, headers },
      );
    }
    return Response.json(
      {
        error: {
          code: "UNRESOLVED",
          message:
            "Request could not complete. Retain the original envelope and check its status before starting another payment.",
        },
      },
      { status: 502 },
    );
  }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new RequestError(403, "FORBIDDEN", "Same-origin requests required.");
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new RequestError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected JSON.");
}
