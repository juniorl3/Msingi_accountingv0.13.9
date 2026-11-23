import { useState } from "react";
import { computeDiscounts } from "./discountCalc";
import type { DiscountSpec } from "./discountCalc";
import NumPad from "./NumPad";
import { Modal } from "./ui";

export type DiscountState = { lineDisc: Record<number, DiscountSpec>; saleDisc: DiscountSpec | null; reason: string };
export const NO_DISCOUNT: DiscountState = { lineDisc: {}, saleDisc: null, reason: "" };
const REASONS = ["Loyal customer", "Damaged item", "Promotion", "Manager decision"];

/** Per-line and whole-sale discounts, as a percentage or a TZS amount. The caller checks permission and the user's limit. */
export default function DiscountDialog({ lines, money, current, touch, onApply, onCancel }: { lines: Array<{ id: number; name: string; amount: number }>; money: (n: number) => string; current: DiscountState; touch: boolean; onApply: (d: DiscountState) => void; onCancel: () => void }) {
  const [lineDisc, setLineDisc] = useState(current.lineDisc), [saleDisc, setSaleDisc] = useState(current.saleDisc), [reason, setReason] = useState(current.reason);
  const [scope, setScope] = useState("sale"), [type, setType] = useState<"pct" | "tzs">("pct"), [value, setValue] = useState(""), [pad, setPad] = useState(false);
  const res = computeDiscounts(lines.map(l => l.amount), lines.map(l => lineDisc[l.id]), saleDisc);
  const any = saleDisc !== null || Object.keys(lineDisc).length > 0;
  const nameOf = (id: number) => lines.find(l => l.id === id)?.name ?? "item";
  function add() {
    const spec = { type, value: value.trim() };
    if (scope === "sale") setSaleDisc(spec); else setLineDisc({ ...lineDisc, [Number(scope)]: spec });
    setValue("");
  }
  const fmt = (s: DiscountSpec) => (s.type === "pct" ? `${s.value}%` : money(Number(s.value.replace(/,/g, ""))));
  return <Modal eyebrow="DISCOUNT" title="Give a discount" onClose={onCancel}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <label>Apply to<select value={scope} onChange={e => setScope(e.target.value)}><option value="sale">Whole sale</option>{lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <div><small style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Type</small><div style={{ display: "flex", gap: 6 }}>
        <button type="button" className={type === "pct" ? "primary" : "secondary"} onClick={() => setType("pct")}>%</button><button type="button" className={type === "tzs" ? "primary" : "secondary"} onClick={() => setType("tzs")}>TZS</button></div></div></div>
    <div style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 8 }}>
      <label style={{ flex: 1 }}>{type === "pct" ? "Percentage off" : "Amount off (TZS)"}<input inputMode="decimal" readOnly={touch} value={value} onClick={touch ? () => setPad(true) : undefined} onChange={e => setValue(e.target.value)} placeholder={touch ? "Tap to enter" : type === "pct" ? "e.g. 10" : "e.g. 2000"} /></label>
      <button type="button" className="primary" disabled={!value.trim()} onClick={add}>Add</button></div>
    {any && <ul style={{ listStyle: "none", padding: 0, margin: "10px 0", fontSize: 13 }}>
      {saleDisc && <li style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>Whole sale: <b>{fmt(saleDisc)}</b></span><button type="button" className="delete" aria-label="Remove sale discount" onClick={() => setSaleDisc(null)}>×</button></li>}
      {Object.entries(lineDisc).map(([id, s]) => <li key={id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>{nameOf(Number(id))}: <b>{fmt(s)}</b></span><button type="button" className="delete" aria-label={`Remove discount on ${nameOf(Number(id))}`} onClick={() => { const n = { ...lineDisc }; delete n[Number(id)]; setLineDisc(n); }}>×</button></li>)}</ul>}
    {any && (res.error ? <p className="red-text" role="alert">{res.error}</p> : <p style={{ fontSize: 13, margin: "6px 0" }}>Total discount <b>{money(res.total)}</b> ({res.pct}% of {money(res.base)})</p>)}
    {any && <><label>Reason (required)<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this discount given?" /></label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>{REASONS.map(r => <button key={r} type="button" className="secondary" onClick={() => setReason(r)}>{r}</button>)}</div></>}
    <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
      <button type="button" className="primary" disabled={any && (!!res.error || !reason.trim())} onClick={() => onApply(any ? { lineDisc, saleDisc, reason: reason.trim() } : NO_DISCOUNT)}>{any ? "Apply discount" : "No discount"}</button>
      {any && <button type="button" className="secondary" onClick={() => { setLineDisc({}); setSaleDisc(null); setReason(""); }}>Remove all</button>}
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button></div>
    {pad && <NumPad title={type === "pct" ? "Percentage off" : "Amount off (TZS)"} kind={type === "pct" ? "percent" : "price"} initial={value} onCancel={() => setPad(false)} onApply={v => { setValue(v); setPad(false); }} />}
  </Modal>;
}
