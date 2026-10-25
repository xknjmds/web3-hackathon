# PadalaSplit API Contract

Shared agreement between **Backend (A)** and **Frontend (B)**.
Status: **PROVISIONAL**. Field names for PaiFlow-derived values (`txHash`, `payouts`, `status`) will be confirmed after spike A3. Any change goes in its own tiny PR and is merged immediately.

## Rules (both sides)

1. **Amounts are integer stroop strings**, never floats. 7 decimals: `1 USDC = "10000000"`. Convert with `bigint` via `lib/amount.ts`.
2. **Peso values are display-only** and returned as strings (e.g. `"560.00"`). They are never used for settlement.
3. **The browser never sees the PaiFlow token.** Only our server calls PaiFlow.
4. **Anything simulated carries `"simulated": true`** from the server. The UI must show a "Simulated" tag whenever it is `true`.
5. **Never create a second payment to resolve uncertainty.** Re-check the original `transferId` / `txHash` instead.
6. Base path: `/api`. All bodies are JSON. All timestamps are ISO 8601 UTC.

## Shared types

```ts
type Asset = "USDC" | "XLM";

type TransferStatus =
  | "PREPARED"    // unsigned tx created, waiting for wallet signature (~180s window)
  | "SUBMITTED"   // signed tx sent to PaiFlow
  | "PENDING"     // PaiFlow has not reported a final result yet
  | "SUCCESS"     // final, payouts expected
  | "FAILED"      // final, payment did not go through
  | "EXPIRED";    // preparation window passed before signing

type ChainStatus = "PENDING" | "CONFIRMED" | "FAILED";
type CashoutStatus = "PROCESSING" | "COMPLETED"; // always simulated

interface ApiError {
  error: {
    code: string;      // e.g. "WRONG_NETWORK", "PREPARE_EXPIRED", "RATE_LIMITED", "VALIDATION_FAILED", "PAIFLOW_UNAVAILABLE"
    message: string;   // safe to show to the user
    retryAfterSeconds?: number; // present on RATE_LIMITED
  };
}
```

On error the response uses a non-2xx HTTP status and the `ApiError` body.

---

## 1. `GET /api/templates`

Returns the seeded family split templates. Each maps to one deployed PaiFlow flow.

**Response 200**

```json
{
  "templates": [
    {
      "id": "monthly-allotment",
      "name": "Monthly allotment",
      "asset": "USDC",
      "recipients": [
        { "id": "r-parents",   "name": "Parents",   "relationship": "Parents",   "bps": 5000 },
        { "id": "r-sister",    "name": "Sister",    "relationship": "Sister",    "bps": 3000 },
        { "id": "r-niece",     "name": "Niece",     "relationship": "Niece",     "bps": 1500 },
        { "id": "r-godparent", "name": "Godparent", "relationship": "Godparent", "bps": 500 }
      ]
    }
  ]
}
```

Notes:
- `bps` (basis points) per template totals exactly `10000`.
- `deployment_id` is **server-only** and is not returned.

---

## 2. `POST /api/transfers/prepare`

Asks PaiFlow to prepare a payment. Returns an unsigned transaction for Freighter to sign.

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
      { "recipientId": "r-parents",   "amount": "50000000", "phpDisplay": "280.00" },
      { "recipientId": "r-sister",    "amount": "30000000", "phpDisplay": "168.00" },
      { "recipientId": "r-niece",     "amount": "15000000", "phpDisplay": "84.00" },
      { "recipientId": "r-godparent", "amount": "5000000",  "phpDisplay": "28.00" }
    ]
  },
  "fx": { "rate": "56.00", "source": "fallback" }
}
```

Possible errors: `VALIDATION_FAILED`, `UNKNOWN_TEMPLATE`, `RATE_LIMITED`, `PAIFLOW_UNAVAILABLE`.

Frontend: sign `unsignedXdr` with Freighter using `networkPassphrase`. If `expiresAt` passes, call prepare again (a new `transferId`).

---

## 3. `POST /api/transfers/submit`

Submits the signed transaction. Non-blocking: returns immediately, the final result comes from the status route.

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

Possible errors: `PREPARE_EXPIRED`, `SIGNED_BODY_MISMATCH`, `ALREADY_SUBMITTED`, `RATE_LIMITED`, `PAIFLOW_UNAVAILABLE`.

Submitting the same `transferId` twice must **not** create a second payment. The server returns `ALREADY_SUBMITTED` or the existing result.

---

## 4. `GET /api/transfers/:id`

Poll every ~3-5 seconds after submit until `status` is `SUCCESS` or `FAILED`. Also used to recover after a reload (store `transferId` in `localStorage`).

**Response 200 (in progress)**

```json
{
  "transferId": "tr_01HXYZ",
  "status": "PENDING",
  "txHash": "a1b2c3...",
  "total": "100000000",
  "asset": "USDC",
  "templateId": "monthly-allotment",
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
  "payouts": [
    {
      "recipientId": "r-parents",
      "name": "Parents",
      "amount": "50000000",
      "phpDisplay": "280.00",
      "chainStatus": "CONFIRMED",
      "txHash": "a1b2c3...",
      "cashout": { "status": "COMPLETED", "simulated": true }
    }
  ]
}
```

Notes:
- `payouts` may be empty or partial while `PENDING`, because payout events can lag. A missing event is **not** a failed payment.
- Treat the transfer as paid **only** when `status === "SUCCESS"`. HTTP 200 alone is not confirmation.
- Cash-out `status` advances from `PROCESSING` to `COMPLETED` on a server-side timer. It is always `simulated: true`.

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

`source` is `"live"` (CoinGecko, cached) or `"fallback"` (hardcoded). The UI labels the rate as an estimate, and labels it "sample rate" when `source` is `"fallback"`.

---

## 6. `POST /api/ramp/quote` (Simulated on-ramp)

AED to USDC quote for the Add money screen. No balance changes.

**Request**

```json
{ "aed": "1000.00" }
```

**Response 200**

```json
{
  "aed": "1000.00",
  "usdc": "272.00",
  "rate": "3.6725",
  "simulated": true
}
```

---

## 7. `GET /api/transfers` (P2, transfer history)

Only built if time allows.

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

1. `GET /api/templates` → user picks a template.
2. User enters a total → UI computes the preview with `lib/amount.ts` (same function the server uses).
3. `POST /api/transfers/prepare` → `unsignedXdr`.
4. Freighter signs → `signedXdr` (reject wrong network / wrong wallet before signing).
5. `POST /api/transfers/submit` → `txHash`.
6. Poll `GET /api/transfers/:id` until `SUCCESS` or `FAILED`.
7. Show the confirmation screen with `explorerUrl` and per-recipient payouts.

## Open items (resolve in spike A3, then update this file)

- Exact PaiFlow response fields for prepare / submit / events.
- Rounding rule for odd amounts (current assumption: remainder goes to the last recipient).
- Maximum recipients per Split (we need 4).
- Typical time from submit to `SUCCESS`.
