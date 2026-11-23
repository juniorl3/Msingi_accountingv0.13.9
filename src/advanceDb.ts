// Salary advances: money paid to an employee ahead of salary, recovered through payroll (or repaid in cash).
// Accounting: issue = Dr 1340 Employee Salary Advances, Cr cash/bank/mobile money.
//             payroll recovery = part of the payroll journal (Cr 1340); cash repayment = Dr cash/bank/mobile, Cr 1340.
// Reversing a journal (Journal entries page) automatically cancels the advance or recovery, because balances only count posted journals.
import { db, withTransaction, insertedId } from "./db";
import type { Conn } from "./db";
import { getActiveBusiness } from "./business";
import { insertJournal, cashAccountFor } from "./ledger";
import { allocateFifo, validateAdvance } from "./advanceRules";
import type { AdvanceInput } from "./advanceRules";
import { isRealDate } from "./employeeRules";

export type Advance = {
  id: number; employee_id: number; employee_no: string; full_name: string; advance_date: string; amount: number; monthly_recovery: number;
  payment_method: string; reason: string; journal_id: number; entry_number: string; status: string; recovered: number; outstanding: number;
};

export async function initialiseAdvances() {
  const d = await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS salary_advances(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,employee_id INTEGER NOT NULL REFERENCES employees(id),advance_date TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),monthly_recovery INTEGER NOT NULL DEFAULT 0 CHECK(monthly_recovery>=0),payment_method TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',journal_id INTEGER NOT NULL REFERENCES journal_entries(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute(`CREATE TABLE IF NOT EXISTS salary_advance_recoveries(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,advance_id INTEGER NOT NULL REFERENCES salary_advances(id),amount INTEGER NOT NULL CHECK(amount>0),kind TEXT NOT NULL CHECK(kind IN ('payroll','cash')),period TEXT,payroll_run_id INTEGER,journal_id INTEGER NOT NULL REFERENCES journal_entries(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_salary_advances_emp ON salary_advances(business_id,employee_id)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_advance_recoveries_adv ON salary_advance_recoveries(advance_id)");
}

/** Advances (oldest first) with what has been recovered. Works on any connection, so it can run inside a transaction. */
export async function fetchAdvances(conn: Conn, businessId: number, employeeId?: number): Promise<Advance[]> {
  const rows = await conn.select<Array<Omit<Advance, "outstanding">>>(
    `SELECT a.id,a.employee_id,e.employee_no,e.full_name,a.advance_date,a.amount,a.monthly_recovery,a.payment_method,a.reason,a.journal_id,j.entry_number,j.status,
       COALESCE((SELECT SUM(r.amount) FROM salary_advance_recoveries r JOIN journal_entries rj ON rj.id=r.journal_id WHERE r.advance_id=a.id AND rj.status='posted'),0) recovered
     FROM salary_advances a JOIN employees e ON e.id=a.employee_id JOIN journal_entries j ON j.id=a.journal_id
     WHERE a.business_id=? ${employeeId !== undefined ? "AND a.employee_id=?" : ""} ORDER BY a.advance_date,a.id`,
    employeeId !== undefined ? [businessId, employeeId] : [businessId]);
  return rows.map(r => ({ ...r, amount: Number(r.amount), recovered: Number(r.recovered), outstanding: r.status === "posted" ? Number(r.amount) - Number(r.recovered) : 0 }));
}
export const openOnly = (list: Advance[]) => list.filter(a => a.status === "posted" && a.outstanding > 0);

export async function listAdvances(): Promise<Advance[]> {
  const biz = await getActiveBusiness(), d = await db();
  return fetchAdvances(d, biz.id);
}

