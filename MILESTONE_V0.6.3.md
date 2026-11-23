# Msingi Accounting v0.6.3 — Advanced Reports & Responsive Workspace

## Scope
- Keep the v0.6.2 consolidated dashboard and all nine indicators.
- Keep Income Statement and Balance Sheet in a two-column layout on desktop widths.
- Use flexible grid sizing and min-width: 0 so maximised/resized windows use the available content width without accidental overflow.
- Add ledger-derived monthly income, expenses and net profit/loss analytics.
- Add expense-by-account analysis.
- Add cash and bank debit/credit movement summary for accounts 1000, 1010 and 1020.
- Export management analytics to CSV.

## Accounting notes
- Analytics include posted and reversed journals; a posted journal and its reversal net to zero. Draft journals are excluded.
- Cash/bank debit and credit figures are gross movements. Transfers between cash/bank accounts may appear on both sides, so this is explicitly labelled a movement summary, not a formal statement of cash flows.
- Existing accounting calculations, database schema and stored records are unchanged.

## Release
- Application version: 0.6.3
- Target: Intel macOS (x86_64)
- Installer: Msingi-Accounting-v0.6.3-Intel-Mac.dmg

## Verification required on the Intel Mac
- Build with the supplied safe builder.
- Verify Income Statement and Balance Sheet remain side by side when maximised.
- Resize below 760 CSS pixels and verify panels stack cleanly.
- Reconcile monthly income/expenses/net profit to the Income Statement for matching periods.
- Verify expense category totals against the Income Statement expense total.
- Verify cash/bank movement figures against journal lines for accounts 1000, 1010 and 1020.
- Test CSV export and confirm v0.6.2 data remains intact.
