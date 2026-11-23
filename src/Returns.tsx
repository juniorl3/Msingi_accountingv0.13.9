import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { listRecentSales, refundSale } from "./itemsDb";
import type { SaleView } from "./itemsDb";
import { fmtQty, toMilli } from "./itemsCalc";
import { returnShare } from "./returnsCalc";
import { COLS, fmtTzs } from "./receipt";
import type { PaperWidth } from "./receipt";
import { printPlain } from "./printReceipt";
import DateField from "./DateField";
import { localDate } from "./parties";
import { msg } from "./ui";
import { authorize } from "./authorize";
import type { AppUser } from "./permissions";
import type { Shift } from "./shiftDb";

const METHODS = ["Cash", "Mobile money", "Bank", "Card"];

export default function Returns({ money, onNotice, onChanged, version, paper, businessName, user, shift }: { money: (n: number) => string; onNotice: (m: string) => void; onChanged: () => Promise<void>; version: number; paper: PaperWidth; businessName: string; user: AppUser; shift: Shift | null }) {
  const [sales, setSales] = useState<SaleView[]>([]), [q, setQ] = useState(""), [sel, setSel] = useState<number | null>(null), [qty, setQty] = useState<Record<number, string>>({});
  const [method, setMethod] = useState("Cash"), [reason, setReason] = useState(""), [date, setDate] = useState(localDate()), [busy, setBusy] = useState(false), [slip, setSlip] = useState("");
  useEffect(() => { listRecentSales().then(setSales).catch(e => onNotice(msg(e))); }, [version]);
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return sales.filter(x => !s || x.ref.toLowerCase().includes(s) || x.reference.toLowerCase().includes(s) || x.date.includes(s) || x.lines.some(l => l.name.toLowerCase().includes(s))); }, [sales, q]);
  const sale = sales.find(x => x.event_id === sel) ?? null;

  // Preview of what each requested line refunds. A bad quantity shows its message instead of an amount.
  const rows = (sale?.lines ?? []).map(l => {
    const raw = (qty[l.id] ?? "").trim();
    if (!raw || l.gross === null) return { l, milli: 0, share: null as null | ReturnType<typeof returnShare>, err: "" };
    try {
      const milli = toMilli(raw);
      const done = { qty: l.returned_milli, gross: 0, net: 0, vat: 0, cost: 0 };
      // Earlier returns' amounts are re-derived proportionally; the server uses the exact stored totals.
      const prev = l.returned_milli > 0 ? returnShare({ qty: l.qty_milli, gross: l.gross, net: l.net, vat: l.vat, cost: l.cost }, { qty: 0, gross: 0, net: 0, vat: 0, cost: 0 }, l.returned_milli) : done;
      return { l, milli, share: returnShare({ qty: l.qty_milli, gross: l.gross, net: l.net, vat: l.vat, cost: l.cost }, { qty: l.returned_milli, ...prev }, milli), err: "" };
    } catch (e) { return { l, milli: 0, share: null, err: msg(e) }; }
  });
  const total = rows.reduce((s, r) => s + (r.share?.gross ?? 0), 0), anyErr = rows.some(r => r.err), anyQty = rows.some(r => r.milli > 0);

  async function go(e: React.FormEvent) {
    e.preventDefault(); if (!sale) return;
    const auth = await authorize(user, "refund", `Refund ${money(total)} on ${sale.ref}`); // a cashier without the refund permission needs a manager's PIN
    if (!auth.ok) { onNotice("The refund was not approved."); return; }
    setBusy(true);
    try {
      const r = await refundSale({ eventId: sale.event_id, date, paymentMethod: method, reason, lines: rows.filter(x => x.milli > 0).map(x => ({ lineId: x.l.id, qtyMilli: x.milli })), actor: { userId: user.id, approverId: auth.approverId, shiftId: shift?.id } });
      const cols = COLS[paper], pair = (a: string, b: string) => a + " ".repeat(Math.max(1, cols - a.length - b.length)) + b, rule = "-".repeat(cols);
      setSlip([businessName, "REFUND SLIP", rule, pair("Sale", sale.ref), pair("Date", date), ...rows.filter(x => x.milli > 0).map(x => pair(`${fmtQty(x.milli)} x ${x.l.name}`.slice(0, cols - 10), fmtTzs(x.share?.gross ?? 0))), rule, pair("REFUND (TZS)", fmtTzs(r.gross)), pair("Paid by", method), "", "Reason: " + reason.trim()].join("\n"));
      onNotice(`Refund ${r.reference} recorded: ${money(r.gross)} paid back by ${method}.`);
      setQty({}); setReason(""); await onChanged(); setSales(await listRecentSales());
    } catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }

  return <section className="panel" style={{ marginTop: 17 }}>
    <div className="panel-head"><div><h3>Refund or return items</h3><p>Pick a paid sale and the items coming back. Sales and VAT are reversed, and stock items go back on the shelf at their original cost.</p></div></div>
    <div className="table-actions wrap" style={{ marginBottom: 12 }}>
      <label className="filter-date">Find a sale<input value={q} onChange={e => setQ(e.target.value)} placeholder="Reference, date or item" style={{ width: 200 }} /></label>
      <label className="filter-date">Sale<select value={sel ?? ""} onChange={e => { setSel(e.target.value ? Number(e.target.value) : null); setQty({}); setSlip(""); }}><option value="">Choose a sale</option>{shown.map(x => <option key={x.event_id} value={x.event_id}>{x.ref} · {x.date} · {x.gross === null ? "older sale" : money(x.gross)}{x.credit ? " · on credit" : ""}</option>)}</select></label></div>
    {sale && sale.credit && <p className="red-text">This sale was on credit (invoiced). Refunding invoiced sales is not supported yet: reverse the sale from the Stock page or adjust the customer's invoice.</p>}
    {sale && !sale.credit && sale.gross === null && <p className="red-text">This sale was made before refunds were supported, so its VAT breakdown was not saved. Reverse the whole sale from the Stock page instead.</p>}
    {sale && !sale.credit && sale.gross !== null && <form onSubmit={go}>
      <div className="table-wrap"><table><thead><tr><th>ITEM</th><th className="right">SOLD</th><th className="right">ALREADY RETURNED</th><th className="right">RETURN NOW</th><th className="right">REFUND</th></tr></thead><tbody>
        {rows.map(r => { const left = r.l.qty_milli - r.l.returned_milli; return <tr key={r.l.id}>
          <td className="description">{r.l.name}<small style={{ display: "block", fontWeight: 400, color: r.err ? "#d66c5e" : "#9aa5b2" }}>{r.err || (r.l.kind === "stock" ? "Goes back into stock" : r.l.kind === "menu" ? "Menu item: refunded, not restocked" : "Service: refunded")}</small></td>
          <td className="right">{fmtQty(r.l.qty_milli)} {r.l.unit}</td><td className="right">{fmtQty(r.l.returned_milli)}</td>
          <td className="right">{left > 0 ? <input inputMode="decimal" value={qty[r.l.id] ?? ""} onChange={e => setQty({ ...qty, [r.l.id]: e.target.value })} placeholder={`max ${fmtQty(left)}`} style={{ width: 90, textAlign: "right" }} /> : "—"}</td>
          <td className="right">{r.share ? money(r.share.gross) : "—"}</td></tr>; })}
      </tbody></table></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginTop: 12 }}>
        <label>Refund paid by<select value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Date<DateField type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
        <label>Reason (required)<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Faulty, wrong size…" required /></label></div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button className="primary" disabled={busy || !anyQty || anyErr || !reason.trim()}>{busy ? "Recording…" : `Refund ${money(total)}`}</button>
        {slip && <button type="button" className="secondary" onClick={() => printPlain(slip, paper)}><Printer size={14} /> Print refund slip</button>}</div>
    </form>}
    {!sale && <p style={{ fontSize: 12, color: "#8995a3" }}>Only the 40 most recent sales are listed. Older sales, invoiced sales and sales made before v0.7.0 can be reversed from the Stock page instead.</p>}
  </section>;
}
