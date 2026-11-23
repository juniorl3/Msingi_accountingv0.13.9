import { useEffect, useState } from "react";
import { createUser, listUsers, resetSecret, updateUser } from "./usersDb";
import { PERMS, PERM_LABEL, ROLES, ROLE_DEFAULT, ROLE_DISCOUNT_LIMIT } from "./permissions";
import type { AppUser, Perm, Role } from "./permissions";
import { SecretSetter } from "./Auth";
import { USERNAME_RULE, suggestUsername, validUsername } from "./pinLogic";
import { Modal, msg } from "./ui";
import { AUTO_LOCK_CHOICES } from "./healthLogic";

export default function Users({ me, onNotice, onMeChanged, autoLock, onAutoLock }: { me: AppUser; onNotice: (m: string) => void; onMeChanged: () => void; autoLock: number; onAutoLock: (minutes: number) => void }) {
  const [users, setUsers] = useState<AppUser[]>([]), [edit, setEdit] = useState<AppUser | "new" | null>(null);
  const load = () => listUsers().then(setUsers).catch(e => onNotice(msg(e)));
  useEffect(() => { void load(); }, []);
  return <section className="panel">
    <div className="panel-head"><div><h3>Users</h3><p>Everyone signs in with their own username and a password or PIN. Owners see everything; managers and cashiers get only the permissions ticked here.</p></div><button className="primary" onClick={() => setEdit("new")}>Add user</button></div>
    <div className="table-wrap"><table><thead><tr><th>NAME</th><th>USERNAME</th><th>ROLE</th><th>CAN DO</th><th className="right">DISCOUNT LIMIT</th><th>STATUS</th><th></th></tr></thead><tbody>
      {users.map(u => <tr key={u.id} style={{ opacity: u.active ? 1 : .55 }}><td className="description">{u.name}{u.id === me.id && <small style={{ display: "block", fontWeight: 400, color: "#9aa5b2" }}>you</small>}</td><td>{u.username}</td><td style={{ textTransform: "capitalize" }}>{u.role}</td>
        <td style={{ fontSize: 12, maxWidth: 320 }}>{u.role === "owner" ? "Everything" : u.perms.length ? u.perms.map(p => PERM_LABEL[p].split(" (")[0]).join(", ") : "Nothing"}</td>
        <td className="right">{u.perms.includes("discount") || u.role === "owner" ? `${u.discountLimitPct}%` : "—"}</td><td>{u.active ? "Active" : "Switched off"}</td><td><button className="secondary" onClick={() => setEdit(u)}>Edit</button></td></tr>)}
    </tbody></table></div>
    <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0 0", fontSize: 13, maxWidth: 420 }}>Lock the screen after
      <select value={autoLock} onChange={e => onAutoLock(Number(e.target.value))} style={{ width: "auto" }}>{AUTO_LOCK_CHOICES.map(m => <option key={m} value={m}>{m === 0 ? "never" : `${m} minute${m === 1 ? "" : "s"} idle`}</option>)}</select>
      <small style={{ color: "#8995a3" }}>This computer only</small></label>
    <p style={{ fontSize: 11, color: "#8995a3", margin: "10px 0 0" }}>PINs keep honest users apart and record who did what. They are not strong protection against someone who copies the database file, so keep the computer and backups safe.</p>
    {edit && <UserForm user={edit === "new" ? null : edit} me={me} onClose={() => setEdit(null)} onSaved={async (changedMe) => { setEdit(null); await load(); if (changedMe) onMeChanged(); }} onNotice={onNotice} />}
  </section>;
}

