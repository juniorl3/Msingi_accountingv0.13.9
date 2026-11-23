//! Backup and restore helpers. Standard library only, so the logic can be unit-tested
//! without Tauri. The Tauri commands in lib.rs are thin wrappers around these functions.
//!
//! Backups are created from JavaScript with SQLite `VACUUM INTO` (a consistent copy).
//! Restore never overwrites the live database while it is open: a validated copy is staged
//! as `restore_pending.db`, and the swap happens at the next launch, before the database opens.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DB_FILE: &str = "msingi.db";
pub const PENDING_FILE: &str = "restore_pending.db";
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

pub fn ensure_dir(dir: &Path) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Could not create the backup folder: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Only plain `.db` file names are accepted: no folders, no parent references.
pub fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name.ends_with(".db")
        && !name.starts_with('.')
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && !name.contains('\0')
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Checks that a file is a SQLite database that looks like a Msingi backup. Returns its size.
pub fn validate_backup(path: &Path) -> Result<u64, String> {
    let bytes = fs::read(path).map_err(|e| format!("Could not read the backup file: {e}"))?;
    if bytes.len() < 100 || &bytes[..16] != SQLITE_HEADER {
        return Err("This file is not a valid SQLite database.".into());
    }
    if !contains(&bytes, b"transactions") {
        return Err("This file does not look like a Msingi Accounting backup.".into());
    }
    Ok(bytes.len() as u64)
}

/// Lists `.db` files as (name, size in bytes, modified time in unix seconds), newest first.
pub fn list_backups(dir: &Path) -> Result<Vec<(String, u64, u64)>, String> {
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Could not read the backup folder: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_safe_name(&name) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                out.push((name, meta.len(), modified));
            }
        }
    }
    out.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| b.0.cmp(&a.0)));
    Ok(out)
}

/// Validates a chosen backup and stages it next to the live database for the next launch.
pub fn stage_restore(backups_dir: &Path, name: &str, db_dir: &Path) -> Result<(), String> {
    if !is_safe_name(name) {
        return Err("Invalid backup file name.".into());
    }
    let src = backups_dir.join(name);
    if !src.is_file() {
        return Err("The selected backup file was not found.".into());
    }
    if !db_dir.join(DB_FILE).is_file() {
        return Err("Could not locate the live database folder.".into());
    }
    validate_backup(&src)?;
    let tmp = db_dir.join(format!("{PENDING_FILE}.tmp"));
    fs::copy(&src, &tmp).map_err(|e| format!("Could not stage the backup: {e}"))?;
    fs::rename(&tmp, db_dir.join(PENDING_FILE))
        .map_err(|e| format!("Could not stage the backup: {e}"))?;
    Ok(())
}

/// Called at startup before the database is opened. If a restore is pending, keeps a safety
/// copy of the current database and swaps the restored one in. Returns a message when it acted.
pub fn apply_pending_restore(db_dir: &Path) -> Result<Option<String>, String> {
    let pending = db_dir.join(PENDING_FILE);
    if !pending.is_file() {
        return Ok(None);
    }
    if let Err(e) = validate_backup(&pending) {
        let _ = fs::remove_file(&pending);
        return Err(format!("Pending restore discarded: {e}"));
    }
    let live = db_dir.join(DB_FILE);
    let mut safety = String::from("no previous database existed");
    if live.is_file() {
        let dir = db_dir.join("safety-copies");
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Could not create the safety-copy folder: {e}"))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let name = format!("pre-restore-{stamp}.db");
        fs::copy(&live, dir.join(&name))
            .map_err(|e| format!("Could not keep a safety copy, restore not applied: {e}"))?;
        for ext in ["-wal", "-shm"] {
            let side = db_dir.join(format!("{DB_FILE}{ext}"));
            if side.is_file() {
                let _ = fs::copy(&side, dir.join(format!("{name}{ext}")));
            }
        }
        safety = format!("safety-copies/{name}");
    }
    for ext in ["-wal", "-shm"] {
        let side = db_dir.join(format!("{DB_FILE}{ext}"));
        if side.is_file() {
            fs::remove_file(&side)
                .map_err(|e| format!("Could not clear old journal files: {e}"))?;
        }
    }
    fs::rename(&pending, &live).map_err(|e| format!("Could not apply the restore: {e}"))?;
    Ok(Some(format!(
        "Restore applied; previous data kept in {safety}"
    )))
}

