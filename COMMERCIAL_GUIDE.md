# Selling Msingi Accounting to clients (v0.13.0)

Msingi is set up as **one separate install per client**: each client has their own computer(s) and their own database. Nothing is shared between clients, which is also the safest arrangement for their data.

## 1. Getting installers for Mac and Windows

**Easiest: cloud builds (no Windows PC needed).**
1. Create a free **private** GitHub repository and upload the contents of the `Msingi_Accounting` folder to it (keep the `.github` folder).
2. Open the repository's **Actions** tab, choose **Build installers**, press **Run workflow**.
3. After 15 to 30 minutes, open the finished run. At the bottom are three downloads: Mac Intel (`.dmg`), Mac Apple Silicon (`.dmg`), Windows (`-setup.exe` and `.msi`).
The workflow runs all unit tests first and stops if one fails.

**By hand:** `BUILD_Msingi_Accounting.command` on an Intel Mac, `BUILD_Msingi_Accounting_Windows.bat` on a Windows PC (needs Node, Rust and Microsoft C++ Build Tools).

None of these were run in the place this was written, so expect to fix small build messages on the first try and send them back.

## 2. Licence keys (works offline)
Each install shows a **computer code** (Settings → Licence). The program works free for **30 days**; after that it asks for a licence key. A key is tied to that computer's code, shows the client's name, and can have an expiry date. After expiry there are **14 days of warnings** before it stops opening. Even when blocked, the client can still save a backup of their data.

**One-time set-up (already done for this package):** a signing key pair was made. The **public** half is inside the app. The **private** half is the file `MSINGI_LICENCE_SIGNING_KEY_PRIVATE.json`, delivered to you separately and **not** inside the project. **Keep it private and back it up in two places.** Whoever has it can make licences. If it is lost, you cannot issue keys for installs already out there.

**Issue a key** (Node 20+ on your own computer):
```
node tools/licence.mjs issue MSINGI_LICENCE_SIGNING_KEY_PRIVATE.json "Client name" ABCDE-FGHJK 2027-12-31
```
Use `never` instead of the date for no expiry, or `*` instead of the code for a key that works on any computer (easy to copy; use sparingly). Send the printed `MSG1....` text to the client to paste in. Check a key with `node tools/licence.mjs verify ...`.

**Limits:** this keeps honest clients honest. Someone able to modify the program itself could remove the check. Have a written agreement with clients for the rest. Winding the clock back does not extend a licence.

## 3. Setting up a new client (about 30 minutes)
Follow `GO_LIVE_CHECKLIST.md` with them: install, owner account (and a second owner), business details, items, printer and drawer test, scanner test, test sales, backup routine. Then issue their licence.

## 4. Warnings when installing (unsigned installers)
- **Mac:** right-click the app → Open → Open (first launch only).
- **Windows:** SmartScreen may say "Windows protected your PC". Choose **More info → Run anyway**.
This is normal for unsigned software, but clients may find it worrying. **Code signing** removes the warnings: an Apple Developer membership (paid yearly) for Mac, and a code-signing certificate from a certificate authority for Windows (paid yearly; the stronger types remove SmartScreen warnings fastest). Once you have them, add them as secrets in the GitHub repository and tell me; I will wire signing into the build.

## 5. Things to settle before charging clients
- **Terms and a support promise.** Write a licence agreement covering what is and is not guaranteed, who owns the data, backups being the client's duty, and your support hours. Have a lawyer in Tanzania review it.
- **Tax and fiscal position.** Msingi is **not** connected to TRA and does not issue fiscal receipts. Say so plainly in your sales material and contract, and tell clients to keep using their approved EFD/VFD device. Do not describe Msingi as TRA-compliant.
- **Privacy.** Clients' customer and staff records are stored on the client's own computer. Check your local data-protection obligations.
- **Updates.** There is no automatic update yet. To update a client, give them the new installer; the app makes a safety backup the first time it opens older data. Plan a way to tell clients about new versions.
- **Support tooling.** Ask clients to send the backup file and the exact words of any error.

## 6. Known limits of this release
- Windows printing to a USB printer (through the Windows spooler) and the Windows installer have **not been run** on a real Windows PC. Test on a real PC with a real printer before selling.
- Apple Silicon Mac builds are produced by the cloud workflow but have not been tested.
- One computer per install. LAN multi-cashier is not included.
- No TRA connection. No automatic updates. Passwords and PINs separate users but are not strong protection against someone who copies the database file.
