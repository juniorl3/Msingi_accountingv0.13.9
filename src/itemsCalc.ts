// Pure helpers for items and stock. No imports: easy to test.
// Quantities are whole "milli-units" (1 piece = 1000, 0.25 kg = 250) so kilograms and litres work without rounding drift.

export type ItemKind = "stock" | "service" | "menu";
export type ItemVat = "none" | "standard" | "zero" | "exempt";
export const KIND_LABEL: Record<ItemKind, string> = { stock: "Stock item (bought and resold)", service: "Service (no stock)", menu: "Menu item / recipe (restaurants)" };

/** "2.5" -> 2500. Rejects anything that is not a positive number with at most 3 decimals. */
export function toMilli(v: number | string): number {
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a quantity above zero.");
  const m = Math.round(n * 1000);
  if (!Number.isSafeInteger(m) || Math.abs(m / 1000 - n) > 1e-9) throw new Error("Quantities can have up to 3 decimal places.");
  return m;
}
export const fromMilli = (m: number) => m / 1000;
export const fmtQty = (m: number) => { const q = m / 1000; return Number.isInteger(q) ? q.toLocaleString("en-TZ") : q.toLocaleString("en-TZ", { maximumFractionDigits: 3 }); };

const big = BigInt;
/** Rounds a*b/c to the nearest whole number using exact integer arithmetic. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new Error("Division by zero.");
  return Number((big(a) * big(b) * 2n + big(c)) / (big(c) * 2n));
}
/** Weighted-average cost of taking `qty` out of a stock holding `onHand` worth `value`. Taking everything takes all the value. */
export function issueValue(onHand: number, value: number, qty: number): number {
  if (qty <= 0) throw new Error("Quantity must be above zero.");
  if (qty > onHand) throw new Error("Not enough stock.");
  return qty === onHand ? value : mulDiv(value, qty, onHand);
}
/** Line amount: quantity (milli-units) x unit price or cost (TZS, up to 2 decimals), rounded to the nearest shilling. */
export const lineAmount = (qtyMilli: number, unitPrice: number) => {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Enter a price of 0 or more.");
  return mulDiv(qtyMilli, Math.round(unitPrice * 100), 100000);
};

/** Splits `total` across `weights` in proportion; the parts always add up to `total`. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!weights.length || sum <= 0) throw new Error("Nothing to allocate across.");
  const parts = weights.map(w => Number((big(total) * big(w)) / big(sum)));
  let left = total - parts.reduce((s, p) => s + p, 0);
  const order = weights.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k][1]]++;
  return parts;
}

// ---------- CSV import ----------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  const src = text.replace(/^﻿/, "");
  const delimiter = (src.split(/\r?\n/, 1)[0].match(/;/g)?.length ?? 0) > (src.split(/\r?\n/, 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delimiter) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x.trim() !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim() !== "")) rows.push(row);
  return rows;
}

export type ImportRow = { line: number; code: string; barcode: string; name: string; category: string; kind: ItemKind; unit: string; price: number; priceIncludesVat: boolean; vat: ItemVat; reorderMilli: number; openingMilli: number; openingUnitCost: number };
export const IMPORT_HEADER = ["code", "name", "barcode", "category", "type", "unit", "price", "price_includes_vat", "vat", "reorder_level", "opening_qty", "opening_unit_cost"];
export const IMPORT_TEMPLATE = [IMPORT_HEADER.join(","), "SODA-500,Soda 500ml,6001234567890,Drinks,stock,piece,1000,yes,standard,24,48,600", "RICE-1KG,Rice 1kg,,Groceries,stock,kg,3500,yes,exempt,10,25.5,2800", "HAIR-CUT,Haircut,,Services,service,job,10000,yes,standard,,,", "CHIPS,Chips (portion),,Menu,menu,plate,5000,yes,standard,,,"].join("\r\n") + "\r\n";

const kindOf = (v: string): ItemKind | null => { const s = v.trim().toLowerCase(); return ["stock", "goods", "product", "item"].includes(s) || s === "" ? "stock" : ["service", "services"].includes(s) ? "service" : ["menu", "dish", "recipe", "menu item"].includes(s) ? "menu" : null; };
const vatOf = (v: string): ItemVat | null => { const s = v.trim().toLowerCase(); return s === "" || s === "standard" || s === "std" ? "standard" : ["none", "no vat", "n/a"].includes(s) ? "none" : ["zero", "zero-rated", "zero rated"].includes(s) ? "zero" : s === "exempt" ? "exempt" : null; };
const yes = (v: string) => (/^(1|y|yes|true)$/i.test(v.trim()) ? true : /^(0|n|no|false)$/i.test(v.trim()) ? false : null);

export function parseItemImport(text: string): { rows: ImportRow[]; errors: string[] } {
  const grid = parseCsv(text), errors: string[] = [], rows: ImportRow[] = [];
  if (grid.length < 2) return { rows, errors: ["The file has no item rows. Use the template: a header row, then one item per row."] };
  const head = grid[0].map(h => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (name: string) => head.indexOf(name);
  for (const need of ["code", "name", "price"]) if (col(need) < 0) return { rows, errors: [`The header row needs a "${need}" column. Download the template to see the layout.`] };
  const seen = new Set<string>();
  grid.slice(1).forEach((r, idx) => {
    const line = idx + 2, g = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    const bad = (m: string) => errors.push(`Row ${line}: ${m}`);
    const code = g("code"), name = g("name");
    if (!code) return bad("code is missing.");
    if (!name) return bad(`name is missing for ${code}.`);
    if (seen.has(code.toLowerCase())) return bad(`code ${code} appears twice in this file.`);
    seen.add(code.toLowerCase());
    const kind = kindOf(g("type")); if (!kind) return bad(`type "${g("type")}" is not stock, service or menu.`);
    const vat = vatOf(g("vat")); if (!vat) return bad(`vat "${g("vat")}" is not standard, zero, exempt or none.`);
    const inc = g("price_includes_vat") === "" ? true : yes(g("price_includes_vat")); if (inc === null) return bad("price_includes_vat must be yes or no.");
    const priceTxt = g("price").replace(/,/g, ""), price = Number(priceTxt);
    if (priceTxt === "" || !Number.isSafeInteger(price) || price < 0) return bad(`price for ${code} must be a whole number of TZS (0 or more).`);
    let reorderMilli = 0, openingMilli = 0, openingUnitCost = 0;
    try {
      if (g("reorder_level")) reorderMilli = toMilli(g("reorder_level"));
      if (g("opening_qty")) {
        if (kind !== "stock") return bad(`${code}: only stock items can have opening stock.`);
        openingMilli = toMilli(g("opening_qty"));
        const c = Number(g("opening_unit_cost").replace(/,/g, ""));
        if (!Number.isFinite(c) || c < 0) return bad(`opening_unit_cost for ${code} must be a number.`);
        openingUnitCost = c;
      }
    } catch (e) { return bad(`${code}: ${e instanceof Error ? e.message : e}`); }
    rows.push({ line, code, barcode: g("barcode"), name, category: g("category"), kind, unit: g("unit") || "piece", price, priceIncludesVat: inc, vat, reorderMilli, openingMilli, openingUnitCost });
  });
  return { rows, errors };
}
