// Bridge from the till screens to the printer commands in the Tauri backend.
import { invoke } from "@tauri-apps/api/core";
import { getActiveBusiness } from "./business";
import { db } from "./db";
import { drawerOnly, testPage } from "./escpos";
import { recordAction } from "./posLog";
import type { Actor } from "./posLog";
import type { PrinterPrefs } from "./receiptDb";
import { readiness, setPrinterStatus, statusFrom } from "./printerManager";

export const usesRawPrinting = (p: PrinterPrefs) => p.mode !== "system";

/** Sends ESC/POS bytes to the configured printer. Throws a readable message if it cannot. */
export async function sendBytes(p: PrinterPrefs, bytes: Uint8Array): Promise<void> {
  if (p.mode === "system") throw new Error("Choose a network or USB receipt printer in the printer settings first.");
  const ready = readiness(p);
  if (!ready.ok) { setPrinterStatus(statusFrom(p, ready.message)); throw new Error(`${ready.message} Open the printer settings.`); }
  const target = p.mode === "network" ? p.host : p.queue;
  try { await invoke("print_raw", { mode: p.mode, target, port: p.port, data: Array.from(bytes) }); setPrinterStatus(statusFrom(p, undefined)); }
  catch (e) { const m = typeof e === "string" ? e : e instanceof Error ? e.message : "Printing failed."; setPrinterStatus(statusFrom(p, m)); throw new Error(m); }
}

/** Asks the backend whether the printer answers now. Sends nothing to it. Updates the shared status and returns it. */
export async function checkPrinter(p: PrinterPrefs) {
  if (p.mode === "system") { const s = statusFrom(p, undefined); setPrinterStatus(s); return s; }
  const ready = readiness(p);
  if (!ready.ok) { const s = statusFrom(p, ready.message); setPrinterStatus(s); return s; }
  const target = p.mode === "network" ? p.host : p.queue;
  let err: string | undefined;
  try { await invoke("check_printer", { mode: p.mode, target, port: p.port }); }
  catch (e) { err = typeof e === "string" ? e : e instanceof Error ? e.message : "The printer did not answer."; }
  const s = statusFrom(p, err); setPrinterStatus(s); return s;
}
export const listPrintQueues = () => invoke<string[]>("list_print_queues");

export const printTestPage = (p: PrinterPrefs) => sendBytes(p, testPage(p.paper, { cut: p.cut }));
export function kickDrawer(p: PrinterPrefs) {
  if (p.mode === "system") throw new Error("The cash drawer opens through a network or USB receipt printer. Choose one in the printer settings.");
  return sendBytes(p, drawerOnly(p.drawerPin));
}

/** Opens the drawer with no sale (change, float top-up). The signed-in user, and any approving manager, are recorded. */
export async function openDrawerNoSale(p: PrinterPrefs, actor: Actor): Promise<void> {
  await kickDrawer(p);
  const biz = await getActiveBusiness();
  await recordAction(await db(), { businessId: biz.id, kind: "drawer", userId: actor.userId, approverId: actor.approverId, shiftId: actor.shiftId, reason: "No sale" });
}
