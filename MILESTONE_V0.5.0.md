# Msingi Accounting v0.5.0 — VAT End to End

Built on v0.4.1. **Back up before first launch** (Settings → Backup & restore).
Database changes: adds VAT columns to the transactions and documents tables on first start. Nothing is deleted or rewritten, except that v0.4 invoices and bills that already carried VAT are labelled "Standard rate".

## Added
1. **VAT in Add transaction.** New "VAT" choice: No VAT recorded (default), Standard rate (the amount you enter includes VAT), Zero-rated, Exempt. A live breakdown shows net + VAT = total. Income posts VAT to VAT Payable (2100); expenses post VAT to VAT Receivable (1300). Not offered for Capital introduced or Salaries.
2. **VAT return working summary** (sidebar → Management → VAT return). For any period, with This month / Last month buttons:
   - VAT Payable (2100): opening balance, VAT charged on sales, reversed (voided) documents, payments/refunds/manual adjustments, closing balance.
   - VAT Receivable (1300): the same for purchases.
   - Net VAT for the period (output less input) and net VAT position at the end.
   - Sales and purchases by VAT treatment (standard, zero-rated, exempt, none) with the voided-in-period deduction.
   - Every VAT journal line in the period, labelled VAT on sales / VAT on purchases / Reversal / Payment or adjustment.
   - CSV export.
   A document voided by reversal still counts in the period it was dated and is deducted in the period the reversal is dated, like a credit note.
   **This is a working summary, not an official TRA form.** Confirm the layout, rules and rate with your tax adviser or TRA.
3. **Default VAT rate** in Settings (starts at 18%). It pre-fills Add transaction, invoices, bills and the journal VAT template.
4. **Zero-rated / exempt per document** on sales invoices and supplier bills, with the treatment shown on the document.
5. **Two new integrity checks:** VAT recorded on invoices, bills and transactions agrees with VAT Payable (2100) and VAT Receivable (1300) in the ledger.
6. Transactions list shows "incl. VAT …" under the description. Dashboard income and expense totals are net of VAT because they come from the ledger.

## Behaviours to know
- Payments to TRA are not a built-in feature: post them as a journal (Dr VAT Payable / Cr Bank). They appear in the report under "Payments, refunds and manual adjustments".
- Transactions entered before this update show "No VAT recorded".
- "No VAT recorded" sales and purchases are listed separately, so you can see what has no VAT assigned.
- The simple Add transaction form has no customer or supplier. Use invoices and bills when you need to track who owes what.

## Tested before release
Real ledger, party and VAT code against a real SQLite database (28 end-to-end checks, plus the earlier 41 for v0.4): upgrade of existing v0.4 data (columns added, VAT-bearing documents → standard; running the upgrade twice is harmless); default rate validation; posting for standard, zero-rated, exempt and no-VAT transactions; refusal of VAT on capital and salaries, of a missing rate and of non-whole amounts (no partial records left); documents by treatment; November and December VAT returns with opening balances, a TRA payment, a same-month void and a later-month void; both integrity checks, including detection of mismatched VAT; balance sheet still balances; income statement net of VAT.
Also: strict TypeScript check of the screens against stand-in library types, file-name case clash check, and import-path check.
**Not run here:** the screens in a real window and the full build (the first full compile happens on your Mac).

## Test after building (on a backup)
1. Sidebar v0.5.0, with "VAT return" under Management.
2. Settings: Default VAT rate shows 18; change to 17, save, change back to 18.
3. Add transaction → Income, Sales, 118,000, VAT: Standard rate 18%. Breakdown shows 100,000 + 18,000. Save. Trial balance: Cash +118,000, Sales +100,000, VAT Payable +18,000.
4. Add transaction → Expense, Rent, 59,000, Bank, Standard rate. Trial balance: Rent 50,000, VAT Receivable 9,000.
5. Add transaction → Income, Capital introduced: no VAT choice appears.
6. New zero-rated and exempt sales invoices (Receivables → Sales invoices). Open them: VAT treatment is shown.
7. VAT return → This month: output 18,000 (+ any invoice VAT), input 9,000, net payable the difference. Sales by treatment shows the zero-rated and exempt amounts. Export CSV and open it.
8. Post a journal Dr VAT Payable 5,000 / Cr Bank 5,000. It appears under "Payments, refunds and manual adjustments"; closing balance drops by 5,000.
9. Reverse the 118,000 sale (Journal entries → Reverse). VAT return for the reversal month shows the 18,000 deduction.
10. Financial reports: Balanced and all integrity checks ticked (now 10 checks, including 2 VAT checks).

## Limitations
- Not an official TRA return; no e-filing; no VAT on payments received in advance, no partial-exemption or reverse-charge rules.
- One standard rate at a time (set in Settings); other rates can be typed per transaction or document.
- Development milestone, not a certified statutory release.


## v0.5.1 hotfix — invoice creation ID retrieval
- Fixed invoice/bill creation failing when a follow-up SELECT returned no rows.
- Uses SQLite plugin execute() lastInsertId from the INSERT result and validates it before creating the ledger journal.
- No existing documents or accounting data are modified by this source change.
