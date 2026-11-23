// Pure salary-advance rules. No imports: easy to test.

export type OpenAdvance = { id: number; outstanding: number; monthly_recovery: number };
export type Allocation = { advanceId: number; amount: number };

/** Applies a repayment to the oldest advances first. `advances` must already be ordered oldest first. Throws if it exceeds what is owed. */
export function allocateFifo(advances: OpenAdvance[], amount: number): Allocation[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Enter the amount in whole TZS.");
  const owed = advances.reduce((s, a) => s + a.outstanding, 0);
  if (amount > owed) throw new Error(`Only ${owed.toLocaleString("en-TZ")} is outstanding on advances. Enter that amount or less.`);
  const out: Allocation[] = []; let left = amount;
  for (const a of advances) {
    if (left <= 0) break;
    const take = Math.min(a.outstanding, left);
    if (take > 0) { out.push({ advanceId: a.id, amount: take }); left -= take; }
  }
  return out;
}

/** Suggested payroll deduction: scheduled monthly instalments, never more than is owed and never more than take-home pay. 0 when no instalment is set. */
export function suggestedRecovery(open: OpenAdvance[], takeHomeBeforeAdvance: number): number {
  const scheduled = open.reduce((s, a) => s + (a.monthly_recovery > 0 ? Math.min(a.monthly_recovery, a.outstanding) : 0), 0);
  return Math.max(0, Math.min(scheduled, takeHomeBeforeAdvance));
}

export type AdvanceInput = { employeeId: number; date: string; amount: number; monthlyRecovery: number; paymentMethod: string; reason: string };
export function validateAdvance(i: AdvanceInput, isRealDate: (s: string) => boolean): string | null {
  if (!Number.isSafeInteger(i.employeeId) || i.employeeId <= 0) return "Choose the employee.";
  if (!isRealDate(i.date)) return "Enter a valid advance date.";
  if (!Number.isSafeInteger(i.amount) || i.amount <= 0) return "Enter the advance amount in whole TZS.";
  if (!Number.isSafeInteger(i.monthlyRecovery) || i.monthlyRecovery < 0) return "Enter the monthly recovery in whole TZS, or 0 to decide each month.";
  if (i.monthlyRecovery > i.amount) return "The monthly recovery cannot be more than the advance.";
  if (!["Bank", "Cash", "Mobile money"].includes(i.paymentMethod)) return "Choose how the advance is paid.";
  return null;
}
