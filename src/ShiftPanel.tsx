import { useEffect, useState } from "react";
import { Copy, Printer } from "lucide-react";
import { closeShift, openShift, shiftFigures } from "./shiftDb";
import type { Shift } from "./shiftDb";
import { cashVariance, expectedCash, shiftSlip, varianceText } from "./shiftCalc";
import type { ShiftFigures } from "./shiftCalc";
import type { AppUser } from "./permissions";
import { COLS } from "./receipt";
import { localDate } from "./parties";
import type { PaperWidth } from "./receipt";
import { printPlain } from "./printReceipt";
import NumPad from "./NumPad";
import { Modal, msg } from "./ui";

/** Opening cash keypad. Calls onOpened with the new shift. */
export function OpenShiftDialog({ user, onOpened, onCancel, onNotice }: { user: AppUser; onOpened: (s: Shift) => void; onCancel: () => void; onNotice: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <NumPad title="Opening cash" subtitle="Count the cash already in the drawer (0 if empty)" kind="money" busy={busy} applyLabel="Open shift" onCancel={onCancel}
    onApply={async v => { setBusy(true); try { const s = await openShift(user.id, v.trim() === "" ? 0 : Number(v)); onNotice("Shift opened."); onOpened(s); } catch (e) { onNotice(msg(e)); setBusy(false); } }} />;
}

/** Count the drawer, review the difference, close the shift and show the slip. */
export function CloseShiftFlow({ shift, user, money, paper, businessName, onClosed, onCancel, onNotice }: { shift: Shift; user: AppUser; money: (n: number) => string; paper: PaperWidth; businessName: string; onClosed: (slip: string) => void; onCancel: () => void; onNotice: (m: string) => void }) {
  const [counted, setCounted] = useState<number | null>(null), [fig, setFig] = useState<ShiftFigures | null>(null), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { shiftFigures(shift.id).then(setFig).catch(e => { onNotice(msg(e)); onCancel(); }); }, [shift.id]);
  if (counted === null || !fig) return <NumPad title="Cash counted" subtitle={`Count the drawer for ${shift.user_name}'s shift`} kind="money" onCancel={onCancel} onApply={v => setCounted(v.trim() === "" ? 0 : Number(v))} />;
  const expected = expectedCash(shift.opening_float, fig.cashSales, fig.cashRefunds), variance = cashVariance(counted, expected);
  async function go() {
    setBusy(true);
    try {
      await closeShift(shift.id, counted!, note, user);
      onClosed(shiftSlip({ business: businessName, cashier: shift.user_name, openedAt: shift.opened_at, closedAt: `${localDate()} ${new Date().toTimeString().slice(0, 5)}`, float: shift.opening_float, fig: fig!, counted, note }, COLS[paper]));
    } catch (e) { onNotice(msg(e)); setBusy(false); }
  }
  return <Modal eyebrow="CLOSE SHIFT" title={`Close ${shift.user_name}'s shift`} onClose={onCancel}>
    <div className="table-wrap"><table><tbody>
      <tr><td>Opening cash</td><td className="right">{money(shift.opening_float)}</td></tr><tr><td>+ Cash sales</td><td className="right">{money(fig.cashSales)}</td></tr><tr><td>− Cash refunds</td><td className="right">{money(fig.cashRefunds)}</td></tr>
      <tr><td><b>Expected in drawer</b></td><td className="right"><b>{money(expected)}</b></td></tr><tr><td>Counted</td><td className="right">{money(counted)}</td></tr>
      <tr><td><b>Result</b></td><td className="right" style={{ color: variance === 0 ? "#168a78" : "#d66c5e", fontWeight: 700 }}>{varianceText(variance)}</td></tr></tbody></table></div>
    <label>{variance === 0 ? "Note (optional)" : "Why is it different? (required)"}<input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. paid supplier from the drawer" /></label>
    <div style={{ display: "flex", gap: 10, marginTop: 14 }}><button className="primary" disabled={busy || (variance !== 0 && !note.trim())} onClick={go}>{busy ? "Closing…" : "Close shift"}</button><button className="secondary" onClick={() => setCounted(null)}>Recount</button><button className="secondary" onClick={onCancel}>Cancel</button></div>
  </Modal>;
}

