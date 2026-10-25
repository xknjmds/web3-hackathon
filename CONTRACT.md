# PadalaSplit API Contract

**Version 1.2** | Shared agreement between **Backend (A)** and **Frontend (B)**.

Status: **PROVISIONAL**. PaiFlow-derived fields are now aligned with the PaiFlow API reference (`docs/api/README.md`, OpenAPI 1.1.0). Anything marked **VERIFY** must be confirmed against real responses in spike A3. Any change to this file goes in its own tiny PR and is merged immediately.

**Changes from v1.1**
- Added `REJECTED` and `UNKNOWN` transfer statuses (PaiFlow transaction lookup can return both).
- Payout amounts now carry an `amountSource` because percentage Split events can describe shares rather than literal transfers.
- Documented how our server uses PaiFlow's `x-history-request-id` and `x-preparation-request-id` headers (server-internal, not exposed to the browser).
- Added multiple preset templates, a `GET /api/templates` priority order and the template `enabled` rule.
- Removed all on-ramp and off-ramp routes. They are **future work shown in the pitch only** (last section).

## Rules (both sides)

1. **Amounts are integer stroop strings**, never floats. 7 decimals: `1 USDC = "10000000"`. Convert with `bigint` via `lib/amount.ts`.
2. **Peso values are display-only** estimates, returned as strings (e.g. `"560.00"`). They are never used for settlement.
3. **The browser never sees the PaiFlow token.** Only our server calls PaiFlow. The token is a `pfd_` developer token (Read and operate, may select several deployments) or a `pfk_` single-deployment token.
4. **Freighter signs in the browser. Our server never holds a customer secret key.**
5. **Identity is the wallet address.** No accounts or passwords. The server creates or finds a user by `walletAddress` on the first `prepare` call.
6. **Mock or fallback data carries a flag from the server** (`"mock": true`, `"source": "fallback"`). The UI must show a visible label when it is set.
7. **Never create a second payment to resolve uncertainty.** Re-check the original `transferId` / `txHash` instead. Expiry, `NOT_FOUND`, `UNKNOWN` or missing events never prove a replacement is safe.
8. **PaiFlow is required.** All splitting happens in a deployed PaiFlow flow. We never build our own multi-payment transaction.
9. Base path: `/api`. All bodies are JSON. All timestamps are ISO 8601 UTC.
10. **Testnet only.** Network passphrase: `Test SDF Network ; September 2015`.

## Shared types

```ts
type Asset = "USDC" | "XLM";

type TransferStatus =
  | "PREPARED"    // unsigned tx created, waiting for wallet signature (~180s window)
  | "SUBMITTED"   // signed tx sent to PaiFlow
  | "PENDING"     // accepted, finality not known yet
  | "SUCCESS"     // final, payouts expected
  | "FAILED"      // final, transaction failed on chain
  | "REJECTED"    // PaiFlow refused the submission (not an on-chain failure)
  | "UNKNOWN"     // attributed to our deployment but outcome not established
  | "EXPIRED";    // preparation window passed before signing

type ChainStatus = "PENDING" | "CONFIRMED" | "FAILED";

// Where a payout amount was confirmed from.
// "transaction" = verified from transaction evidence (preferred)
// "event"       = taken from a PaiFlow event only; may describe a share, not a transfer
type AmountSource = "transaction" | "event" | "preview";

interface ApiError {
  error: {
    code: ErrorCode;
    message: string;              // safe to show to the user
    retryAfterSeconds?: number;   // present on RATE_LIMITED
  };
}

type ErrorCode =
  | "VALIDATION_FAILED"     // bad body or amount
  | "INVALID_WALLET"        // not a valid Stellar public key (G..., 56 chars)
  | "WRONG_NETWORK"         // frontend/Freighter not on Testnet
  | "WRONG_WALLET"          // signed tx source differs from the wallet used in prepare
  | "UNKNOWN_TEMPLATE"
  | "TEMPLATE_DISABLED"
  | "PREPARE_EXPIRED"
  | "SIGNED_BODY_MISMATCH"  // signed tx body does not match what we prepared
  | "ALREADY_SUBMITTED"
  | "RATE_LIMITED"          // PaiFlow or our own limit; honor retryAfterSeconds
  | "PAIFLOW_UNAVAILABLE"   // PaiFlow 5xx/timeout; the request may still have been sent
  | "NOT_FOUND";
```

On error the response uses a non-2xx HTTP status and the `ApiError` body. A `PAIFLOW_UNAVAILABLE` on submit does **not** mean the transaction was not sent: re-check the same `transferId`.

---

## 1. `GET /api/templates`

Returns the enabled preset splits. Each maps to one deployed PaiFlow flow (percentage Split). Source: `data/templates.json`. Ordered by `priority` ascending.

**Response 200**

