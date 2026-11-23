import { useState } from "react";
import BrandMark from "./BrandMark";
import { saveLicenceKey } from "./licenseDb";
import type { LicenceInfo } from "./licenseDb";
import { backupNow } from "./backupApi";
import { msg } from "./ui";
import { Legal } from "./About";

/** Enter a key and see this computer's code. Used on the locked screen and in Settings. */
export function LicenceEntry({ info, onChanged }: { info: LicenceInfo; onChanged: (i: LicenceInfo) => void }) {
  const [key, setKey] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState("");
  async function save() {
    setBusy(true); setErr(""); setDone("");
    try { const i = await saveLicenceKey(key); setKey(""); setDone(`Thank you. ${i.status.text}`); onChanged(i); } catch (e) { setErr(msg(e)); }
    setBusy(false);
  }
  return <div className="form-stack">
    <label>This computer's code<input readOnly value={info.computer} onFocus={e => e.currentTarget.select()} style={{ fontFamily: "Menlo,Consolas,monospace", letterSpacing: 1 }} /></label>
    <small style={{ color: "#6b7a8c" }}>Send this code to your supplier. They will send back a licence key for this computer.</small>
    <label>Licence key<textarea value={key} onChange={e => setKey(e.target.value)} rows={3} placeholder="MSG1...." spellCheck={false} style={{ fontFamily: "Menlo,Consolas,monospace", fontSize: 12 }} /></label>
    {err && <p className="red-text" role="alert" style={{ margin: 0 }}>{err}</p>}
    {done && <p className="green-text" style={{ margin: 0 }}>{done}</p>}
    <button className="primary" disabled={busy || !key.trim()} onClick={save}>{busy ? "Checking…" : "Activate"}</button>
  </div>;
}

/** Shown instead of the app when the trial or licence has ended. The business's data stays reachable: a backup can still be saved. */
export function LicenceBlocked({ info, business, onChanged }: { info: LicenceInfo; business: string; onChanged: (i: LicenceInfo) => void }) {
  const [saved, setSaved] = useState(""), [err, setErr] = useState("");
  return <main className="loading" style={{ gap: 10, padding: 20 }}>
    <BrandMark size={56}/><h2>{business || "Msingi Accounting"}</h2>
    <p style={{ margin: 0, maxWidth: 420, textAlign: "center" }}>{info.status.text}</p>
    <div style={{ width: "min(420px,92vw)", textAlign: "left" }}><LicenceEntry info={info} onChanged={onChanged} /></div>
    <button className="secondary" onClick={async () => { setErr(""); try { setSaved((await backupNow("licence")).name); } catch (e) { setErr(msg(e)); } }}>Save a backup of my data</button>
    <Legal />
    {saved && <small>Saved {saved} in Documents → Msingi Backups.</small>}{err && <small className="red-text">{err}</small>}
  </main>;
}

/** A card for the Settings page. */
export function LicenceCard({ info, onChanged }: { info: LicenceInfo; onChanged: (i: LicenceInfo) => void }) {
  return <section className="panel" style={{ marginTop: 17 }}>
    <div className="panel-head"><div><h3>Licence</h3><p>{info.status.text}</p></div></div>
    <LicenceEntry info={info} onChanged={onChanged} />
  </section>;
}
