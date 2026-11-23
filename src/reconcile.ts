// Reconciliation by reference.
//
// The aggregate checks only say "customers total X but Accounts Receivable holds Y". This module says which
// invoice, bill, payment, transaction or manual journal is responsible, using its own number (INV-000004,
// BILL-000012, TXN-000031, JE-000045) so the difference can be found and corrected.
//
// buildReconciliation() is pure (no database access) so it can be tested directly; getReconciliationReport()
// fetches the rows it needs.
import { db } from "./db.ts";
import { cashAccountFor } from "./ledger.ts";
import { getDocuments, overpaidDocuments } from "./parties.ts";
import type { IntegrityCheck } from "./ledger.ts";
import type { DocRow, DocType } from "./partyLogic.ts";

export type ReconKind = "invoice" | "bill" | "payment" | "transaction" | "journal";
export type ReconItem = {
  kind: ReconKind;
  reference: string;        // INV-000004, BILL-000012, "Payment of INV-000004", TXN-000031 or JE-000045
  entry: string;            // ledger journal number holding the posting ("" if none)
  date: string;
  description: string;
  issue: string;
  expected: number;         // what the record says
  actual: number;           // what the ledger holds
  difference: number;       // actual - expected
};
export type ControlSummary = {
  account: string; label: string;
  subledger: number;        // total of the customer / supplier balances
  ledger: number;           // balance of the control account
  difference: number;       // ledger - subledger
  documentDifferences: number; // part of the difference caused by individual invoices / bills / payments
  manualPostings: number;   // part caused by journals posted straight to the control account
  unexplained: number;      // anything left (should always be 0)
  contributors: Array<{ reference: string; amount: number }>; // references behind the difference, with their part of it
};
export type ReconciliationReport = {
  receivables: ControlSummary; payables: ControlSummary;
  items: ReconItem[];
  checked: { documents: number; payments: number; transactions: number };
};

export type LineSum = { code: string; debit: number; credit: number };
export type ControlLine = {
  entry_number: string; entry_date: string; description: string; source_type: string; source_id: string | null;
  o_entry: string | null; o_date: string | null; o_description: string | null; o_type: string | null; o_id: string | null; // the journal a reversal reverses
  debit: number; credit: number;
};
export type PaymentCheckRow = { id: number; document_id: number; doc_number: string; amount_tzs: number; pay_date: string; entry_number: string | null; control_amount: number };
export type TxCheckRow = { id: number; date: string; kind: "income" | "expense"; category: string; description: string; reference: string | null; amount: number; vat_tzs: number; payment_method: string; entry_number: string | null };
export type NoJournalDoc = { id: number; number: string; doc_type: DocType; doc_date: string; description: string; total_tzs: number };
export type ReconInput = {
  docs: DocRow[]; docsWithoutJournal: NoJournalDoc[];
  docLines: Array<LineSum & { doc_id: number }>;
  payments: PaymentCheckRow[];
  txs: TxCheckRow[]; txLines: Array<LineSum & { tx_id: number }>;
  control: { "1100": ControlLine[]; "2000": ControlLine[] };
};

export const txReference = (id: number) => `TXN-${String(id).padStart(6, "0")}`;
const fmt = (n: number) => n.toLocaleString("en-US");
const CONTROL = { invoice: { control: "1100", vat: "2100", name: "Accounts Receivable" }, bill: { control: "2000", vat: "1300", name: "Accounts Payable" } } as const;
const SOURCE_LABEL: Record<string, string> = { manual: "a manual journal", transaction: "a transaction", reversal: "a reversal", invoice: "an invoice", bill: "a bill", payment: "a payment" };

function sumBy(lines: LineSum[]) {
  const m = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) { const x = m.get(l.code) ?? { debit: 0, credit: 0 }; x.debit += l.debit; x.credit += l.credit; m.set(l.code, x); }
  return m;
}

