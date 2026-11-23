# Msingi Accounting v0.2 – General Ledger foundation

This package starts the next milestone on top of the Phase 1 Tauri/React/SQLite prototype.

## Included in this development foundation
- SQLite schema for chart of accounts, journal headers, journal lines and audit events.
- Default starter chart of accounts, including cash, bank, receivables, inventory, payables, VAT payable, capital, revenue and expenses.
- `src/ledger.ts` with balanced journal posting validation and trial-balance query.
- Integer TZS storage for journal lines (avoids floating-point currency arithmetic).
- TypeScript compatibility fix for the earlier `replaceAll` build error.
- Project version advanced to 0.2.0.

## Important status
This is a **development foundation**, not a finished v0.2 accounting release. The current v0.1 screens still need to be connected to the ledger service. Legacy income/expense records are not automatically converted to journals. Do not use this build as statutory books or as the sole accounting record.

## Next implementation tasks
1. Add a Journal Entry screen with account selection and debit/credit lines.
2. Connect income/expense capture to balanced journal entries.
3. Add account ledger, journal register and trial-balance screens.
4. Add reversal workflow (no destructive deletion) and audit history UI.
5. Add migration from existing v0.1 transaction rows after reconciliation and backup.
6. Test balanced/unbalanced entries, rollback, persistence, backup/restore and offline operation on Intel macOS.
7. Build and verify a new Intel `.dmg`; then test Windows target separately.

## Build
Use the included safer Intel Mac builder after reviewing the source. The Mac must have Apple Command Line Tools, Node.js 20+, Rust stable and internet access for first-time dependency retrieval.
