"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicConfig, Prepared, Result } from "@/lib/types";
import {
  BrowserRequestError,
  browserRequest,
  RESPONSE_DEADLINE_MS,
} from "@/lib/browser-api";
import {
  assertStatus,
  confirmOriginal,
  CONFIRMATION_PENDING,
  CONFIRMATION_UNRESOLVED,
} from "@/lib/confirmation";
import { connectWallet, signPrepared } from "@/lib/wallet";
import { assertOriginal } from "@/lib/transaction";
import {
  readRecovery,
  saveRecovery,
  terminal,
  assertNoConflictingRecovery,
} from "@/lib/recovery";
import type { Recovery } from "@/lib/recovery";

type Operation = {
  signal: AbortSignal;
  valid: () => boolean;
  save: (record: Recovery) => void;
  message: (message: string) => void;
};

export function StarterApp({ config }: { config: PublicConfig }) {
  const [address, setAddress] = useState("");
  const [record, setRecord] = useState<Recovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState(true);
  const key = config.ready ? `paiflow-sdk-payment-v2:${config.scope}` : "";
  const scopeKey = useRef(key);
  scopeKey.current = key;
  const loadedKey = useRef<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const resumed = useRef(new Set<string>());
  useEffect(() => {
    loadedKey.current = null;
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setConfirming(false);
    resumed.current.clear();
    setBlocked(true);
    setRecord(null);
    setAddress("");
    setMessage("");
    if (!config.ready) return;
    try {
      assertNoConflictingRecovery(localStorage, key);
      const raw = localStorage.getItem(key);
      if (raw) setRecord(readRecovery(config.scope, raw));
      loadedKey.current = key;
      setBlocked(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Recovery storage could not be read. Preserve it for support before starting another payment.",
      );
    }
    return () => {
      loadedKey.current = null;
      active.current?.abort();
    };
  }, [key, config.ready]);

  async function run(
    action: (current: Recovery | null, op: Operation) => Promise<void>,
  ) {
    if (!config.ready || active.current || blocked || loadedKey.current !== key)
      return;
    const controller = new AbortController();
    active.current = controller;
    const valid = () =>
      !controller.signal.aborted &&
      scopeKey.current === key &&
      loadedKey.current === key;
    const op: Operation = {
      signal: controller.signal,
      valid,
      save: (r) => {
        if (!valid())
          throw new DOMException("Operation cancelled", "AbortError");
        if (r.scope !== config.scope)
          throw new Error(
            "Recovery scope mismatch. Retain the original record.",
          );
        saveRecovery(localStorage, key, r);
        setRecord(r);
      },
      message: (text) => {
        if (valid()) setMessage(text);
      },
    };
    setBusy(true);
    setMessage("");
    try {
      if (!navigator.locks)
        throw new Error(
          "This browser needs Web Locks support for safe payment recovery.",
        );
      await navigator.locks.request(
        key,
        { ifAvailable: true },
        async (lock) => {
          if (!valid()) return;
          if (!lock)
            throw new Error(
              "Another tab is handling this deployment's payment. Return to that tab.",
            );
          assertNoConflictingRecovery(localStorage, key);
          const raw = localStorage.getItem(key);
          const current = raw ? readRecovery(config.scope, raw) : null;
          setRecord(current);
          await action(current, op);
        },
      );
    } catch (error) {
      op.message(
        error instanceof Error
          ? error.message
          : "Unresolved operation. Keep the original record.",
      );
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (scopeKey.current === key && loadedKey.current === key) {
          setBusy(false);
          setConfirming(false);
        }
      }
    }
  }

  function statusMessage(result: Result) {
    if (result.status === "SUCCESS")
      return "Original transaction confirmed. This does not verify downstream payouts or fulfil an application order.";
    if (result.status === "FAILED")
      return "Original transaction failed on the network. Its evidence is retained until acknowledged.";
    return `Original transaction: ${result.status}. UNKNOWN, rejection, expiry or missing history never prove replacement is safe.`;
  }
  async function checkOriginal(current: Recovery, op: Operation) {
    if (!op.valid()) return;
    resumed.current.add(`${key}:${current.prepared.txHash}`);
    op.message(CONFIRMATION_PENDING);
    setConfirming(true);
    const outcome = await confirmOriginal({
      txHash: current.prepared.txHash,
      signal: op.signal,
      lookup: (signal, remainingMs) =>
        browserRequest<Result>(
          "/api/pay",
          { action: "status", txHash: current.prepared.txHash },
          signal,
          remainingMs,
        ),
      onResult: (result) => {
        op.save({ ...current, status: result.status });
        if (
          result.status === "SUCCESS" ||
          result.status === "FAILED" ||
          result.status === "REJECTED"
        )
          op.message(statusMessage(result));
      },
    });
    if (outcome === "unresolved") op.message(CONFIRMATION_UNRESOLVED);
  }
  useEffect(() => {
    if (
      blocked ||
      busy ||
      !record?.attempted ||
      !record.signedXdr ||
      terminal(record)
    )
      return;
    const identity = `${key}:${record.prepared.txHash}`;
    if (resumed.current.has(identity)) return;
    resumed.current.add(identity);
    void run(async (current, op) => {
      if (current?.attempted && current.signedXdr && !terminal(current))
        await checkOriginal(current, op);
    });
  }, [key, blocked, busy, record]);

  async function prepare(current: Recovery | null, op: Operation) {
    if (current)
      throw new Error("Resolve the existing payment before preparing another.");
    if (!address) throw new Error("Connect Freighter first.");
    const prepared = await browserRequest<Prepared>(
      "/api/pay",
      { action: "prepare", from: address },
      op.signal,
    );
    if (!config.ready) return;
    op.save({ version: 2, scope: config.scope, address, prepared });
    op.message(
      "Prepared and saved. Review the wallet transaction before approving.",
    );
  }
  async function sign(current: Recovery | null, op: Operation) {
    if (!current || current.signedXdr || terminal(current)) return;
    if (address !== current.address)
      throw new Error("Connect the original consenting wallet.");
    const next = { ...current, signing: true };
    op.save(next);
    const signedXdr = await signPrepared(current.prepared, current.address);
    assertOriginal(current.prepared.xdr, signedXdr, current.prepared.txHash);
    op.save({ ...next, signing: false, signedXdr });
    op.message("Exact signed envelope saved. Submit when ready.");
  }
  async function submit(current: Recovery | null, op: Operation) {
    if (!current?.signedXdr || terminal(current)) return;
    assertOriginal(
      current.prepared.xdr,
      current.signedXdr,
      current.prepared.txHash,
    );
    const next = { ...current, attempted: true };
    resumed.current.add(`${key}:${current.prepared.txHash}`);
    op.save(next);
    let result: Result;
    try {
      result = await browserRequest<Result>(
        "/api/pay",
        {
          action: "submit",
          signedXdr: current.signedXdr,
          preparationRequestId: current.prepared.preparationRequestId,
        },
        op.signal,
        RESPONSE_DEADLINE_MS,
      );
    } catch (error) {
      if (!op.valid()) return;
      if (
        error instanceof BrowserRequestError &&
        error.status < 500 &&
        error.code !== "UPSTREAM_RPC"
      )
        throw error;
      await checkOriginal(next, op);
      return;
    }
    if (!op.valid()) return;
    if (result.txHash !== current.prepared.txHash)
      throw new Error("Response hash mismatch. Keep the original record.");
    if (result.status === "REJECTED") {
      op.save({ ...next, status: "REJECTED" });
      op.message(statusMessage(result));
      return;
    }
    // Confirmation uses the original status route even when submission reports success.
    await checkOriginal(next, op);
  }
  async function status(current: Recovery | null, op: Operation) {
    if (!current) return;
    const result = await browserRequest<Result>(
      "/api/pay",
      { action: "status", txHash: current.prepared.txHash },
      op.signal,
      RESPONSE_DEADLINE_MS,
    );
    if (!op.valid()) return;
    assertStatus(result, current.prepared.txHash);
    op.save({ ...current, status: result.status });
    op.message(statusMessage(result));
  }
  async function clear(current: Recovery | null, op: Operation) {
    if (!current || !terminal(current))
      throw new Error(
        "Check final SUCCESS or FAILED before clearing this record.",
      );
    if (!op.valid()) return;
    localStorage.removeItem(key);
    if (localStorage.getItem(key) !== null)
      throw new Error("Could not clear stored evidence.");
    setRecord(null);
    op.message(
      "Final transaction acknowledged. A new demo payment is now possible.",
    );
  }
  return (
    <main>
      <header>
        <h1>Paiflow SDK payment starter</h1>
        <span className="chip" data-testid="network-chip">
          TESTNET
        </span>
      </header>
      <p>
        A minimal 1 XLM payment demo using the server-side Paiflow SDK and
        Freighter. Use your own native-XLM Receive deployment. No goods or
        orders are fulfilled by this example.
      </p>
      {!config.ready ? (
        <aside>{config.message}</aside>
      ) : (
        <p>
          <a href={config.deploymentUrl} target="_blank" rel="noreferrer">
            Review your deployment and its recipients
          </a>
        </p>
      )}
      <section>
        <h2>1. Connect and prepare</h2>
        <button
          disabled={busy || !config.ready || blocked}
          onClick={() =>
            run(async (_current, op) => {
              await browserRequest("/api/integration", undefined, op.signal);
              const address = await connectWallet();
              if (op.valid()) setAddress(address);
            })
          }
        >
          Connect Freighter
        </button>
        <p>Wallet: {address || "Not connected"}</p>
        <p>
          Payment: 1 testnet XLM plus network fees. Review the full transaction
          in Freighter.
        </p>
        <button
          disabled={busy || blocked || !address || !!record}
          onClick={() => run(prepare)}
        >
          Prepare 1 XLM payment
        </button>
      </section>
      <section>
        <h2>2. Sign and submit</h2>
        <button
          disabled={
            busy || !record || !!record.signedXdr || terminal(record) || blocked
          }
          onClick={() => run(sign)}
        >
          Sign original transaction
        </button>{" "}
        <button
          disabled={
            busy ||
            !record?.signedXdr ||
            (!!record && terminal(record)) ||
            blocked
          }
          onClick={() => run(submit)}
        >
          {record?.attempted
            ? "Retry exact saved envelope"
            : "Submit saved envelope"}
        </button>
      </section>
      <section>
        <h2>3. Verify and recover</h2>
        <p>
          Reloading restores the original preparation and signed envelope. Keep
          this browser's storage until the original transaction is resolved.
          Re-signing uses the same body; it never prepares a replacement.
        </p>
        {record && (
          <>
            <p>
              Original transaction: <code>{record.prepared.txHash}</code>
            </p>
            <p>Preparation expires: {record.prepared.expiresAt}</p>
            <p>Status: {record.status || "Not checked"}</p>
          </>
        )}
        <button
          disabled={busy || !record || blocked}
          onClick={() => run(status)}
        >
          Check original transaction
        </button>{" "}
        <button
          disabled={busy || !record || !terminal(record) || blocked}
          onClick={() => run(clear)}
        >
          Acknowledge final result and clear
        </button>
        <p>
          Inspect the deployment's activity and recipient balances separately to
          verify your intended payment and payout rules. Transaction
          confirmation alone is not application payment verification.
        </p>
      </section>
      <p role="status" aria-live="polite">
        {confirming ? message : busy ? "Working…" : message}
      </p>
      {confirming && (
        <button
          onClick={() => {
            active.current?.abort();
            setMessage(CONFIRMATION_UNRESOLVED);
          }}
        >
          Stop checking
        </button>
      )}
      <aside>
        This local demo has no app authentication, order database, rate limit or
        business verification. Do not deploy it as a production checkout. A
        production application must bind prepared transactions to authorised
        orders and keep durable server-side recovery evidence. Browser storage
        is not a backup; deleting it loses recovery.
      </aside>
    </main>
  );
}
