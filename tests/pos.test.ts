// Run: node --experimental-strip-types tests/pos.test.ts
import assert from "node:assert/strict";
import { ROLE_DEFAULT, canDiscount, canOpenPage, hasPerm, homePage, parsePerms } from "../src/permissions.ts";
import type { AppUser } from "../src/permissions.ts";
import { hashPin, lockMs, randomSalt, validPin, verifyPin } from "../src/pinLogic.ts";
import { computeDiscounts, discountOf, withinLimit } from "../src/discountCalc.ts";

const mk = (role: AppUser["role"], perms = ROLE_DEFAULT[role], limit = 0): AppUser => ({ id: 1, name: "x", role, perms, discountLimitPct: limit, active: true });

// ---- permissions
const owner = mk("owner"), mgr = mk("manager", ROLE_DEFAULT.manager, 20), cashier = mk("cashier");
assert.ok(hasPerm(owner, "users") && hasPerm(owner, "accounting"));
assert.ok(!hasPerm(mgr, "users") && !hasPerm(mgr, "accounting") && hasPerm(mgr, "refund"));
assert.ok(hasPerm(cashier, "sell") && !hasPerm(cashier, "refund") && !hasPerm(cashier, "stock"));
assert.ok(canOpenPage(cashier, "sale") && !canOpenPage(cashier, "stock") && !canOpenPage(cashier, "dashboard") && !canOpenPage(cashier, "ledger") && !canOpenPage(mgr, "users"));
assert.ok(canOpenPage(mgr, "cashreports") && !canOpenPage(cashier, "cashreports"));
assert.equal(homePage(owner), "dashboard"); assert.equal(homePage(cashier), "sale"); assert.equal(homePage(mgr), "sale");
assert.ok(canDiscount(owner, 100) && canDiscount(mgr, 20) && !canDiscount(mgr, 20.01) && !canDiscount(cashier, 1));
assert.ok(!canDiscount({ ...owner, active: false }, 1));
assert.deepEqual(parsePerms('["sell","bogus","refund"]'), ["sell", "refund"]); assert.deepEqual(parsePerms("not json"), []);

// ---- PIN
assert.ok(validPin("1234") && validPin("012345") && !validPin("123") && !validPin("1234567") && !validPin("12a4"));
const salt = randomSalt(); assert.equal(salt.length, 32);
const h = await hashPin("4821", salt);
assert.ok(await verifyPin("4821", salt, h)); assert.ok(!(await verifyPin("4822", salt, h))); assert.ok(!(await verifyPin("4821", randomSalt(), h)));
assert.notEqual(h, await hashPin("4821", randomSalt()));
assert.equal(lockMs(4), 0); assert.equal(lockMs(5), 60000); assert.equal(lockMs(6), 120000); assert.equal(lockMs(50), 900000);

// ---- discounts
assert.deepEqual(discountOf({ type: "pct", value: "10" }, 25000), { tzs: 2500 });
assert.deepEqual(discountOf({ type: "pct", value: "12.5" }, 1000), { tzs: 125 });
assert.deepEqual(discountOf({ type: "tzs", value: "1,500" }, 25000), { tzs: 1500 });
for (const bad of [{ type: "pct", value: "100" }, { type: "pct", value: "0" }, { type: "pct", value: "101" }, { type: "tzs", value: "25000" }, { type: "tzs", value: "10.5" }, { type: "tzs", value: "" }, { type: "pct", value: "1.234" }] as const)
  assert.ok("error" in discountOf(bad, 25000), JSON.stringify(bad));
