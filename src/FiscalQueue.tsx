import { useEffect, useState } from "react";
import { getFiscalMode, listFiscal, matchFiscalReceipt, pendingCount, setFiscalMode } from "./fiscalDb";
import type { FiscalMode, FiscalRow, FiscalStatus } from "./fiscalDb";
import type { AppUser } from "./permissions";
import { Modal, downloadCsv, msg } from "./ui";

export default function FiscalQueue({ user, money, version, onNotice }: { user: AppUser; money: (n: number) => string; version: number; onNotice: (m: string) => void }) {
  const [mode, setMode] = useState<FiscalMode>("off"), [rows, setRows] = useState<FiscalRow[]>([]), [pending, setPending] = useState(0), [filter, setFilter] = useState<"all" | FiscalStatus>("pending"), [match, setMatch] = useState<FiscalRow | null>(null);
  const load = async () => { try { setMode(await getFiscalMode()); setPending(await pendingCount()); setRows(await listFiscal(filter === "all" ? undefined : filter)); } catch (e) { onNotice(msg(e)); } };
  useEffect(() => { void load(); }, [filter, version]);
  async function toggle() { try { await setFiscalMode(mode === "off" ? "record" : "off", user.id); await load(); } catch (e) { onNotice(msg(e)); } }
  const label = (r: FiscalRow) => (r.status === "matched" ? `Matched ${r.receiptNo}` : r.status === "sent" ? "Sent" : "Waiting");
  return <>
    <section className="panel" style={{ borderLeft: "4px solid #d9a441" }}>
      <div className="panel-head"><div><h3>Msingi is not connected to TRA</h3><p>This page does not send anything to TRA and Msingi does not issue EFD or VFD fiscal receipts. Receipts printed by Msingi are for the customer only and are not tax invoices. If your business must issue fiscal receipts, keep issuing them for every sale with your TRA-approved device.</p></div></div>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 12px" }}>What this page does: when switched on, each new sale is saved here with its VAT breakdown. You can then type in the receipt number your approved device issued for it, so your records and your fiscal receipts can be reconciled, and so a real connection can be added later.</p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className={mode === "record" ? "secondary" : "primary"} onClick={toggle}>{mode === "record" ? "Stop recording new sales" : "Start recording new sales"}</button>
        <span style={{ fontSize: 13 }}>{mode === "record" ? <b style={{ color: "#168a78" }}>Recording is ON</b> : "Recording is off. Sales made now are not added to this list."}</span></div>
    </section>
    <section className="panel" style={{ marginTop: 17 }}>
      <div className="panel-head"><div><h3>Sales and fiscal receipt numbers</h3><p>{pending} sale{pending === 1 ? "" : "s"} waiting for a receipt number. Reversed sales are not counted.</p></div>
        <div style={{ display: "flex", gap: 8 }}><label className="filter-date">Show<select value={filter} onChange={e => setFilter(e.target.value as "all" | FiscalStatus)}><option value="pending">Waiting</option><option value="matched">Matched</option><option value="all">All</option></select></label>
          <button className="secondary" disabled={!rows.length} onClick={() => downloadCsv("fiscal-queue.csv", [["Sale", "Date", "Total (TZS)", "VAT (TZS)", "Status", "Fiscal receipt no.", "Verification code", "Reversed", "Refunds"], ...rows.map(r => [r.ref, r.date, r.gross, r.vat, label(r), r.receiptNo, r.code, r.reversed ? "yes" : "", r.refunds || ""])])}>Export CSV</button></div></div>
      <div className="table-wrap"><table><thead><tr><th>SALE</th><th>DATE</th><th className="right">TOTAL</th><th className="right">VAT</th><th>STATUS</th><th>AFTER THE SALE</th><th></th></tr></thead><tbody>
        {rows.map(r => <tr key={r.eventId}><td>{r.ref}</td><td>{r.date}</td><td className="right">{money(r.gross)}</td><td className="right">{money(r.vat)}</td><td>{label(r)}</td>
          <td style={{ fontSize: 12, color: r.reversed || r.refunds ? "#d66c5e" : undefined }}>{r.reversed ? "Sale reversed" : r.refunds ? `${r.refunds} refund${r.refunds === 1 ? "" : "s"}` : "—"}</td>
          <td>{r.status === "pending" && <button className="secondary" onClick={() => setMatch(r)}>Enter receipt no.</button>}</td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="empty">{mode === "off" ? "Nothing recorded. Start recording to list new sales here." : "Nothing to show."}</td></tr>}</tbody></table></div>
      <p style={{ fontSize: 11, color: "#8995a3", margin: "10px 0 0" }}>If a sale was refunded or reversed after a fiscal receipt was issued, ask TRA or your fiscal-device supplier how to document it.</p>
    </section>
    {match && <MatchDialog row={match} money={money} onClose={() => setMatch(null)} onSave={async (no, code) => { try { await matchFiscalReceipt(match.eventId, no, code, user.id); setMatch(null); onNotice(`${match.ref} matched to receipt ${no}.`); await load(); } catch (e) { onNotice(msg(e)); } }} />}
  </>;
}

function MatchDialog({ row, money, onClose, onSave }: { row: FiscalRow; money: (n: number) => string; onClose: () => void; onSave: (no: string, code: string) => void }) {
  const [no, setNo] = useState(""), [code, setCode] = useState("");
  return <Modal eyebrow="FISCAL RECEIPT" title={`Sale ${row.ref}`} onClose={onClose}>
    <p style={{ fontSize: 13, color: "#59697a", lineHeight: 1.5 }}>Type the receipt number your approved EFD/VFD printed for this {money(row.gross)} sale. Msingi only stores it. It does not check it with TRA.</p>
    <label>Fiscal receipt number<input value={no} onChange={e => setNo(e.target.value)} autoFocus /></label>
    <label>Verification code (optional)<input value={code} onChange={e => setCode(e.target.value)} /></label>
    <div style={{ display: "flex", gap: 10, marginTop: 14 }}><button className="primary" disabled={!no.trim()} onClick={() => onSave(no, code)}>Save</button><button className="secondary" onClick={onClose}>Cancel</button></div>
  </Modal>;
}
