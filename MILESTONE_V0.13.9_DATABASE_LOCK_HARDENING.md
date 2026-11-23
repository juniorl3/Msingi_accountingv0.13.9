# Msingi Accounting v0.13.9 — SQLite database-lock hardening

## Changes

- Configure SQLite `busy_timeout` to 8 seconds so brief file locks do not fail immediately.
- Enable WAL journal mode to reduce reader/writer contention for the local app database.
- Set `synchronous=NORMAL` for WAL operation and explicitly enable foreign-key enforcement.
- Keep the existing shared database queue so reads and writes from the application are serialized.
- Keep transaction callbacks on the supplied transaction connection and retain rollback-on-error behaviour.
- Improve the user-facing lock message so it does not assume another Msingi window is always the cause.
- Bump package, Tauri, Cargo and UI version metadata to 0.13.9.

## Data compatibility

No schema migration is introduced by this change. Existing `msingi.db` files remain in place. SQLite may create `msingi.db-wal` and `msingi.db-shm` sidecar files while WAL mode is active; these are normal SQLite runtime files and must not be manually deleted while Msingi is running. The existing backup flow uses `VACUUM INTO` to create a consistent standalone backup.

## Important build and verification note

This source update is not a compiled or Windows-tested installer. The environment used to prepare this archive does not include Cargo/Rust or the project dependency installation, so a full Tauri build and Windows runtime stress test could not be performed here.

The upstream Tauri SQL plugin uses a SQLx connection pool. Its public JavaScript API does not expose a SQLite `max_connections(1)` setting or a transaction-pinning API. Therefore, this release hardens transient lock handling and app-level serialization, but does not claim to prove that every pooled-connection transaction edge case is eliminated. A definitive fix for that specific upstream limitation requires a small Rust-side fork/patch of `tauri-plugin-sql` (SQLite pool configured with one connection) or moving transaction execution into a Rust command using a pinned SQLx transaction.

## Required release checks

1. Build the Windows installer with the project's GitHub Actions workflow.
2. Install on a clean Windows 10/11 test PC and verify the database path is under the local AppData folder.
3. Create an owner and additional users; edit permissions; restart and confirm persistence.
4. Post income, expense, sales, purchases and payroll transactions; confirm journal entries and balances.
5. Run concurrent dashboard/report reads while posting transactions.
6. Force a failed operation inside a transaction and confirm no partial records remain.
7. Create a backup using `VACUUM INTO`, restore it, and verify all records.
8. Confirm there are no repeated `SQLITE_BUSY` errors and no orphaned journal lines.

## Operational caution

Do not delete `msingi.db`, `msingi.db-wal`, or `msingi.db-shm` to clear a lock. Close Msingi normally and use the built-in backup/restore workflow if database recovery is required.
