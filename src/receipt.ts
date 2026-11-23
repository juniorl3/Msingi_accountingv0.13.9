// Receipt model and rendering. Pure (no imports) so it can be tested and reused for print, file and copy-as-text.

export type PaperWidth = "58" | "80";
export type ReceiptBusiness = { name: string; address: string; phone: string; tin: string; footer: string };
export type ReceiptLine = { name: string; qty: string; unitPrice: number; amount: number; discount?: number }; // amount is before any discount
export type Receipt = {
  business: ReceiptBusiness; number: string; date: string; time: string; lines: ReceiptLine[];
  total: number; vat: number; net: number; vatRegistered: boolean; payment: string;
  customer?: string; invoice?: string; tendered?: number; change?: number; note?: string; cashier?: string;
  payments?: Array<{ method: string; amount: number }>; // present when the sale was split between methods
  eventId?: number; // the sale record, so a fiscal receipt number can be attached afterwards
  fiscal?: { receiptNo: string; code: string }; // issued by the business's own approved EFD/VFD device and typed or scanned in; Msingi does not create or check it
};

export const fmtTzs = (n: number) => n.toLocaleString("en-TZ");
/** Characters per line on a thermal printer using the default font. */
export const COLS: Record<PaperWidth, number> = { "58": 32, "80": 48 };

/** Wraps text to `w` columns, breaking over-long words. */
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > w) { if (line) { out.push(line); line = ""; } out.push(word.slice(0, w)); word = word.slice(w); }
      if (!line) line = word; else if ((line + " " + word).length <= w) line += " " + word; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}
const center = (s: string, w: number) => (s.length >= w ? s : " ".repeat(Math.floor((w - s.length) / 2)) + s);
/** "label ........ value" on one line of width w. If it does not fit, the label is shortened. */
export function pair(label: string, value: string, w: number): string {
  const room = w - value.length - 1;
  const l = label.length > room ? label.slice(0, Math.max(0, room)) : label;
  return l + " ".repeat(Math.max(1, w - l.length - value.length)) + value;
}

/** Plain-text receipt, `cols` characters wide: for the preview, copy-to-clipboard (e.g. WhatsApp) and testing. */
export function receiptText(r: Receipt, cols: number): string {
  const L: string[] = [], rule = "-".repeat(cols), dbl = "=".repeat(cols);
  const b = r.business;
  for (const s of wrap(b.name || "Receipt", cols)) L.push(center(s, cols));
  for (const s of b.address ? wrap(b.address, cols) : []) L.push(center(s, cols));
  if (b.phone) L.push(center(`Tel: ${b.phone}`, cols));
  if (b.tin) L.push(center(`TIN: ${b.tin}`, cols));
  L.push(rule);
  L.push(pair(`Receipt ${r.number}`, "", cols).trimEnd());
  L.push(pair(r.date, r.time, cols));
  if (r.cashier) L.push(pair("Served by", r.cashier, cols));
  if (r.customer) L.push(...wrap(`Customer: ${r.customer}`, cols));
  L.push(rule);
  for (const ln of r.lines) {
    L.push(...wrap(ln.name, cols));
    L.push(pair(`  ${ln.qty} x ${fmtTzs(ln.unitPrice)}`, fmtTzs(ln.amount), cols));
    if (ln.discount) L.push(pair("  Discount", "-" + fmtTzs(ln.discount), cols));
  }
  L.push(rule);
  if (r.vatRegistered && r.vat > 0) { L.push(pair("Subtotal (excl. VAT)", fmtTzs(r.net), cols)); L.push(pair("VAT", fmtTzs(r.vat), cols)); }
  L.push(pair("TOTAL (TZS)", fmtTzs(r.total), cols));
  L.push(dbl);
  if (r.invoice) L.push(...wrap(`On credit - invoice ${r.invoice}`, cols));
  else if (r.payments && r.payments.length > 1) { for (const p of r.payments) L.push(pair(`Paid by ${p.method}`, fmtTzs(p.amount), cols)); }
  else {
    L.push(pair(`Paid by ${r.payment}`, fmtTzs(r.tendered ?? r.total), cols));
    if (r.tendered !== undefined && r.change !== undefined) L.push(pair("Change", fmtTzs(r.change), cols));
  }
  if (r.note) L.push(...wrap(r.note, cols));
  if (r.fiscal) { L.push(rule); L.push(...wrap(`Fiscal receipt no: ${r.fiscal.receiptNo}`, cols)); if (r.fiscal.code) L.push(...wrap(`Verification code: ${r.fiscal.code}`, cols)); }
  if (b.footer) { L.push(""); for (const s of wrap(b.footer, cols)) L.push(center(s, cols)); }
  return L.join("\n");
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Receipt CSS, scoped to .rc so it can be injected into the app (print) or used in a standalone file. */
export function receiptCss(paper: PaperWidth): string {
  const width = paper === "58" ? "48mm" : "72mm";
  return `.rc{width:${width};margin:0 auto;padding:2mm 0;color:#000;background:#fff;font:${paper === "58" ? 11 : 12}px/1.35 "SF Mono",Menlo,Consolas,"Courier New",monospace;box-sizing:content-box}
.rc pre{margin:0;font:inherit;white-space:pre-wrap;word-break:break-word}
.rc .rc-name{font-weight:700;font-size:1.25em;text-align:center}`;
}
/** The receipt as HTML. The text layout is reused so what prints matches the copy-as-text version. */
export function receiptHtml(r: Receipt, paper: PaperWidth): string {
  return `<div class="rc"><pre>${esc(receiptText(r, COLS[paper]))}</pre></div>`;
}
/** A standalone HTML page, so a receipt can be saved and printed from any browser. */
export function receiptDocument(r: Receipt, paper: PaperWidth): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.number)}</title><style>@page{size:${paper}mm auto;margin:0}body{margin:0;background:#fff}${receiptCss(paper)}</style></head><body>${receiptHtml(r, paper)}<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`;
}

/** Cash tendered -> change. Returns an error message when the cash does not cover the total. */
export function changeFor(total: number, tendered: number): { change: number } | { error: string } {
  if (!Number.isSafeInteger(tendered) || tendered < 0) return { error: "Enter the cash received in whole TZS." };
  if (tendered < total) return { error: `Cash received is ${fmtTzs(total - tendered)} short of the total.` };
  return { change: tendered - total };
}
