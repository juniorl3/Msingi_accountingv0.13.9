# Msingi Accounting v0.4.0 — Customers, Suppliers, Invoices, Bills & Aging

Built on v0.3.0 (includes backup and restore). **Back up before first launch** (Settings → Backup & restore in v0.3.0, or copy `~/Library/Application Support/com.msingi.accounting`).
Existing data is untouched: v0.4.0 only adds three new tables (parties, documents, doc_payments).

## New sidebar section: Receivables & Payables
- **Customers / Suppliers:** name, phone, email, TIN, notes. Duplicate names are blocked. The list shows what each customer owes you / what you owe each supplier. A settled account can be deactivated.
- **Sales invoices:** choose customer, dates, VAT-inclusive total, VAT rate (default 18%, editable) and income account. Posts **Dr Accounts Receivable (1100) / Cr income (net) / Cr VAT Payable (2100)**.
- **Supplier bills:** posts **Dr expense or Inventory (net) / Dr VAT Receivable (1300) / Cr Accounts Payable (2000)**.
- **Payments (full or partial):** invoices: Dr Cash/Bank/Mobile money / Cr Receivables. Bills: Dr Payables / Cr Cash/Bank/Mobile money. A payment cannot exceed the outstanding balance or be dated before the document.
- **Aging reports:** receivables and payables by customer/supplier: not yet due, 1–30, 31–60, 61–90, over 90 days overdue. Also shows whether customer/supplier balances agree with the ledger control accounts 1100 and 2000.
- Invoice and bill numbers have their own sequences (INV-000001, BILL-000001). Every document and payment is a normal posted journal, so it appears in the General Ledger, Trial Balance, Income Statement, Balance Sheet and Audit trail.

## Corrections (no editing or deleting)
- To cancel an invoice or bill, reverse its journal under **Journal entries**; it then shows as **Void** and drops out of balances.
- If payments exist, the app refuses to reverse the document until its payment journals are reversed first. Reversing a payment journal restores the outstanding balance.

## Integrity checks (Financial reports page) — three new checks
Customer invoices agree with account 1100; supplier bills agree with 2000; no document is overpaid. **A manual journal posted to 1100 or 2000 outside an invoice/bill will make the first two fail by design** (the ledger and the customer/supplier list disagree). Use invoices/bills for receivables and payables.

## Tested before release (real ledger and party code run against a real SQLite database, 41 checks)
Duplicate names; invoice posting amounts; VAT split; refusals (wrong account type, supplier on invoice, due before date, non-whole amount) leave no partial records; partial payments; overpayment/non-cash/early-date refusals; reversing an invoice with payments is blocked; reversing a payment restores the balance; full payment; bill posting; void invoices; aging buckets; reconciliation and its failure when a manual journal touches 1100; balance sheet still balances; deactivation rules.
**Not run here:** the screens themselves (Receivables.tsx) and the full TypeScript build. Those are the first things to check on the Mac.

## Test after building (on a backup)
1. Sidebar v0.4.0 and a new "Receivables & Payables" section.
2. Customers → Add customer "Test Customer". Suppliers → Add supplier "Test Supplier".
3. Sales invoices → New invoice: Test Customer, 118,000, 18%, Sales Revenue. Trial balance: 1100 = 118,000, Sales 100,000, VAT Payable 18,000.
4. Open the invoice → Record payment 50,000 to Bank. Outstanding 68,000. Try paying 100,000: refused.
5. Try reversing the invoice's journal (Journal entries): refused, payments exist. Reverse the payment's journal: outstanding returns to 118,000.
6. Pay the invoice in full: status Paid. Aging reports: nothing outstanding for it.
7. Supplier bills → New bill 59,000 at 18%, Other Operating Expenses. Trial balance: expense 50,000, VAT Receivable 9,000, Payables 59,000. Pay it.
8. Financial reports: Balanced, all integrity checks tick.
9. Create an invoice dated two months ago, due one month ago: it appears under 31–60 days in Aging.

## Limitations
- No printable/PDF invoice document, no credit notes, no multi-line invoices, no stock/quantity tracking, no automatic reminders.
- Aging is as at today only.
- Documents are created for whole-TZS amounts only. The "Add transaction" form still does not handle VAT or customers.
- Development milestone, not a certified statutory release.
