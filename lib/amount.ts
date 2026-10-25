const SCALE = 10_000_000n;
const MAX = (1n << 127n) - 1n;
// Strict validation for API-supplied stroop strings (contract rule 1):
// digits only, positive, within contract i128 arithmetic, ≤39 digits.
export function isStroops(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{1,39}$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed > 0n && parsed <= MAX;
}
export function toStroops(decimal: string): string {
  if (!/^\d+(?:\.\d{1,7})?$/.test(decimal) || decimal.length > 48)
    throw new Error(
      "Enter a positive decimal amount with at most 7 decimal places.",
    );
  const [whole = "0", fraction = ""] = decimal.split(".");
  const value = BigInt(whole) * SCALE + BigInt(fraction.padEnd(7, "0"));
  if (value <= 0n || value > MAX)
    throw new Error(
      "Amount must be positive and fit contract i128 arithmetic.",
    );
  return value.toString();
}
export function fromStroops(stroops: string): string {
  if (!/^\d+$/.test(stroops) || stroops.length > 39)
    throw new Error("Invalid stroops.");
  const value = BigInt(stroops);
  if (value > MAX) throw new Error("Amount exceeds i128.");
  const fraction = (value % SCALE)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  return `${value / SCALE}${fraction ? `.${fraction}` : ""}`;
}
