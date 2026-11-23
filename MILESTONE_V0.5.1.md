# Msingi Accounting v0.5.1 — Invoice Creation Hotfix

## Fixed
- New invoice and supplier bill creation no longer re-queries the inserted document by its generated number to obtain its ID.
- The application now uses the SQLite plugin's `execute()` result (`lastInsertId`) and validates the returned ID before creating the linked journal.
- If a valid ID is not returned, the transaction is rolled back with a clear error instead of attempting to access `[0].id` on an empty result.

## Compatibility and data safety
- No database schema change is required for this fix.
- Existing invoices, bills, journals, and company data are not intentionally modified.
- Build output is named `Msingi-Accounting-v0.5.1-Intel-Mac.dmg` so it does not overwrite the v0.5.0 installer.
- This source patch requires a fresh build and runtime testing on the target Mac before it can be considered verified.
