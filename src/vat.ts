// Pure helpers for VAT and multi-line journals. No imports: easy to test.
export const VAT_PAYABLE = "2100";      // output VAT owed to tax authority
export const VAT_RECEIVABLE = "1300";   // input VAT recoverable

export type DraftLine = { code: string; debit: string; credit: string; memo: string };

/** Split a VAT-inclusive gross amount into whole-TZS net and VAT. Net + VAT always equals gross. */
export function splitVat(gross: number, ratePercent: number) {
  if (!Number.isSafeInteger(gross) || gross <= 0) throw new Error("Enter a VAT-inclusive amount in whole TZS.");
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent >= 100) throw new Error("VAT rate must be from 0 to under 100.");
  const vat = Math.round((gross * ratePercent) / (100 + ratePercent));
  return { net: gross - vat, vat, gross };
}

export type VatSplit = { net: number; vat: number; gross: number };

/**
 * VAT for an amount exactly as the user typed it.
 * includesVat = true : the amount is the total; VAT is taken out of it (same result as splitVat).
 * includesVat = false: the amount is before VAT; VAT is added on top, rounded to the nearest whole TZS.
 * Either way net + vat === gross, and gross is what is paid or received.
 */
export function vatFromEntered(amount: number, ratePercent: number, includesVat: boolean): VatSplit {
  if (includesVat) return splitVat(amount, ratePercent);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Enter an amount in whole TZS.");
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent >= 100) throw new Error("VAT rate must be from 0 to under 100.");
  const vat = Math.round((amount * Math.round(ratePercent * 100)) / 10000); // rate in hundredths of a percent keeps the product an exact integer
  return { net: amount, vat, gross: amount + vat };
}

const line = (code: string, debit: number, credit: number, memo: string): DraftLine =>
  ({ code, debit: debit ? String(debit) : "", credit: credit ? String(credit) : "", memo });

/** Sale: Dr payment account (gross), Cr income (net), Cr VAT Payable (VAT). */
export function saleWithVatLines(gross: number, rate: number, paymentCode: string, incomeCode: string): DraftLine[] {
  const { net, vat } = splitVat(gross, rate);
  const rows = [line(paymentCode, gross, 0, "Amount received / receivable (incl. VAT)"), line(incomeCode, 0, net, "Sale (excl. VAT)")];
  if (vat > 0) rows.push(line(VAT_PAYABLE, 0, vat, `Output VAT ${rate}%`));
  return rows;
}

/** Purchase/expense: Dr expense (net), Dr VAT Receivable (VAT), Cr payment account (gross). */
export function purchaseWithVatLines(gross: number, rate: number, paymentCode: string, expenseCode: string): DraftLine[] {
  const { net, vat } = splitVat(gross, rate);
  const rows = [line(expenseCode, net, 0, "Purchase (excl. VAT)")];
  if (vat > 0) rows.push(line(VAT_RECEIVABLE, vat, 0, `Input VAT ${rate}%`));
  rows.push(line(paymentCode, 0, gross, "Amount paid / payable (incl. VAT)"));
  return rows;
}

export type LineSummary = { debits: number; credits: number; usable: number; problem: string | null; balanced: boolean };
/** Validate draft lines the same way the ledger will. Blank rows are ignored. */
export function summariseDraft(lines: DraftLine[]): LineSummary {
  let debits = 0, credits = 0, usable = 0, problem: string | null = null;
  for (const l of lines) {
    const d = l.debit.trim() === "" ? 0 : Number(l.debit), c = l.credit.trim() === "" ? 0 : Number(l.credit);
    if (d === 0 && c === 0) continue;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0) { problem = "Amounts must be positive whole TZS."; continue; }
    if (d > 0 && c > 0) { problem = "A line cannot have both a debit and a credit."; continue; }
    if (!l.code) { problem = "Choose an account for every line with an amount."; continue; }
    debits += d; credits += c; usable++;
  }
  const balanced = !problem && usable >= 2 && debits > 0 && debits === credits;
  return { debits, credits, usable, problem, balanced };
}
