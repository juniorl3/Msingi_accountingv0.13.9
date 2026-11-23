// Pure sale totals: what the customer actually pays once VAT is added or taken out, grouped exactly as the ledger posts it.
import { vatFromEntered } from "./vat.ts";

export type SaleLineCalc = { amount: number; service: boolean; treatment: "none" | "standard" | "zero" | "exempt"; priceIncludesVat: boolean };
export type SaleGroup = { key: string; entered: number; net: number; vat: number; gross: number };

/** Groups by revenue account + VAT treatment + price-includes-VAT (the same key the ledger uses) and works out VAT per group. */
export function saleGroups(lines: SaleLineCalc[], vatRegistered: boolean, ratePercent: number): SaleGroup[] {
  const m = new Map<string, number>();
  for (const l of lines) {
    const treatment = vatRegistered ? l.treatment : "none";
    const includes = treatment === "standard" ? l.priceIncludesVat : true;
    const key = `${l.service ? "4100" : "4000"}|${treatment}|${includes}`;
    m.set(key, (m.get(key) ?? 0) + l.amount);
  }
  return [...m].map(([key, entered]) => {
    const [, treatment, includes] = key.split("|");
    if (treatment === "standard") { const s = vatFromEntered(entered, ratePercent, includes === "true"); return { key, entered, net: s.net, vat: s.vat, gross: s.gross }; }
    return { key, entered, net: entered, vat: 0, gross: entered };
  });
}
export const saleTotals = (g: SaleGroup[]) => ({ net: g.reduce((s, x) => s + x.net, 0), vat: g.reduce((s, x) => s + x.vat, 0), gross: g.reduce((s, x) => s + x.gross, 0) });

/** Checks split payments add up to the sale total. Returns an error message or null. */
export function checkSplit(payments: Array<{ method: string; amount: number }>, gross: number): string | null {
  if (payments.length < 2) return "Choose two payment methods.";
  if (new Set(payments.map(p => p.method)).size !== payments.length) return "Choose two different payment methods.";
  if (payments.some(p => !Number.isSafeInteger(p.amount) || p.amount <= 0)) return "Each payment needs an amount above zero, in whole TZS.";
  const sum = payments.reduce((s, p) => s + p.amount, 0);
  return sum === gross ? null : `The payments add up to ${sum.toLocaleString("en-TZ")} but the sale total is ${gross.toLocaleString("en-TZ")}.`;
}
