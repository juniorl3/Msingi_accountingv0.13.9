// Run: node --experimental-strip-types tests/printer.test.ts
import assert from "node:assert/strict";
import { getPrinterStatus, onPrinterStatus, readiness, samePrinter, setPrinterStatus, shouldRecheck, statusFrom, targetLabel, RECHECK_MS } from "../src/printerManager.ts";
import { DEFAULT_PREFS, cleanPrefs } from "../src/printerPrefs.ts";
import { drawerKick, drawerWanted, plainToEscPos, receiptToEscPos } from "../src/escpos.ts";
import type { Receipt } from "../src/receipt.ts";

const net = { ...DEFAULT_PREFS, mode: "network" as const, host: "192.168.1.50", port: 9100 };
const usb = { ...DEFAULT_PREFS, mode: "queue" as const, queue: "EPSON_TM_T20III" };

// readiness says what is missing
assert.equal(readiness(DEFAULT_PREFS).ok, true);
assert.match(readiness({ ...net, host: " " }).message, /IP address/);
assert.match(readiness({ ...net, port: 0 }).message, /port/);
assert.match(readiness({ ...net, port: 70000 }).message, /port/);
assert.equal(readiness(net).ok, true);
assert.match(readiness({ ...usb, queue: "" }).message, /print queue/);
assert.equal(readiness(usb).ok, true);

// labels and status
assert.equal(targetLabel(net), "192.168.1.50:9100"); assert.equal(targetLabel(usb), "EPSON_TM_T20III");
assert.equal(statusFrom(net, undefined, 5).state, "ok");
const bad = statusFrom(net, "The printer at 192.168.1.50:9100 does not answer", 5);
assert.equal(bad.state, "problem"); assert.match(bad.message, /does not answer/);
assert.equal(statusFrom(DEFAULT_PREFS, "ignored", 5).state, "system");

// re-check timing
assert.equal(shouldRecheck(null, 0), true);
const ok = statusFrom(net, undefined, 1000);
assert.equal(shouldRecheck(ok, 1000 + RECHECK_MS - 1), false);
assert.equal(shouldRecheck(ok, 1000 + RECHECK_MS), true);

// same printer
assert.equal(samePrinter(net, { ...net, cut: false }), true);
assert.equal(samePrinter(net, { ...net, host: "192.168.1.51" }), false);

// shared status notifies listeners and can be unsubscribed
const seen: (string | null)[] = [];
const off = onPrinterStatus(s => seen.push(s ? s.state : null));
setPrinterStatus(ok); setPrinterStatus(null); off(); setPrinterStatus(bad);
assert.deepEqual(seen, ["ok", null]); assert.equal(getPrinterStatus()?.state, "problem");

// damaged saved settings never break printing
assert.deepEqual(cleanPrefs({ mode: "bogus", port: "abc", host: 5, drawerPin: 9, cut: "x" }), { ...DEFAULT_PREFS, cut: true });

// receipt + drawer job as the printer would receive it (byte order is what makes the drawer open and the paper cut)
const r: Receipt = { business: { name: "Shop", address: "", phone: "", tin: "", footer: "" }, number: "STK-000009", date: "2026-11-16", time: "10:00", lines: [{ name: "Soda", qty: "1", unitPrice: 1000, amount: 1000, discount: 0 }], total: 1000, vat: 0, net: 1000, vatRegistered: false, payment: "Cash", tendered: 1000, change: 0 };
const find = (b: Uint8Array, n: number[]) => { for (let i = 0; i <= b.length - n.length; i++) if (n.every((x, k) => b[i + k] === x)) return i; return -1; };
const cashRule = drawerWanted("cash", r) ? 2 : null, cardRule = drawerWanted("cash", { ...r, payment: "Card" }) ? 2 : null;
assert.equal(cashRule, 2); assert.equal(cardRule, null);
const withDrawer = receiptToEscPos(r, "80", { cut: true, drawerPin: cashRule }), without = receiptToEscPos(r, "80", { cut: true, drawerPin: cardRule });
assert.equal(find(withDrawer, drawerKick(2)), 5); assert.equal(find(without, drawerKick(2)), -1);
assert.deepEqual([...withDrawer.slice(-4)], [0x1d, 0x56, 0x42, 3]);
assert.ok(plainToEscPos("Cash-up\nTotal 1000", { cut: false }).length > 10);
assert.equal(find(plainToEscPos("x", { cut: false }), [0x1d, 0x56]), -1, "no cut when cut is off");
console.log("printer manager tests passed");
