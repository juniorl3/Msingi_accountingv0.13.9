// Run: node --experimental-strip-types tests/receipt.test.ts
import assert from "node:assert/strict";
import { wrap, pair, receiptText, receiptHtml, receiptDocument, changeFor, COLS, esc } from "../src/receipt.ts";
import type { Receipt } from "../src/receipt.ts";

const base: Receipt = {
  business: { name: "Mama Neema Shop", address: "Sinza Mori, Dar es Salaam", phone: "0712 345 678", tin: "123-456-789", footer: "Thank you, karibu tena" },
  number: "S-0042", date: "2026-11-13", time: "14:05",
  lines: [{ name: "Unga wa ngano 2kg", qty: "2", unitPrice: 4500, amount: 9000 }, { name: "Sugar", qty: "1.5", unitPrice: 3200, amount: 4800 }],
  total: 13800, vat: 2105, net: 11695, vatRegistered: true, payment: "Cash", tendered: 15000, change: 1200,
};
for (const w of [32, 48]) {
  const t = receiptText(base, w);
  for (const line of t.split("\n")) assert.ok(line.length <= w, `line too long for ${w}: "${line}"`);
  assert.ok(t.includes("TOTAL (TZS)") && t.includes("13,800") && t.includes("VAT") && t.includes("Change") && t.includes("1,200") && t.includes("S-0042"));
}
assert.deepEqual(wrap("aaaa bbbb cccc", 9), ["aaaa bbbb", "cccc"]);
assert.deepEqual(wrap("abcdefghijkl", 5), ["abcde", "fghij", "kl"]);
assert.equal(pair("TOTAL", "13,800", 20).length, 20);
assert.equal(pair("A very long item label here", "9,999", 16).length, 16);

// not VAT registered: no VAT lines. Credit sale: invoice, no tender/change.
const nv = receiptText({ ...base, vatRegistered: false }, 32); assert.ok(!nv.includes("VAT"));
const cr = receiptText({ ...base, invoice: "INV-0007", customer: "Juma", tendered: undefined, change: undefined }, 32);
assert.ok(cr.includes("invoice INV-0007") && !cr.includes("Change") && cr.includes("Customer: Juma"));
// card payment, no tender entered: shows total as paid
assert.ok(receiptText({ ...base, payment: "Mobile money", tendered: undefined, change: undefined }, 32).includes("Paid by Mobile money"));

// html is escaped
const evil = receiptHtml({ ...base, business: { ...base.business, name: "<script>alert(1)</script>" } }, "80");
assert.ok(!evil.includes("<script>") && evil.includes("&lt;script&gt;"));
assert.ok(receiptDocument(base, "58").includes("size:58mm auto"));
assert.equal(esc(`a&b"c`), "a&amp;b&quot;c"); assert.deepEqual(COLS, { "58": 32, "80": 48 });

// change
assert.deepEqual(changeFor(13800, 15000), { change: 1200 });
assert.deepEqual(changeFor(13800, 13800), { change: 0 });
assert.match((changeFor(13800, 10000) as { error: string }).error, /3,800 short/);
assert.ok("error" in changeFor(13800, -1)); assert.ok("error" in changeFor(13800, 1.5));
console.log("receipt tests passed");

// v0.9.0: discount rows and cashier name
{
  const r = { business: { name: "Shop", address: "", phone: "", tin: "", footer: "" }, number: "STK-1", date: "2026-11-14", time: "10:00", lines: [{ name: "Soda", qty: "2", unitPrice: 1000, amount: 2000, discount: 200 }], total: 1800, vat: 0, net: 1800, vatRegistered: false, payment: "Cash", cashier: "Asha" };
  const t = receiptText(r, 32);
  assert.ok(t.includes("Discount") && t.includes("-200") && t.includes("Served by") && t.includes("Asha"), t);
  assert.ok(!receiptText({ ...r, lines: [{ ...r.lines[0], discount: undefined }], cashier: undefined }, 32).includes("Discount"));
}

// fiscal receipt numbers typed in from the business's own EFD/VFD are printed; nothing is printed when there are none
{
  const { receiptText } = await import("../src/receipt.ts");
  const base = { business: { name: "Shop", address: "", phone: "", tin: "", footer: "" }, number: "STK-000001", date: "2026-11-15", time: "10:00", lines: [{ name: "Soda", qty: "1", unitPrice: 1000, amount: 1000 }], total: 1000, vat: 0, net: 1000, vatRegistered: false, payment: "Cash" };
  assert.ok(!receiptText(base, 32).includes("Fiscal"));
  const t = receiptText({ ...base, fiscal: { receiptNo: "AB12/34", code: "XY99" } }, 32);
  assert.ok(t.includes("Fiscal receipt no: AB12/34") && t.includes("Verification code: XY99"));
  assert.ok(!receiptText({ ...base, fiscal: { receiptNo: "7", code: "" } }, 32).includes("Verification"));
  console.log("fiscal receipt line tests passed");
}
