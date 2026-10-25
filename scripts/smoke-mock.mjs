// Manual mock-mode smoke walk for the PadalaSplit backend.
// Usage: start the server with PAIFLOW_USE_MOCK=true and no Supabase env,
// then run: node scripts/smoke-mock.mjs [baseUrl]
// Walks prepare -> Freighter-style sign -> submit -> idempotent resubmit ->
// poll to SUCCESS, asserting the mock-mode contract flags. No real funds.
//
// If no template is deployable yet (checked-in templates.json still has TODO_
// deployment UUIDs), a fixture template is temporarily substituted so the
// whole lifecycle can be walked; the original file is always restored.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const templatesPath = `${root}/templates.json`;
const originalTemplates = readFileSync(templatesPath, "utf8");

const fail = (where, detail) => {
  console.error(`SMOKE FAIL @ ${where}:`, detail);
  process.exit(1);
};
const check = (cond, where, detail) => {
  if (!cond) fail(where, detail);
  console.log(`ok @ ${where}`);
};

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      origin: base,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
const get = (path) => fetch(`${base}${path}`);

// Substitute a fully-deployable fixture template (valid UUID, valid testnet
// recipient addresses) while the walk runs; restore afterwards.
let injected = false;
// fail() exits the process, which skips `finally`; restore on every exit.
process.on("exit", () => {
  if (injected) writeFileSync(templatesPath, originalTemplates);
});
async function ensureDeployableTemplate() {
  const body = await (await get("/api/templates")).json();
  if (body.templates.length > 0) return;
  const file = JSON.parse(originalTemplates);
  for (const template of file.templates) {
    if (!template.enabled) continue;
    template.deploymentId = "12345678-1234-1234-1234-123456789abc";
  }
  for (const recipient of file.recipients) {
    if (!/^G[A-Z2-7]{55}$/.test(recipient.walletAddress))
      recipient.walletAddress = Keypair.random().publicKey();
  }
  writeFileSync(templatesPath, JSON.stringify(file, null, 2));
  injected = true;
  // The dev server recompiles on the next request; wait until the fixture
  // template becomes visible.
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const retry = await (await get("/api/templates")).json();
    if (retry.templates.length > 0) return;
  }
  fail("template injection", "fixture template never became deployable");
}

// In `next dev` each route compiles on first request and re-evaluates its
// module graph (resetting the in-memory store singleton). Warm every route
// with throwaway requests so no recompile happens during the real walk.
async function warmRoutes() {
  const prepare = await post("/api/transfers/prepare", {});
  const submit = await post("/api/transfers/submit", {});
  const status = await get("/api/transfers/tr_warm");
  check(
    prepare.status === 400 && submit.status === 400 && status.status === 404,
    "route warm-up (all routes compiled)",
    {
      prepare: prepare.status,
      submit: submit.status,
      status: status.status,
    },
  );
}

const payer = Keypair.random();
console.log("payer:", payer.publicKey());

try {
  await ensureDeployableTemplate();
  await warmRoutes();

  // 1. Templates
  const templates = await (await get("/api/templates")).json();
  check(templates.mock === true, "templates mock flag", templates);
  check(
    Array.isArray(templates.templates) && templates.templates.length > 0,
    "templates non-empty",
    templates,
  );
  check(
    !JSON.stringify(templates).match(/deploymentId|walletAddress/),
    "templates leak no server fields",
    templates,
  );
  const templateId = templates.templates[0].id;

  // 2. FX
  const fx = await (await get("/api/fx")).json();
  check(
    fx.pair === "USDC/PHP" &&
      typeof fx.rate === "string" &&
      fx.displayOnly === true,
    "fx shape",
    fx,
  );

  // 3. Prepare
  const amount = "100000000";
  const preparedRes = await post("/api/transfers/prepare", {
    templateId,
    walletAddress: payer.publicKey(),
    amount,
  });
  const prepared = await preparedRes.json();
  check(preparedRes.status === 200, "prepare 200", prepared);
  check(
    prepared.status === "PREPARED" && prepared.mock === true,
    "prepare body",
    prepared,
  );
  check(
    prepared.networkPassphrase === Networks.TESTNET,
    "testnet passphrase",
    prepared,
  );
  check(
    prepared.preview.total === amount &&
      prepared.preview.payouts.length ===
        templates.templates[0].recipients.length,
    "preview payouts",
    prepared.preview,
  );

  // 4. Sign like Freighter would (browser-side, with the wallet key).
  const tx = TransactionBuilder.fromXDR(prepared.unsignedXdr, Networks.TESTNET);
  tx.sign(payer);
  const signedXdr = tx.toXDR();

  // 5. Submit + idempotent resubmit
  const submitted = await (
    await post("/api/transfers/submit", {
      transferId: prepared.transferId,
      signedXdr,
    })
  ).json();
  check(
    submitted.status === "SUBMITTED" && typeof submitted.txHash === "string",
    "submit SUBMITTED",
    submitted,
  );
  const resubmitted = await (
    await post("/api/transfers/submit", {
      transferId: prepared.transferId,
      signedXdr,
    })
  ).json();
  check(
    resubmitted.txHash === submitted.txHash,
    "resubmit idempotent (same txHash, no second payment)",
    resubmitted,
  );

  // 6. Poll to SUCCESS (mock gateway: PENDING <15s, UNKNOWN <25s, then
  // SUCCESS; synthetic PAYOUT events after ~12s).
  let final;
  for (let i = 0; i < 20; i += 1) {
    const body = await (
      await get(`/api/transfers/${prepared.transferId}`)
    ).json();
    final = body;
    console.log(`poll ${i}: status=${body.status}`);
    if (body.status === "SUCCESS") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  check(final.status === "SUCCESS", "status reaches SUCCESS", final);
  check(final.mock === true, "status mock flag", final);
  check(final.explorerUrl === undefined, "no explorerUrl in mock mode", final);
  check(
    Array.isArray(final.payouts) && final.payouts.length > 0,
    "payouts present",
    final.payouts,
  );
  const sources = new Set(final.payouts.map((p) => p.amountSource));
  check(
    sources.has("event") || sources.has("preview"),
    "payout amountSource",
    final.payouts,
  );
  const total = final.payouts.reduce((sum, p) => sum + BigInt(p.amount), 0n);
  check(total === BigInt(amount), "payouts sum to total", {
    total: total.toString(),
    amount,
  });

  console.log("\nSMOKE PASS");
} finally {
  if (injected) writeFileSync(templatesPath, originalTemplates);
}
