// Payroll runs: calculate PAYE, social security, SDL and WCF for a month and post one balanced journal.
// Rates are stored per business and can be edited; the defaults come from payrollCalc.ts.
import { db, withTransaction, insertedId } from "./db.ts";
import { getActiveBusiness, getVatPrefs } from "./business.ts";
import { insertJournal, cashAccountFor } from "./ledger.ts";
import { DEFAULT_RATES, computePayroll, payrollJournalLines, validateRates } from "./payrollCalc.ts";
import { employeesByIds } from "./employeeDb.ts";
import { payrollProblem } from "./employeeRules.ts";
import { checkPayrollRecoveries, recordPayrollRecoveries } from "./advanceDb.ts";
import type { EmployeeInput, EmployeeResult, PayrollRates, PayrollTotals } from "./payrollCalc.ts";

const RATES_KEY = "payroll_rates";
export const PAYROLL_LIABILITIES: Array<{ code: string; label: string; authority: string }> = [
  { code: "2120", label: "PAYE", authority: "TRA (Mainland) / ZRB (Zanzibar)" },
  { code: "2130", label: "Skills Development Levy", authority: "TRA / ZRB" },
  { code: "2140", label: "Social security", authority: "NSSF / PSSSF / ZSSF" },
  { code: "2150", label: "WCF", authority: "Workers Compensation Fund" },
];

export type PayrollRun = {
  id: number; period: string; pay_date: string; payment_method: string; jurisdiction: string;
  lines: EmployeeResult[]; totals: PayrollTotals; journal_id: number; entry_number: string; status: string;
};

