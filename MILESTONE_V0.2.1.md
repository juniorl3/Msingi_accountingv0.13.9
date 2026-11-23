# Msingi Accounting v0.2.1 — Integrated General Ledger UI

This development release integrates the existing SQLite ledger foundation into the desktop interface.

## Included
- Navigation for Chart of Accounts, Journal Entries, General Ledger, Trial Balance and Audit Trail.
- Manual two-line balanced journal posting with whole-TZS validation.
- Income and expense entry now posts a matching double-entry journal in the same SQLite transaction.
- Cash, bank and mobile-money accounts are selected from payment method.
- Legacy transaction rows are migrated to journal entries once, using `source_type` and `source_id` to avoid duplicate migration.
- Trial balance export and account-level running ledger.
- Posted transactions are protected from destructive deletion in the UI.

## Important limitations
- This is an integration milestone, not a certified or statutory accounting product.
- Manual journal form currently supports one debit and one credit line; split journals are not yet supported in the UI.
- Reversal workflow, editing chart accounts, bank reconciliation, VAT calculations/returns, inventory valuation, full P&L/Balance Sheet/Cash Flow statements, backup/restore UI, and full migration reconciliation are not yet complete.
- Migration skips legacy transactions whose amounts are not whole TZS. Review those separately; do not round them automatically.
- The app must be tested against a copy of the existing SQLite database before replacing any installation. Keep a verified backup.
- Trial balance and account reports should be reconciled to source records before operational use.

## Build
Use the included Intel Mac builder. Verify the displayed app version is 0.2.1 and test journal posting, transaction posting, migration, persistence, offline operation and CSV exports.
