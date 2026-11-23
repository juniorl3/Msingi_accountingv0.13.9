# Msingi Accounting v0.7.1 — Product Category Management

## Included
- Introduces a business-scoped `item_categories` master table.
- Automatically migrates existing non-empty free-text item categories when the application starts.
- Adds category creation, renaming and deletion with validation and audit-log entries.
- Renaming a category updates all items assigned to it.
- Prevents deletion while a category is still assigned to one or more items.
- Adds category filtering to the Items screen and replaces free-text category entry with a managed dropdown.
- Item saves and CSV imports automatically register previously unseen category names.

## Compatibility and safety
- Existing item records, stock balances, stock movements, sales, refunds and accounting journals are not rewritten by the migration.
- The migration is repeatable (`INSERT OR IGNORE`) and scoped by business.
- Existing category text is preserved and backfilled into the master list.

## Not included yet
- Multiple warehouses / store locations and stock transfers.
- Batch, lot and expiry-date tracking.
- Purchase order and goods-received-note workflow improvements.
- Cashier accounts, till permissions and LAN server/client operation.
- EFD/VFD/TRA fiscal-device integration.

## Verification
- Existing unit tests should be run with the project's supported Node/TypeScript toolchain.
- A full `npm run build` and Tauri packaging test is still required on the Intel Mac before installation.
