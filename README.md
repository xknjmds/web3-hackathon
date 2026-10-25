# Paiflow SDK payment example

A small, runnable Next.js example for integrating `@paiflow/sdk` into your own app. Connect Freighter, prepare a **1 testnet XLM** payment, sign it in the wallet, submit the original envelope, and check its transaction status. One explicitly configured Paiflow deployment supplies the payment rules.

The SDK runs in your Node server. The browser calls your application's routes and signs with Freighter; it never receives the Paiflow credential. Copy the integration into an existing app or use this minimal example as a starting point.

## Choose your starting point

Use the SDK in your own app when you already have an application. Use this minimal payment example when you want a runnable reference for the prepare → sign → submit → verify → recover lifecycle. [Campus Snacks](https://github.com/artisam-paiflow/paiflow-campus-snacks) is a separate application sample for a campus ordering use case.

For the flow-building walkthrough, use the [Paiflow Guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/paiflow-guide.md). For detailed integration reference, use the [SDK README](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md) and [API README](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md).

## Run locally

Requires **Node `>=22.22.2 <23`** and **pnpm `10.4.1`**.

On Windows, follow the [Windows Setup Guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/setup-guide.md) to install Git, Node and pnpm, run this starter, then set up Engr with Kimi.

```sh
git clone https://github.com/artisam-paiflow/paiflow-hackathon-starter.git
cd paiflow-hackathon-starter
npm install --global pnpm@10.4.1
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. Without complete server configuration, payment actions remain disabled.

The dependency is pinned to **`@paiflow/sdk@0.2.0`**, published under npm's `beta` tag. Developer tokens require a backend implementing OpenAPI `1.1.0`, including the staging environment checked on October 17, 2026.

## Configure your deployment

1. In Paiflow, build and deploy an **On Receive (native XLM)** flow with your chosen recipients and rules. Wait for confirmation and review those rules. This app does not create or deploy flows.
2. In **Account → Developer**, create a **Read and operate** token and explicitly grant it access to that deployment. Copy its one-time `pfd_` secret. An existing deployment-bound `pfk_` token from **API access** also works.
3. Set these server-only values in `.env.local`, then restart:

```dotenv
PAIFLOW_BASE_URL=https://beta.app.paiflow.xyz
PAIFLOW_DEPLOYMENT_ID=<your confirmed deployment UUID>
PAIFLOW_API_TOKEN=<your pfd_ or pfk_ token>
```

Never use `NEXT_PUBLIC_` for these settings, commit `.env.local`, or put wallet secret keys into the app. The app uses the configured deployment, never the first discovery result. A developer token must explicitly include that deployment.

Complete credentials enable this example. Removing them disables new API actions but does not cancel an existing transaction. Retain recovery evidence when changing configuration.

## Try a payment

1. Install Freighter. Fund a dedicated testnet customer wallet with enough XLM for the payment and transaction fees. Use testnet recipients; mainnet and non-native-XLM deployments are refused.
2. Connect the wallet. Review your deployment and its recipients in Paiflow, then start the payment.
3. Review and sign in Freighter. The app uses the server-prepared network passphrase, checks the wallet's network and verifies the signed transaction body against the original preparation.
4. Check the original transaction's status. `SUCCESS` confirms that transaction. `PENDING`, `UNKNOWN`, missing history and transport errors remain unresolved.
5. Inspect recipient payouts in Paiflow or a testnet explorer. A transaction confirmation is not an application receipt or authorization to fulfil an order.

This is a fixed-amount payment demonstration, not a shop. It has no customer authentication, persistent order database or fulfilment system, and does not independently verify your intended recipients or split. The payment API has global per-process limits of 20 preparations, 20 submissions and 120 status checks per minute, plus 240 total payment requests per minute. Limits return HTTP 429 with `Retry-After`; preparation traffic has a separate allowance from transaction recovery. Request bodies are limited to 210,000 bytes while streaming. Client-supplied forwarding headers do not change these budgets.

These in-memory limits reset on restart and apply separately to each server process. Public hosting should also enforce shared rate and body-size limits at the ingress across replicas. Real applications need session/ownership checks, durable storage, trusted pricing, durable order-to-transaction binding and exact receipt verification.

## Recover an interrupted payment

The example saves the original preparation before signing and the exact signed envelope before submission. Recovery is scoped to the configured platform and deployment. Browser storage and Web Locks are required; a storage failure blocks the next financial step.

Preparation, submission and manual status requests each have a 30-second browser response deadline. A submission timeout does not cancel or reject the transaction.

After submission, a pending response, RPC error or lost response starts **Confirmation pending—checking the original transaction**. The app makes only status lookups: at most six attempts over one 30-second confirmation window, with backoff and `Retry-After` respected. Each lookup uses only the time remaining in that window; it never starts a fresh 30-second window. Reloading an attempted unresolved signed payment resumes one bounded check of its original hash. No automatic check prepares, signs or submits another transaction.

Use **Stop checking** to stop the read-only checks, or **Check original transaction** to check again after the bounded check finishes. Both preserve the original evidence. Manual retry sends only the **same signed envelope**; it is never automatic. Keep original evidence after a timeout, rejected response, `UNKNOWN`, `NOT_FOUND` or expired preparation. None proves that a replacement is safe. Do not clear browser data to start over while an operation is unresolved. If no signature is available after expiry, ask the platform operator to establish the outcome.

Recovery is local to this browser and origin. Lost storage, a different machine or a lost preparation response may require operator assistance. Browser storage is teaching code, not durable cross-device payment storage. Never log or share signed envelopes or full recovery records.

An unresolved payment record for another platform or deployment blocks a new payment; restore its original server configuration to reconcile it. Recovery checks retain existing evidence rather than silently deleting or converting it.

## Code map

| File                           | Responsibility                                                 |
| ------------------------------ | -------------------------------------------------------------- |
| `lib/paiflow.ts`               | Server-only configuration and typed SDK payment calls          |
| `app/api/pay/route.ts`         | Allowlisted preparation, submission and reconciliation actions |
| `app/api/integration/route.ts` | Non-secret configuration state                                 |
| `lib/wallet.ts`                | Freighter connection and signing                               |
| `lib/recovery.ts`              | Original transaction evidence and validation                   |
| `lib/transaction.ts`           | Transaction hashing and unchanged-envelope checks              |
| `components/starter-app.tsx`   | Payment walkthrough and recovery controls                      |

The SDK supplies transport, typed responses and API metadata. Your app supplies wallet consent, storage, authorization, reconciliation decisions and business rules.

## Checks and evidence

```sh
pnpm audit
pnpm typecheck
pnpm test
pnpm build
node scripts/check-browser-bundle.mjs
```

CI also audits dependencies on pushes, pull requests and a weekly schedule. Vite is an explicit development dependency so its patched version is selected for Vitest rather than retaining an older auto-installed peer.

Tests use fixtures and mocked upstream responses. They do not establish live wallet consent or payout readiness. Complete a small authorized testnet rehearsal against your deployment before demonstrating it. No fresh signed payment was made for this migration.

Follow your event's primer for permissions, deadlines and submissions. See [`llms.md`](llms.md) for shared Paiflow SDK integration context; use this README and current source for this runnable example.
