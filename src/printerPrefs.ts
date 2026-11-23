// Printer settings for this computer: the shape, the defaults and the cleaning of stored values. Pure (no Tauri, no storage), so it can be tested.
import type { PaperWidth } from "./receipt.ts";
import type { DrawerPin, DrawerRule } from "./escpos.ts";

/** system = the normal print dialog; network = ESC/POS straight to the printer's IP address; queue = ESC/POS to a print queue on this computer (USB). */
export type PrintMode = "system" | "network" | "queue";
export type PrinterPrefs = { paper: PaperWidth; autoPrint: boolean; mode: PrintMode; host: string; port: number; queue: string; cut: boolean; drawerRule: DrawerRule; drawerPin: DrawerPin };
export const DEFAULT_PREFS: PrinterPrefs = { paper: "80", autoPrint: false, mode: "system", host: "", port: 9100, queue: "", cut: true, drawerRule: "off", drawerPin: 2 };
/** Accepts whatever is stored and returns safe values, so a damaged or older settings entry never breaks printing. */
export function cleanPrefs(p: Partial<Record<keyof PrinterPrefs, unknown>>): PrinterPrefs {
  const port = Number(p.port);
  return {
    paper: p.paper === "58" ? "58" : "80", autoPrint: p.autoPrint === true,
    mode: p.mode === "network" || p.mode === "queue" ? p.mode : "system",
    host: typeof p.host === "string" ? p.host.trim().slice(0, 253) : "", port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 9100,
    queue: typeof p.queue === "string" ? p.queue.trim().slice(0, 127) : "", cut: p.cut !== false,
    drawerRule: p.drawerRule === "cash" || p.drawerRule === "always" ? p.drawerRule : "off", drawerPin: p.drawerPin === 5 ? 5 : 2,
  };
}
