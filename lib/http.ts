import "server-only";
import { PaiflowApiError } from "@paiflow/sdk";
import { ApiError, mapPaiflowError } from "@/lib/errors";
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

// Contract-shaped responder: success bodies are returned as-is (no envelope
// wrapper), errors use the CONTRACT.md ApiError shape with retryAfterSeconds
// in the body (the Retry-After header is kept for HTTP-native clients).
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof RequestError) {
    const code =
      error.status === 429
        ? ("RATE_LIMITED" as const)
        : error.status >= 500
          ? ("PAIFLOW_UNAVAILABLE" as const)
          : ("VALIDATION_FAILED" as const);
    const status = error.status >= 500 ? 503 : error.status;
    return new ApiError(status, code, error.message, error.retryAfter);
  }
  if (error instanceof PaiflowApiError) return mapPaiflowError(error);
  return new ApiError(
    500,
    "PAIFLOW_UNAVAILABLE",
    "Request could not complete safely. No replacement was created; re-check the original transferId.",
  );
}

export async function respond(action: () => Promise<unknown>) {
  try {
    return Response.json(await action());
  } catch (error) {
    const mapped = toApiError(error);
    const body: { code: string; message: string; retryAfterSeconds?: number } =
      { code: mapped.code, message: mapped.message };
    if (mapped.retryAfterSeconds != null)
      body.retryAfterSeconds = mapped.retryAfterSeconds;
    return Response.json(
      { error: body },
      {
        status: mapped.status,
        headers:
          mapped.retryAfterSeconds != null
            ? { "Retry-After": String(mapped.retryAfterSeconds) }
            : undefined,
      },
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
