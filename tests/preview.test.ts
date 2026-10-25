import { expect, it } from "vitest";
import { formatPeso, previewPayouts } from "@/lib/preview";

const recipients = [
  { id: "r-parents", bps: 5000 },
  { id: "r-sister", bps: 3000 },
  { id: "r-niece", bps: 1500 },
  { id: "r-godparent", bps: 500 },
];

it("splits by basis points exactly on even amounts", () => {
  expect(previewPayouts("100000000", recipients)).toEqual([
    { recipientId: "r-parents", amount: "50000000" },
    { recipientId: "r-sister", amount: "30000000" },
    { recipientId: "r-niece", amount: "15000000" },
    { recipientId: "r-godparent", amount: "5000000" },
  ]);
});

it("gives the rounding remainder to the last recipient", () => {
  // 10000001 stroops over 3333/3333/3334: exact shares leave 1 stroop.
  const odd = previewPayouts("10000001", [
    { id: "a", bps: 3333 },
    { id: "b", bps: 3333 },
    { id: "c", bps: 3334 },
  ]);
  expect(odd.map((p) => p.amount)).toEqual(["3333000", "3333000", "3334001"]);
  expect(odd.reduce((sum, p) => sum + BigInt(p.amount), 0n)).toBe(10000001n);
});

it("never loses or creates value", () => {
  const payouts = previewPayouts("9999999", recipients);
  expect(payouts.reduce((sum, p) => sum + BigInt(p.amount), 0n)).toBe(9999999n);
});

it("formats peso display estimates with exactly two decimals", () => {
  expect(formatPeso("50000000", "56.00")).toBe("280.00");
  expect(formatPeso("100000000", "56.00")).toBe("560.00");
  expect(formatPeso("15000000", "56.00")).toBe("84.00");
  expect(formatPeso("1", "56.00")).toBe("0.00");
  expect(formatPeso("10000000", "56")).toBe("56.00");
  expect(formatPeso("12345678", "56.00")).toBe("69.13"); // truncated, display-only
  expect(formatPeso("50000000", "bogus")).toBe("0.00");
});
