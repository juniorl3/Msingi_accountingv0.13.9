# Msingi Accounting v0.8.0 — Universal PC & Touch Foundation

## Included in this source update
- User-selectable PC Mode / Touch Mode switch in the main application header.
- Selected display mode is persisted locally in browser storage on that device.
- Touch mode increases common control, navigation, input, table-row and panel target sizes.
- Smaller desktop window minimum dimensions to accommodate compact POS screens.
- Narrow-screen layout adjustments for compact displays.
- Existing accounting, inventory, sales, returns and SQLite modules retained without schema changes.

## Compatibility notes
- This is a responsive desktop UI foundation, not certification for every POS terminal.
- Touch input relies on the operating system's touch keyboard where text entry is required. A dedicated in-app numeric keypad is not included in this milestone.
- USB/Bluetooth barcode scanners that emulate a keyboard can continue to enter barcodes.
- Receipt output remains through the existing system print dialog; direct ESC/POS and cash-drawer control are not included.
- LAN multi-terminal service and EFD/VFD fiscal integration are not included.

## Verification still required on target hardware
- `npm ci` and `npm run build` on the target Intel Mac.
- Tauri Intel DMG build.
- Windows build and installer.
- Touch tests on actual 10–15 inch POS terminals, including OSK, scaling and orientation.
- Printer, scanner and cash-drawer model compatibility tests.
