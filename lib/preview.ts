// Preview payout math. All money math is bigint on stroop strings
// (contract rule 1); the rounding remainder goes to the last recipient
// (llms.md Split rule; VERIFY in spike A3).
export type PreviewRecipient = { id: string; bps: number };

export function previewPayouts(
  total: string,
  recipients: PreviewRecipient[],
): { recipientId: string; amount: string }[] {
  const t = BigInt(total);
  let allocated = 0n;
  return recipients.map((recipient, index) => {
    const amount =
      index === recipients.length - 1
        ? t - allocated
        : (t * BigInt(recipient.bps)) / 10000n;
    if (index < recipients.length - 1) allocated += amount;
    return { recipientId: recipient.id, amount: amount.toString() };
  });
}

// Display-only peso estimate from a stroop amount and a decimal rate string
// (e.g. "56.00"). Scaled bigint math, exactly two decimal places, truncated.
export function formatPeso(stroops: string, rate: string): string {
  const safeRate = /^\d+(\.\d+)?$/.test(rate) ? rate : "0";
  const decimals = safeRate.includes(".")
    ? safeRate.split(".")[1]!.length
    : 0;
  const scaled = BigInt(safeRate.replace(".", "") || "0");
  // phpCents = stroops * rate * 100 / 1e7 = stroops * scaled / 10^(decimals+5)
  const cents =
    (BigInt(stroops) * scaled) / 10n ** BigInt(decimals + 5);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