```json
{
  "templates": [
    {
      "id": "monthly-allotment",
      "name": "Monthly allotment",
      "description": "Regular monthly support for the family.",
      "asset": "USDC",
      "recipients": [
        { "id": "r-parents",   "name": "Parents",   "relationship": "Parents",   "payoutLabel": "GCash (demo)", "bps": 5000 },
        { "id": "r-sister",    "name": "Sister",    "relationship": "Sister",    "payoutLabel": "Maya (demo)",  "bps": 3000 },
        { "id": "r-niece",     "name": "Niece",     "relationship": "Niece",     "payoutLabel": "GCash (demo)", "bps": 1500 },
        { "id": "r-godparent", "name": "Godparent", "relationship": "Godparent", "payoutLabel": "BPI (demo)",   "bps": 500 }
      ]
    }
  ]
}
```

Notes:
- `bps` (basis points) per template totals exactly `10000`.
- `payoutLabel` is a display label only. No real account numbers are stored.
- `deploymentId` and recipient wallet addresses are **server-only** and not returned.
- Templates with `"enabled": false` are not returned. A template is enabled only after its PaiFlow deployment is CONFIRMED and its UUID is in `templates.json`.
- Splits are fixed per deployment. The UI offers presets only. Custom splits are a roadmap item (see last section).

---

## 2. `POST /api/transfers/prepare`

Validates the request, creates or finds the user by wallet, and asks PaiFlow to prepare a payment (`POST /api/v1/deployments/{id}/execute` with `from` and `amount`). Returns an unsigned transaction for Freighter to sign.

**Request**

```json
{
  "templateId": "monthly-allotment",
  "walletAddress": "G...SENDER",
  "amount": "100000000"
}
```

`amount` = total in stroops (`"100000000"` = 10 USDC).

**Response 200**

```json
{
  "transferId": "tr_01HXYZ",
  "status": "PREPARED",
  "unsignedXdr": "AAAAAgAAAA...",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "expiresAt": "2026-10-25T10:03:00Z",
  "preview": {
    "total": "100000000",
    "payouts": [
      { "recipientId": "r-parents",   "amount": "50000000", "phpDisplay": "280.00", "amountSource": "preview" },
      { "recipientId": "r-sister",    "amount": "30000000", "phpDisplay": "168.00", "amountSource": "preview" },
      { "recipientId": "r-niece",     "amount": "15000000", "phpDisplay": "84.00",  "amountSource": "preview" },
      { "recipientId": "r-godparent", "amount": "5000000",  "phpDisplay": "28.00",  "amountSource": "preview" }
    ]
  },
  "fx": { "rate": "56.00", "source": "fallback", "displayOnly": true }
}
```

Server behavior (internal):
- Maps PaiFlow's `data.xdr` to `unsignedXdr`.
- Saves PaiFlow's `x-history-request-id` response header as `prep_request_id` and stores the original preparation. These are never sent to the browser.
- The preview is computed with `lib/amount.ts`; the real split is determined by the PaiFlow deployment. Rounding rule: **VERIFY** in spike A3.

Possible errors: `VALIDATION_FAILED`, `INVALID_WALLET`, `UNKNOWN_TEMPLATE`, `TEMPLATE_DISABLED`, `RATE_LIMITED`, `PAIFLOW_UNAVAILABLE`. A missing trustline or unfunded account surfaces as `VALIDATION_FAILED` with PaiFlow's safe message (it names the affected account when known).

Frontend:
- Before calling prepare, confirm Freighter is on **Testnet** (otherwise show `WRONG_NETWORK` locally).
- Sign `unsignedXdr` with Freighter using `networkPassphrase`. Preparation lasts about 180 seconds, so unlock Freighter first.
- If `expiresAt` passes before signing and the user never signed, call prepare again (a new `transferId`). If they did sign, do not prepare a new payment; check the old `transferId` first.

---

## 3. `POST /api/transfers/submit`

Submits the signed transaction (PaiFlow `.../execute/submit`). Non-blocking: returns immediately, and the final result comes from the status route.

**Request**

```json
{
  "transferId": "tr_01HXYZ",
  "signedXdr": "AAAAAgAAAA...signed"
}
```

**Response 200**

```json
{
  "transferId": "tr_01HXYZ",
  "status": "SUBMITTED",
  "txHash": "a1b2c3...original-transaction-hash"
}
```

Server behavior (internal):
- Checks that the signed transaction body matches the saved preparation (added signatures are allowed; a changed body or fee-bump wrapper is `SIGNED_BODY_MISMATCH`) and that the signer matches the prepared wallet (`WRONG_WALLET`).
- Saves the signed envelope and hash **before** sending.
- Sends PaiFlow's `x-preparation-request-id` header with the saved `prep_request_id`, on every retry.
- Calls PaiFlow with `wait=false` so it returns promptly.

Possible errors: `PREPARE_EXPIRED`, `SIGNED_BODY_MISMATCH`, `WRONG_WALLET`, `ALREADY_SUBMITTED`, `RATE_LIMITED`, `PAIFLOW_UNAVAILABLE`.

Submitting the same `transferId` twice must **not** create a second payment. Resubmitting the same signed envelope is safe because PaiFlow is idempotent on the envelope hash; the server returns the existing result.

---

## 4. `GET /api/transfers/:id`

Poll every 3-5 seconds after submit until `status` is final (`SUCCESS`, `FAILED`, `REJECTED`). Also used to recover after a reload (store `transferId` in `localStorage`).

