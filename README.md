# Hati

**Hati** ("split" in Filipino) is a PaiFlow-based remittance-splitting app built on the `@paiflow/sdk@0.2.0` starter. A sender picks a family plan (e.g. monthly allotment → parents 50% / sister 50%), prepares a USDC payment on Stellar testnet, signs it with Freighter, and submits the exact signed envelope; the backend polls the original transaction and reports per-recipient payouts as PaiFlow events arrive.

The app is a single Next.js project: the Hati sender UI (frontend) and the API routes (backend) defined by [`CONTRACT.md`](CONTRACT.md) v1.2. The PaiFlow SDK runs server-only in Node. The browser calls this app's routes and signs with Freighter; it never receives the Paiflow credential, deployment IDs, or recipient wallet addresses.

> The project was previously called **PadalaSplit**; that name still appears in `CONTRACT.md`, code comments and the browser recovery scope (`padalasplit`), which is kept unchanged so in-progress payments survive the rename.

## Frontend: Hati sender UI

The UI lives in [`components/starter-app.tsx`](components/starter-app.tsx) (rendered by [`app/page.tsx`](app/page.tsx)) and talks only to this app's own routes through [`lib/padala-api.ts`](lib/padala-api.ts).

1. **Choose a plan and amount** — the family plan picker is filled from `GET /api/templates`; the USDC amount (up to 7 decimals) is converted to stroops with string/bigint math and shown with a peso estimate from `GET /api/fx` plus a per-recipient split preview.
2. **Connect your wallet** — Freighter connects in the browser; Hati never sees private keys.
3. **Prepare transfer** — `POST /api/transfers/prepare` returns an unsigned testnet envelope and transfer reference, saved to the browser recovery record before signing.
4. **Review and sign** — Freighter signs using the server-prepared network passphrase; the signed envelope is checked against the original transaction body/hash (altered operations and fee-bump envelopes are rejected) and saved before submission.
5. **Submit and track** — `POST /api/transfers/submit` sends the exact saved envelope; the UI then polls `GET /api/transfers/:id` with bounded confirmation and shows status, per-recipient payouts (on-chain, PaiFlow event, or preview amounts) and a Stellar explorer link when not in mock mode.

**Recovery & transaction status** keeps the original transaction hash, transfer reference and signed envelope in this browser across reloads, guarded by Web Locks so two tabs can't act on the same payment. Uncertain results only offer *Check original transaction* or *Retry exact saved envelope* — never a replacement payment. A payment that was never submitted can be discarded; a final result must be acknowledged before starting another. In mock mode the topbar shows **Mock PaiFlow** and a banner explains that no real Stellar transaction is made.

## Backend routes (CONTRACT.md v1.2)

| Route | Purpose |
| --- | --- |
| `GET /api/templates` | Enabled, deployable split templates (no `deploymentId`/`walletAddress` in responses) |
| `POST /api/transfers/prepare` | Validate `{templateId, walletAddress, amount}` → preparation record + unsigned testnet envelope + peso preview + FX |
| `POST /api/transfers/submit` | Validate and persist the exact signed envelope, then submit via PaiFlow (`preparationRequestId` correlation, idempotent resubmission) |
| `GET /api/transfers/:id` | Transfer status (`PREPARED`/`EXPIRED`/`PENDING`/`SUCCESS`/`FAILED`/`REJECTED`/`UNKNOWN`) with event-backed payouts (`amountSource: "event"`, preview fallback) |
| `GET /api/transfers?wallet=G...` | P2 history: the wallet's 20 newest transfers (`transferId`, `templateId`, `total`, `asset`, `status`, `txHash?`, `createdAt`) |
| `GET /api/fx` | `USDC/PHP` rate (CoinGecko, ~60 s cache, `"56.00"` fallback; display-only) |