export function buildReconciliation(input: ReconInput): ReconciliationReport {
  const items: ReconItem[] = [];
  const add = (i: Omit<ReconItem, "difference">) => items.push({ ...i, difference: i.actual - i.expected });
  const docById = new Map(input.docs.map(d => [d.id, d]));
  const payDoc = new Map(input.payments.map(p => [p.id, p.document_id]));

  // ---- 1. each invoice / bill against its own journal ----
  const docLines = new Map<number, LineSum[]>();
  for (const l of input.docLines) { const a = docLines.get(l.doc_id) ?? []; a.push(l); docLines.set(l.doc_id, a); }
  const flaggedDocs = new Set<number>();
  for (const x of input.docsWithoutJournal) {
    flaggedDocs.add(x.id);
    add({ kind: x.doc_type, reference: x.number, entry: "", date: x.doc_date, description: x.description, issue: "Not posted to the ledger (no journal entry is linked).", expected: x.total_tzs, actual: 0 });
  }
  for (const d of input.docs) {
    const c = CONTROL[d.doc_type], m = sumBy(docLines.get(d.id) ?? []), isInv = d.doc_type === "invoice";
    const pick = (code: string, side: "debit" | "credit") => m.get(code)?.[side] ?? 0;
    const controlAmt = isInv ? pick(c.control, "debit") : pick(c.control, "credit");
    const vatAmt = isInv ? pick(c.vat, "credit") : pick(c.vat, "debit");
    let mainAmt = 0; for (const [code, v] of m) if (code !== c.control && code !== c.vat) mainAmt += isInv ? v.credit : v.debit;
    const base = { kind: d.doc_type, reference: d.number, entry: d.journal_number, date: d.doc_date, description: `${d.party_name} · ${d.description}` } as const;
    const before = items.length;
    if (d.net_tzs + d.vat_tzs !== d.total_tzs) add({ ...base, issue: `Record does not add up: amount before VAT ${fmt(d.net_tzs)} + VAT ${fmt(d.vat_tzs)} is not the total.`, expected: d.total_tzs, actual: d.net_tzs + d.vat_tzs });
    if (controlAmt !== d.total_tzs) add({ ...base, issue: `${c.name} (${c.control}) posting differs from the ${d.doc_type} total.`, expected: d.total_tzs, actual: controlAmt });
    if (vatAmt !== d.vat_tzs) add({ ...base, issue: `VAT posting (${c.vat}) differs from the VAT recorded on the ${d.doc_type}.`, expected: d.vat_tzs, actual: vatAmt });
    if (mainAmt !== d.net_tzs) add({ ...base, issue: `${isInv ? "Income" : "Expense"} posting (${d.account_code}) differs from the amount before VAT.`, expected: d.net_tzs, actual: mainAmt });
    if (items.length > before) flaggedDocs.add(d.id);
  }

  // ---- 2. each payment against its own journal ----
  const flaggedPayDocs = new Set<number>();
  for (const p of input.payments) {
    const base = { kind: "payment", reference: `Payment of ${p.doc_number}`, entry: p.entry_number ?? "", date: p.pay_date, description: `Payment #${p.id}` } as const;
    if (!p.entry_number) { add({ ...base, issue: "Not posted to the ledger (no journal entry is linked).", expected: p.amount_tzs, actual: 0 }); flaggedPayDocs.add(p.document_id); }
    else if (p.control_amount !== p.amount_tzs) { add({ ...base, issue: "Receivable / payable posting differs from the payment amount.", expected: p.amount_tzs, actual: p.control_amount }); flaggedPayDocs.add(p.document_id); }
  }

  // ---- 3. each transaction against its own journal ----
  const txLines = new Map<number, LineSum[]>();
  for (const l of input.txLines) { const a = txLines.get(l.tx_id) ?? []; a.push(l); txLines.set(l.tx_id, a); }
  for (const t of input.txs) {
    const ref = txReference(t.id), desc = t.reference ? `${t.description} (ref ${t.reference})` : t.description;
    const base = { kind: "transaction", reference: ref, entry: t.entry_number ?? "", date: t.date, description: desc } as const;
    if (!t.entry_number) { add({ ...base, issue: "Not posted to the ledger (no journal entry is linked).", expected: t.amount, actual: 0 }); continue; }
    const inc = t.kind === "income", cash = cashAccountFor(t.payment_method), vatCode = inc ? "2100" : "1300", m = sumBy(txLines.get(t.id) ?? []);
    const cashAmt = inc ? m.get(cash)?.debit ?? 0 : m.get(cash)?.credit ?? 0;
    const vatAmt = inc ? m.get(vatCode)?.credit ?? 0 : m.get(vatCode)?.debit ?? 0;
    let other = 0; for (const [code, v] of m) if (code !== cash && code !== vatCode) other += inc ? v.credit : v.debit;
    if (cashAmt !== t.amount) add({ ...base, issue: `${t.payment_method} posting differs from the transaction amount.`, expected: t.amount, actual: cashAmt });
    if (vatAmt !== t.vat_tzs) add({ ...base, issue: `VAT posting (${vatCode}) differs from the VAT recorded on the transaction.`, expected: t.vat_tzs, actual: vatAmt });
    if (other !== t.amount - t.vat_tzs) add({ ...base, issue: `${inc ? "Income" : "Expense"} posting differs from the amount before VAT.`, expected: t.amount - t.vat_tzs, actual: other });
  }

  // ---- 4. control accounts: attribute every ledger line to a document, or to a journal posted outside one ----
  const summarise = (type: DocType): ControlSummary => {
    const c = CONTROL[type], normalDebit = type === "invoice";
    const docs = input.docs.filter(d => d.doc_type === type);
    const subledger = docs.reduce((s, d) => s + d.outstanding_tzs, 0);
    const perDoc = new Map<number, number>();
    const manual = new Map<string, { date: string; description: string; source: string; amount: number }>();
    let ledger = 0;
    for (const l of input.control[c.control]) {
      const amount = normalDebit ? l.debit - l.credit : l.credit - l.debit;
      ledger += amount;
      // A reversal belongs wherever the journal it reverses belongs.
      const isRev = l.source_type === "reversal" && l.o_entry !== null;
      const srcType = isRev ? l.o_type : l.source_type, srcId = isRev ? l.o_id : l.source_id;
      let docId: number | null = null;
      if (srcType === type) docId = Number(srcId);
      else if (srcType === "payment") docId = payDoc.get(Number(srcId)) ?? null;
      if (docId !== null && docById.get(docId)?.doc_type === type) { perDoc.set(docId, (perDoc.get(docId) ?? 0) + amount); continue; }
      const entry = isRev ? l.o_entry! : l.entry_number;
      const row = manual.get(entry) ?? { date: isRev ? l.o_date ?? l.entry_date : l.entry_date, description: isRev ? l.o_description ?? l.description : l.description, source: SOURCE_LABEL[srcType ?? "manual"] ?? "an unknown source", amount: 0 };
      row.amount += amount; manual.set(entry, row);
    }
    let documentDifferences = 0;
    const contributors: Array<{ reference: string; amount: number }> = [];
    for (const d of docs) {
      const led = perDoc.get(d.id) ?? 0, diff = led - d.outstanding_tzs;
      documentDifferences += diff;
      if (diff !== 0) contributors.push({ reference: d.number, amount: diff });
      // Only add a balance-level line when the amount-level checks above have not already named this document.
      if (diff !== 0 && !flaggedDocs.has(d.id) && !flaggedPayDocs.has(d.id))
        add({ kind: type, reference: d.number, entry: d.journal_number, date: d.doc_date, description: `${d.party_name} · ${d.description}`, issue: `Outstanding balance on the ${type} differs from the ledger postings for it (including its payments and reversals).`, expected: d.outstanding_tzs, actual: led });
    }
    let manualPostings = 0;
    for (const [entry, r] of manual) {
      if (r.amount === 0) continue; // a journal and its reversal cancel out
      manualPostings += r.amount;
      contributors.push({ reference: entry, amount: r.amount });
      add({ kind: "journal", reference: entry, entry, date: r.date, description: r.description, issue: `Posted to ${c.name} (${c.control}) by ${r.source}, not through an ${type} or its payment. It is in the ledger but in no ${type === "invoice" ? "customer" : "supplier"} balance.`, expected: 0, actual: r.amount });
    }
    const difference = ledger - subledger;
    return { account: c.control, label: c.name, subledger, ledger, difference, documentDifferences, manualPostings, unexplained: difference - documentDifferences - manualPostings, contributors };
  };
  const receivables = summarise("invoice"), payables = summarise("bill");

  items.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  return { receivables, payables, items, checked: { documents: input.docs.length + input.docsWithoutJournal.length, payments: input.payments.length, transactions: input.txs.length } };
}

