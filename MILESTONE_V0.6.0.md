# Msingi Accounting v0.6.0 — Items & stock for shops, supermarkets and restaurants

## New sidebar group: Stock & sales
- **Items**: stock items (bought and resold), services, and menu items (restaurants). Code, barcode, unit, selling price, VAT treatment, "price includes VAT", low-stock warning level. Search, filter, switch off (history kept). **Import from CSV** (template provided; all-or-nothing, errors listed by row) and **Export**. Opening stock can be loaded per item or in the import.
- **Quick sale**: scan a barcode (or type a name or code) and press Enter. Quantities and prices editable per line. Pay by cash, mobile money, bank or card, or sell on credit to a customer (creates an invoice).
- **Stock**: stock on hand with average cost and margin, **Receive stock**, **Adjust stock** (wastage, damage, stock-take difference, business use), movement history with one-click **Reverse**, valuation export.

## How it posts (all in ONE database transaction)
- Receive on credit: supplier bill, Dr Inventory 1200 + Dr Input VAT, Cr Accounts Payable. Receive paid now: "Stock purchase" expense to Inventory.
- Sale: normal income transaction (paid) or customer invoice (credit), one per VAT treatment (standard / zero-rated / exempt), then Dr Cost of Goods Sold 5000, Cr Inventory 1200 at weighted-average cost.
- Restaurants: a menu item's recipe takes its ingredients out of stock at average cost on each sale.
- Adjustments: Dr COGS (wastage, damage, count loss) or Other expenses (business use), Cr Inventory; gains reverse that.
- Opening stock: Dr Inventory, Cr Owner Capital (3000), or "already in my books" (no entry).
- Reverse: reverses every ledger entry of the event and restores quantities exactly. Refused (nothing changes) if stock was already sold from a purchase, or if a bill has payments.
- Not VAT-registered: no VAT is recorded on stock sales or purchases.

## Checks added to the Integrity page
Stock valuation agrees with Inventory (1200); each item's stock equals its movements; no sale or purchase reversed in the ledger only.

## Also in this release
In-app confirmation windows replace browser pop-ups (Payroll "post again", Tax rates "restore defaults"), which are unreliable in a desktop app.

## Not included
Barcode label printing, receipts/printing, suppliers' prices per item, batch/expiry dates, multiple stores or locations, returns to supplier as a single step (reverse the receipt), kitchen order tickets and table management, FIFO costing, discounts on sale lines (change the price instead).

## Compatibility
Adds tables items, recipe_lines, stock_events, stock_moves, stock_event_links. No existing table, journal, invoice or transaction changes. Posting functions gained an optional transaction argument; behaviour unchanged (all earlier suites pass). 25 new tests.
