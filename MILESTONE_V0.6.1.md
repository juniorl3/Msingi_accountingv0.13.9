# Msingi Accounting v0.6.1 — See your profit and cash clearly

## Income statement (Financial reports)
Income, then **Cost of goods sold**, then **Gross profit** (with margin % of income), then **Operating expenses**, then **Net profit**. Businesses with no cost-of-goods account see the same plain layout as before. Net profit, total income and total expenses are unchanged; the CSV export has the new lines.

## Dashboard
Two new rows under the existing cards:
- Cash & bank (cash + bank + mobile money) · Owed to you (open invoices) · You owe (open bills)
- This month's income · This month's gross profit (or expenses when there is no cost of goods) · This month's net profit or net loss

## New page: Sales by item (Stock & sales)
For any period: quantity sold, sales before VAT, cost, profit and margin per item, best profit first, with totals and CSV export. Totals equal the income statement and cost of goods sold. Menu items carry their ingredients' cost; an ingredient shared by two menu items is split by usage. Reversed sales are left out.
Only sales recorded from v0.6.1 on are itemised (older sales still count in the income statement).

## Compatibility
Adds one table (sale_lines). No existing data changes. 7 new tests; all earlier suites pass.
