import { StarterApp } from "@/components/starter-app";

// Plans, FX and transfers are loaded by the client from our own /api routes;
// deployment IDs and tokens never reach the page.
export default function Page() {
  return <StarterApp />;
}
