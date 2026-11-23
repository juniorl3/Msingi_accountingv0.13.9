// Run: node --experimental-strip-types tests/dbRetry.test.ts
import assert from "node:assert/strict";
import { isBusy, retryBusy } from "../src/dbRetry.ts";

const noSleep = async () => {};
const waits: number[] = [];
const rec = async (ms: number) => { waits.push(ms); };

assert.equal(isBusy(new Error("error returned from database: (code: 5) database is locked")), true);
assert.equal(isBusy("SQLITE_BUSY"), true);
assert.equal(isBusy("database table is locked"), true);
assert.equal(isBusy(new Error("UNIQUE constraint failed: items.barcode")), false);

// succeeds at once
assert.equal(await retryBusy(async () => 7, 6, 1, noSleep), 7);

// busy twice, then works: retried, with growing waits
let n = 0;
assert.equal(await retryBusy(async () => { if (++n < 3) throw new Error("database is locked"); return "ok"; }, 6, 100, rec), "ok");
assert.equal(n, 3); assert.deepEqual(waits, [100, 200]);

// always busy: gives up after the allowed runs and throws the busy error
n = 0;
await assert.rejects(retryBusy(async () => { n++; throw new Error("database is locked"); }, 4, 1, noSleep), /database is locked/);
assert.equal(n, 4);

// any other error is thrown straight away, never retried
n = 0;
await assert.rejects(retryBusy(async () => { n++; throw new Error("no such table: sales"); }, 6, 1, noSleep), /no such table/);
assert.equal(n, 1);
console.log("db retry tests passed");
