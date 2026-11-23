# Msingi Accounting v0.6.7 — Salary Advances, Animated Calendar, Animation Fixes

## 1. Salary advances (Employees page → "Salary advances")
- **Give advance:** active employee, date, amount, optional monthly recovery, paid from Cash/Bank/Mobile money. Journal: Dr 1340 Employee Salary Advances / Cr cash-bank-mobile. Soft warning if the employee would owe more than one month's gross.
- **Recovery through payroll:** the Payroll table has an *Advance recovery* column, prefilled from the monthly recovery (capped at the balance owed and at take-home pay) and editable. Net pay = gross − social security − PAYE − advance. The payroll journal credits 1340 for the recovered amount; PAYE, SDL, WCF and employer cost are unchanged.
- **Cash repayment:** "Repayment" button; Dr cash/bank/mobile, Cr 1340. Applied to the oldest advance first.
- **Checks in the posting transaction:** recovery cannot exceed what is owed or the employee's pay after SS and PAYE.
- **Reversals:** balances count only posted journals, so reversing a payroll or repayment journal restores the balance automatically; reversing an advance is blocked while posted repayments/recoveries exist.
- New tables `salary_advances`, `salary_advance_recoveries` (additive); account 1340 is added to existing books automatically.
- Not included: interest, write-offs, payslips. Confirm with your accountant whether interest-free staff loans have tax consequences, and keep written employee consent for deductions.

## 2. Animated calendar
- Every date and month field now has a calendar button. Click the month or year in the header to zoom out (days → months → years, 12-year pages); pick to zoom back in. Arrows slide between months/years; "Today" and "Clear" shortcuts; Esc closes; opens upward near the screen bottom; Monday-first weeks.
- You can still type YYYY-MM-DD (or YYYY-MM); invalid text reverts on leaving the field.

## 3. Animation fixes
- Chart bars now animate smoothly when the date range changes (before they snapped).
- Legend swatches no longer play the bar-grow animation.
- Entrance animations no longer leave a permanent transform on report blocks (which could mis-position popups).
- Added modal/notice entrance animation.
- One reduced-motion rule now disables every animation and transition.

## Tests
`node --experimental-strip-types tests/<name>.test.ts` for `employeeRules`, `calendar`, `advances` (all pass). The SQL for advance balances was smoke-tested in SQLite. The React screens were type-checked only against stubs, so the first real build is the compile check.

## Acceptance tests (Intel Mac)
1. Back up; build; launch; confirm earlier data and the new account 1340 on Balance sheet/Trial balance (zero).
2. Open any date field: calendar animates; click month → year → pick year → month → day; type a date manually; try Esc; try near the bottom of a modal.
3. Give an employee a 300,000 advance with 100,000 monthly recovery paid from Cash; check the journal (Dr 1340, Cr Cash).
4. In Payroll select that employee: advance recovery shows 100,000, net pay drops by it. Post; check the journal balances and the advance shows 100,000 recovered.
5. Record a 50,000 cash repayment; outstanding becomes 150,000.
6. Reverse the payroll journal; the advance goes back up by 100,000. Try reversing the advance itself while repayments exist: it is blocked.
7. Change report dates and watch bars animate; enable macOS Reduce Motion and confirm animations stop.
