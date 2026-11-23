import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { getSalesByItem } from "./itemsDb";
import type { SalesByItemRow } from "./itemsDb";
import { fmtQty } from "./itemsCalc";
import { localDate } from "./parties";
import { downloadCsv, msg } from "./ui";
import DateField from "./DateField";

export default function SalesReport({ money, onNotice, version }: { money: (n: number) => string; onNotice: (m: string) => void; version: number }) {
  const [from, setFrom] = useState(localDate().slice(0, 8) + "01"), [to, setTo] = useState(localDate()), [rows, setRows] = useState<SalesByItemRow[]>([]);
  useEffect(() => { getSalesByItem(from, to).then(setRows).catch(e => onNotice(msg(e))); }, [from, to, version]);
  const net = rows.reduce((s, r) => s + r.net_tzs, 0), cost = rows.reduce((s, r) => s + r.cost_tzs, 0), profit = net - cost;
  const margin = net > 0 ? Math.round((profit / net) * 1000) / 10 : null;
  const exportCsv = () => downloadCsv(`msingi-sales-by-item-${from}-to-${to}.csv`, [["Code", "Item", "Unit", "Quantity sold", "Sales (before VAT)", "Cost", "Profit", "Margin %"],
    ...rows.map(r => [r.code, r.name, r.unit, r.qty_milli / 1000, r.net_tzs, r.cost_tzs, r.profit_tzs, r.margin_pct ?? ""]), ["", "TOTAL", "", "", net, cost, profit, margin ?? ""]]);
  return <section className="panel">
    <div className="panel-head"><div><h3>Sales by item</h3><p>What sold, what it cost you and the profit on it. Sales are before VAT. Best profit first.</p></div>
      <div className="table-actions wrap"><label className="filter-date">From <DateField type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label className="filter-date">To <DateField type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="secondary" onClick={exportCsv} disabled={!rows.length}><Download size={15} /> Export</button></div></div>
    <div className="table-wrap"><table><thead><tr><th>ITEM</th><th className="right">QTY SOLD</th><th className="right">SALES</th><th className="right">COST</th><th className="right">PROFIT</th><th className="right">MARGIN</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.item_id}><td className="description">{r.name}<small style={{ display: "block", fontWeight: 400, color: "#9aa5b2" }}>{r.code}</small></td><td className="right">{fmtQty(r.qty_milli)} {r.unit}</td><td className="right">{money(r.net_tzs)}</td><td className="right">{r.kind === "service" ? "—" : money(r.cost_tzs)}</td>
        <td className="right"><b className={r.profit_tzs < 0 ? "red-text" : ""}>{money(r.profit_tzs)}</b></td><td className="right">{r.margin_pct === null ? "—" : `${r.margin_pct}%`}</td></tr>)}
      {rows.length > 0 && <tr><td className="description"><b>Total</b></td><td></td><td className="right"><b>{money(net)}</b></td><td className="right"><b>{money(cost)}</b></td><td className="right"><b>{money(profit)}</b></td><td className="right"><b>{margin === null ? "—" : `${margin}%`}</b></td></tr>}
      {!rows.length && <tr><td colSpan={6} className="empty">No item sales in this period. Sales made on Quick sale appear here (sales recorded before v0.6.1 are not itemised).</td></tr>}
    </tbody></table></div>
    <p style={{ fontSize: 11, color: "#8995a3", marginTop: 12 }}>Services show no cost. Items sold in the same sale share its VAT rounding, so a line can differ from the exact figure by 1 TZS; the totals always match your income statement. A sale you reverse is left out.</p>
  </section>;
}
