// Cashier shifts: opening float, closing count, expected cash.
import { db, withTransaction, insertedId } from "./db";
import { getActiveBusiness } from "./business";
import { recordAction } from "./posLog";
import { cashVariance, expectedCash } from "./shiftCalc";
import type { ShiftFigures } from "./shiftCalc";
import { hasPerm } from "./permissions";
import type { AppUser } from "./permissions";

export type Shift = { id: number; user_id: number; user_name: string; opened_at: string; opening_float: number; closed_at: string | null; counted_cash: number | null; expected_cash: number | null; variance: number | null; note: string; status: "open" | "closed" };
const SEL = "SELECT s.id,s.user_id,u.name user_name,s.opened_at,s.opening_float,s.closed_at,s.counted_cash,s.expected_cash,s.variance,s.note,s.status FROM shifts s JOIN users u ON u.id=s.user_id";
const fix = (r: Shift): Shift => ({ ...r, opening_float: Number(r.opening_float), counted_cash: r.counted_cash === null ? null : Number(r.counted_cash), expected_cash: r.expected_cash === null ? null : Number(r.expected_cash), variance: r.variance === null ? null : Number(r.variance) });

export async function getOpenShift(userId: number): Promise<Shift | null> {
  const d = await db(), biz = await getActiveBusiness();
  const r = await d.select<Shift[]>(`${SEL} WHERE s.business_id=? AND s.user_id=? AND s.status='open'`, [biz.id, userId]);
  return r[0] ? fix(r[0]) : null;
}
export async function listOpenShifts(): Promise<Shift[]> {
  const d = await db(), biz = await getActiveBusiness();
  return (await d.select<Shift[]>(`${SEL} WHERE s.business_id=? AND s.status='open' ORDER BY s.id`, [biz.id])).map(fix);
}
export async function listShifts(fromDay: string, toDay: string, userId?: number): Promise<Shift[]> {
  const d = await db(), biz = await getActiveBusiness();
  return (await d.select<Shift[]>(`${SEL} WHERE s.business_id=? AND date(s.opened_at) BETWEEN ? AND ?${userId ? " AND s.user_id=?" : ""} ORDER BY s.id DESC LIMIT 300`, userId ? [biz.id, fromDay, toDay, userId] : [biz.id, fromDay, toDay])).map(fix);
}

