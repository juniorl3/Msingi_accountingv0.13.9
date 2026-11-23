import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { REASON_LABEL, adjustStock, getEventMoves, getStockSummary, listItems, listStockEvents, receiveStock, voidStockEvent } from "./itemsDb";
import type { AdjustReason, Item, StockEventRow, StockSummary } from "./itemsDb";
import { fmtQty, lineAmount, toMilli } from "./itemsCalc";
import type { ItemVat } from "./itemsCalc";
import { getParties, localDate } from "./parties";
import type { Party } from "./parties";
import type { VatPrefs } from "./business";
import { Modal, downloadCsv, msg } from "./ui";
import DateField from "./DateField";
import { authorize } from "./authorize";
import type { AppUser } from "./permissions";
import type { Shift } from "./shiftDb";

type Props = { money: (n: number) => string; onNotice: (m: string) => void; onChanged: () => Promise<void>; version: number; vatPrefs: VatPrefs; user: AppUser; shift: Shift | null };
const KIND_TEXT: Record<string, string> = { opening: "Opening stock", purchase: "Stock received", sale: "Sale", adjustment: "Adjustment", void: "Reversal" };
const METHODS = ["Bank", "Cash", "Mobile money"];

export default function StockPage(p: Props) {
  const [sum, setSum] = useState<StockSummary | null>(null), [events, setEvents] = useState<StockEventRow[]>([]), [suppliers, setSuppliers] = useState<Party[]>([]);
  const [open, setOpen] = useState<number | null>(null), [moves, setMoves] = useState<Awaited<ReturnType<typeof getEventMoves>>>([]), [reverse, setReverse] = useState<StockEventRow | null>(null), [panel, setPanel] = useState<"receive" | "adjust" | null>(null);
  const load = async () => { try { const [s, e, sp] = await Promise.all([getStockSummary(), listStockEvents(), getParties("supplier")]); setSum(s); setEvents(e); setSuppliers(sp); } catch (err) { p.onNotice(msg(err)); } };
  useEffect(() => { load(); }, [p.version]);
  const changed = async () => { await load(); await p.onChanged(); };
  const avg = (i: Item) => (i.qty_milli > 0 ? Math.round((i.value_tzs / i.qty_milli) * 1000) : 0);
  async function toggle(id: number) { if (open === id) { setOpen(null); return; } setOpen(id); try { setMoves(await getEventMoves(id)); } catch (e) { p.onNotice(msg(e)); } }
  function exportValuation() { if (sum) downloadCsv(`msingi-stock-valuation-${localDate()}.csv`, [["Code", "Item", "Unit", "On hand", "Average cost", "Stock value", "Selling price"], ...sum.items.map(i => [i.code, i.name, i.unit, i.qty_milli / 1000, avg(i), i.value_tzs, i.price_tzs]), ["", "TOTAL", "", "", "", sum.valuation, ""]]); }
  if (!sum) return null;
  return <>
    <div className="stats">
      <div className="stat"><span>Stock value (items)</span><strong>{p.money(sum.valuation)}</strong><small>{sum.items.filter(i => i.qty_milli > 0).length} item(s) in stock</small></div>
      <div className="stat"><span>Inventory in the ledger (1200)</span><strong>{p.money(sum.ledger)}</strong><small className={sum.difference === 0 ? "" : "red-text"}>{sum.difference === 0 ? "Agrees with the stock records" : `Difference ${p.money(sum.difference)}`}</small></div>
      <div className="stat"><span>Running low</span><strong>{sum.low.length}</strong><small>{sum.low.length ? sum.low.slice(0, 3).map(i => i.name).join(", ") : "Nothing below its warning level"}</small></div>
    </div>
    <div style={{ display: "flex", gap: 10, marginBottom: 17 }}><button className="primary" onClick={() => setPanel("receive")}><Plus size={16} /> Receive stock</button><button className="secondary" onClick={() => setPanel("adjust")}>Adjust stock</button><button className="secondary" onClick={exportValuation} disabled={!sum.items.length}>Export valuation</button></div>
    {sum.difference !== 0 && sum.hasStock && <div className="note" style={{ marginTop: 0, marginBottom: 17 }}><b>Stock records and the ledger differ by {p.money(Math.abs(sum.difference))}</b><span>Stock bought or journals posted to Inventory (1200) outside this page are not in the item records. Load that stock as opening stock marked "already in my books", or adjust stock to match a stock-take.</span></div>}
    <section className="panel" style={{ marginBottom: 17 }}>
      <div className="panel-head"><div><h3>Stock on hand</h3><p>Weighted-average cost</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>ITEM</th><th className="right">ON HAND</th><th className="right">WARN AT</th><th className="right">AVG COST</th><th className="right">STOCK VALUE</th><th className="right">PRICE</th><th className="right">MARGIN</th></tr></thead><tbody>
        {sum.items.filter(i => i.is_active || i.qty_milli > 0).map(i => { const vatIncl = i.price_includes_vat && i.vat_treatment === "standard" ? i.price_tzs / (1 + p.vatPrefs.rate / 100) : i.price_tzs, a = avg(i), m = a > 0 && vatIncl > 0 ? Math.round(((vatIncl - a) / vatIncl) * 100) : null;
          return <tr key={i.id}><td className="description">{i.name}</td><td className="right"><span className={i.reorder_milli > 0 && i.qty_milli <= i.reorder_milli ? "red-text" : ""}>{fmtQty(i.qty_milli)} {i.unit}</span></td><td className="right">{i.reorder_milli ? fmtQty(i.reorder_milli) : "—"}</td><td className="right">{a ? p.money(a) : "—"}</td><td className="right">{p.money(i.value_tzs)}</td><td className="right">{p.money(i.price_tzs)}</td><td className="right">{m === null ? "—" : `${m}%`}</td></tr>; })}
        {!sum.items.length && <tr><td colSpan={7} className="empty">No stock items yet. Add them on the Items page.</td></tr>}
      </tbody></table></div>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h3>Stock movements</h3><p>Every purchase, sale and adjustment, with its journal. Use Reverse to undo one: the ledger entries and the quantities are both put back.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>DATE</th><th>WHAT</th><th>JOURNALS</th><th className="right">LINES</th><th className="right">STOCK VALUE MOVED</th><th></th></tr></thead><tbody>
        {events.map(e => <Fragment key={e.id}><tr style={e.voided ? { opacity: .55 } : undefined}>
          <td><button className="text-button journal-link" onClick={() => toggle(e.id)}>{e.reference}</button></td><td>{e.event_date}</td><td>{KIND_TEXT[e.kind] ?? e.kind}{e.voided ? " (reversed)" : ""}{e.note && <small style={{ display: "block", color: "#9aa5b2" }}>{e.note}</small>}</td><td>{e.journals || "—"}</td><td className="right">{e.lines}</td><td className="right">{p.money(e.value)}</td>
          <td>{!e.voided && e.kind !== "void" && <button className="text-button" onClick={() => setReverse(e)}>Reverse</button>}</td></tr>
          {open === e.id && moves.map((m, i) => <tr key={`${e.id}-${i}`}><td></td><td colSpan={2} style={{ paddingLeft: 24 }}>{m.name}</td><td></td><td className="right">{m.qty_milli > 0 ? "+" : "−"}{fmtQty(Math.abs(m.qty_milli))} {m.unit}</td><td className="right">{p.money(m.value_tzs)}</td><td></td></tr>)}</Fragment>)}
        {!events.length && <tr><td colSpan={7} className="empty">No stock movements yet.</td></tr>}
      </tbody></table></div>
    </section>
    {panel === "receive" && <ReceiveModal {...p} suppliers={suppliers} onClose={() => setPanel(null)} changed={changed} />}
    {panel === "adjust" && <AdjustModal {...p} onClose={() => setPanel(null)} changed={changed} />}
    {reverse && <ReverseModal ev={reverse} user={p.user} shift={p.shift} onNotice={p.onNotice} onClose={() => setReverse(null)} changed={changed} />}
  </>;
}

