// Pure discount maths. Discounts reduce the amount entered for a line (the same basis as the price),
// so VAT, ledger postings and refunds all follow from the reduced amount.
import { allocate, mulDiv } from "./itemsCalc.ts";

export type DiscountSpec = { type: "pct" | "tzs"; value: string };
export type DiscountResult = { perLine: number[]; total: number; base: number; pct: number; error: string | null };

/** One discount in whole TZS off `base`, or an error message. A discount can never take the whole amount. */
export function discountOf(spec: DiscountSpec, base: number): { tzs: number } | { error: string } {
  const raw = spec.value.trim().replace(/,/g, "");
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n) || n <= 0) return { error: "Enter a discount above zero." };
  let tzs: number;
  if (spec.type === "pct") {
    if (n > 100 || Math.abs(Math.round(n * 100) - n * 100) > 1e-9) return { error: "A percentage discount is up to 100% with at most 2 decimals." };
    tzs = mulDiv(base, Math.round(n * 100), 10000);
  } else {
    if (!Number.isSafeInteger(n)) return { error: "Enter the discount in whole TZS." };
    tzs = n;
  }
  if (tzs <= 0) return { error: "That discount works out to zero." };
  if (tzs >= base) return { error: "A discount cannot take the whole amount. Remove the item instead." };
  return { tzs };
}

/** Line discounts first, then an optional whole-sale discount shared across the lines in proportion to what is left. */
export function computeDiscounts(amounts: number[], lineSpecs: Array<DiscountSpec | undefined>, saleSpec: DiscountSpec | null): DiscountResult {
  const base = amounts.reduce((s, a) => s + a, 0), zero = (error: string | null): DiscountResult => ({ perLine: amounts.map(() => 0), total: 0, base, pct: 0, error });
  const line = amounts.map(() => 0);
  for (let i = 0; i < amounts.length; i++) {
    const s = lineSpecs[i]; if (!s || s.value.trim() === "") continue;
    const r = discountOf(s, amounts[i]); if ("error" in r) return zero(r.error); line[i] = r.tzs;
  }
  const left = amounts.map((a, i) => a - line[i]), sub = left.reduce((s, a) => s + a, 0);
  const share = amounts.map(() => 0);
  if (saleSpec && saleSpec.value.trim() !== "") {
    if (sub <= 0) return zero("Nothing left to discount.");
    const r = discountOf(saleSpec, sub); if ("error" in r) return zero(r.error);
    allocate(r.tzs, left).forEach((v, i) => { share[i] = v; });
    if (share.some((v, i) => v >= left[i])) return zero("That discount is too large for the cheapest item on the sale.");
  }
  const perLine = line.map((v, i) => v + share[i]), total = perLine.reduce((s, v) => s + v, 0);
  return { perLine, total, base, pct: base > 0 ? Math.round((total * 10000) / base) / 100 : 0, error: null };
}
/** Exact check that a discount of `total` off `base` is no more than `limitPct` percent. */
export const withinLimit = (total: number, base: number, limitPct: number) => total * 100 <= limitPct * base;
