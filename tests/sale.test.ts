// Run: node --experimental-strip-types tests/sale.test.ts
import assert from "node:assert/strict";
import { saleGroups, saleTotals, checkSplit } from "../src/saleCalc.ts";
import { prorateDays, prorateGross } from "../src/employeeRules.ts";
import { receiptText } from "../src/receipt.ts";

// VAT-inclusive price: gross = entered; VAT taken out (18%)
let g = saleTotals(saleGroups([{ amount: 11800, service: false, treatment: "standard", priceIncludesVat: true }], true, 18));
assert.deepEqual(g, { net: 10000, vat: 1800, gross: 11800 });
// VAT-exclusive price: VAT is added on top, so the customer pays MORE than the entered amount
g = saleTotals(saleGroups([{ amount: 10000, service: false, treatment: "standard", priceIncludesVat: false }], true, 18));
assert.deepEqual(g, { net: 10000, vat: 1800, gross: 11800 });
// not VAT registered: no VAT whatever the item says
g = saleTotals(saleGroups([{ amount: 10000, service: false, treatment: "standard", priceIncludesVat: false }], false, 18));
assert.deepEqual(g, { net: 10000, vat: 0, gross: 10000 });
// mixed: groups by account and treatment
const grp = saleGroups([{ amount: 5000, service: false, treatment: "standard", priceIncludesVat: true }, { amount: 3000, service: false, treatment: "standard", priceIncludesVat: true }, { amount: 2000, service: true, treatment: "exempt", priceIncludesVat: true }], true, 18);
assert.equal(grp.length, 2); assert.equal(saleTotals(grp).gross, 10000);
assert.equal(saleTotals(grp).net + saleTotals(grp).vat, 10000);

// split payments
assert.equal(checkSplit([{ method: "Cash", amount: 6000 }, { method: "Mobile money", amount: 5800 }], 11800), null);
assert.match(checkSplit([{ method: "Cash", amount: 6000 }, { method: "Mobile money", amount: 5000 }], 11800)!, /add up to 11,000/);
assert.match(checkSplit([{ method: "Cash", amount: 6000 }, { method: "Cash", amount: 5800 }], 11800)!, /different/);
assert.match(checkSplit([{ method: "Cash", amount: 0 }, { method: "Bank", amount: 11800 }], 11800)!, /above zero/);
const rt = receiptText({ business: { name: "S", address: "", phone: "", tin: "", footer: "" }, number: "X", date: "2026-11-13", time: "10:00", lines: [{ name: "A", qty: "1", unitPrice: 11800, amount: 11800 }], total: 11800, vat: 1800, net: 10000, vatRegistered: true, payment: "Cash", payments: [{ method: "Cash", amount: 6000 }, { method: "Mobile money", amount: 5800 }] }, 32);
assert.ok(rt.includes("Paid by Cash") && rt.includes("Paid by Mobile money") && rt.includes("5,800"));

// proration
const e = (o = {}) => ({ id: 1, full_name: "E", status: "Active", pay_frequency: "Monthly", start_date: "2026-01-01", end_date: "", ...o });
assert.deepEqual(prorateDays(e({ start_date: "2026-11-13" }), "2026-11"), { days: 18, of: 30 });
assert.equal(prorateDays(e(), "2026-11"), null);
assert.equal(prorateDays(e({ start_date: "2026-11-01" }), "2026-11"), null);
assert.deepEqual(prorateDays(e({ status: "Terminated", end_date: "2026-11-10" }), "2026-11"), { days: 10, of: 30 });
assert.deepEqual(prorateDays(e({ start_date: "2026-11-05", status: "Terminated", end_date: "2026-11-20" }), "2026-11"), { days: 16, of: 30 });
assert.deepEqual(prorateDays(e({ start_date: "2028-02-15" }), "2028-02"), { days: 15, of: 29 });
assert.equal(prorateGross(1200000, 18, 30), 720000);
assert.equal(prorateGross(1000000, 10, 30), 333333);
console.log("sale tests passed");
