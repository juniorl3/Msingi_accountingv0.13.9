// Users, PIN sign-in and manager override.
import { db, withTransaction, insertedId } from "./db";
import { PERMS, ROLES, ROLE_DEFAULT, ROLE_DISCOUNT_LIMIT, canDiscount, hasPerm, parsePerms } from "./permissions";
import type { AppUser, Perm, Role } from "./permissions";
import { SECRET_RULE, USERNAME_RULE, hashPin, lockMs, randomSalt, validSecret, validUsername, verifyPin, waitText } from "./pinLogic";
import { recordAction } from "./posLog";

type Row = { id: number; name: string; username: string; role: Role; perms: string; discount_limit_pct: number; pin_salt: string; pin_hash: string; is_active: number; failed_count: number; locked_until: number };
const COLS = "id,name,username,role,perms,discount_limit_pct,pin_salt,pin_hash,is_active,failed_count,locked_until";
const toUser = (r: Row): AppUser => ({ id: r.id, name: r.name, username: r.username ?? "", role: r.role, perms: r.role === "owner" ? [...PERMS] : parsePerms(r.perms), discountLimitPct: r.role === "owner" ? 100 : Number(r.discount_limit_pct), active: !!r.is_active });

export async function countUsers(): Promise<number> { const d = await db(); return Number((await d.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM users"))[0]?.n ?? 0); }
export async function listUsers(): Promise<AppUser[]> { const d = await db(); return (await d.select<Row[]>(`SELECT ${COLS} FROM users ORDER BY is_active DESC, CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name COLLATE NOCASE`)).map(toUser); }
export async function listLoginUsers(): Promise<AppUser[]> { return (await listUsers()).filter(u => u.active); }

const cleanName = (n: string) => { const s = n.trim().replace(/\s+/g, " "); if (s.length < 2 || s.length > 40) throw new Error("Enter a name of 2 to 40 characters."); return s; };
const cleanSecret = (p: string) => { if (!validSecret(p)) throw new Error(SECRET_RULE); return p; };
const cleanUsername = (u: string) => { const s = u.trim(); if (!validUsername(s)) throw new Error(USERNAME_RULE); return s; };
const cleanLimit = (n: number) => { if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error("The discount limit is a whole percentage from 0 to 100."); return n; };

export type NewUser = { name: string; username: string; role: Role; secret: string; perms?: Perm[]; discountLimitPct?: number };
/** Creates a user. `by` is the signed-in owner (omitted only for the very first owner). */
export async function createUser(input: NewUser, by?: number): Promise<number> {
  const name = cleanName(input.name), username = cleanUsername(input.username), secret = cleanSecret(input.secret);
  if (!ROLES.includes(input.role)) throw new Error("Choose a role.");
  if (!by && (await countUsers()) > 0) throw new Error("Only a signed-in owner can add users.");
  if (!by && input.role !== "owner") throw new Error("The first user must be an owner.");
  const salt = randomSalt(), hash = await hashPin(secret, salt);
  const perms = (input.perms ?? ROLE_DEFAULT[input.role]).filter(p => PERMS.includes(p));
  const limit = cleanLimit(input.discountLimitPct ?? ROLE_DISCOUNT_LIMIT[input.role]);
  return withTransaction(async tx => {
    if ((await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM users WHERE name=? COLLATE NOCASE", [name]))[0].n > 0) throw new Error(`There is already a user called ${name}.`);
    if ((await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM users WHERE username=? COLLATE NOCASE", [username]))[0].n > 0) throw new Error(`The username ${username} is already taken.`);
    const id = insertedId(await tx.execute("INSERT INTO users(name,username,role,perms,discount_limit_pct,pin_salt,pin_hash) VALUES(?,?,?,?,?,?,?)", [name, username, input.role, JSON.stringify(perms), limit, salt, hash]), "user");
    await recordAction(tx, { kind: "user", userId: by ?? id, reason: "User created", detail: { id, name, username, role: input.role } });
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('CREATE','user',?,?)", [String(id), JSON.stringify({ name, username, role: input.role, by: by ?? id })]);
    return id;
  });
}

export type UserChanges = { name?: string; username?: string; role?: Role; perms?: Perm[]; discountLimitPct?: number; active?: boolean };
/** Changes a user. The business must always keep at least one active owner. */
export async function updateUser(id: number, ch: UserChanges, by: number) {
  return withTransaction(async tx => {
    const cur = (await tx.select<Row[]>(`SELECT ${COLS} FROM users WHERE id=?`, [id]))[0];
    if (!cur) throw new Error("User not found.");
    const next = { name: ch.name === undefined ? cur.name : cleanName(ch.name), username: ch.username === undefined ? cur.username : cleanUsername(ch.username), role: ch.role ?? cur.role, perms: ch.perms ? ch.perms.filter(p => PERMS.includes(p)) : parsePerms(cur.perms), limit: ch.discountLimitPct === undefined ? cur.discount_limit_pct : cleanLimit(ch.discountLimitPct), active: ch.active === undefined ? !!cur.is_active : ch.active };
    if (!ROLES.includes(next.role)) throw new Error("Choose a role.");
    if (cur.role === "owner" && cur.is_active && (next.role !== "owner" || !next.active)) {
      const others = (await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM users WHERE role='owner' AND is_active=1 AND id<>?", [id]))[0].n;
      if (others === 0) throw new Error("There must always be at least one active owner. Add another owner first.");
    }
    if (id === by && !next.active) throw new Error("You cannot switch off your own account.");
    if (next.name.toLowerCase() !== cur.name.toLowerCase() && (await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM users WHERE name=? COLLATE NOCASE AND id<>?", [next.name, id]))[0].n > 0) throw new Error(`There is already a user called ${next.name}.`);
    if (next.username.toLowerCase() !== (cur.username ?? "").toLowerCase() && (await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM users WHERE username=? COLLATE NOCASE AND id<>?", [next.username, id]))[0].n > 0) throw new Error(`The username ${next.username} is already taken.`);
    await tx.execute("UPDATE users SET name=?,username=?,role=?,perms=?,discount_limit_pct=?,is_active=? WHERE id=?", [next.name, next.username, next.role, JSON.stringify(next.perms), next.limit, next.active ? 1 : 0, id]);
    const detail = { id, name: next.name, username: next.username, role: next.role, perms: next.perms, discountLimitPct: next.limit, active: next.active };
    await recordAction(tx, { kind: "user", userId: by, reason: "User changed", detail });
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','user',?,?)", [String(id), JSON.stringify({ ...detail, by })]);
  });
}

/** Sets a new PIN or password (the old one is not needed: only an owner can do this, and it also clears any lock). */
export async function resetSecret(id: number, secret: string, by: number) {
  cleanSecret(secret); const salt = randomSalt(), hash = await hashPin(secret, salt);
  return withTransaction(async tx => {
    if (!(await tx.execute("UPDATE users SET pin_salt=?,pin_hash=?,failed_count=0,locked_until=0 WHERE id=?", [salt, hash, id])).rowsAffected) throw new Error("User not found.");
    await recordAction(tx, { kind: "user", userId: by, reason: "Password changed", detail: { id } });
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','user_pin',?,?)", [String(id), JSON.stringify({ by })]);
  });
}

const BAD_LOGIN = "Wrong username or password.";
const unknownFails = new Map<string, { n: number; until: number }>(); // throttles guesses at usernames that do not exist, so they look the same as real ones
/** Signs a user in with a username and a password or PIN. Five wrong tries in a row lock that username for a minute, then longer. */
export async function login(username: string, secret: string): Promise<AppUser> {
  const key = username.trim().toLowerCase(), now = Date.now();
  const d = await db(), r = (await d.select<Row[]>(`SELECT ${COLS} FROM users WHERE username=? COLLATE NOCASE AND is_active=1`, [key]))[0];
  if (!r) {
    const u = unknownFails.get(key) ?? { n: 0, until: 0 };
    if (u.until > now) throw new Error(`Too many wrong attempts. Try again in ${waitText(u.until - now)}.`);
    await hashPin(secret, "00".repeat(16)); // spend the same time as a real check
    const n = u.n + 1, lock = lockMs(n);
    if (unknownFails.size > 500) unknownFails.clear();
    unknownFails.set(key, { n, until: lock ? now + lock : 0 });
    throw new Error(BAD_LOGIN);
  }
  if (r.locked_until > now) throw new Error(`Too many wrong attempts. Try again in ${waitText(r.locked_until - now)}.`);
  if (!(await verifyPin(secret, r.pin_salt, r.pin_hash))) {
    const fails = r.failed_count + 1, lock = lockMs(fails);
    await d.execute("UPDATE users SET failed_count=?,locked_until=? WHERE id=?", [fails, lock ? now + lock : 0, r.id]);
    await recordAction(d, { kind: "login_failed", userId: r.id, reason: `Wrong password (${fails} in a row)` });
    throw new Error(lock ? `${BAD_LOGIN} Locked for ${waitText(lock)}.` : BAD_LOGIN);
  }
  await d.execute("UPDATE users SET failed_count=0,locked_until=0 WHERE id=?", [r.id]);
  await recordAction(d, { kind: "login", userId: r.id });
  return toUser(r);
}

let overrideFails = 0, overrideLockedUntil = 0;
/**
 * Manager override: finds the active user whose PIN this is and who may do `perm` (and a discount of `pct` percent, if given).
 * Returns that user, or null for a wrong PIN or a PIN of someone without the permission. Repeated failures lock overrides for a while.
 */
export async function verifyApprover(pin: string, perm: Perm, pct?: number): Promise<AppUser | null> {
  const now = Date.now();
  if (overrideLockedUntil > now) throw new Error(`Too many wrong PINs. Try again in ${waitText(overrideLockedUntil - now)}.`);
  const d = await db(), rows = await d.select<Row[]>(`SELECT ${COLS} FROM users WHERE is_active=1 AND locked_until<=?`, [now]);
  for (const r of rows) {
    const u = toUser(r);
    if (!hasPerm(u, perm) || (pct !== undefined && !canDiscount(u, pct))) continue;
    if (await verifyPin(pin, r.pin_salt, r.pin_hash)) { overrideFails = 0; return u; }
  }
  overrideFails++; const lock = lockMs(overrideFails);
  if (lock) overrideLockedUntil = Date.now() + lock;
  await recordAction(d, { kind: "override_failed", reason: `Wrong or unauthorised manager PIN for "${perm}"` });
  return null;
}
