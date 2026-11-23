// Fiscal queue ("fiscal-ready" layer). Records each new sale with its VAT breakdown so it can be matched to the receipt issued by
// the business's approved EFD/VFD device, or handed to a real fiscal adapter later. It does NOT contact TRA.
import { db, withTransaction } from "./db";
import type { Conn } from "./db";
import { getActiveBusiness } from "./business";
import type { FiscalSale } from "./fiscalAdapter";

const eventRef = (id: number) => `STK-${String(id).padStart(6, "0")}`; // same format as itemsDb.eventRef (not imported, to avoid a circular import)
export type FiscalMode = "off" | "record";
export type FiscalStatus = "pending" | "matched" | "sent"; // "sent" is reserved for a future real adapter; nothing in this release sets it

export async function initialiseFiscal() {
  const d = await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS fiscal_queue(event_id INTEGER PRIMARY KEY REFERENCES stock_events(id),business_id INTEGER NOT NULL,recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),sale_date TEXT NOT NULL,gross_tzs INTEGER NOT NULL,vat_tzs INTEGER NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','matched','sent')),fiscal_receipt_no TEXT NOT NULL DEFAULT '',verification_code TEXT NOT NULL DEFAULT '',matched_by INTEGER,matched_at TEXT)`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_fiscal_queue_status ON fiscal_queue(business_id,status)");
}

const KEY = "fiscal_mode";
async function modeOf(c: Conn, businessId: number): Promise<FiscalMode> {
  const r = await c.select<Array<{ value: string }>>("SELECT value FROM business_settings WHERE business_id=? AND key=?", [businessId, KEY]);
  return r[0]?.value === "record" ? "record" : "off";
}
export async function getFiscalMode(): Promise<FiscalMode> { const biz = await getActiveBusiness(); return modeOf(await db(), biz.id); }
export async function setFiscalMode(mode: FiscalMode, by: number) {
  if (mode !== "off" && mode !== "record") throw new Error("Choose a valid fiscal mode.");
  const biz = await getActiveBusiness();
  await withTransaction(async tx => {
    await tx.execute("INSERT INTO business_settings(business_id,key,value) VALUES(?,?,?) ON CONFLICT(business_id,key) DO UPDATE SET value=excluded.value", [biz.id, KEY, mode]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','fiscal_mode',?,?)", [String(biz.id), JSON.stringify({ mode, by })]);
  });
}

/** Called inside the sale's transaction. Does nothing unless the business turned recording on. */
export async function queueFiscal(tx: Conn, businessId: number, eventId: number, sale: FiscalSale) {
  if ((await modeOf(tx, businessId)) !== "record") return;
  await tx.execute("INSERT INTO fiscal_queue(event_id,business_id,sale_date,gross_tzs,vat_tzs,payload) VALUES(?,?,?,?,?,?)", [eventId, businessId, sale.date, sale.totals.gross, sale.totals.vat, JSON.stringify(sale)]);
}

export type FiscalRow = { eventId: number; ref: string; date: string; gross: number; vat: number; status: FiscalStatus; receiptNo: string; code: string; reversed: boolean; refunds: number };
export async function listFiscal(status?: FiscalStatus, limit = 300): Promise<FiscalRow[]> {
  const d = await db(), biz = await getActiveBusiness();
  const rows = await d.select<Array<{ event_id: number; sale_date: string; gross_tzs: number; vat_tzs: number; status: FiscalStatus; fiscal_receipt_no: string; verification_code: string; voided: number; refunds: number }>>(
    `SELECT q.event_id,q.sale_date,q.gross_tzs,q.vat_tzs,q.status,q.fiscal_receipt_no,q.verification_code,e.voided,
       (SELECT COUNT(DISTINCT r.return_event_id) FROM sale_returns r JOIN sale_lines l ON l.id=r.sale_line_id JOIN stock_events re ON re.id=r.return_event_id AND re.voided=0 WHERE l.event_id=q.event_id) refunds
     FROM fiscal_queue q JOIN stock_events e ON e.id=q.event_id WHERE q.business_id=?${status ? " AND q.status=?" : ""} ORDER BY q.event_id DESC LIMIT ?`, status ? [biz.id, status, limit] : [biz.id, limit]);
  return rows.map(r => ({ eventId: r.event_id, ref: eventRef(r.event_id), date: r.sale_date, gross: Number(r.gross_tzs), vat: Number(r.vat_tzs), status: r.status, receiptNo: r.fiscal_receipt_no, code: r.verification_code, reversed: !!r.voided, refunds: Number(r.refunds) }));
}
/** Sales still waiting for a fiscal receipt number (reversed sales are not counted). */
export async function pendingCount(): Promise<number> {
  const d = await db(), biz = await getActiveBusiness();
  return Number((await d.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM fiscal_queue q JOIN stock_events e ON e.id=q.event_id AND e.voided=0 WHERE q.business_id=? AND q.status='pending'", [biz.id]))[0]?.n ?? 0);
}

/** Records the receipt number the business's own approved EFD/VFD device issued for this sale. This is a manual match, not a TRA submission. */
export async function matchFiscalReceipt(eventId: number, receiptNo: string, verificationCode: string, by: number) {
  const no = receiptNo.trim(), code = verificationCode.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 \/_-]{0,39}$/.test(no)) throw new Error("Enter the receipt number printed by your EFD/VFD (letters, digits, - or /; up to 40 characters).");
  if (code.length > 40 || /[^A-Za-z0-9 \/_-]/.test(code)) throw new Error("The verification code can only contain letters, digits, - or /.");
  const biz = await getActiveBusiness();
  await withTransaction(async tx => {
    const r = await tx.execute("UPDATE fiscal_queue SET status='matched',fiscal_receipt_no=?,verification_code=?,matched_by=?,matched_at=datetime('now','localtime') WHERE event_id=? AND business_id=? AND status='pending'", [no, code, by, eventId, biz.id]);
    if (!r.rowsAffected) throw new Error("This sale is not waiting for a receipt number.");
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('FISCAL','fiscal_queue',?,?)", [String(eventId), JSON.stringify({ receiptNo: no, by })]);
  });
}
