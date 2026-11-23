// Pure rules for barcode scanners. A USB or Bluetooth scanner works like a keyboard: it types the code very fast and presses Enter (some press Tab).

export type ScanCode = { code: string; qtyMilli: number };

/** Cleans what a scanner sent. "3*6001234567890" means quantity 3. Returns null when there is nothing usable. */
export function parseScan(raw: string): ScanCode | null {
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!s || s.length > 64) return null;
  const m = /^(\d{1,4}(?:\.\d{1,3})?)\*(.+)$/.exec(s);
  if (!m) return { code: s, qtyMilli: 1000 };
  const qty = Math.round(Number(m[1]) * 1000), code = m[2].trim();
  return qty > 0 && code ? { code, qtyMilli: qty } : null;
}

type Scannable = { barcode: string; code: string; is_active?: number };
const stripZeros = (s: string) => (/^\d{8,}$/.test(s) ? s.replace(/^0+/, "") : s);

/** Finds the item for a scanned code: barcode first, then item code. A leading zero is ignored on long numeric barcodes (UPC-A scanners often send EAN-13). */
export function findScanned<T extends Scannable>(items: T[], code: string): T | null {
  const c = code.trim().toLowerCase();
  if (!c) return null;
  const live = items.filter(i => i.is_active === undefined || i.is_active === 1);
  const z = stripZeros(c);
  return live.find(i => i.barcode && i.barcode.toLowerCase() === c)
    ?? live.find(i => i.code.toLowerCase() === c)
    ?? live.find(i => i.barcode && stripZeros(i.barcode.toLowerCase()) === z && /^\d{8,}$/.test(c))
    ?? null;
}

/** Keys arriving closer together than this are a scanner, not a person typing. */
export const MAX_GAP_MS = 80;
export const MIN_SCAN_LENGTH = 4;
export type ScanBuf = { text: string; last: number };
export const EMPTY_BUF: ScanBuf = { text: "", last: 0 };

/** Feeds one key press. Returns the new buffer and, when Enter/Tab ends a fast burst of characters, the scanned text. */
export function feedKey(buf: ScanBuf, key: string, t: number): { buf: ScanBuf; scan?: string } {
  if (key.length === 1) return { buf: { text: buf.text && t - buf.last <= MAX_GAP_MS ? buf.text + key : key, last: t } };
  if (key === "Enter" || key === "Tab") {
    const fast = buf.text.length >= MIN_SCAN_LENGTH && t - buf.last <= MAX_GAP_MS * 3;
    return fast ? { buf: EMPTY_BUF, scan: buf.text } : { buf: EMPTY_BUF };
  }
  return { buf };   // Shift, Control and so on
}
