// Per-cashier summaries and the refund / void / discount audit trail.
import { db } from "./db";
import { getActiveBusiness } from "./business";
import { eventRef } from "./itemsDb";
import type { CashierRow } from "./shiftCalc";

const day = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Enter valid dates."); return s; };

/** One row per cashier for a date range (by sale date). Reversed sales are not counted as sales; they show under "reversed". */
export async function cashierSummary(from: string, to: string): Promise<CashierRow[]> {
  day(from); day(to); if (from > to) throw new Error("The start date is after the end date.");
  const d = await db(), biz = await getActiveBusiness(), rows = new Map<number, CashierRow>();
  const get = (id: number, name: string) => { let r = rows.get(id); if (!r) { r = { userId: id, name, sales: 0, gross: 0, discounts: 0, refunds: 0, refundTotal: 0, voids: 0, voidTotal: 0 }; rows.set(id, r); } return r; };
  const sales = await d.select<Array<{ id: number; name: string; n: number; gross: number; disc: number }>>(
    `SELECT u.id,u.name,COUNT(DISTINCT e.id) n,COALESCE(SUM(l.gross_tzs),0) gross,COALESCE(SUM(l.discount_tzs),0) disc
       FROM sale_meta m JOIN users u ON u.id=m.user_id JOIN stock_events e ON e.id=m.event_id AND e.voided=0 AND e.business_id=? JOIN sale_lines l ON l.event_id=e.id
      WHERE e.event_date BETWEEN ? AND ? GROUP BY u.id`, [biz.id, from, to]);
  for (const s of sales) { const r = get(s.id, s.name); r.sales = Number(s.n); r.gross = Number(s.gross); r.discounts = Number(s.disc); }
  const ref = await d.select<Array<{ id: number; name: string; n: number; amount: number }>>(
    `SELECT u.id,u.name,COUNT(*) n,COALESCE(SUM(a.amount_tzs),0) amount FROM pos_actions a JOIN users u ON u.id=a.user_id JOIN stock_events e ON e.id=a.event_id AND e.voided=0
      WHERE a.kind='refund' AND a.business_id=? AND a.day BETWEEN ? AND ? GROUP BY u.id`, [biz.id, from, to]);
  for (const s of ref) { const r = get(s.id, s.name); r.refunds = Number(s.n); r.refundTotal = Number(s.amount); }
  const vo = await d.select<Array<{ id: number; name: string; n: number; amount: number }>>(
    `SELECT u.id,u.name,COUNT(*) n,COALESCE(SUM(a.amount_tzs),0) amount FROM pos_actions a JOIN users u ON u.id=a.user_id
      WHERE a.kind='void' AND a.business_id=? AND a.day BETWEEN ? AND ? GROUP BY u.id`, [biz.id, from, to]);
  for (const s of vo) { const r = get(s.id, s.name); r.voids = Number(s.n); r.voidTotal = Number(s.amount); }
  return [...rows.values()].sort((a, b) => b.gross - a.gross || a.name.localeCompare(b.name));
}

export type AuditRow = { id: number; at: string; kind: string; user: string; approver: string; ref: string; amount: number; reason: string };
const KINDS = ["refund", "void", "discount", "drawer", "override_failed", "shift_close"] as const;
/** Refunds, reversals, discounts, no-sale drawer openings, failed override attempts and shift-closing differences, newest first. */
export async function auditTrail(from: string, to: string, kinds: readonly string[] = KINDS): Promise<AuditRow[]> {
  day(from); day(to);
  const d = await db(), biz = await getActiveBusiness(), ks = kinds.filter(k => (KINDS as readonly string[]).includes(k));
  if (!ks.length) return [];
  const rows = await d.select<Array<{ id: number; at: string; kind: string; user: string | null; approver: string | null; event_id: number | null; shift_id: number | null; amount_tzs: number; reason: string }>>(
    `SELECT a.id,a.at,a.kind,u.name user,p.name approver,a.event_id,a.shift_id,a.amount_tzs,a.reason FROM pos_actions a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN users p ON p.id=a.approver_id
      WHERE (a.business_id=? OR a.business_id IS NULL) AND a.day BETWEEN ? AND ? AND a.kind IN (${ks.map(() => "?").join(",")}) ORDER BY a.id DESC LIMIT 500`, [biz.id, from, to, ...ks]);
  return rows.map(r => ({ id: r.id, at: r.at, kind: r.kind, user: r.user ?? "—", approver: r.approver ?? "", ref: r.event_id ? eventRef(r.event_id) : r.shift_id ? `Shift ${r.shift_id}` : "", amount: Number(r.amount_tzs), reason: r.reason }));
}
