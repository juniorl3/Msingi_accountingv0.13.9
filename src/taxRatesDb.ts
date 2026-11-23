// Stores each business's editable non-payroll tax rates (corporate, turnover, service levy, withholding).
import { db, withTransaction } from "./db.ts";
import { getActiveBusiness, getVatPrefs } from "./business.ts";
import { DEFAULT_OTHER, validateOther } from "./taxRatesCalc.ts";
import type { OtherTaxes } from "./taxRatesCalc.ts";

const KEY = "other_taxes";

export async function getOtherTaxes(businessId?: number): Promise<OtherTaxes> {
  const biz = businessId ?? (await getActiveBusiness()).id;
  const d = await db();
  const base = DEFAULT_OTHER[(await getVatPrefs(biz)).jurisdiction];
  const row = (await d.select<Array<{ value: string }>>("SELECT value FROM business_settings WHERE business_id=? AND key=?", [biz, KEY]))[0];
  if (!row) return base;
  try { const stored = { ...base, ...JSON.parse(row.value) } as OtherTaxes; return validateOther(stored) ? base : stored; } catch { return base; }
}

export async function saveOtherTaxes(rates: OtherTaxes, businessId?: number): Promise<OtherTaxes> {
  const problem = validateOther(rates);
  if (problem) throw new Error(problem);
  const biz = businessId ?? (await getActiveBusiness()).id;
  await withTransaction(async tx => {
    await tx.execute("INSERT INTO business_settings(business_id,key,value) VALUES(?,?,?) ON CONFLICT(business_id,key) DO UPDATE SET value=excluded.value", [biz, KEY, JSON.stringify(rates)]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','tax_rates',?,?)", [String(biz), JSON.stringify(rates)]);
  });
  return rates;
}

export async function resetOtherTaxes(businessId?: number): Promise<OtherTaxes> {
  const biz = businessId ?? (await getActiveBusiness()).id;
  await withTransaction(async tx => {
    await tx.execute("DELETE FROM business_settings WHERE business_id=? AND key=?", [biz, KEY]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','tax_rates',?,?)", [String(biz), JSON.stringify({ reset: true })]);
  });
  return getOtherTaxes(biz);
}
