import { db, withTransaction, insertedId, inTx } from "./db.ts";
import type { Conn } from "./db.ts";
import { insertJournal } from "./ledger.ts";
import type { IntegrityCheck } from "./ledger.ts";
import { AP_ACCOUNT, AR_ACCOUNT, CASH_ACCOUNTS, buildAging, documentLines, kindOfDoc, paymentLines, statusOf } from "./partyLogic.ts";
import type { Aging, DocRow, DocType, Party, PartyKind, PaymentRow } from "./partyLogic.ts";
export * from "./partyLogic.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (n: number) => n.toLocaleString("en-US");

export async function initialiseParties() {
  const d = await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS parties(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL CHECK(kind IN ('customer','supplier')),name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',tin TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_kind_name ON parties(kind,name COLLATE NOCASE)");
  await d.execute(`CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT,doc_type TEXT NOT NULL CHECK(doc_type IN ('invoice','bill')),party_id INTEGER NOT NULL REFERENCES parties(id),number TEXT NOT NULL UNIQUE,doc_date TEXT NOT NULL,due_date TEXT NOT NULL,description TEXT NOT NULL,net_tzs INTEGER NOT NULL CHECK(net_tzs>=0),vat_tzs INTEGER NOT NULL CHECK(vat_tzs>=0),total_tzs INTEGER NOT NULL CHECK(total_tzs>0),account_code TEXT NOT NULL,journal_entry_id INTEGER REFERENCES journal_entries(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute(`CREATE TABLE IF NOT EXISTS doc_payments(id INTEGER PRIMARY KEY AUTOINCREMENT,token TEXT NOT NULL UNIQUE,document_id INTEGER NOT NULL REFERENCES documents(id),pay_date TEXT NOT NULL,amount_tzs INTEGER NOT NULL CHECK(amount_tzs>0),account_code TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',journal_entry_id INTEGER REFERENCES journal_entries(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_documents_party ON documents(party_id,doc_type)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_doc_payments_doc ON doc_payments(document_id)");
}

async function audit(event: string, entity: string, id: string | number, details: unknown, conn?: Conn) {
  const d = conn ?? await db();
  await d.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES(?,?,?,?)", [event, entity, String(id), JSON.stringify(details)]);
}

// ---------- customers and suppliers ----------
export type PartyInput = { name: string; phone?: string; email?: string; tin?: string; notes?: string };
function cleanParty(p: PartyInput) {
  const name = p.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter a name.");
  if (name.length > 120) throw new Error("The name is too long (maximum 120 characters).");
  return { name, phone: (p.phone ?? "").trim(), email: (p.email ?? "").trim(), tin: (p.tin ?? "").trim(), notes: (p.notes ?? "").trim() };
}
const friendly = (e: unknown, kind: PartyKind) => (String(e).includes("UNIQUE") ? new Error(`A ${kind} with this name already exists.`) : e);

export async function createParty(kind: PartyKind, input: PartyInput) {
  const p = cleanParty(input), d = await db();
  try { await d.execute("INSERT INTO parties(kind,name,phone,email,tin,notes) VALUES(?,?,?,?,?,?)", [kind, p.name, p.phone, p.email, p.tin, p.notes]); }
  catch (e) { throw friendly(e, kind); }
  const rows = await d.select<Array<{ id: number }>>("SELECT id FROM parties WHERE kind=? AND name=? COLLATE NOCASE", [kind, p.name]);
  await audit("CREATE", "party", rows[0].id, { kind, name: p.name });
  return rows[0].id;
}
export async function updateParty(id: number, kind: PartyKind, input: PartyInput) {
  const p = cleanParty(input), d = await db();
  try { await d.execute("UPDATE parties SET name=?,phone=?,email=?,tin=?,notes=? WHERE id=? AND kind=?", [p.name, p.phone, p.email, p.tin, p.notes, id, kind]); }
  catch (e) { throw friendly(e, kind); }
  await audit("UPDATE", "party", id, { name: p.name });
}
export async function setPartyActive(id: number, active: boolean) {
  const d = await db();
  if (!active) {
    const open = (await getDocuments({ partyId: id })).filter(x => x.status === "open");
    if (open.length) throw new Error("This account still has unpaid documents. Settle them before deactivating.");
  }
  await d.execute("UPDATE parties SET is_active=? WHERE id=?", [active ? 1 : 0, id]);
  await audit(active ? "ACTIVATE" : "DEACTIVATE", "party", id, {});
}

export async function getParties(kind: PartyKind, includeInactive = false): Promise<Party[]> {
  const d = await db();
  return d.select<Party[]>(
    `SELECT p.id,p.kind,p.name,p.phone,p.email,p.tin,p.notes,p.is_active,
      COALESCE((SELECT SUM(x.total_tzs) FROM documents x JOIN journal_entries jx ON jx.id=x.journal_entry_id WHERE x.party_id=p.id AND jx.status='posted'),0)
      -COALESCE((SELECT SUM(y.amount_tzs) FROM doc_payments y JOIN documents x ON x.id=y.document_id JOIN journal_entries jx ON jx.id=x.journal_entry_id JOIN journal_entries jy ON jy.id=y.journal_entry_id
         WHERE x.party_id=p.id AND jx.status='posted' AND jy.status='posted'),0) balance
     FROM parties p WHERE p.kind=? AND (p.is_active=1 OR ?=1) ORDER BY p.name COLLATE NOCASE`, [kind, includeInactive ? 1 : 0]);
}

// ---------- invoices and bills ----------
export async function getDocuments(filter: { docType?: DocType; partyId?: number; id?: number } = {}, conn?: Conn): Promise<DocRow[]> {
  const d = conn ?? await db();
  const where: string[] = [], params: unknown[] = [];
  if (filter.docType) { where.push("x.doc_type=?"); params.push(filter.docType); }
  if (filter.partyId) { where.push("x.party_id=?"); params.push(filter.partyId); }
  if (filter.id) { where.push("x.id=?"); params.push(filter.id); }
  const rows = await d.select<Array<Omit<DocRow, "outstanding_tzs" | "status">>>(
    `SELECT x.id,x.doc_type,x.party_id,p.name party_name,x.number,x.doc_date,x.due_date,x.description,x.net_tzs,x.vat_tzs,x.total_tzs,x.account_code,x.journal_entry_id,
       jd.status journal_status,jd.entry_number journal_number,x.vat_treatment,x.vat_rate,x.amount_includes_vat,
       COALESCE((SELECT SUM(y.amount_tzs) FROM doc_payments y JOIN journal_entries jy ON jy.id=y.journal_entry_id WHERE y.document_id=x.id AND jy.status='posted'),0) paid_tzs
     FROM documents x JOIN parties p ON p.id=x.party_id JOIN journal_entries jd ON jd.id=x.journal_entry_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY x.doc_date DESC,x.id DESC`, params);
  return rows.map(r => ({ ...r, outstanding_tzs: r.journal_status === "reversed" ? 0 : Math.max(0, r.total_tzs - r.paid_tzs), status: statusOf(r.journal_status, r.total_tzs, r.paid_tzs) }));
}
export async function getPayments(documentId: number): Promise<PaymentRow[]> {
  const d = await db();
  return d.select<PaymentRow[]>(`SELECT y.id,y.document_id,y.pay_date,y.amount_tzs,y.account_code,y.reference,y.journal_entry_id,j.status journal_status,j.entry_number
    FROM doc_payments y JOIN journal_entries j ON j.id=y.journal_entry_id WHERE y.document_id=? ORDER BY y.pay_date,y.id`, [documentId]);
}

/** amountTzs is the amount as typed: the VAT-inclusive total when amountIncludesVat is true (the default), otherwise the amount before VAT. */
export type NewDocument = { docType: DocType; partyId: number; docDate: string; dueDate: string; description: string; amountTzs: number; vatRate: number; accountCode: string; vatTreatment?: "none" | "standard" | "zero" | "exempt"; amountIncludesVat?: boolean };
export async function createDocument(input: NewDocument, conn?: Conn) {
  if (!DATE.test(input.docDate) || !DATE.test(input.dueDate)) throw new Error("Enter a valid document date and due date.");
  if (input.dueDate < input.docDate) throw new Error("The due date cannot be before the document date.");
  const description = input.description.trim();
  if (!description) throw new Error("Enter a description.");
  if (description.length > 200) throw new Error("The description is too long (maximum 200 characters).");
  const treatment = input.vatTreatment ?? (input.vatRate > 0 ? "standard" : "zero");
  if (treatment === "standard" && !(input.vatRate > 0)) throw new Error("Enter a VAT rate above 0, or choose zero-rated or exempt.");
  const rate = treatment === "standard" ? input.vatRate : 0;
  const includes = treatment === "standard" ? (input.amountIncludesVat ?? true) : true;
  documentLines(input.docType, input.accountCode, input.amountTzs, rate, "check", includes); // validates amount and VAT rate before touching the database
  return inTx(conn, async d => {
    const party = await d.select<Array<{ id: number; kind: PartyKind; name: string; is_active: number }>>("SELECT id,kind,name,is_active FROM parties WHERE id=?", [input.partyId]);
    if (!party.length || !party[0].is_active) throw new Error("Choose an active " + kindOfDoc(input.docType) + ".");
    if (party[0].kind !== kindOfDoc(input.docType)) throw new Error(`${input.docType === "invoice" ? "An invoice" : "A bill"} must be for a ${kindOfDoc(input.docType)}.`);
    const acct = await d.select<Array<{ code: string; account_type: string }>>("SELECT code,account_type FROM accounts WHERE code=? AND is_active=1", [input.accountCode]);
    const okType = input.docType === "invoice" ? acct[0]?.account_type === "income" : acct[0]?.account_type === "expense" || acct[0]?.code === "1200";
    if (!acct.length || !okType) throw new Error(input.docType === "invoice" ? "Choose an income account for this invoice." : "Choose an expense account (or Inventory) for this bill.");
    const seq = await d.select<Array<{ n: number }>>("SELECT COALESCE(MAX(CAST(SUBSTR(number,INSTR(number,'-')+1) AS INTEGER)),0)+1 AS n FROM documents WHERE doc_type=?", [input.docType]);
    const number = `${input.docType === "invoice" ? "INV" : "BILL"}-${String(seq[0].n).padStart(6, "0")}`;
    const label = `${number} · ${party[0].name} · ${description}`;
    const built = documentLines(input.docType, input.accountCode, input.amountTzs, rate, label, includes);
    const inserted = await d.execute(
      "INSERT INTO documents(doc_type,party_id,number,doc_date,due_date,description,net_tzs,vat_tzs,total_tzs,account_code,vat_treatment,vat_rate,amount_includes_vat) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [input.docType, input.partyId, number, input.docDate, input.dueDate, description, built.net, built.vat, built.gross, input.accountCode, treatment, rate, includes ? 1 : 0]
    );
    const docId = insertedId(inserted, "document");
    const journal = await insertJournal({ date: input.docDate, description: label, sourceType: input.docType, sourceId: String(docId), lines: built.lines }, d);
    await d.execute("UPDATE documents SET journal_entry_id=? WHERE id=?", [journal.id, docId]);
    await audit("CREATE", "document", docId, { number, party: party[0].name, total: built.gross, journal: journal.entryNumber }, d);
    return { id: docId, number, journalNumber: journal.entryNumber, total: built.gross };
  });
}

export type NewPayment = { documentId: number; payDate: string; amountTzs: number; accountCode: string; reference?: string };
export async function recordPayment(input: NewPayment) {
  if (!DATE.test(input.payDate)) throw new Error("Enter a valid payment date.");
  if (!Number.isSafeInteger(input.amountTzs) || input.amountTzs <= 0) throw new Error("Enter the payment amount in whole TZS.");
  if (!CASH_ACCOUNTS.includes(input.accountCode)) throw new Error("Choose cash, bank or mobile money.");
  return withTransaction(async d => {
    const doc = (await getDocuments({ id: input.documentId }, d))[0];
    if (!doc) throw new Error("Document not found.");
    if (doc.status === "void") throw new Error("This document has been reversed and cannot receive payments.");
    if (input.payDate < doc.doc_date) throw new Error(`The payment date cannot be before the document date (${doc.doc_date}).`);
    if (input.amountTzs > doc.outstanding_tzs) throw new Error(`The payment exceeds the outstanding balance of TZS ${fmt(doc.outstanding_tzs)}.`);
    const token = (globalThis.crypto as Crypto).randomUUID();
    const ins = await d.execute("INSERT INTO doc_payments(token,document_id,pay_date,amount_tzs,account_code,reference) VALUES(?,?,?,?,?,?)", [token, doc.id, input.payDate, input.amountTzs, input.accountCode, (input.reference ?? "").trim()]);
    const payId = insertedId(ins, "payment");
    const label = `Payment ${doc.number} · ${doc.party_name}${input.reference?.trim() ? " · " + input.reference.trim() : ""}`;
    const journal = await insertJournal({ date: input.payDate, description: label, sourceType: "payment", sourceId: String(payId), lines: paymentLines(doc.doc_type, input.accountCode, input.amountTzs, label) }, d);
    await d.execute("UPDATE doc_payments SET journal_entry_id=? WHERE id=?", [journal.id, payId]);
    await audit("PAYMENT", "document", doc.id, { number: doc.number, amount: input.amountTzs, journal: journal.entryNumber }, d);
    return { id: payId, journalNumber: journal.entryNumber, remaining: doc.outstanding_tzs - input.amountTzs };
  });
}

// ---------- aging and reconciliation ----------
export async function getAging(docType: DocType, asOf: string): Promise<Aging> {
  return buildAging(await getDocuments({ docType }), asOf);
}
async function controlBalance(code: string) {
  const d = await db();
  const r = await d.select<Array<{ d: number; c: number }>>(`SELECT COALESCE(SUM(l.debit_tzs),0) d,COALESCE(SUM(l.credit_tzs),0) c FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code=? AND j.status IN ('posted','reversed')`, [code]);
  return { debit: r[0]?.d ?? 0, credit: r[0]?.c ?? 0 };
}
export async function reconciliation() {
  const [invoices, bills, ar, ap] = await Promise.all([getDocuments({ docType: "invoice" }), getDocuments({ docType: "bill" }), controlBalance(AR_ACCOUNT), controlBalance(AP_ACCOUNT)]);
  const sum = (x: DocRow[]) => x.reduce((s, r) => s + r.outstanding_tzs, 0);
  const receivablesSub = sum(invoices), payablesSub = sum(bills), receivablesLedger = ar.debit - ar.credit, payablesLedger = ap.credit - ap.debit;
  return { receivablesSub, receivablesLedger, payablesSub, payablesLedger, receivablesOk: receivablesSub === receivablesLedger, payablesOk: payablesSub === payablesLedger };
}
/** Numbers of documents whose posted payments add up to more than the document total. */
export async function overpaidDocuments(): Promise<Array<{ number: string }>> {
  const d = await db();
  return d.select<Array<{ number: string }>>(`SELECT x.number FROM documents x JOIN journal_entries jx ON jx.id=x.journal_entry_id WHERE jx.status='posted'
    AND (SELECT COALESCE(SUM(y.amount_tzs),0) FROM doc_payments y JOIN journal_entries jy ON jy.id=y.journal_entry_id WHERE y.document_id=x.id AND jy.status='posted')>x.total_tzs`);
}
export async function subledgerChecks(): Promise<IntegrityCheck[]> {
  const r = await reconciliation(), out: IntegrityCheck[] = [];
  const diffNote = "Manual journals posted to this account, outside an invoice or bill, cause differences.";
  out.push({ name: "Customer invoices agree with Accounts Receivable (1100)", ok: r.receivablesOk, detail: r.receivablesOk ? `Both total TZS ${fmt(r.receivablesSub)}.` : `Customer balances TZS ${fmt(r.receivablesSub)} vs ledger TZS ${fmt(r.receivablesLedger)}. ${diffNote}` });
  out.push({ name: "Supplier bills agree with Accounts Payable (2000)", ok: r.payablesOk, detail: r.payablesOk ? `Both total TZS ${fmt(r.payablesSub)}.` : `Supplier balances TZS ${fmt(r.payablesSub)} vs ledger TZS ${fmt(r.payablesLedger)}. ${diffNote}` });
  const over = await overpaidDocuments();
  out.push({ name: "No document is overpaid", ok: over.length === 0, detail: over.length ? `Overpaid: ${over.slice(0, 5).map(o => o.number).join(", ")}` : "No overpayments." });
  return out;
}
