# Msingi Accounting v0.5.3 — Mainland / Zanzibar, VAT-registered setting, statutory tax accounts

Builds on v0.5.2 (read MILESTONE_V0.5.2.md: database lock fix, Amount includes VAT, reconciliation by reference).

## Added
1. **Jurisdiction per business:** Tanzania Mainland (standard VAT 18%) or Zanzibar (15%). Choosing one prefills the rate
   unless you have typed a different one. Both rates are editable. Source: TRA, Taxes and Duties at a Glance 2025/26.
2. **"This business is registered for VAT" setting.** Untick it and no VAT is recorded on transactions, invoices or bills, the VAT
   controls disappear from the forms, and the VAT return is hidden from the menu. Records already saved are untouched.
   Invoices and bills may now carry treatment "No VAT recorded" (the VAT return already had a bucket for it).
3. **17 statutory tax accounts** added to the existing chart with no renumbering: 1310 WHT Receivable, 1320 Income Tax Paid in
   Advance, 1330 Customs & Clearance Deposits; 2110 WHT Payable, 2120 PAYE, 2130 SDL, 2140 Social Security (NSSF/PSSSF/ZSSF),
   2150 WCF, 2160 Income Tax Payable, 2170 Local Service Levy; 6400 Employer Social Security, 6410 SDL, 6420 WCF,
   6430 Licences & Municipal Fees, 6440 Stamp Duty, 6450 Local Service Levy, 6500 Income Tax Expense.
   Available for manual journals straight away; shown in the trial balance and income statement only once used, so existing reports look as before.
4. Builder script recreates the installer folder before copying the DMG.

## Not included (needs your rules first)
Automatic posting of PAYE/SDL/NSSF/WCF (payroll), withholding tax on payments, turnover tax calculation, and rates for those taxes.
No such rate is built into the app. Rates and thresholds differ between Mainland and Zanzibar and change (e.g. SDL 3.5% Mainland / 4% Zanzibar;
turnover tax threshold raised to TZS 200m and 4% from 1 July 2026). Verify every rate with TRA or your tax adviser before relying on it.

## Verified
All v0.5.2 tests plus: jurisdiction defaults and isolation, not-registered mode, documents with no VAT, new accounts correctly typed,
existing accounts unchanged, trial balance unchanged on a v0.5.1 database. Tauri build and screens still need a click-through on your Mac.
