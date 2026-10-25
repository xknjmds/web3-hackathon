import { paymentReady } from "@/lib/paiflow";
import { handle } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => {
    await paymentReady();
    return { ready: true };
  });
}
