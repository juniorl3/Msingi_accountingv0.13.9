import Database from "@tauri-apps/plugin-sql";
import { BUSY, retryBusy } from "./dbRetry";

/**
 * Database access, serialised.
 *
 * tauri-plugin-sql hands every execute()/select() call to a pool of SQLite connections and cannot pin a
 * transaction to one of them. Whenever the screens fired reads at the same time (React effects do), the pool
 * opened a second connection, and a transaction's BEGIN, its writes and its COMMIT/ROLLBACK could land on
 * different connections. The result was "database is locked" (code 5) on the first write after the BEGIN,
 * a failed ROLLBACK that left the transaction open, and every later write failing until the app was restarted.
 *
 * To prevent that, every call goes through one queue, so the pool never needs more than one connection, and
 * multi-statement writes use withTransaction(), which holds the queue for the whole transaction.
 * Code running inside withTransaction() MUST use the `tx` it is given and never call db(), or it would wait
 * for the queue that it is itself holding.
 */
export type Conn = {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
};

let rawPromise: Promise<Database> | null = null;

/**
 * Open the app-local database once and configure SQLite before exposing it to callers.
 * WAL allows readers to continue while a writer is active; busy_timeout gives short-lived
 * Windows file locks (for example, an antivirus scan) time to clear. These settings do not
 * replace the application-level queue or transaction handling below.
 */
const raw = () => (rawPromise ??= Database.load("sqlite:msingi.db").then(async database => {
  await retryBusy(() => database.execute("PRAGMA busy_timeout = 8000"));
  await retryBusy(() => database.execute("PRAGMA journal_mode = WAL"));
  await retryBusy(() => database.execute("PRAGMA synchronous = NORMAL"));
  await retryBusy(() => database.execute("PRAGMA foreign_keys = ON"));
  return database;
}));

let tail: Promise<unknown> = Promise.resolve();
function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job);
  tail = run.then(() => undefined, () => undefined); // the queue itself never rejects
  return run;
}

const shared: Conn = {
  // A statement that fails with "database is locked" changed nothing, so it is safe to try again a few times.
  execute: (sql, params) => queued(async () => retryBusy(async () => (await raw()).execute(sql, params))),
  select: <T,>(sql: string, params?: unknown[]) => queued(async () => retryBusy(async () => (await raw()).select<T>(sql, params))),
};
export async function db(): Promise<Conn> { return shared; }

const busyMessage = "The database is busy. Another Msingi window or program may have it open. Nothing was saved. Close other copies of Msingi (check Task Manager on Windows), wait a few seconds and try again.";

/** Runs fn inside BEGIN IMMEDIATE ... COMMIT on a single connection. Any error rolls everything back. */
export function withTransaction<T>(fn: (tx: Conn) => Promise<T>): Promise<T> {
  return queued(async () => {
    const r = await raw();
    const tx: Conn = { execute: (sql, params) => r.execute(sql, params), select: <U,>(sql: string, params?: unknown[]) => r.select<U>(sql, params) };
    const rollback = async () => { try { await r.execute("ROLLBACK"); } catch { /* nothing to roll back */ } };
    try { await retryBusy(() => r.execute("BEGIN IMMEDIATE")); } catch (e) { throw BUSY.test(String(e)) ? new Error(busyMessage) : e; }
    let result: T;
    try { result = await fn(tx); } catch (e) { await rollback(); throw BUSY.test(String(e)) ? new Error(busyMessage) : e; }
    try { await r.execute("COMMIT"); } catch (e) { await rollback(); throw BUSY.test(String(e)) ? new Error(busyMessage) : e; }
    return result;
  });
}

/** Runs fn on `conn` when the caller already holds a transaction, otherwise in a new one. */
export function inTx<T>(conn: Conn | undefined, fn: (tx: Conn) => Promise<T>): Promise<T> { return conn ? fn(conn) : withTransaction(fn); }

/** The id SQLite assigned to a row just inserted through `result`; throws rather than returning a wrong id. */
export function insertedId(result: { lastInsertId?: number }, what: string): number {
  const id = Number(result.lastInsertId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Msingi could not confirm the new ${what} ID. Nothing was saved; please try again.`);
  return id;
}

export async function initialise() {
  const d = await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    payment_method TEXT NOT NULL DEFAULT 'Cash',
    reference TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await d.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`);
  await d.execute(`INSERT OR IGNORE INTO settings(key,value) VALUES ('business_name','My Business'),('currency','TZS')`);
}

export type Tx = { id:number; date:string; kind:"income"|"expense"; category:string; description:string; amount:number; payment_method:string; reference?:string; vat_tzs?:number; vat_treatment?:string; vat_rate?:number; amount_includes_vat?:number };
export async function getTransactions(): Promise<Tx[]> {
  const d = await db();
  return await d.select<Tx[]>(`SELECT t.* FROM transactions t
    WHERE NOT EXISTS (
      SELECT 1 FROM journal_entries j
      WHERE j.source_type='transaction' AND j.source_id=CAST(t.id AS TEXT) AND j.status='reversed'
    )
    ORDER BY t.date DESC, t.id DESC`);
}
export async function addTransaction(tx: Omit<Tx,"id">) {
  const d = await db();
  await d.execute("INSERT INTO transactions(date,kind,category,description,amount,payment_method,reference) VALUES(?,?,?,?,?,?,?)",
    [tx.date,tx.kind,tx.category,tx.description,tx.amount,tx.payment_method,tx.reference || ""]);
}
export async function deleteTransaction(id:number) {
  const d = await db();
  await d.execute("DELETE FROM transactions WHERE id = ?",[id]);
}
