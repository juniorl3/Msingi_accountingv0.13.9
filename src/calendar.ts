// Pure calendar maths for the date picker. No Date-from-string parsing, so no time-zone surprises.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // weeks start on Monday

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; // m = 1..12
/** 0 = Monday ... 6 = Sunday for the first day of the month. */
export const firstWeekday = (y: number, m: number) => (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

export const formatYMD = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
export type YMD = { y: number; m: number; d: number };
export function parseYMD(s: string): YMD | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!r) return null;
  const y = Number(r[1]), m = Number(r[2]), d = Number(r[3]);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? { y, m, d } : null;
}
export function parseYM(s: string): { y: number; m: number } | null {
  const r = /^(\d{4})-(\d{2})$/.exec(s);
  if (!r) return null;
  const y = Number(r[1]), m = Number(r[2]);
  return m >= 1 && m <= 12 ? { y, m } : null;
}

/** Moves a (year, month) by `delta` months. */
export function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (((idx % 12) + 12) % 12) + 1 };
}

export type Cell = { date: string; day: number; inMonth: boolean };
/** Always 42 cells (6 weeks) so the picker never changes height while browsing. */
export function monthGrid(y: number, m: number): Cell[] {
  const lead = firstWeekday(y, m);
  const prev = shiftMonth(y, m, -1), next = shiftMonth(y, m, 1);
  const prevDays = daysInMonth(prev.y, prev.m), dim = daysInMonth(y, m);
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const n = i - lead + 1;
    if (n < 1) cells.push({ date: formatYMD(prev.y, prev.m, prevDays + n), day: prevDays + n, inMonth: false });
    else if (n > dim) cells.push({ date: formatYMD(next.y, next.m, n - dim), day: n - dim, inMonth: false });
    else cells.push({ date: formatYMD(y, m, n), day: n, inMonth: true });
  }
  return cells;
}

/** First year of the 12-year page that contains `y` (pages: 2016-2027, 2028-2039 ...). */
export const yearPageStart = (y: number) => Math.floor(y / 12) * 12;
export const yearsOnPage = (start: number) => Array.from({ length: 12 }, (_, i) => start + i);

/** Keeps the day valid when the month or year changes (31 Jan -> Feb gives 28/29 Feb). */
export const clampDay = (y: number, m: number, d: number) => Math.min(d, daysInMonth(y, m));