export async function issueAdvance(input: AdvanceInput) {
  const problem = validateAdvance(input, isRealDate);
  if (problem) throw new Error(problem);
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const emp = (await tx.select<Array<{ full_name: string; employee_no: string; status: string }>>("SELECT full_name,employee_no,status FROM employees WHERE id=? AND business_id=?", [input.employeeId, biz.id]))[0];
    if (!emp) throw new Error("Employee not found in this business.");
    if (emp.status !== "Active") throw new Error(`${emp.full_name} is ${emp.status.toLowerCase()}. Advances can only be given to active employees.`);
    const j = await insertJournal({
      date: input.date, description: `Salary advance: ${emp.full_name} (${emp.employee_no})`, sourceType: "salary_advance", sourceId: String(input.employeeId),
      lines: [{ accountCode: "1340", description: `Advance to ${emp.full_name}`, debitTzs: input.amount }, { accountCode: cashAccountFor(input.paymentMethod), description: `Advance to ${emp.full_name}`, creditTzs: input.amount }],
    }, tx);
    const ins = await tx.execute("INSERT INTO salary_advances(business_id,employee_id,advance_date,amount,monthly_recovery,payment_method,reason,journal_id) VALUES(?,?,?,?,?,?,?,?)",
      [biz.id, input.employeeId, input.date, input.amount, input.monthlyRecovery, input.paymentMethod, input.reason.trim(), j.id]);
    const id = insertedId(ins, "salary advance");
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('CREATE','salary_advance',?,?)", [String(id), JSON.stringify({ employee: emp.employee_no, amount: input.amount, monthlyRecovery: input.monthlyRecovery, entry: j.entryNumber })]);
    return { id, journalId: j.id, entryNumber: j.entryNumber };
  });
}

/** Employee pays back (part of) their advances in cash/bank/mobile money. Applied to the oldest advances first. */
export async function recordAdvanceRepayment(input: { employeeId: number; amount: number; date: string; paymentMethod: string }) {
  if (!isRealDate(input.date)) throw new Error("Enter a valid repayment date.");
  if (!["Bank", "Cash", "Mobile money"].includes(input.paymentMethod)) throw new Error("Choose where the money was received.");
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const open = openOnly(await fetchAdvances(tx, biz.id, input.employeeId));
    const parts = allocateFifo(open, input.amount);
    const name = open[0]?.full_name ?? "employee";
    const j = await insertJournal({
      date: input.date, description: `Salary advance repayment: ${name}`, sourceType: "salary_advance_repayment", sourceId: String(input.employeeId),
      lines: [{ accountCode: cashAccountFor(input.paymentMethod), description: `Repayment from ${name}`, debitTzs: input.amount }, { accountCode: "1340", description: `Repayment from ${name}`, creditTzs: input.amount }],
    }, tx);
    for (const p of parts) await tx.execute("INSERT INTO salary_advance_recoveries(business_id,advance_id,amount,kind,journal_id) VALUES(?,?,?,'cash',?)", [biz.id, p.advanceId, p.amount, j.id]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('POST','salary_advance_repayment',?,?)", [String(input.employeeId), JSON.stringify({ amount: input.amount, entry: j.entryNumber, parts })]);
    return { journalId: j.id, entryNumber: j.entryNumber };
  });
}

/** Called inside the payroll posting transaction: checks each line's advance recovery against what is owed (throws if too much). */
export async function checkPayrollRecoveries(tx: Conn, businessId: number, lines: Array<{ employeeId?: number; name: string; advance?: number }>) {
  for (const l of lines) {
    if (!l.advance) continue;
    if (l.employeeId === undefined) throw new Error(`${l.name}: advance recovery needs a registered employee.`);
    allocateFifo(openOnly(await fetchAdvances(tx, businessId, l.employeeId)), l.advance); // throws if more than owed
  }
}
/** Called inside the payroll posting transaction after the journal and run exist: records the recoveries against the oldest advances. */
export async function recordPayrollRecoveries(tx: Conn, businessId: number, lines: Array<{ employeeId?: number; advance?: number }>, period: string, payrollRunId: number, journalId: number) {
  for (const l of lines) {
    if (!l.advance || l.employeeId === undefined) continue;
    for (const p of allocateFifo(openOnly(await fetchAdvances(tx, businessId, l.employeeId)), l.advance))
      await tx.execute("INSERT INTO salary_advance_recoveries(business_id,advance_id,amount,kind,period,payroll_run_id,journal_id) VALUES(?,?,?,'payroll',?,?,?)", [businessId, p.advanceId, p.amount, period, payrollRunId, journalId]);
  }
}
