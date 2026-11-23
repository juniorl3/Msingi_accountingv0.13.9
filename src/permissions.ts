// Roles and permissions. Pure (no imports).
export const PERMS = ["sell", "discount", "refund", "void", "drawer", "stock", "reports", "accounting", "users"] as const;
export type Perm = (typeof PERMS)[number];
export type Role = "owner" | "manager" | "cashier";
export const ROLES: Role[] = ["owner", "manager", "cashier"];

export const PERM_LABEL: Record<Perm, string> = {
  sell: "Make sales", discount: "Give discounts", refund: "Refund sales", void: "Reverse (void) sales and stock entries",
  drawer: "Open the cash drawer without a sale", stock: "Items and stock", reports: "Cashier reports and shifts of others", accounting: "Accounting, payroll, tax and settings", users: "Manage users",
};
/** What each role starts with. Owners always have everything; for managers and cashiers the owner can tick or untick each one. */
export const ROLE_DEFAULT: Record<Role, Perm[]> = {
  owner: [...PERMS],
  manager: ["sell", "discount", "refund", "void", "drawer", "stock", "reports"],
  cashier: ["sell"],
};
export const ROLE_DISCOUNT_LIMIT: Record<Role, number> = { owner: 100, manager: 20, cashier: 0 };

export type AppUser = { id: number; name: string; username: string; role: Role; perms: Perm[]; discountLimitPct: number; active: boolean };

export const hasPerm = (u: Pick<AppUser, "role" | "perms">, p: Perm) => u.role === "owner" || u.perms.includes(p);
/** May this user give a discount that is `pct` percent of the sale (0 to 100)? */
export const canDiscount = (u: AppUser, pct: number) => u.active && hasPerm(u, "discount") && (u.role === "owner" || pct <= u.discountLimitPct);

export function parsePerms(json: string): Perm[] {
  try { const a = JSON.parse(json); return Array.isArray(a) ? PERMS.filter(p => a.includes(p)) : []; } catch { return []; }
}

export type PageKey = string;
/** Which permission opens each page. Pages not listed need "accounting". */
export const PAGE_PERM: Record<string, Perm> = { sale: "sell", shift: "sell", items: "stock", stock: "stock", salesrep: "reports", cashreports: "reports", users: "users" };
export const pagePerm = (page: PageKey): Perm => PAGE_PERM[page] ?? "accounting";
export const canOpenPage = (u: Pick<AppUser, "role" | "perms">, page: PageKey) => hasPerm(u, pagePerm(page));
/** The first page a user should land on after signing in. */
export const homePage = (u: Pick<AppUser, "role" | "perms">): PageKey => (hasPerm(u, "accounting") ? "dashboard" : hasPerm(u, "sell") ? "sale" : hasPerm(u, "stock") ? "stock" : hasPerm(u, "reports") ? "cashreports" : "shift");
