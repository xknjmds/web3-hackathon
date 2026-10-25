import { expect, it } from "vitest";
import { readRecovery, type Recovery } from "@/lib/recovery";
import { envelopeHash } from "@/lib/transaction";
import { fixtureAddress, fixturePrepared } from "./transaction-fixture";

const base: Recovery = {
  version: 2,
  scope: "padalasplit",
  address: fixtureAddress,
  prepared: { ...fixturePrepared, txHash: envelopeHash(fixturePrepared.xdr) },
};

it("accepts a record carrying its PadalaSplit transfer", () => {
  const record = {
    ...base,
    transfer: { id: "tr_0b5c1c1e-1234", templateId: "monthly-allotment", amount: "100000000" },
  };
  expect(readRecovery("padalasplit", JSON.stringify(record))).toEqual(record);
});

it("still accepts a record without a transfer", () => {
  expect(readRecovery("padalasplit", JSON.stringify(base))).toEqual(base);
});

it("rejects a malformed transfer (fail closed)", () => {
  for (const transfer of [
    { id: "not-a-transfer", templateId: "t", amount: "1" },
    { id: "tr_1", templateId: 7, amount: "1" },
    { id: "tr_1", templateId: "t", amount: "1.5" },
  ])
    expect(() =>
      readRecovery("padalasplit", JSON.stringify({ ...base, transfer })),
    ).toThrow("Invalid recovery record");
});