// ---------- database ----------
async function controlLines(code: string): Promise<ControlLine[]> {
  const d = await db();
  return d.select<ControlLine[]>(`SELECT j.entry_number,j.entry_date,j.description,j.source_type,j.source_id,
      o.entry_number o_entry,o.entry_date o_date,o.description o_description,o.source_type o_type,o.source_id o_id,l.debit_tzs debit,l.credit_tzs credit
    FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
    LEFT JOIN journal_entries o ON j.source_type='reversal' AND o.id=CAST(j.source_id AS INTEGER)
    WHERE a.code=? AND j.status IN ('posted','reversed') ORDER BY j.id,l.id`, [code]);
}

export async function getReconciliationReport(): Promise<ReconciliationReport> {
  const d = await db();
  const docs = await getDocuments();
  const [docsWithoutJournal, docLines, payments, txs, txLines, c1100, c2000] = [
    await d.select<NoJournalDoc[]>("SELECT id,number,doc_type,doc_date,description,total_tzs FROM documents WHERE journal_entry_id IS NULL"),
    await d.select<Array<LineSum & { doc_id: number }>>(`SELECT x.id doc_id,a.code,COALESCE(SUM(l.debit_tzs),0) debit,COALESCE(SUM(l.credit_tzs),0) credit
      FROM documents x JOIN journal_lines l ON l.journal_entry_id=x.journal_entry_id JOIN accounts a ON a.id=l.account_id GROUP BY x.id,a.code`),
    await d.select<PaymentCheckRow[]>(`SELECT y.id,y.document_id,x.number doc_number,y.amount_tzs,y.pay_date,j.entry_number,
        COALESCE(SUM(CASE WHEN a.code IN ('1100','2000') THEN l.debit_tzs+l.credit_tzs ELSE 0 END),0) control_amount
      FROM doc_payments y JOIN documents x ON x.id=y.document_id LEFT JOIN journal_entries j ON j.id=y.journal_entry_id
      LEFT JOIN journal_lines l ON l.journal_entry_id=j.id LEFT JOIN accounts a ON a.id=l.account_id GROUP BY y.id ORDER BY y.id`),
    await d.select<TxCheckRow[]>(`SELECT t.id,t.date,t.kind,t.category,t.description,t.reference,t.amount,t.vat_tzs,t.payment_method,j.entry_number
      FROM transactions t LEFT JOIN journal_entries j ON j.source_type='transaction' AND j.source_id=CAST(t.id AS TEXT) ORDER BY t.id`),
    await d.select<Array<LineSum & { tx_id: number }>>(`SELECT t.id tx_id,a.code,COALESCE(SUM(l.debit_tzs),0) debit,COALESCE(SUM(l.credit_tzs),0) credit
      FROM transactions t JOIN journal_entries j ON j.source_type='transaction' AND j.source_id=CAST(t.id AS TEXT)
      JOIN journal_lines l ON l.journal_entry_id=j.id JOIN accounts a ON a.id=l.account_id GROUP BY t.id,a.code`),
    await controlLines("1100"), await controlLines("2000"),
  ];
  return buildReconciliation({ docs, docsWithoutJournal, docLines, payments, txs, txLines, control: { "1100": c1100, "2000": c2000 } });
}

