import { useState } from "react";
import { Copy, Printer } from "lucide-react";
import DateField from "./DateField";
import { getCashUp, cashUpText } from "./cashupDb";
import type { CashUp as CashUpData } from "./cashupDb";
import { COLS } from "./receipt";
import type { PaperWidth } from "./receipt";
import { printPlain } from "./printReceipt";
import { localDate } from "./parties";
import { msg } from "./ui";

const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(/,/g, "")));

export default function CashUp({ money, onNotice, paper, businessName }: { money: (n: number) => string; onNotice: (m: string) => void; paper: PaperWidth; businessName: string }) {
  const [date, setDate] = useState(localDate()), [data, setData] = useState<CashUpData | null>(null), [float, setFloat] = useState(""), [counted, setCounted] = useState(""), [busy, setBusy] = useState(false);
  async function load() { setBusy(true); try { setData(await getCashUp(date)); } catch (e) { onNotice(msg(e)); } setBusy(false); }
  const cash = (data?.byMethod.find(m => m.method === "Cash")?.amount ?? 0) - (data?.refunds.find(m => m.method === "Cash")?.amount ?? 0);
  const f = Number.isSafeInteger(num(float)) && num(float) >= 0 ? num(float) : 0;
  const expected = f + cash, hasCount = counted.trim() !== "" && Number.isSafeInteger(num(counted)) && num(counted) >= 0, diff = hasCount ? num(counted) - expected : 0;
  const text = data ? cashUpText(data, businessName, f, hasCount ? num(counted) : null, COLS[paper]) : "";
  async function copy() { try { await navigator.clipboard.writeText(text); onNotice("Cash-up copied."); } catch { onNotice("Could not copy."); } }
  return <section className="panel" style={{ marginTop: 17 }}>
    <div className="panel-head"><div><h3>Daily cash-up</h3><p>Sales for a day by payment method, and a check of the cash in the drawer. Reversed sales are left out.</p></div></div>
    <div className="table-actions wrap" style={{ marginBottom: 12 }}>
      <label className="filter-date">Day<DateField type="date" value={date} onChange={e => { setDate(e.target.value); setData(null); }} required /></label>
      <button className="primary" onClick={load} disabled={busy}>{busy ? "Loading…" : "Show day"}</button></div>
    {data && <>
      <div className="table-wrap"><table><thead><tr><th>PAYMENT</th><th className="right">AMOUNT</th></tr></thead><tbody>
        {data.byMethod.map(m => <tr key={m.method}><td>{m.method}</td><td className="right">{money(m.amount)}</td></tr>)}
        {data.credit > 0 && <tr><td>On credit (invoiced)</td><td className="right">{money(data.credit)}</td></tr>}
        {data.refunds.map(r => <tr key={"r" + r.method}><td>Refund ({r.method})</td><td className="right">-{money(r.amount)}</td></tr>)}
        {!data.byMethod.length && !data.credit && <tr><td colSpan={2} className="empty">No sales recorded on {data.date}.</td></tr>}
        <tr><td><b>Total sales ({data.sales})</b></td><td className="right"><b>{money(data.gross)}</b></td></tr>
        {data.vat > 0 && <tr><td>of which VAT</td><td className="right">{money(data.vat)}</td></tr>}
      </tbody></table></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 14 }}>
        <label>Opening float (TZS)<input inputMode="numeric" value={float} onChange={e => setFloat(e.target.value)} placeholder="0" /></label>
        <label>Cash counted (TZS)<input inputMode="numeric" value={counted} onChange={e => setCounted(e.target.value)} placeholder="Count the drawer" /></label>
        <div style={{ fontSize: 12, color: "#59697a" }}>Expected cash<div style={{ font: "700 20px var(--ui)" }}>{money(expected)}</div><small>float + cash sales less cash refunds ({money(cash)})</small></div>
        {hasCount && <div style={{ fontSize: 12, color: diff === 0 ? "#168a78" : "#d66c5e", fontWeight: 700 }}>{diff === 0 ? "Balanced" : diff > 0 ? `Over by ${money(diff)}` : `Short by ${money(-diff)}`}</div>}
      </div>
      <p style={{ fontSize: 11, color: "#8995a3", margin: "10px 0" }}>Only cash from sales is counted. Cash paid out (expenses, advances) or taken for banking should be allowed for in the float and count.</p>
      <div style={{ display: "flex", gap: 8 }}><button className="primary" onClick={() => printPlain(text, paper)}><Printer size={15} /> Print slip</button><button className="secondary" onClick={copy}><Copy size={14} /> Copy text</button></div>
    </>}
  </section>;
}