export async function openShift(userId: number, openingFloat: number): Promise<Shift> {
  if (!Number.isSafeInteger(openingFloat) || openingFloat < 0) throw new Error("The opening cash must be a whole number of TZS (0 or more).");
  const biz = await getActiveBusiness();
  const id = await withTransaction(async tx => {
    if ((await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM shifts WHERE business_id=? AND user_id=? AND status='open'", [biz.id, userId]))[0].n > 0) throw new Error("You already have an open shift.");
    const sid = insertedId(await tx.execute("INSERT INTO shifts(business_id,user_id,opening_float) VALUES(?,?,?)", [biz.id, userId, openingFloat]), "shift");
    await recordAction(tx, { businessId: biz.id, kind: "shift_open", userId, shiftId: sid, amount: openingFloat, reason: "Shift opened" });
    return sid;
  });
  const s = (await listOpenShifts()).find(x => x.id === id);
  if (!s) throw new Error("The shift was opened but could not be read back.");
  return s;
}

/** Everything that happened in one shift. Reversed sales are left out; refunds count against the shift they were paid in. */
export async function shiftFigures(shiftId: number): Promise<ShiftFigures> {
  const d = await db();
  const tot = (await d.select<Array<{ n: number; gross: number; disc: number }>>(
    `SELECT COUNT(DISTINCT e.id) n, COALESCE(SUM(l.gross_tzs),0) gross, COALESCE(SUM(l.discount_tzs),0) disc
       FROM sale_meta m JOIN stock_events e ON e.id=m.event_id AND e.voided=0 JOIN sale_lines l ON l.event_id=e.id WHERE m.shift_id=?`, [shiftId]))[0];
  const paid = await d.select<Array<{ method: string; amount: number }>>(
    `SELECT t.payment_method method, SUM(t.amount) amount
       FROM sale_meta m JOIN stock_events e ON e.id=m.event_id AND e.voided=0 JOIN stock_event_links l ON l.event_id=e.id
       JOIN journal_entries j ON j.id=l.journal_entry_id AND j.status='posted' AND j.source_type='transaction' JOIN transactions t ON CAST(t.id AS TEXT)=j.source_id
      WHERE m.shift_id=? GROUP BY t.payment_method ORDER BY t.payment_method`, [shiftId]);
  const cred = (await d.select<Array<{ total: number }>>(
    `SELECT COALESCE(SUM(x.total_tzs),0) total FROM sale_meta m JOIN stock_events e ON e.id=m.event_id AND e.voided=0 JOIN stock_event_links l ON l.event_id=e.id
       JOIN journal_entries j ON j.id=l.journal_entry_id AND j.status='posted' JOIN documents x ON x.journal_entry_id=j.id WHERE m.shift_id=?`, [shiftId]))[0];
  const ref = await d.select<Array<{ method: string; amount: number; n: number }>>(
    `SELECT r.payment_method method, SUM(r.gross_tzs) amount, COUNT(DISTINCT re.id) n
       FROM pos_actions a JOIN stock_events re ON re.id=a.event_id AND re.voided=0 JOIN sale_returns r ON r.return_event_id=re.id
      WHERE a.kind='refund' AND a.shift_id=? GROUP BY r.payment_method ORDER BY r.payment_method`, [shiftId]);
  const voids = (await d.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM pos_actions WHERE kind='void' AND shift_id=?", [shiftId]))[0];
  const byMethod = paid.map(r => ({ method: r.method, amount: Number(r.amount) })), refunds = ref.map(r => ({ method: r.method, amount: Number(r.amount) }));
  return { sales: Number(tot?.n ?? 0), gross: Number(tot?.gross ?? 0), discounts: Number(tot?.disc ?? 0), byMethod, credit: Number(cred?.total ?? 0), refunds, refundCount: ref.reduce((s, r) => s + Number(r.n), 0), voidCount: Number(voids?.n ?? 0),
    cashSales: byMethod.find(m => m.method === "Cash")?.amount ?? 0, cashRefunds: refunds.find(m => m.method === "Cash")?.amount ?? 0 };
}

/** Closes a shift with the counted cash. A difference needs a note. Cashiers close their own shifts; people with "reports" can close anyone's. */
export async function closeShift(shiftId: number, counted: number, note: string, closer: AppUser) {
  if (!Number.isSafeInteger(counted) || counted < 0) throw new Error("Enter the cash counted in whole TZS.");
  const fig = await shiftFigures(shiftId);
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const s = (await tx.select<Array<{ id: number; user_id: number; opening_float: number; status: string }>>("SELECT id,user_id,opening_float,status FROM shifts WHERE id=? AND business_id=?", [shiftId, biz.id]))[0];
    if (!s) throw new Error("Shift not found.");
    if (s.status !== "open") throw new Error("This shift is already closed.");
    if (s.user_id !== closer.id && !hasPerm(closer, "reports")) throw new Error("Only the cashier or a manager can close this shift.");
    const expected = expectedCash(Number(s.opening_float), fig.cashSales, fig.cashRefunds), variance = cashVariance(counted, expected);
    if (variance !== 0 && !note.trim()) throw new Error("The count does not match the expected cash. Add a note explaining the difference.");
    await tx.execute("UPDATE shifts SET status='closed',closed_at=datetime('now','localtime'),closed_by=?,counted_cash=?,expected_cash=?,variance=?,note=? WHERE id=?", [closer.id, counted, expected, variance, note.trim(), shiftId]);
    await recordAction(tx, { businessId: biz.id, kind: "shift_close", userId: closer.id, shiftId, amount: variance, reason: note.trim() || "Balanced", detail: { cashier: s.user_id, counted, expected } });
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('SHIFT','shift',?,?)", [String(shiftId), JSON.stringify({ counted, expected, variance, by: closer.id })]);
    return { expected, variance };
  });
}
