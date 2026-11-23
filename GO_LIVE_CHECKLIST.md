# Msingi Accounting — go-live checklist (v0.13.0)

Do these once, on the shop computer, **before the first real customer**. Allow about 30 minutes.

## 1. Install
1. Open the DMG and drag Msingi Accounting to Applications.
2. **Mac:** the app is not signed by Apple. The first time, **right-click the app, choose Open, then Open again**.
   **Windows:** run the `-setup.exe`. If Windows SmartScreen warns, choose **More info → Run anyway**.
3. The first 30 days are a free trial. Open Settings → Licence, send the computer code to your supplier, and paste in the licence key you receive.

## 2. Accounts
1. First launch: create the **owner** account (name, username, password or PIN, entered twice).
2. Open **Users** and create a **second owner**. Only another owner can reset an owner's forgotten password.
3. Add each cashier and manager with their own username. Cashiers sign in with a PIN (4 or more digits) or a longer password.
4. Tick only the permissions each person needs. Set discount limits for managers.
5. Set **Lock the screen after** (Users page). 5 to 10 minutes suits a counter. The Lock button in the top bar locks at once and keeps the sale on screen.

## 3. Business setup
1. Settings: business name, VAT registration, VAT rate, and whether prices include VAT. Confirm VAT treatment with your tax adviser or TRA.
2. Items: add products with price, VAT treatment and opening stock.

## 3b. Barcode scanner
1. Plug in the scanner. It types like a keyboard, so nothing needs installing.
2. Items: open an item, click the Barcode box, scan the product. Save.
3. Quick sale: scan a product. It should be added with a beep. Scan an unknown barcode to hear the low beep and see the message.
4. If the scanner does not press Enter after a scan, set it to add an Enter or Tab suffix (see its manual, usually a setup barcode).

## 4. Receipt printer and drawer
1. Settings: under the receipt printer section, choose network (printer IP, port 9100) or a USB print queue (on Windows this lists the printers installed in Windows), paper width 58 or 80 mm.
2. Press **Print test page**, then **Test cash drawer**. If the drawer does not open, change the drawer pin (2 or 5) and try again.
3. Hardware was not available when this version was written. Test your own printer and drawer.

## 5. Test sales (use real stock, then reverse)
1. Open a shift with a small opening float.
2. Sell one item for cash, one by card or mobile money. Check the receipt, the drawer, and the stock level.
3. Try a discount as a cashier. A manager should be asked to approve anything over the limit.
4. Refund the test sale. Close the shift and check the cash count and the cashier report.

## 6. Backups
- The app makes an automatic backup each day it is opened and keeps the newest 14. It also saves a copy before it installs an update.
- Backups are in **Documents → Msingi Backups** on the same computer. A stolen or broken computer loses them too.
- **Each week, copy that folder to a USB drive or cloud storage kept elsewhere.** Settings → Backup has a button to open the folder.
- Practise a restore once, on a test day, so you know how.

## 7. Tax receipts
Msingi does **not** connect to TRA and does not issue fiscal receipts. Keep using your approved EFD/VFD device. On the Fiscal queue page choose Start recording. After each sale, issue the fiscal receipt on your device, then scan or type its number under the receipt in Msingi so it is kept with the sale and printed on the customer copy.

## 8. Daily routine
Open shift with float → sell → close shift and count the cash → owner checks the cashier report and Dashboard → keep the computer on a surge protector.
