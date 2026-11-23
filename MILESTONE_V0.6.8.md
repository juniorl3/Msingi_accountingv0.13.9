# Msingi Accounting v0.6.8 — Receipt Printing

## Added (Quick Sale)
- **Receipt after every sale:** shop name, address, phone, TIN, receipt number, date/time, items (qty x price), VAT breakdown (VAT-registered businesses only), total, payment method, cash received and change, footer message. Credit sales show the invoice number.
- **Print receipt:** uses the macOS print dialog. Choose the receipt printer and its paper size there. 58 mm (32 characters) and 80 mm (48 characters) layouts; the setting is per computer.
- **Copy text:** puts the receipt on the clipboard for WhatsApp, SMS or email.
- **Save file:** saves a standalone .html receipt that opens in your browser and offers to print. Use this if the in-app print dialog does not appear on your Mac.
- **Cash received:** type the cash handed over to see the change to give; blocked if it is less than the total.
- **Auto-print** option, and **Recent receipts** (last 20, stored on this computer) for reprints.
- **Receipt & printer settings** (collapsible, below the payment panel): address, phone, TIN, footer, paper width, auto-print.
- No database changes. Receipt header details use the existing settings table.

## Barcode scanners
Keyboard-style (USB or Bluetooth) scanners already work: scan into the Quick Sale box; an exact barcode or code match adds the item. Barcodes are set per item in Items (or imported by CSV).

## Not included
Cash drawer opening, direct ESC/POS printer commands, TRA EFD/VFD fiscal receipts, barcode label printing, refunds, held sales, cashier logins.

## Known risk
Printing uses the web view's print dialog. It is expected to work in the Mac app, but it was not testable here. If clicking Print does nothing, tell us and use Save file meanwhile; the fix is a small native print command.

## Tests
`node --experimental-strip-types tests/receipt.test.ts` (line widths for 32 and 48 columns, VAT/credit/cash variants, HTML escaping, change calculation). Earlier tests still pass. Screens are type-checked against stubs only; the first real build is the compile check.

## Acceptance tests
1. Build and launch. In Quick Sale open Receipt & printer settings; enter address, phone, TIN, footer; Save.
2. Scan or add two items, pay Cash, type cash received above the total; Complete sale. Receipt preview shows items, total, cash and change. Try cash below the total: blocked.
3. Click Print receipt: print dialog appears with only the receipt (no app screen). Print to PDF for a check, then to the thermal printer at 80 mm and 58 mm.
4. Copy text and paste into Notes/WhatsApp. Save file, open the .html, confirm it prints.
5. Credit sale to a customer: receipt shows the invoice number, no change line.
6. VAT-registered business: receipt shows Subtotal, VAT, Total; non-registered: no VAT lines.
7. Turn on auto-print; complete a sale; the dialog opens automatically. Reprint an older receipt from Recent receipts.
8. Scan a barcode with your scanner (it should type the code and add the item).
