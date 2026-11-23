# Msingi Accounting v0.2.3 — Journal Reversal & Transaction Correction

## Included
- Reverse any posted journal, including journals created from legacy income/expense transactions.
- Generate a new linked reversal journal by swapping every original debit and credit line.
- Require a reversal date and reason.
- Mark the original journal `reversed`; preserve both original and reversal records.
- Prevent reversing a journal unless it is still posted, preventing duplicate reversals.
- Record reversal activity in the audit log.
- Exclude reversed legacy transactions from the active transaction list and dashboard totals.

## Accounting controls
- Posted entries are never edited or deleted by this feature.
- A correction is made by reversing the incorrect entry and then posting a separate correct journal.
- The reversal is a new posted journal and remains visible in the journal register.
- Existing records are not automatically reversed or changed.

## Important limitations
- This is a development milestone and must be built and tested locally before relying on it.
- The legacy transaction table retains the original source row for traceability; active transaction queries exclude it after its linked journal is reversed.
- Review reports and migrated records after testing. This is not yet a certified statutory accounting release.
