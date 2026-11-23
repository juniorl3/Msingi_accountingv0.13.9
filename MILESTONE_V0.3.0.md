# Msingi Accounting v0.3.0 — Backup & Restore

Built on v0.2.7. No accounting or schema changes.

## Added
- **Back up now** (Settings → Backup & restore, and from the Dashboard reminder). Saves a complete, consistent copy of the database to **Documents → Msingi Backups** using SQLite `VACUUM INTO` (includes data not yet written to the main file).
- **Backup list** with date and size, **Open backup folder** button.
- **Restore** from any listed backup. You must type RESTORE. Steps: (1) a fresh backup of your current data is saved; (2) the chosen file is validated (must be a SQLite file containing Msingi tables); (3) it is staged; (4) after you quit and reopen Msingi it replaces the data before the database opens, and the previous database is also copied to a `safety-copies` folder inside the app's data folder. Restore can therefore be undone by restoring the "before-restore" backup.
- **Dashboard reminder** when the last backup is more than 7 days old, or none exists.
- Backups and restores are recorded in the audit trail (backups).
- To restore on another Mac, copy a backup file into Documents → Msingi Backups, then restore it from the list.

## Fixed
- The "different month" reversal warning (v0.2.4) used a browser pop-up that macOS app windows may not display. It is now an in-app dialog.

## Not included
- **Password protection of backups.** SQLite does not encrypt files without extra native libraries that could not be tested here. Keep backups on a FileVault-encrypted disk, or inside an encrypted disk image.
- Automatic scheduled backups (reminder only).

## Tested before release
- Rust backup/restore logic unit tests (6 tests): name safety, file validation, listing, staging then applying a restore, safety copy, rejection of invalid/forged requests, bad pending file discarded.
- SQLite behaviour: `VACUUM INTO` produces a valid copy including WAL data and passes `integrity_check`; the live database path query works.
- The Tauri glue (commands, startup hook) and the screens could not be run here. They are the first things to check on the Mac.

## Test after building
1. Sidebar reads v0.3.0. Settings shows Backup & restore. Dashboard shows the "not backed up yet" banner.
2. Click **Back up now**. Open the backup folder in Finder: a `msingi-backup-…db` file exists. Banner disappears after a backup.
3. Add a distinctive test transaction (e.g. "RESTORE TEST 1,234 TZS").
4. Restore the earlier backup (type RESTORE). A "before-restore" backup appears in the list. Click **Quit Msingi now**, reopen: the test transaction should be gone.
5. Restore the "before-restore" backup the same way: the test transaction should be back.
6. Check Financial reports still say Balanced and integrity checks pass after each restore.
7. Reverse a journal with a date in another month: an in-app "Different month" dialog appears.

## If something fails
- Backup button error "failed": send the exact message.
- After restore the data did not change: quit fully (Cmd+Q) and reopen, then send me the folder listing of `~/Library/Application Support/com.msingi.accounting`.
