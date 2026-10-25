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
  const displayStatus = record?.status ?? (record?.attempted ? "PENDING" : record?.signedXdr ? "SIGNED" : record ? "PREPARED" : "READY");
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#payment" onClick={(event) => event.preventDefault()} aria-label="Hati payment home">
          <span className="brand-mark">H</span><span className="brand-name">Hati<span>.</span></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Payment navigation">
          <a className="nav-link active" href="#payment"><span className="nav-icon">↗</span> Send support</a>
          <a className="nav-link" href="#recovery"><span className="nav-icon">◷</span> Payment activity</a>
        </nav>
        <div className="sidebar-note"><span className="sidebar-note-icon">✓</span><div><b>Testnet protected</b><small>Test payments only</small></div></div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> Send support</div>
          <div className="topbar-meta"><span className="network-badge"><i/> Stellar Testnet</span><span className="topbar-divider"/><span className="demo-label">Payment demo</span></div>
        </header>
        <div className="content-wrap">
          <section className="hero" aria-labelledby="page-title">
            <div><div className="eyebrow">A SIMPLE WAY TO SEND</div><h1 id="page-title">Send support with Hati<span>.</span></h1><p>Prepare a 1 XLM testnet payment, approve it in Freighter, and track its original transaction.</p></div>
            <div className="hero-mark" aria-hidden="true"><span>H</span><i>✓</i></div>
          </section>

          {!config.ready && <div className="notice notice-warning" role="status"><span className="notice-icon">!</span><div><b>Payments are not configured</b><p>{config.message}</p></div></div>}
          {config.ready && <div className="summary-grid">
            <section className="summary-card"><div className="summary-icon wallet-icon">◈</div><div><span className="summary-label">PAYMENT AMOUNT</span><strong>1 XLM</strong><small>Plus Stellar network fees</small></div><span className="fixed-tag">FIXED</span></section>
            <section className="summary-card deployment-card"><div className="summary-icon deployment-icon">⌘</div><div><span className="summary-label">DEPLOYMENT</span><strong>Configured testnet flow</strong><small>Native XLM · Receive flow</small></div><a href={config.deploymentUrl} target="_blank" rel="noreferrer" className="text-link">Review <span aria-hidden="true">↗</span></a></section>
          </div>}

          <section className="workflow-section" id="payment" aria-labelledby="workflow-title">
            <div className="section-heading"><div><div className="eyebrow">PAYMENT WORKFLOW</div><h2 id="workflow-title">Your payment</h2><p>Connect, prepare, sign, then confirm the same transaction.</p></div><span className={`status-badge status-${displayStatus.toLowerCase()}`}><i/>{displayStatus === "READY" ? "Ready" : displayStatus}</span></div>
            <ol className="workflow-track" aria-label="Payment progress">
              <li className={!address ? "current" : "complete"}><span>{address ? "✓" : "1"}</span><b>Connect</b></li><i/>
              <li className={record ? "complete" : address ? "current" : ""}><span>{record ? "✓" : "2"}</span><b>Prepare</b></li><i/>
              <li className={record?.signedXdr ? "complete" : record ? "current" : ""}><span>{record?.signedXdr ? "✓" : "3"}</span><b>Sign & submit</b></li><i/>
              <li className={record?.status === "SUCCESS" || record?.status === "FAILED" ? "complete" : record?.attempted ? "current" : ""}><span>{record?.status === "SUCCESS" || record?.status === "FAILED" ? "✓" : "4"}</span><b>Confirm</b></li>
            </ol>

            <div className="action-grid">
              <section className="action-card" aria-labelledby="connect-title">
                <div className="card-step">01</div><div className="card-body"><div className="card-heading"><div><h3 id="connect-title">Connect your wallet</h3><p>Freighter keeps your keys and signs only after your approval.</p></div><span className={`mini-state ${address ? "is-done" : ""}`}>{address ? "Connected" : "Step 1"}</span></div>
                  <div className={`wallet-state ${address ? "wallet-connected" : ""}`}><span className="wallet-state-icon">◈</span><div><b>{address ? "Freighter wallet connected" : "No wallet connected"}</b><small className="wallet-address">{address ? `${address.slice(0, 7)}…${address.slice(-6)}` : "Connect Freighter on Stellar Testnet"}</small></div></div>
                  <button className="button button-secondary button-full" disabled={busy || !config.ready || blocked} onClick={() => run(async (_current, op) => { await browserRequest("/api/integration", undefined, op.signal); const walletAddress = await connectWallet(); if (op.valid()) setAddress(walletAddress); })}>{busy && !address ? <><span className="spinner"/> Connecting…</> : address ? "Reconnect Freighter" : "Connect Freighter"}</button>
                  <div className="card-separator"/>
                  <div className="prepare-row"><div><b>Prepare payment</b><small>Creates an unsigned transaction for your connected wallet.</small></div><button className="button button-primary" disabled={busy || blocked || !address || !!record} onClick={() => run(prepare)}>Prepare 1 XLM payment</button></div>
                </div>
              </section>

              <section className="action-card" aria-labelledby="sign-title">
                <div className="card-step">02</div><div className="card-body"><div className="card-heading"><div><h3 id="sign-title">Review and sign</h3><p>Check the prepared transaction and approve it in Freighter.</p></div><span className={`mini-state ${record?.signedXdr ? "is-done" : ""}`}>{record?.signedXdr ? "Signed" : "Step 2"}</span></div>
                  {record ? <div className="transaction-preview"><div><span>AMOUNT</span><b>1 XLM</b></div><div><span>NETWORK</span><b>Stellar Testnet</b></div><div><span>PREPARATION EXPIRES</span><b>{new Date(record.prepared.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b></div></div> : <div className="empty-inline"><span className="empty-icon">⌁</span><div><b>Nothing to review yet</b><small>Connect your wallet and prepare the payment first.</small></div></div>}
                  <button className="button button-primary button-full" disabled={busy || !record || !!record.signedXdr || terminal(record) || blocked} onClick={() => run(sign)}>{busy && record && !record.signedXdr ? <><span className="spinner"/> Waiting for wallet…</> : "Sign original transaction"}</button>
                  <button className="button button-secondary button-full" disabled={busy || !record?.signedXdr || (!!record && terminal(record)) || blocked} onClick={() => run(submit)}>{busy && record?.signedXdr && !record.attempted ? <><span className="spinner"/> Submitting…</> : record?.attempted ? "Retry exact saved envelope" : "Submit saved envelope"}</button>
                </div>
              </section>
            </div>
          </section>

          <section className="recovery-card" id="recovery" aria-labelledby="recovery-title">
            <div className="recovery-heading"><div className="recovery-icon">↻</div><div><div className="eyebrow">PAYMENT ACTIVITY</div><h2 id="recovery-title">Recovery & transaction status</h2><p>Reload-safe details for this browser and deployment.</p></div></div>
            {record ? <div className="recovery-content"><div className="recovery-details"><div className="recovery-detail"><span>Original transaction</span><code title={record.prepared.txHash}>{record.prepared.txHash}</code></div><div className="recovery-detail"><span>Preparation expires</span><b>{new Date(record.prepared.expiresAt).toLocaleString()}</b></div><div className="recovery-detail"><span>Current status</span><b className={`status-text status-${displayStatus.toLowerCase()}`}>{displayStatus}</b></div></div><div className="recovery-warning"><b>Keep the original record</b><p>A pending, unknown, rejected, missing or expired result does not make a replacement payment safe. Recovery checks the original transaction only.</p></div><div className="recovery-actions"><button className="button button-secondary" disabled={busy || blocked} onClick={() => run(status)}>{busy && !confirming ? <><span className="spinner"/> Checking…</> : "Check original transaction"}</button><button className="button button-danger" disabled={busy || !terminal(record) || blocked} onClick={() => run(clear)}>Acknowledge final result and clear</button></div></div> : <div className="empty-state"><div className="empty-state-icon">✓</div><div><h3>No payment in progress</h3><p>Your prepared payment and signed envelope will appear here and remain available after a reload.</p></div></div>}
          </section>

          <div className="status-panel" role="status" aria-live="polite" aria-atomic="true">{confirming && <span className="spinner"/>}{confirming ? message : busy ? message || "Working on your payment…" : message || "Your payment evidence stays in this browser until the original transaction is resolved."}{confirming && <button className="text-button" onClick={() => { active.current?.abort(); setMessage(CONFIRMATION_UNRESOLVED); }}>Stop checking</button>}</div>
          <aside className="security-note"><span className="security-icon">i</span><p><b>Testnet demonstration.</b> Transaction confirmation does not verify recipient payouts or fulfil an order. Never share recovery records or wallet secrets. This example has no customer authentication or durable order storage.</p></aside>
          <footer className="page-footer"><span>Hati <b>·</b> Testnet payment example</span><span>Freighter signs in your browser</span></footer>
        </div>
      </div>
    </main>
  );
}
