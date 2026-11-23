import { useEffect, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { TREATMENT_LABEL } from "./vatReport";
import type { VatTreatment } from "./vatReport";
import { CASH_ACCOUNTS, createDocument, createParty, getAging, getDocuments, getParties, getPayments, localDate, addDays, postingAccounts, reconciliation, recordPayment, setPartyActive, updateParty } from "./parties";
import type { Aging, DocRow, DocType, Party, PartyKind, PaymentRow } from "./parties";
import { vatFromEntered } from "./vat";
import type { VatPrefs } from "./business";
import { getReconciliationReport } from "./reconcile";
import type { ControlSummary, ReconciliationReport } from "./reconcile";
import type { Account } from "./ledger";
import DateField from "./DateField";

export type RecPage = "customers" | "suppliers" | "invoices" | "bills" | "aging" | "reconcile";
type Common = { accounts: Account[]; money: (n: number) => string; onNotice: (m: string) => void; changed: () => Promise<void>; version: number; vatPrefs: VatPrefs };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STATUS_LABEL = { open: "Open", paid: "Paid", void: "Void (reversed)" } as const;

export default function Receivables({ page, accounts, money, onNotice, onChanged, vatPrefs }: { page: RecPage; accounts: Account[]; money: (n: number) => string; onNotice: (m: string) => void; onChanged: () => Promise<void>; vatPrefs: VatPrefs }) {
  const [version, setVersion] = useState(0);
  const changed = async () => { setVersion(v => v + 1); await onChanged(); };
  const c: Common = { accounts, money, onNotice, changed, version, vatPrefs };
  if (page === "customers") return <PartiesView kind="customer" {...c} />;
  if (page === "suppliers") return <PartiesView kind="supplier" {...c} />;
  if (page === "invoices") return <DocsView docType="invoice" {...c} />;
  if (page === "bills") return <DocsView docType="bill" {...c} />;
  if (page === "reconcile") return <ReconcileView {...c} />;
  return <AgingView {...c} />;
}

function Modal({ eyebrow, title, onClose, children, wide }: { eyebrow: string; title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={"modal" + (wide ? " journal-form-modal" : "")}>
      <div className="modal-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div>
      {children}
    </section></div>;
}

/* ---------- customers / suppliers ---------- */
function PartiesView({ kind, money, onNotice, changed, version, accounts, vatPrefs }: Common & { kind: PartyKind }) {
  const [rows, setRows] = useState<Party[]>([]), [showInactive, setShowInactive] = useState(false), [edit, setEdit] = useState<Party | "new" | null>(null), [open, setOpen] = useState<Party | null>(null), [q, setQ] = useState("");
  const label = kind === "customer" ? "customer" : "supplier";
  useEffect(() => { getParties(kind, showInactive).then(setRows).catch(e => onNotice(msg(e))); }, [kind, showInactive, version]);
  const shown = rows.filter(r => [r.name, r.phone, r.tin, r.email].join(" ").toLowerCase().includes(q.toLowerCase()));
  const total = rows.filter(r => r.is_active).reduce((s, r) => s + r.balance, 0);
  return <section className="panel">
    <div className="panel-head"><div><h3>{kind === "customer" ? "Customers" : "Suppliers"}</h3><p>{kind === "customer" ? "Money customers owe you" : "Money you owe suppliers"}: <b>{money(total)}</b></p></div>
      <div className="table-actions wrap"><div className="search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${label}s`} /></div>
        <label className="filter-date"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive</label>
        <button className="primary" onClick={() => setEdit("new")}><Plus size={16} /> Add {label}</button></div></div>
    <div className="table-wrap"><table><thead><tr><th>NAME</th><th>PHONE</th><th>TIN</th><th className="right">{kind === "customer" ? "OWES YOU" : "YOU OWE"}</th><th></th></tr></thead><tbody>
      {shown.map(p => <tr key={p.id}><td><button className="text-button journal-link" onClick={() => setOpen(p)}>{p.name}</button>{!p.is_active && <span className="type-tag" style={{ marginLeft: 8 }}>inactive</span>}</td><td>{p.phone || "—"}</td><td>{p.tin || "—"}</td><td className="right description">{money(p.balance)}</td><td className="right"><button className="text-button" onClick={() => setEdit(p)}>Edit</button></td></tr>)}
      {!shown.length && <tr><td colSpan={5} className="empty">No {label}s yet. Add one to start recording {kind === "customer" ? "invoices" : "bills"}.</td></tr>}
    </tbody></table></div>
    {edit && <PartyForm kind={kind} party={edit === "new" ? null : edit} onClose={() => setEdit(null)} onNotice={onNotice} changed={changed} />}
    {open && <PartyStatement kind={kind} party={open} money={money} onNotice={onNotice} changed={changed} version={version} accounts={accounts} vatPrefs={vatPrefs} onClose={() => setOpen(null)} />}
  </section>;
}

function PartyForm({ kind, party, onClose, onNotice, changed }: { kind: PartyKind; party: Party | null; onClose: () => void; onNotice: (m: string) => void; changed: () => Promise<void> }) {
  const [f, setF] = useState({ name: party?.name ?? "", phone: party?.phone ?? "", email: party?.email ?? "", tin: party?.tin ?? "", notes: party?.notes ?? "" }), [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { if (party) await updateParty(party.id, kind, f); else await createParty(kind, f); onNotice(`${kind === "customer" ? "Customer" : "Supplier"} saved.`); await changed(); onClose(); }
    catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  async function toggle() { if (!party) return; try { await setPartyActive(party.id, !party.is_active); await changed(); onClose(); } catch (err) { onNotice(msg(err)); } }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return <Modal eyebrow={party ? "EDIT" : "NEW"} title={`${party ? "Edit" : "Add"} ${kind}`} onClose={onClose}>
    <form onSubmit={save}>
      <label>Name<input value={f.name} onChange={set("name")} required autoFocus /></label>
      <label>Phone<input value={f.phone} onChange={set("phone")} /></label>
      <label>Email<input value={f.email} onChange={set("email")} /></label>
      <label>TIN (tax number)<input value={f.tin} onChange={set("tin")} /></label>
      <label>Notes<textarea value={f.notes} onChange={set("notes")} /></label>
      <div className="form-actions">{party ? <button type="button" className="secondary" onClick={toggle}>{party.is_active ? "Deactivate" : "Reactivate"}</button> : <span />}<button className="primary" disabled={busy}>Save {kind}</button></div>
    </form></Modal>;
}

function PartyStatement({ kind, party, onClose, ...c }: Common & { kind: PartyKind; party: Party; onClose: () => void }) {
  const [docs, setDocs] = useState<DocRow[]>([]), [openDoc, setOpenDoc] = useState<number | null>(null);
  useEffect(() => { getDocuments({ partyId: party.id }).then(setDocs).catch(e => c.onNotice(msg(e))); }, [party.id, c.version]);
  const owed = docs.filter(d => d.status === "open").reduce((s, d) => s + d.outstanding_tzs, 0);
  return <Modal wide eyebrow={kind === "customer" ? "CUSTOMER ACCOUNT" : "SUPPLIER ACCOUNT"} title={party.name} onClose={onClose}>
    <div className="journal-meta"><span><b>Phone</b>{party.phone || "—"}</span><span><b>TIN</b>{party.tin || "—"}</span><span><b>{kind === "customer" ? "Owes you" : "You owe"}</b>{c.money(owed)}</span></div>
    <DocTable rows={docs} money={c.money} onOpen={d => setOpenDoc(d.id)} showParty={false} />
    {openDoc !== null && <DocDetail docId={openDoc} {...c} onClose={() => setOpenDoc(null)} />}
  </Modal>;
}

/* ---------- invoices / bills ---------- */
function DocTable({ rows, money, onOpen, showParty = true }: { rows: DocRow[]; money: (n: number) => string; onOpen: (d: DocRow) => void; showParty?: boolean }) {
  const today = localDate();
  return <div className="table-wrap"><table><thead><tr><th>NUMBER</th>{showParty && <th>NAME</th>}<th>DATE</th><th>DUE</th><th className="right">TOTAL</th><th className="right">PAID</th><th className="right">OUTSTANDING</th><th>STATUS</th></tr></thead><tbody>
    {rows.map(d => <tr key={d.id}><td><button className="text-button journal-link" onClick={() => onOpen(d)}>{d.number}</button></td>{showParty && <td>{d.party_name}</td>}<td>{d.doc_date}</td><td>{d.due_date}{d.status === "open" && d.due_date < today && <span className="red-text"> overdue</span>}</td><td className="right">{money(d.total_tzs)}</td><td className="right">{money(d.paid_tzs)}</td><td className="right description">{money(d.outstanding_tzs)}</td><td><span className={d.status === "void" ? "status-reversed" : d.status === "paid" ? "status-ok" : ""}>{STATUS_LABEL[d.status]}</span></td></tr>)}
    {!rows.length && <tr><td colSpan={showParty ? 8 : 7} className="empty">Nothing to show.</td></tr>}
  </tbody></table></div>;
}

function DocsView({ docType, accounts, money, onNotice, changed, version, vatPrefs }: Common & { docType: DocType }) {
  const [rows, setRows] = useState<DocRow[]>([]), [q, setQ] = useState(""), [status, setStatus] = useState("all"), [showNew, setShowNew] = useState(false), [openDoc, setOpenDoc] = useState<number | null>(null);
  const word = docType === "invoice" ? "invoice" : "bill";
  useEffect(() => { getDocuments({ docType }).then(setRows).catch(e => onNotice(msg(e))); }, [docType, version]);
  const shown = rows.filter(r => [r.number, r.party_name, r.description].join(" ").toLowerCase().includes(q.toLowerCase()) && (status === "all" || r.status === status));
  const outstanding = rows.reduce((s, r) => s + r.outstanding_tzs, 0);
  return <section className="panel">
    <div className="panel-head"><div><h3>{docType === "invoice" ? "Sales invoices" : "Supplier bills"}</h3><p>{rows.length} documents · outstanding <b>{money(outstanding)}</b></p></div>
      <div className="table-actions wrap"><div className="search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number, name, description" /></div>
        <select className="inline-select" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="paid">Paid</option><option value="void">Void</option></select>
        <button className="primary" onClick={() => setShowNew(true)}><Plus size={16} /> New {word}</button></div></div>
    <DocTable rows={shown} money={money} onOpen={d => setOpenDoc(d.id)} />
    {showNew && <NewDocModal docType={docType} accounts={accounts} money={money} onNotice={onNotice} changed={changed} version={version} vatPrefs={vatPrefs} onClose={() => setShowNew(false)} />}
    {openDoc !== null && <DocDetail docId={openDoc} accounts={accounts} money={money} onNotice={onNotice} changed={changed} version={version} vatPrefs={vatPrefs} onClose={() => setOpenDoc(null)} />}
  </section>;
}

function NewDocModal({ docType, accounts, onClose, onNotice, changed, vatPrefs }: Common & { docType: DocType; onClose: () => void }) {
  const kind: PartyKind = docType === "invoice" ? "customer" : "supplier";
  const postable = postingAccounts(accounts, docType);
  const [parties, setParties] = useState<Party[]>([]), [busy, setBusy] = useState(false);
  const [f, setF] = useState({ partyId: "", docDate: localDate(), dueDate: localDate(30), description: "", amount: "", rate: String(vatPrefs.rate), includes: vatPrefs.amountIncludesVat, treatment: vatPrefs.docTreatment as "none" | "standard" | "zero" | "exempt", account: docType === "invoice" ? "4000" : "6900" });
  useEffect(() => { getParties(kind).then(p => { setParties(p); if (p.length) setF(x => ({ ...x, partyId: String(p[0].id) })); }).catch(e => onNotice(msg(e))); }, []);
  let preview: { net: number; vat: number; gross: number } | null = null;
  try { const g = Number(f.amount); if (g > 0) preview = f.treatment === "standard" ? vatFromEntered(g, Number(f.rate), f.includes) : { net: g, vat: 0, gross: g }; } catch { preview = null; }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await createDocument({ docType, partyId: Number(f.partyId), docDate: f.docDate, dueDate: f.dueDate, description: f.description, amountTzs: Number(f.amount), vatRate: f.treatment === "standard" ? Number(f.rate) : 0, vatTreatment: f.treatment, amountIncludesVat: f.includes, accountCode: f.account });
      onNotice(`${r.number} posted to the ledger as ${r.journalNumber}.`); await changed(); onClose();
    } catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  const set = (k: Exclude<keyof typeof f, "includes">) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const money = (n: number) => "TZS " + n.toLocaleString("en-US");
  return <Modal eyebrow="DOUBLE-ENTRY POSTING" title={docType === "invoice" ? "New sales invoice" : "New supplier bill"} onClose={onClose}>
    {!parties.length ? <div className="note"><b>No {kind}s yet</b><span>Add a {kind} first (under {kind === "customer" ? "Customers" : "Suppliers"}), then come back to create the {docType}.</span></div> :
      <form onSubmit={save}>
        <label>{kind === "customer" ? "Customer" : "Supplier"}<select value={f.partyId} onChange={set("partyId")}>{parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="two-col" style={{ gridTemplateColumns: "1fr 1fr" }}><label>{docType === "invoice" ? "Invoice date" : "Bill date"}<DateField type="date" value={f.docDate} onChange={set("docDate")} required /></label><label>Due date<DateField type="date" value={f.dueDate} onChange={set("dueDate")} required /></label></div>
        <label>Description<input value={f.description} onChange={set("description")} placeholder={docType === "invoice" ? "e.g. Consulting, October" : "e.g. Office stationery"} required /></label>
        {vatPrefs.vatRegistered && <label>VAT treatment<select value={f.treatment} onChange={e => setF({ ...f, treatment: e.target.value as "standard" | "zero" | "exempt" })}><option value="standard">Standard rate</option><option value="zero">Zero-rated (0% VAT)</option><option value="exempt">Exempt (no VAT)</option></select></label>}
        {f.treatment === "standard" && <label className="check-label"><input type="checkbox" checked={f.includes} onChange={e => setF({ ...f, includes: e.target.checked })} /><span><b>Amount includes VAT</b><small>{f.includes ? "The amount is the total. VAT is taken out of it." : "The amount is before VAT. VAT is added on top."}</small></span></label>}
        <div className="two-col" style={{ gridTemplateColumns: f.treatment === "standard" ? "1fr 120px" : "1fr" }}><label>{f.treatment === "standard" ? (f.includes ? "Total including VAT (TZS)" : "Amount excluding VAT (TZS)") : "Total (TZS)"}<input type="number" min="1" step="1" value={f.amount} onChange={set("amount")} required /></label>{f.treatment === "standard" && <label>VAT rate %<input type="number" min="0.01" max="99" step="0.01" value={f.rate} onChange={set("rate")} required /></label>}</div>
        <label>{docType === "invoice" ? "Income account" : "Expense account"}<select value={f.account} onChange={set("account")}>{postable.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
        <div className="note"><b>What will be posted</b><span>{preview ? (docType === "invoice"
          ? `Receivable ${money(preview.gross)} = income ${money(preview.net)} + VAT payable ${money(preview.vat)}`
          : `Expense ${money(preview.net)} + VAT recoverable ${money(preview.vat)} = payable ${money(preview.gross)}`) : "Enter the amount to see the breakdown."} The defaults come from Settings; confirm the correct rate and treatment with your tax adviser or TRA.</span></div>
        <button className="primary submit" disabled={busy}>Post {docType} to ledger</button>
      </form>}
  </Modal>;
}

function DocDetail({ docId, onClose, money, accounts, onNotice, changed, version }: Common & { docId: number; onClose: () => void }) {
  const [doc, setDoc] = useState<DocRow | null>(null), [pays, setPays] = useState<PaymentRow[]>([]), [showPay, setShowPay] = useState(false), [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
  const [pf, setPf] = useState({ date: localDate(), amount: "", account: "1000", reference: "" });
  useEffect(() => { (async () => { const all = await getDocuments(); const d = all.find(x => x.id === docId) ?? null; setDoc(d); setPays(await getPayments(docId)); if (d) setPf(x => ({ ...x, amount: String(d.outstanding_tzs || "") })); })().catch(e => onNotice(msg(e))); }, [docId, version, tick]);
  if (!doc) return null;
  const isInv = doc.doc_type === "invoice";
  async function pay(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const r = await recordPayment({ documentId: docId, payDate: pf.date, amountTzs: Number(pf.amount), accountCode: pf.account, reference: pf.reference }); onNotice(`Payment posted as ${r.journalNumber}. Remaining: ${money(r.remaining)}.`); setShowPay(false); setTick(t => t + 1); await changed(); }
    catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  return <Modal wide eyebrow={isInv ? "SALES INVOICE" : "SUPPLIER BILL"} title={doc.number} onClose={onClose}>
    <div className="journal-meta"><span><b>{isInv ? "Customer" : "Supplier"}</b>{doc.party_name}</span><span><b>Date / due</b>{doc.doc_date} → {doc.due_date}</span><span><b>Status</b>{STATUS_LABEL[doc.status]}</span><span><b>Ledger entry</b>{doc.journal_number}</span><span><b>VAT treatment</b>{TREATMENT_LABEL[doc.vat_treatment as VatTreatment] ?? doc.vat_treatment}{doc.vat_treatment === "standard" ? ` (${doc.vat_rate}%, entered ${doc.amount_includes_vat === 0 ? "excluding" : "including"} VAT)` : ""}</span><span><b>Description</b>{doc.description}</span></div>
    <div className="table-wrap"><table><tbody>
      <tr><td>{isInv ? "Amount before VAT" : "Cost before VAT"}</td><td className="right">{money(doc.net_tzs)}</td></tr>
      <tr><td>{isInv ? "VAT payable" : "VAT recoverable"}</td><td className="right">{money(doc.vat_tzs)}</td></tr>
      <tr><td><b>Total</b></td><td className="right"><b>{money(doc.total_tzs)}</b></td></tr>
      <tr><td>Paid</td><td className="right">{money(doc.paid_tzs)}</td></tr>
      <tr><td><b>Outstanding</b></td><td className="right description">{money(doc.outstanding_tzs)}</td></tr>
    </tbody></table></div>
    <h3 style={{ margin: "18px 0 6px", fontSize: 13 }}>Payments</h3>
    <div className="table-wrap"><table><thead><tr><th>DATE</th><th>LEDGER ENTRY</th><th>REFERENCE</th><th className="right">AMOUNT</th><th>STATUS</th></tr></thead><tbody>
      {pays.map(p => <tr key={p.id}><td>{p.pay_date}</td><td>{p.entry_number}</td><td>{p.reference || "—"}</td><td className="right">{money(p.amount_tzs)}</td><td>{p.journal_status === "reversed" ? <span className="status-reversed">reversed</span> : "counted"}</td></tr>)}
      {!pays.length && <tr><td colSpan={5} className="empty">No payments yet.</td></tr>}
    </tbody></table></div>
    {doc.status === "open" && !showPay && <div className="detail-actions"><button className="primary" onClick={() => setShowPay(true)}>{isInv ? "Record payment received" : "Record payment made"}</button></div>}
    {showPay && <form onSubmit={pay} className="template-box" style={{ marginTop: 16 }}>
      <div className="template-fields" style={{ gridTemplateColumns: "1fr 1fr 1.3fr 1.3fr auto" }}>
        <label>Date<DateField type="date" value={pf.date} onChange={e => setPf({ ...pf, date: e.target.value })} required /></label>
        <label>Amount (TZS)<input type="number" min="1" step="1" max={doc.outstanding_tzs} value={pf.amount} onChange={e => setPf({ ...pf, amount: e.target.value })} required /></label>
        <label>{isInv ? "Received into" : "Paid from"}<select value={pf.account} onChange={e => setPf({ ...pf, account: e.target.value })}>{accounts.filter(a => CASH_ACCOUNTS.includes(a.code)).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
        <label>Reference<input value={pf.reference} onChange={e => setPf({ ...pf, reference: e.target.value })} placeholder="Optional" /></label>
        <button className="primary" disabled={busy}>Post payment</button>
      </div></form>}
    <div className="note"><b>Corrections</b><span>Posted documents are never edited or deleted. To cancel this {isInv ? "invoice" : "bill"}, reverse its ledger entry ({doc.journal_number}) under Journal entries. If payments were recorded, reverse their entries first.</span></div>
  </Modal>;
}

/* ---------- aging ---------- */
function AgingView({ money, onNotice, version }: Common) {
  const [asOf] = useState(localDate()), [ar, setAr] = useState<Aging | null>(null), [ap, setAp] = useState<Aging | null>(null), [rec, setRec] = useState<Awaited<ReturnType<typeof reconciliation>> | null>(null);
  useEffect(() => { Promise.all([getAging("invoice", asOf), getAging("bill", asOf), reconciliation()]).then(([a, b, r]) => { setAr(a); setAp(b); setRec(r); }).catch(e => onNotice(msg(e))); }, [version]);
  const table = (title: string, sub: string, a: Aging | null, who: string) => <section className="panel" style={{ marginBottom: 17 }}>
    <div className="panel-head"><div><h3>{title}</h3><p>{sub} · as at {asOf}</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>{who}</th><th className="right">NOT YET DUE</th><th className="right">1–30 DAYS</th><th className="right">31–60 DAYS</th><th className="right">61–90 DAYS</th><th className="right">OVER 90</th><th className="right">TOTAL</th></tr></thead><tbody>
      {a?.rows.map(r => <tr key={r.party_id}><td className="description">{r.party_name}</td><td className="right">{money(r.current)}</td><td className="right">{money(r.d1_30)}</td><td className="right">{money(r.d31_60)}</td><td className="right">{money(r.d61_90)}</td><td className="right red-text">{money(r.d90plus)}</td><td className="right description">{money(r.total)}</td></tr>)}
      {a && !a.rows.length && <tr><td colSpan={7} className="empty">Nothing outstanding.</td></tr>}
    </tbody>{a && <tfoot><tr><th>TOTAL</th><th className="right">{money(a.totals.current)}</th><th className="right">{money(a.totals.d1_30)}</th><th className="right">{money(a.totals.d31_60)}</th><th className="right">{money(a.totals.d61_90)}</th><th className="right">{money(a.totals.d90plus)}</th><th className="right">{money(a.totals.total)}</th></tr></tfoot>}</table></div></section>;
  return <>
    {table("Receivables aging", "Money customers owe you, by how overdue", ar, "CUSTOMER")}
    {table("Payables aging", "Money you owe suppliers, by how overdue", ap, "SUPPLIER")}
    {rec && <section className="panel"><div className="panel-head"><div><h3>Agreement with the ledger</h3><p>Customer and supplier balances should equal the control accounts</p></div></div>
      <div className="check-row"><span className={rec.receivablesOk ? "check-ok" : "check-bad"}>{rec.receivablesOk ? "✓" : "!"}</span><div><b>Receivables: customers {money(rec.receivablesSub)} · Accounts Receivable (1100) {money(rec.receivablesLedger)}</b><small>{rec.receivablesOk ? "Agrees." : "Differs. See Reconciliation for the invoice, payment or journal responsible."}</small></div></div>
      <div className="check-row"><span className={rec.payablesOk ? "check-ok" : "check-bad"}>{rec.payablesOk ? "✓" : "!"}</span><div><b>Payables: suppliers {money(rec.payablesSub)} · Accounts Payable (2000) {money(rec.payablesLedger)}</b><small>{rec.payablesOk ? "Agrees." : "Differs. See Reconciliation for the bill, payment or journal responsible."}</small></div></div></section>}
  </>;
}

/* ---------- reconciliation by reference ---------- */
const KIND_LABEL = { invoice: "Invoice", bill: "Bill", payment: "Payment", transaction: "Transaction", journal: "Journal" } as const;
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
function ReconcileView({ money, onNotice, version }: Common) {
  const [rep, setRep] = useState<ReconciliationReport | null>(null), [kind, setKind] = useState("all");
  useEffect(() => { getReconciliationReport().then(setRep).catch(e => onNotice(msg(e))); }, [version]);
  const items = rep ? rep.items.filter(i => kind === "all" || i.kind === kind) : [];
  const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
  function exportCsv() {
    if (!rep) return;
    const head = ["Reference", "Type", "Ledger entry", "Date", "Description", "Issue", "Per record (TZS)", "In ledger (TZS)", "Difference (TZS)"];
    const rows = rep.items.map(i => [i.reference, KIND_LABEL[i.kind], i.entry, i.date, i.description, i.issue, i.expected, i.actual, i.difference]);
    const csv = [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); a.download = `msingi-reconciliation-${localDate()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  const card = (c: ControlSummary, who: string) => {
    const ok = c.difference === 0 && c.contributors.length === 0;
    return <section className="panel"><div className="panel-head"><div><h3>{c.label} ({c.account})</h3><p>{who} against the ledger</p></div><span className={ok ? "check-ok" : "check-bad"}>{ok ? "✓" : "!"}</span></div>
      <div className="stmt-row"><span>{who}</span><b>{money(c.subledger)}</b></div>
      <div className="stmt-row"><span>{c.label} in the ledger</span><b>{money(c.ledger)}</b></div>
      <div className="stmt-row"><span>Difference</span><b className={c.difference === 0 ? "" : "red-text"}>{c.difference === 0 ? money(0) : signed(c.difference)}</b></div>
      {c.difference !== 0 && <><div className="stmt-row"><span>of which individual documents and payments</span><b>{signed(c.documentDifferences)}</b></div><div className="stmt-row"><span>of which journals posted outside documents</span><b>{signed(c.manualPostings)}</b></div>{c.unexplained !== 0 && <div className="stmt-row"><span>Unexplained</span><b className="red-text">{signed(c.unexplained)}</b></div>}</>}
      {c.difference === 0 && c.contributors.length > 0 && <div className="note"><b>Totals agree, but individual records do not</b><span>Differences cancel each other out: {c.contributors.map(x => `${x.reference} ${signed(x.amount)}`).join(", ")}.</span></div>}
    </section>;
  };
  return <>
    {rep && <div className="report-grid" style={{ marginBottom: 17 }}>{card(rep.receivables, "Customer balances")}{card(rep.payables, "Supplier balances")}</div>}
    <section className="panel"><div className="panel-head"><div><h3>Differences by reference</h3><p>{rep ? `Checked ${rep.checked.documents} invoice/bill(s), ${rep.checked.payments} payment(s) and ${rep.checked.transactions} transaction(s) against their journals` : "Loading…"}</p></div>
      <div className="table-actions wrap"><select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All types</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className="secondary" onClick={exportCsv} disabled={!rep?.items.length}>Export CSV</button></div></div>
      {rep && !rep.items.length ? <div className="check-row"><span className="check-ok">✓</span><div><b>Every record agrees with its ledger entry.</b><small>No differences found by invoice, bill, payment, transaction or journal.</small></div></div> :
        <div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>TYPE</th><th>LEDGER ENTRY</th><th>DATE</th><th>ISSUE</th><th className="right">PER RECORD</th><th className="right">IN LEDGER</th><th className="right">DIFFERENCE</th></tr></thead><tbody>
          {items.map((i, n) => <tr key={n}><td className="description">{i.reference}</td><td>{KIND_LABEL[i.kind]}</td><td>{i.entry || "—"}</td><td>{i.date}</td><td>{i.description}<br /><small>{i.issue}</small></td><td className="right">{money(i.expected)}</td><td className="right">{money(i.actual)}</td><td className="right red-text">{signed(i.difference)}</td></tr>)}
          {rep && !items.length && <tr><td colSpan={8} className="empty">No differences of this type.</td></tr>}
        </tbody></table></div>}
    </section>
  </>;
}
