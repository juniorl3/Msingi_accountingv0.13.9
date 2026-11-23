# Msingi Accounting v0.6.4

Intel macOS offline-first accounting desktop application.

See `MILESTONE_V0.6.4.md` and the builder-level `READ_ME_FIRST.txt` for release scope and installation instructions.

# Msingi Accounting — Phase 1 macOS source

Offline-first desktop accounting foundation for universal small businesses. Base currency: TZS.
Built with Tauri 2 + React + TypeScript + SQLite. The same frontend and data model are intended to support a Windows build in Phase 2.

## Current prototype features
- Native desktop shell configuration for macOS (`.dmg`) and Windows-compatible Tauri project structure.
- Local SQLite database; no account or cloud connection required.
- Dashboard with income, expenses and net position.
- Add income/expense transactions with date, category, description, amount and payment method.
- Search transaction list and export CSV.
- Basic transaction report and local business-name preference field.

## Requirements
- macOS 12+ recommended for development
- Node.js 20 LTS or newer
- Rust toolchain (stable) and Xcode Command Line Tools
- Internet is needed once to download development dependencies; normal app use is offline.

## Run in development
```bash
npm install
npm run tauri dev
```

## Build macOS installer
```bash
npm install
npm run tauri build
```
The `.dmg` is generated under `src-tauri/target/release/bundle/dmg/`.

## Windows Phase 2
On a Windows development machine with Node.js and Rust installed:
```powershell
npm install
npm run tauri build
```
Add `msi` and `nsis` to `bundle.targets` in `src-tauri/tauri.conf.json` for Windows installer targets. The accounting UI and SQLite data model are shared; platform-specific installers are built on their respective operating systems.

## Important scope note
This is an initial working foundation, not yet a complete statutory accounting package. It currently records simple income and expense transactions. Before production use, the next milestone must add a proper double-entry general ledger, chart of accounts, journal posting and reversal, customer/supplier subledgers, inventory valuation, tax configuration, financial statements, role permissions, encrypted backup/restore, and tested migration procedures. Do not use this prototype as the sole legal/tax accounting record until those controls are implemented and independently tested.

## Data and privacy
SQLite is stored in the app's Tauri application-data directory. Export CSV regularly during testing. Do not delete application data until a verified backup has been made.


See `MILESTONE_V0.2.1.md` for the integrated General Ledger interface and its current limitations.


## v0.6.6 Employee & Payroll Control Fixes
See `MILESTONE_V0.6.6.md`.

## v0.6.5 Employee Register & Payroll Controls
See `MILESTONE_V0.6.5.md` for the new employee register, monthly payroll selection controls, known boundaries and acceptance tests.
# Msingi_accountingv0.13.9
