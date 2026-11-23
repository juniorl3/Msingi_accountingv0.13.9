# Msingi Accounting v0.7.0 — Refunds and Returns

## What it does (Quick Sale page → "Refund or return items")
Choose one of the 40 most recent paid sales, enter the quantity coming back on each line (part-returns and several returns per sale are allowed), choose how the refund is paid, give a reason, and refund.

**Ledger**
- Dr Sales (4000/4100) for the net amount, Dr VAT Payable (2100) for the VAT, Cr Cash/Bank/Mobile money for the gross refund.
- Stock items: Dr Inventory (1200), Cr Cost of goods sold at the **original cost**; quantity and value go back into stock. Menu items and services are refunded without restocking.
- Each return is a stock event of kind "return" (visible on the Stock page and reversible there).

**Maths:** shares are cumulative per line, so several part-returns always add up exactly to the original gross, net, VAT and cost with no rounding drift.

## Effects elsewhere
- **VAT return:** refund VAT is counted as a deduction in the period it is paid ("Reversed in this period"), so output VAT for the period is correct.
- **Sales by item:** returns reduce quantity, sales and cost in the period of the refund.
- **Daily cash-up:** refunds are listed by method and cash refunds reduce expected cash.
- **Reversing a sale** that has returns is blocked until the returns are reversed (Stock page), so stock is never restored twice.

## Limits
- Sales made before v0.7.0 have no saved VAT breakdown and cannot be refunded here (reverse the whole sale on the Stock page).
- On-credit (invoiced) sales are not supported yet (no credit notes).
- Refund pays back one method per refund; refunding a split-payment sale in two methods means two refunds.
- No customer-facing refund receipt beyond a printable slip.

## Database
Additive only: two nullable columns on `sale_lines` (gross, VAT) and a new `sale_returns` table. Existing data is untouched.

## Tests
`node --experimental-strip-types tests/returns.test.ts` (cumulative shares, odd splits, fractional quantities, limits) plus earlier tests. All new SQL was smoke-tested in SQLite. Screens are type-checked against stubs only; the first real build is the compile check.

## Acceptance tests
1. Back up, build, launch. Make a **new** test sale of 3 stock items at 11,800 total (VAT-inclusive, VAT-registered), paid Cash.
2. Quick Sale → Refund: pick the sale, return 1. Preview shows 3,933. Refund. Check: Transactions/Journal shows Dr Sales 3,333 + Dr VAT 600, Cr Cash 3,933; Inventory +2,000 at cost; stock quantity +1.
3. Return the remaining 2 in two steps; total refunded equals exactly 11,800; the sale can then not be returned further.
4. VAT return for the month: output VAT reduced by the refund VAT. Sales by item: quantity/sales reduced.
5. Cash-up for that day: refund line shown, expected cash reduced.
6. Try reversing the original sale: blocked until the returns are reversed on the Stock page. Reverse a return: stock and money are restored.
7. Open an older sale (before v0.7.0) and a credit sale: the screen explains why they cannot be refunded here.
