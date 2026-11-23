import { receiptCss, receiptHtml, receiptDocument, receiptText, esc, COLS } from "./receipt";
import type { Receipt, PaperWidth } from "./receipt";
import { drawerOnly, drawerWanted, plainToEscPos, receiptToEscPos } from "./escpos";
import { sendBytes } from "./printerApi";
import { loadPrefs } from "./receiptDb";

// Raw printing runs in the background, so failures are reported through this handler (the App shows them as a notice).
let onPrintError: (message: string) => void = () => {};
export const setPrintErrorHandler = (f: (message: string) => void) => { onPrintError = f; };
const fail = (what: string) => (e: unknown) => onPrintError(`${what} not printed: ${e instanceof Error ? e.message : String(e)}`);

/** Prints HTML through the system print dialog. Everything except #receipt-print is hidden by the print rules in styles.css. */
function printViaDialog(inner: string, paper: PaperWidth): void {
  document.getElementById("receipt-print")?.remove();
  const host = document.createElement("div");
  host.id = "receipt-print";
  host.innerHTML = `<style>@page{size:${paper}mm auto;margin:0}${receiptCss(paper)}</style>${inner}`;
  document.body.appendChild(host);
  const cleanup = () => { host.remove(); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 120000); // safety net if afterprint never fires
  window.setTimeout(() => window.print(), 60);
}

/** Prints a receipt: straight to the receipt printer when one is set up, otherwise through the system print dialog. */
export function printReceipt(r: Receipt, paper: PaperWidth, opts: { drawer?: boolean } = {}): void {
  const p = loadPrefs();
  if (p.mode !== "system") {   // straight to the receipt printer; the drawer pulse goes first, only for a new sale and only if the rule says so
    const pin = opts.drawer && drawerWanted(p.drawerRule, r) ? p.drawerPin : null;
    sendBytes(p, receiptToEscPos(r, paper, { cut: p.cut, drawerPin: pin })).catch(fail("Receipt"));
    return;
  }
  printViaDialog(receiptHtml(r, paper), paper);
}

export const receiptAsText = (r: Receipt, paper: PaperWidth) => receiptText(r, COLS[paper]);
export const receiptAsFile = (r: Receipt, paper: PaperWidth) => receiptDocument(r, paper);

/** Prints any plain-text report (for example the daily cash-up) on the receipt printer. */
export function printPlain(text: string, paper: PaperWidth): void {
  const p = loadPrefs();
  if (p.mode !== "system") { sendBytes(p, plainToEscPos(text, { cut: p.cut })).catch(fail("Slip")); return; }
  printViaDialog(`<div class="rc"><pre>${esc(text)}</pre></div>`, paper);
}

/** After a sale that is not printed automatically, still open the drawer if the rule says so (e.g. cash sales). */
export function openDrawerForSale(r: Receipt): void {
  const p = loadPrefs();
  if (p.mode !== "system" && drawerWanted(p.drawerRule, r)) sendBytes(p, drawerOnly(p.drawerPin)).catch(fail("Drawer pulse"));
}
