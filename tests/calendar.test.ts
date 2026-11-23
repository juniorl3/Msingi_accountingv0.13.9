// Run: node --experimental-strip-types tests/calendar.test.ts
import assert from "node:assert/strict";
import { daysInMonth, firstWeekday, monthGrid, shiftMonth, parseYMD, parseYM, clampDay, yearPageStart, yearsOnPage, formatYMD } from "../src/calendar.ts";

assert.equal(daysInMonth(2026, 2), 28); assert.equal(daysInMonth(2028, 2), 29); assert.equal(daysInMonth(1900, 2), 28); assert.equal(daysInMonth(2000, 2), 29);
assert.equal(firstWeekday(2026, 11), 6);  // 1 Nov 2026 is a Sunday
assert.equal(firstWeekday(2026, 6), 0);   // 1 Jun 2026 is a Monday
assert.deepEqual(shiftMonth(2026, 12, 1), { y: 2027, m: 1 });
assert.deepEqual(shiftMonth(2026, 1, -1), { y: 2025, m: 12 });
assert.deepEqual(shiftMonth(2026, 3, -27), { y: 2023, m: 12 });
assert.deepEqual(shiftMonth(2026, 11, 14), { y: 2028, m: 1 });

const g = monthGrid(2026, 11);
assert.equal(g.length, 42);
assert.equal(g[0].date, "2026-10-26"); assert.equal(g[0].inMonth, false);   // Monday before Sun 1 Nov
assert.equal(g[6].date, "2026-11-01"); assert.equal(g[6].inMonth, true);
assert.equal(g.filter(c => c.inMonth).length, 30);
assert.equal(g[41].date, "2026-12-06");
const feb = monthGrid(2028, 2); assert.equal(feb.filter(c => c.inMonth).length, 29);
assert.equal(new Set(monthGrid(2026, 1).map(c => c.date)).size, 42);

assert.deepEqual(parseYMD("2026-11-13"), { y: 2026, m: 11, d: 13 });
assert.equal(parseYMD("2026-02-30"), null); assert.equal(parseYMD("2026-13-01"), null); assert.equal(parseYMD("26-1-1"), null);
assert.deepEqual(parseYM("2026-11"), { y: 2026, m: 11 }); assert.equal(parseYM("2026-00"), null);
assert.equal(clampDay(2026, 2, 31), 28); assert.equal(clampDay(2028, 2, 31), 29); assert.equal(clampDay(2026, 4, 15), 15);
assert.equal(yearPageStart(2026), 2016); assert.equal(yearPageStart(2028), 2028);
assert.deepEqual(yearsOnPage(2016).slice(0, 2).concat(yearsOnPage(2016).slice(-1)), [2016, 2017, 2027]);
assert.equal(formatYMD(2026, 3, 5), "2026-03-05");
console.log("calendar tests passed");
