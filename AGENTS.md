# SDK payment example

Read `README.md`, `llms.md` and current source first. This repository is a minimal Node SDK payment example; the shared AI context provides Paiflow integration guidance.

- Keep `@paiflow/sdk@0.2.0` runtime imports server-only. Browser type-only imports are fine. All upstream Paiflow requests go through `lib/paiflow.ts` and the SDK, not a second HTTP client.
- Keep platform origin, deployment ID and `pfd_` or `pfk_` credentials server-side. Never use `NEXT_PUBLIC_` or expose tokens in responses, browser assets, URLs or logs.
- Use the configured deployment. Refuse mainnet and non-native-XLM deployments. The fixed amount is 1 XLM (`"10000000"` stroops). Money uses strings and bigint, never floating-point arithmetic.
- Never handle customer private keys. Freighter signs in the browser using the server-prepared network passphrase. Compare signed and original transaction bodies/hashes; do not accept altered operations or fee-bump envelopes.
- Persist preparation before signing and exact signed envelope before submission. Retain original hash, scope and preparation correlation metadata. Preserve Web Locks; fail closed on storage errors. Never log recovery records.
- Uncertain requests, `PENDING`, `UNKNOWN`, `NOT_FOUND` and expiry do not authorize replacement. Reconcile the original transaction and retry only its exact signed envelope. Never silently change deployment during recovery.
- Preserve same-origin mutation checks and narrow request validation. Do not expose an unrestricted upstream proxy or privileged relayer controls.
- Transaction confirmation is distinct from verified payouts and order fulfilment. Real applications need authentication, ownership checks, durable storage, rate limits, trusted pricing and receipt verification.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build` and browser credential checks. Use local fixtures; do not perform live financial tests without authorization.
- Follow event primers for event rules. Use the SDK as the default integration path; keep this example focused on the payment lifecycle.
