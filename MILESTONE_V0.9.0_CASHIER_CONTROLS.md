# Msingi Accounting v0.9.0 — Cashier controls (prepares for multi-terminal)

## What is new
1. **Cashier accounts and PIN sign-in.** Tap your name, enter a 4–6 digit PIN. On the first launch after updating, the owner account is created. PINs are stored salted and hashed (PBKDF2-SHA-256); 5 wrong PINs in a row lock that user for 1 minute, then longer.
2. **Roles and permissions.** Owner (everything), Manager (sell, discount, refund, void, stock, reports) and Cashier (sell). The owner can tick or untick each permission per person, and set each person's largest allowed discount. Menus and pages are hidden for what a user cannot open.
3. **Manager PIN override.** A cashier who lacks a permission (refund, reverse a sale, a large discount) can ask a manager to type their PIN on the spot. The action is recorded under both people.
4. **Opening cash.** A shift must be opened, with the cash in the drawer, before a sale can be completed.
5. **Shift closing and cash reconciliation.** Count the drawer; Msingi shows expected cash (opening + cash sales − cash refunds), the difference, and requires a note when it does not balance. A closing slip can be printed.
6. **Sales summary per cashier** for any date range, with CSV export.
7. **Audit trail** of refunds, reversals, discounts, failed manager-PIN attempts and shift differences: who, who approved, which sale, amount, reason.
8. **Daily cashier report** slip per cashier.
9. **Discounts (new).** Per line and whole-sale, as % or TZS, with a required reason. VAT, ledger postings, stock reports and refunds all follow the discounted amount. Receipts show the discount and "Served by".

## Where things are
- Quick sale: shift banner, Discount button, receipts. My shift: open/close. Cashier reports: summary, shifts, audit trail (needs "Cashier reports" permission). Users (owner only).

## Important limitations
- **PINs are not strong security.** They keep honest users apart and create a trail. Someone who can copy the database file or the computer can bypass them. Keep the computer, backups and the Msingi data folder safe.
- **A forgotten owner PIN can only be reset by another owner.** Create a second owner.
- Sales made before v0.9.0 have no cashier and are not in cashier reports.
- No automatic sign-out after inactivity: use the sign-out button (your name, top right) when leaving the till. A cashier's open shift stays open when they sign out, so they can resume it.
- Stock adjustments, purchases and item edits are not yet attributed to a user (they need the Stock permission to reach).
- Cash taken out of the drawer for expenses is not tracked; explain such differences in the shift-closing note.
- Refunds of invoiced (credit) sales are still unsupported, as before.
- Still one terminal only. Multi-terminal (LAN) operation and TRA EFD/VFD are not part of this release.

## Verification
- Pure-logic tests (keypad, permissions, PIN hashing, lockout maths, discounts, shift maths, receipt): all pass.
- The real database code was run against an in-memory SQLite: users, lockout, manager override, discounted sale (with and without VAT), proportional refund, reversal, shift figures and closing, per-cashier report, audit trail, and the ledger integrity checks all passed.
- `npm run build` (tsc + vite) and the Tauri/Intel DMG build were NOT run here (npm installs are unavailable). Run the Intel Mac builder, then test on the actual POS: sign-in, shift open/close, a discount above a cashier's limit (manager PIN), a refund, and the printed slips.
