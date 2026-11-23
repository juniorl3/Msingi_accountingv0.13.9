# Msingi Accounting v0.10.0 — Direct receipt printing, cash drawer, fiscal-ready queue

## New
1. **Direct ESC/POS printing.** Receipts, cash-up, shift, refund and cashier-report slips can be sent straight to a thermal receipt printer, with the paper cut, instead of going through the system print dialog.
   - **Network printer:** enter its IP address and port (usually 9100).
   - **USB printer:** choose its print queue (installed on this Mac); bytes are sent with `lp -o raw`.
   - Settings are per computer: Quick sale > Receipt & printer settings > Print method. "Print test page" checks width, bold and cutting.
   - 58 mm (32 columns) and 80 mm (48 columns). Accents are simplified (é prints as e) because receipt printers use a simple character set.
2. **Cash drawer.** Opens through the receipt printer's drawer (RJ11) port: never, after cash sales, or after every sale. "Pin 2 / Pin 5" selects the connector. "Test cash drawer" checks it.
   - **Open drawer** button on Quick sale opens it with no sale. This needs the new permission "Open the cash drawer without a sale" (managers get it by default; a cashier needs a manager's PIN) and every use is recorded in the audit trail, with who opened it and who approved it.
3. **TRA fiscal-ready queue (NOT a TRA connection).** New page "TRA fiscal queue". When recording is switched on, each new sale is saved with its VAT breakdown. You can type in the receipt number printed by your own approved EFD/VFD device so your records and fiscal receipts can be reconciled, and export the list as CSV. A plug-in point (`src/fiscalAdapter.ts`) exists for a real connection later.

## What this release does NOT do
- **It does not connect to TRA.** Nothing is sent to TRA, and Msingi does not issue EFD/VFD fiscal receipts, verification codes, QR codes or Z-reports. Msingi receipts are not tax invoices. If your business must issue fiscal receipts, keep issuing them with your TRA-approved device for every sale. A real integration needs TRA's official specification, your registration (TIN, serial, certificate) and TRA's certification; none of those were available, so the protocol was not guessed.
- **No LAN multi-cashier operation.** Still one terminal with one database. This needs a different architecture (one main terminal hosting the data) and was deferred.
- Windows: network printing works; "USB through a print queue" is Mac/Linux only.
- Managers created before this update do not automatically get the new drawer permission: tick it in Users.

## Verification
- ESC/POS encoder: tested at byte level (reset, drawer pulse, bold lines, cut, width limits on 58/80 mm, text simplification).
- Rust transport: compiled and tested here (delivery of every byte over a real TCP socket, unreachable-printer error, input validation, the `lp -o raw` path using a fake `lp`).
- Database code (fiscal queue, drawer audit entry, printer-preference sanitising, plus all v0.9.0 flows): run end to end against an in-memory SQLite.
- NOT tested: the real Tauri build (`npm run build`, `cargo`/DMG), and any physical printer or drawer. Please test on the actual hardware: print a test page, check the width and cut, open the drawer from "Test cash drawer", then make a cash sale.
- If a USB queue prints nothing or garbage, use the network mode instead: macOS can refuse raw jobs to some queues.
- Optional: `cargo test` inside `Msingi_Accounting/src-tauri` runs the Rust printer tests on your Mac.
