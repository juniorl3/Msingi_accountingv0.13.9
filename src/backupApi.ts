import { invoke } from "@tauri-apps/api/core";
import { db } from "./db";

export type BackupFile = { name: string; sizeBytes: number; modified: Date };
export const BACKUP_REMINDER_DAYS = 7;

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Saves a consistent copy of the whole database (VACUUM INTO) to Documents/Msingi Backups. */
export async function backupNow(label?: string): Promise<{ path: string; name: string }> {
  const dir = await invoke<string>("prepare_backup_dir");
  const d = await db();
  const safeLabel = label ? "-" + label.replace(/[^a-z0-9-]/gi, "") : "";
  const name = `msingi-backup-${stamp()}${safeLabel}.db`;
  const path = `${dir}/${name}`;
  await d.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  await d.execute("INSERT INTO settings(key,value) VALUES('last_backup_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [new Date().toISOString()]);
  await d.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('BACKUP','database',?,?)", [name, JSON.stringify({ path })]);
  return { path, name };
}

export async function getLastBackup(): Promise<Date | null> {
  const d = await db();
  const rows = await d.select<Array<{ value: string }>>("SELECT value FROM settings WHERE key='last_backup_at'");
  if (!rows.length) return null;
  const t = new Date(rows[0].value);
  return isNaN(t.getTime()) ? null : t;
}

export function daysSince(date: Date | null): number | null {
  return date ? Math.floor((Date.now() - date.getTime()) / 86400000) : null;
}

export async function listBackups(): Promise<BackupFile[]> {
  const rows = await invoke<Array<[string, number, number]>>("list_backups");
  return rows.map(([name, sizeBytes, secs]) => ({ name, sizeBytes, modified: new Date(secs * 1000) }));
}

export async function openBackupFolder() {
  await invoke("open_backup_folder");
}

/**
 * Stages a restore. A fresh backup of the current data is made first. The restored data is
 * swapped in when the app next starts, so the app must be quit and reopened.
 */
export async function stageRestore(name: string): Promise<{ safetyBackup: string }> {
  const safety = await backupNow("before-restore");
  const d = await db();
  const rows = await d.select<Array<{ file: string }>>("SELECT file FROM pragma_database_list WHERE name='main'");
  const file = rows[0]?.file;
  if (!file) throw new Error("Could not locate the live database.");
  const dbDir = file.substring(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")));   // Mac and Windows paths
  await invoke("stage_restore", { name, dbDir });
  return { safetyBackup: safety.name };
}

export async function quitApp() {
  await invoke("quit_app");
}
