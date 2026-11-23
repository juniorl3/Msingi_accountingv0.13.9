// POS accountability: who did what. Schema, and the action log used for the refund / void / discount audit trail.
import { db } from "./db";
import type { Conn } from "./db";
import { suggestUsername } from "./pinLogic.ts";

/** The signed-in user performing an action, plus the manager who approved it when an override PIN was used. */
export type Actor = { userId: number; approverId?: number; shiftId?: number | null };
export type ActionKind = "sale" | "discount" | "refund" | "void" | "override" | "override_failed" | "shift_open" | "shift_close" | "login" | "login_failed" | "user" | "drawer";

export async function initialisePos() {
  const d = await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','manager','cashier')),perms TEXT NOT NULL DEFAULT '[]',discount_limit_pct INTEGER NOT NULL DEFAULT 0 CHECK(discount_limit_pct BETWEEN 0 AND 100),pin_salt TEXT NOT NULL,pin_hash TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,failed_count INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_name ON users(name COLLATE NOCASE)");
  // v0.11: sign in by username. Existing users get one made from their name (Juma Hassan -> juma.hassan); the owner can change it in Users.
  if (!(await d.select<Array<{ name: string }>>("PRAGMA table_info(users)")).some(c => c.name === "username")) {
    await d.execute("ALTER TABLE users ADD COLUMN username TEXT");
    const used = new Set<string>();
    for (const r of await d.select<Array<{ id: number; name: string }>>("SELECT id,name FROM users ORDER BY id")) {
      let u = suggestUsername(r.name);
      while (used.has(u)) u = `${u.slice(0, 26)}${r.id}`;
      used.add(u);
      await d.execute("UPDATE users SET username=? WHERE id=?", [u, r.id]);
    }
  }
  await d.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users(username COLLATE NOCASE)");
  await d.execute(`CREATE TABLE IF NOT EXISTS shifts(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),opening_float INTEGER NOT NULL CHECK(opening_float>=0),closed_at TEXT,closed_by INTEGER REFERENCES users(id),counted_cash INTEGER,expected_cash INTEGER,variance INTEGER,note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')))`);
  await d.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_shift_one_open ON shifts(business_id,user_id) WHERE status='open'");
  await d.execute(`CREATE TABLE IF NOT EXISTS sale_meta(event_id INTEGER PRIMARY KEY REFERENCES stock_events(id),user_id INTEGER NOT NULL REFERENCES users(id),approver_id INTEGER REFERENCES users(id),shift_id INTEGER REFERENCES shifts(id),discount_tzs INTEGER NOT NULL DEFAULT 0,discount_reason TEXT NOT NULL DEFAULT '')`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_sale_meta_shift ON sale_meta(shift_id)");
  await d.execute(`CREATE TABLE IF NOT EXISTS pos_actions(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER,kind TEXT NOT NULL,user_id INTEGER,approver_id INTEGER,shift_id INTEGER,event_id INTEGER,amount_tzs INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '',day TEXT NOT NULL DEFAULT (date('now','localtime')),at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_pos_actions_day ON pos_actions(day,kind)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_pos_actions_user ON pos_actions(user_id)");
}

export type ActionInput = { businessId?: number; kind: ActionKind; userId?: number | null; approverId?: number | null; shiftId?: number | null; eventId?: number | null; amount?: number; reason?: string; detail?: unknown };
/** Writes one row of the action log. Pass the transaction `tx` when inside withTransaction() so it commits or rolls back with the sale. */
export async function recordAction(c: Conn, a: ActionInput) {
  await c.execute("INSERT INTO pos_actions(business_id,kind,user_id,approver_id,shift_id,event_id,amount_tzs,reason,detail) VALUES(?,?,?,?,?,?,?,?,?)",
    [a.businessId ?? null, a.kind, a.userId ?? null, a.approverId ?? null, a.shiftId ?? null, a.eventId ?? null, a.amount ?? 0, (a.reason ?? "").trim(), a.detail === undefined ? "" : JSON.stringify(a.detail)]);
}
