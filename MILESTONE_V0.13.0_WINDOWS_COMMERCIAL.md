# v0.13.0 — Windows support and commercial licensing

## Added
- **Windows support in the code:** receipt printing to a Windows printer through the print spooler (raw ESC/POS, same cut and drawer commands), Windows-safe backup/restore paths, NSIS and MSI installers with the WebView2 runtime bundled (works without internet at install).
- **Offline licence keys:** 30-day trial, per-computer keys with optional expiry, 14-day grace, blocked screen with "save a backup", clock-wind-back protection, Settings → Licence card, banner while on trial or near expiry. Keys use ECDSA P-256 signatures. Seller's tool: `tools/licence.mjs`.
- **Cloud builds** for Mac Intel, Mac Apple Silicon and Windows (`.github/workflows/build.yml`) plus a Windows builder script.
- **COMMERCIAL_GUIDE.md** (licensing, selling, signing, legal checklist).

## Verified here
Unit tests (licence logic: valid, wrong computer, edited, wrong signer, malformed, status and grace, clock wind-back), the licence database flow end to end with a real key from the issuing tool, type-check, workflow YAML syntax, the Rust printer tests on Linux, and a type-check of the Windows-only printing module.

## Not verified
Running on Windows at all (app, installer, USB printing), Apple Silicon, the GitHub workflow itself, real signing, and the full build. See COMMERCIAL_GUIDE.md section 6.

## Not included
Owner "Hardware and fiscal" settings page (scanner options, printer language and character set profiles), TRA connection, LAN multi-cashier, automatic updates.
