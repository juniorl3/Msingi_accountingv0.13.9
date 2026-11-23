// Businesses and their VAT preferences.
//
// Every business keeps its own VAT preferences in business_settings, keyed by business id, so one business's
// rate or defaults can never leak into another's. This database holds one business today; the data layer is
// already keyed by id so that a later release can add more without moving any settings.
import { db, withTransaction } from "./db.ts";

export type Business = { id: number; name: string };
export type TxVatTreatment = "none" | "standard" | "zero" | "exempt";
export type DocVatTreatment = "none" | "standard" | "zero" | "exempt";
/** Tanzania Mainland and Zanzibar have separate VAT rates and thresholds. */
export type Jurisdiction = "mainland" | "zanzibar";
export const JURISDICTIONS: Record<Jurisdiction, { label: string; vatRate: number }> = {
  mainland: { label: "Tanzania Mainland", vatRate: 18 },  // TRA, Taxes and Duties at a Glance 2025/26
  zanzibar: { label: "Zanzibar", vatRate: 15 },
};
export type VatPrefs = {
  jurisdiction: Jurisdiction;   // which side of the Union the business trades on
  vatRegistered: boolean;       // false: no VAT is recorded anywhere and the VAT return is hidden
  rate: number;                 // standard VAT rate, percent
  amountIncludesVat: boolean;   // "Amount includes VAT" ticked by default on new entries
  txTreatment: TxVatTreatment;  // default VAT choice on a new transaction
  docTreatment: DocVatTreatment; // default VAT choice on a new invoice or bill
};
/** Tanzania standard rate; used until a business saves its own. */
export const DEFAULT_VAT_PREFS: VatPrefs = { jurisdiction: "mainland", vatRegistered: true, rate: 18, amountIncludesVat: true, txTreatment: "none", docTreatment: "standard" };

const K = { jurisdiction: "jurisdiction", registered: "vat_registered", rate: "vat_rate", includes: "vat_amount_includes_vat", tx: "vat_default_tx_treatment", doc: "vat_default_doc_treatment" } as const;
const TX_VALUES: TxVatTreatment[] = ["none", "standard", "zero", "exempt"];
const DOC_VALUES: DocVatTreatment[] = ["none", "standard", "zero", "exempt"];

const validRate = (n: number) => Number.isFinite(n) && n > 0 && n < 100;

/** Turns stored key/value rows into preferences. Anything missing or invalid falls back to the default for that field only. */
export function parseVatPrefs(stored: Record<string, string | undefined>): VatPrefs {
  const rate = Number(stored[K.rate]);
  const jurisdiction: Jurisdiction = stored[K.jurisdiction] === "zanzibar" ? "zanzibar" : "mainland";
  const vatRegistered = stored[K.registered] !== "0";
  const tx = stored[K.tx] as TxVatTreatment, doc = stored[K.doc] as DocVatTreatment;
  return normalisePrefs({
    jurisdiction, vatRegistered,
    rate: stored[K.rate] !== undefined && validRate(rate) ? rate : JURISDICTIONS[jurisdiction].vatRate,
    amountIncludesVat: stored[K.includes] === "0" ? false : stored[K.includes] === "1" ? true : DEFAULT_VAT_PREFS.amountIncludesVat,
    txTreatment: TX_VALUES.includes(tx) ? tx : DEFAULT_VAT_PREFS.txTreatment,
    docTreatment: DOC_VALUES.includes(doc) ? doc : DEFAULT_VAT_PREFS.docTreatment,
  });
}
/** A business that is not VAT-registered records no VAT; a registered one never defaults to "no VAT" on invoices and bills. */
export function normalisePrefs(p: VatPrefs): VatPrefs {
  if (!p.vatRegistered) return { ...p, txTreatment: "none", docTreatment: "none" };
  return { ...p, docTreatment: p.docTreatment === "none" ? "standard" : p.docTreatment };
}

