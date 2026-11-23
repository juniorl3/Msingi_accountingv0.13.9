# Msingi Accounting v0.5.4 — Payroll posting

## New: Payroll (sidebar, under Management)
- **Run payroll**: enter each employee's gross monthly pay. Msingi calculates, per employee, social security (NSSF/PSSSF or ZSSF), PAYE and net pay, then the employer's SDL and WCF, and posts ONE balanced journal.
- Journal: Dr 6100 Salaries (gross), Dr 6400 employer social security, Dr 6410 SDL, Dr 6420 WCF;
  Cr 2120 PAYE, Cr 2140 social security (employee + employer), Cr 2130 SDL, Cr 2150 WCF, Cr cash/bank/mobile money (net pay).
- **Owed to authorities**: shows what is still owed on PAYE, SDL, social security and WCF, and records payments (Dr liability, Cr cash/bank). Cannot pay more than is owed.
- **Payroll runs**: history with per-employee detail. Undo a run by reversing its journal; the month can then be posted again. Posting the same month twice asks for confirmation.
- **Payroll rates**: every rate is editable per business; "Restore defaults" returns to the jurisdiction's defaults.

## Defaults (checked 2026-11-11 — CONFIRM WITH TRA / ZRB BEFORE RELYING ON THEM)
| | Mainland | Zanzibar |
|---|---|---|
| PAYE (monthly, on gross less employee social security) | 0% to 270,000; 8% to 520,000; 20% to 760,000; 25% to 1,000,000; 30% above | same bands (per PaySpace 2024 guide; confirm with ZRB) |
| Social security | NSSF/PSSSF 10% employee + 10% employer | ZSSF 7% employee + 14% employer |
| SDL (employer) | 3.5%, employers with 10+ employees (TRA) | 5% (PaySpace 2024). v0.5.3 notes said 4%; sources disagree — confirm with ZRB |
| WCF (employer) | 0.5% | 0.5% |
Sources: TRA SDL page; PaySpace Tanzania and Zanzibar payroll guides; PaySpace Finance Act 2026 summary (payroll rates unchanged for 2026/27).

## Not included
ZHSF / NHIF health contributions, benefits-in-kind, overtime/allowances split, loans and advances, payslips, annual PAYE reconciliation, statutory return files.

## Compatibility
Adds one table (payroll_runs). No existing table, journal, invoice or transaction is changed. VAT return and CSV exports unchanged. Accounts 2120–2150 and 6400–6420 already existed from v0.5.3 and still appear on the trial balance only once used.

## Tests
12 new payroll tests (hand-computed PAYE, totals, balanced journal, rollback, remittance limits, reversal and re-run, rates, Zanzibar defaults); all earlier suites still pass.
