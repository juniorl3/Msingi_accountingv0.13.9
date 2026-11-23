// Run: node --experimental-strip-types tests/returns.test.ts
import assert from "node:assert/strict";
import { returnShare } from "../src/returnsCalc.ts";
const none = { qty: 0, gross: 0, net: 0, vat: 0, cost: 0 };
const line = { qty: 3000, gross: 11800, net: 10000, vat: 1800, cost: 6000 };

// one of three
assert.deepEqual(returnShare(line, none, 1000), { gross: 3933, net: 3333, vat: 600, cost: 2000 });
// returning everything in pieces adds up exactly to the line
let done = { ...none }, tot = { gross: 0, net: 0, vat: 0, cost: 0 };
for (const q of [1000, 1000, 1000]) {
  const s = returnShare(line, done, q);
  tot = { gross: tot.gross + s.gross, net: tot.net + s.net, vat: tot.vat + s.vat, cost: tot.cost + s.cost };
  done = { qty: done.qty + q, gross: tot.gross, net: tot.net, vat: tot.vat, cost: tot.cost };
}
assert.deepEqual(tot, { gross: 11800, net: 10000, vat: 1800, cost: 6000 });
// odd split sums too
const odd = { qty: 7000, gross: 10001, net: 8475, vat: 1526, cost: 3333 }; let d = { ...none }, g = 0, c = 0;
for (const q of [2500, 1500, 3000]) { const s = returnShare(odd, d, q); assert.equal(s.net + s.vat, s.gross); g += s.gross; c += s.cost; d = { qty: d.qty + q, gross: g, net: 0, vat: 0, cost: c }; }
assert.equal(g, 10001); assert.equal(c, 3333);
// fractional quantities (milli units) and limits
assert.equal(returnShare({ qty: 1500, gross: 4800, net: 4800, vat: 0, cost: 0 }, none, 500).gross, 1600);
assert.throws(() => returnShare(line, none, 3001), /Only 3 can still be returned/);
assert.throws(() => returnShare(line, { ...none, qty: 3000 }, 1), /Only 0 can still/);
assert.throws(() => returnShare(line, none, 0), /quantity/);
assert.throws(() => returnShare(line, none, 1.5), /quantity/);
console.log("returns tests passed");
