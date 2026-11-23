# Msingi Accounting v0.6.5 — Employee Register & Payroll Controls

## Employee register
- New Employees workspace with employee records scoped to the active business.
- Auto-generated employee numbers (EMP-0001 sequence per business).
- Captures full name, contact details, job title, department, start date, employment type, pay frequency, gross salary, status and notes.
- Supports Active, Inactive and Terminated statuses.
- Existing records are edited or status-changed; employee records are not hard-deleted.
- Employee registration is separate from application login accounts. Registering an employee does not create a login.

## Payroll controls
- Payroll entry selects from active, registered, monthly-paid employees.
- Saved monthly gross salary is prefilled; authorized payroll preparers can adjust the amount for a specific run.
- The same employee cannot be included twice in one payroll run.
- Payroll lines retain employee IDs alongside the employee name and pay details for newly posted runs.
- Existing payroll calculations, editable jurisdiction-specific rates, liability tracking, remittance journals and duplicate-period confirmation are retained.
- Ordinary income and expense transactions remain available without employee registration.

## Data and accounting safeguards
- New SQLite employees table is created with `CREATE TABLE IF NOT EXISTS`; existing accounting tables and transactions are not rewritten.
- Employee records are business-scoped and audited on create/update.
- Inactive and terminated employees remain available in historical payroll records.
- Payroll posting continues to create a balanced journal through the existing payroll engine.

## Known boundaries
- Payroll computation is monthly. Employees with weekly, daily or hourly pay frequency are registered but are not offered in the monthly payroll selector. Their pay frequency must be set to Monthly to include them in this payroll workflow.
- Payroll tax and statutory contribution rates remain configurable defaults; confirm current obligations with TRA/ZRB and the relevant social security and WCF authorities before posting payroll.
- This milestone does not yet include leave, attendance, advances, loans, automated payslip PDF, or termination settlement workflows.

## Intel Mac acceptance tests
1. Build using the supplied Intel Mac builder.
2. Launch v0.6.5 and confirm existing business, transactions, accounts, journals and reports remain available.
3. Register an employee and confirm an EMP number is assigned.
4. Edit the employee and confirm changes are saved.
5. Change an employee to Inactive and confirm they disappear from the monthly payroll selector but remain in the register.
6. Register two active monthly-paid employees; confirm their gross salaries prefill in payroll.
7. Attempt to add the same employee twice; confirm the duplicate is blocked.
8. Preview and post a test payroll; confirm the journal balances and payroll history retains the employee names and IDs.
9. Reverse the test journal if it was posted to a live business ledger.
10. Back up the database before installing or testing on the primary business data.
