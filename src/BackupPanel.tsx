import { useEffect, useState } from "react";
import { Download, FolderOpen, RotateCcw, X } from "lucide-react";
import { BACKUP_REMINDER_DAYS, BackupFile, backupNow, daysSince, getLastBackup, listBackups, openBackupFolder, quitApp, stageRestore } from "./backupApi";

const fmtSize = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
const fmtDate = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default function BackupPanel({ onNotice, onBackedUp }: { onNotice: (m: string) => void; onBackedUp: (d: Date) => void }) {
  const [last, setLast] = useState<Date | null>(null), [files, setFiles] = useState<BackupFile[]>([]), [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<BackupFile | null>(null), [typed, setTyped] = useState(""), [staged, setStaged] = useState<string | null>(null);
  async function load() {
    try { setLast(await getLastBackup()); setFiles(await listBackups()); } catch (e) { onNotice(String(e)); }
  }
  useEffect(() => { load(); }, []);
  async function runBackup() {
    setBusy(true);
    try { const r = await backupNow(); onBackedUp(new Date()); onNotice(`Backup saved: ${r.name} (in Documents → Msingi Backups).`); await load(); }
    catch (e) { onNotice("Backup failed: " + (e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  }
  async function runRestore() {
    if (!target || typed.trim().toUpperCase() !== "RESTORE") return;
    setBusy(true);
    try { const r = await stageRestore(target.name); setStaged(r.safetyBackup); setTarget(null); setTyped(""); await load(); }
    catch (e) { onNotice("Restore could not be prepared: " + (e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  }
  const age = daysSince(last);
  return <section className="panel settings-panel backup-panel">
    <h3>Backup &amp; restore</h3>
    <p>Backups are full copies of your accounting database, saved in <b>Documents → Msingi Backups</b>. Copy them to a USB drive or cloud folder regularly. They are not password-protected, so keep them somewhere safe (FileVault-encrypted disk recommended).</p>
    <div className={"backup-status "+(age===null||age>=BACKUP_REMINDER_DAYS?"due":"ok")}>{last?`Last backup: ${fmtDate(last)} (${age===0?"today":age+" day(s) ago"})`:"No backup has been made yet."}</div>
    <div className="table-actions wrap"><button className="primary" disabled={busy} onClick={runBackup}><Download size={16}/> {busy?"Working…":"Back up now"}</button><button className="secondary" onClick={()=>openBackupFolder().catch(e=>onNotice(String(e)))}><FolderOpen size={16}/> Open backup folder</button></div>
    <div className="table-wrap" style={{marginTop:16}}><table><thead><tr><th>BACKUP FILE</th><th>SAVED</th><th className="right">SIZE</th><th></th></tr></thead><tbody>
      {files.map(f=><tr key={f.name}><td className="description">{f.name}</td><td>{fmtDate(f.modified)}</td><td className="right">{fmtSize(f.sizeBytes)}</td><td className="right"><button className="text-button" onClick={()=>{setTarget(f);setTyped("");}}><RotateCcw size={13}/> Restore</button></td></tr>)}
      {!files.length&&<tr><td colSpan={4} className="empty">No backup files found yet. To restore on another computer, copy a backup file into the Documents → Msingi Backups folder first.</td></tr>}
    </tbody></table></div>
    {target&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setTarget(null)}}><div className="modal">
      <div className="modal-head"><div><span className="eyebrow">CONTROLLED ACTION</span><h2>Restore this backup?</h2></div><button type="button" className="icon-button" onClick={()=>setTarget(null)}><X/></button></div>
      <div className="note"><b>{target.name}</b><span>Saved {fmtDate(target.modified)}. All current data will be replaced by this backup the next time Msingi starts. Anything entered after that backup was made will not be in the restored data.</span></div>
      <div className="note"><b>Safety</b><span>A new backup of your current data is saved first, and a second safety copy is kept inside the app's data folder, so this can be undone.</span></div>
      <label>Type RESTORE to confirm<input value={typed} onChange={e=>setTyped(e.target.value)} placeholder="RESTORE" autoFocus/></label>
      <button className="danger-button submit" disabled={busy||typed.trim().toUpperCase()!=="RESTORE"} onClick={runRestore}>{busy?"Preparing…":"Prepare restore"}</button>
    </div></div>}
    {staged&&<div className="modal-backdrop"><div className="modal">
      <div className="modal-head"><div><span className="eyebrow">RESTORE READY</span><h2>Quit and reopen Msingi</h2></div></div>
      <div className="note"><b>One more step</b><span>The backup is ready. Quit Msingi now and open it again from Applications; your restored data will load on start. A backup of the data you had before was saved as {staged}.</span></div>
      <button className="primary submit" onClick={()=>quitApp()}>Quit Msingi now</button>
    </div></div>}
  </section>;
}
