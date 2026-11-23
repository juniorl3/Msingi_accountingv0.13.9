// Pure employee/payroll eligibility rules. No imports: easy to test.

export type EligibilityInfo = { id: number; full_name: string; status: string; pay_frequency: string; start_date: string; end_date: string };

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-13-45 and 2026-02-30). */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Next number in a business's own EMP-0001 sequence, from the numbers it already has. */
export function nextEmployeeNo(existing: string[]): string {
  let max = 0;
  for (const no of existing) { const m = /^EMP-(\d+)$/.exec(no); if (m) max = Math.max(max, Number(m[1])); }
  return `EMP-${String(max + 1).padStart(4, "0")}`;
}

export const periodStart = (period: string) => `${period}-01`;
export const periodEnd = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/**
 * Whether an employee may be paid in a monthly payroll for `period` (YYYY-MM). Returns a problem message or null.
 * Active staff are payable. Inactive/Terminated staff are payable only for months up to and including their end date,
 * so a final salary can still be run after someone leaves. Staff who start after the month ends are not payable.
 */
export function payrollProblem(e: EligibilityInfo, period: string): string | null {
  if (e.pay_frequency !== "Monthly") return `${e.full_name} is not paid monthly, so is not part of the monthly payroll.`;
  if (e.start_date > periodEnd(period)) return `${e.full_name} starts on ${e.start_date}, after ${period}.`;
  if (e.status !== "Active") {
    if (!e.end_date) return `${e.full_name} is ${e.status.toLowerCase()} with no end date. Add an end date to the employee record to pay a final salary.`;
    if (e.end_date < periodStart(period)) return `${e.full_name} left on ${e.end_date}, before ${period}.`;
  }
  return null;
}

/** Soft warning (not a block): started part-way through the month, so a full month's pay may be too much. */
export function proratingWarning(e: EligibilityInfo, period: string): string | null {
  if (e.start_date > periodStart(period) && e.start_date <= periodEnd(period)) return `${e.full_name} started on ${e.start_date}; check whether pay should be prorated.`;
  if (e.status !== "Active" && e.end_date >= periodStart(period) && e.end_date < periodEnd(period)) return `${e.full_name} left on ${e.end_date}; check whether pay should be prorated.`;
  return null;
}

/** Throws on a repeated employee ID within one run. */
export function assertNoDuplicateEmployees(ids: Array<number | undefined>) {
  const seen = new Set<number>();
  for (const id of ids) { if (id === undefined) continue; if (seen.has(id)) throw new Error("An employee can appear only once in a payroll run."); seen.add(id); }
}

/** Days worked in the pay month for a starter or leaver (calendar days, both ends counted), or null when the employee worked the whole month. */
export function prorateDays(e: EligibilityInfo, period: string): { days: number; of: number } | null {
  const first = periodStart(period), last = periodEnd(period);
  const of = Number(last.slice(8, 10));
  const from = e.start_date > first ? e.start_date : first;
  const to = e.status !== "Active" && e.end_date && e.end_date < last ? e.end_date : last;
  if (from > to) return null;
  const days = Number(to.slice(8, 10)) - Number(from.slice(8, 10)) + 1;
  return days >= of ? null : { days, of };
}
/** Gross for part of a month, rounded to whole TZS. */
export const prorateGross = (gross: number, days: number, of: number) => Math.round((gross * days) / of);
