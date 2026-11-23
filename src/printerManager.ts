// Printer manager logic: is this computer's printer set up, and is it answering? Pure (no Tauri), so it can be tested.
import type { PrinterPrefs } from "./printerPrefs.ts";

export type PrinterState = "system" | "unknown" | "checking" | "ok" | "problem";
export type PrinterStatus = { state: PrinterState; message: string; at: number };

/** How often the settings screen re-checks a printer that is open on screen. */
export const RECHECK_MS = 30_000;

export type Readiness = { ok: boolean; message: string };

/** Is there enough setup to try printing? Says what is missing in plain words. */
export function readiness(p: Pick<PrinterPrefs, "mode" | "host" | "port" | "queue">): Readiness {
  if (p.mode === "system") return { ok: true, message: "Using the system print dialog." };
  if (p.mode === "network") {
    if (!p.host.trim()) return { ok: false, message: "Enter the printer's IP address." };
    if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) return { ok: false, message: "Enter the printer's port (usually 9100)." };
    return { ok: true, message: `Network printer ${p.host.trim()}:${p.port}.` };
  }
  if (!p.queue.trim()) return { ok: false, message: "Choose the printer's print queue." };
  return { ok: true, message: `Print queue ${p.queue.trim()}.` };
}

/** A short name for what the settings point at, for messages. */
export function targetLabel(p: Pick<PrinterPrefs, "mode" | "host" | "port" | "queue">): string {
  return p.mode === "network" ? `${p.host}:${p.port}` : p.mode === "queue" ? p.queue : "system print dialog";
}

/** Turns a check or print result into a status. `error` undefined means success. */
export function statusFrom(p: Pick<PrinterPrefs, "mode" | "host" | "port" | "queue">, error: string | undefined, now = Date.now()): PrinterStatus {
  if (p.mode === "system") return { state: "system", message: "System print dialog. The printer is chosen when printing.", at: now };
  if (error) return { state: "problem", message: error, at: now };
  return { state: "ok", message: `Ready: ${targetLabel(p)}.`, at: now };
}

export const shouldRecheck = (last: PrinterStatus | null, now = Date.now(), every = RECHECK_MS) => !last || last.state === "checking" ? !last : now - last.at >= every;

/** Same setup? Used to forget an old status when the person changes the printer. */
export const samePrinter = (a: PrinterPrefs, b: PrinterPrefs) => a.mode === b.mode && a.host === b.host && a.port === b.port && a.queue === b.queue;

// A small shared status, updated by checks and by every real print job, so the screen can show the latest outcome.
let current: PrinterStatus | null = null;
const listeners = new Set<(s: PrinterStatus | null) => void>();
export const getPrinterStatus = () => current;
export function setPrinterStatus(s: PrinterStatus | null) { current = s; listeners.forEach(f => f(s)); }
export function onPrinterStatus(f: (s: PrinterStatus | null) => void) { listeners.add(f); return () => { listeners.delete(f); }; }
