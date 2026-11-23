# Msingi Accounting v0.6.9 — Till Basics and Payroll Proration

## Bug fix (important)
For items whose price is **entered without VAT** (VAT-registered business, item set to "price excludes VAT"), the books already recorded the sale at price + VAT, but the Quick Sale total (and v0.6.8 receipt) showed only the price. The till now shows and charges the real total (price + VAT, "includes VAT X" shown under it), and the receipt matches the books. Items priced with VAT included, services, zero-rated, exempt and non-VAT businesses are unchanged. If you sold VAT-exclusive items before this version, check those days: the books have the correct figure, but the customer may have been charged the lower one.

## New
- **Hold sale / Resume:** park the current sale (stored on this computer, survives restart) and serve another customer. Held sales are listed under the Payment panel.
- **Split payment:** choose "Split between two methods", enter the first method and amount; the second method takes the rest. Each part is posted as its own receipt in the right cash/bank/mobile account, VAT is split proportionally, and the receipt lists both payments. Not available for credit sales.
- **Daily cash-up** (bottom of Quick Sale): pick a day to see sales count, totals by payment method, credit sales and VAT. Enter opening float and counted cash to see expected cash and over/short. Print slip or copy text. Reversed sales are excluded. Only cash from sales is counted; allow for cash paid out in the float/count.
- **Payroll Prorate button:** for a starter or leaver mid-month the warning now has "Prorate to 18/30 days = TZS 720,000", which sets that row's gross (calendar-day method, based on the saved salary). The saved salary on the employee record is not changed.

## Not included yet
Refunds/returns of single items (a whole sale can still be reversed from Stock), cashier logins, direct printer control, EFD/VFD fiscal receipts.

## Tests
`node --experimental-strip-types tests/sale.test.ts` (VAT-inclusive/exclusive totals, grouping, split validation, split receipt, proration) plus earlier tests. The cash-up SQL was smoke-tested in SQLite. Screens are type-checked against stubs only; the first real build is the compile check.

## Acceptance tests
1. Build, launch. Sell an item set to "price excludes VAT" (VAT-registered business): total = price + VAT, matches the Income/VAT figures and the receipt.
2. Sell a normal item: total unchanged from before.
3. Hold a sale, sell something else, then resume the held one. Restart the app: held sale still there.
4. Split a sale: Cash 6,000 + Mobile money rest. Check two receipts in Transactions with the right accounts, VAT adds up, and the printed receipt shows both payments. Try amounts that do not fit: blocked.
5. Cash-up: today shows the sales by method; with a float and counted cash it shows Balanced/Over/Short. Reverse a sale from Stock and refresh: it drops out.
6. Payroll: month of a starter shows the Prorate button; clicking sets the gross to days/month of salary; posting works.
