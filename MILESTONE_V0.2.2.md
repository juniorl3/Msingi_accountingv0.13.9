# Msingi Accounting v0.2.2 — Journal Inspection & Controls

## Added
- Search journal register by journal number, description, or status.
- Filter journal register by status and date range.
- Click a journal reference to open a read-only detail view showing every account line, debit, credit, memo, and totals.
- Added a guard to the two-line journal form preventing the same account from being selected on both debit and credit sides.
- Existing posted journal records are not modified, deleted, or automatically reversed.

## Important
- This release is a development build, not a certified or statutory accounting product.
- Existing journal entries remain unchanged. Inspect JE-000005 using the new details view before deciding whether a correcting or reversal entry is required.
- The two-line journal form still does not support split journals.
- Test on a verified copy of the SQLite database before operational use.
