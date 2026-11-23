# v0.13.1 — form layout fix (Mac and Windows)

## Problem
Field titles ran into the boxes beside and below them (for example "Paid by", "Cash received", "Date" on the Quick sale screen), boxes had no clear outline, drop-downs showed the system's own arrows (different on Mac and Windows), and the headings showed in a serif font because the heading font was never included.

## Fix
- One shared form style for every screen: the title sits above its field with a fixed gap, every box is the same height with a clear border and a green highlight when selected, drop-downs use one arrow on both systems, placeholder text is lighter.
- Heading and total fonts now use the system font (San Francisco on Mac, Segoe UI on Windows) instead of falling back to a serif face.
- Sign-in, first-run set-up and the lock screen are now a centred card with even spacing. The password box and its Show / keypad buttons line up.
- Quick sale payment fields are spaced evenly.

## Checked
Rebuilt the sign-in card, the payment panel, the refund row and an item form in a browser with the app's own stylesheet and looked at the result. Type-check and all unit tests still pass.

## Not checked
The real app window on Windows and Mac. Screens not reproduced in the preview (reports, payroll, VAT, stock, employees) use the same shared rules, but have not been looked at one by one. Send a screenshot of any screen that still looks wrong.
