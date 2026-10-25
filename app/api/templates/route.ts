import { respond } from "@/lib/http";
import { limitPaymentRequests } from "@/lib/payment-rate-limit";
import { getGateway } from "@/lib/gateway";
import { listTemplates, toTemplateDto } from "@/lib/templates";

export const dynamic = "force-dynamic";

// GET /api/templates — enabled preset splits (CONTRACT.md §1). deploymentIds
// and recipient wallet addresses are server-only and never included.
export async function GET() {
  return respond(async () => {
    limitPaymentRequests("request");
    const gateway = getGateway();
    return {
      templates: listTemplates().map(toTemplateDto),
      ...(gateway.mock ? { mock: true } : {}),
    };
  });
}
