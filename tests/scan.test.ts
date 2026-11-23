import assert from "node:assert/strict";
import { parseScan, findScanned, feedKey, EMPTY_BUF } from "../src/scanLogic.ts";

assert.deepEqual(parseScan("6001234567890\r\n"), { code: "6001234567890", qtyMilli: 1000 });
assert.deepEqual(parseScan(" 3*ABC123 "), { code: "ABC123", qtyMilli: 3000 });
assert.deepEqual(parseScan("0.5*MILK"), { code: "MILK", qtyMilli: 500 });
assert.equal(parseScan("0*X"), null);
assert.equal(parseScan("   "), null);
assert.equal(parseScan("x".repeat(65)), null);
assert.deepEqual(parseScan("12345*"), { code: "12345*", qtyMilli: 1000 });

const items = [
  { id: 1, barcode: "6001234567890", code: "SODA", is_active: 1 },
  { id: 2, barcode: "", code: "BREAD", is_active: 1 },
  { id: 3, barcode: "012345678905", code: "OLD", is_active: 0 },
  { id: 4, barcode: "0036000291452", code: "CHIPS", is_active: 1 },
];
assert.equal(findScanned(items, "6001234567890")?.id, 1);
assert.equal(findScanned(items, "bread")?.id, 2);
assert.equal(findScanned(items, "012345678905"), null);              // switched-off items are not sold
assert.equal(findScanned(items, "36000291452")?.id, 4);              // UPC-A scanned without the leading zeros
assert.equal(findScanned(items, "999"), null);
assert.equal(findScanned(items, ""), null);

// A fast burst then Enter is a scan; slow typing is not.
let b = EMPTY_BUF, out: string | undefined;
for (const [i, ch] of [..."60012345"].entries()) ({ buf: b } = feedKey(b, ch, 1000 + i * 15));
({ buf: b, scan: out } = feedKey(b, "Enter", 1000 + 8 * 15));
assert.equal(out, "60012345");
b = EMPTY_BUF;
for (const [i, ch] of [..."6001"].entries()) ({ buf: b } = feedKey(b, ch, 1000 + i * 400));
({ buf: b, scan: out } = feedKey(b, "Enter", 1000 + 4 * 400));
assert.equal(out, undefined);
b = EMPTY_BUF; ({ buf: b } = feedKey(b, "1", 0)); ({ buf: b } = feedKey(b, "2", 10));
assert.equal(feedKey(b, "Enter", 20).scan, undefined);               // too short to be a barcode
b = EMPTY_BUF; for (const [i, ch] of [..."ABCD"].entries()) ({ buf: b } = feedKey(b, ch, i * 10));
({ buf: b } = feedKey(b, "Shift", 40)); assert.equal(feedKey(b, "Tab", 45).scan, "ABCD");
console.log("scan tests passed");
