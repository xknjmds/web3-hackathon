"use client";

import { useMemo, useState } from "react";
import { fromStroops, toStroops } from "@/lib/amount";

type Recipient = { id: string; name: string; relation: string; method: string; bps: number; color: string };
type Preset = { id: string; name: string; description: string; recipients: Recipient[] };

const family: Recipient[] = [
  { id: "parents", name: "Nanay & Tatay", relation: "Parents", method: "GCash", bps: 5000, color: "coral" },
  { id: "sister", name: "Mika", relation: "Sister", method: "Maya", bps: 3000, color: "lilac" },
  { id: "niece", name: "Sofia", relation: "Niece", method: "GCash", bps: 1500, color: "gold" },
  { id: "godparent", name: "Tita Liza", relation: "Godparent", method: "BPI", bps: 500, color: "mint" },
];
const withShares = (shares: number[]) => family.map((person, index) => ({ ...person, bps: shares[index] ?? person.bps }));
const presets: Preset[] = [
  { id: "monthly", name: "Monthly allotment", description: "Your regular family support, shared automatically.", recipients: family },
  { id: "school", name: "School opening", description: "A little extra support for the new school year.", recipients: withShares([2000, 6000, 1000, 1000]) },
  { id: "equal", name: "Equal share", description: "A thoughtful, equal amount for everyone.", recipients: withShares([2500, 2500, 2500, 2500]) },
];
const pesoRate = 56;
const formatAmount = (decimal: string) => {
  const [whole = "0", fraction = ""] = decimal.split(".");
  const grouped = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(BigInt(whole));
  return `${grouped}${fraction ? `.${fraction}` : ""}`;
};
const formatPhpCents = (cents: bigint) => `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(cents / 100n)}.${(cents % 100n).toString().padStart(2, "0")}`;
const sanitizeAmount = (value: string) => {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [whole = "", ...parts] = cleaned.split(".");
  const fraction = parts.join("").slice(0, 7);
  return parts.length ? `${whole || "0"}.${fraction}` : whole;
};

