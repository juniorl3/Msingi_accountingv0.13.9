import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import DateField from "./DateField";
import { auditTrail, cashierSummary } from "./posReports";
import type { AuditRow } from "./posReports";
import { listShifts } from "./shiftDb";
import type { Shift } from "./shiftDb";
import { cashierDayText, cashierNet } from "./shiftCalc";
import type { CashierRow } from "./shiftCalc";
import { CloseShiftFlow } from "./ShiftPanel";
import type { AppUser } from "./permissions";
import { COLS } from "./receipt";
import type { PaperWidth } from "./receipt";
import { printPlain } from "./printReceipt";
import { localDate } from "./parties";
import { downloadCsv, msg } from "./ui";

const KIND_LABEL: Record<string, string> = { refund: "Refund", void: "Reversal", discount: "Discount", drawer: "Drawer opened (no sale)", override_failed: "Failed approval", shift_close: "Shift closed" };

export default function CashierReports({ user, money, paper, businessName, version, onNotice, onShiftChange }: { user: AppUser; money: (n: number) => string; paper: PaperWidth; businessName: string; version: number; onNotice: (m: string) => void; onShiftChange: () => Promise<void> }) {
  const [from, setFrom] = useState(localDate()), [to, setTo] = useState(localDate()), [rows, setRows] = useState<CashierRow[]>([]), [shifts, setShifts] = useState<Shift[]>([]), [audit, setAudit] = useState<AuditRow[]>([]), [kind, setKind] = useState("all"), [busy, setBusy] = useState(false), [closing, setClosing] = useState<Shift | null>(null);
  async function load() {
    setBusy(true);
    try { const [r, s, a] = await Promise.all([cashierSummary(from, to), listShifts(from, to), auditTrail(from, to)]); setRows(r); setShifts(s); setAudit(a); } catch (e) { onNotice(msg(e)); }
    setBusy(false);
  }
  useEffect(() => { void load(); }, [version]);
  const shown = audit.filter(a => kind === "all" || a.kind === kind), label = from === to ? from : `${from} to ${to}`;
  const total = rows.reduce((s, r) => ({ sales: s.sales + r.sales, gross: s.gross + r.gross, discounts: s.discounts + r.discounts, refundTotal: s.refundTotal + r.refundTotal }), { sales: 0, gross: 0, discounts: 0, refundTotal: 0 });
  function daySlip(r: CashierRow) {
    const mine = shifts.filter(s => s.user_id === r.userId).map(s => ({ opened: s.opened_at, closed: s.closed_at, float: s.opening_float, expected: s.expected_cash, counted: s.counted_cash, variance: s.variance }));
    printPlain(cashierDayText(businessName, label, r, mine, COLS[paper]), paper);
  }
  function exportCsv() {
    downloadCsv(`cashier-report-${from}-${to}.csv`, [["Cashier", "Sales", "Sales total", "Discounts", "Refunds", "Refund total", "Reversals", "Reversal total", "Net sales"], ...rows.map(r => [r.name, r.sales, r.gross, r.discounts, r.refunds, r.refundTotal, r.voids, r.voidTotal, cashierNet(r)])]);
  }
  return <>
    <section className="panel">
      <div className="panel-head"><div><h3>Cashier sales summary</h3><p>Sales, discounts, refunds and reversals per cashier. Reversed sales are not counted as sales.</p></div></div>
      <div className="table-actions wrap" style={{ marginBottom: 12 }}>
        <label className="filter-date">From<DateField type="date" value={from} onChange={e => setFrom(e.target.value)} required /></label>
        <label className="filter-date">To<DateField type="date" value={to} onChange={e => setTo(e.target.value)} required /></label>
        <button className="primary" onClick={load} disabled={busy}>{busy ? "Loading…" : "Show"}</button>
        <button className="secondary" onClick={exportCsv} disabled={!rows.length}>Export CSV</button></div>
      <div className="table-wrap"><table><thead><tr><th>CASHIER</th><th className="right">SALES</th><th className="right">SALES TOTAL</th><th className="right">DISCOUNTS</th><th className="right">REFUNDS</th><th className="right">REVERSED</th><th className="right">NET</th><th></th></tr></thead><tbody>
        {rows.map(r => <tr key={r.userId}><td className="description">{r.name}</td><td className="right">{r.sales}</td><td className="right">{money(r.gross)}</td><td className="right">{money(r.discounts)}</td><td className="right">{r.refunds ? `${r.refunds} · ${money(r.refundTotal)}` : "—"}</td><td className="right">{r.voids ? `${r.voids} · ${money(r.voidTotal)}` : "—"}</td><td className="right"><b>{money(cashierNet(r))}</b></td>
          <td><button className="secondary" aria-label={`Print report for ${r.name}`} onClick={() => daySlip(r)}><Printer size={13} /></button></td></tr>)}
        {!rows.length && <tr><td colSpan={8} className="empty">No cashier sales in this period. Sales made before v0.9.0 are not attributed to a cashier.</td></tr>}
        {rows.length > 1 && <tr><td><b>All cashiers</b></td><td className="right">{total.sales}</td><td className="right">{money(total.gross)}</td><td className="right">{money(total.discounts)}</td><td className="right">{money(total.refundTotal)}</td><td></td><td className="right"><b>{money(total.gross - total.refundTotal)}</b></td><td></td></tr>}
      </tbody></table></div>
      <p style={{ fontSize: 11, color: "#8995a3", margin: "8px 0 0" }}>Discounts are on the amount entered for each line (VAT-inclusive where prices include VAT).</p>
    </section>
    <section className="panel" style={{ marginTop: 17 }}>
      <div className="panel-head"><div><h3>Shifts</h3><p>Opening cash, expected cash and the counted result for each shift that started in this period.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>CASHIER</th><th>OPENED</th><th>CLOSED</th><th className="right">OPENING</th><th className="right">EXPECTED</th><th className="right">COUNTED</th><th className="right">RESULT</th><th></th></tr></thead><tbody>
        {shifts.map(s => <tr key={s.id}><td className="description">{s.user_name}{s.note && <small style={{ display: "block", fontWeight: 400, color: "#9aa5b2" }}>{s.note}</small>}</td><td>{s.opened_at.slice(0, 16)}</td><td>{s.closed_at ? s.closed_at.slice(0, 16) : <b>Open</b>}</td><td className="right">{money(s.opening_float)}</td>
          <td className="right">{s.expected_cash === null ? "—" : money(s.expected_cash)}</td><td className="right">{s.counted_cash === null ? "—" : money(s.counted_cash)}</td>
          <td className="right" style={{ color: s.variance ? "#d66c5e" : "#168a78", fontWeight: 600 }}>{s.variance === null ? "—" : s.variance === 0 ? "Balanced" : `${s.variance > 0 ? "Over" : "Short"} ${money(Math.abs(s.variance))}`}</td>
          <td>{s.status === "open" && <button className="secondary" onClick={() => setClosing(s)}>Close</button>}</td></tr>)}
        {!shifts.length && <tr><td colSpan={8} className="empty">No shifts in this period.</td></tr>}</tbody></table></div>
    </section>
    <section className="panel" style={{ marginTop: 17 }}>
      <div className="panel-head"><div><h3>Refunds, reversals and discounts</h3><p>Who did it, who approved it, and why. Newest first (up to 500).</p></div>
        <label className="filter-date">Show<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">Everything</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
      <div className="table-wrap"><table><thead><tr><th>TIME</th><th>WHAT</th><th>BY</th><th>APPROVED BY</th><th>REFERENCE</th><th className="right">AMOUNT</th><th>REASON</th></tr></thead><tbody>
        {shown.map(a => <tr key={a.id}><td>{a.at.slice(0, 16)}</td><td>{KIND_LABEL[a.kind] ?? a.kind}</td><td>{a.user}</td><td>{a.approver || "—"}</td><td>{a.ref}</td><td className="right">{a.kind === "override_failed" ? "—" : money(a.amount)}</td><td style={{ fontSize: 12 }}>{a.reason}</td></tr>)}
        {!shown.length && <tr><td colSpan={7} className="empty">Nothing recorded in this period.</td></tr>}</tbody></table></div>
    </section>
    {closing && <CloseShiftFlow shift={closing} user={user} money={money} paper={paper} businessName={businessName} onNotice={onNotice} onCancel={() => setClosing(null)} onClosed={async () => { setClosing(null); onNotice("Shift closed."); await onShiftChange(); await load(); }} />}
  </>;
}
