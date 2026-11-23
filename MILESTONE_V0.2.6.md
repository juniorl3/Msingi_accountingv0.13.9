# Msingi Accounting v0.2.6 — Multi-line Journals & VAT Helper

Built on v0.2.4 (the v0.2.5 financial-statements update has not been built yet).

## Added
- **Multi-line journal entries.** Add as many lines as needed, each with an account, a debit or credit, and an optional memo. Blank lines are ignored; at least two used lines are required.
- **Live balance check.** Totals update as you type. Posting is disabled until total debits equal total credits, and the form says exactly what is wrong (out of balance by TZS x, a line with both debit and credit, a missing account, a non-whole amount).
- **VAT quick templates.** "Sale including VAT" posts Dr payment account (gross) / Cr income (net) / Cr VAT Payable 2100 (VAT). "Purchase / expense including VAT" posts Dr expense (net) / Dr VAT Receivable 1300 (VAT) / Cr payment account (gross). The template only fills the lines; you can edit them before posting.
- **New account 1300 VAT Receivable (Input VAT)**, added automatically to existing databases on startup. Existing accounts and records are untouched.

## VAT arithmetic
VAT = round(gross × rate / (100 + rate)); net = gross − VAT, so net + VAT always equals the gross exactly, in whole TZS. Tested over 171,000+ generated sale/purchase cases: every journal balanced. The default rate is 18% and is editable. Confirm the correct rate and treatment with your tax adviser or TRA.

## Unchanged
Reversal, audit trail, trial balance, ledger and the database schema are unchanged. Reversing a multi-line journal swaps every line (existing v0.2.3 logic).

## Test after building (on a backup)
1. Version in sidebar reads v0.2.6; Chart of accounts shows 1300.
2. New journal → template "Sale including VAT", total 118,000, 18%, Fill lines: expect Cash 118,000 Dr; Sales 100,000 Cr; VAT Payable 18,000 Cr; "Balanced". Post.
3. Trial balance: Cash +118,000, Sales 100,000, VAT Payable 18,000.
4. Open the journal, reverse it: Cash, Sales and VAT Payable all return to their earlier balances.
5. "Purchase including VAT" 59,000: expect Expense 50,000 Dr; VAT Receivable 9,000 Dr; Cash 59,000 Cr.
6. Change one amount so it does not balance: the Post button must be disabled.
7. Manual 3-line journal with a remove-line and add-line: posts correctly.

## Limitations
- The "Add transaction" form (simple income/expense) does not yet handle VAT; use Journal entries for VAT transactions. Dashboard income/expense totals still read the transactions table, which is planned to move to the ledger in the financial-statements update.
- No VAT return report yet; VAT Payable/Receivable balances are visible in the trial balance and ledger.
- Not a certified statutory release.
