"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { TESTNET } from "@/lib/types";
import type { Prepared, Result } from "@/lib/types";
import { BrowserRequestError } from "@/lib/browser-api";
import {
  assertStatus,
  confirmOriginal,
  CONFIRMATION_PENDING,
  CONFIRMATION_UNRESOLVED,
} from "@/lib/confirmation";
import { connectWallet, signPrepared } from "@/lib/wallet";
import { assertOriginal, envelopeHash } from "@/lib/transaction";
import { fromStroops, toStroops } from "@/lib/amount";
import { formatPeso, previewPayouts } from "@/lib/preview";
import {
  readRecovery,
  saveRecovery,
  terminal,
  assertNoConflictingRecovery,
} from "@/lib/recovery";
import type { Recovery } from "@/lib/recovery";
import {
  getFx,
  getTemplates,
  getTransfer,
  prepareTransfer,
  submitTransfer,
  type Fx,
  type StatusResponse,
  type TemplateDto,
} from "@/lib/padala-api";

type Operation = {
  signal: AbortSignal;
  valid: () => boolean;
  save: (record: Recovery) => void;
  message: (message: string) => void;
};

// One PadalaSplit scope per origin; the per-template deployment is chosen on
// the server from templateId and never reaches the browser.
const SCOPE = "padalasplit";
const key = `paiflow-sdk-payment-v2:${SCOPE}`;
const sourceLabel = { transaction: "Confirmed on chain", event: "Reported by PaiFlow", preview: "Preview amount" } as const;

const formatUsdc = (stroops: string) => {
  const [whole = "0", fraction = ""] = fromStroops(stroops).split(".");
  return `${new Intl.NumberFormat("en-PH").format(BigInt(whole))}${fraction ? `.${fraction}` : ""}`;
};
const formatPhp = (stroops: string, rate: string) => {
  const [whole = "0", cents = "00"] = formatPeso(stroops, rate).split(".");
  return `₱${new Intl.NumberFormat("en-PH").format(BigInt(whole))}.${cents}`;
};
const sanitizeAmount = (value: string) => {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [whole = "", ...parts] = cleaned.split(".");
  return parts.length ? `${whole || "0"}.${parts.join("").slice(0, 7)}` : whole;
};
// The status route also reports PREPARED/EXPIRED/SUBMITTED; for confirmation
// these are unresolved (UNKNOWN), never permission to replace the payment.
const confirmationStatus = (status: string) =>
  ["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"].includes(status) ? status : "UNKNOWN";
// A transaction that was never signed, or signed but never submitted from
// this browser and now past its time bounds, can never execute.
const discardable = (r: Recovery) =>
  !r.signedXdr || (!r.attempted && Date.now() > Date.parse(r.prepared.expiresAt));

