// Pure logic for customers, suppliers, invoices, bills, payments and aging. No database access.
import { vatFromEntered, VAT_PAYABLE, VAT_RECEIVABLE } from "./vat.ts";
import type { VatSplit } from "./vat.ts";
import type { JournalLineInput } from "./ledger.ts";

export type PartyKind = "customer" | "supplier";
export type DocType = "invoice" | "bill";
export type DocStatus = "open" | "paid" | "void";
export const AR_ACCOUNT = "1100";
export const AP_ACCOUNT = "2000";
export const CASH_ACCOUNTS = ["1000", "1010", "1020"]; // cash, bank, mobile money

export type Party = { id: number; kind: PartyKind; name: string; phone: string; email: string; tin: string; notes: string; is_active: number; balance: number };
export type DocRow = {
  id: number; doc_type: DocType; party_id: number; party_name: string; number: string; doc_date: string; due_date: string; description: string;
  net_tzs: number; vat_tzs: number; total_tzs: number; account_code: string; journal_entry_id: number; journal_status: string; journal_number: string; vat_treatment: string; vat_rate: number; amount_includes_vat: number;
  paid_tzs: number; outstanding_tzs: number; status: DocStatus;
};
export type PaymentRow = { id: number; document_id: number; pay_date: string; amount_tzs: number; account_code: string; reference: string; journal_entry_id: number; journal_status: string; entry_number: string };
export type AgingRow = { party_id: number; party_name: string; current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number };
export type Aging = { asOf: string; rows: AgingRow[]; totals: Omit<AgingRow, "party_id" | "party_name"> };

export const kindOfDoc = (t: DocType): PartyKind => (t === "invoice" ? "customer" : "supplier");

export function statusOf(journalStatus: string, total: number, paid: number): DocStatus {
  if (journalStatus === "reversed") return "void";
  return paid >= total ? "paid" : "open";
}

/** Accounts a user may post a document to: invoices to income accounts; bills to expense accounts or Inventory. */
export function postingAccounts<T extends { code: string; account_type: string }>(accounts: T[], docType: DocType): T[] {
  return accounts.filter(a => (docType === "invoice" ? a.account_type === "income" : a.account_type === "expense" || a.code === "1200"));
}

/**
 * Invoice: Dr Receivables (gross), Cr income (net), Cr VAT Payable. Bill: Dr expense (net), Dr VAT Receivable, Cr Payables (gross).
 * `entered` is the amount as typed; with includesVat (the default) it is the total, otherwise VAT is added on top.
 */
export function documentLines(docType: DocType, accountCode: string, entered: number, vatRate: number, label: string, includesVat = true): { lines: JournalLineInput[]; net: number; vat: number; gross: number } {
  const { net, vat, gross }: VatSplit = vatFromEntered(entered, vatRate, includesVat);
  if (docType === "invoice") {
    const lines: JournalLineInput[] = [{ accountCode: AR_ACCOUNT, debitTzs: gross, description: label }, { accountCode, creditTzs: net, description: label }];
    if (vat > 0) lines.push({ accountCode: VAT_PAYABLE, creditTzs: vat, description: `Output VAT ${vatRate}% · ${label}` });
    return { lines, net, vat, gross };
  }
  const lines: JournalLineInput[] = [{ accountCode, debitTzs: net, description: label }];
  if (vat > 0) lines.push({ accountCode: VAT_RECEIVABLE, debitTzs: vat, description: `Input VAT ${vatRate}% · ${label}` });
  lines.push({ accountCode: AP_ACCOUNT, creditTzs: gross, description: label });
  return { lines, net, vat, gross };
}

/** Customer payment: Dr cash/bank/mobile, Cr Receivables. Supplier payment: Dr Payables, Cr cash/bank/mobile. */
export function paymentLines(docType: DocType, cashCode: string, amount: number, label: string): JournalLineInput[] {
  return docType === "invoice"
    ? [{ accountCode: cashCode, debitTzs: amount, description: label }, { accountCode: AR_ACCOUNT, creditTzs: amount, description: label }]
    : [{ accountCode: AP_ACCOUNT, debitTzs: amount, description: label }, { accountCode: cashCode, creditTzs: amount, description: label }];
}

const dayNumber = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
export const daysOverdue = (dueDate: string, asOf: string) => dayNumber(asOf) - dayNumber(dueDate);
export function localDate(offsetDays = 0) {
  const n = new Date(); n.setDate(n.getDate() + offsetDays);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
export function addDays(iso: string, days: number) { const t = new Date((dayNumber(iso) + days) * 86400000); return t.toISOString().slice(0, 10); }

type Bucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";
export function bucketOf(days: number): Bucket { return days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90plus"; }

/** Groups open documents by party and by how overdue they are as at a date. */
export function buildAging(rows: DocRow[], asOf: string): Aging {
  const byParty = new Map<number, AgingRow>();
  const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
  for (const r of rows) {
    if (r.status !== "open" || r.outstanding_tzs <= 0) continue;
    let row = byParty.get(r.party_id);
    if (!row) { row = { party_id: r.party_id, party_name: r.party_name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 }; byParty.set(r.party_id, row); }
    const b = bucketOf(daysOverdue(r.due_date, asOf));
    row[b] += r.outstanding_tzs; row.total += r.outstanding_tzs; totals[b] += r.outstanding_tzs; totals.total += r.outstanding_tzs;
  }
  return { asOf, rows: [...byParty.values()].sort((a, b) => b.total - a.total || a.party_name.localeCompare(b.party_name)), totals };
}
