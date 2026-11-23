# Msingi Accounting v0.2.7 — Financial Statements from the Ledger

Built on v0.2.6. No database changes: existing records are untouched.

## Added (Financial reports page)
- **Income statement** for any date range: income and expenses by account, total income, total expenses, net profit or loss.
- **Balance sheet** as at any date: assets, liabilities, equity and "profit to date (not yet closed)", with a Balanced / Out of balance indicator. There is no period-closing yet, so profit to date is shown inside equity.
- **Integrity checks** (run automatically): every journal balances and has at least two lines; total debits equal total credits; no orphan journal lines; every reversed journal has a matching linked reversal; every transaction record is posted to the ledger.
- **Exports (CSV):** statements, all journals with their lines, and the full audit trail. These are for safekeeping and review; a proper backup and restore is still planned.

## Changed
- **Dashboard totals (income, expenses, net position) now come from the ledger**, so they match the Trial balance and the statements, include manual and VAT journals, and handle reversals correctly. Capital introduced and stock purchases are not counted as income or expense because they post to equity and inventory.
- Reports and statements count `posted` and `reversed` journals, so an original and its reversal net to zero. Drafts are excluded.

## Tested before release
The exact SQL was run against sample data: reversed sale nets to zero, a draft is ignored, balance sheet balances (assets 5,186,000 = liabilities 36,000 + equity 5,000,000 + profit 150,000), date filters work, and each integrity check fails when the data is deliberately broken.

## Test after building (on a backup)
1. Sidebar reads v0.2.7.
2. Financial reports: set From to 1 January and To to today. Net profit should equal Dashboard Net position.
3. Balance sheet shows "Balanced". If your data was entered before the v0.2.4 fix, still expect Balanced, because reports now count reversed originals.
4. Integrity checks all show a tick. If "Every transaction record is posted" fails, a legacy transaction with a non-whole TZS amount needs review.
5. Post a 118,000 sale with VAT (v0.2.6 template): Income statement shows sales 100,000 and VAT Payable appears under liabilities.
6. Reverse that journal: income statement and balance sheet return to their earlier figures.
7. Export statements, journals and audit trail; open each CSV.

## Limitations
- No period closing or retained-earnings roll-forward; no cash flow statement; no printing/PDF yet.
- "Add transaction" still has no VAT option (use Journal entries).
- The exports are not a restorable backup. Back up the application data folder as well.
- Development milestone, not a certified statutory release.
