import { expect, it, vi } from "vitest";
import {
  resolveTemplates,
  toTemplateDto,
  type TemplateFile,
} from "@/lib/templates";
import { fixtureFile } from "./padala-fixture";

vi.mock("server-only", () => ({}));

it("orders by priority ascending and excludes disabled templates", () => {
  const resolved = resolveTemplates(fixtureFile);
  expect(resolved.map((t) => t.id)).toEqual(["monthly-allotment"]);
  expect(resolved[0]!.priority).toBe(1);
});

it("excludes enabled templates whose deploymentId is not a real UUID", () => {
  const resolved = resolveTemplates(fixtureFile);
  expect(resolved.some((t) => t.id === "invalid-deployment")).toBe(false);
});

it("excludes templates whose shares do not total exactly 10000 bps", () => {
  const file: TemplateFile = {
    ...fixtureFile,
    templates: [
      {
        ...fixtureFile.templates[0]!,
        id: "bad-bps",
        shares: [
          { recipientId: "r-parents", bps: 5000 },
          { recipientId: "r-sister", bps: 4000 },
        ],
      },
    ],
  };
  expect(resolveTemplates(file)).toEqual([]);
});

it("excludes templates referencing unknown recipients", () => {
  const file: TemplateFile = {
    ...fixtureFile,
    templates: [
      {
        ...fixtureFile.templates[0]!,
        id: "bad-recipient",
        shares: [{ recipientId: "r-nobody", bps: 10000 }],
      },
    ],
  };
  expect(resolveTemplates(file)).toEqual([]);
});

it("DTOs strip server-only fields and merge bps with recipients", () => {
  const [template] = resolveTemplates(fixtureFile);
  const dto = toTemplateDto(template!);
  const serialized = JSON.stringify(dto);
  expect(serialized).not.toContain("deploymentId");
  expect(serialized).not.toContain("walletAddress");
  expect(serialized).not.toContain(fixtureFile.recipients[0]!.walletAddress);
  expect(dto.recipients).toEqual([
    {
      id: "r-parents",
      name: "Parents",
      relationship: "Parents",
      payoutLabel: "GCash (demo)",
      bps: 5000,
    },
    {
      id: "r-sister",
      name: "Sister",
      relationship: "Sister",
      payoutLabel: "Maya (demo)",
      bps: 5000,
    },
  ]);
});

it("includeDisabled resolves valid templates regardless of the enabled flag", () => {
  const resolved = resolveTemplates(fixtureFile, { includeDisabled: true });
  expect(resolved.map((t) => t.id).sort()).toEqual([
    "monthly-allotment",
    "school-opening",
  ]);
});
