// Run: node --experimental-strip-types tests/employeeRules.test.ts
import assert from "node:assert/strict";
import { isRealDate, nextEmployeeNo, payrollProblem, proratingWarning, assertNoDuplicateEmployees, periodEnd } from "../src/employeeRules.ts";
import { computePayroll, DEFAULT_RATES } from "../src/payrollCalc.ts";

const e = (o: Partial<Parameters<typeof payrollProblem>[0]> = {}) => ({ id: 1, full_name: "Asha", status: "Active", pay_frequency: "Monthly", start_date: "2026-01-01", end_date: "", ...o });

assert.equal(isRealDate("2026-02-28"), true);
assert.equal(isRealDate("2026-02-30"), false);
assert.equal(isRealDate("2026-13-45"), false);
assert.equal(periodEnd("2026-02"), "2026-02-28");
assert.equal(periodEnd("2028-02"), "2028-02-29");

// numbering is per business: a second business with no rows starts at 1, gaps/other formats are ignored
assert.equal(nextEmployeeNo([]), "EMP-0001");
assert.equal(nextEmployeeNo(["EMP-0001", "EMP-0002"]), "EMP-0003");
assert.equal(nextEmployeeNo(["EMP-0007", "junk"]), "EMP-0008");

// eligibility
assert.equal(payrollProblem(e(), "2026-11"), null);
assert.match(payrollProblem(e({ pay_frequency: "Weekly" }), "2026-11")!, /not paid monthly/);
assert.match(payrollProblem(e({ start_date: "2026-12-01" }), "2026-11")!, /starts on/);
assert.equal(payrollProblem(e({ start_date: "2026-11-30" }), "2026-11"), null);
assert.match(payrollProblem(e({ status: "Terminated", end_date: "" }), "2026-11")!, /no end date/);
assert.equal(payrollProblem(e({ status: "Terminated", end_date: "2026-11-10" }), "2026-11"), null);   // final salary
assert.match(payrollProblem(e({ status: "Terminated", end_date: "2026-10-31" }), "2026-11")!, /left on/);
assert.equal(payrollProblem(e({ status: "Inactive", end_date: "2026-11-01" }), "2026-11"), null);

// warnings
assert.match(proratingWarning(e({ start_date: "2026-11-15" }), "2026-11")!, /prorated/);
assert.match(proratingWarning(e({ status: "Terminated", end_date: "2026-11-10" }), "2026-11")!, /prorated/);
assert.equal(proratingWarning(e(), "2026-11"), null);

// duplicates are rejected in the calculation engine itself, not just the screen
assert.throws(() => assertNoDuplicateEmployees([1, 2, 1]), /only once/);
assert.throws(() => computePayroll([{ name: "A", gross: 500000, employeeId: 1 }, { name: "A2", gross: 500000, employeeId: 1 }], DEFAULT_RATES.mainland), /only once/);
assert.doesNotThrow(() => computePayroll([{ name: "A", gross: 500000, employeeId: 1 }, { name: "B", gross: 500000, employeeId: 2 }], DEFAULT_RATES.mainland));
assert.doesNotThrow(() => computePayroll([{ name: "A", gross: 500000 }, { name: "B", gross: 500000 }], DEFAULT_RATES.mainland)); // legacy lines without IDs
console.log("all tests passed");