function UserForm({ user, me, onClose, onSaved, onNotice }: { user: AppUser | null; me: AppUser; onClose: () => void; onSaved: (changedMe: boolean) => void; onNotice: (m: string) => void }) {
  const [name, setName] = useState(user?.name ?? ""), [username, setUsername] = useState(user?.username ?? ""), [userTouched, setUserTouched] = useState(!!user), [role, setRole] = useState<Role>(user?.role ?? "cashier"), [perms, setPerms] = useState<Perm[]>(user?.perms ?? ROLE_DEFAULT.cashier);
  const [limit, setLimit] = useState(String(user?.discountLimitPct ?? ROLE_DISCOUNT_LIMIT.cashier)), [active, setActive] = useState(user?.active ?? true), [secretFor, setSecretFor] = useState<"add" | "reset" | null>(null), [busy, setBusy] = useState(false);
  function pickRole(r: Role) { setRole(r); setPerms(ROLE_DEFAULT[r]); setLimit(String(ROLE_DISCOUNT_LIMIT[r])); }
  const toggle = (p: Perm) => setPerms(perms.includes(p) ? perms.filter(x => x !== p) : [...perms, p]);
  const lim = Number(limit), uname = userTouched ? username : suggestUsername(name), unameOk = validUsername(uname);
  async function save(newSecret?: string) {
    setBusy(true);
    try {
      if (!Number.isInteger(lim) || lim < 0 || lim > 100) throw new Error("The discount limit is a whole percentage from 0 to 100.");
      if (!user) { await createUser({ name, username: uname, role, secret: newSecret!, perms, discountLimitPct: lim }, me.id); onNotice(`${name.trim()} added.`); onSaved(false); }
      else { await updateUser(user.id, { name, username: uname, role, perms, discountLimitPct: lim, active }, me.id); onNotice(`${name.trim()} updated.`); onSaved(user.id === me.id); }
    } catch (e) { onNotice(msg(e)); }
    setBusy(false);
  }
  return <Modal eyebrow={user ? "EDIT USER" : "NEW USER"} title={user ? user.name : "Add a user"} onClose={onClose}>
    <label>Name<input value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
    <label>Username (used to sign in)<input value={uname} onChange={e => { setUserTouched(true); setUsername(e.target.value); }} autoCapitalize="off" spellCheck={false} /></label>
    {uname && !unameOk && <p className="red-text" role="alert">{USERNAME_RULE}</p>}
    <label>Role<select value={role} onChange={e => pickRole(e.target.value as Role)}>{ROLES.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></label>
    {role !== "owner" && <fieldset style={{ border: "1px solid #e3e8ee", borderRadius: 10, padding: "8px 12px", margin: "8px 0" }}><legend style={{ fontSize: 12, fontWeight: 700 }}>Permissions</legend>
      {PERMS.filter(p => p !== "users").map(p => <label key={p} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={perms.includes(p)} onChange={() => toggle(p)} /> {PERM_LABEL[p]}</label>)}
      <small style={{ color: "#8995a3" }}>Without a permission, the person can still ask a manager to approve a single action with the manager's PIN.</small></fieldset>}
    {role !== "owner" && perms.includes("discount") && <label>Largest discount allowed (% of the sale)<input inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value)} /></label>}
    {user && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={active} onChange={e => setActive(e.target.checked)} disabled={user.id === me.id} /> Active (can sign in)</label>}
    <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
      {user ? <><button className="primary" disabled={busy || name.trim().length < 2 || !unameOk} onClick={() => save()}>{busy ? "Saving…" : "Save changes"}</button><button className="secondary" onClick={() => setSecretFor("reset")}>Reset password / PIN</button></>
        : <button className="primary" disabled={busy || name.trim().length < 2 || !unameOk} onClick={() => setSecretFor("add")}>Set password and add</button>}
      <button className="secondary" onClick={onClose}>Cancel</button></div>
    {secretFor && <SecretSetter title={user ? `New password or PIN for ${user.name}` : `Password or PIN for ${name.trim() || "the new user"}`} onCancel={() => setSecretFor(null)}
      onSet={async p => { setSecretFor(null); if (!user) await save(p); else { try { await resetSecret(user.id, p, me.id); onNotice(`Password changed for ${user.name}.`); } catch (e) { onNotice(msg(e)); } } }} />}
  </Modal>;
}