function ReceiveModal({ money, onNotice, vatPrefs, suppliers, onClose, changed }: Props & { suppliers: Party[]; onClose: () => void; changed: () => Promise<void> }) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { listItems().then(r => setItems(r.filter(i => i.kind === "stock"))).catch(e => onNotice(msg(e))); }, []);
  const [date, setDate] = useState(localDate()), [supplier, setSupplier] = useState(""), [method, setMethod] = useState("Bank"), [due, setDue] = useState(localDate()), [ref, setRef] = useState("");
  const [vat, setVat] = useState<ItemVat>(vatPrefs.vatRegistered ? vatPrefs.docTreatment : "none"), [includes, setIncludes] = useState(vatPrefs.amountIncludesVat), [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([{ itemId: "", qty: "", total: "" }]);
  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.total.replace(/,/g, "")) || 0), 0), [rows]);
  const setRow = (i: number, k: string, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await receiveStock({ date, supplierId: supplier ? Number(supplier) : undefined, paymentMethod: supplier ? undefined : method, dueDate: due, reference: ref, vatTreatment: vat, vatRate: vatPrefs.rate, amountIncludesVat: includes, vatRegistered: vatPrefs.vatRegistered,
        lines: rows.filter(x => x.itemId || x.qty || x.total).map(x => ({ itemId: Number(x.itemId), qtyMilli: toMilli(x.qty), lineTotal: Number(x.total.replace(/,/g, "")) })) });
      onNotice(`Stock received as ${r.reference}${r.billNumber ? `, supplier bill ${r.billNumber}` : ""}. Added to stock at ${money(r.net)} before VAT.`); await changed(); onClose();
    } catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  return <Modal eyebrow="STOCK" title="Receive stock" onClose={onClose} wide>
    <form onSubmit={save}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <label>Date<DateField type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Bought from<select value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">Paid now (no supplier bill)</option>{suppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name} (on credit)</option>)}</select></label>
        {supplier ? <label>Bill due date<DateField type="date" value={due} onChange={e => setDue(e.target.value)} /></label> : <label>Paid from<select value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>}
        <label>Supplier invoice or note (optional)<input value={ref} onChange={e => setRef(e.target.value)} /></label>
      </div>
      <div className="table-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>ITEM</th><th className="right">QUANTITY</th><th className="right">TOTAL COST FOR THIS LINE</th><th></th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i}><td><select value={r.itemId} onChange={e => setRow(i, "itemId", e.target.value)} style={{ minWidth: 200 }}><option value="">Choose item</option>{items.map(it => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}</select></td>
          <td className="right"><input inputMode="decimal" value={r.qty} onChange={e => setRow(i, "qty", e.target.value)} style={{ width: 90, textAlign: "right" }} /></td>
          <td className="right"><input inputMode="numeric" value={r.total} onChange={e => setRow(i, "total", e.target.value)} style={{ width: 130, textAlign: "right" }} /></td>
          <td><button type="button" className="delete" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}><Trash2 size={15} /></button></td></tr>)}
      </tbody></table></div>
      <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={() => setRows([...rows, { itemId: "", qty: "", total: "" }])}><Plus size={15} /> Add line</button>
      {vatPrefs.vatRegistered && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <label>VAT on this purchase<select value={vat} onChange={e => setVat(e.target.value as ItemVat)}><option value="standard">Standard rate ({vatPrefs.rate}%)</option><option value="zero">Zero-rated</option><option value="exempt">Exempt</option><option value="none">No VAT</option></select></label>
        {vat === "standard" && <label className="check-label"><input type="checkbox" checked={includes} onChange={e => setIncludes(e.target.checked)} /><span><b>Amounts include VAT</b><small>Untick if the line totals are before VAT.</small></span></label>}</div>}
      <p style={{ fontSize: 12, color: "#718094", marginTop: 12 }}>Total entered: <b>{money(total)}</b>. {supplier ? "A supplier bill is created and the stock is added at its cost before VAT." : "The purchase is recorded as paid now and the stock is added at its cost before VAT."}</p>
      <button className="primary submit" disabled={busy}>{busy ? "Saving…" : "Receive stock"}</button>
    </form>
  </Modal>;
}

