// Run: node --experimental-strip-types tests/advances.test.ts
import assert from "node:assert/strict";
import { allocateFifo, suggestedRecovery, validateAdvance } from "../src/advanceRules.ts";
import { computePayroll, payrollJournalLines, DEFAULT_RATES } from "../src/payrollCalc.ts";
import { isRealDate } from "../src/employeeRules.ts";

// FIFO allocation
assert.deepEqual(allocateFifo([{ id: 1, outstanding: 100000, monthly_recovery: 0 }, { id: 2, outstanding: 200000, monthly_recovery: 0 }], 150000), [{ advanceId: 1, amount: 100000 }, { advanceId: 2, amount: 50000 }]);
assert.deepEqual(allocateFifo([{ id: 1, outstanding: 100000, monthly_recovery: 0 }], 100000), [{ advanceId: 1, amount: 100000 }]);
assert.throws(() => allocateFifo([{ id: 1, outstanding: 100000, monthly_recovery: 0 }], 100001), /Only 100,000 is outstanding/);
assert.throws(() => allocateFifo([], 1), /outstanding/);
assert.throws(() => allocateFifo([{ id: 1, outstanding: 5, monthly_recovery: 0 }], 0), /whole TZS/);
assert.throws(() => allocateFifo([{ id: 1, outstanding: 500, monthly_recovery: 0 }], 1.5), /whole TZS/);

// suggested recovery
assert.equal(suggestedRecovery([{ id: 1, outstanding: 300000, monthly_recovery: 100000 }, { id: 2, outstanding: 50000, monthly_recovery: 80000 }], 900000), 150000);
assert.equal(suggestedRecovery([{ id: 1, outstanding: 300000, monthly_recovery: 0 }], 900000), 0);          // no instalment set -> user decides
assert.equal(suggestedRecovery([{ id: 1, outstanding: 300000, monthly_recovery: 500000 }], 120000), 120000); // capped at take-home pay

// validation
const ok = { employeeId: 1, date: "2026-11-13", amount: 200000, monthlyRecovery: 50000, paymentMethod: "Cash", reason: "" };
assert.equal(validateAdvance(ok, isRealDate), null);
assert.match(validateAdvance({ ...ok, amount: 0 }, isRealDate)!, /amount/);
assert.match(validateAdvance({ ...ok, date: "2026-02-30" }, isRealDate)!, /date/);
assert.match(validateAdvance({ ...ok, monthlyRecovery: 300000 }, isRealDate)!, /cannot be more/);
assert.match(validateAdvance({ ...ok, paymentMethod: "Cheque" }, isRealDate)!, /how the advance is paid/);

// payroll with advance recovery: balanced journal, net reduced, totals consistent
const rates = DEFAULT_RATES.mainland;
const noAdv = computePayroll([{ name: "A", gross: 1200000, employeeId: 1 }, { name: "B", gross: 800000, employeeId: 2 }], rates);
const withAdv = computePayroll([{ name: "A", gross: 1200000, employeeId: 1, advance: 150000 }, { name: "B", gross: 800000, employeeId: 2 }], rates);
assert.equal(withAdv.lines[0].net, noAdv.lines[0].net - 150000);
assert.equal(withAdv.totals.advance, 150000);
assert.equal(withAdv.totals.net, noAdv.totals.net - 150000);
assert.equal(withAdv.totals.paye, noAdv.totals.paye);            // advances are not taxed or deducted before PAYE
assert.equal(withAdv.totals.employerCost, noAdv.totals.employerCost); // cost to business unchanged
for (const t of [noAdv.totals, withAdv.totals]) {
  const rows = payrollJournalLines(t, "1010", "2026-11");
  const dr = rows.reduce((s, r) => s + (r.debitTzs ?? 0), 0), cr = rows.reduce((s, r) => s + (r.creditTzs ?? 0), 0);
  assert.equal(dr, cr);
}
assert.ok(payrollJournalLines(withAdv.totals, "1010", "2026-11").some(r => r.accountCode === "1340" && r.creditTzs === 150000));
assert.ok(!payrollJournalLines(noAdv.totals, "1010", "2026-11").some(r => r.accountCode === "1340"));
// recovery cannot exceed pay after social security and PAYE
assert.throws(() => computePayroll([{ name: "A", gross: 1000000, advance: 1000000 }], rates), /cannot be more than their pay/);
assert.throws(() => computePayroll([{ name: "A", gross: 1000000, advance: -5 }], rates), /whole TZS/);
console.log("advance tests passed");
