# Msingi Accounting v0.8.1 — Touchscreen checkout

## Changes
- Connects the saved PC / Touch display setting to Quick Sale.
- Touch mode shows quick-add product tiles when the search field is empty (up to 24 items).
- Adds an on-screen numeric keypad for sale quantity, unit price, and cash received.
- Uses larger touch targets and responsive checkout columns in touch mode.
- Keeps the existing stock sale, VAT, payment, held-sale, receipt, refund, and cash-up workflows.

## Important limitations
- Product tiles show the first 24 items in the current item list; use search or barcode scanning for other items.
- Receipt printing still uses the existing system/browser print workflow. This is not direct ESC/POS printer or cash-drawer control.
- This release does not add multi-terminal LAN operation or TRA EFD/VFD integration.
- Touchscreen support depends on the computer operating system and hardware drivers; test on each target POS model.

## Verification
Run `npm install` and `npm run build` on the target Mac/PC before creating an installer. Then test product selection, barcode scan, quantity/price keypad, cash change, all payment methods, receipt printing, held sales, and stock deduction.
