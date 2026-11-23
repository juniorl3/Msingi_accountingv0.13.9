// Daily cash-up: what was sold on a day, by payment method, read from the posted sale journals (reversed sales are excluded).
import { db } from "./db";
import { getActiveBusiness } from "./business";

export type CashUp = { date: string; sales: number; byMethod: Array<{ method: string; amount: number }>; credit: number; vat: number; gross: number; refunds: Array<{ method: string; amount: number }>; refundTotal: number };

export async function getCashUp(date: string): Promise<CashUp> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Enter a valid date.");
  const biz = await getActiveBusiness(), d = await db();
  const cnt = await d.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM stock_events WHERE business_id=? AND kind='sale' AND voided=0 AND event_date=?", [biz.id, date]);
  const paid = await d.select<Array<{ method: string; amount: number; vat: number }>>(
    `SELECT t.payment_method method, SUM(t.amount) amount, SUM(t.vat_tzs) vat
       FROM stock_events e JOIN stock_event_links l ON l.event_id=e.id JOIN journal_entries j ON j.id=l.journal_entry_id AND j.status='posted' AND j.source_type='transaction'
       JOIN transactions t ON CAST(t.id AS TEXT)=j.source_id
      WHERE e.business_id=? AND e.kind='sale' AND e.voided=0 AND e.event_date=? GROUP BY t.payment_method ORDER BY t.payment_method`, [biz.id, date]);
  const cred = await d.select<Array<{ total: number; vat: number }>>(
    `SELECT COALESCE(SUM(x.total_tzs),0) total, COALESCE(SUM(x.vat_tzs),0) vat FROM documents x
       JOIN journal_entries j ON j.id=x.journal_entry_id AND j.status='posted'
       JOIN stock_event_links l ON l.journal_entry_id=j.id JOIN stock_events e ON e.id=l.event_id
      WHERE e.business_id=? AND e.kind='sale' AND e.voided=0 AND e.event_date=?`, [biz.id, date]);
  const ref = await d.select<Array<{ method: string; amount: number; vat: number }>>(
    `SELECT r.payment_method method, SUM(r.gross_tzs) amount, SUM(r.vat_tzs) vat FROM sale_returns r JOIN stock_events e ON e.id=r.return_event_id
      WHERE e.business_id=? AND e.voided=0 AND e.event_date=? GROUP BY r.payment_method ORDER BY r.payment_method`, [biz.id, date]);
  const refunds = ref.map(r => ({ method: r.method, amount: Number(r.amount) }));
  const byMethod = paid.map(r => ({ method: r.method, amount: Number(r.amount) }));
  const credit = Number(cred[0]?.total ?? 0), vat = paid.reduce((s, r) => s + Number(r.vat), 0) + Number(cred[0]?.vat ?? 0);
  const refundTotal = refunds.reduce((s, r) => s + r.amount, 0), refundVat = ref.reduce((s, r) => s + Number(r.vat), 0);
  return { date, sales: Number(cnt[0]?.n ?? 0), byMethod, credit, vat: vat - refundVat, gross: byMethod.reduce((s, r) => s + r.amount, 0) + credit - refundTotal, refunds, refundTotal };
}

/** Plain-text cash-up slip, `cols` characters wide. Cash expected = opening float + cash sales. */
export function cashUpText(c: CashUp, business: string, float: number, counted: number | null, cols: number): string {
  const pair = (a: string, b: string) => a + " ".repeat(Math.max(1, cols - a.length - b.length)) + b, f = (n: number) => n.toLocaleString("en-TZ");
  const cashIn = c.byMethod.find(m => m.method === "Cash")?.amount ?? 0, cashOut = c.refunds.find(m => m.method === "Cash")?.amount ?? 0, cash = cashIn - cashOut, expected = float + cash, rule = "-".repeat(cols);
  const L = [business, `DAILY CASH-UP ${c.date}`, rule, pair("Sales (count)", String(c.sales))];
  for (const m of c.byMethod) L.push(pair(m.method, f(m.amount)));
  if (c.credit) L.push(pair("On credit", f(c.credit)));
  for (const r of c.refunds) L.push(pair(`Refund (${r.method})`, "-" + f(r.amount)));
  L.push(rule, pair(c.refundTotal ? "NET SALES" : "TOTAL SALES", f(c.gross)));
  if (c.vat) L.push(pair("  of which VAT", f(c.vat)));
  L.push(rule, pair("Opening float", f(float)), pair("+ Cash sales less refunds", f(cash)), pair("= Expected cash", f(expected)));
  if (counted !== null) { L.push(pair("Counted cash", f(counted))); const v = counted - expected; L.push(pair(v === 0 ? "Balanced" : v > 0 ? "Over by" : "Short by", f(Math.abs(v)))); }
  return L.join("\n");
}
