import { useState } from "react";
import BrandMark from "./BrandMark";
import { createUser, login, verifyApprover } from "./usersDb";
import type { AppUser } from "./permissions";
import type { OverrideRequest } from "./authorize";
import { SECRET_RULE, USERNAME_RULE, suggestUsername, validSecret, validUsername } from "./pinLogic";
import SecretInput from "./SecretInput";
import { Legal } from "./About";
import { Modal, msg } from "./ui";

const LAST_KEY = "msingi_last_username";
const lastUsername = () => { try { return localStorage.getItem(LAST_KEY) ?? ""; } catch { return ""; } };
const rememberUsername = (u: string) => { try { localStorage.setItem(LAST_KEY, u); } catch { /* the username is just not remembered */ } };

/** Asks for a new password or PIN twice. */
export function SecretSetter({ title, onSet, onCancel }: { title: string; onSet: (secret: string) => void; onCancel: () => void }) {
  const [a, setA] = useState(""), [b, setB] = useState("");
  const problem = a === "" ? "" : !validSecret(a) ? SECRET_RULE : b !== "" && a !== b ? "The two entries do not match." : "";
  const ok = validSecret(a) && a === b;
  return <Modal eyebrow="PASSWORD OR PIN" title={title} onClose={onCancel}>
    <p style={{ fontSize: 12, color: "#718094", margin: "0 0 8px" }}>{SECRET_RULE}</p>
    <SecretInput label="New password or PIN" value={a} onChange={setA} autoFocus keypad={false} />
    <SecretInput label="Type it again" value={b} onChange={setB} onEnter={() => ok && onSet(a)} keypad={false} />
    {problem && <p className="red-text" role="alert">{problem}</p>}
    <div style={{ display: "flex", gap: 10, marginTop: 14 }}><button className="primary" disabled={!ok} onClick={() => onSet(a)}>Save</button><button className="secondary" onClick={onCancel}>Cancel</button></div>
  </Modal>;
}

/** First launch (or the first launch after updating from a version without accounts): create the owner. */
export function FirstRun({ onDone }: { onDone: (u: AppUser) => void }) {
  const [name, setName] = useState(""), [username, setUsername] = useState(""), [touched, setTouched] = useState(false), [a, setA] = useState(""), [b, setB] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const shownUsername = touched ? username : name.trim().length >= 2 ? suggestUsername(name) : "";
  const ok = name.trim().length >= 2 && validUsername(shownUsername) && validSecret(a) && a === b;
  async function create() {
    if (!ok) return; setBusy(true); setErr("");
    try { await createUser({ name, username: shownUsername, role: "owner", secret: a }); const u = await login(shownUsername, a); rememberUsername(u.username); onDone(u); } catch (e) { setErr(msg(e)); }
    setBusy(false);
  }
  return <main className="loading" style={{ gap: 12, padding: "24px 0" }}>
    <BrandMark size={56}/><h2>Welcome to Msingi</h2>
    <p style={{ maxWidth: 440, textAlign: "center", lineHeight: 1.5, margin: 0 }}>Create the owner account. The owner adds cashiers and managers and can see everything. Choose a password or PIN you will remember: it cannot be recovered, only reset by another owner, so add a second owner later.</p>
    <form className="auth-form" onSubmit={e => { e.preventDefault(); void create(); }}>
      <label>Your name<input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Juma Hassan" /></label>
      <label>Username (used to sign in)<input value={shownUsername} onChange={e => { setTouched(true); setUsername(e.target.value); }} autoCapitalize="off" spellCheck={false} /></label>
      <SecretInput label="Password or PIN" value={a} onChange={setA} keypad={false} />
      <SecretInput label="Type it again" value={b} onChange={setB} keypad={false} />
      {shownUsername && !validUsername(shownUsername) && <p className="red-text" role="alert">{USERNAME_RULE}</p>}
      {a !== "" && !validSecret(a) && <p className="red-text" role="alert">{SECRET_RULE}</p>}
      {b !== "" && a !== b && <p className="red-text" role="alert">The two entries do not match.</p>}
      {err && <p className="red-text" role="alert">{err}</p>}
      <button className="primary" type="submit" disabled={busy || !ok}>{busy ? "Creating…" : "Create owner account"}</button>
    </form>
    <Legal />
  </main>;
}

/** Sign in with a username and a password or PIN. Also used as the lock screen (then `locked` is the user who was signed in). */
export function LoginScreen({ business, locked, onLogin }: { business: string; locked?: AppUser; onLogin: (u: AppUser) => void }) {
  const [username, setUsername] = useState(locked?.username ?? lastUsername()), [secret, setSecret] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function go() {
    if (!username.trim() || !secret) return; setBusy(true); setErr("");
    try { const u = await login(username, secret); rememberUsername(u.username); onLogin(u); } catch (e) { setErr(msg(e)); setSecret(""); }
    setBusy(false);
  }
  return <main className="loading" style={{ gap: 12 }}>
    <BrandMark size={56}/><h2>{business || "Msingi Accounting"}</h2>
    <p style={{ margin: 0 }}>{locked ? `Locked. ${locked.name}, enter your password to continue, or sign in as someone else.` : "Sign in"}</p>
    <form className="auth-form" onSubmit={e => { e.preventDefault(); void go(); }}>
      <label>Username<input value={username} onChange={e => setUsername(e.target.value)} autoFocus={!username} autoCapitalize="off" autoComplete="off" spellCheck={false} /></label>
      <SecretInput label="Password or PIN" value={secret} onChange={setSecret} autoFocus={!!username} />
      {err && <p className="red-text" role="alert">{err}</p>}
      <button className="primary" type="submit" disabled={busy || !username.trim() || !secret}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
    <Legal />
  </main>;
}

/** Shown on top of any screen when the signed-in user needs a manager to approve an action. */
export function OverrideDialog({ req, onDone }: { req: OverrideRequest; onDone: (approver: AppUser | null) => void }) {
  const [secret, setSecret] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function go() {
    if (!secret) return; setBusy(true); setErr("");
    try { const a = await verifyApprover(secret, req.perm, req.pct); if (a) { onDone(a); return; } setErr("That does not belong to someone who can approve this."); } catch (e) { setErr(msg(e)); }
    setSecret(""); setBusy(false);
  }
  return <Modal eyebrow="MANAGER APPROVAL" title="Approval needed" onClose={() => onDone(null)}>
    <p style={{ fontSize: 14, margin: "0 0 10px" }}>{req.label}</p>
    <SecretInput label="Manager's password or PIN" value={secret} onChange={setSecret} onEnter={go} autoFocus />
    {err && <p className="red-text" role="alert">{err}</p>}
    <div style={{ display: "flex", gap: 10, marginTop: 14 }}><button className="primary" disabled={busy || !secret} onClick={go}>{busy ? "Checking…" : "Approve"}</button><button className="secondary" onClick={() => onDone(null)}>Cancel</button></div>
  </Modal>;
}
