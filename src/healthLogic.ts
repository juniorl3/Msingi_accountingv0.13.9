// Pure rules for the safety routines that run at start-up and while the till is idle.

/** Automatic backup is due when there is none yet, or the last one is at least `days` old. */
export function autoBackupDue(last: Date | null, now: Date, days = 1): boolean {
  if (!last || isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= days * 86400000;
}

/** True when the app has been updated since the data was last opened (and there is data from an older version). */
export function upgraded(stored: string | null, current: string): boolean {
  return !!stored && stored !== current;
}

export const AUTO_LOCK_CHOICES = [0, 1, 2, 5, 10, 15, 30, 60] as const;
export const DEFAULT_AUTO_LOCK = 10;

/** Minutes of no activity before the screen locks; 0 means never. Anything unexpected falls back to the default. */
export function cleanAutoLock(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return (AUTO_LOCK_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_AUTO_LOCK;
}

export const idleExpired = (lastActivityMs: number, nowMs: number, minutes: number) => minutes > 0 && nowMs - lastActivityMs >= minutes * 60000;

/** The "quick_check" pragma answers a single row "ok" when the file is sound. */
export function integrityProblem(rows: Array<Record<string, unknown>>): string | null {
  const answers = rows.map(r => String(Object.values(r)[0] ?? "")).filter(Boolean);
  return answers.length === 1 && answers[0] === "ok" ? null : (answers.slice(0, 3).join("; ") || "no answer");
}