// ---------- integrity checks (shown on Financial reports) ----------
const signed = (n: number) => `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
const refList = (xs: string[]) => xs.slice(0, 6).join(", ") + (xs.length > 6 ? ` and ${xs.length - 6} more` : "");

export async function reconciliationChecks(): Promise<IntegrityCheck[]> {
  const r = await getReconciliationReport(), out: IntegrityCheck[] = [];
  const control = (c: ControlSummary, name: string, who: string) => {
    const culprits = refList(c.contributors.map(x => `${x.reference} ${signed(x.amount)}`));
    const ok = c.difference === 0 && c.contributors.length === 0; // equal totals can hide errors that cancel out, so individual references count too
    const detail = ok ? `Both total TZS ${fmt(c.subledger)}.`
      : c.difference === 0 ? `Totals agree (TZS ${fmt(c.subledger)}) but individual records differ from the ledger and cancel each other out: ${culprits}.`
      : `${who} TZS ${fmt(c.subledger)} vs ledger TZS ${fmt(c.ledger)} (difference ${signed(c.difference)}). Responsible: ${culprits || "see Reconciliation"}.`;
    out.push({ name, ok, detail });
  };
  control(r.receivables, "Customer invoices agree with Accounts Receivable (1100)", "Customer balances");
  control(r.payables, "Supplier bills agree with Accounts Payable (2000)", "Supplier balances");
  const over = await overpaidDocuments();
  out.push({ name: "No document is overpaid", ok: over.length === 0, detail: over.length ? `Overpaid: ${refList(over.map(o => o.number))}` : "No overpayments." });
  const bad = r.items.filter(i => i.kind !== "journal"), names = [...new Set(bad.map(i => i.reference))];
  out.push({ name: "Every invoice, bill, payment and transaction agrees with its own journal", ok: bad.length === 0, detail: bad.length ? `${names.length} record(s) differ from the ledger: ${refList(names)}. See Reconciliation for each amount.` : `Checked ${r.checked.documents} document(s), ${r.checked.payments} payment(s) and ${r.checked.transactions} transaction(s).` });
  return out;
}
