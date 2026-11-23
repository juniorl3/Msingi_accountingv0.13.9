# Msingi Accounting v0.6.4 — Reports, Save Dialogs & Responsive Polish

## Included
- Period comparison for income, expenses and net profit/loss against the immediately preceding period of equal length.
- Cash and bank opening/closing position reconciliation for accounts 1000, 1010 and 1020.
- Detailed PDF financial report export using jsPDF.
- Multi-sheet Excel workbook export (Income Statement, Balance Sheet, Monthly Insights, Expenses by Account and Cash Position).
- CSV exports use the native Save dialog, allowing the user to choose the folder and filename.
- PDF export uses the native Save dialog, allowing the user to choose the folder and filename.
- A success message appears only after the selected file has been written; cancellation does not claim success and errors are reported.
- Subtle chart bar and analytics panel animations, disabled when the OS requests reduced motion.
- Existing v0.6.3 report layout and v0.6.2 compact dashboard are retained.

## Accounting boundary
The cash/bank panel is an opening-to-closing cash-position reconciliation, not a classified statement of cash flows. A formal operating/investing/financing statement requires reliable cash-flow classifications for ledger accounts and transaction purposes. The app intentionally does not mislabel this reconciliation as a formal cash flow statement.

## Technical changes
- Application version: 0.6.4 in package.json, Tauri config and Cargo manifest.
- Tauri dialog and filesystem plugins added for native Save dialogs and writes.
- jsPDF added for PDF generation; SheetJS added for Excel workbook generation.
- No database schema migration and no accounting records are modified by these report features.

## Intel Mac acceptance tests
1. Build with the supplied safe builder on Intel macOS.
2. Open Financial Reports and change the From/To dates; verify period comparison recalculates.
3. Verify cash opening/closing balances agree with accounts 1000, 1010 and 1020 at the displayed dates.
4. Export each CSV; verify native Save dialog allows folder and filename selection.
5. Export PDF; verify detailed Income Statement, Balance Sheet and monthly insights are present.
6. Cancel a save dialog and verify no success message appears.
7. Save each file and verify the success message appears only after the file is written.
8. Verify reduced-motion setting disables chart animations.
9. Reconcile figures to ledger and retain v0.6.3 backup until acceptance is complete.
