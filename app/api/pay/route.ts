import { preparePayment, submitPayment, paymentStatus } from "@/lib/paiflow";
import { handle, sameOrigin, readJson, RequestError } from "@/lib/http";
import { limitPaymentRequests } from "@/lib/payment-rate-limit";
export async function POST(request: Request) {
  return handle(async () => {
    sameOrigin(request);
    limitPaymentRequests("request");
    const b = await readJson(request);
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new RequestError(400, "VALIDATION", "Invalid request.");
    const v = b as Record<string, unknown>;
    if (
      v.action === "prepare" &&
      typeof v.from === "string" &&
      Object.keys(v).length === 2
    ) {
      limitPaymentRequests("prepare");
      return preparePayment(v.from);
    }
    if (
      v.action === "status" &&
      typeof v.txHash === "string" &&
      Object.keys(v).length === 2
    ) {
      limitPaymentRequests("status");
      return paymentStatus(v.txHash);
    }
    if (
      v.action === "submit" &&
      typeof v.signedXdr === "string" &&
      v.signedXdr.length <= 200000 &&
      (v.preparationRequestId === undefined ||
        (typeof v.preparationRequestId === "string" &&
          v.preparationRequestId.length <= 200)) &&
      Object.keys(v).every((k) =>
        ["action", "signedXdr", "preparationRequestId"].includes(k),
      )
    ) {
      limitPaymentRequests("submit");
      return submitPayment(
        v.signedXdr,
        v.preparationRequestId as string | undefined,
      );
    }
    throw new RequestError(400, "VALIDATION", "Invalid request.");
  });
}
