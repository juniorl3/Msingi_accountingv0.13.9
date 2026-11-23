import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { GRACE_DAYS, TRIAL_DAYS, dayDiff, licenceStatus, newComputerCode, normaliseCode, toB64url, validComputerCode, verifyLicence } from "../src/licenseLogic.ts";
import type { Licence } from "../src/licenseLogic.ts";

const subtle = webcrypto.subtle;
const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await subtle.exportKey("jwk", kp.publicKey);
const other = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
async function issue(p: unknown, key = kp.privateKey) {
  const b = toB64url(new TextEncoder().encode(JSON.stringify(p)));
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`MSG1.${b}`)));
  return `MSG1.${b}.${toB64url(sig)}`;
}

// computer codes
const code = newComputerCode(webcrypto.getRandomValues(new Uint8Array(16)));
assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
assert.ok(validComputerCode(code) && validComputerCode(code.toLowerCase().replace("-", " ")));
assert.equal(normaliseCode("abcde-fghjk"), "ABCDEFGHJK");
assert.equal(normaliseCode("O0-Il"), "00" + "11");
assert.ok(!validComputerCode("short") && !validComputerCode("UUUUU-UUUUU"));   // U is not in the alphabet

// keys
const good: Licence = { v: 1, client: "Duka la Juma", computer: code, issued: "2026-11-15", expires: "2027-11-15" };
const key = await issue(good);
const v = await verifyLicence(key, code, pub, subtle);
assert.ok(v.ok && v.licence.client === "Duka la Juma");
assert.ok((await verifyLicence(key.replace(/\./g, ".\n  "), code.toLowerCase(), pub, subtle)).ok, "whitespace and case are tolerated");
assert.ok(!(await verifyLicence(key, "ABCDE-FGHJK", pub, subtle)).ok, "other computer");
assert.match((await verifyLicence(key, "ABCDE-FGHJK", pub, subtle) as any).error, /different computer/);
assert.ok((await verifyLicence(await issue({ ...good, computer: "*" }), "ABCDE-FGHJK", pub, subtle)).ok, "any-computer key");
assert.ok(!(await verifyLicence(await issue(good, other.privateKey), code, pub, subtle)).ok, "signed by someone else");
const [p0, p1, p2] = key.split(".");
const forged = toB64url(new TextEncoder().encode(JSON.stringify({ ...good, expires: "2099-01-01" })));
assert.ok(!(await verifyLicence(`${p0}.${forged}.${p2}`, code, pub, subtle)).ok, "edited payload");
assert.ok(!(await verifyLicence("nonsense", code, pub, subtle)).ok);
assert.ok(!(await verifyLicence(`${p0}.${p1}`, code, pub, subtle)).ok);
assert.ok(!(await verifyLicence(`${p0}.${p1}.!!!`, code, pub, subtle)).ok);
assert.ok(!(await verifyLicence(await issue({ ...good, expires: "soon" }), code, pub, subtle)).ok, "malformed fields");
assert.ok(!(await verifyLicence(await issue({ ...good, client: "" }), code, pub, subtle)).ok);
assert.ok((await verifyLicence(await issue({ ...good, expires: null }), code, pub, subtle)).ok, "no expiry");

// status
assert.equal(dayDiff("2026-02-28", "2026-03-01"), 1);
const base = { lastSeen: null, firstRun: "2026-11-01" };
let s = licenceStatus({ ...base, today: "2026-11-15", licence: null });
assert.deepEqual([s.state, s.usable, s.daysLeft], ["trial", true, TRIAL_DAYS - 14]);
s = licenceStatus({ ...base, today: "2026-12-01", licence: null });
assert.deepEqual([s.state, s.usable], ["blocked", false]);
const lic = (expires: string | null): Licence => ({ ...good, expires });
assert.equal(licenceStatus({ ...base, today: "2026-11-15", licence: lic(null) }).state, "licensed");
assert.equal(licenceStatus({ ...base, today: "2026-11-15", licence: lic("2027-11-15") }).state, "licensed");
assert.equal(licenceStatus({ ...base, today: "2026-11-15", licence: lic("2026-12-10") }).state, "expiring");
s = licenceStatus({ ...base, today: "2026-11-15", licence: lic("2026-11-15") });
assert.deepEqual([s.state, s.usable, s.daysLeft], ["expiring", true, 0]);
s = licenceStatus({ ...base, today: "2026-11-16", licence: lic("2026-11-15") });
assert.deepEqual([s.state, s.usable], ["grace", true]);
s = licenceStatus({ ...base, today: "2026-11-29", licence: lic("2026-11-15") });
assert.equal(s.state, "grace"); assert.equal(GRACE_DAYS, 14);
s = licenceStatus({ ...base, today: "2026-11-30", licence: lic("2026-11-15") });
assert.deepEqual([s.state, s.usable], ["blocked", false]);
// clock wound back does not help
s = licenceStatus({ firstRun: "2026-11-01", lastSeen: "2026-12-20", today: "2026-11-02", licence: null });
assert.deepEqual([s.state, s.usable, s.clockBehind], ["blocked", false, true]);
s = licenceStatus({ firstRun: "2026-11-01", lastSeen: "2026-11-15", today: "2026-11-15", licence: null });
assert.equal(s.clockBehind, false);
console.log("licence tests passed");
