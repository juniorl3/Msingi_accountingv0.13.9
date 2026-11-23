# v0.12.0 — barcode scanner, fiscal receipt numbers, lock-screen fix

## Lock screen fix
The unlock form was inside the part of the screen that is switched off while locked, so the username and password fields looked faded and could not be used. The unlock form now sits outside it and works normally.

## Barcode scanner
- Works with any USB or Bluetooth scanner that behaves like a keyboard (almost all do). Nothing to install.
- On the Quick sale screen a scan adds the item even when the search box does not have the cursor, for example after tapping a button or on a touchscreen. Scanning the same item again adds one more.
- A scan is recognised as a fast burst of characters ending in Enter or Tab. Normal typing is not mistaken for a scan. Scans are ignored while a pop-up window is open or when the cursor is in another entry box, so they cannot change a price or quantity by accident.
- Quantity prefix: `3*6001234567890` adds 3.
- Matches the item barcode first, then the item code. Switched-off items are not sold. A leading zero is ignored on long numeric barcodes (UPC-A against EAN-13).
- Short high beep when added, low beep when the barcode is unknown.
- Items page: click the Barcode box, scan. Enter from the scanner no longer submits the form early.

## Fiscal receipt numbers
- After a sale, when "Recording" is on in the Fiscal queue page, a box appears under the receipt. Issue the fiscal receipt on your approved EFD/VFD, then scan or type its number (and verification code if any). It is saved with the sale and printed on the customer receipt, including reprints.
- Numbers can still be entered later from the Fiscal queue page.

### What this is not
Msingi does **not** connect to TRA, does **not** create fiscal receipts or verification codes, and does **not** check the number you enter. Your approved device remains the only source of fiscal receipts. A real connection needs TRA's official specification, your registration details and certification, none of which were available.

## Verified here
All unit tests (new: scanner logic, fiscal receipt lines), type-check against stubs, and the end-to-end database test.

## Not verified
Real scanner hardware, real printer, the built app window, the full `npm run build`. The beep depends on the system allowing sound.
