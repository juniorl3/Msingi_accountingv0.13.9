import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, FileDown, Printer, Search, Trash2 } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { listItems, sellStock } from "./itemsDb";
import { getFiscalMode, matchFiscalReceipt } from "./fiscalDb";
import { EMPTY_BUF, feedKey, findScanned, parseScan } from "./scanLogic";
import type { Item } from "./itemsDb";
import { fmtQty, lineAmount, toMilli } from "./itemsCalc";
import { getParties, localDate } from "./parties";
import type { Party } from "./parties";
import type { VatPrefs } from "./business";
import { beep, msg } from "./ui";
import DateField from "./DateField";
import { COLS, changeFor, receiptText } from "./receipt";
import { saleGroups, saleTotals, checkSplit } from "./saleCalc";
import CashUp from "./CashUp";
import Returns from "./Returns";
import type { Receipt, ReceiptBusiness } from "./receipt";
import { getReceiptBusiness, loadPrefs, loadRecent, pushRecent, updateRecent, savePrefs, saveReceiptDetails } from "./receiptDb";
import type { PrinterPrefs } from "./receiptDb";
import { openDrawerForSale, printReceipt, receiptAsFile } from "./printReceipt";
import PrinterSettings from "./PrinterSettings";
import { openDrawerNoSale } from "./printerApi";
import NumPad from "./NumPad";
import DiscountDialog, { NO_DISCOUNT } from "./DiscountDialog";
import type { DiscountState } from "./DiscountDialog";
import { computeDiscounts, withinLimit } from "./discountCalc";
import type { DiscountSpec } from "./discountCalc";
import { authorize } from "./authorize";
import { canDiscount, hasPerm } from "./permissions";
import type { AppUser } from "./permissions";
import type { Shift } from "./shiftDb";

