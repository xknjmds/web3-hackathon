# Paiflow developer context guide

Use the published **`@paiflow/sdk@0.2.0` beta** for typed Node integrations. The SDK payment example on the [starter repository's `main` branch](https://github.com/artisam-paiflow/paiflow-hackathon-starter) is the runnable starting point; use the SDK in your own app's server for a custom integration. The HTTP API remains available for other languages and direct integrations.

SDK and starter guidance checked October 17, 2026 against starter `8d70da575afb0ce8d56ce9ef72d9670ed73ab41b`, staging `4bee66a` and published SDK `0.2.0`. Staging implements OpenAPI revision `1.1.0`, including developer credentials and scoped deployment discovery. Product/block details retain their October 12 source review against staging `b945e6a`; later funding, Subscription and Schedule evidence is dated separately below. These checks did not include a fresh signed transaction and do not certify every workflow on the target environment. This guide uses testnet only.

For one server credential across explicitly selected existing owned deployments, see the [developer-token guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/developer-tokens.md). SDK `0.1.0` does not include developer credentials or scoped discovery; pin `0.2.0` explicitly because npm's `latest` tag still resolves to `0.1.0` as of the check above.

## Choose the right resource

| Resource                                                                                                                      | Purpose                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [Paiflow Guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/paiflow-guide.md)                      | Wallet setup, building and testing a flow, then integrating an app with the SDK.                                                       |
| [SDK README](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md)                                  | Detailed typed Node integration, examples, errors and recovery.                                                                        |
| [SDK method and type reference](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/sdk/reference/README.md)         | Look up SDK methods, parameters, return types and exported types.                                                                      |
| [HTTP API README](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md)                                 | Endpoint schemas, errors, limits, pagination and advanced workflows.                                                                   |
| [OpenAPI JSON](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/openapi.json)                                 | Machine-readable endpoint schemas for integration tools.                                                                               |
| [Postman collection](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/paiflow-api-v1.postman_collection.json) | Runnable API requests for your configured deployment.                                                                                  |
| [Starter configuration](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/.env.example)                  | Server-only platform origin, deployment UUID and token settings.                                                                       |
| [Starter agent instructions](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/AGENTS.md)                | Coding boundaries, event scope and verification commands.                                                                              |
| [Starter package manifest](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/package.json)               | Node.js range, package manager, dependencies and scripts.                                                                              |
| [Starter server client](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/lib/paiflow.ts)                | Server-only SDK configuration and typed payment calls.                                                                                 |
| This `llms.md`                                                                                                                | Product constraints, SDK integration boundaries and API references for AI-assisted development. It complements the human walkthroughs. |

Use the Markdown sources above when supplying references to an AI assistant. Participant-facing PDFs are presentation copies; keep them aligned with these sources.

The Paiflow Guide is the event-neutral end-to-end walkthrough. Distribute only it and the event primer as PDFs; use the SDK and HTTP API READMEs on GitHub for detailed references. The HTTP README preserves an independent browser/server example; use the SDK example's existing application routes when extending it. Event rules belong in the primer.

## Event instructions

This guide explains how to build with Paiflow. Follow your event's primer for onboarding, credentials, submission requirements and judging. If event information is missing, ask the organisers.

**Hackathon availability:** Dev mode will stay disabled for the duration of the hackathon. Configure all recipients and required values before deployment. Per-payment recipients, **Fill value via API**, **Dev values** and deferred subscriber/recipient setup are unavailable during the event. Use standard flows and `execute` with configured recipients. `pnpm dev` starts the local app server; it does not enable flow Dev mode.

## Set up the SDK payment example

Use **Node.js `>=22.22.2 <23`** and **pnpm `10.4.1`**, as declared in the starter's `package.json`. Follow its [README](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/README.md) for setup. The SDK dependency is pinned to **`@paiflow/sdk@0.2.0`**. Keep the package-manager pin unchanged.

1. Follow your event's preparation rules, choose a problem and prepare dedicated testnet wallets. Obtain XLM for payments and fees. The minimal starter accepts native XLM only; USDC examples require a separate integration and the exact asset's trustline and balance.
2. Build and deploy an **On Receive (native XLM)** flow with your chosen recipients. Wait for confirmation and review the fixed payment rules.
3. Create a **Read and operate** developer token in **Account → Developer**, explicitly selecting that owned deployment. Copy the one-time `pfd_` secret. A deployment-bound `pfk_` token from its **API access** page also works.
4. Copy `.env.example` to `.env.local`. Set server-only `PAIFLOW_BASE_URL`, `PAIFLOW_DEPLOYMENT_ID` and `PAIFLOW_API_TOKEN`, then restart. Never use `NEXT_PUBLIC_` for these settings or commit `.env.local`.
5. Run `pnpm install --frozen-lockfile` and `pnpm dev`; open http://localhost:3000. Complete server configuration enables the payment actions; incomplete configuration disables them. There is no mode selector or shared-demo fallback.

The example pays a fixed **1 native testnet XLM** (`"10000000"` stroops), using the explicitly configured deployment, never the first discovery result. It checks capabilities and refuses mainnet, non-native input assets and unsupported execution. Its scope is **connect → prepare → wallet sign → submit → check status → recover**. Funding, Schedule, Subscription, payout panels and event polling are not part of this minimal starter; SDK support for those workflows is documented separately.

Persist the original preparation before asking for a signature, then the exact signed envelope before submitting. The example uses browser storage and Web Locks; it blocks financial progress if required storage fails. Recovery belongs to the same browser/origin and configured platform/deployment. Keep its evidence after reload, timeout, `UNKNOWN`, `NOT_FOUND` or expired preparation. Neither elapsed time nor absent events proves that a replacement is safe. Check the original hash, retry only the same signed envelope where appropriate, and obtain operator help when the outcome cannot be established. Never clear storage to bypass an unresolved payment. Removing credentials does not cancel an already signed transaction.

This is a payment demonstration, without customer authentication, a durable order database, fulfilment or independent verification of your intended recipients/split. A production app must add session and ownership checks, rate limits, trusted pricing, durable order-to-transaction binding and exact receipt verification before fulfilling an order. Do not treat browser recovery storage as cross-device financial storage.

## Demonstrating your integration

Use your project's own deployment to demonstrate its payment flow. Save the confirmed deployment ID and payout transaction hash, and show the payout in the live feed, recipient balance or a Stellar explorer. Follow your event's rules for qualification, submission fields, deadlines, pitch length and live or recorded demos. A shared-demo payout demonstrates the shared deployment, not your project's integration.

Respect shared infrastructure: no load testing or spamming the Paiflow API or relayer. Rate limits apply. Do not add event requirements or benefits that the event documents do not publish.

# 1. What Paiflow is

Paiflow is the money logic behind your app: a visual canvas where you connect a trigger to payment actions and conditions, then deploy the graph as connected Stellar Soroban smart contracts in one transaction. Your app supplies the customer experience; the deployed flow receives, routes, holds and pays the money according to the rules you designed.

Use the team's Paiflow account to build and review a flow, connect the team's wallet, sign deployment, and wait for `CONFIRMED`. Then create a Read and operate developer token in **Account → Developer** with that deployment explicitly selected, or a deployment-bound token in **API access** on its deployment page. Your app can prepare customer payments, submit wallet-signed transactions and read events through `/api/v1`, or send customers to Paiflow's hosted payment and allowance pages. These APIs drive an existing deployment; they do not create flows or deploy copies.

Paiflow is **non-custodial**: it does not hold customers' private keys. Customers authorise their payments in their wallets. Funds held by a condition are on-chain, subject to the condition's release rules and authorised releasers. This guide and starter use **testnet only**; balances have no real-money value.

- The team designs a flow on the canvas and deploys it from the team's Paiflow account.
- The starter uses one explicitly configured deployment with a server-side `pfd_` or `pfk_` token. A developer token must explicitly include that deployment. Custom SDK apps may discover and choose among their explicitly granted deployments; discovery does not grant access.
- **One deployment serves one business or group. The API drives existing deployments; it does not create per-user copies.** A subscription also has one configured subscriber, rather than a separate subscription for each app user. If your idea needs per-user deployments, describe that as future work rather than a feature this starter already provides.

# 2. Blocks

## Graph, assets and amounts

The following describes the supported block palette for this reference. A graph contains `nodes`, `edges`, optional `devMode`, optional `notify`, and optional `positions` (node-id keys with numeric `x` and `y`). Each node has a unique nonempty `id`, `type`, and `config`. Each edge has nonempty `id`, `source`, `target`, and optionally `sourceHandle: "true" | "false"` for a condition output. A missing condition handle means True. The graph accepts at most 40 nodes and 80 edges.

Use exactly one trigger, with no incoming edges, and at least one action. Every node must be reachable from the trigger. No cycles or dangling edges. Keep the asset consistent along a path; Swap changes the downstream asset. A graph that saves as a draft is not necessarily deployable: deploy validation checks addresses, amounts, connectivity and contract support again.

Asset fields take one of these shapes:

```json
{"kind":"native"}
{"kind":"known","symbol":"USDC"}
{"kind":"custom","code":"TOKEN","issuer":"<real G-address>"}
```

Native means XLM. Custom codes are normalised to 1–12 alphanumeric characters and require a valid issuer account. Swap only supports XLM and USDC. Use real testnet `G…` public account addresses for recipients and signers. `PENDING:<label>` is a design-time placeholder, not a payable address; resolve it before deploying unless that value is deliberately deferred in Dev mode. Never paste an `S…` secret seed into a flow field.

**Money is a decimal integer string in stroops**, never a JavaScript floating-point number: 1 token = 10,000,000 stroops; 10 USDC = `"100000000"`; 0.5 USDC = `"5000000"`. Use `bigint` for arithmetic and `.toString()` for API bodies. Basis points (`bps`) are integers: 1% = 100 bps; 100% = 10,000 bps. ISO date-time fields include a timezone, for example `2026-10-09T06:00:00Z` (choose a future time for your actual demo).

## On Receive — `on_receive`

Fields: `asset`; optional `minAmountStroops` (integer string).

A customer deposits the input asset into the flow's deposit trigger, which forwards it into the pipeline. Use this for checkout, tips, splits, escrow and pooling. The optional minimum is passed to downstream Split contracts as a floor; the deposit trigger itself checks only that the amount is positive. Do not rely on that field as a general Pay or escrow minimum. Use `execute` prepare → wallet signing → submit, or the hosted trigger page. Sending a plain token transfer to a contract is not a substitute for invoking its deposit function.

## On Schedule — `on_schedule`

Fields: `intervalAmount` (positive integer, default 1), `intervalUnit` (`minute`, `hour`, `day`, `week`, `month`), `startsAt` (ISO date-time); optional `endsAt`, `occurrences` (positive integer), `timeZone`, `pauseAllowed`, `retrieveAllowed`.

Push payments from a funded stream to Pay or Split recipients at recurring intervals. Pre-fund the stream using the hosted trigger page; `execute` does not start it. `endsAt` takes precedence over `occurrences`; without either, deployment uses a 30-day window. End must be after start; a start already in the past is moved to deployment time. A month is 30 days. Pause defaults to allowed, retrieval of unvested funds defaults to disallowed; retrieval requires pausing first.

For Pay, set a positive fixed `amountStroops` per interval. For a percentage Split, set a positive `amountPerIntervalStroops`; for a fixed Split the interval amount is derived from the recipients' total. Scheduled fixed shares become proportional shares of vested funds, with rounding assigned to the last recipient. Use a simple Schedule → Pay or Split graph; amount and time branching conditions cannot be compiled under this trigger.

## HTTP Webhook — `web2_webhook`

Fields: `asset`.

A server-side authenticated HTTP callback makes the relayer invoke an already funded flow. The authenticated owner deployment page provides its trigger URL and webhook secret; keep the secret on your server. Public embeds omit credentials, owner controls and private configuration. Depositing funds tops up this flow and does not fire the callback. It can drive Pay, Split or Swap; its supported condition kind is multisig. This is not an `execute` flow: the v1 deposit API refuses a webhook-headed deployment. For the simplest payment integration use On Receive instead.

After your server verifies the completed goal, release from the funded pool with `x-webhook-secret` and a JSON body containing `escrow: true`. `amount` is a stroop string; omit it or use `"0"` to release the entire available balance. For one reward at a time, specify its amount:

```bash
# Run on your app server; keep PAIFLOW_WEBHOOK_SECRET server-side.
curl -sS --fail-with-body -X POST "$PAIFLOW/api/webhooks/$DEPLOYMENT_ID" \
  -H "x-webhook-secret: $PAIFLOW_WEBHOOK_SECRET" \
  -H "Idempotency-Key: task-completed-42" \
  -H 'Content-Type: application/json' \
  --data '{"escrow":true,"amount":"100000000"}'
```

This requests 10 tokens from the pool. Use one stable `Idempotency-Key` per logical task completion and reuse the same key and payload for every retry. The keyed callback returns an `attemptId`, `network`, `status`, and `txHash` when available. HTTP 202 means `PENDING` or `UNKNOWN`, not a confirmed payout; repeat the keyed callback or use `GET /api/v1/deployments/:id/transactions/:txHash` with the deployment's `pfk_` token to check finality. Changed effective arguments return 409. Keys never automatically expire or reopen; an interrupted preparation can remain `UNKNOWN` without a hash and requires operator review. Never use a fresh key or omit it merely because the outcome is uncertain. Unkeyed callbacks remain supported and can each pay again. See [webhook retry rules](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md#retry-webhook-rewards-safely).

## Subscription — `subscription`

Fields: `asset`, `subscriber` (account address), `amountPerPeriodStroops` (integer string), `intervalAmount` (positive integer, default 1), `intervalUnit` (same five units, default `day`); optional `endsAt`, `occurrences`.

Pull payments from the configured subscriber after they approve an allowance. The relayer charges when due, without the subscriber signing every charge, until the window ends or allowance/balance is exhausted. Starts at deployment time; end/count/default window follow the rules above. The non-deferred amount must be greater than zero. If the next Split has all fixed recipients, its total determines the pull amount instead of a stale manual period amount. Use the allowance page; `execute` cannot start a subscription. Use Pay or Split downstream; amount and time branching conditions are refused under this trigger.

Outside this hackathon, where Dev mode is enabled, Dev mode can defer/change the subscriber and payment values through **Dev values** on the deployment page. On builds containing #790, the configured customer can open `/allowance/[deploymentId]` while logged out and approve with their wallet, without a Paiflow account or deployment token. The page supports ordinary and Dev subscriptions and reads the current deployed subscriber and token. An unconfigured Dev subscriber must be filled by the team first; a different wallet is refused. An allowance still needs the customer's wallet signature. Do not claim that connecting any new wallet automatically creates a new subscriber in this one deployment.

## Pay — `pay`

Fields: `recipient`, `asset`; optional `email` (up to 254 characters), `mode` (`fixed` or `percentage`), `amountStroops`, `percentage` (0–100), `fullAmount` (default false), `fillValueViaApi`, `payoutMode` (use `crypto`).

Pay one recipient. Unless full amount or deferred value is selected, choose a mode: a fixed amount must be positive; a percentage must be greater than zero and at most 100. `fullAmount: true` pays 100% of what arrives. Fixed Pay sends the smaller of incoming amount and its configured cap; any surplus goes to its next step. With no next step, surplus stays in the Pay contract: avoid overfunding a terminal fixed Pay. For variable checkout prices, full amount is simpler.

**Unavailable during this hackathon:** Dev mode stays disabled. The following deferred-value behavior applies only where Dev mode is enabled.

`fillValueViaApi` is only allowed with graph `devMode: true`. That mutable Pay can deploy before its recipient/value is filled. This configuration requires Dev mode and is unavailable for the event. Configure the recipient and amount before deployment.

## Split — `split`

Fields: `asset`, `recipients` (up to 20), optional `amountPerIntervalStroops`. Each recipient has `address`, `mode`, optional `label` (up to 64 characters), optional `email` (up to 254 characters), optional `payoutMode` (use `crypto`), and either `bps` for percentage or `amountStroops` for fixed. The schema also accepts legacy `ratePerSecondStroops`; new schedules use the interval amount.

- All recipients use the same mode. Never mix percentage and fixed rows.
- Percentage shares must each be greater than zero and sum to exactly 10,000 bps. For three equal shares use 3333, 3333, 3334. Rounding remainder goes to the last recipient.
- Fixed amounts must each be positive, with a positive total. Short deposits accumulate; the roster is paid when enough funds are held. Surplus is forwarded to a next step if one exists.
- No duplicate recipient addresses. A non-Dev flow needs at least one recipient. Outside this hackathon, Dev mode may deploy an empty roster, but fill it in **Dev values** before payments.
- A scheduled percentage Split needs a positive `amountPerIntervalStroops`; a fixed scheduled Split derives the amount from its roster.

Use Split for fan-out rather than drawing several outgoing money paths and expecting automatic division. A percentage Split consumes the deposit; it does not leave money for a subsequent per-payment Pay.

## Swap — `swap`

Fields: `assetIn`, `assetOut`, `slippageBps` (default 100), `deadlineSecs` (integer 1–86,400; default 300).

Exchanges XLM for USDC or USDC for XLM through Soroswap. Input and output must differ; input must match what flows into it. Slippage must be at least 30 bps (0.3%, the pool fee) and at most 10,000 bps. Price impact can require a larger bound. The deadline is seconds from execution ledger time, not from graph creation. A failed swap reverts the payment. Exactly one outgoing money edge is required: the entire output goes to that next step, normally Pay or Split. No custom assets. Do not put it under a Schedule trigger.

## Condition — `condition`

The `config.kind` determines fields and behavior:

| Kind          | Fields                                                             | Rule                                                                              |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `amount_gt`   | `amountStroops`                                                    | True for strictly greater incoming amount; equality goes False.                   |
| `amount_lt`   | `amountStroops`                                                    | True for strictly smaller incoming amount; equality goes False.                   |
| `time_before` | `at`, optional `timeZone`                                          | Holds funds; a release strictly before `at` chooses True, at/after chooses False. |
| `time_after`  | `at`, optional `timeZone`                                          | Holds funds; a release at/after `at` chooses True, strictly before chooses False. |
| `multisig`    | `signers` (1–20 account addresses), `threshold` (positive integer) | Approval gate; threshold cannot exceed signer count. Has only True output.        |

Amount and time conditions need **both True and False connected, each to exactly one step**. A direct branch target cannot itself be another condition. A step downstream of a branch cannot have multiple different parents. Both outputs may point to the same step. Use On Receive for these branching flows; they are refused under Schedule and Subscription, and HTTP Webhook supports only multisig.

A time condition does not immediately pay its before side when a deposit arrives. It holds funds until release. Before the deadline, the deploying wallet can release, or the app can authorise the relayer using `release-early`. The app must decide who can request this; possession of the deployment token authorises it. At/after the deadline, automatic release takes the after side. The deadline belongs to the after side; a request for the wrong side is refused rather than redirected. Multiple customers' deposits share this condition's balance and deadline.

Multisig requires signer approvals and release through its contract/UI workflow; a v1 token is not a substitute for these approvals. There is no multisig-approval endpoint in v1.

## Hold — `hold`

Fields: none (`config: {}`). A terminal marker directly on the **before side of a time condition**. Exactly one incoming condition edge and no outgoing edges. It turns that time condition into a strict lock: no wallet or relayer early release. At/after the deadline, the full balance follows the after destination. Hold is part of the time condition, not a separate payable contract. It cannot be placed directly after a trigger.

## Return to owner — `return_to_owner`

Fields: none (`config: {}`). A terminal destination directly after an amount, time or multisig condition, with exactly one incoming edge and no outgoing edges. Pays the full incoming amount to the **wallet that signed deployment**, resolved when deploying and immutable even in Dev mode. It does **not** return each customer's contribution to its original wallet. For a customer refund, configure a Pay recipient explicitly instead.

## Notification settings

Email is a flow setting, not a block: optional `notify: { mode, sendTo }`, with `mode` one of `off`, `every_transaction`, `shortfalls_only`. Owners receive generated transaction summaries; optional Pay/Split recipient emails receive their own payout notices. Addresses stay private. New flows default to transaction notifications; older graphs without this setting stay off. Notification settings do not create another on-chain step.

# 3. Hosted pages

Use `https://beta.app.paiflow.xyz` as the Paiflow testnet origin for every URL below. `deploymentId` is the deployment UUID, not a flow id or `C…` contract address. These pages require a confirmed deployment with the appropriate contract type; an unavailable page returns 404.

| Page      | URL shape                           | What the team's app uses it for                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trigger   | `/trigger/[deploymentId]`           | Public payment/top-up page with amount entry and wallet signing. On Receive deposits run the flow; Schedule and HTTP Webhook deposits fund it. A fixed flow can lock its required amount; variable flows accept an `?amount=10` hint in tokens, not stroops. The flow's required amount overrides the hint.                                                                                                              |
| Embed     | `/deployments/[deploymentId]/embed` | On builds containing #577: public read-only graph, live recent events and a customer payment-page QR for supported Receive, webhook funding and streamer funding deployments. No Paiflow login or API token needed. If streaming is unavailable, activity updates periodically. Balances are omitted. Subscription approval remains a separate allowance page (#790). Credentials and private configuration are omitted. |
| Allowance | `/allowance/[deploymentId]`         | On builds containing #790, the configured subscription customer connects their wallet and approves an asset allowance for the actual subscription contract, without a Paiflow login or deployment token. Each approval adds to the existing allowance. It does not deposit or charge immediately.                                                                                                                        |

If approval confirmation is unknown, check the existing transaction status before approving again. The page resumes the prepared hash after reload and permits another attempt only after confirmation of failure or ledger-proven expiration. Approval does not itself execute a charge. Wallet approval and a manually invoked Subscription charge/payout passed in the SDK testing/testnet rehearsal; the later published-package charge remained fee-blocked and unattended scheduling is unverified. See the [verification summary](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md#hosted-testnet-verification). Post-promotion checks in [the manual checklist](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/manual-verifications.md) remain target-specific.

The usual trigger QR opens this hosted page (or the allowance page for a subscription). The customer then connects a testnet wallet and signs there. Separate transaction QR modes encode SEP-7 requests and require a compatible wallet. Your own checkout can use the execute sequence instead.

# 4. The `/api/v1` API

On builds containing capabilities discovery, `GET /api/v1/deployments/:id/capabilities` with the
deployment's bearer token returns `data` with `network`, `triggerType`, initial `inputAsset` metadata,
`configurationSource: "deployment_snapshot"` and `operations`. Operation keys are `execute`,
`events`, `balances`, `funding`, `transactions`, `releaseEarly`, `payouts`, `webhook`,
`subscriptionState`, `subscriptionAllowance`, `subscriptionCancel`,
`subscriptionReactivate`, `swapQuote`, `scheduleState` and `scheduleControls`. Each has
`status` (`supported`, `conditional` or `unsupported`), `authentication`, `requirements` and
candidate `nodeIds`. This is recorded integration support, not live readiness: no RPC or transaction
is performed, and current funds, deadlines, consent and eligibility must be checked through the
operation's state/preparation endpoint. Initial asset metadata may be stale after Dev mutations;
null means unavailable. Standard flows cannot choose per-payment recipients. Webhook callbacks
still require `x-webhook-secret`; allowance approval requires the configured subscriber's wallet.
Discovery never returns credentials, recipient/subscriber addresses or private graph settings.
Limit: 60 requests/minute per token; confirmed deployments on this environment's network only.

## Authentication and integration boundary

Use `Authorization: Bearer pfd_<64 lowercase hex characters>` for selected-deployment
credentials or `pfk_<64 lowercase hex characters>` for existing single-deployment
tokens. `pfd_` requires explicit grants and immutable `READ_ONLY` / `READ_OPERATE`
permissions; operate endpoints (including reconciliation and relayer early release)
require `READ_OPERATE`. A `pfk_` token is bound to exactly one deployment. Mint it in
**API access** on the team's confirmed deployment; it is shown only once. Store it
on the app server. Missing, malformed, unknown, expired, revoked or wrong-deployment
tokens all return HTTP 401 `UNAUTHENTICATED`, with
`A valid API token for this deployment is required`. A malformed deployment UUID is 404. Revocation takes effect on the next call.

**Use `@paiflow/sdk` from a server-only integration module**, such as the starter's `lib/paiflow.ts`. Read the platform origin, deployment UUID and token from server configuration; keep the bearer token out of browser bundles, browser requests and logs. The SDK supplies transport, typed responses and response metadata; your app supplies wallet consent, unchanged-envelope verification, authorization, persistence and business rules. Do not recreate the SDK as a custom fetch client.

On builds containing #913, Subscription controls use POST

- `POST /api/v1/deployments/{id}/subscription/cancel/prepare`
- `POST /api/v1/deployments/{id}/subscription/cancel/submit`
- `POST /api/v1/deployments/{id}/subscription/cancel/reconcile`
- `POST /api/v1/deployments/{id}/subscription/reactivate/prepare`
- `POST /api/v1/deployments/{id}/subscription/reactivate/submit`
- `POST /api/v1/deployments/{id}/subscription/reactivate/reconcile`

Read `subscription/state`, prepare with
`{walletAddress}`, sign the returned exact `xdr` on `networkPassphrase`, then submit
`{intent,signedXdr}`. Cancel requires active state and revokes allowance; reactivate requires
cancelled state and grants no allowance, new subscriber or immediate charge. Both require the
current configured subscriber's wallet, in addition to the scoped deployment token. Save the
intent/hash and reconcile `{intent}` before replacing any uncertain preparation. Existing Dev cancellation
continues when Dev is disabled; Dev reactivation requires Dev enabled. New Dev deployments
remain unavailable for this hackathon. Bounded ordinary Subscription controls passed
with wallet consent, ledger finality, state and zero-allowance checks on hosted
testing/testnet. The [verification summary](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md#hosted-testnet-verification)
records the later fee-blocked charge and unverified unattended scheduler; it does
not certify beta/staging availability or Dev variants. See the [complete API example](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md#subscription-cancellation-and-reactivation-913).

Browser → your app's server → Paiflow is the API path. The server returns unsigned preparation data to the browser. The customer's wallet signs there; the browser sends the signed envelope back to your server, which submits it. No private key crosses that boundary. Protect your own server routes: a browser action must not let an unauthorised caller release escrow merely because your server holds the token.

## Routes, responses and limits

Success uses `{ "data": ... }`; preparation and submission return HTTP 200. Errors use `{ "error": { "code", "message", "fields"?, "details"? } }`. Inspect HTTP status **and** submission `data.status`. Every token-authenticated response has `x-request-id`; retain it for platform-support debugging. Do not log tokens or signed XDR.

| Method and path                               | Limit                                           |
| --------------------------------------------- | ----------------------------------------------- |
| `GET /api/v1/deployments/:id/capabilities`    | 60 / 60 seconds per token                       |
| `POST /api/v1/deployments/:id/execute`        | 30 / 60 seconds per token                       |
| `POST /api/v1/deployments/:id/execute/submit` | 30 / 60 seconds per token                       |
| `GET /api/v1/deployments/:id/events`          | 120 / 60 seconds per token                      |
| `POST /api/v1/deployments/:id/release-early`  | 10 / 60 seconds per token                       |
| `GET /api/v1/openapi.json` (public, no token) | 60 / 60 seconds per client IP                   |
| `POST /api/v1/demo-token` (public, no token)  | 3 / hour per client IP; 60 / hour instance-wide |

Limits use fixed windows, separately per endpoint. Owner-session token management has a shared 20/minute per-user limit. Working tokens issued or authenticated within 30 days avoid the pre-auth IP backstop. Unseen tokens have 6,000 lookups/minute per address; after 300 authentication failures in ten minutes, only 60 unseen lookups/minute are allowed. Fix a bad token instead of looping on 401.

| HTTP | API error code       | Action                                                        |
| ---- | -------------------- | ------------------------------------------------------------- |
| 401  | `UNAUTHENTICATED`    | Check token and deployment together.                          |
| 402  | `INSUFFICIENT_FUNDS` | Fund the `from` account on testnet.                           |
| 403  | `FORBIDDEN`          | Feature/caller unavailable, including a disabled public demo. |
| 404  | `NOT_FOUND`          | Check UUID and confirmed deployment.                          |
| 409  | `CONFLICT`           | Check the operation status and `Retry-After` before retrying. |
| 422  | `VALIDATION`         | Fix input or the simulated flow; inspect fields and message.  |
| 429  | `RATE_LIMITED`       | Back off using `Retry-After`.                                 |
| 500  | `INTERNAL`           | Keep request id and ask platform support.                     |
| 502  | `UPSTREAM_RPC`       | Retry carefully: submission may already have broadcast.       |

## Execute: prepare → customer's wallet signs → submit

Prepare body: `{ "from": "<customer G-address>", "amount": "100000000" }`. Amount is positive integer stroops of the flow's **input** asset, up to 39 digits; contract arithmetic still must fit i128. `from` must be funded on this network, pay deposit and fee, and sign. All recipients must be able to receive their assets. Preparation simulates the pipeline and refuses a missing prerequisite before the customer signs.

Works for every confirmed flow whose deployed head is a deposit trigger, including On Receive → Pay, Split, Swap or Condition. It does not execute Schedule, Subscription or HTTP Webhook heads.

Preparation data has `xdr` (unsigned base64 envelope), `networkPassphrase`, `network`, `expiresAt`. Require `network === "testnet"` in apps built with this starter; show a **TESTNET** chip on every payment screen. Sign using the returned network passphrase, never a wallet's implicit network. Execute has a **180-second validity window**. Submit `{ "signedXdr": "<wallet-signed envelope>" }` before `expiresAt`.

Submit accepts only one deposit invocation on this deployment's trigger, not arbitrary operations or a fee-bump envelope. Interactive payment preparation, submission and original-hash status recovery each have one shared **25-second RPC budget per operation**. Submission shares it across preflight, sending, confirmation and optional event catch-up; confirmation does not get an additional 25 seconds. Each interactive RPC call uses only the remaining budget; background calls retain their ten-second timeout. Durable bookkeeping completes separately, so the budget is not a strict total HTTP response deadline. `?wait=false` returns once accepted; default `wait=true` uses the remaining budget for confirmation. At most three concurrent waiters per token; extra calls still send and answer without waiting.

Submission data has `txHash`, `status: "SUCCESS" | "PENDING" | "FAILED"`, optional `ledger`, and optional `error: { code, message }` for failure. **FAILED can be HTTP 200.** After positive network acceptance, exhausting the shared confirmation budget returns PENDING. Transport failures during preflight, sending or confirmation can still return `502 UPSTREAM_RPC`; a lost send acknowledgement does not prove that nothing was broadcast. Keep the original preparation, signed envelope and transaction hash. Recover through `GET /api/v1/deployments/:id/transactions/:txHash` (SDK `deployment.transactions.get(txHash)`). Any deliberate resubmission must use the **same signed envelope**, idempotent on its hash. Timeout, local expiry, NOT_FOUND or missing events never authorise preparing or signing a replacement payment. Save the prepare response's `x-history-request-id` and send it as `x-preparation-request-id` on every submit/retry. This optional analytics link does not change transaction authorization or idempotency; missing links do not prove abandonment. SUCCESS attempts event catch-up within the remaining budget; a confirmed outcome stays successful if optional catch-up runs out of time, and events may appear later.

### SDK integration boundary

The following illustrates a server-only SDK preparation; it is not a complete checkout or a replacement for the starter's validation and recovery code:

```ts
import "server-only";
import type { PaiflowDeployment } from "@paiflow/sdk";

export async function prepareExecute(deployment: PaiflowDeployment, from: string) {
  const { data: capabilities } = await deployment.capabilities.get();
  if (
    capabilities.network !== "testnet" ||
    capabilities.inputAsset?.kind !== "native" ||
    capabilities.triggerType !== "deposit" ||
    capabilities.operations.execute.status !== "supported"
  )
    throw new Error("Use a testnet native-XLM Receive deployment with execute support");
  return deployment.execute.prepare({ from, amount: "10000000" });
}

export function submitExecute(
  deployment: PaiflowDeployment,
  prepared: Awaited<ReturnType<typeof prepareExecute>>,
  signedXdr: string,
) {
  return deployment.execute.submit(
    { signedXdr },
    { wait: false, preparationRequestId: prepared.metadata.historyRequestId },
  );
}
```

Construct `new Paiflow({ baseUrl, token }).deployment(deploymentId)` in your server-only module from the validated server configuration, then pass that explicitly configured deployment to these helpers. Validate the public wallet address and authorize the request in your own route before preparing. Persist the returned preparation and `metadata.historyRequestId` before signing. The browser wallet must sign the original `data.xdr` using `data.networkPassphrase`; verify the source, network and unchanged transaction body against the saved preparation. `signPrepared` can coordinate a signing callback but does not parse XDR or verify operations itself. The starter's wallet and transaction modules implement its envelope checks.

After saving the exact signed envelope and original hash, your server calls `deployment.execute.submit({ signedXdr }, { wait: false, preparationRequestId })`, using the original history request ID as `preparationRequestId` on every retry. This non-secret correlation ID does not authorize a transaction or prove finality. Explicitly call `deployment.transactions.get(originalHash)` to check the existing transaction. The SDK makes no automatic retries, replacement preparations or polling loops. `PaiflowApiError` retains HTTP status, error code, request ID and retry metadata; log only safe diagnostics, never credentials or signed envelopes. See the [SDK README](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md) for exact method signatures, signing helpers and recovery constraints.

`SUCCESS` confirms the original transaction; it is not an application receipt. Verify intended payer, asset, amount and recipient payouts before fulfilment. `PENDING`, `UNKNOWN`, missing history, local expiry, transport errors and absent events do not authorize a fresh payment. Keep the original evidence and reconcile it; inspect finality independently of HTTP success.

## GET events: cursor paging and freshness

Query: optional `cursor` (opaque nonempty string, at most 512 characters), `limit` (1–100, default 50), `txHash` (64 hex characters). Unknown query fields are refused. Returns `{ data: { items, nextCursor, hasMore } }`. Each item has `id`, unique `eventId`, `kind`, nullable `topic`, `ledger`, `txHash`, ISO `occurredAt`, and nullable decoded `data`. These are Paiflow's decoded records, oldest first by `(ledger, eventId)`, not a raw chain feed. Typical kinds include `RECEIVE`, `PAYOUT`, `STATUS_CHANGE`. A swap has `kind: "PAYOUT"`, `topic: "swap"`, with `{ assetIn, assetOut, amountIn, amountOut }`; amounts are stroop strings. Asset labels may be symbols or contract addresses.

Store `nextCursor` and pass it back unchanged. While `hasMore` is true fetch immediately; otherwise wait (10–30 seconds is reasonable) and poll with the same cursor. An empty page echoes the supplied cursor. `nextCursor` is null only when there are no events and you supplied no cursor. Do not send `cursor=` when empty. Persist your cursor and deduplicate UI entries by `eventId`. Use a separate cursor when filtering by `txHash`, rather than overwriting the whole-feed cursor.

**Freshness from OpenAPI:** if collection is older than ten seconds, a read collects first and waits up to five seconds, then answers from the records. With continued polling, events usually appear 10–20 seconds after ledger close, including wallet/QR payments and scheduled charges. Collection is shared across callers of a deployment: one at a time and no sooner than ten seconds after the previous one ends. Polling faster does not improve it. Reads during collection or slow network answer with existing records; newer events arrive on a later call. A background poller also runs every minute. Confirmed execute submission attempts event catch-up within its remaining RPC budget; delayed events do not change confirmed success or permit another payment.

For an integration that needs event history, call `deployment.events.list({ cursor, limit, txHash })` for one page or `deployment.events.pages(query, { maxPages })` for bounded iteration. Persist the last cursor and deduplicate by `eventId` across later polls. The SDK does not schedule polling; a page cap is not proof of complete history. See the [SDK event documentation](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md#deployment-reads-and-public-utilities). Event absence never establishes failure. The minimal starter checks transaction status and does not implement an activity feed.

## Release early

Release a time condition's **before side**, for example after a freelancer delivers work. No customer signing is needed: the deployment token authorises the relayer. Body `{ nodeId? }`; empty body or `{}` works with one timelock branch. With several, pass the exact condition node id. Returns `{ data: { nodeId, txHash, ledger? } }` after confirmed release. Authorise the user's delivery decision on your app server before calling this privileged operation.

After the deadline returns 422 `VALIDATION`: `The deadline has passed; this condition now releases to its after side automatically.` Empty balance returns `There is nothing to release: this condition holds no funds right now.` A strict Hold is not an early-releasable branch.

Use `deployment.releaseEarly({ nodeId: "deadline" })` from an authorized application route, with the actual condition ID. This advanced SDK operation is not exposed by the payment-only starter. See the [HTTP API reference](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md) for request/response contracts and limits.

## Public spec and optional demo access

`client.getOpenApi()` reads the public spec. `client.createDemoToken()` explicitly requests a short-lived demo credential where enabled; construction and ordinary reads never request one. These public SDK calls omit a configured bearer credential. The minimal starter uses your configured deployment and does not request demo credentials.

A public demo token expires in 60 minutes and is unavailable where disabled. The shared testnet swap deployment exposes indexed activity to other token holders, including depositing addresses; deposits go to a Paiflow-owned account rather than back to the payer. Use a dedicated testnet wallet. Your project's qualifying evidence must use its own deployment. Refer to the [API README](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md) for direct HTTP examples.

# 5. Testnet wallets and simulating customers

Prepare dedicated testnet wallets and obtain XLM for native payments, fees and reserves. The minimal SDK starter needs no USDC. For USDC integrations, add the exact trustline described below and obtain a USDC balance; a trustline alone provides no balance. Ask your organisers whether wallet support or fallback wallets are available.

To test payments before or during the event, use different wallets to simulate customers: connect/switch to the relevant wallet, prepare using its public address, have it sign in the browser, then submit. Each customer signs their own payment. **The app must never hold a customer's secret key**, even for a demo. Import any fallback-wallet handout keys only into dedicated testnet wallets, outside the app code; never commit them.

Organiser-provided fallback wallets are testnet-only; organisers hold copies of their keys. Never send real (mainnet) funds to them or import them into a wallet you use for real money. Anyone with the key can take what's in them.

**USDC trustlines:** a fresh Stellar wallet usually cannot hold USDC until it adds a trustline to that exact asset code and issuer. A missing recipient trustline can show `TrustlineMissingError` / `The payout recipient has no trustline for {asset}. The recipient must add a trustline for {asset} before this flow can pay them.` in simulation, surfaced as 422 `VALIDATION`; the whole payment reverts. A deploy warning does not block deployment or require acknowledgement, so successful deployment does not prove recipients are ready. In the recipient's testnet wallet, use Add asset / Add trustline for code `USDC`, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, and have that wallet sign its change-trust transaction. Fund a new account with testnet XLM via Friendbot first so it exists and has reserves/fees. A trustline to another issuer's USDC will not work; native XLM needs no trustline. Check the exact trustline and required balances in every wallet, including any organiser-provided fallback wallet. Adding a trustline enables receipt, not a USDC balance: obtain testnet USDC separately, then prepare the failed payment again.

**Testnet USDC funding:** after funding the wallet with XLM and adding the exact USDC trustline, open [Circle's testnet faucet](https://faucet.circle.com/), select **USDC** and **Stellar Testnet**, and enter the customer's public wallet address (`G…`). Confirm the USDC balance before testing payments. Repeat for any wallet that will fund a flow, and choose test amounts that fit the available balance. Friendbot supplies XLM, not USDC.

# 6. Timing advice

Recommend **at least five minutes** for On Schedule and Subscription charge intervals; when using Allowance for a subscription, plan its charges on that same minimum interval. Allowance itself is approval, not a separate timed block. Payments land **one to two minutes after they are due** because automation is polled. Shorter intervals make a demo look stalled and drain testnet funds quickly: 10 USDC/minute requires about 2,400 USDC over four hours. Choose demo amounts to fit your available balance. Deployments share relayer infrastructure. The builder allows one-minute intervals; this is advice, not enforcement, avoid them for shared-infrastructure demos.

The **live feed can lag by up to a minute** in normal background polling. Do not send another payment just because the animation has not appeared. Poll events with the rules above, track submission status/hash, and allow extra time when the network is slow; a minute is not a guaranteed upper bound.

# 7. Common failures

The quoted text below is returned by the API or its contract error translation. `{asset}` is replaced with the resolved asset name, including its issuer where available. A prepare simulation failure appends this prerequisite text:

> `from` must be a funded account on this network: it pays the deposit and the fee, and signs the envelope. The flow's payout recipient must hold a trustline for the asset it receives; a missing trustline reverts the whole pipeline.

| Failure / exact message                                                                                                                                     | What to do                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrustlineMissingError`: `The payout recipient has no trustline for {asset}. The recipient must add a trustline for {asset} before this flow can pay them.` | Add the recipient's trustline to the exact testnet code/issuer, then prepare again. It is normally a 422 simulation refusal, not a partial payout. |
| `AccountMissingError`: `The account receiving {asset} doesn't exist on this network yet. Fund it with XLM first, then add a trustline for {asset}.`         | Friendbot-fund the recipient and add its line.                                                                                                     |
| `BalanceError`: `There isn't enough {asset} to cover this transfer.`                                                                                        | Check payer/input balance, and any funded contract balance needed by the flow. Top up the correct testnet asset.                                   |
| `Insufficient balance to cover this transaction. Check the account balance and try again.`                                                                  | Check testnet asset balance and XLM for fees/reserves.                                                                                             |
| `txInsufficientBalance`: ``The `from` account cannot cover the fee for this transaction.``                                                                  | Fund the signing account with testnet XLM.                                                                                                         |
| 429 `RATE_LIMITED`: `Too many requests`                                                                                                                     | Stop immediate retries and wait the `Retry-After` seconds; reduce polling and duplicate submit loops.                                              |
| `txTooLate`: `The transaction's 180-second window expired before it reached the network. Prepare it again.`                                                 | Retain the original hash and establish final failure or ledger-proven expiry before preparing a replacement; then sign promptly.                   |
| `txBadSeq`: ``The `from` account's sequence number moved since this envelope was prepared. Prepare it again.``                                              | Avoid simultaneous transactions from the same wallet. Establish the original payment outcome before preparing a replacement.                       |
| `txBadAuth`: ``The envelope is not signed by the `from` account.``                                                                                          | Reconnect the selected customer's wallet and sign with the returned passphrase.                                                                    |

If submission returns `PENDING` or a transport/502 error, keep its signed envelope and check again. Expiry is a reason to prepare anew only once the old payment is known not to have succeeded; don't mistake an uncertain response for no payment. For any unfamiliar error, keep `x-request-id`, status, code and message for platform support, without exposing credentials.

# 8. Worked examples

These describe product patterns for custom apps, not additional screens in the payment-only starter. Use the detailed SDK/API references for each operation and retain original transaction evidence throughout signing, submission and recovery.

## Barkada bill splitter or creator tip jar

Graph: **On Receive USDC → Split**, with two recipients at 5000/5000 bps (or your chosen shares summing to 10,000). Every positive customer deposit is distributed by percentage; recipients need USDC trustlines. Deploy once for the group/creator.

App calls: `deployment.execute.prepare({ from: customerPublicKey, amount: "100000000" })` for a 10-USDC contribution → customer's browser wallet signs → `deployment.execute.submit({ signedXdr }, submissionOptions)` → `deployment.events.list({ cursor })`. Show RECEIVE and PAYOUT events, deduplicated by eventId; use the hosted trigger page as a payment alternative and embed for the shared visual feed. Switch wallets to demonstrate three customers, not three deployments.

## Campus Snacks reference sample

Source: [artisam-paiflow/paiflow-campus-snacks](https://github.com/artisam-paiflow/paiflow-campus-snacks), a separate sample application. It represents one branch of a snack shop. See its [README setup instructions](https://github.com/artisam-paiflow/paiflow-campus-snacks/blob/main/README.md) for sample configuration, and follow your own event instructions for when integration is allowed.

Graph: **On Receive USDC → percentage Split**, with Dev mode off. Vendor first: **9000 bps (90%)**; student organisation second: **1000 bps (10%)**. Use distinct funded testnet recipients with the exact USDC trustline. One deployment serves all customers.

Follow the sample's own README and configuration; its USDC shop is distinct from the minimal starter's fixed 1-XLM payment. The server calculates snack prices; Freighter signs in the browser.

For example, a **3.50 USDC** payment splits into **3.15 USDC to the vendor + 0.35 USDC to the student organisation**. Verify your own deployment after setup. The two jars show cumulative received payouts, not wallet balances. They pair a USDC deposit with its percentage Split payout in the same transaction, deduplicate `eventId` and follow contract rounding; unmatched activity stays in history but does not increase totals. `$` labels denote testnet USDC; no real money or goods are involved.

## Sari-sari store checkout

Graph: **On Receive USDC → Pay full amount to the store wallet**, or → percentage Split for the store and partner. The app's basket total supplies input `amount` as stroops. This one deployment serves this store; it does not create a new contract for every shopper.

Custom SDK app calls: deployment.execute.prepare for the customer's address and checkout amount → browser wallet signs → deployment.execute.submit → deployment.events.list, optionally filtering `txHash` to show that checkout's payout. Only mark the payment complete on SUCCESS, not merely HTTP 200. Keep the store and partner recipients configured in the deployment.

## Freelance escrow

Graph: **On Receive USDC → Condition `time_before` at a future deadline**. True/before → Pay full amount to the freelancer; False/after → Pay full amount to the client's configured wallet. Both outputs must be connected. Use an explicit client Pay for a refund, because Return to owner would pay the team's deploying wallet. Do not use Hold if work delivery should permit early release.

Custom SDK app calls: deployment.execute.prepare for the client deposit → client signs → deployment.execute.submit. Poll deployment.events.list to show the deposit is held. When an authorised client accepts delivery **before** the deadline, call `deployment.releaseEarly({ nodeId: "deadline" })` (use the actual condition id), then poll events for the freelancer payout. If no early release occurs, automatic after-side release pays the configured client at/after the deadline, subject to polling delay. Everyone using this deployment shares that deadline and held balance; this is one escrow relationship, not independent escrows per customer.

## Group-buy pool

Graph: **On Receive USDC → Condition `time_after` at the collection deadline**. False/before → Hold; True/after → Return to owner. Customers contribute to one shared locked balance. Early release is disabled; at/after the deadline all funds go to the wallet that signed deployment so the group organiser can buy the goods. This is not automatic per-contributor refunds or a target-based success/failure pool.

Custom SDK app calls: deployment.execute.prepare for each customer contribution → that customer's wallet signs → deployment.execute.submit → deployment.events.list for the shared deposit history. No releaseEarly call: Hold makes it a strict lock. Wait for automatic after-side release and show its event in the feed/embed. Explain in the pitch who controls the deploying wallet and that it receives the pooled money at the deadline.

### Source API: selected deployed Swap quotes (#917)

`GET /api/v1/deployments/{id}/swap-quote?amountStroops=10000000` requires this
deployment's bearer token. Optional `nodeId` is required when several standard
SWAPPER nodes exist. Discover candidates via `operations.swapQuote` (conditional).
Assets, router and slippage are determined by live deployed getters; caller
configuration overrides are rejected. Returns integer stroop input/output/minimum,
readStartedAt/quotedAt, freshness:live, estimate:true, scope:selected_node and
meetsMinimumAtQuote. Sequential live reads are not an atomic snapshot or guaranteed
payout/full-flow prediction; preparation and execution remain authoritative. Budget
is 20/min per token and deployment across tokens, shared Redis required in production.
A bounded SDK testnet Swap completed with independent receipt checks in the
[October 15 evidence report](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/testing/2026-10-15-sdk-swap-execution-982.md).
That dated run does not certify this deployment's current quote, fees or readiness.
Confirm hosted OpenAPI availability before using this operation.

### Deployment funding (#916)

Schedule top-ups and Webhook pool deposits use token-authenticated GET/POST `/api/v1/deployments/{id}/funding`, `/funding/submit` and `/funding/reconcile`. Developer credentials need the selected deployment grant and Read and operate permission for writes; deployment-bound tokens also remain supported. Any consenting funding wallet may sign; a token alone cannot move funds. Funding adds funds only and does not execute payouts or callbacks. One unresolved intent per node blocks replacements until confirmed finality or ledger-proven expiry; UNKNOWN never permits another deposit. Public `/trigger`, `/submit-trigger` and hosted funding remain available. Webhook callbacks separately require `x-webhook-secret`. See the [complete signing and recovery example](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/funding.md). Bounded Schedule/Webhook funding passed on hosted testing/testnet; see the [verification summary](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md#hosted-testnet-verification) for dated evidence, fee-blocked payout tests and target-environment limits.
Schedule controller API: GET `/api/v1/deployments/{id}/schedule/state` and POST
`/schedule/{pause|resume|retrieve}`, plus each action's `/submit` and `/reconcile`.
Use the deployed STREAMER's live controller wallet and permissions, never mutable
flow configuration. State distinguishes token holding balance from vested payout
entitlement and unvested retrieval. Retrieval returns to the contract controller,
requires paused+permitted state, and uses no caller-specified recipient/amount.
One unresolved intent per node across controls/funding. UNKNOWN, queue refusal or
local expiry never permits replacement without durable ledger reconciliation.
Wallet secrets remain outside API requests. Controller consent, pause/resume finality
and permitted retrieval passed on hosted testing/testnet; the later first due payout
remained fee-blocked. See the [Schedule guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/schedule-controls.md) and
[verification summary](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md#hosted-testnet-verification) for evidence,
recovery examples and target-environment limits.
