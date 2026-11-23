# v0.11.0 — live-use release candidate

## What changed
- **Sign-in with username and password/PIN** replaces name tiles. Usernames are not case sensitive. Failure messages are identical for a wrong password and an unknown username. Five wrong tries lock that username (1 minute, growing); unknown usernames are throttled the same way. Existing users receive a username made from their name on upgrade.
- **Screen lock**: automatic after idle time (per computer, default 10 minutes, can be turned off) and a Lock button. The sale on screen is kept; the same user continues, a different user starts fresh.
- **App icon** for the Dock, DMG, Windows and the browser tab.
- **Automatic daily backup**, newest 14 automatic backups kept (manual and before-restore copies are never deleted).
- **Safety copy before an update**, made the first time a new version opens existing data.
- **Database health check** at start-up with a plain warning if the file reports damage.
- **Error screen** instead of a blank window if a screen crashes, with a Reload button.
- Version is defined once in `src/version.ts`; a test fails if it disagrees with package.json, tauri.conf.json or Cargo.toml.

## Verified here
- All unit tests, including username rules and version consistency.
- End-to-end database run on in-memory SQLite: users, usernames, case-insensitive login, lockouts, upgrade of an old users table, overrides, discounted sales, refunds, voids, shifts, reports, audit trail, fiscal queue.
- Rust tests: printer transport (6) and backup/restore/pruning (7).
- Icon files read back and checked (ICNS and ICO structure).

## Not verified, and why it matters
- The full `npm run build` and DMG were not run in the authoring environment. Run the builder and expect to fix small compile messages if any appear.
- The new screens (sign-in, lock, settings) were type-checked only against stubs, not run in a window.
- No real receipt printer or cash drawer was available.
- The start-up backup and health check use the real Tauri backend and were not run end to end.

## Honest limits
- Passwords and PINs separate users and record who did what. They are not strong protection against someone who can copy the database file. Protect the computer and the backups.
- Not connected to TRA. No fiscal receipts are issued.
- One computer only. LAN multi-cashier operation is not included.
- The app is unsigned (right-click → Open on first launch).
- Backups live on the same computer until you copy them elsewhere.
