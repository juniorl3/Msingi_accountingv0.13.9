# v0.13.8 — "The database is busy" fix

**Seen on a Windows PC after install:** "The database is busy. Another Msingi window or program may have it open. Nothing was saved."

## Causes this version removes
1. **Two copies of Msingi running.** Nothing stopped a second launch (double-click on the shortcut, "Run Msingi" after the installer plus a click, or a copy still running in the background). Both copies share one database file, so a write in one is refused while the other holds it. Msingi now allows only one copy: a second launch brings the first window to the front.
2. **Short locks.** A backup copy, antivirus scanning the file, or a write finishing can hold the file for a moment. Msingi now waits and retries (6 tries, growing waits, about 7 seconds in all) before reporting an error. Only locked-database answers are retried; no other error is.

## If you still see the message
1. Press Ctrl+Shift+Esc, open Task Manager, end every "Msingi Accounting" process, then start Msingi once.
2. Make sure the database folder (`%APPDATA%\com.gtn.msingi` or similar under AppData) is not inside OneDrive and not on a network drive.
3. Add the Msingi program folder and the data folder to your antivirus exclusions.
4. Restart the PC and open Msingi once.

## Not verified here
The single-instance plugin is a new Rust dependency. It was written to its documented API but not compiled in the sandbox. The cloud build (Cargo build and the Rust tests) will confirm it on Mac and Windows.
