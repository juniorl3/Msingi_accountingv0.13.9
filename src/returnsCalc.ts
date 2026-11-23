// Pure refund maths. A returned quantity takes its proportional share of the line's gross, net, VAT and cost.
// Shares are cumulative so repeated part-returns add up exactly to the original amounts, with no rounding drift.

export type LineAmounts = { qty: number; gross: number; net: number; vat: number; cost: number };
export type ReturnShare = { gross: number; net: number; vat: number; cost: number };

const share = (total: number, part: number, whole: number) => Number((BigInt(total) * BigInt(part) * 2n + BigInt(whole)) / (BigInt(whole) * 2n)); // rounded total*part/whole

/**
 * `already` = amounts already returned from this line. Returns the amounts for returning `retQty` more.
 * Gross and net are shared directly; VAT is gross - net so the three always agree.
 */
export function returnShare(line: LineAmounts, already: LineAmounts, retQty: number): ReturnShare {
  if (!Number.isSafeInteger(retQty) || retQty <= 0) throw new Error("Enter the quantity returned.");
  if (retQty > line.qty - already.qty) throw new Error(`Only ${(line.qty - already.qty) / 1000} can still be returned from this line.`);
  const cum = already.qty + retQty;
  const gross = share(line.gross, cum, line.qty) - share(line.gross, already.qty, line.qty);
  const net = share(line.net, cum, line.qty) - share(line.net, already.qty, line.qty);
  const cost = share(line.cost, cum, line.qty) - share(line.cost, already.qty, line.qty);
  return { gross, net, vat: gross - net, cost };
}
