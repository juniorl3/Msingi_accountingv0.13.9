-- Msingi Accounting v0.2: general-ledger foundation
-- Amounts are integer TZS shillings. Never store accounting money as floating point.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('asset','liability','equity','income','expense')),
  normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),
  parent_id INTEGER REFERENCES accounts(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_number TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('draft','posted','reversed')),
  created_by TEXT NOT NULL DEFAULT 'local-user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_entry_id INTEGER REFERENCES journal_entries(id)
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  description TEXT,
  debit_tzs INTEGER NOT NULL DEFAULT 0 CHECK(debit_tzs >= 0),
  credit_tzs INTEGER NOT NULL DEFAULT 0 CHECK(credit_tzs >= 0),
  CHECK ((debit_tzs > 0 AND credit_tzs = 0) OR (credit_tzs > 0 AND debit_tzs = 0))
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date, id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id, journal_entry_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