/// Deletes the oldest automatic backups (files ending `-auto.db`), keeping the newest `keep`.
/// Manual backups and safety copies made before a restore or upgrade are never touched.
/// Returns how many files were removed.
pub fn prune_auto(dir: &Path, keep: usize) -> Result<usize, String> {
    let mut removed = 0;
    for (name, _, _) in list_backups(dir)?.into_iter().filter(|(n, _, _)| n.ends_with("-auto.db")).skip(keep) {
        if is_safe_name(&name) && fs::remove_file(dir.join(&name)).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("msingi-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn fake_db(path: &Path, marker: &str) {
        let mut b = SQLITE_HEADER.to_vec();
        b.resize(200, 0);
        b.extend_from_slice(b"CREATE TABLE transactions (id INTEGER)");
        b.extend_from_slice(marker.as_bytes());
        fs::write(path, b).unwrap();
    }

    #[test]
    fn safe_names() {
        assert!(is_safe_name("msingi-backup-20261110-014000.db"));
        for bad in [
            "",
            "../x.db",
            "a/b.db",
            "a\\b.db",
            "x.txt",
            ".hidden.db",
            "..db",
        ] {
            assert!(!is_safe_name(bad), "{bad}");
        }
    }
    #[test]
    fn validates_files() {
        let d = temp("validate");
        fake_db(&d.join("ok.db"), "x");
        assert!(validate_backup(&d.join("ok.db")).is_ok());
        fs::write(d.join("junk.db"), vec![1u8; 500]).unwrap();
        assert!(validate_backup(&d.join("junk.db")).is_err());
        let mut b = SQLITE_HEADER.to_vec();
        b.resize(300, 0);
        fs::write(d.join("other.db"), b).unwrap();
        assert!(validate_backup(&d.join("other.db"))
            .unwrap_err()
            .contains("Msingi"));
        assert!(validate_backup(&d.join("missing.db")).is_err());
    }
    #[test]
    fn lists_newest_first_and_ignores_other_files() {
        let d = temp("list");
        assert!(list_backups(&d.join("nope")).unwrap().is_empty());
        fake_db(&d.join("a.db"), "a");
        fs::write(d.join("notes.txt"), "x").unwrap();
        let l = list_backups(&d).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].0, "a.db");
    }
    #[test]
    fn stage_then_apply_replaces_database_and_keeps_safety_copy() {
        let backups = temp("bk");
        let live = temp("live");
        fake_db(&backups.join("good.db"), "RESTORED");
        fake_db(&live.join(DB_FILE), "CURRENT");
        fs::write(live.join("msingi.db-wal"), "wal").unwrap();
        stage_restore(&backups, "good.db", &live).unwrap();
        assert!(live.join(PENDING_FILE).is_file());
        // live database untouched until the next launch
        assert!(
            String::from_utf8_lossy(&fs::read(live.join(DB_FILE)).unwrap()).contains("CURRENT")
        );
        let msg = apply_pending_restore(&live).unwrap().unwrap();
        assert!(msg.contains("safety-copies/pre-restore-"));
        assert!(
            String::from_utf8_lossy(&fs::read(live.join(DB_FILE)).unwrap()).contains("RESTORED")
        );
        assert!(!live.join(PENDING_FILE).exists());
        assert!(!live.join("msingi.db-wal").exists());
        let kept: Vec<_> = fs::read_dir(live.join("safety-copies"))
            .unwrap()
            .flatten()
            .collect();
        assert!(kept.len() >= 2); // database copy + its wal copy
        assert!(apply_pending_restore(&live).unwrap().is_none()); // idempotent
    }
    #[test]
    fn refuses_bad_requests() {
        let backups = temp("bk2");
        let live = temp("live2");
        fake_db(&live.join(DB_FILE), "CURRENT");
        assert!(stage_restore(&backups, "../evil.db", &live).is_err());
        assert!(stage_restore(&backups, "missing.db", &live).is_err());
        fs::write(backups.join("junk.db"), vec![7u8; 400]).unwrap();
        assert!(stage_restore(&backups, "junk.db", &live).is_err());
        assert!(!live.join(PENDING_FILE).exists());
        let empty = temp("nolive");
        fake_db(&backups.join("good.db"), "x");
        assert!(stage_restore(&backups, "good.db", &empty).is_err());
    }
    #[test]
    fn invalid_pending_file_is_discarded_not_applied() {
        let live = temp("live3");
        fake_db(&live.join(DB_FILE), "CURRENT");
        fs::write(live.join(PENDING_FILE), vec![9u8; 400]).unwrap();
        assert!(apply_pending_restore(&live).is_err());
        assert!(!live.join(PENDING_FILE).exists());
        assert!(
            String::from_utf8_lossy(&fs::read(live.join(DB_FILE)).unwrap()).contains("CURRENT")
        );
    }

    #[test]
    fn prunes_only_old_automatic_backups() {
        let dir = temp("prune");
        fs::create_dir_all(&dir).unwrap();
        for n in ["msingi-backup-20260101-000000-auto.db", "msingi-backup-20260102-000000-auto.db", "msingi-backup-20260103-000000-auto.db", "msingi-backup-20260101-000000.db", "msingi-backup-20260101-000000-before-restore.db", "notes.txt"] {
            fs::write(dir.join(n), b"x").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }
        assert_eq!(prune_auto(&dir, 2).unwrap(), 1);
        assert!(!dir.join("msingi-backup-20260101-000000-auto.db").exists());
        assert!(dir.join("msingi-backup-20260102-000000-auto.db").exists());
        assert!(dir.join("msingi-backup-20260101-000000.db").exists());
        assert!(dir.join("msingi-backup-20260101-000000-before-restore.db").exists());
        assert!(dir.join("notes.txt").exists());
        assert_eq!(prune_auto(&dir, 2).unwrap(), 0);
        assert_eq!(prune_auto(&dir.join("missing"), 2).unwrap(), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