Errors use the contract envelope `{error: {code, message, retryAfterSeconds?}}`. Money is stroop strings and bigint end-to-end; peso values are display-only. P2 history (`GET /api/transfers?wallet=G...`) returns a wallet's 20 most recent transfers with statuses resolved through the same cached PaiFlow reads. Identity is the wallet address with no authentication, so anyone who knows an address can read its history; a real deployment needs wallet-signature auth and ownership checks.

## Run locally

Requires **Node `>=22.22.2 <23`** and **pnpm `10.4.1`**.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Server-only environment (never `NEXT_PUBLIC_`):

```dotenv
PAIFLOW_BASE_URL=https://beta.app.paiflow.xyz
PAIFLOW_API_TOKEN=<pfd_ or pfk_ token>
PAIFLOW_USE_MOCK=false
SUPABASE_URL=<supabase project url>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>
# Optional: PAIFLOW_READ_CACHE_MS (default 10000), FX_CACHE_MS (default 60000)
```

Without complete PaiFlow credentials (or with `PAIFLOW_USE_MOCK=true`) the app serves a **server-side mock gateway**: real, signable testnet envelopes built with the Stellar SDK, time-based `PENDING → UNKNOWN → SUCCESS` outcomes, and synthetic PAYOUT events after ~12 s derived from template shares. Mock responses carry `"mock": true` and never include an `explorerUrl`. Storage, idempotency and envelope checks run identically in both modes.

## Storage

Transfers persist in **Supabase (Postgres)** via `@supabase/supabase-js` with the service-role key, server-only; the browser never talks to the database. Apply `supabase/migrations/0001_init.sql` to create the `users` and `transfers` tables. When the Supabase env vars are unset, the app falls back to an in-memory store with a one-time server warning (fine for local dev; state resets on restart). Storage failures fail closed: the financial step is refused (HTTP 503), nothing half-created exists, and recovery records are never logged.

Preparation is persisted **before** the prepare response; the exact signed envelope is persisted **before** upstream submission (`markSubmitted` is a conditional write, so a concurrent double-submit can never produce two payments). Uncertain outcomes (`PENDING`, `UNKNOWN`, upstream `NOT_FOUND`, expiry) never authorize replacement — reconcile the original transaction and retry only its exact signed envelope.

Deployment IDs live server-side in `templates.json` (one token used across deployments); templates whose `deploymentId` is still a `TODO_` placeholder are automatically excluded from the API because they fail the UUID check.

## Deviations from the upstream starter rules

These are deliberate, contract-driven departures from the original starter guarantees (see also the note at the end of `AGENTS.md`):

1. **Assets**: the capabilities gate accepts testnet deployments that are `native` **or** `known`/USDC, because Hati templates pay USDC. Mainnet is still refused, and prepare additionally asserts the `Test SDF Network ; September 2015` passphrase (`WRONG_NETWORK`).
2. **Amounts**: the fixed 1 XLM payment is replaced by contract-validated variable amounts (positive stroop strings, `bigint` math only).
3. **Deployment env var**: `PAIFLOW_DEPLOYMENT_ID` is dropped; per-template deployment IDs live in `templates.json` (server-only).
4. **Routes**: the starter's `POST /api/pay` and `GET /api/integration` routes (and the old browser demo) were removed in favor of the contract routes above.
5. **Mock mode**: a server-side mock gateway stands in for PaiFlow when credentials are missing (responses flagged `"mock": true`).

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
node scripts/check-browser-bundle.mjs
```

For an end-to-end walk of the API lifecycle without real funds, start the server with `PAIFLOW_USE_MOCK=true` (and no Supabase env), then run `node scripts/smoke-mock.mjs [baseUrl]`. It walks prepare → sign → submit → idempotent resubmit → `SUCCESS`, temporarily substituting a fixture template if `templates.json` still has `TODO_` deployment IDs.

Tests use fixtures and mocked upstream responses; no live financial tests are performed without authorization. See [`llms.md`](llms.md) for shared Paiflow SDK integration context and [`CONTRACT.md`](CONTRACT.md) for the API contract.