function AdjustModal({ money, onNotice, onClose, changed }: Props & { onClose: () => void; changed: () => Promise<void> }) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { listItems().then(r => setItems(r.filter(i => i.kind === "stock"))).catch(e => onNotice(msg(e))); }, []);
  const [f, setF] = useState({ itemId: "", dir: "remove", qty: "", reason: "wastage" as AdjustReason, cost: "", date: localDate(), note: "" }), [busy, setBusy] = useState(false);
  const it = items.find(i => String(i.id) === f.itemId);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const q = toMilli(f.qty), r = await adjustStock({ date: f.date, itemId: Number(f.itemId), qtyMilli: f.dir === "remove" ? -q : q, reason: f.reason, unitCost: f.dir === "add" && f.cost.trim() ? Number(f.cost.replace(/,/g, "")) : undefined, note: f.note });
      onNotice(`Stock adjusted as ${r.reference}: ${r.value < 0 ? "cost" : "value"} ${money(Math.abs(r.value))}.`); await changed(); onClose();
    } catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  return <Modal eyebrow="STOCK" title="Adjust stock" onClose={onClose}>
    <form onSubmit={save}>
      <label>Item<select value={f.itemId} onChange={e => setF({ ...f, itemId: e.target.value })}><option value="">Choose item</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} — {fmtQty(i.qty_milli)} {i.unit} on hand</option>)}</select></label>
      <div className="switch"><button type="button" className={f.dir === "remove" ? "selected expense" : ""} onClick={() => setF({ ...f, dir: "remove" })}>Take stock out</button><button type="button" className={f.dir === "add" ? "selected income" : ""} onClick={() => setF({ ...f, dir: "add", reason: "count" })}>Add stock</button></div>
      <label>Quantity{it ? ` (${it.unit})` : ""}<input inputMode="decimal" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></label>
      <label>Reason<select value={f.reason} onChange={e => setF({ ...f, reason: e.target.value as AdjustReason })}>{(Object.keys(REASON_LABEL) as AdjustReason[]).map(r => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}</select></label>
      {f.dir === "add" && <label>Cost per {it?.unit ?? "unit"} (optional)<input inputMode="decimal" value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })} placeholder="Leave empty to use the average cost" /></label>}
      <label>Date<DateField type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
      <label>Note (optional)<input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      <p style={{ fontSize: 11, color: "#8995a3", marginTop: 12 }}>{f.dir === "remove" ? "Removed stock is charged at its average cost (to cost of goods sold, or other expenses for business use)." : "Added stock is credited to cost of goods sold."}</p>
      <button className="primary submit" disabled={busy}>{busy ? "Saving…" : "Post adjustment"}</button>
    </form>
  </Modal>;
}

