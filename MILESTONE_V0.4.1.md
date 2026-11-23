# v0.4.1 — Build fix
v0.4.0 failed to build on macOS because `src/Backup.tsx` and `src/backup.ts` differ only by case, and macOS file systems treat them as one file. They are now `BackupPanel.tsx` and `backupApi.ts`. No feature or data changes. Everything in MILESTONE_V0.3.0.md and MILESTONE_V0.4.0.md still applies (install the v0.4.1 DMG).