/** The "My shift" page. */
export default function ShiftPanel({ user, shift, money, paper, businessName, onShiftChange, onNotice }: { user: AppUser; shift: Shift | null; money: (n: number) => string; paper: PaperWidth; businessName: string; onShiftChange: () => Promise<void>; onNotice: (m: string) => void }) {
  const [fig, setFig] = useState<ShiftFigures | null>(null), [opening, setOpening] = useState(false), [closing, setClosing] = useState(false), [slip, setSlip] = useState("");
  useEffect(() => { setFig(null); if (shift) shiftFigures(shift.id).then(setFig).catch(e => onNotice(msg(e))); }, [shift?.id]);
  const expected = shift && fig ? expectedCash(shift.opening_float, fig.cashSales, fig.cashRefunds) : 0;
  const copy = async () => { try { await navigator.clipboard.writeText(slip); onNotice("Slip copied."); } catch { onNotice("Could not copy."); } };
  return <section className="panel">
    <div className="panel-head"><div><h3>My shift</h3><p>{shift ? `Opened ${shift.opened_at.slice(11, 16)} with ${money(shift.opening_float)} in the drawer.` : "Open a shift with the cash in your drawer before you start selling."}</p></div></div>
    {!shift && <button className="primary" onClick={() => setOpening(true)}>Open shift</button>}
    {shift && !fig && <p>Loading…</p>}
    {shift && fig && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 12 }}>
        <div><small style={{ color: "#718094" }}>Sales</small><div style={{ font: "700 20px var(--ui)" }}>{fig.sales}</div></div>
        <div><small style={{ color: "#718094" }}>Sales total</small><div style={{ font: "700 20px var(--ui)" }}>{money(fig.gross)}</div></div>
        <div><small style={{ color: "#718094" }}>Expected cash in drawer</small><div style={{ font: "700 20px var(--ui)" }}>{money(expected)}</div></div></div>
      <div className="table-wrap"><table><tbody>
        {fig.byMethod.map(m => <tr key={m.method}><td>{m.method}</td><td className="right">{money(m.amount)}</td></tr>)}{fig.credit > 0 && <tr><td>On credit</td><td className="right">{money(fig.credit)}</td></tr>}
        {fig.refunds.map(r => <tr key={"r" + r.method}><td>Refund ({r.method})</td><td className="right">-{money(r.amount)}</td></tr>)}{fig.discounts > 0 && <tr><td>Discounts given</td><td className="right">{money(fig.discounts)}</td></tr>}
        {!fig.sales && !fig.refunds.length && <tr><td colSpan={2} className="empty">No sales yet in this shift.</td></tr>}</tbody></table></div>
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}><button className="primary" onClick={() => setClosing(true)}>Close shift</button></div></>}
    {slip && <div style={{ marginTop: 14 }}><pre style={{ margin: 0, padding: 10, background: "#f7f9fb", borderRadius: 8, font: "11px/1.35 Menlo,Consolas,monospace", overflowX: "auto" }}>{slip}</pre>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button className="primary" onClick={() => printPlain(slip, paper)}><Printer size={15} /> Print slip</button><button className="secondary" onClick={copy}><Copy size={14} /> Copy text</button></div></div>}
    {opening && <OpenShiftDialog user={user} onNotice={onNotice} onCancel={() => setOpening(false)} onOpened={async () => { setOpening(false); setSlip(""); await onShiftChange(); }} />}
    {closing && shift && <CloseShiftFlow shift={shift} user={user} money={money} paper={paper} businessName={businessName} onNotice={onNotice} onCancel={() => setClosing(false)} onClosed={async s => { setClosing(false); setSlip(s); onNotice("Shift closed."); await onShiftChange(); }} />}
  </section>;
}
