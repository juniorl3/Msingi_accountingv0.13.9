import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoBackupDue, upgraded, cleanAutoLock, idleExpired, integrityProblem, DEFAULT_AUTO_LOCK } from "../src/healthLogic.ts";
import { APP_VERSION } from "../src/version.ts";

const now = new Date("2026-11-14T10:00:00Z");
assert.equal(autoBackupDue(null, now), true);
assert.equal(autoBackupDue(new Date("garbage"), now), true);
assert.equal(autoBackupDue(new Date("2026-11-14T08:00:00Z"), now), false);
assert.equal(autoBackupDue(new Date("2026-11-13T10:00:00Z"), now), true);
assert.equal(autoBackupDue(new Date("2026-11-13T10:00:01Z"), now), false);

assert.equal(upgraded(null, "0.11.0"), false);
assert.equal(upgraded("0.11.0", "0.11.0"), false);
assert.equal(upgraded("0.10.0", "0.11.0"), true);

assert.equal(cleanAutoLock("5"), 5);
assert.equal(cleanAutoLock(0), 0);
assert.equal(cleanAutoLock("7"), DEFAULT_AUTO_LOCK);
assert.equal(cleanAutoLock("abc"), DEFAULT_AUTO_LOCK);
assert.equal(cleanAutoLock(undefined), DEFAULT_AUTO_LOCK);

assert.equal(idleExpired(0, 600000, 10), true);
assert.equal(idleExpired(0, 599999, 10), false);
assert.equal(idleExpired(0, 10 ** 9, 0), false);

assert.equal(integrityProblem([{ quick_check: "ok" }]), null);
assert.match(integrityProblem([{ quick_check: "row 3 missing from index" }])!, /row 3/);
assert.ok(integrityProblem([]));

const pkg = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync("src-tauri/Cargo.toml", "utf8"))![1];
assert.deepEqual([pkg, tauri, cargo], [APP_VERSION, APP_VERSION, APP_VERSION], "version strings must all match src/version.ts");
console.log("health tests passed");
