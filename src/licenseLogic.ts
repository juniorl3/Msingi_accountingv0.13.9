// Offline licence keys. Pure logic: no database, no screen, so it can be tested.
//
// A key looks like  MSG1.<payload>.<signature>.  The payload (client name, computer code, expiry) is signed with a private key that only the
// seller holds; the app contains the matching public key and can check a key without internet. The key is tied to one computer's code
// unless it was issued for any computer ("*").
//
// Honest limit: this keeps honest customers honest. Someone who edits the app itself can remove the check. Use a contract for the rest.

export type Licence = { v: 1; client: string; computer: string; issued: string; expires: string | null };
export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 14;
export const WARN_DAYS = 30;
const PREFIX = "MSG1";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ---- base64url -----------------------------------------------------------------------------------------------------------------
export function toB64url(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(t: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(t)) throw new Error("bad encoding");
  const s = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

// ---- computer code -------------------------------------------------------------------------------------------------------------
/** Ten characters shown as XXXXX-XXXXX. The customer sends this to the seller, who issues a key for it. */
export function newComputerCode(random: Uint8Array): string {
  let s = ""; for (let i = 0; i < 10; i++) s += ALPHABET[random[i] & 31];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
/** Upper case, ignores dashes and spaces, and fixes the look-alike letters O, I and L. */
export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
export const validComputerCode = (c: string) => normaliseCode(c).length === 10 && [...normaliseCode(c)].every(ch => ALPHABET.includes(ch));

// ---- dates (YYYY-MM-DD strings) -----------------------------------------------------------------------------------------------
const DAY = 86400000;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
export const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY);

// ---- verifying a key -----------------------------------------------------------------------------------------------------------
export type Verified = { ok: true; licence: Licence } | { ok: false; error: string };
const ECDSA = { name: "ECDSA", hash: "SHA-256" } as const;

export function parseLicence(payload: unknown): Licence | null {
  const p = payload as Partial<Licence> | null;
  if (!p || p.v !== 1 || typeof p.client !== "string" || !p.client.trim() || p.client.length > 80 || typeof p.computer !== "string" || !isDate(p.issued)) return null;
  if (p.computer !== "*" && !validComputerCode(p.computer)) return null;
  if (p.expires !== null && !isDate(p.expires)) return null;
  return { v: 1, client: p.client.trim(), computer: p.computer, issued: p.issued, expires: p.expires };
}

export async function verifyLicence(key: string, computer: string, publicKey: JsonWebKey, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<Verified> {
  const bad = (error: string): Verified => ({ ok: false, error });
  const parts = key.replace(/\s+/g, "").split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return bad("That is not a Msingi licence key. Check it was copied completely.");
  let payload: unknown, sig: Uint8Array;
  try { payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); sig = fromB64url(parts[2]); } catch { return bad("That licence key is damaged. Check it was copied completely."); }
  try {
    const k = await subtle.importKey("jwk", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (!(await subtle.verify(ECDSA, k, sig as BufferSource, new TextEncoder().encode(`${PREFIX}.${parts[1]}`)))) return bad("That licence key is not valid.");
  } catch { return bad("That licence key could not be checked."); }
  const licence = parseLicence(payload);
  if (!licence) return bad("That licence key is not valid.");
  if (licence.computer !== "*" && normaliseCode(licence.computer) !== normaliseCode(computer)) return bad("That key was issued for a different computer. Send this computer's code to your supplier for a new key.");
  return { ok: true, licence };
}

// ---- what the app should do today ----------------------------------------------------------------------------------------------
export type LicenceState = "licensed" | "expiring" | "trial" | "grace" | "blocked";
export type LicenceStatus = { state: LicenceState; usable: boolean; daysLeft: number | null; text: string; clockBehind: boolean };

/** `today` and `lastSeen` are local dates. If the computer's clock was set back, the latest date ever seen is used, so winding the clock back does not extend a licence. */
export function licenceStatus(i: { today: string; lastSeen: string | null; firstRun: string; licence: Licence | null }): LicenceStatus {
  const clockBehind = !!i.lastSeen && i.lastSeen > i.today, now = clockBehind ? i.lastSeen! : i.today;
  const note = clockBehind ? " This computer's clock is behind. Please correct the date." : "";
  const out = (state: LicenceState, usable: boolean, daysLeft: number | null, text: string): LicenceStatus => ({ state, usable, daysLeft, text: text + note, clockBehind });
  if (i.licence) {
    const L = i.licence;
    if (L.expires === null) return out("licensed", true, null, `Licensed to ${L.client}.`);
    const left = dayDiff(now, L.expires);
    if (left > WARN_DAYS) return out("licensed", true, left, `Licensed to ${L.client} until ${L.expires}.`);
    if (left >= 0) return out("expiring", true, left, `Your licence ends ${left === 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`} (${L.expires}). Contact your supplier to renew.`);
    if (-left <= GRACE_DAYS) return out("grace", true, left, `Your licence ended on ${L.expires}. Msingi will stop opening in ${GRACE_DAYS + left} day${GRACE_DAYS + left === 1 ? "" : "s"} unless you renew.`);
    return out("blocked", false, left, `Your licence ended on ${L.expires}. Enter a renewal key to continue. Your data is safe and you can save a backup.`);
  }
  const used = dayDiff(i.firstRun, now), left = TRIAL_DAYS - used;
  if (left > 0) return out("trial", true, left, `Free trial: ${left} day${left === 1 ? "" : "s"} left. Enter a licence key to continue after that.`);
  return out("blocked", false, 0, "The free trial has ended. Enter a licence key to continue. Your data is safe and you can save a backup.");
}
