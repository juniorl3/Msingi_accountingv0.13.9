# Msingi Accounting v0.6.6 — Employee & Payroll Control Fixes

Corrects gaps found when reviewing v0.6.5 against its own milestone notes.

## Fixes
1. **Employee numbers are now per business.** v0.6.5 used the global row id, so a second business started mid-sequence. Numbers now continue from that business's own highest EMP number.
2. **Payroll rules are enforced in the engine, not just the screen.** `computePayroll` rejects a repeated employee; `postPayrollRun` re-checks inside the posting transaction that every line is a registered employee of this business, is monthly-paid, has started by the month end, and (if inactive/terminated) left no earlier than the month start.
3. **"Authorized payroll preparers" wording removed.** The app has no user roles or login gating; anyone who can open it can view salaries and post payroll. Protect the Mac account and backups accordingly. Role/PIN protection is a candidate for a later milestone.
4. **Prefill matches by employee ID.** Previously by name, which broke on duplicate names, renames and later-inactive staff. Old runs without IDs fall back to a name match only when exactly one employee has that name.
5. **Prefill uses the current saved salary** from the register, not last run's amount.
6. **Final salary can be paid.** New **End date** on employee records (additive `ALTER TABLE`, existing rows get blank). Inactive/Terminated employees appear in the payroll selector for months up to their end date. Terminated status requires an end date.
7. **Start date is respected.** Staff starting after the payroll month ends are not selectable and are rejected on posting. A non-blocking warning appears for staff who started or left part-way through the month (no automatic proration).
8. **Fuller audit trail.** Employee updates now log old → new values for name, job title, department, dates, employment type, pay frequency, gross salary and status.
9. Validation: real calendar dates (rejects 2026-13-45), end date not before start date, basic email format.

## Not changed
Payroll arithmetic, rates, journals, liability tracking and remittances are untouched. No proration, leave, advances or payslips yet.

## Tests
`node --experimental-strip-types tests/employeeRules.test.ts` covers numbering, date validity, eligibility, warnings and duplicate rejection.

## Acceptance tests (Intel Mac)
1. Back up, build, launch; confirm existing employees, payroll runs and journals appear. Existing employees show a blank end date.
2. Register employees in a second business; numbering starts at EMP-0001 there.
3. Change an employee's salary; open Payroll and select them — the new salary prefills.
4. Set an employee Terminated with an end date in the current month; confirm they still appear for that month's payroll and not for the following month.
5. Try to save Terminated with no end date; confirm it is blocked.
6. Set a start date in a future month; confirm they are not selectable for the current month.
7. Edit a salary and inspect the Audit log for old → new values.
8. Post a test payroll, confirm the journal balances, then reverse it if on live data.

**Limitation:** this build was type-checked for the logic and database layers only; the React screens were reviewed but not compiled here. Run the normal build and the tests above.
