# Msingi Accounting v0.5.2 — VAT preferences, reconciliation by reference, database lock fix

## Fixed: "error returned from database: (code: 5) database is locked"
Cause: tauri-plugin-sql runs each call on a pool of SQLite connections and cannot pin a transaction to one. When screens
read in parallel the pool opened a second connection, so a transaction's BEGIN, writes and COMMIT/ROLLBACK landed on
different connections. The first failure left a transaction open and every later write failed until restart.
(The v0.5.1 "invoice creation" fix changed which connection each statement hit, so it only masked the problem.)
Fix (src/db.ts): every database call goes through one queue, and all multi-statement writes use `withTransaction()`,
which holds the queue for the whole transaction and rolls back on any error. Inserted IDs come from the insert result.
If another program genuinely holds the database, the message now says so and that nothing was saved.

## Changed
1. **Amount includes VAT** checkbox on transactions, invoices and bills. Ticked = you type the total (as before).
   Unticked = you type the amount before VAT and VAT is added on top. Stored totals are always the gross amount.
2. **Per-business VAT preferences** (new tables `businesses`, `business_settings`, keyed by business id).
3. **Configurable 18% default**, prefilled from the saved preference when each form opens. Unsaved edits in Settings no longer leak into forms.
   Preferences: standard rate, "amount includes VAT" default, default VAT choice for transactions, default for invoices/bills.
4. **Zero-rated and Exempt** remain selectable on every transaction, invoice and bill (transactions also keep "No VAT recorded").
5. **Reconciliation page**: every invoice, bill, payment and transaction is checked against its own journal, and every
   ledger posting on Accounts Receivable / Payable is attributed to a document or to a manual journal. Differences are listed
   by INV-/BILL-/TXN-/JE- reference with per-record, in-ledger and difference amounts, and can be exported to CSV.
   Equal totals that hide cancelling errors are now flagged. Financial reports' integrity checks name the same references.
6. VAT return and CSV export: code unchanged (VatReturn.tsx is byte-identical).
7. Existing data: no existing row is modified. Two columns (`amount_includes_vat`, default 1 = what all old rows were) are added;
   the old `vat_rate` setting is copied to the business and left in place.

## Verified (automated, against the real TypeScript with a simulated connection pool)
- Lock error reproduced on v0.5.1; absent in v0.5.2 under heavy concurrent reads and writes, failures and rollbacks.
- A database built by v0.5.1 opened by v0.5.2: all accounting tables byte-identical; VAT returns, aging, statements identical.
- VAT maths, includes/excludes for all treatments; per-business isolation; reconciliation against five deliberate corruptions.
Not run here: the Tauri build and the screens themselves (no network/GUI). Please run the build and click through on your Mac.

## Notes
- Data layer is ready for several businesses; this release still has one business per database and no business switcher.
- Journal quick-entry template still takes a VAT-inclusive total (only its rate prefill changed).
