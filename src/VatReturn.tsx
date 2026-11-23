import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { getVatReturn } from "./vatReport";
import type { TreatmentRow, VatReturn as VatReturnData, VatSide } from "./vatReport";
import { localDate } from "./parties";
import DateField from "./DateField";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pad = (n: number) => String(n).padStart(2, "0");
function monthRange(offset: number) {
  const n = new Date(), first = new Date(n.getFullYear(), n.getMonth() + offset, 1), last = new Date(n.getFullYear(), n.getMonth() + offset + 1, 0);
  const f = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: f(first), to: f(last) };
}
const csvCell = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;

export default function VatReturn({ money, onNotice, version }: { money: (n: number) => string; onNotice: (m: string) => void; version: number }) {
  const [range, setRange] = useState(() => { const r = monthRange(0); return { from: r.from, to: localDate() < r.to ? localDate() : r.to }; });
  const [data, setData] = useState<VatReturnData | null>(null);
  useEffect(() => { getVatReturn(range.from, range.to).then(setData).catch(e => { setData(null); onNotice(msg(e)); }); }, [range.from, range.to, version]);

  function exportCsv() {
    if (!data) return;
    const side = (title: string, s: VatSide, labels: string[]) => [[title, ""], [labels[0], s.opening], [labels[1], s.charged], ["Reversed documents", s.reversed], ["Payments, refunds and adjustments", s.other], [labels[2], s.closing], ["", ""]];
    const treat = (title: string, rows: TreatmentRow[]) => [[title, "Documents", "Value excl. VAT", "VAT"], ...rows.map(r => [r.label, r.count, r.net, r.vat]), ["", "", "", ""]];
    const rows: unknown[][] = [["VAT RETURN WORKING SUMMARY", `${data.from} to ${data.to}`], ["", ""],
      ...side("VAT PAYABLE (2100)", data.output, ["Opening balance", "VAT charged on sales", "Closing balance"]),
      ...side("VAT RECEIVABLE (1300)", data.input, ["Opening balance", "VAT on purchases", "Closing balance"]),
      ["Net VAT for the period (output less input)", data.netPeriod], ["Net VAT position at end (payable less recoverable)", data.netPayableClosing], ["", ""],
      ...treat("SALES BY VAT TREATMENT", data.sales), ...treat("PURCHASES BY VAT TREATMENT", data.purchases),
      ["VAT LINES", "", "", "", "", "", ""], ["Date", "Entry", "Account", "Type", "Description", "Debit", "Credit"],
      ...data.lines.map(l => [l.entry_date, l.entry_number, l.account_code, l.kind, l.description, l.debit_tzs, l.credit_tzs])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `msingi-vat-${data.from}-to-${data.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const sideTable = (title: string, sub: string, s: VatSide, labels: [string, string, string]) => <section className="panel report-card"><h3>{title}</h3><p>{sub}</p>
    <div className="stmt-group">
      <div className="stmt-row"><span>{labels[0]}</span><b>{money(s.opening)}</b></div>
      <div className="stmt-row"><span>{labels[1]}</span><b>{money(s.charged)}</b></div>
      <div className="stmt-row"><span>Reversed documents (voids)</span><b>{money(s.reversed)}</b></div>
      <div className="stmt-row"><span>Payments, refunds and manual adjustments</span><b>{money(s.other)}</b></div>
    </div><div className="stmt-total strong"><span>{labels[2]}</span><b>{money(s.closing)}</b></div></section>;
  const treatTable = (title: string, rows: TreatmentRow[]) => {
    const tot = rows.reduce((a, r) => ({ n: a.n + r.count, net: a.net + r.net, vat: a.vat + r.vat }), { n: 0, net: 0, vat: 0 });
    return <section className="panel" style={{ marginBottom: 17 }}><div className="panel-head"><div><h3>{title}</h3><p>Value excluding VAT, grouped by how each document or transaction was recorded</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>TREATMENT</th><th className="right">ITEMS</th><th className="right">VALUE EXCL. VAT</th><th className="right">VAT</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.treatment}><td>{r.label}</td><td className="right">{r.count}</td><td className="right">{money(r.net)}</td><td className="right">{money(r.vat)}</td></tr>)}
      </tbody><tfoot><tr><th>TOTAL</th><th className="right">{tot.n}</th><th className="right">{money(tot.net)}</th><th className="right">{money(tot.vat)}</th></tr></tfoot></table></div></section>;
  };

  return <>
    <section className="panel report-controls"><div className="panel-head"><div><h3>VAT return working summary</h3><p>Calculated from posted journals. This is a working summary to help you prepare your return. It is not an official TRA form; confirm the layout and rules with your tax adviser or TRA.</p></div></div>
      <div className="table-actions wrap">
        <label className="filter-date">From <DateField type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></label>
        <label className="filter-date">To <DateField type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></label>
        <button className="secondary" onClick={() => setRange(monthRange(0))}>This month</button>
        <button className="secondary" onClick={() => setRange(monthRange(-1))}>Last month</button>
        <button className="secondary" onClick={exportCsv} disabled={!data}><Download size={16} /> Export CSV</button></div></section>
    {data && <>
      <div className="vat-cards">
        <div className="panel"><span className="eyebrow">VAT ON SALES (OUTPUT)</span><h2>{money(data.output.charged + data.output.reversed)}</h2><small>Charged less voided documents</small></div>
        <div className="panel"><span className="eyebrow">VAT ON PURCHASES (INPUT)</span><h2>{money(data.input.charged + data.input.reversed)}</h2><small>Recoverable on bills and expenses</small></div>
        <div className="panel"><span className="eyebrow">{data.netPeriod >= 0 ? "NET VAT PAYABLE FOR PERIOD" : "NET VAT RECOVERABLE FOR PERIOD"}</span><h2>{money(Math.abs(data.netPeriod))}</h2><small>Output less input</small></div>
      </div>
      <div className="report-grid">
        {sideTable("VAT Payable (2100)", `${data.from} to ${data.to}`, data.output, ["Opening balance", "VAT charged on sales", "Closing balance owed"])}
        {sideTable("VAT Receivable (1300)", `${data.from} to ${data.to}`, data.input, ["Opening balance", "VAT on purchases", "Closing balance recoverable"])}
      </div>
      <section className="panel" style={{ margin: "0 0 17px" }}><div className="stmt-total strong"><span>{data.netPayableClosing >= 0 ? "Net VAT payable at end of period (VAT Payable less VAT Receivable)" : "Net VAT recoverable at end of period"}</span><b>{money(Math.abs(data.netPayableClosing))}</b></div>
        <small className="hint">"Payments, refunds and manual adjustments" shows journals posted directly to the VAT accounts, such as a payment to TRA. A voided invoice or bill reduces the period in which it was reversed, like a credit note.</small></section>
      {treatTable("Sales by VAT treatment", data.sales)}
      {treatTable("Purchases by VAT treatment", data.purchases)}
      <section className="panel"><div className="panel-head"><div><h3>VAT journal lines</h3><p>{data.lines.length} lines on the VAT accounts in this period</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>DATE</th><th>ENTRY</th><th>ACCOUNT</th><th>TYPE</th><th>DESCRIPTION</th><th className="right">DEBIT</th><th className="right">CREDIT</th></tr></thead><tbody>
          {data.lines.map((l, i) => <tr key={i}><td>{l.entry_date}</td><td>{l.entry_number}{l.status === "reversed" && <span className="status-reversed" style={{ marginLeft: 6 }}>reversed</span>}</td><td>{l.account_code}</td><td>{l.kind}</td><td className="description">{l.description}</td><td className="right">{l.debit_tzs ? money(l.debit_tzs) : ""}</td><td className="right">{l.credit_tzs ? money(l.credit_tzs) : ""}</td></tr>)}
          {!data.lines.length && <tr><td colSpan={7} className="empty">No VAT activity in this period.</td></tr>}
        </tbody></table></div></section>
    </>}
  </>;
}
