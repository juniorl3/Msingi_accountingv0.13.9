// Pure shift and cashier-report maths and slips.
import { fmtTzs, pair } from "./receipt.ts";

export type MethodAmount = { method: string; amount: number };
export type ShiftFigures = { sales: number; gross: number; discounts: number; byMethod: MethodAmount[]; credit: number; refunds: MethodAmount[]; refundCount: number; voidCount: number; cashSales: number; cashRefunds: number };

/** Cash that should be in the drawer: the opening float plus cash sales, less cash paid back in refunds. */
export const expectedCash = (float: number, cashSales: number, cashRefunds: number) => float + cashSales - cashRefunds;
/** Positive = over, negative = short. */
export const cashVariance = (counted: number, expected: number) => counted - expected;
export const varianceText = (v: number) => (v === 0 ? "Balanced" : v > 0 ? `Over by ${fmtTzs(v)}` : `Short by ${fmtTzs(-v)}`);

export type ShiftSlip = { business: string; cashier: string; openedAt: string; closedAt?: string | null; float: number; fig: ShiftFigures; counted: number | null; note?: string };
export function shiftSlip(s: ShiftSlip, cols: number): string {
  const rule = "-".repeat(cols), exp = expectedCash(s.float, s.fig.cashSales, s.fig.cashRefunds);
  const L = [s.business, s.closedAt ? "SHIFT CLOSING" : "SHIFT SO FAR", rule, pair("Cashier", s.cashier, cols), pair("Opened", s.openedAt, cols)];
  if (s.closedAt) L.push(pair("Closed", s.closedAt, cols));
  L.push(rule, pair("Sales (count)", String(s.fig.sales), cols));
  for (const m of s.fig.byMethod) L.push(pair(m.method, fmtTzs(m.amount), cols));
  if (s.fig.credit) L.push(pair("On credit", fmtTzs(s.fig.credit), cols));
  for (const r of s.fig.refunds) L.push(pair(`Refund (${r.method})`, "-" + fmtTzs(r.amount), cols));
  if (s.fig.discounts) L.push(pair("Discounts given", fmtTzs(s.fig.discounts), cols));
  if (s.fig.voidCount) L.push(pair("Sales reversed (count)", String(s.fig.voidCount), cols));
  L.push(rule, pair("Opening float", fmtTzs(s.float), cols), pair("+ Cash sales", fmtTzs(s.fig.cashSales), cols), pair("- Cash refunds", fmtTzs(s.fig.cashRefunds), cols), pair("= Expected cash", fmtTzs(exp), cols));
  if (s.counted !== null) { L.push(pair("Counted cash", fmtTzs(s.counted), cols), pair("Result", varianceText(cashVariance(s.counted, exp)), cols)); }
  if (s.note?.trim()) L.push("", `Note: ${s.note.trim()}`);
  if (s.counted !== null) L.push("", "Cashier signature: ____________", "", "Manager signature: ____________");
  return L.join("\n");
}

export type CashierRow = { userId: number; name: string; sales: number; gross: number; discounts: number; refunds: number; refundTotal: number; voids: number; voidTotal: number };
export const cashierNet = (r: CashierRow) => r.gross - r.refundTotal;

/** One day of one cashier: totals plus their shifts. */
export function cashierDayText(business: string, date: string, r: CashierRow, shifts: Array<{ opened: string; closed: string | null; float: number; expected: number | null; counted: number | null; variance: number | null }>, cols: number): string {
  const rule = "-".repeat(cols);
  const L = [business, `CASHIER REPORT ${date}`, rule, pair("Cashier", r.name, cols), pair("Sales (count)", String(r.sales), cols), pair("Sales total", fmtTzs(r.gross), cols), pair("Discounts given", fmtTzs(r.discounts), cols), pair(`Refunds (${r.refunds})`, "-" + fmtTzs(r.refundTotal), cols), pair(`Reversed sales (${r.voids})`, "-" + fmtTzs(r.voidTotal), cols), rule, pair("NET SALES", fmtTzs(cashierNet(r)), cols)];
  if (shifts.length) {
    L.push(rule, "SHIFTS");
    for (const s of shifts) {
      L.push(pair(`${s.opened.slice(11, 16)}-${s.closed ? s.closed.slice(11, 16) : "open"}`, `float ${fmtTzs(s.float)}`, cols));
      if (s.closed && s.counted !== null && s.expected !== null && s.variance !== null) L.push(pair("  counted / expected", `${fmtTzs(s.counted)}/${fmtTzs(s.expected)}`, cols), pair("  result", varianceText(s.variance), cols));
    }
  }
  return L.join("\n");
}
