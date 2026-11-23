# Msingi Accounting v0.5.5 — Every tax rate editable in Settings

## Settings → Tax rates (new)
- **VAT**: unchanged (VAT preferences block); the Tax rates panel points to it.
- **Payroll taxes**: PAYE bands and rates, employee/employer NSSF-PSSSF-ZSSF %, SDL % and employee threshold, WCF % and on/off. (Moved here from the Payroll page.)
- **Income tax, turnover tax, service levy**: corporate income tax %, turnover tax % and its lower/upper turnover limits, local service levy %.
- **Withholding tax on payments to residents**: 13 payment types, each editable.
- Each block has Save and Restore defaults. Changes are audited. Rates are per business; defaults follow Mainland/Zanzibar.

## New page: Tax estimate
Period income statement -> estimated corporate income tax, turnover tax (when turnover is inside the configured range) and service levy. Includes a withholding tax calculator (amount -> withheld and net payable). Estimates only; WHT is not posted automatically.

## Defaults checked 2026-11-11 (confirm with TRA / ZRB)
Corporate 30%; WHT residents: dividends 5% (DSE-listed) / 10%, interest 10%, royalties 10%, rent 10%, vehicle hire 10%, equipment rent 10%, services 10%, commissions 10%, goods to Government 2%, directors' fees 15%, natural resources 15%, agricultural/fishery 1%; turnover tax 4% for TZS 11m–200m (Finance Act 2026, from 1 Jul 2026). Service levy 0.3% is NOT in the TRA publication (unverified). Zanzibar has no ZRB-sourced figures: Mainland values are used as a starting point and the levy is 0.
Sources: TRA Taxes and Duties at a Glance 2025/26; Clyde & Co Finance Act 2026 summary.

## Not included
Automatic WHT posting on supplier payments, tiered turnover tax below TZS 11m, stamp duty, advance/instalment tax schedules.

## Compatibility
No schema change: rates live in business_settings. Accounting data, VAT return and exports unchanged. 6 new tests; all earlier suites pass.
