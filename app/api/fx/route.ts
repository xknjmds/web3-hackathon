import { respond } from "@/lib/http";
import { limitPaymentRequests } from "@/lib/payment-rate-limit";
import { getFxRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

// GET /api/fx — display-only USDC/PHP estimate (CONTRACT.md §5).
export async function GET() {
  return respond(async () => {
    limitPaymentRequests("request");
    return await getFxRate();
  });
}