export function StarterApp(_props?: { config?: unknown }) {
  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState<"send" | "review" | "progress" | "receipt" | "recover">("send");
  const [setupStep, setSetupStep] = useState(0);
  const [presetId, setPresetId] = useState("monthly");
  const [amount, setAmount] = useState("100");
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("PENDING");
  const preset = presets.find((item) => item.id === presetId)!;
  let amountStroops = 0n;
  try { amountStroops = BigInt(toStroops(amount)); } catch { amountStroops = 0n; }
  const totalDisplay = formatAmount(amountStroops ? fromStroops(amountStroops.toString()) : "0");
  const phpCents = (amountStroops * 56n + 50_000n) / 100_000n;
  const payouts = useMemo(() => {
    let allocated = 0n;
    return preset.recipients.map((recipient, index) => {
      const shareStroops = index === preset.recipients.length - 1
        ? amountStroops - allocated
        : amountStroops * BigInt(recipient.bps) / 10_000n;
      allocated += shareStroops;
      return { ...recipient, share: formatAmount(fromStroops(shareStroops.toString())) };
    });
  }, [preset, amountStroops]);

  function beginDemo() {
    setSaved(true);
    setStatus("PENDING");
    setScreen("progress");
    window.setTimeout(() => setScreen((current) => current === "progress" ? "receipt" : current), 1300);
    window.setTimeout(() => setStatus("SUCCESS"), 1300);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); setSetupStep(0); setScreen("send"); }}><span className="brand-mark">H</span><span>Hati<span className="brand-dot">.</span></span></a>
        <div className="side-label">YOUR SPACE</div>
        <button className={`nav-item ${screen !== "recover" ? "active" : ""}`} onClick={() => { setSetupStep(0); setScreen("send"); }}><span>↗</span> Send money</button>
        <button className={`nav-item ${screen === "recover" ? "active" : ""}`} onClick={() => { if (!saved) setSetupStep(0); setScreen(saved ? "recover" : "send"); }}><span>◷</span> Activity</button>
        <div className="side-bottom"><div className="help-icon">?</div><div><b>Here for your family</b><small>Simple, thoughtful support.</small></div></div>
      </aside>

      <div className="main-column">
        <header className="topbar"><div className="breadcrumb">Home <span>/</span> Send money</div><div className="top-actions"><span className="network-pill"><i /> TESTNET</span><button className="wallet-button" onClick={() => setConnected(!connected)}><span className="wallet-glyph">◈</span>{connected ? "G...7K2M" : "Connect wallet"}</button></div></header>
        <div className="content-wrap">
          <div className="demo-banner"><span className="sparkle">✳</span><span><b>Interactive sample</b><small>Demo only · No real wallet or payment is connected</small></span><button aria-label="Dismiss sample notice">×</button></div>
          {screen === "send" && <>
            <div className="page-heading setup-heading"><div><div className="eyebrow">SET UP YOUR TRANSFER</div><h1>{setupStep === 0 ? <>Choose your plan<span className="heading-period">.</span></> : setupStep === 1 ? <>How much to send?<span className="heading-period">.</span></> : <>Your family split<span className="heading-period">.</span></>}</h1><p>{setupStep === 0 ? "Choose a preset for how your support is shared." : setupStep === 1 ? "Set the amount you’d like your family to receive." : "Review how your selected plan shares the amount."}</p></div></div>
            <div className="stepper"><div className={`step ${connected ? "done" : ""}`}><span>{connected ? "✓" : "1"}</span><b>Method</b></div><i/><div className="step current"><span>2</span><b>Set up</b></div><i/><div className="step"><span>3</span><b>Review</b></div><i/><div className="step"><span>4</span><b>Confirm</b></div></div>
            <div className="setup-progress" aria-label={`Setup step ${setupStep + 1} of 3`}>{["Choose plan", "Set amount", "Family split"].map((label, index) => <button key={label} className={`setup-progress-item ${setupStep === index ? "current" : setupStep > index ? "done" : ""}`} onClick={() => index <= setupStep && setSetupStep(index)} disabled={index > setupStep}><span>{setupStep > index ? "✓" : index + 1}</span>{label}</button>)}</div>
            <div className="setup-card-wrap">
              {setupStep === 0 && <section className="form-card setup-card"><p className="setup-card-intro">Choose the preset that fits this transfer.</p><div className="preset-list">{presets.map((item, index) => <button key={item.id} className={`preset-option ${presetId === item.id ? "selected" : ""}`} onClick={() => setPresetId(item.id)}><span className={`preset-icon icon-${index}`}>{["↗", "✳", "♡"][index]}</span><span className="preset-copy"><b>{item.name}</b><small>{item.description}</small></span><span className={`radio ${presetId === item.id ? "checked" : ""}`}>{presetId === item.id && <i/>}</span></button>)}</div></section>}
              {setupStep === 1 && <section className="form-card setup-card amount-card"><p className="setup-card-intro">Enter any amount in USDC, or choose a quick amount.</p><label className="amount-input-label" htmlFor="amount">TOTAL AMOUNT</label><div className="amount-input-wrap"><span>$</span><input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(sanitizeAmount(e.target.value))}/><b>USDC</b></div><div className="quick-amounts">{[50, 100, 200, 500].map((value) => <button key={value} className={amount === String(value) ? "chosen" : ""} onClick={() => setAmount(String(value))}>${value}</button>)}</div><div className="conversion-note"><span>≈</span><div><b>₱{formatPhpCents(phpCents)} PHP</b><small>Estimated · Sample rate: 1 USDC = ₱{pesoRate}.00</small></div><span className="info-dot">i</span></div></section>}
              {setupStep === 2 && <section className="form-card setup-card split-card"><div className="split-meta-row"><span className="setup-card-intro">This plan shares your amount this way.</span><span className="fixed-pill">FIXED PLAN</span></div><div className="split-total split-total-top"><span>Total you’re sending</span><b>${totalDisplay} <small>USDC</small></b></div><div className="recipient-list">{payouts.map((person) => <div className="recipient-row" key={person.id}><span className={`avatar avatar-${person.color}`}>{person.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span><span className="recipient-name"><b>{person.name}</b><small>{person.relation} · {person.method}</small></span><span className="recipient-share"><b>${person.share}</b><small>{(person.bps / 100).toFixed(person.bps % 100 ? 1 : 0)}%</small></span><span className="share-track"><i style={{ width: `${person.bps / 100}%` }}/></span></div>)}</div></section>}
            </div>
            <div className="form-footer setup-footer"><span><span className="lock-mark">♧</span> All three steps are part of set up. Review before continuing.</span><div className="setup-actions">{setupStep > 0 && <button className="secondary-button" onClick={() => setSetupStep(setupStep - 1)}>← Back</button>}{setupStep < 2 ? <button className="primary-button" onClick={() => setSetupStep(setupStep + 1)}>Continue <span>→</span></button> : <button className="primary-button" onClick={() => setScreen("review")} disabled={!connected || amountStroops <= 0n}>Review transfer <span>→</span></button>}</div></div>
            {!connected && <div className="connect-hint">Connect a wallet to continue to review <span>↑</span></div>}
          </>}

          {screen === "review" && <div className="narrow-page"><button className="back-link" onClick={() => { setSetupStep(0); setScreen("send"); }}>← Back to details</button><div className="page-heading compact-heading"><div><div className="eyebrow">TAKE A MOMENT</div><h1>Review your<br/> transfer<span className="heading-period">.</span></h1><p>Make sure everything looks right before continuing.</p></div></div><div className="stepper"><div className="step done"><span>✓</span><b>Method</b></div><i/><div className="step done"><span>✓</span><b>Set up</b></div><i/><div className="step current"><span>3</span><b>Review</b></div><i/><div className="step"><span>4</span><b>Confirm</b></div></div><section className="review-card"><div className="review-title"><span className="preset-icon icon-0">↗</span><div><small>YOUR PLAN</small><h2>{preset.name}</h2></div><button onClick={() => { setSetupStep(0); setScreen("send"); }}>Edit</button></div><div className="review-total"><span>You’re sending</span><b>${totalDisplay} <small>USDC</small></b><small>≈ ₱{formatPhpCents(phpCents)} PHP <em>· Sample rate</em></small></div><div className="review-recipients"><div className="section-caption">SHARED WITH YOUR FAMILY</div>{payouts.map((person) => <div className="review-person" key={person.id}><span className={`avatar avatar-${person.color}`}>{person.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span><span><b>{person.name}</b><small>{person.method} · {person.bps / 100}%</small></span><strong>${person.share}</strong></div>)}</div><div className="review-footnote">This is a sample preview. Final payouts are determined by the selected payment plan.</div></section><button className="primary-button full-button" onClick={beginDemo}>Continue to wallet <span>→</span></button><p className="safe-note">You’ll review and approve the transaction in your wallet.</p></div>}

          {screen === "progress" && <div className="center-state"><div className="loader-orbit"><span>↗</span></div><div className="eyebrow">JUST A MOMENT</div><h1>Sending your<br/> love home<span className="heading-period">.</span></h1><p>Checking the original transfer. This sample will show a confirmation shortly.</p><div className="progress-steps"><div className="complete"><span>✓</span><b>Transfer prepared</b></div><div className="complete"><span>✓</span><b>Wallet approval simulated</b></div><div className="waiting"><span>•••</span><b>Checking transfer status</b></div></div><button className="quiet-button" onClick={() => setScreen("recover")}>View recovery details</button></div>}

          {screen === "receipt" && <div className="narrow-page receipt-page"><div className="success-emblem"><span>✓</span><i>✳</i></div><div className="eyebrow centered">A LITTLE CARE, DELIVERED</div><h1 className="centered-title">Support is on<br/> its way<span className="heading-period">.</span></h1><p className="centered-copy">Your sample transfer has been marked successful.</p><div className="mock-banner">DEMO RESULT <span>·</span> No real payment was made</div><section className="receipt-card"><div className="receipt-top"><span>TRANSFER TOTAL</span><span className="status-success"><i/> SUCCESS</span></div><div className="receipt-amount">${totalDisplay} <small>USDC</small></div><div className="receipt-meta">{preset.name} <span>·</span> Sample rate ≈ ₱{formatPhpCents(phpCents)}</div><div className="receipt-divider"/><div className="section-caption">PAYOUT BREAKDOWN</div>{payouts.map((person) => <div className="review-person payout-person" key={person.id}><span className={`avatar avatar-${person.color}`}>{person.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span><span><b>{person.name}</b><small>{person.method} · Preview amount</small></span><strong>${person.share}</strong></div>)}<div className="tx-link">◈ <span>Demo transaction · No explorer record</span></div></section><div className="receipt-actions"><button className="primary-button" onClick={() => { setSaved(true); setSetupStep(0); setScreen("send"); }}>Send another <span>↗</span></button><button className="secondary-button" onClick={() => setScreen("recover")}>View transfer details</button></div></div>}

          {screen === "recover" && <div className="narrow-page"><button className="back-link" onClick={() => setScreen(status === "SUCCESS" ? "receipt" : "send")}>← Back</button><div className="page-heading compact-heading"><div><div className="eyebrow">TRANSFER ACTIVITY</div><h1>Transfer<br/> details<span className="heading-period">.</span></h1><p>Your original transfer record is kept here for reference.</p></div></div><section className="review-card recovery-card"><div className="recovery-status"><span className="status-success"><i/> {status}</span><small>Sample transfer</small></div><div className="review-total"><span>{preset.name}</span><b>${totalDisplay} <small>USDC</small></b><small>≈ ₱{formatPhpCents(phpCents)} PHP · Sample estimate</small></div><div className="recovery-info"><div><span>Transfer reference</span><b>demo_7f3a...91c2</b></div><div><span>Wallet</span><b>{connected ? "G...7K2M" : "Demo wallet"}</b></div><div><span>Network</span><b>Stellar Testnet</b></div></div><div className="recovery-note"><b>Recovery safety</b><p>If a real transfer’s status is uncertain, check that original transfer. Don’t start a replacement while its outcome is unknown.</p></div></section><button className="secondary-button full-button" onClick={() => setScreen("receipt")}>View sample receipt</button></div>}
          <footer className="page-footer"><span>Made with care <b>♡</b></span><span>Sample experience <i/> Stellar Testnet</span></footer>
        </div>
      </div>
    </main>
  );
}