export function StarterApp() {
  const [address, setAddress] = useState("");
  const [record, setRecord] = useState<Recovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState(true);
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [templatesError, setTemplatesError] = useState("");
  const [presetId, setPresetId] = useState("");
  const [amount, setAmount] = useState("100");
  const [fx, setFx] = useState<Fx>({ rate: "56.00", source: "fallback" });
  const [mock, setMock] = useState(false);
  const [transfer, setTransfer] = useState<StatusResponse | null>(null);
  const loadedKey = useRef<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const resumed = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    getTemplates(controller.signal)
      .then((body) => {
        setTemplates(body.templates);
        setPresetId((current) => current || body.templates[0]?.id || "");
        if (body.mock) setMock(true);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setTemplates([]);
        setTemplatesError(error instanceof Error ? error.message : "Plans could not be loaded.");
      });
    getFx(controller.signal).then(setFx).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      assertNoConflictingRecovery(localStorage, key);
      const raw = localStorage.getItem(key);
      if (raw) setRecord(readRecovery(SCOPE, raw));
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
  }, []);

  async function run(
    action: (current: Recovery | null, op: Operation) => Promise<void>,
  ) {
    if (active.current || blocked || loadedKey.current !== key) return;
    const controller = new AbortController();
    active.current = controller;
    const valid = () => !controller.signal.aborted && loadedKey.current === key;
    const op: Operation = {
      signal: controller.signal,
      valid,
      save: (r) => {
        if (!valid())
          throw new DOMException("Operation cancelled", "AbortError");
        if (r.scope !== SCOPE)
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
              "Another tab is handling this payment. Return to that tab.",
            );
          assertNoConflictingRecovery(localStorage, key);
          const raw = localStorage.getItem(key);
          const current = raw ? readRecovery(SCOPE, raw) : null;
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
        if (loadedKey.current === key) {
          setBusy(false);
          setConfirming(false);
        }
      }
    }
  }

  function statusMessage(result: Result) {
    if (result.status === "SUCCESS")
      return "Transfer confirmed. Each payout below shows where its amount was confirmed from.";
    if (result.status === "FAILED")
      return "Transfer failed on the network. Its evidence is retained until acknowledged.";
    return `Transfer status: ${result.status}. UNKNOWN, rejection, expiry or missing history never prove a replacement is safe.`;
  }
  async function lookup(current: Recovery, signal: AbortSignal, timeoutMs?: number): Promise<Result> {
    const body = await getTransfer(current.transfer!.id, signal, timeoutMs);
    if (body.mock) setMock(true);
    setTransfer(body);
    return {
      txHash: body.txHash ?? current.prepared.txHash,
      network: "testnet",
      status: confirmationStatus(body.status),
    };
  }
  async function checkOriginal(current: Recovery, op: Operation) {
    if (!op.valid() || !current.transfer) return;
    resumed.current.add(`${key}:${current.prepared.txHash}`);
    op.message(CONFIRMATION_PENDING);
    setConfirming(true);
    const outcome = await confirmOriginal({
      txHash: current.prepared.txHash,
      signal: op.signal,
      lookup: (signal, remainingMs) => lookup(current, signal, remainingMs),
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
      !record?.transfer ||
      !record.attempted ||
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
  }, [blocked, busy, record]);
  // A finished transfer reloaded from storage: read its payouts once.
  useEffect(() => {
    const id = record?.transfer?.id;
    if (!id || !record?.attempted || !terminal(record) || transfer?.transferId === id) return;
    const controller = new AbortController();
    getTransfer(id, controller.signal).then((body) => { setTransfer(body); if (body.mock) setMock(true); }).catch(() => {});
    return () => controller.abort();
  }, [record, transfer?.transferId]);

  let amountStroops = "";
  try { amountStroops = toStroops(amount); } catch { amountStroops = ""; }
  const plan = templates?.find((t) => t.id === (record?.transfer?.templateId ?? presetId)) ?? null;
  const total = record?.transfer?.amount ?? amountStroops;
  const split = useMemo(() => {
    if (!plan) return [];
    const shares = previewPayouts(total || "0", plan.recipients);
    return plan.recipients.map((recipient, index) => ({ ...recipient, amount: shares[index]!.amount }));
  }, [plan, total]);
  const rateLabel = fx.source === "live" ? "Live estimate" : "Sample rate";

  async function prepare(current: Recovery | null, op: Operation) {
    if (current)
      throw new Error("Resolve the existing payment before preparing another.");
    if (!address) throw new Error("Connect Freighter first.");
    if (!plan) throw new Error("Choose a family plan first.");
    if (!amountStroops) throw new Error("Enter a valid USDC amount with up to 7 decimal places.");
    const response = await prepareTransfer(
      { templateId: plan.id, walletAddress: address, amount: amountStroops },
      op.signal,
    );
    if (response.mock) setMock(true);
    if (response.networkPassphrase !== TESTNET)
      throw new Error("Only Testnet payments are allowed.");
    const prepared: Prepared = {
      xdr: response.unsignedXdr,
      network: "testnet",
      networkPassphrase: response.networkPassphrase,
      expiresAt: response.expiresAt,
      txHash: envelopeHash(response.unsignedXdr),
    };
    setTransfer(null);
    op.save({
      version: 2,
      scope: SCOPE,
      address,
      prepared,
      transfer: { id: response.transferId, templateId: plan.id, amount: amountStroops },
    });
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
    if (!current?.signedXdr || !current.transfer || terminal(current)) return;
    assertOriginal(
      current.prepared.xdr,
      current.signedXdr,
      current.prepared.txHash,
    );
    const next = { ...current, attempted: true };
    resumed.current.add(`${key}:${current.prepared.txHash}`);
    op.save(next);
    let result;
    try {
      result = await submitTransfer(
        { transferId: current.transfer.id, signedXdr: current.signedXdr },
        op.signal,
      );
    } catch (error) {
      if (!op.valid()) return;
      // Explicit refusals are shown; anything else may have been sent, so
      // only the original transfer is checked.
      if (error instanceof BrowserRequestError && error.status < 500)
        throw error;
      await checkOriginal(next, op);
      return;
    }
    if (!op.valid()) return;
    if (result.mock) setMock(true);
    if (result.txHash !== current.prepared.txHash)
      throw new Error("Response hash mismatch. Keep the original record.");
    // Confirmation uses the original status route even when submission reports success.
    await checkOriginal(next, op);
  }
  async function status(current: Recovery | null, op: Operation) {
    if (!current?.transfer) return;
    const result = await lookup(current, op.signal);
    if (!op.valid()) return;
    assertStatus(result, current.prepared.txHash);
    op.save({ ...current, status: result.status });
    op.message(statusMessage(result));
  }
  async function clear(current: Recovery | null, op: Operation) {
    if (!current || !(terminal(current) || discardable(current)))
      throw new Error(
        "Check final SUCCESS or FAILED before clearing this record.",
      );
    if (!op.valid()) return;
    localStorage.removeItem(key);
    if (localStorage.getItem(key) !== null)
      throw new Error("Could not clear stored evidence.");
    setRecord(null);
    setTransfer(null);
    op.message(
      terminal(current)
        ? "Final result acknowledged. You can send another transfer."
        : "Unsent payment discarded. It was never submitted, so it cannot execute.",
    );
  }
  const displayStatus = record?.status ?? (record?.attempted ? "PENDING" : record?.signedXdr ? "SIGNED" : record ? "PREPARED" : "READY");
  const isMock = mock || Boolean(transfer?.mock);
  const locked = Boolean(record) || busy;
  const canClear = record ? terminal(record) || discardable(record) : false;
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
          <div className="topbar-meta"><span className="network-badge"><i/> Stellar Testnet</span><span className="topbar-divider"/><span className="demo-label">{isMock ? "Mock PaiFlow" : "PaiFlow"}</span></div>
        </header>
        <div className="content-wrap">
          <section className="hero" aria-labelledby="page-title">
            <div><div className="eyebrow">A SIMPLE WAY TO SEND</div><h1 id="page-title">Send support with Hati<span>.</span></h1><p>Choose a family plan, send USDC on Stellar Testnet, approve it in Freighter, and track the original transfer until your family’s payouts land.</p></div>
            <div className="hero-mark" aria-hidden="true"><span>H</span><i>✓</i></div>
          </section>

          {isMock && <div className="notice notice-warning" role="status"><span className="notice-icon">!</span><div><b>Mock PaiFlow</b><p>Payments are simulated by the server. No real Stellar transaction is made and hashes have no explorer record.</p></div></div>}
          {templates !== null && templates.length === 0 && !record && <div className="notice notice-warning" role="status"><span className="notice-icon">!</span><div><b>No plans are ready yet</b><p>{templatesError || "A plan appears once its PaiFlow deployment is configured in templates.json."}</p></div></div>}
          {templates !== null && templates.length > 0 && <>
            <div className="summary-grid">
              <section className="summary-card"><div className="summary-icon wallet-icon">◈</div><div className="summary-field"><label className="summary-label" htmlFor="amount">AMOUNT</label><input id="amount" className="amount-field" inputMode="decimal" aria-describedby="amount-help" aria-invalid={!amountStroops && !record} disabled={locked} value={record ? fromStroops(record.transfer?.amount ?? "0") : amount} onChange={(e) => setAmount(sanitizeAmount(e.target.value))}/><small id="amount-help">{total ? `≈ ${formatPhp(total, fx.rate)} PHP · ${rateLabel}` : "Enter USDC with up to 7 decimal places"}</small></div><span className="fixed-tag">USDC</span></section>
              <section className="summary-card deployment-card"><div className="summary-icon deployment-icon">⌘</div><div className="summary-field"><label className="summary-label" htmlFor="plan">FAMILY PLAN</label><select id="plan" className="plan-select" disabled={locked} value={plan?.id ?? ""} onChange={(e) => setPresetId(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><small>{plan?.description}</small></div></section>
            </div>
            {plan && <section className="split-card" aria-label="How this plan shares the amount"><div className="summary-label">HOW {plan.name.toUpperCase()} SHARES {total ? `${formatUsdc(total)} USDC` : "YOUR AMOUNT"}</div>{split.map((person) => <div className="split-row" key={person.id}><div><b>{person.name}</b><small>{person.relationship} · {person.payoutLabel}</small></div><span className="split-pct">{(person.bps / 100).toFixed(person.bps % 100 ? 1 : 0)}%</span><div className="split-amount"><b>{formatUsdc(person.amount)} USDC</b><small>≈ {formatPhp(person.amount, fx.rate)}</small></div></div>)}<p className="split-note">Preview amounts. The plan’s PaiFlow flow makes the final payouts; peso values are display-only estimates.</p></section>}
          </>}

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
                  <button className="button button-secondary button-full" disabled={busy || blocked} onClick={() => run(async (_current, op) => { const walletAddress = await connectWallet(); if (op.valid()) setAddress(walletAddress); })}>{busy && !address ? <><span className="spinner"/> Connecting…</> : address ? "Reconnect Freighter" : "Connect Freighter"}</button>
                  <div className="card-separator"/>
                  <div className="prepare-row"><div><b>Prepare transfer</b><small>Creates an unsigned transaction for your connected wallet.</small></div><button className="button button-primary" disabled={busy || blocked || !address || !!record || !plan || !amountStroops} onClick={() => run(prepare)}>{amountStroops ? `Prepare ${formatUsdc(amountStroops)} USDC` : "Prepare transfer"}</button></div>
                </div>
              </section>

              <section className="action-card" aria-labelledby="sign-title">
                <div className="card-step">02</div><div className="card-body"><div className="card-heading"><div><h3 id="sign-title">Review and sign</h3><p>Check the prepared transaction and approve it in Freighter.</p></div><span className={`mini-state ${record?.signedXdr ? "is-done" : ""}`}>{record?.signedXdr ? "Signed" : "Step 2"}</span></div>
                  {record ? <div className="transaction-preview"><div><span>AMOUNT</span><b>{record.transfer ? `${formatUsdc(record.transfer.amount)} USDC` : "—"}</b></div><div><span>PLAN</span><b>{plan?.name ?? record.transfer?.templateId ?? "—"}</b></div><div><span>NETWORK</span><b>Stellar Testnet</b></div><div><span>PREPARATION EXPIRES</span><b>{new Date(record.prepared.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b></div></div> : <div className="empty-inline"><span className="empty-icon">⌁</span><div><b>Nothing to review yet</b><small>Connect your wallet and prepare the transfer first.</small></div></div>}
                  <button className="button button-primary button-full" disabled={busy || !record || !!record.signedXdr || terminal(record) || blocked} onClick={() => run(sign)}>{busy && record && !record.signedXdr ? <><span className="spinner"/> Waiting for wallet…</> : "Sign original transaction"}</button>
                  <button className="button button-secondary button-full" disabled={busy || !record?.signedXdr || (!!record && terminal(record)) || blocked} onClick={() => run(submit)}>{busy && record?.signedXdr && !record.attempted ? <><span className="spinner"/> Submitting…</> : record?.attempted ? "Retry exact saved envelope" : "Submit saved envelope"}</button>
                </div>
              </section>
            </div>
          </section>

          <section className="recovery-card" id="recovery" aria-labelledby="recovery-title">
            <div className="recovery-heading"><div className="recovery-icon">↻</div><div><div className="eyebrow">PAYMENT ACTIVITY</div><h2 id="recovery-title">Recovery & transaction status</h2><p>Reload-safe details for this browser.</p></div></div>
            {record ? <div className="recovery-content"><div className="recovery-details"><div className="recovery-detail"><span>Original transaction</span><code title={record.prepared.txHash}>{record.prepared.txHash}</code></div><div className="recovery-detail"><span>Transfer reference</span><code title={record.transfer?.id}>{record.transfer?.id ?? "—"}</code></div><div className="recovery-detail"><span>Current status</span><b className={`status-text status-${displayStatus.toLowerCase()}`}>{displayStatus}</b></div></div>
              {transfer && transfer.transferId === record.transfer?.id && (transfer.payouts.length > 0 || transfer.txHash) && <div className="payout-block">
                {transfer.payouts.length > 0 && <><div className="summary-label">PAYOUTS</div>{transfer.payouts.map((payout) => { const name = payout.name ?? plan?.recipients.find((r) => r.id === payout.recipientId)?.name ?? payout.recipientId; return <div className="split-row" key={payout.recipientId}><div><b>{name}</b><small>{sourceLabel[payout.amountSource]}</small></div><span className="split-pct">{payout.chainStatus ?? ""}</span><div className="split-amount"><b>{formatUsdc(payout.amount)} USDC</b><small>≈ {formatPhp(payout.amount, fx.rate)}</small></div></div>; })}</>}
                {transfer.status === "PENDING" && transfer.payouts.length === 0 && <p className="split-note">Payout details can lag behind the transaction. A missing payout detail is not a failed payment.</p>}
                <p className="split-note">{transfer.explorerUrl ? <a className="text-link" href={transfer.explorerUrl} target="_blank" rel="noreferrer">View on Stellar Expert <span aria-hidden="true">↗</span></a> : transfer.mock ? "Mock transaction · no explorer record" : null}</p>
              </div>}
              <div className="recovery-warning"><b>Keep the original record</b><p>A pending, unknown, rejected, missing or expired result does not make a replacement payment safe. Recovery checks the original transaction only.</p></div><div className="recovery-actions"><button className="button button-secondary" disabled={busy || blocked || !record.attempted} onClick={() => run(status)}>{busy && !confirming ? <><span className="spinner"/> Checking…</> : "Check original transaction"}</button><button className="button button-danger" disabled={busy || !canClear || blocked} onClick={() => run(clear)}>{record && !terminal(record) && canClear ? "Discard unsent payment" : "Acknowledge final result and clear"}</button></div></div> : <div className="empty-state"><div className="empty-state-icon">✓</div><div><h3>No payment in progress</h3><p>Your prepared payment and signed envelope will appear here and remain available after a reload.</p></div></div>}
          </section>

          <div className="status-panel" role="status" aria-live="polite" aria-atomic="true">{confirming && <span className="spinner"/>}{confirming ? message : busy ? message || "Working on your payment…" : message || "Your payment evidence stays in this browser until the original transaction is resolved."}{confirming && <button className="text-button" onClick={() => { active.current?.abort(); setMessage(CONFIRMATION_UNRESOLVED); }}>Stop checking</button>}</div>
          <aside className="security-note"><span className="security-icon">i</span><p><b>Testnet demonstration.</b> A confirmed transaction is not by itself proof that every recipient was paid; check each payout’s source label. Never share recovery records or wallet secrets. This demo has no customer authentication.</p></aside>
          <footer className="page-footer"><span>Hati <b>·</b> Family support on PaiFlow</span><span>Freighter signs in your browser</span></footer>
        </div>
      </div>
    </main>
  );
}
