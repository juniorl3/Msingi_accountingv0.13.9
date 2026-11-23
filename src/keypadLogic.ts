// Pure rules for the touchscreen numeric keypad.
export type KeypadKind = "qty" | "price" | "tendered" | "money" | "pin" | "percent";
export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "clear";

/** Decimal places allowed. Quantities have up to 3 (as toMilli() requires), percentages up to 2; money and PINs are whole numbers. */
export const decimalsOf = (kind: KeypadKind) => (kind === "qty" ? 3 : kind === "percent" ? 2 : 0);
export const allowsDecimal = (kind: KeypadKind) => decimalsOf(kind) > 0;
const maxDigits = (kind: KeypadKind) => (kind === "pin" ? 6 : 12);

/**
 * Returns the new keypad value after one key press.
 * `fresh` is true until the first key is pressed: the first digit then replaces the value that was
 * already in the field (so tapping 5 on a quantity of 1 gives 5, not 15), as on a till.
 */
export function pressKey(value: string, key: KeypadKey, kind: KeypadKind, fresh = false): string {
  if (key === "clear") return "";
  if (key === "back") return value.slice(0, -1);
  const base = fresh ? "" : value;
  if (key === ".") {
    if (!allowsDecimal(kind) || base.includes(".")) return value;
    return base === "" ? "0." : base + ".";
  }
  const dot = base.indexOf(".");
  if (dot >= 0 && base.length - dot - 1 >= decimalsOf(kind)) return value;
  if (base.replace(".", "").length >= maxDigits(kind)) return value;
  const next = base === "0" && kind !== "pin" ? key : base + key; // no leading zeros (but a PIN may start with 0)
  if (kind === "percent" && Number(next) > 100) return value;
  return next;
}

/** Whether Apply/OK is allowed. Cash received and money amounts may be empty or zero; a PIN needs 4 to 6 digits. */
export function canApply(value: string, kind: KeypadKind): boolean {
  if (kind === "pin") return /^\d{4,6}$/.test(value);
  if (kind === "tendered" || kind === "money") return true;
  return Number(value) > 0;
}