/** Creates the business tables and the first business. Safe to run on every start; never changes accounting data. */
export async function initialiseBusiness() {
  const d = await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS businesses(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute(`CREATE TABLE IF NOT EXISTS business_settings(business_id INTEGER NOT NULL REFERENCES businesses(id),key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(business_id,key))`);
  await withTransaction(async tx => {
    let first = (await tx.select<Array<{ id: number }>>("SELECT id FROM businesses ORDER BY id LIMIT 1"))[0];
    if (!first) {
      const nameRow = (await tx.select<Array<{ value: string }>>("SELECT value FROM settings WHERE key='business_name'"))[0];
      const ins = await tx.execute("INSERT INTO businesses(name) VALUES(?)", [nameRow?.value?.trim() || "My Business"]);
      first = { id: Number(ins.lastInsertId) };
    }
    await tx.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('active_business_id',?)", [String(first.id)]);
    // Carry the single, pre-0.5.2 VAT rate over to the business it belonged to. The old row is left in place.
    const has = await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM business_settings WHERE business_id=? AND key=?", [first.id, K.rate]);
    if (!has[0]?.n) {
      const legacy = (await tx.select<Array<{ value: string }>>("SELECT value FROM settings WHERE key='vat_rate'"))[0];
      const n = Number(legacy?.value);
      if (legacy && validRate(n)) await tx.execute("INSERT INTO business_settings(business_id,key,value) VALUES(?,?,?)", [first.id, K.rate, String(n)]);
    }
  });
}

export async function getActiveBusiness(): Promise<Business> {
  const d = await db();
  const active = (await d.select<Array<{ value: string }>>("SELECT value FROM settings WHERE key='active_business_id'"))[0];
  const byId = active ? await d.select<Business[]>("SELECT id,name FROM businesses WHERE id=?", [Number(active.value)]) : [];
  const row = byId[0] ?? (await d.select<Business[]>("SELECT id,name FROM businesses ORDER BY id LIMIT 1"))[0];
  if (!row) throw new Error("No business is set up. Restart Msingi to create one.");
  return row;
}

export async function setBusinessName(name: string, businessId?: number): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Enter a business name.");
  if (clean.length > 120) throw new Error("The business name is too long (maximum 120 characters).");
  const id = businessId ?? (await getActiveBusiness()).id;
  await withTransaction(async tx => {
    await tx.execute("UPDATE businesses SET name=? WHERE id=?", [clean, id]);
    await tx.execute("INSERT INTO settings(key,value) VALUES('business_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [clean]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','business',?,?)", [String(id), JSON.stringify({ name: clean })]);
  });
  return clean;
}

export async function getVatPrefs(businessId?: number): Promise<VatPrefs> {
  const id = businessId ?? (await getActiveBusiness()).id;
  const d = await db();
  const rows = await d.select<Array<{ key: string; value: string }>>("SELECT key,value FROM business_settings WHERE business_id=?", [id]);
  return parseVatPrefs(Object.fromEntries(rows.map(r => [r.key, r.value])));
}

export async function setVatPrefs(input: VatPrefs, businessId?: number): Promise<VatPrefs> {
  if (!validRate(input.rate)) throw new Error("Enter a VAT rate above 0 and below 100.");
  if (!TX_VALUES.includes(input.txTreatment) || !DOC_VALUES.includes(input.docTreatment)) throw new Error("Choose a valid default VAT treatment.");
  if (!(input.jurisdiction in JURISDICTIONS)) throw new Error("Choose Tanzania Mainland or Zanzibar.");
  const prefs: VatPrefs = normalisePrefs({ jurisdiction: input.jurisdiction, vatRegistered: !!input.vatRegistered, rate: Math.round(input.rate * 100) / 100, amountIncludesVat: !!input.amountIncludesVat, txTreatment: input.txTreatment, docTreatment: input.docTreatment });
  const active = await getActiveBusiness();
  const id = businessId ?? active.id;
  await withTransaction(async tx => {
    const owner = await tx.select<Array<{ id: number }>>("SELECT id FROM businesses WHERE id=?", [id]);
    if (!owner.length) throw new Error("Business not found.");
    const values: Array<[string, string]> = [[K.jurisdiction, prefs.jurisdiction], [K.registered, prefs.vatRegistered ? "1" : "0"], [K.rate, String(prefs.rate)], [K.includes, prefs.amountIncludesVat ? "1" : "0"], [K.tx, prefs.txTreatment], [K.doc, prefs.docTreatment]];
    for (const [key, value] of values) await tx.execute("INSERT INTO business_settings(business_id,key,value) VALUES(?,?,?) ON CONFLICT(business_id,key) DO UPDATE SET value=excluded.value", [id, key, value]);
    // Mirror the active business's rate to the pre-0.5.2 setting so an older build opened on this data shows the same rate.
    if (id === active.id) await tx.execute("INSERT INTO settings(key,value) VALUES('vat_rate',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(prefs.rate)]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','vat_preferences',?,?)", [String(id), JSON.stringify(prefs)]);
  });
  return prefs;
}
