// Run: node --experimental-strip-types tests/escpos.test.ts
import assert from "node:assert/strict";
import { drawerKick, drawerOnly, drawerWanted, plainToEscPos, receiptToEscPos, testPage, toPrinterText } from "../src/escpos.ts";
import { COLS } from "../src/receipt.ts";
import type { Receipt } from "../src/receipt.ts";

const idx = (hay: Uint8Array, needle: number[], from = 0) => { for (let i = from; i <= hay.length - needle.length; i++) if (needle.every((b, k) => hay[i + k] === b)) return i; return -1; };
const ascii = (b: Uint8Array) => Buffer.from(b).toString("latin1");

// text simplification
assert.equal(toPrinterText("Café — “Soda” × 2…"), 'Cafe - "Soda" x 2...');
assert.equal(toPrinterText("日本"), "??"); assert.equal(toPrinterText("a\u0007b"), "ab"); assert.equal(toPrinterText("a\nb"), "a\nb");

// drawer pulse
assert.deepEqual(drawerKick(2), [0x1b, 0x70, 0, 25, 250]); assert.deepEqual(drawerKick(5), [0x1b, 0x70, 1, 25, 250]);
const only = drawerOnly(2); assert.deepEqual([...only], [0x1b, 0x40, 0x1b, 0x74, 0, 0x1b, 0x70, 0, 25, 250]);

const r: Receipt = { business: { name: "Café Msingi", address: "Mwanza", phone: "", tin: "", footer: "Asante" }, number: "STK-000001", date: "2026-11-14", time: "10:00", lines: [{ name: "Soda", qty: "2", unitPrice: 1000, amount: 2000, discount: 200 }], total: 1800, vat: 0, net: 1800, vatRegistered: false, payment: "Cash", tendered: 2000, change: 200 };
for (const paper of ["58", "80"] as const) {
  const b = receiptToEscPos(r, paper, { cut: true, drawerPin: 2 });
  assert.deepEqual([...b.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 0]);          // reset first
  assert.equal(idx(b, drawerKick(2)), 5);                                      // drawer kicked immediately after reset
  assert.deepEqual([...b.slice(-4)], [0x1d, 0x56, 0x42, 3]);                   // ends with a cut
  assert.ok(idx(b, [0x1b, 0x45, 1, ...Buffer.from("TOTAL (TZS)")]) > 0, "TOTAL is bold");
  assert.ok(/\x1bE\x01 *Cafe Msingi/.test(ascii(b)), "business name is bold and simplified");
  assert.ok(ascii(b).includes("Discount"));
  // every printed line fits the paper
  const text = ascii(b).replace(/\x1bE[\x00\x01]|\x1b@|\x1bt\x00|\x1bp[\x00\x01][\s\S]{2}|\x1bd[\s\S]|\x1dVB\x03/g, "");
  for (const line of text.split("\n")) assert.ok(line.length <= COLS[paper], `${paper}: "${line}" is ${line.length}`);
}
// no drawer / no cut options
const plain = receiptToEscPos(r, "80", { cut: false, drawerPin: null });
assert.equal(idx(plain, [0x1b, 0x70]), -1); assert.equal(idx(plain, [0x1d, 0x56]), -1);
// slips and test page
const slip = plainToEscPos("SHIFT CLOSING\nCashier  Asha", { cut: true });
assert.ok(ascii(slip).includes("SHIFT CLOSING") && ascii(slip).includes("Asha")); assert.deepEqual([...slip.slice(-4)], [0x1d, 0x56, 0x42, 3]);
assert.ok(ascii(testPage("58")).includes("MSINGI PRINTER TEST")); assert.equal(idx(testPage("80", { drawerPin: 2 }), [0x1b, 0x70]), -1);
// drawer rule
assert.ok(drawerWanted("always", { payment: "Card" })); assert.ok(!drawerWanted("off", { payment: "Cash" }));
assert.ok(drawerWanted("cash", { payment: "Cash" })); assert.ok(!drawerWanted("cash", { payment: "Mobile money" }));
assert.ok(drawerWanted("cash", { payment: "Split", payments: [{ method: "Card", amount: 1 }, { method: "Cash", amount: 2 }] }));
assert.ok(!drawerWanted("cash", { payment: "Split", payments: [{ method: "Card", amount: 1 }, { method: "Bank", amount: 2 }] }));
assert.ok(!drawerWanted("cash", { payment: "Credit" }));
console.log("escpos tests passed");
