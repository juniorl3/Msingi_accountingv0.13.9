// Receipt header details and printer preferences.
// Business details live in the settings table (per business). Paper width and auto-print are per computer (the printer is), so they use localStorage.
import { db } from "./db";
import { getActiveBusiness } from "./business";
import type { Receipt, PaperWidth, ReceiptBusiness } from "./receipt";
import type { DrawerPin, DrawerRule } from "./escpos";

export type ReceiptDetails = Omit<ReceiptBusiness, "name">;
const FIELDS = ["address", "phone", "tin", "footer"] as const;
const MAX: Record<(typeof FIELDS)[number], number> = { address: 120, phone: 40, tin: 30, footer: 160 };

export async function getReceiptBusiness(): Promise<ReceiptBusiness> {
  const biz = await getActiveBusiness(), d = await db();
  const rows = await d.select<Array<{ key: string; value: string }>>("SELECT key,value FROM settings WHERE key LIKE ?", [`receipt_${biz.id}_%`]);
  const get = (f: string) => rows.find(r => r.key === `receipt_${biz.id}_${f}`)?.value ?? "";
  return { name: biz.name, address: get("address"), phone: get("phone"), tin: get("tin"), footer: get("footer") || "Thank you for your business" };
}
export async function saveReceiptDetails(v: ReceiptDetails) {
  const biz = await getActiveBusiness(), d = await db();
  for (const f of FIELDS) {
    const val = v[f].trim().replace(/[\r\t]+/g, " ");
    if (val.length > MAX[f]) throw new Error(`The ${f} is too long (maximum ${MAX[f]} characters).`);
    await d.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [`receipt_${biz.id}_${f}`, val]);
  }
}

import { cleanPrefs, DEFAULT_PREFS } from "./printerPrefs";
import type { PrinterPrefs, PrintMode } from "./printerPrefs";
export { cleanPrefs, DEFAULT_PREFS };
export type { PrinterPrefs, PrintMode };
const PREF_KEY = "msingi_receipt_prefs", RECENT_KEY = "msingi_recent_receipts";
export function loadPrefs(): PrinterPrefs {
  try { return cleanPrefs(JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}")); } catch { return { ...DEFAULT_PREFS }; }
}
/** Saves the printer settings and tells the rest of the app, so every screen uses the same paper width straight away. */
export const PREFS_EVENT = "msingi-prefs";
export function savePrefs(p: PrinterPrefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage unavailable: preferences just reset next time */ }
  try { window.dispatchEvent(new Event(PREFS_EVENT)); } catch { /* no window (tests) */ }
}
export function loadRecent(): Receipt[] { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }
/** Replaces a saved recent receipt (same number) with an updated copy, e.g. after a fiscal receipt number was added. */
export function updateRecent(r: Receipt): Receipt[] {
  const next = loadRecent().map(x => (x.number === r.number && x.business.name === r.business.name ? r : x));
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
export function pushRecent(r: Receipt): Receipt[] {
  const next = [r, ...loadRecent().filter(x => !(x.number === r.number && x.business.name === r.business.name))].slice(0, 20);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
