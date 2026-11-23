# v0.13.7 — Printer Manager Fix

## What changed
1. **One printer-settings source.** The settings shape, defaults and cleaning moved to `src/printerPrefs.ts`. The paper width is no longer read once and left stale: saving printer settings now tells the whole app, so every screen uses the new width at once. The two copies of the print-dialog code are now one helper.
2. **Printer connection monitoring.** New Rust command `check_printer`: a network printer is tested by connecting (nothing is sent); a USB queue is checked with `lpstat -p` (off, paused, not installed or not accepting jobs are reported in plain words); on Windows the spooler is asked to open the printer. The settings screen shows a status light with a **Check printer** button and re-checks every 30 seconds while it is open. Every real print job also updates the status.
3. **USB queue errors.** `lp` and `lpstat` now have a time limit (15 s and 5 s), so a stuck print system cannot freeze a sale. The printer's own error text is kept even if it closes the pipe early. The queue is checked before the job is sent. On Windows, a failure to end the print job is now reported.
4. **Tests.** Rust: 10 tests (new: queue status text, network check, stuck command is stopped). Node: new `tests/printer.test.ts` (readiness, status, re-check timing, shared status, damaged settings, drawer-before-receipt and cut byte order). The cloud build now also runs the Rust tests on Mac Intel, Mac Apple Silicon and Windows.

## Still to do on your side
### Lockfiles (need internet; not possible in the sandbox)
In the `Msingi_Accounting` folder, once:
```
npm install
cd src-tauri
cargo generate-lockfile
```
Then commit `package-lock.json` and `src-tauri/Cargo.lock`. The cloud build already uses them when present.

### Real-hardware checklist (print this)
Do on each computer type you sell to. Write PASS or FAIL.
1. Network printer: enter IP, status light turns green after a few seconds. [ ]
2. Unplug its network cable: within 30 s the light turns red with a plain message. [ ]
3. Replug: press **Check printer**; green again. [ ]
4. USB printer: choose the queue; light green. Switch the printer off or pause the queue: light red. [ ]
5. **Print test page**: text fits the width, bold line is bold, paper cuts. [ ]
6. **Test cash drawer**: opens. If not, switch to Pin 5 and retest. [ ]
7. Tick automatic printing. Make a cash sale: receipt prints and the drawer opens once, before the receipt. [ ]
8. Make a card/other sale with the rule on "cash": receipt prints, drawer stays shut. [ ]
9. Switch the printer off, make a sale: the sale still saves and a clear "Receipt not printed" notice appears. [ ]
10. Change paper width to 58 mm: next receipt uses 32 characters without restarting. [ ]
11. Repeat 1–10 on Windows (queue name with spaces) and on Apple Silicon. [ ]

## Not verified here
The Windows spooler code, the Tauri build on Mac Intel / Apple Silicon / Windows, the new screen in a real window, and any physical printer or drawer. The cloud build will compile and test the Rust code on all three; the checklist above covers the hardware.
