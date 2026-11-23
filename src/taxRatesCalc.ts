// Pure arithmetic for the non-payroll, non-VAT taxes. No imports: easy to test.
// Defaults checked 2026-11-11 against TRA "Taxes and Duties at a Glance 2025/26" and the Finance Act 2026 summary
// (Clyde & Co). They are only starting values: every figure is editable in Settings → Tax rates.

export type WhtRate = { key: string; label: string; pct: number };
export type OtherTaxes = {
  corporatePct: number;     // corporate income tax on taxable profit
  turnoverPct: number;      // presumptive / turnover tax for resident individuals
  turnoverMin: number;      // turnover tax at this flat rate applies from this annual turnover...
  turnoverMax: number;      // ...up to this annual turnover (above it, full accounts and income tax apply)
  levyPct: number;          // local service levy on turnover, paid to the local authority
  wht: WhtRate[];           // withholding tax rates on payments to residents
  verifiedOn: string;
};

const WHT_RESIDENT: WhtRate[] = [
  { key: "dividend_listed", label: "Dividends: companies listed on the DSE", pct: 5 },
  { key: "dividend", label: "Dividends: other companies", pct: 10 },
  { key: "interest", label: "Interest", pct: 10 },
  { key: "royalty", label: "Royalties", pct: 10 },
  { key: "rent", label: "Rent on land and buildings", pct: 10 },
  { key: "vehicle_hire", label: "Hire of motor vehicles or aircraft", pct: 10 },
  { key: "equipment_rent", label: "Rent of construction equipment or machinery", pct: 10 },
  { key: "services", label: "Professional and other services", pct: 10 },
  { key: "commission", label: "Commissions and fees (banks, mobile money agents)", pct: 10 },
  { key: "goods_govt", label: "Goods sold to Government institutions", pct: 2 },
  { key: "directors", label: "Directors' fees (non-full-time)", pct: 15 },
  { key: "natural_resource", label: "Natural resource payments", pct: 15 },
  { key: "agri", label: "Agricultural and fishery products", pct: 1 },
];
export const DEFAULT_OTHER: Record<"mainland" | "zanzibar", OtherTaxes> = {
  // levyPct 0.3 is the Local Government service levy; it is not in the TRA publication, so treat it as unverified.
  mainland: { corporatePct: 30, turnoverPct: 4, turnoverMin: 11_000_000, turnoverMax: 200_000_000, levyPct: 0.3, wht: WHT_RESIDENT, verifiedOn: "2026-11-11" },
  // No Zanzibar (ZRB) source was found; these are the Mainland figures as a starting point only. Confirm with ZRB.
  zanzibar: { corporatePct: 30, turnoverPct: 4, turnoverMin: 11_000_000, turnoverMax: 200_000_000, levyPct: 0, wht: WHT_RESIDENT, verifiedOn: "2026-11-11" },
};

const okPct = (n: number) => Number.isFinite(n) && n >= 0 && n < 100;
export function validateOther(o: OtherTaxes): string | null {
  if (!okPct(o.corporatePct)) return "Corporate income tax rate must be from 0 to under 100.";
  if (!okPct(o.turnoverPct)) return "Turnover tax rate must be from 0 to under 100.";
  if (!okPct(o.levyPct)) return "Service levy rate must be from 0 to under 100.";
  if (!Number.isFinite(o.turnoverMin) || !Number.isFinite(o.turnoverMax) || o.turnoverMin < 0 || o.turnoverMax <= o.turnoverMin) return "The turnover tax upper limit must be above the lower limit.";
  if (!Array.isArray(o.wht) || !o.wht.length) return "Keep at least one withholding tax rate.";
  const seen = new Set<string>();
  for (const w of o.wht) {
    if (!w.label.trim()) return "Every withholding tax line needs a name.";
    if (!okPct(w.pct)) return `Withholding rate for "${w.label}" must be from 0 to under 100.`;
    if (seen.has(w.key)) return "Withholding tax lines must be unique.";
    seen.add(w.key);
  }
  return null;
}

const pct = (amount: number, rate: number) => Math.round((amount * Math.round(rate * 100)) / 10000);

export type TaxEstimate = { corporate: number; turnoverTax: number | null; turnoverNote: string; levy: number };
/** Rough estimates from the ledger. `income` is total income for the period, `netProfit` is income less expenses. Not a tax return. */
export function estimateTaxes(income: number, netProfit: number, o: OtherTaxes): TaxEstimate {
  const eligible = income >= o.turnoverMin && income <= o.turnoverMax;
  return {
    corporate: netProfit > 0 ? pct(netProfit, o.corporatePct) : 0,
    turnoverTax: eligible ? pct(income, o.turnoverPct) : null,
    turnoverNote: eligible ? `Turnover is inside the ${o.turnoverMin.toLocaleString("en-TZ")} to ${o.turnoverMax.toLocaleString("en-TZ")} range.`
      : income < o.turnoverMin ? "Below the flat-rate range, where TRA's lower tiers apply (check with TRA)." : "Above the turnover tax limit, so income tax on full accounts applies.",
    levy: pct(income, o.levyPct),
  };
}

/** Tax to withhold from a payment, and what the supplier actually receives. */
export function whtOn(amount: number, ratePct: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Enter the payment amount in whole TZS.");
  if (!okPct(ratePct)) throw new Error("Withholding rate must be from 0 to under 100.");
  const withheld = pct(amount, ratePct);
  return { withheld, netPayable: amount - withheld };
}