export async function initialisePayroll() {
  const d = await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS payroll_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,period TEXT NOT NULL,pay_date TEXT NOT NULL,payment_method TEXT NOT NULL,jurisdiction TEXT NOT NULL,rates_json TEXT NOT NULL,lines_json TEXT NOT NULL,totals_json TEXT NOT NULL,journal_id INTEGER NOT NULL REFERENCES journal_entries(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(business_id,period)");
}

export async function getPayrollRates(businessId?: number): Promise<PayrollRates> {
  const biz = businessId ?? (await getActiveBusiness()).id;
  const d = await db();
  const prefs = await getVatPrefs(biz);
  const base = DEFAULT_RATES[prefs.jurisdiction];
  const row = (await d.select<Array<{ value: string }>>("SELECT value FROM business_settings WHERE business_id=? AND key=?", [biz, RATES_KEY]))[0];
  if (!row) return base;
  try {
    const stored = { ...base, ...JSON.parse(row.value) } as PayrollRates;
    return validateRates(stored) ? base : stored;
  } catch { return base; }
}

export async function savePayrollRates(rates: PayrollRates, businessId?: number): Promise<PayrollRates> {
  const problem = validateRates(rates);
  if (problem) throw new Error(problem);
  const biz = businessId ?? (await getActiveBusiness()).id;
  await withTransaction(async tx => {
    await tx.execute("INSERT INTO business_settings(business_id,key,value) VALUES(?,?,?) ON CONFLICT(business_id,key) DO UPDATE SET value=excluded.value", [biz, RATES_KEY, JSON.stringify(rates)]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','payroll_rates',?,?)", [String(biz), JSON.stringify(rates)]);
  });
  return rates;
}

/** Forgets the edited rates so the defaults for the business's jurisdiction apply again. */
export async function resetPayrollRates(businessId?: number): Promise<PayrollRates> {
  const biz = businessId ?? (await getActiveBusiness()).id;
  await withTransaction(async tx => {
    await tx.execute("DELETE FROM business_settings WHERE business_id=? AND key=?", [biz, RATES_KEY]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','payroll_rates',?,?)", [String(biz), JSON.stringify({ reset: true })]);
  });
  return getPayrollRates(biz);
}

export type NewPayrollRun = { period: string; payDate: string; paymentMethod: string; employees: EmployeeInput[]; allowDuplicate?: boolean };

export async function postPayrollRun(input: NewPayrollRun) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error("Choose the payroll month.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payDate)) throw new Error("Enter the pay date.");
  const biz = await getActiveBusiness();
  const prefs = await getVatPrefs(biz.id);
  const rates = await getPayrollRates(biz.id);
  const { lines, totals } = computePayroll(input.employees, rates);
  const pay = cashAccountFor(input.paymentMethod);
  return withTransaction(async tx => {
    // Re-check eligibility on the server side of the UI: registered, this business, monthly-paid, started, not left before the month.
    const ids = input.employees.map(e => e.employeeId).filter((x): x is number => x !== undefined);
    if (ids.length !== input.employees.length) throw new Error("Every payroll line must be a registered employee.");
    const found = await employeesByIds(ids, biz.id, tx);
    for (const id of ids) {
      const emp = found.find(f => f.id === id);
      if (!emp) throw new Error("A selected employee was not found in this business.");
      const problem = payrollProblem(emp, input.period);
      if (problem) throw new Error(problem);
    }
    await checkPayrollRecoveries(tx, biz.id, lines);
    if (!input.allowDuplicate) {
      const dup = await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM payroll_runs r JOIN journal_entries j ON j.id=r.journal_id WHERE r.business_id=? AND r.period=? AND j.status='posted'", [biz.id, input.period]);
      if (dup[0]?.n) throw new Error(`Payroll for ${input.period} has already been posted. Reverse that journal first, or confirm that this is an additional run.`);
    }
    const j = await insertJournal({
      date: input.payDate, description: `Payroll ${input.period} (${lines.length} employee${lines.length === 1 ? "" : "s"})`, sourceType: "payroll", sourceId: input.period,
      lines: payrollJournalLines(totals, pay, input.period).map(l => ({ accountCode: l.accountCode, description: l.description, debitTzs: l.debitTzs, creditTzs: l.creditTzs })),
    }, tx);
    const ins = await tx.execute("INSERT INTO payroll_runs(business_id,period,pay_date,payment_method,jurisdiction,rates_json,lines_json,totals_json,journal_id) VALUES(?,?,?,?,?,?,?,?,?)",
      [biz.id, input.period, input.payDate, input.paymentMethod, prefs.jurisdiction, JSON.stringify(rates), JSON.stringify(lines), JSON.stringify(totals), j.id]);
    await recordPayrollRecoveries(tx, biz.id, lines, input.period, insertedId(ins, "payroll run"), j.id);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('POST','payroll_run',?,?)", [String(ins.lastInsertId ?? j.id), JSON.stringify({ period: input.period, entry: j.entryNumber, totals })]);
    return { journalId: j.id, entryNumber: j.entryNumber, lines, totals };
  });
}

export async function listPayrollRuns(): Promise<PayrollRun[]> {
  const d = await db();
  const biz = await getActiveBusiness();
  const rows = await d.select<Array<{ id: number; period: string; pay_date: string; payment_method: string; jurisdiction: string; lines_json: string; totals_json: string; journal_id: number; entry_number: string; status: string }>>(
    "SELECT r.id,r.period,r.pay_date,r.payment_method,r.jurisdiction,r.lines_json,r.totals_json,r.journal_id,j.entry_number,j.status FROM payroll_runs r JOIN journal_entries j ON j.id=r.journal_id WHERE r.business_id=? ORDER BY r.period DESC,r.id DESC", [biz.id]);
  return rows.map(r => ({ id: r.id, period: r.period, pay_date: r.pay_date, payment_method: r.payment_method, jurisdiction: r.jurisdiction, lines: JSON.parse(r.lines_json), totals: JSON.parse(r.totals_json), journal_id: r.journal_id, entry_number: r.entry_number, status: r.status }));
}

/** What is currently owed to each authority, from the ledger (posted and reversed journals net out). */
export async function getPayrollLiabilities() {
  const d = await db();
  const rows = await d.select<Array<{ code: string; balance: number }>>(
    `SELECT a.code,COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.credit_tzs-l.debit_tzs ELSE 0 END),0) balance
     FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries j ON j.id=l.journal_entry_id
     WHERE a.code IN ('2120','2130','2140','2150') GROUP BY a.id`);
  const by = new Map(rows.map(r => [r.code, Number(r.balance)]));
  return PAYROLL_LIABILITIES.map(l => ({ ...l, balance: by.get(l.code) ?? 0 }));
}

/** Pays money over to an authority: Dr the liability, Cr cash/bank/mobile money. Cannot pay more than is owed. */
export async function remitPayrollTax(input: { code: string; amount: number; date: string; paymentMethod: string }) {
  const item = PAYROLL_LIABILITIES.find(l => l.code === input.code);
  if (!item) throw new Error("Choose what you are paying.");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Enter the amount in whole TZS.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Enter the payment date.");
  return withTransaction(async tx => {
    const bal = (await tx.select<Array<{ balance: number }>>(
      `SELECT COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.credit_tzs-l.debit_tzs ELSE 0 END),0) balance
       FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code=?`, [input.code]))[0]?.balance ?? 0;
    if (input.amount > Number(bal)) throw new Error(`Only ${Number(bal).toLocaleString("en-TZ")} is owed for ${item.label}. Enter that amount or less.`);
    return insertJournal({
      date: input.date, description: `Payment of ${item.label} to ${item.authority}`, sourceType: "payroll_remittance", sourceId: input.code,
      lines: [{ accountCode: input.code, description: `${item.label} paid`, debitTzs: input.amount }, { accountCode: cashAccountFor(input.paymentMethod), description: `${item.label} paid`, creditTzs: input.amount }],
    }, tx);
  });
}
