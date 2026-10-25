import "server-only";
import { ApiError } from "@/lib/errors";
import type { Asset } from "@/lib/types";
import seed from "@/templates.json";

// Server-only seed data (deploymentIds and recipient wallet addresses must
// never reach the browser). Pure functions take the parsed file so tests can
// inject fixtures; the module-level helpers use the checked-in templates.json.
export type RecipientSeed = {
  id: string;
  name: string;
  relationship: string;
  walletAddress: string;
  payoutLabel: string;
};
export type ShareSeed = { recipientId: string; bps: number };
export type TemplateSeed = {
  id: string;
  name: string;
  description: string;
  asset: Asset;
  mode: string;
  priority: number;
  enabled: boolean;
  deploymentId: string;
  shares: ShareSeed[];
};
export type TemplateFile = {
  network: string;
  usdcIssuer: string;
  recipients: RecipientSeed[];
  templates: TemplateSeed[];
};
export type TemplateRecipient = RecipientSeed & { bps: number };
export type TemplateInternal = {
  id: string;
  name: string;
  description: string;
  asset: Asset;
  mode: string;
  priority: number;
  deploymentId: string;
  recipients: TemplateRecipient[];
};
export type TemplateRecipientDto = {
  id: string;
  name: string;
  relationship: string;
  payoutLabel: string;
  bps: number;
};
export type TemplateDto = {
  id: string;
  name: string;
  description: string;
  asset: Asset;
  recipients: TemplateRecipientDto[];
};

// Placeholder values in templates.json (TODO_...) are not valid UUIDs, which
// is exactly how an unconfigured template is kept out of the API.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve one template seed to its internal shape, or null when it is not
// deployable (shares must reference known recipients, use positive integer
// basis points, and total exactly 10000).
function resolveTemplate(
  template: TemplateSeed,
  file: TemplateFile,
): TemplateInternal | null {
  if (!UUID.test(template.deploymentId)) return null;
  const recipientById = new Map(file.recipients.map((r) => [r.id, r]));
  const recipients: TemplateRecipient[] = [];
  let total = 0;
  for (const share of template.shares) {
    const recipient = recipientById.get(share.recipientId);
    if (!recipient || !Number.isInteger(share.bps) || share.bps <= 0)
      return null;
    total += share.bps;
    recipients.push({ ...recipient, bps: share.bps });
  }
  if (total !== 10000 || recipients.length === 0) return null;
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    asset: template.asset,
    mode: template.mode,
    priority: template.priority,
    deploymentId: template.deploymentId,
    recipients,
  };
}

export function resolveTemplates(
  file: TemplateFile,
  { includeDisabled = false }: { includeDisabled?: boolean } = {},
): TemplateInternal[] {
  const out: TemplateInternal[] = [];
  for (const template of file.templates) {
    if (!includeDisabled && !template.enabled) continue;
    const resolved = resolveTemplate(template, file);
    if (resolved) out.push(resolved);
  }
  out.sort((a, b) => a.priority - b.priority);
  return out;
}

export function toTemplateDto(template: TemplateInternal): TemplateDto {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    asset: template.asset,
    recipients: template.recipients.map((r) => ({
      id: r.id,
      name: r.name,
      relationship: r.relationship,
      payoutLabel: r.payoutLabel,
      bps: r.bps,
    })),
  };
}

const file = seed as unknown as TemplateFile;

export function listTemplates(): TemplateInternal[] {
  return resolveTemplates(file);
}

export function getTemplate(id: string): TemplateInternal {
  const seedEntry = file.templates.find((t) => t.id === id);
  if (!seedEntry)
    throw new ApiError(404, "UNKNOWN_TEMPLATE", "Unknown template.");
  // Enabled + deployable only: a disabled template (or one whose deploymentId
  // is still a TODO_ placeholder) must not be payable.
  const resolved = resolveTemplates(file).find((t) => t.id === id);
  if (!resolved)
    throw new ApiError(
      403,
      "TEMPLATE_DISABLED",
      "This template is not enabled yet.",
    );
  return resolved;
}

// For payout resolution on the status route: templates remain resolvable even
// when disabled (a transfer may outlive its template's availability).
export function findTemplateAny(id: string): TemplateInternal | null {
  return (
    resolveTemplates(file, { includeDisabled: true }).find(
      (t) => t.id === id,
    ) ?? null
  );
}
