# Msingi Accounting v0.2.4 — Reversal Accuracy & Release Hygiene

## Critical fix
In v0.2.3 the trial balance and General Ledger counted only `posted` journals. A reversed original (`reversed`) was dropped while its reversal (`posted`) stayed in, so reversing a TZS 100,000 sale left Cash at −100,000 and Sales at +100,000 instead of 0. v0.2.4 counts both `posted` and `reversed` journals (drafts remain excluded), so an original and its reversal net to zero.

**If you reversed any journals in v0.2.3 testing:** no stored data is damaged. Only the reports were wrong, and they correct themselves after this update.

## Added
- Journal detail shows the link: "Reversed by JE-…" / "Reversal of JE-…".
- Reversed status has its own badge in the journal register.
- Reversal entries cannot themselves be reversed; the UI explains to post a new correct journal.
- Reversal date cannot be earlier than the original entry date (enforced in the ledger layer); a confirmation appears if it falls in a different month.
- Dates now use the local calendar day (previously UTC, which gave the wrong day between 00:00 and 03:00 East Africa Time).
- Trial balance CSV export now quotes every field.
- Versions aligned to 0.2.4 across package.json, tauri.conf.json, Cargo.toml, build script/DMG name and sidebar.

## Test after building (on a backup)
1. Post a cash sale of 100,000, reverse it, then open the Trial balance and General ledger for Cash and Sales: both must show 0.
2. Try reversing the same journal again and reversing the reversal: both must be refused.
3. Try a reversal date before the original: refused. Try a different month: confirmation appears.
4. Force a failed reversal (e.g. temporarily rename an account code used by the journal) and confirm no partial journal remains. This checks transaction handling through the SQL plugin's connection pool.
5. Export the trial balance and open the CSV.

## Limitations
Development milestone, not a certified statutory release. Multi-line journals, Income Statement, Balance Sheet and backup/restore are planned for v0.3.
