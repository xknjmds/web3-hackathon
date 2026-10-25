import "server-only";
import { PaiflowApiError } from "@paiflow/sdk";

// Contract error codes (CONTRACT.md "Shared types"). Messages must be safe to
// show to the user; never include credentials or upstream internals beyond the
// safe PaiFlow message.
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_WALLET"
  | "WRONG_NETWORK"
  | "WRONG_WALLET"
  | "UNKNOWN_TEMPLATE"
  | "TEMPLATE_DISABLED"
  | "PREPARE_EXPIRED"
  | "SIGNED_BODY_MISMATCH"
  | "ALREADY_SUBMITTED"
  | "RATE_LIMITED"
  | "PAIFLOW_UNAVAILABLE"
  | "NOT_FOUND";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const UNAVAILABLE =
  "PaiFlow is temporarily unavailable. The request may still have been sent; re-check the original transferId before retrying.";

// Map PaiFlow SDK errors to contract codes. The PaiFlow message is safe to
// surface for validation-class failures (it names affected accounts when
// known); everything else gets a generic message so token validity and
// platform internals never leak.
export function mapPaiflowError(error: PaiflowApiError): ApiError {
  const status = error.status;
  if (status === 422 || status === 402)
    return new ApiError(
      400,
      "VALIDATION_FAILED",
      error.message || "PaiFlow rejected the payment details.",
    );
  if (status === 429) {
    const retry = Number(error.metadata.retryAfter);
    return new ApiError(
      429,
      "RATE_LIMITED",
      "Too many requests. Honor retryAfterSeconds before retrying.",
      Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : undefined,
    );
  }
  if (status === 404)
    return new ApiError(404, "NOT_FOUND", "Not found.");
  return new ApiError(503, "PAIFLOW_UNAVAILABLE", UNAVAILABLE);
}
