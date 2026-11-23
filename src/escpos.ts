// ESC/POS encoder for thermal receipt printers and the cash drawer wired to them. Pure (no Tauri), so it can be tested.
// The layout is the same text layout used for the on-screen receipt, so what prints matches what is shown.
import { COLS, receiptText, wrap } from "./receipt.ts";
import type { PaperWidth, Receipt } from "./receipt.ts";

export type DrawerPin = 2 | 5;
export type DrawerRule = "off" | "cash" | "always";
export type EscOptions = { cut?: boolean; drawerPin?: DrawerPin | null };

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

/** ESC p m t1 t2: pulses the drawer connector (pin 2 or pin 5). t1/t2 are in units of 2 ms: 50 ms on, 500 ms off is the common default. */
export const drawerKick = (pin: DrawerPin = 2): number[] => [ESC, 0x70, pin === 2 ? 0 : 1, 25, 250];

const FOLD: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "*", "×": "x", "·": "-", "€": "EUR", " ": " ", "\t": " " };
/** Printers use a single-byte code page, so anything outside plain ASCII is simplified (é becomes e) or shown as "?". */
export function toPrinterText(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    if (ch === "\n") out += ch;
    else if (/[̀-ͯ]/.test(ch)) continue;
    else if (FOLD[ch] !== undefined) out += FOLD[ch];
    else { const c = ch.charCodeAt(0); out += c >= 0x20 && c <= 0x7e ? ch : c < 0x20 || c === 0x7f ? "" : "?"; }
  }
  return out;
}

class Job {
  bytes: number[] = [];
  raw(b: number[]) { this.bytes.push(...b); return this; }
  init() { return this.raw([ESC, 0x40, ESC, 0x74, 0]); }                       // reset, code page PC437
  bold(on: boolean) { return this.raw([ESC, 0x45, on ? 1 : 0]); }
  line(s: string, bold = false) { if (bold) this.bold(true); for (const ch of toPrinterText(s)) this.bytes.push(ch.charCodeAt(0)); if (bold) this.bold(false); return this.raw([LF]); }
  finish(o: EscOptions) { this.raw([ESC, 0x64, o.cut === false ? 4 : 2]); if (o.cut !== false) this.raw([GS, 0x56, 0x42, 3]); return Uint8Array.from(this.bytes); }
}
const start = (o: EscOptions) => { const j = new Job().init(); if (o.drawerPin) j.raw(drawerKick(o.drawerPin)); return j; };

/** A customer receipt. Business name and the TOTAL line are bold. */
export function receiptToEscPos(r: Receipt, paper: PaperWidth, o: EscOptions = {}): Uint8Array {
  const cols = COLS[paper], j = start(o), nameLines = wrap(r.business.name || "Receipt", cols).length;
  receiptText(r, cols).split("\n").forEach((l, i) => j.line(l, i < nameLines || l.startsWith("TOTAL (TZS)")));
  return j.finish(o);
}
/** Any plain-text slip (cash-up, shift, refund, cashier report). */
export function plainToEscPos(text: string, o: EscOptions = {}): Uint8Array {
  const j = start(o); for (const l of text.split("\n")) j.line(l); return j.finish(o);
}
/** Opens the drawer without printing anything. */
export const drawerOnly = (pin: DrawerPin = 2): Uint8Array => Uint8Array.from([ESC, 0x40, ESC, 0x74, 0, ...drawerKick(pin)]);
/** A short page to check width, bold text and cutting. */
export function testPage(paper: PaperWidth, o: EscOptions = {}): Uint8Array {
  const cols = COLS[paper], j = start({ ...o, drawerPin: null });
  j.line("MSINGI PRINTER TEST", true).line("-".repeat(cols));
  j.line(`Paper ${paper} mm, ${cols} columns`).line("1234567890".repeat(5).slice(0, cols)).line("The line above should fit exactly.").line("Karibu! Asante sana.");
  return j.finish(o);
}

/** Should the drawer open for this sale? "cash" opens it when any part of the payment is cash. */
export function drawerWanted(rule: DrawerRule, r: Pick<Receipt, "payment" | "payments">): boolean {
  if (rule === "always") return true;
  if (rule === "off") return false;
  return r.payment === "Cash" || !!r.payments?.some(p => p.method === "Cash");
}