type Line = { itemId: number; qty: string; price: string };
const METHODS = ["Cash", "Mobile money", "Bank", "Card"];
type Held = { id: number; at: string; label: string; lines: Line[]; pay: string; customerId: string; ref: string; lineDisc?: Record<number, DiscountSpec>; saleDisc?: DiscountSpec | null; discReason?: string };
const HELD_KEY = "msingi_held_sales";
const loadHeld = (): Held[] => { try { const a = JSON.parse(localStorage.getItem(HELD_KEY) ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
const saveHeld = (h: Held[]) => { try { localStorage.setItem(HELD_KEY, JSON.stringify(h)); } catch { /* storage unavailable: held sales last until the app closes */ } };

type KeypadTarget = { kind: "qty" | "price"; itemId: number } | { kind: "tendered" };
export default function QuickSale({ money, onNotice, onChanged, version, vatPrefs, touchMode = false, user, shift, onOpenShift }: { money: (n: number) => string; onNotice: (m: string) => void; onChanged: () => Promise<void>; version: number; vatPrefs: VatPrefs; touchMode?: boolean; user: AppUser; shift: Shift | null; onOpenShift: () => void }) {
  const [items, setItems] = useState<Item[]>([]), [customers, setCustomers] = useState<Party[]>([]), [q, setQ] = useState(""), [lines, setLines] = useState<Line[]>([]);
  const [pay, setPay] = useState("Cash"), [customerId, setCustomerId] = useState(""), [date, setDate] = useState(localDate()), [ref, setRef] = useState(""), [busy, setBusy] = useState(false), [last, setLast] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const [held, setHeld] = useState<Held[]>(loadHeld), [splitA, setSplitA] = useState({ method: "Cash", amount: "" }), [splitB, setSplitB] = useState("Mobile money");
  const [biz, setBiz] = useState<ReceiptBusiness | null>(null), [det, setDet] = useState({ address: "", phone: "", tin: "", footer: "" });
  const [prefs, setPrefs] = useState<PrinterPrefs>(loadPrefs), [tendered, setTendered] = useState(""), [rc, setRc] = useState<Receipt | null>(null), [recent, setRecent] = useState<Receipt[]>(loadRecent);
  const [keypad, setKeypad] = useState<{ target: KeypadTarget; value: string } | null>(null);
  // On a touchscreen, focusing the search box would pop up the on-screen keyboard after every sale.
  const focusSearch = () => { if (!touchMode) box.current?.focus(); };
  const openKeypad = (target: KeypadTarget, value: string) => setKeypad({ target, value });
  function applyKeypad(value: string) {
    if (!keypad) return;
    const { target } = keypad;
    if (target.kind === "tendered") setTendered(value);
    else setLines(current => current.map(line => line.itemId === target.itemId ? { ...line, [target.kind]: value } : line));
    setKeypad(null);
  }
  const [disc, setDisc] = useState<DiscountState>(NO_DISCOUNT), [discOpen, setDiscOpen] = useState(false), [approval, setApproval] = useState<{ id: number; pct: number } | null>(null);
  useEffect(() => { getReceiptBusiness().then(b => { setBiz(b); setDet({ address: b.address, phone: b.phone, tin: b.tin, footer: b.footer }); }).catch(e => onNotice(msg(e))); }, [version]);
  const updatePrefs = (p: PrinterPrefs) => { setPrefs(p); savePrefs(p); };
  async function saveDetails() { try { await saveReceiptDetails(det); setBiz(await getReceiptBusiness()); onNotice("Receipt details saved."); } catch (e) { onNotice(msg(e)); } }
  async function copyText(r: Receipt) { try { await navigator.clipboard.writeText(receiptText(r, COLS[prefs.paper])); onNotice("Receipt copied. Paste it into WhatsApp, SMS or email."); } catch { onNotice("Could not copy. Use Save file instead."); } }
  async function saveFile(r: Receipt) {
    try { const path = await saveDialog({ defaultPath: `Receipt-${r.number}.html`, filters: [{ name: "Receipt (opens in your browser)", extensions: ["html"] }] }); if (!path) return; await writeTextFile(path, receiptAsFile(r, prefs.paper)); onNotice(`Saved. Open the file to print it from your browser.`); }
    catch (e) { onNotice(msg(e)); }
  }
  const [fiscalOn, setFiscalOn] = useState(false), [fNo, setFNo] = useState(""), [fCode, setFCode] = useState("");
  useEffect(() => { getFiscalMode().then(m => setFiscalOn(m === "record")).catch(() => {}); }, [version]);
  useEffect(() => { Promise.all([listItems(), getParties("customer")]).then(([i, c]) => { setItems(i); setCustomers(c); }).catch(e => onNotice(msg(e))); }, [version]);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const matches = useMemo(() => { const s = q.trim().toLowerCase(); return s ? items.filter(i => [i.name, i.code, i.barcode].join(" ").toLowerCase().includes(s)).slice(0, 8) : []; }, [items, q]);

  function add(i: Item, qty = 1) {
    setLines(cur => cur.some(l => l.itemId === i.id) ? cur.map(l => l.itemId === i.id ? { ...l, qty: String(Math.round(((Number(l.qty) || 0) + qty) * 1000) / 1000) } : l) : [...cur, { itemId: i.id, qty: String(qty), price: String(i.price_tzs) }]);
    setQ(""); focusSearch();
  }
  function onEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return; e.preventDefault();
    const s = q.trim().toLowerCase(); if (!s) return;
    const scan = parseScan(q), exact = scan ? findScanned(items, scan.code) : null;   // a barcode scanner types the code and presses Enter; "3*code" sells 3
    if (exact && scan) { add(exact, scan.qtyMilli / 1000); beep(true); return; }
    const pick = matches[0];
    if (pick) add(pick); else { onNotice(`No item matches "${q.trim()}".`); beep(false); }
  }
  // Barcode scanner: works even when the search box does not have the cursor (for example after tapping a button or on a touchscreen).
  const scanRef = useRef<(raw: string) => void>(() => {});
  scanRef.current = (raw: string) => {
    const s = parseScan(raw); if (!s) return;
    const it = findScanned(items, s.code);
    if (it) { add(it, s.qtyMilli / 1000); setLast(`Scanned ${it.name}`); beep(true); }
    else { onNotice(`Barcode ${s.code} is not in your items. Add it on the Items page.`); beep(false); }
  };
  useEffect(() => {
    let buf = EMPTY_BUF;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null, tag = t?.tagName;
      if (e.ctrlKey || e.metaKey || e.altKey || t === box.current || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.querySelector(".modal-backdrop")) { buf = EMPTY_BUF; return; }
      const r = feedKey(buf, e.key, Date.now()); buf = r.buf;
      if (r.scan) { e.preventDefault(); scanRef.current?.(r.scan); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const calc = lines.map(l => { const it = byId.get(l.itemId)!; try { const qty = toMilli(l.qty), price = Number(l.price.replace(/,/g, "")); return { l, it, qty, price, amount: lineAmount(qty, price), err: "" }; } catch (e) { return { l, it, qty: 0, price: 0, amount: 0, err: msg(e) }; } });
  const sumAmounts = calc.reduce((s, c) => s + c.amount, 0), bad = calc.some(c => c.err || c.amount <= 0);
  // What the customer pays: VAT is added on top of VAT-exclusive prices, exactly as the ledger posts it.
  const hasDisc = disc.saleDisc !== null || Object.keys(disc.lineDisc).length > 0;
  const dRes = !bad && calc.length && hasDisc ? computeDiscounts(calc.map(c => c.amount), calc.map(c => disc.lineDisc[c.l.itemId]), disc.saleDisc) : null;
  const discError = dRes?.error ?? null, discPer = dRes && !dRes.error ? dRes.perLine : calc.map(() => 0), discTotal = discPer.reduce((a, b) => a + b, 0);
  let totals = { net: sumAmounts - discTotal, vat: 0, gross: sumAmounts - discTotal };
  if (!bad && calc.length) { try { totals = saleTotals(saleGroups(calc.map((c, i) => ({ amount: c.amount - discPer[i], service: c.it.kind === "service", treatment: c.it.vat_treatment, priceIncludesVat: !!c.it.price_includes_vat })), vatPrefs.vatRegistered, vatPrefs.rate)); } catch { /* shown as the plain sum until the line errors are fixed */ } }
  const total = totals.gross;
  const splitAmt = Number(splitA.amount.replace(/,/g, "")), splitPays = [{ method: splitA.method, amount: splitAmt }, { method: splitB, amount: total - splitAmt }];
  const splitError = pay === "split" && calc.length && !bad ? checkSplit(splitPays, total) : null;
  const cashGiven = pay === "Cash" && tendered.trim() !== "" ? changeFor(total, Number(tendered.replace(/,/g, ""))) : null;
  const setLine = (id: number, k: "qty" | "price", v: string) => setLines(lines.map(l => (l.itemId === id ? { ...l, [k]: v } : l)));

  function holdSale() {
    if (!lines.length) return;
    const n = held.reduce((m, h) => Math.max(m, h.id), 0) + 1, names = lines.map(l => byId.get(l.itemId)?.name ?? "item");
    const next = [...held, { id: n, at: new Date().toTimeString().slice(0, 5), label: `Sale ${n}: ${names.slice(0, 2).join(", ")}${names.length > 2 ? "…" : ""}`, lines, pay, customerId, ref, lineDisc: disc.lineDisc, saleDisc: disc.saleDisc, discReason: disc.reason }];
    setHeld(next); saveHeld(next); setLines([]); setRef(""); setTendered(""); setDisc(NO_DISCOUNT); setApproval(null); onNotice("Sale held. Resume it from the list below the Payment panel."); focusSearch();
  }
  function resumeSale(h: Held) {
    if (lines.length) { onNotice("Finish or hold the current sale before resuming another."); return; }
    const ok = h.lines.filter(l => byId.has(l.itemId));
    if (ok.length < h.lines.length) onNotice("Some items on that sale no longer exist and were left out.");
    setLines(ok); setPay(h.pay === "split" ? "Cash" : h.pay); setCustomerId(h.customerId); setRef(h.ref); setDisc({ lineDisc: h.lineDisc ?? {}, saleDisc: h.saleDisc ?? null, reason: h.discReason ?? "" }); setApproval(null);
    const next = held.filter(x => x.id !== h.id); setHeld(next); saveHeld(next); focusSearch();
  }
  async function noSaleDrawer() {
    const auth = await authorize(user, "drawer", "Open the cash drawer without a sale"); // a manager's PIN is needed without the permission
    if (!auth.ok) { onNotice("Opening the drawer was not approved."); return; }
    try { await openDrawerNoSale(prefs, { userId: user.id, approverId: auth.approverId, shiftId: shift?.id }); } catch (e) { onNotice(msg(e)); }
  }
  async function complete() {
    if (cashGiven && "error" in cashGiven) { onNotice(cashGiven.error); return; }
    if (splitError) { onNotice(splitError); return; }
    if (!shift) { onNotice("Open your shift before completing a sale."); return; }
    if (discError) { onNotice(discError); return; }
    // A discount above this user's limit (or without the permission) needs a manager's PIN.
    let approverId: number | undefined;
    if (discTotal > 0) {
      const pct = Math.ceil((discTotal * 10000) / sumAmounts) / 100;
      if (!canDiscount(user, pct)) {
        if (approval && withinLimit(discTotal, sumAmounts, approval.pct)) approverId = approval.id;
        else {
          const a = await authorize(user, "discount", `Discount of ${money(discTotal)} (${pct}%)`, pct);
          if (!a.ok) { onNotice("The discount was not approved."); return; }
          approverId = a.approverId; setApproval(a.approverId ? { id: a.approverId, pct } : null);
        }
      }
    }
    setBusy(true);
    try {
      const r = await sellStock({ date, paymentMethod: pay === "credit" || pay === "split" ? undefined : pay, payments: pay === "split" ? splitPays : undefined, customerId: pay === "credit" ? Number(customerId) : undefined, reference: ref, vat: { registered: vatPrefs.vatRegistered, rate: vatPrefs.rate },
        lines: calc.map((c, i) => ({ itemId: c.it.id, qtyMilli: c.qty, unitPrice: c.price !== c.it.price_tzs ? c.price : undefined, discountTzs: discPer[i] || undefined })),
        actor: { userId: user.id, approverId, shiftId: shift.id }, discountReason: disc.reason });
      const text = `Sale ${r.reference} recorded: ${money(r.total)}${r.invoices.length ? ` on invoice ${r.invoices.join(", ")}` : ` (${pay})`}.${r.cogs ? ` Cost of goods ${money(r.cogs)}.` : ""}`;
      const b = biz ?? (await getReceiptBusiness());
      const receipt: Receipt = {
        business: b, number: r.reference, date, time: new Date().toTimeString().slice(0, 5),
        lines: calc.map((c, i) => ({ name: c.it.name, qty: fmtQty(c.qty), unitPrice: c.price, amount: c.amount, discount: discPer[i] || undefined })), cashier: user.name,
        total: r.total, vat: r.vat, net: r.net, vatRegistered: vatPrefs.vatRegistered, payment: pay === "credit" ? "Credit" : pay === "split" ? "Split" : pay, ...(pay === "split" ? { payments: splitPays } : {}),
        customer: pay === "credit" ? customers.find(c => String(c.id) === customerId)?.name : undefined, invoice: r.invoices.length ? r.invoices.join(", ") : undefined,
        ...(cashGiven && "change" in cashGiven ? { tendered: Number(tendered.replace(/,/g, "")), change: cashGiven.change } : {}), eventId: r.eventId,
      };
      setFNo(""); setFCode(""); setRc(receipt); setRecent(pushRecent(receipt)); setTendered("");
      if (prefs.autoPrint) printReceipt(receipt, prefs.paper, { drawer: true }); else openDrawerForSale(receipt);
      setLast(text); onNotice(text); setLines([]); setRef(""); setDisc(NO_DISCOUNT); setApproval(null); await onChanged(); focusSearch();
    } catch (e) { onNotice(msg(e)); }
    setBusy(false);
  }
  return <>{!shift && <div className="note" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}><span><b>No open shift.</b> Open your shift with the cash in the drawer before you start selling.</span><button type="button" className="primary" onClick={onOpenShift}>Open shift</button></div>}
  <div className={touchMode ? "touch-sale" : ""} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(280px,1fr)", gap: 17, alignItems: "start" }}>
    <section className="panel">
      <div className="panel-head"><div><h3>Sale</h3><p>Scan a barcode or type a name or code, then press Enter</p></div></div>
      <div className="search" style={{ width: "100%", marginBottom: 6 }}><Search size={16} /><input ref={box} autoFocus={!touchMode} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onEnter} placeholder="Barcode, code or item name" style={{ width: "100%", height: 42, fontSize: 14 }} /></div>
      {touchMode && !q.trim() && <div className="touch-product-grid" aria-label="Quick add products">{items.slice(0, 24).map(i => <button key={i.id} type="button" className="touch-product" onClick={() => add(i)}><b>{i.name}</b><strong>{money(i.price_tzs)}</strong><small>{i.kind === "stock" ? `${fmtQty(i.qty_milli)} ${i.unit} available` : i.kind === "menu" ? "Menu item" : "Service"}</small></button>)}</div>}
      {matches.length > 0 && <div style={{ border: "1px solid #e3e8ee", borderRadius: 9, marginBottom: 12, overflow: "hidden" }}>{matches.map(i => <button key={i.id} type="button" onClick={() => add(i)} style={{ display: "flex", justifyContent: "space-between", width: "100%", padding: "10px 12px", border: 0, borderBottom: "1px solid #f0f2f5", background: "#fff", cursor: "pointer", fontSize: 12, textAlign: "left" }}>
        <span><b>{i.name}</b> <small style={{ color: "#9aa5b2" }}>{i.code}</small></span><span>{money(i.price_tzs)}{i.kind === "stock" && <small style={{ marginLeft: 10, color: i.qty_milli <= 0 ? "#d66c5e" : "#9aa5b2" }}>{fmtQty(i.qty_milli)} {i.unit} in stock</small>}</span></button>)}</div>}
      <div className="table-wrap"><table><thead><tr><th>ITEM</th><th className="right">QTY</th><th className="right">PRICE</th><th className="right">AMOUNT</th><th></th></tr></thead><tbody>
        {calc.map(c => <tr key={c.l.itemId}><td className="description">{c.it.name}<small style={{ display: "block", fontWeight: 400, color: c.err ? "#d66c5e" : "#9aa5b2" }}>{c.err || (c.it.kind === "stock" ? `${fmtQty(c.it.qty_milli)} ${c.it.unit} in stock` : c.it.kind === "menu" ? "Menu item" : "Service")}</small></td>
          <td className="right"><input inputMode="decimal" readOnly={touchMode} onClick={touchMode ? () => openKeypad({ kind: "qty", itemId: c.l.itemId }, c.l.qty) : undefined} value={c.l.qty} onChange={e => setLine(c.l.itemId, "qty", e.target.value)} style={{ width: 70, textAlign: "right" }} /></td>
          <td className="right"><input inputMode="numeric" readOnly={touchMode} onClick={touchMode ? () => openKeypad({ kind: "price", itemId: c.l.itemId }, c.l.price) : undefined} value={c.l.price} onChange={e => setLine(c.l.itemId, "price", e.target.value)} style={{ width: 100, textAlign: "right" }} /></td>
          <td className="right"><b>{money(c.amount)}</b></td><td><button type="button" className="delete" onClick={() => setLines(lines.filter(l => l.itemId !== c.l.itemId))}><Trash2 size={15} /></button></td></tr>)}
        {!calc.length && <tr><td colSpan={5} className="empty">The sale is empty. Scan or search for an item.</td></tr>}
      </tbody></table></div>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h3>Payment</h3><p>{vatPrefs.vatRegistered ? "VAT is recorded from each item's settings." : "This business is not VAT-registered, so no VAT is recorded."}</p></div></div>
      <div style={{ fontSize: 12, color: "#718094" }}>Total to collect</div><div style={{ font: "700 30px var(--ui)", letterSpacing: "-.5px", margin: "2px 0 8px" }}>{money(total)}{totals.vat > 0 && <small style={{ display: "block", font: "500 11px -apple-system,sans-serif", letterSpacing: 0, color: "#8995a3" }}>includes VAT {money(totals.vat)}</small>}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
        <span style={{ fontSize: 12, color: discError ? "#d66c5e" : "#59697a" }}>{discError ?? (discTotal > 0 ? `Discount −${money(discTotal)} (${dRes?.pct}%)${!canDiscount(user, dRes?.pct ?? 0) ? " · needs manager PIN" : ""}` : "")}</span>
        <button type="button" className="secondary" disabled={!calc.length || bad} onClick={() => setDiscOpen(true)}>{hasDisc ? "Edit discount" : "Discount"}</button></div>
      <div className="form-stack" style={{ marginTop: 6 }}>
      <label>Paid by<select value={pay} onChange={e => setPay(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}<option value="split">Split between two methods</option><option value="credit">On credit (invoice a customer)</option></select></label>
      {pay === "split" && <div style={{ display: "grid", gap: 8, margin: "4px 0 8px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><label>First method<select value={splitA.method} onChange={e => setSplitA({ ...splitA, method: e.target.value })}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label><label>Amount (TZS)<input inputMode="numeric" value={splitA.amount} onChange={e => setSplitA({ ...splitA, amount: e.target.value })} /></label></div>
        <label>Second method (the rest: {money(Math.max(0, total - (splitAmt || 0)))})<select value={splitB} onChange={e => setSplitB(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
        {splitError && splitA.amount && <small style={{ color: "#d66c5e" }}>{splitError}</small>}</div>}
      {pay === "credit" && <label>Customer<select value={customerId} onChange={e => setCustomerId(e.target.value)}><option value="">Choose a customer</option>{customers.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {pay === "Cash" && <label>Cash received (optional)<input inputMode="numeric" readOnly={touchMode} onClick={touchMode ? () => openKeypad({ kind: "tendered" }, tendered) : undefined} value={tendered} onChange={e => setTendered(e.target.value)} placeholder={touchMode ? "Tap to enter cash received" : "Type to work out change"} />
        {cashGiven && <small style={{ color: "error" in cashGiven ? "#d66c5e" : "#168a78", fontWeight: 600 }}>{"error" in cashGiven ? cashGiven.error : `Change to give: ${money(cashGiven.change)}`}</small>}</label>}
      <label>Date<DateField type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Receipt or note (optional)<input value={ref} onChange={e => setRef(e.target.value)} /></label>
      </div>
      <button className="primary submit" disabled={busy || !shift || !calc.length || bad || !!discError || (pay === "credit" && !customerId) || !!splitError || (pay === "split" && !splitA.amount)} onClick={complete}>{busy ? "Recording…" : `Complete sale · ${money(total)}`}</button>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="secondary" disabled={!lines.length} onClick={holdSale}>Hold sale</button>
        {prefs.mode !== "system" && <button type="button" className="secondary" onClick={noSaleDrawer}>Open drawer</button>}
        {held.length > 0 && <span style={{ fontSize: 12, color: "#59697a", alignSelf: "center" }}>{held.length} held</span>}</div>
      {held.length > 0 && <div style={{ marginTop: 8, border: "1px solid #e3e8ee", borderRadius: 10 }}>{held.map(h => <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid #f0f2f5", fontSize: 12 }}>
        <span><b>{h.label}</b><small style={{ display: "block", color: "#8995a3" }}>{h.at} · {h.lines.length} item{h.lines.length === 1 ? "" : "s"}</small></span>
        <span style={{ display: "flex", gap: 6 }}><button type="button" className="secondary" onClick={() => resumeSale(h)}>Resume</button><button type="button" className="delete" aria-label="Delete held sale" onClick={() => { const next = held.filter(x => x.id !== h.id); setHeld(next); saveHeld(next); }}><Trash2 size={14} /></button></span></div>)}</div>}
      {last && <div className="note"><b>Last sale</b><span>{last}</span></div>}
      {rc && <div style={{ marginTop: 12, border: "1px solid #e3e8ee", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button type="button" className="primary" onClick={() => printReceipt(rc, prefs.paper)}><Printer size={15} /> Print receipt</button>
          <button type="button" className="secondary" onClick={() => copyText(rc)}><Copy size={14} /> Copy text</button>
          <button type="button" className="secondary" onClick={() => saveFile(rc)}><FileDown size={14} /> Save file</button></div>
        {fiscalOn && rc.eventId !== undefined && !rc.fiscal && <div style={{ display: "grid", gap: 6, margin: "0 0 10px", padding: 10, border: "1px dashed #d9a441", borderRadius: 8 }}>
          <b style={{ fontSize: 12 }}>Fiscal receipt from your EFD/VFD</b>
          <small style={{ color: "#6b7a8c" }}>Issue the fiscal receipt on your approved device, then scan or type its number here to keep it with this sale and print it on the customer receipt. Msingi does not create or check fiscal receipts.</small>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><input value={fNo} onChange={e => setFNo(e.target.value)} placeholder="Fiscal receipt no." style={{ flex: "1 1 160px", height: 38 }} /><input value={fCode} onChange={e => setFCode(e.target.value)} placeholder="Verification code (optional)" style={{ flex: "1 1 160px", height: 38 }} />
            <button type="button" className="primary" disabled={!fNo.trim()} onClick={async () => { try { await matchFiscalReceipt(rc.eventId!, fNo, fCode, user.id); const upd = { ...rc, fiscal: { receiptNo: fNo.trim(), code: fCode.trim() } }; setRc(upd); setRecent(updateRecent(upd)); setFNo(""); setFCode(""); onNotice(`Fiscal receipt ${upd.fiscal.receiptNo} saved with ${rc.number}.`); await onChanged(); } catch (e) { onNotice(msg(e)); } }}>Save</button></div></div>}
        {rc.fiscal && <p style={{ margin: "0 0 8px", fontSize: 12, color: "#168a78" }}>Fiscal receipt no. {rc.fiscal.receiptNo} is attached. Print again to include it.</p>}
        <pre style={{ margin: 0, padding: 10, background: "#f7f9fb", borderRadius: 8, font: "10.5px/1.35 Menlo,Consolas,monospace", overflowX: "auto" }}>{receiptText(rc, COLS[prefs.paper])}</pre></div>}
      <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Receipt &amp; printer settings</summary>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <label>Shop address<input value={det.address} onChange={e => setDet({ ...det, address: e.target.value })} placeholder="Street, area, city" /></label>
          <label>Phone<input value={det.phone} onChange={e => setDet({ ...det, phone: e.target.value })} /></label>
          <label>TIN<input value={det.tin} onChange={e => setDet({ ...det, tin: e.target.value })} /></label>
          <label>Footer message<input value={det.footer} onChange={e => setDet({ ...det, footer: e.target.value })} /></label>
          <button type="button" className="secondary" onClick={saveDetails}>Save receipt details</button>
          <label>Paper width (this computer)<select value={prefs.paper} onChange={e => updatePrefs({ ...prefs, paper: e.target.value === "58" ? "58" : "80" })}><option value="80">80 mm (48 characters)</option><option value="58">58 mm (32 characters)</option></select></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" style={{ width: "auto" }} checked={prefs.autoPrint} onChange={e => updatePrefs({ ...prefs, autoPrint: e.target.checked })} /> Print a receipt automatically after each sale</label>
          <PrinterSettings prefs={prefs} onChange={updatePrefs} onNotice={onNotice} />
          <p style={{ fontSize: 11, color: "#8995a3", margin: 0 }}>In the print dialog, choose your receipt printer and its paper size. Receipts are for the customer only; they are not TRA EFD/VFD fiscal receipts.</p>
          {recent.length > 0 && <div><b style={{ fontSize: 12 }}>Recent receipts</b>{recent.slice(0, 8).map(x => <div key={x.business.name + x.number} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f0f2f5", fontSize: 12 }}>
            <span>{x.number} · {x.date} {x.time} · {money(x.total)}</span><span style={{ display: "flex", gap: 6 }}><button type="button" className="secondary" onClick={() => printReceipt(x, prefs.paper)}><Printer size={13} /></button><button type="button" className="secondary" onClick={() => copyText(x)}><Copy size={13} /></button></span></div>)}</div>}
        </div></details>
    </section>
  </div>
  <Returns money={money} onNotice={onNotice} onChanged={onChanged} version={version} paper={prefs.paper} businessName={biz?.name ?? ""} user={user} shift={shift} />
  {hasPerm(user, "reports") && <CashUp money={money} onNotice={onNotice} paper={prefs.paper} businessName={biz?.name ?? ""} />}
  {keypad && <NumPad title={keypad.target.kind === "tendered" ? "Cash received (whole TZS)" : keypad.target.kind === "qty" ? "Quantity" : "Unit price (whole TZS)"} kind={keypad.target.kind} initial={keypad.value} onCancel={() => setKeypad(null)} onApply={applyKeypad} />}
  {discOpen && <DiscountDialog lines={calc.map(c => ({ id: c.l.itemId, name: c.it.name, amount: c.amount }))} money={money} current={disc} touch={touchMode} onCancel={() => setDiscOpen(false)} onApply={d => { setDisc(d); setApproval(null); setDiscOpen(false); }} />}
  </>;
}
