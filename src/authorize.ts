// Manager override. A screen asks authorize(); if the signed-in user may not do the action, the App shows a manager-PIN dialog.
import { canDiscount, hasPerm } from "./permissions";
import type { AppUser, Perm } from "./permissions";

export type OverrideRequest = { perm: Perm; label: string; pct?: number };
type Handler = (req: OverrideRequest) => Promise<AppUser | null>;
let handler: Handler | null = null;
export const setOverrideHandler = (h: Handler | null) => { handler = h; };

export type AuthResult = { ok: true; approverId?: number } | { ok: false };
/** Allowed outright, or allowed with a manager's PIN (then approverId is that manager), or refused. */
export async function authorize(user: AppUser, perm: Perm, label: string, pct?: number): Promise<AuthResult> {
  if (pct === undefined ? hasPerm(user, perm) : canDiscount(user, pct)) return { ok: true };
  if (!handler) return { ok: false };
  const approver = await handler({ perm, label, pct });
  return approver ? { ok: true, approverId: approver.id } : { ok: false };
}
