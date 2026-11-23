// Run: node --experimental-strip-types tests/keypad.test.ts
import assert from "node:assert/strict";
import { pressKey } from "../src/keypadLogic.ts";

// first digit replaces the existing value (tap 5 on a quantity of 1 gives 5), later digits append
let v = pressKey("1", "5", "qty", true); assert.equal(v, "5");
v = pressKey(v, "2", "qty"); assert.equal(v, "52");
// no leading zeros
assert.equal(pressKey("0", "5", "qty"), "5");
assert.equal(pressKey("0", "0", "price"), "0");
// decimals: qty only, one point, at most 3 places
assert.equal(pressKey("", ".", "qty"), "0.");
assert.equal(pressKey("2", ".", "qty"), "2.");
assert.equal(pressKey("2.5", ".", "qty"), "2.5");
assert.equal(pressKey("2", ".", "price"), "2");
assert.equal(pressKey("2", ".", "tendered"), "2");
assert.equal(pressKey("1.123", "4", "qty"), "1.123");
assert.equal(pressKey("1.12", "4", "qty"), "1.124");
// a fresh "." starts from 0.
assert.equal(pressKey("7", ".", "qty", true), "0.");
// backspace and clear
assert.equal(pressKey("123", "back", "price"), "12");
assert.equal(pressKey("", "back", "price"), "");
assert.equal(pressKey("123", "clear", "price"), "");
// length cap
assert.equal(pressKey("123456789012", "1", "price"), "123456789012");
console.log("keypad tests passed");

// v0.9.0 kinds: PIN, percent, money
import { canApply } from "../src/keypadLogic.ts";
assert.equal(pressKey("", "0", "pin"), "0");            // a PIN may start with 0
assert.equal(pressKey("0", "7", "pin"), "07");
assert.equal(pressKey("123456", "7", "pin"), "123456"); // PIN is at most 6 digits
assert.equal(pressKey("1", ".", "pin"), "1");
assert.equal(canApply("123", "pin"), false); assert.equal(canApply("1234", "pin"), true); assert.equal(canApply("", "pin"), false);
assert.equal(pressKey("10", ".", "percent"), "10.");
assert.equal(pressKey("10.5", "5", "percent"), "10.55");
assert.equal(pressKey("10.55", "5", "percent"), "10.55"); // 2 decimals
assert.equal(pressKey("10", "1", "percent"), "10"); // over 100% refused
assert.equal(pressKey("", "5", "money"), "5"); assert.equal(pressKey("5", ".", "money"), "5");
assert.equal(canApply("", "money"), true); assert.equal(canApply("0", "price"), false); assert.equal(canApply("2", "qty"), true);
console.log("keypad v0.9 tests passed");
