import { publicConfig } from "@/lib/paiflow";
import { StarterApp } from "@/components/starter-app";

export const dynamic = "force-dynamic";

export default async function Page() {
  const config = publicConfig();
  return <StarterApp config={config} />;
}