// line discount + sale discount; parts always add up
let r = computeDiscounts([10000, 20000, 30000], [{ type: "pct", value: "10" }, undefined, undefined], { type: "tzs", value: "5000" });
assert.equal(r.error, null); assert.equal(r.perLine[0] >= 1000, true);
assert.equal(r.total, 1000 + 5000); assert.equal(r.perLine.reduce((a, b) => a + b, 0), r.total); assert.equal(r.base, 60000);
assert.equal(r.pct, 10);
// proportional sale discount: 10% of 60000 shared 1:2:3
r = computeDiscounts([10000, 20000, 30000], [], { type: "pct", value: "10" });
assert.deepEqual(r.perLine, [1000, 2000, 3000]);
// rounding: shares add up exactly
r = computeDiscounts([3333, 3333, 3334], [], { type: "tzs", value: "1000" }); assert.equal(r.perLine.reduce((a, b) => a + b, 0), 1000);
// errors
assert.ok(computeDiscounts([1000], [{ type: "tzs", value: "1000" }], null).error);
assert.ok(computeDiscounts([1000, 1], [], { type: "tzs", value: "1000" }).error); // would wipe out the 1 TZS line
assert.equal(computeDiscounts([1000], [], null).total, 0);
// limit check is exact
assert.ok(withinLimit(2000, 10000, 20) && !withinLimit(2001, 10000, 20) && withinLimit(0, 10000, 0));
console.log("pos tests passed");

// ---- shifts
import { cashVariance, cashierDayText, expectedCash, shiftSlip, varianceText } from "../src/shiftCalc.ts";
assert.equal(expectedCash(50000, 9000, 2700), 56300);
assert.equal(cashVariance(56000, 56300), -300);
assert.equal(varianceText(0), "Balanced"); assert.equal(varianceText(-300), "Short by 300"); assert.equal(varianceText(1500), "Over by 1,500");
const fig = { sales: 1, gross: 9000, discounts: 1000, byMethod: [{ method: "Cash", amount: 9000 }], credit: 0, refunds: [{ method: "Cash", amount: 2700 }], refundCount: 1, voidCount: 1, cashSales: 9000, cashRefunds: 2700 };
const slip = shiftSlip({ business: "Shop", cashier: "Asha", openedAt: "2026-11-14 08:00", closedAt: "2026-11-14 17:00", float: 50000, fig, counted: 56000, note: "change" }, 40);
for (const t of ["SHIFT CLOSING", "Asha", "56,300", "Short by 300", "Discounts given", "Cashier signature"]) assert.ok(slip.includes(t), t);
assert.ok(slip.split("\n").every(l => l.length <= 40), "slip fits 40 columns");
assert.ok(shiftSlip({ business: "Shop", cashier: "A", openedAt: "x", float: 0, fig, counted: null }, 32).includes("SHIFT SO FAR"));
const day = cashierDayText("Shop", "2026-11-14", { userId: 1, name: "Asha", sales: 1, gross: 9000, discounts: 1000, refunds: 1, refundTotal: 2700, voids: 1, voidTotal: 2000 }, [{ opened: "2026-11-14 08:00", closed: "2026-11-14 17:00", float: 50000, expected: 56300, counted: 56000, variance: -300 }], 40);
assert.ok(day.includes("NET SALES") && day.includes("6,300") && day.includes("Short by 300"), day);
console.log("shift tests passed");

// ---- usernames and secrets (v0.11)
import { suggestUsername, validSecret, validUsername } from "../src/pinLogic.ts";
assert.ok(validSecret("1234") && validSecret("a long pass phrase 2026") && validSecret("x".repeat(64)));
assert.ok(!validSecret("123") && !validSecret("x".repeat(65)) && !validSecret(" 1234") && !validSecret("1234 ") && !validSecret(""));
assert.ok(validUsername("juma") && validUsername("Asha.K-2") && validUsername("a_b") && validUsername("12"));
assert.ok(!validUsername("a") && !validUsername(".ab") && !validUsername("a b") && !validUsername("x".repeat(31)) && !validUsername("juma@shop"));
assert.equal(suggestUsername("Juma Hassan"), "juma.hassan"); assert.equal(suggestUsername("  Zawadi  "), "zawadi"); assert.equal(suggestUsername("Nëema O'Neil"), "neema.o.neil");
assert.ok(validUsername(suggestUsername("日本")) && validUsername(suggestUsername("A")) && validUsername(suggestUsername("---")));
console.log("username tests passed");
