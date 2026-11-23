import { invoke } from "@tauri-apps/api/core";
import { db } from "./db";
import { backupNow, getLastBackup } from "./backupApi";
import { APP_VERSION } from "./version";
import { autoBackupDue, integrityProblem, upgraded, cleanAutoLock, DEFAULT_AUTO_LOCK } from "./healthLogic";

export const AUTO_BACKUPS_KEPT = 14;
const LOCK_KEY = "msingi.autoLockMinutes";

export function loadAutoLock(): number {
  try { const v = localStorage.getItem(LOCK_KEY); return v === null ? DEFAULT_AUTO_LOCK : cleanAutoLock(v); } catch { return DEFAULT_AUTO_LOCK; }
}
export function saveAutoLock(minutes: number) {
  try { localStorage.setItem(LOCK_KEY, String(cleanAutoLock(minutes))); } catch { /* not saved; the default applies */ }
}

/**
 * Runs once after the database is ready. Never throws: it returns plain-language warnings to show the owner.
 * 1. checks the database file is sound, 2. keeps a copy made before a new version touches the data,
 * 3. makes a daily automatic backup and trims old automatic ones.
 */
export async function startupChecks(): Promise<string[]> {
  const warnings: string[] = [];
  const d = await db();
  try {
    const problem = integrityProblem(await d.select<Array<Record<string, unknown>>>("PRAGMA quick_check"));
    if (problem) warnings.push(`The database reported a problem (${problem}). Make a backup now and contact support before entering more sales.`);
  } catch (e) { warnings.push(`Could not check the database: ${e}`); }
  try {
    const rows = await d.select<Array<{ value: string }>>("SELECT value FROM settings WHERE key='app_version'");
    const stored = rows[0]?.value ?? null;
    if (upgraded(stored, APP_VERSION)) await backupNow("before-upgrade");
    if (stored !== APP_VERSION) await d.execute("INSERT INTO settings(key,value) VALUES('app_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [APP_VERSION]);
  } catch (e) { warnings.push(`Could not make the safety copy before the update: ${e}`); }
  try {
    if (autoBackupDue(await getLastBackup(), new Date())) await backupNow("auto");
    await invoke("prune_auto_backups", { keep: AUTO_BACKUPS_KEPT });
  } catch (e) { warnings.push(`The automatic backup failed: ${e}. Use Settings → Backup to save one by hand.`); }
  return warnings;
}
