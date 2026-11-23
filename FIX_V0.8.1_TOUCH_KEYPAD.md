# Fix pass on v0.8.1 — touchscreen checkout

## Fixed
- Keypad layout: the "." key sat alone on a fifth row. The pad is now 1-9, ".", 0, backspace; Clear moved to the action row beside Cancel and Apply.
- Price and Cash received no longer accept a decimal point (the sale engine only accepts whole TZS, so "1500.5" produced an error). The "." key is shown only for Quantity.
- Quantity is limited to 3 decimal places, matching the sale engine, and numbers are capped at 12 digits.
- The first digit typed replaces the existing value (tap 5 on a quantity of 1 gives 5, not 15). Leading zeros are removed.
- Apply is disabled for a quantity or price of zero/blank.
- Touch mode no longer refocuses the search box after Complete sale, Hold sale or Resume. That would have opened the on-screen keyboard after every sale.
- The Cash received placeholder says "Tap to enter" in touch mode.
- Sidebar footer showed v0.8.0; now v0.8.1.
- READ_ME_FIRST.txt described v0.7.1; updated.

## Code
- New `src/keypadLogic.ts` (pure rules) with `tests/keypad.test.ts`.
- `src/QuickSale.tsx` and `src/styles.css` updated.

## Verification
- All 7 test files pass (existing 6 + keypad).
- `npm run build` (tsc + vite) was NOT run here: npm installs are unavailable in this environment. Run the Intel Mac builder, which runs the build, before installing.
