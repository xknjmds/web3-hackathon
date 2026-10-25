import { Keypair } from "@stellar/stellar-sdk";
import type { TemplateFile } from "@/lib/templates";

// Deterministic test-only addresses; no signing keys are stored.
export const fixtureKeypair = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 7),
);
export const fixtureAddress = fixtureKeypair.publicKey();
export const otherKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
export const otherAddress = otherKeypair.publicKey();

export const fixtureDeploymentId = "12345678-1234-1234-1234-123456789abc";
export const otherDeploymentId = "abcdefab-1234-1234-1234-abcdefabcdef";

export const fixtureFile: TemplateFile = {
  network: "testnet",
  usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  recipients: [
    {
      id: "r-parents",
      name: "Parents",
      relationship: "Parents",
      walletAddress: fixtureAddress,
      payoutLabel: "GCash (demo)",
    },
    {
      id: "r-sister",
      name: "Sister",
      relationship: "Sister",
      walletAddress: otherAddress,
      payoutLabel: "Maya (demo)",
    },
  ],
  templates: [
    {
      id: "monthly-allotment",
      name: "Monthly allotment",
      description: "Regular monthly support for the family.",
      asset: "USDC",
      mode: "single",
      priority: 1,
      enabled: true,
      deploymentId: fixtureDeploymentId,
      shares: [
        { recipientId: "r-parents", bps: 5000 },
        { recipientId: "r-sister", bps: 5000 },
      ],
    },
    {
      id: "school-opening",
      name: "School opening",
      description: "Extra support when classes start.",
      asset: "USDC",
      mode: "single",
      priority: 2,
      enabled: false,
      deploymentId: otherDeploymentId,
      shares: [{ recipientId: "r-parents", bps: 10000 }],
    },
    {
      id: "invalid-deployment",
      name: "Not deployed yet",
      description: "Placeholder deployment id.",
      asset: "USDC",
      mode: "single",
      priority: 3,
      enabled: true,
      deploymentId: "TODO_DEPLOYMENT_UUID",
      shares: [{ recipientId: "r-parents", bps: 10000 }],
    },
  ],
};
