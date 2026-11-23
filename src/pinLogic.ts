// PIN hashing and lockout rules. Uses the Web Crypto API (available in the desktop app's web view and in Node).
// A PIN keeps honest users apart and creates an audit trail. It is not strong protection against someone who copies the database file.
export const validPin = (pin: string) => /^\d{4,6}$/.test(pin);
/** A sign-in secret is either a PIN (digits) or a password: 4 to 64 characters. */
export const validSecret = (s: string) => s.length >= 4 && s.length <= 64 && s.trim() === s;
export const SECRET_RULE = "Use 4 to 64 characters: a PIN (digits) or a password, with no space at the start or end.";
/** Usernames: 2 to 30 letters, digits, dot, dash or underscore, starting with a letter or digit. They are not case-sensitive. */
export const validUsername = (u: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/.test(u);
export const USERNAME_RULE = "A username is 2 to 30 letters, digits, dots, dashes or underscores, and starts with a letter or digit.";
/** "Juma Hassan" becomes "juma.hassan". */
export function suggestUsername(name: string): string {
  const u = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 30);
  return u.length >= 2 ? u : (u + "user").slice(0, 30);
}
export const MAX_FAILS = 5;

const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
export const randomSalt = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));

export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const c = globalThis.crypto.subtle, enc = new TextEncoder();
  const key = await c.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], h => parseInt(h, 16));
  return hex(new Uint8Array(await c.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256)));
}
export async function verifyPin(pin: string, saltHex: string, hashHex: string): Promise<boolean> {
  const h = await hashPin(pin, saltHex);
  let diff = h.length ^ hashHex.length;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ (hashHex.charCodeAt(i) || 0);
  return diff === 0;
}
/** Milliseconds to lock after `fails` wrong PINs in a row: none below 5, then 1 minute doubling up to 15. */
export const lockMs = (fails: number) => (fails < MAX_FAILS ? 0 : Math.min(15 * 60000, 60000 * 2 ** (fails - MAX_FAILS)));
export const waitText = (ms: number) => { const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.ceil(s / 60)} minute(s)` : `${s} second(s)`; };