function ReverseModal({ ev, user, shift, onNotice, onClose, changed }: { ev: StockEventRow; user: AppUser; shift: Shift | null; onNotice: (m: string) => void; onClose: () => void; changed: () => Promise<void> }) {
  const [reason, setReason] = useState(""), [date, setDate] = useState(localDate()), [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const auth = await authorize(user, "void", `Reverse ${ev.reference}`); // needs the "void" permission or a manager's PIN
    if (!auth.ok) { onNotice("The reversal was not approved."); return; }
    setBusy(true); try { const r = await voidStockEvent(ev.id, date, reason, { userId: user.id, approverId: auth.approverId, shiftId: shift?.id }); onNotice(`${ev.reference} reversed as ${r.reference}.`); await changed(); onClose(); } catch (err) { onNotice(msg(err)); } setBusy(false); }
  return <Modal eyebrow="REVERSE" title={`Reverse ${ev.reference}`} onClose={onClose}>
    <form onSubmit={go}><p style={{ fontSize: 12, color: "#59697a", lineHeight: 1.5 }}>This reverses every ledger entry of this {(KIND_TEXT[ev.kind] ?? ev.kind).toLowerCase()} ({ev.journals || "no journals"}) and puts the stock back. If a customer invoice or supplier bill already has payments, reverse those payments first.</p>
      <label>Reversal date<DateField type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Reason<input value={reason} onChange={e => setReason(e.target.value)} autoFocus placeholder="e.g. customer returned the goods" /></label>
      <button className="primary submit" disabled={busy || !reason.trim()}>{busy ? "Reversing…" : "Reverse"}</button></form>
  </Modal>;
}