Server behavior (internal): resolves the original `txHash` through PaiFlow's transaction lookup, then reads events and confirms payout amounts from transaction evidence. PaiFlow event ingestion runs about 10-20 seconds behind and should not be polled faster than every 10 seconds, so the server caches PaiFlow reads for at least 10 seconds and the UI polling our API every 3-5 seconds is safe.

**Response 200 (in progress)**

```json
{
  "transferId": "tr_01HXYZ",
  "status": "PENDING",
  "txHash": "a1b2c3...",
  "total": "100000000",
  "asset": "USDC",
  "templateId": "monthly-allotment",
  "mock": false,
  "payouts": []
}
```

**Response 200 (success)**

```json
{
  "transferId": "tr_01HXYZ",
  "status": "SUCCESS",
  "txHash": "a1b2c3...",
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/a1b2c3...",
  "total": "100000000",
  "asset": "USDC",
  "templateId": "monthly-allotment",
  "mock": false,
  "payouts": [
    {
      "recipientId": "r-parents",
      "name": "Parents",
      "amount": "50000000",
      "amountSource": "transaction",
      "phpDisplay": "280.00",
      "chainStatus": "CONFIRMED",
      "txHash": "a1b2c3..."
    }
  ]
}
```

Notes:
- `payouts` may be empty or partial while `PENDING`, because payout events can lag. A missing event is **not** a failed payment.
- Treat the transfer as paid **only** when `status === "SUCCESS"` and the payouts are present. HTTP 200 alone is not confirmation.
- `amountSource: "event"` means the amount came from a PaiFlow event only and may describe a share rather than the transfer. The UI should prefer `"transaction"`; if only `"event"` is available, label it "reported by PaiFlow" and still show the explorer link.
- `REJECTED` is a submission refusal, not an on-chain failure. `UNKNOWN` means the outcome is not established: keep checking the original hash. Neither authorizes a new payment.
- `mock: true` means the Mock PaiFlow fallback served this result. The UI must show a visible **Mock PaiFlow** banner and must not present the hash as a real Stellar transaction.

Possible errors: `NOT_FOUND`.

---

## 5. `GET /api/fx`

Display-only exchange rate (USDC to PHP).

**Response 200**

```json
{
  "pair": "USDC/PHP",
  "rate": "56.00",
  "source": "live",
  "fetchedAt": "2026-10-25T10:00:00Z",
  "displayOnly": true
}
```

`source` is `"live"` (CoinGecko, cached) or `"fallback"` (hardcoded). The UI labels the rate as an estimate, and as a "sample rate" when `source` is `"fallback"`.

---

## 6. `GET /api/transfers` (P2, transfer history)

Only built if time allows. Filtered by `?wallet=G...`.

**Response 200**

```json
{
  "transfers": [
    {
      "transferId": "tr_01HXYZ",
      "templateId": "monthly-allotment",
      "total": "100000000",
      "asset": "USDC",
      "status": "SUCCESS",
      "txHash": "a1b2c3...",
      "createdAt": "2026-10-25T10:02:10Z"
    }
  ]
}
```

---

## Mock mode (frontend)

Set `NEXT_PUBLIC_USE_MOCK=true` in `.env.local`. `lib/api-client.ts` then returns the static JSON above instead of calling the server. When backend routes are live, set it to `false`. UI code does not change.

## Payment flow (sequence)

1. B connects Freighter and checks that it is on Testnet. The address is the user.
2. `GET /api/templates` → user picks a preset.
3. User enters a total in USDC → UI computes the preview with `lib/amount.ts` (the same function the server uses).
4. `POST /api/transfers/prepare` → `unsignedXdr`.
5. Freighter signs → `signedXdr`.
6. `POST /api/transfers/submit` → `txHash`.
7. Poll `GET /api/transfers/:id` until the status is final.
8. Show the confirmation screen with `explorerUrl` and per-recipient payouts.

## Open items (resolve in spike A3, then update this file)

- Exact PaiFlow response fields for prepare, submit, transactions and events (compare real responses to the shapes above).
- Rounding rule for odd amounts (current assumption: the remainder goes to the last recipient).
- Maximum recipients per Split (we need 4). If lower, use the 3-recipient preset.
- Maximum deployments per team (we need 3 to 4 presets).
- Whether the hosted build supports `pfd_` developer tokens across several deployments (OpenAPI 1.1.0). If not, use one `pfk_` token per deployment.
- Typical time from submit to `SUCCESS` and to payout events.
- How to verify actual payout transfers from transaction evidence (Stellar Expert API or RPC) if events report shares.

---

## Future (not built, pitch only)

These are roadmap items shown on the vision slide. Do **not** build routes, screens or database columns for them during the hackathon.

- **On-ramp (AED to USDC)** and **off-ramp (USDC to PHP cash-out)** through a licensed partner that supports Stellar USDC and PHP.
- **Receiver app**: relative-facing view, payout method choice, history.
- **Custom splits**: today each split is a deployed PaiFlow flow. Editable splits need per-payment values, which the platform exposes only in Dev mode (disabled during the event).
- **Notifications** (email, SMS, push) and **monthly scheduling**.
