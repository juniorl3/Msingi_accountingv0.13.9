// VAT settings, schema additions and the VAT return report.
import { db } from "./db.ts";
import { getVatPrefs, setVatPrefs } from "./business.ts";
import type { IntegrityCheck } from "./ledger.ts";

export type VatTreatment = "none" | "standard" | "zero" | "exempt";
export const TREATMENT_LABEL: Record<VatTreatment, string> = { none: "No VAT recorded", standard: "Standard rate", zero: "Zero-rated", exempt: "Exempt" };
const fmt = (n: number) => n.toLocaleString("en-US");

async function hasColumn(table: string, column: string) {
  const d = await db();
  const cols = await d.select<Array<{ name: string }>>(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

/** Adds VAT columns to existing tables and the default-rate setting. Safe to run on every start. */
export async function initialiseVat() {
  const d = await db();
  const adds: Array<[string, string, string]> = [
    ["transactions", "vat_tzs", "INTEGER NOT NULL DEFAULT 0"], ["transactions", "vat_treatment", "TEXT NOT NULL DEFAULT 'none'"], ["transactions", "vat_rate", "REAL NOT NULL DEFAULT 0"],
    ["documents", "vat_treatment", "TEXT NOT NULL DEFAULT 'none'"], ["documents", "vat_rate", "REAL NOT NULL DEFAULT 0"],
    // v0.5.2: whether the user typed the amount including VAT. Everything recorded before this was, so the default is 1.
    ["transactions", "amount_includes_vat", "INTEGER NOT NULL DEFAULT 1"], ["documents", "amount_includes_vat", "INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [table, col, def] of adds) if (!(await hasColumn(table, col))) await d.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  // Documents created in v0.4 that carried VAT were standard-rated.
  await d.execute("UPDATE documents SET vat_treatment='standard' WHERE vat_treatment='none' AND vat_tzs>0");
  await d.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('vat_rate','18')");
}

/** The active business's standard VAT rate. Kept for callers written before VAT preferences became per business. */
export async function getDefaultVatRate(): Promise<number> {
  return (await getVatPrefs()).rate;
}
export async function setDefaultVatRate(rate: number) {
  const current = await getVatPrefs();
  return (await setVatPrefs({ ...current, rate })).rate;
}

// ---------- VAT return ----------
export type VatSide = { opening: number; charged: number; reversed: number; other: number; closing: number };
export type TreatmentRow = { treatment: VatTreatment | "voided"; label: string; count: number; net: number; vat: number };
export type VatLine = { entry_date: string; entry_number: string; status: string; source_type: string; description: string; account_code: string; debit_tzs: number; credit_tzs: number; kind: string };
export type VatReturn = {
  from: string; to: string;
  output: VatSide;   // VAT Payable (2100); charged = VAT on sales, reversed = voided sales (negative)
  input: VatSide;    // VAT Receivable (1300); charged = VAT on purchases, reversed = voided purchases (negative)
  netPeriod: number; // output VAT less input VAT for the period (charged plus reversed)
  netPayableClosing: number; // 2100 closing less 1300 closing
  sales: TreatmentRow[]; purchases: TreatmentRow[];
  lines: VatLine[];
};

async function netMovement(code: string, normal: "credit" | "debit", cmp: "<" | "<=", date: string) {
  const d = await db();
  const sign = normal === "credit" ? "l.credit_tzs-l.debit_tzs" : "l.debit_tzs-l.credit_tzs";
  const r = await d.select<Array<{ n: number }>>(`SELECT COALESCE(SUM(${sign}),0) n FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
    WHERE a.code=? AND j.status IN ('posted','reversed') AND j.entry_date${cmp}?`, [code, date]);
  return r[0]?.n ?? 0;
}

/** Splits one VAT account's period movement into VAT raised by documents, voided documents, and everything else. */
async function side(code: string, normal: "credit" | "debit", sources: [string, string], from: string, to: string): Promise<VatSide> {
  const d = await db();
  const sign = normal === "credit" ? "l.credit_tzs-l.debit_tzs" : "l.debit_tzs-l.credit_tzs";
  const opening = await netMovement(code, normal, "<", from), closing = await netMovement(code, normal, "<=", to);
  const r = await d.select<Array<{ charged: number; reversed: number; total: number }>>(
    `SELECT COALESCE(SUM(CASE WHEN j.source_type IN (?,?) THEN ${sign} ELSE 0 END),0) charged,
            COALESCE(SUM(CASE WHEN (j.source_type='reversal' AND o.source_type IN (?,?)) OR j.source_type='stock_return' OR (j.source_type='reversal' AND o.source_type='stock_return') THEN ${sign} ELSE 0 END),0) reversed,
            COALESCE(SUM(${sign}),0) total
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id LEFT JOIN journal_entries o ON o.id=j.reversed_entry_id
     WHERE a.code=? AND j.status IN ('posted','reversed') AND j.entry_date>=? AND j.entry_date<=?`, [sources[0], sources[1], sources[0], sources[1], code, from, to]);
  const { charged, reversed, total } = r[0] ?? { charged: 0, reversed: 0, total: 0 };
  return { opening, charged, reversed, other: total - charged - reversed, closing };
}

async function byTreatment(kind: "sales" | "purchases", from: string, to: string): Promise<TreatmentRow[]> {
  const d = await db();
  const docType = kind === "sales" ? "invoice" : "bill", txKind = kind === "sales" ? "income" : "expense";
  const docs = await d.select<Array<{ t: VatTreatment; n: number; net: number; vat: number }>>(
    `SELECT x.vat_treatment t,COUNT(*) n,COALESCE(SUM(x.net_tzs),0) net,COALESCE(SUM(x.vat_tzs),0) vat FROM documents x JOIN journal_entries j ON j.id=x.journal_entry_id
     WHERE x.doc_type=? AND j.status IN ('posted','reversed') AND x.doc_date>=? AND x.doc_date<=? GROUP BY x.vat_treatment`, [docType, from, to]);
  const txs = await d.select<Array<{ t: VatTreatment; n: number; net: number; vat: number }>>(
    `SELECT t.vat_treatment t,COUNT(*) n,COALESCE(SUM(t.amount-t.vat_tzs),0) net,COALESCE(SUM(t.vat_tzs),0) vat FROM transactions t
     JOIN journal_entries j ON j.source_type='transaction' AND j.source_id=CAST(t.id AS TEXT) AND j.status IN ('posted','reversed')
     WHERE t.kind=? AND t.category<>'Capital introduced' AND t.date>=? AND t.date<=? GROUP BY t.vat_treatment`, [txKind, from, to]);
  // Documents voided by a reversal dated in this period reduce this period (like a credit note), while the original stays in its own period.
  const voidedDocs = await d.select<Array<{ n: number; net: number; vat: number }>>(
    `SELECT COUNT(*) n,COALESCE(SUM(x.net_tzs),0) net,COALESCE(SUM(x.vat_tzs),0) vat FROM documents x JOIN journal_entries j ON j.id=x.journal_entry_id AND j.status='reversed'
     JOIN journal_entries r ON r.id=j.reversed_entry_id WHERE x.doc_type=? AND r.entry_date>=? AND r.entry_date<=?`, [docType, from, to]);
  const voidedTx = await d.select<Array<{ n: number; net: number; vat: number }>>(
    `SELECT COUNT(*) n,COALESCE(SUM(t.amount-t.vat_tzs),0) net,COALESCE(SUM(t.vat_tzs),0) vat FROM transactions t
     JOIN journal_entries j ON j.source_type='transaction' AND j.source_id=CAST(t.id AS TEXT) AND j.status='reversed' JOIN journal_entries r ON r.id=j.reversed_entry_id
     WHERE t.kind=? AND t.category<>'Capital introduced' AND r.entry_date>=? AND r.entry_date<=?`, [txKind, from, to]);
  const order: VatTreatment[] = ["standard", "zero", "exempt", "none"];
  const rows: TreatmentRow[] = order.map(treatment => {
    const parts = [...docs, ...txs].filter(x => x.t === treatment);
    return { treatment, label: TREATMENT_LABEL[treatment], count: parts.reduce((s, x) => s + x.n, 0), net: parts.reduce((s, x) => s + x.net, 0), vat: parts.reduce((s, x) => s + x.vat, 0) };
  });
  // Refunds of returned goods (v0.7.0) are deductions in the period they are paid, like credit notes.
  const refunds = kind === "sales" ? await d.select<Array<{ n: number; net: number; vat: number }>>(
    `SELECT COUNT(DISTINCT r.return_event_id) n,COALESCE(SUM(r.net_tzs),0) net,COALESCE(SUM(r.vat_tzs),0) vat FROM sale_returns r JOIN stock_events e ON e.id=r.return_event_id
     WHERE e.voided=0 AND e.event_date>=? AND e.event_date<=?`, [from, to]) : [];
  const v = [...voidedDocs, ...voidedTx, ...refunds];
  rows.push({ treatment: "voided", label: "Reversed in this period (deduction)", count: v.reduce((s, x) => s + x.n, 0), net: -v.reduce((s, x) => s + x.net, 0), vat: -v.reduce((s, x) => s + x.vat, 0) });
  return rows;
}

export async function getVatReturn(from: string, to: string): Promise<VatReturn> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Enter valid dates.");
  if (from > to) throw new Error("The start date must not be after the end date.");
  const d = await db();
  const [output, input, sales, purchases] = await Promise.all([side("2100", "credit", ["invoice", "transaction"], from, to), side("1300", "debit", ["bill", "transaction"], from, to), byTreatment("sales", from, to), byTreatment("purchases", from, to)]);
  const lines = await d.select<VatLine[]>(
    `SELECT j.entry_date,j.entry_number,j.status,j.source_type,j.description,a.code account_code,l.debit_tzs,l.credit_tzs,
       CASE WHEN j.source_type='reversal' THEN 'Reversal' WHEN j.source_type='stock_return' THEN 'Refund' WHEN a.code='2100' AND j.source_type IN ('invoice','transaction') THEN 'VAT on sales'
            WHEN a.code='1300' AND j.source_type IN ('bill','transaction') THEN 'VAT on purchases' ELSE 'Payment / adjustment' END kind
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
     WHERE a.code IN ('2100','1300') AND j.status IN ('posted','reversed') AND j.entry_date>=? AND j.entry_date<=? ORDER BY j.entry_date,j.id,l.id`, [from, to]);
  return { from, to, output, input, netPeriod: output.charged + output.reversed - (input.charged + input.reversed), netPayableClosing: output.closing - input.closing, sales, purchases, lines };
}

/** Checks that VAT stored on documents and transactions equals the VAT posted to the ledger. */
export async function vatChecks(): Promise<IntegrityCheck[]> {
  const d = await db();
  const one = async (sql: string) => (await d.select<Array<{ n: number }>>(sql))[0]?.n ?? 0;
  const storedOut = await one(`SELECT COALESCE((SELECT SUM(x.vat_tzs) FROM documents x JOIN journal_entries j ON j.id=x.journal_entry_id WHERE x.doc_type='invoice' AND j.status='posted'),0)
    +COALESCE((SELECT SUM(t.vat_tzs) FROM transactions t JOIN journal_entries j ON j.source_type='transaction' AND j.source_id=CAST(t.id AS TEXT) AND j.status='posted' WHERE t.kind='income'),0) n`);
  const ledgerOut = await one(`SELECT COALESCE(SUM(l.credit_tzs-l.debit_tzs),0) n FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
    WHERE a.code='2100' AND j.status='posted' AND j.source_type IN ('invoice','transaction')`);
  const storedIn = await one(`SELECT COALESCE((SELECT SUM(x.vat_tzs) FROM documents x JOIN journal_entries j ON j.id=x.journal_entry_id WHERE x.doc_type='bill' AND j.status='posted'),0)
    +COALESCE((SELECT SUM(t.vat_tzs) FROM transactions t JOIN journal_entries j ON j.source_type='transaction' AND j.source_id=CAST(t.id AS TEXT) AND j.status='posted' WHERE t.kind='expense'),0) n`);
  const ledgerIn = await one(`SELECT COALESCE(SUM(l.debit_tzs-l.credit_tzs),0) n FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
    WHERE a.code='1300' AND j.status='posted' AND j.source_type IN ('bill','transaction')`);
  return [
    { name: "VAT on sales recorded in invoices and transactions agrees with VAT Payable (2100)", ok: storedOut === ledgerOut, detail: storedOut === ledgerOut ? `Both total TZS ${fmt(storedOut)}.` : `Recorded TZS ${fmt(storedOut)} vs ledger TZS ${fmt(ledgerOut)}.` },
    { name: "VAT on purchases recorded in bills and transactions agrees with VAT Receivable (1300)", ok: storedIn === ledgerIn, detail: storedIn === ledgerIn ? `Both total TZS ${fmt(storedIn)}.` : `Recorded TZS ${fmt(storedIn)} vs ledger TZS ${fmt(ledgerIn)}.` },
  ];
}
