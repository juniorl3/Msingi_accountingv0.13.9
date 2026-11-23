// Items and stock. Every stock movement posts to the ledger through the same paths the rest of Msingi uses
// (supplier bills, sales transactions, invoices, journals), inside ONE database transaction, so the stock
// records and the books cannot drift apart. Cost is weighted average. Inventory is account 1200, cost of
// goods sold is 5000.
import { db, withTransaction, insertedId } from "./db.ts";
import { recordAction } from "./posLog.ts";
import { queueFiscal } from "./fiscalDb.ts";
import type { Actor } from "./posLog.ts";
import type { Conn } from "./db.ts";
import { getActiveBusiness } from "./business.ts";
import { addTransactionWithJournal, cashAccountFor, insertJournal, reverseJournalEntry } from "./ledger.ts";
import type { IntegrityCheck } from "./ledger.ts";
import { createDocument } from "./parties.ts";
import { allocate, fmtQty, issueValue, lineAmount, mulDiv } from "./itemsCalc.ts";
import { vatFromEntered, VAT_PAYABLE } from "./vat.ts";
import { returnShare } from "./returnsCalc.ts";
import { checkSplit } from "./saleCalc.ts";
import type { ImportRow, ItemKind, ItemVat } from "./itemsCalc.ts";

export const INVENTORY = "1200", COGS = "5000", OPENING_OFFSET = "3000";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: ItemKind[] = ["stock", "service", "menu"], VATS: ItemVat[] = ["none", "standard", "zero", "exempt"];

export type Item = { id: number; code: string; barcode: string; name: string; category: string; kind: ItemKind; unit: string; price_tzs: number; price_includes_vat: number; vat_treatment: ItemVat; reorder_milli: number; qty_milli: number; value_tzs: number; is_active: number };
export type ItemInput = { code: string; barcode?: string; name: string; category?: string; kind: ItemKind; unit?: string; price: number; priceIncludesVat?: boolean; vat?: ItemVat; reorderMilli?: number };
export type VatContext = { registered: boolean; rate: number };

const COLS = "id,code,barcode,name,category,kind,unit,price_tzs,price_includes_vat,vat_treatment,reorder_milli,qty_milli,value_tzs,is_active";

export async function initialiseItems() {
  const d = await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,code TEXT NOT NULL,barcode TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL CHECK(kind IN ('stock','service','menu')),unit TEXT NOT NULL DEFAULT 'piece',price_tzs INTEGER NOT NULL DEFAULT 0,price_includes_vat INTEGER NOT NULL DEFAULT 1,vat_treatment TEXT NOT NULL DEFAULT 'standard',reorder_milli INTEGER NOT NULL DEFAULT 0,qty_milli INTEGER NOT NULL DEFAULT 0,value_tzs INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_items_code ON items(business_id,code COLLATE NOCASE)");
  await d.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_items_barcode ON items(business_id,barcode) WHERE barcode<>''");
  await d.execute(`CREATE TABLE IF NOT EXISTS item_categories(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(business_id,name COLLATE NOCASE))`);
  // Safe, repeatable migration: convert legacy free-text categories into the category master list.
  await d.execute(`INSERT OR IGNORE INTO item_categories(business_id,name) SELECT DISTINCT business_id,TRIM(category) FROM items WHERE TRIM(category)<>''`);
  await d.execute(`CREATE TABLE IF NOT EXISTS recipe_lines(menu_item_id INTEGER NOT NULL REFERENCES items(id),ingredient_id INTEGER NOT NULL REFERENCES items(id),qty_milli INTEGER NOT NULL CHECK(qty_milli>0),PRIMARY KEY(menu_item_id,ingredient_id))`);
  await d.execute(`CREATE TABLE IF NOT EXISTS stock_events(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,kind TEXT NOT NULL,event_date TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',voided INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute(`CREATE TABLE IF NOT EXISTS stock_moves(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL REFERENCES stock_events(id),item_id INTEGER NOT NULL REFERENCES items(id),qty_milli INTEGER NOT NULL,value_tzs INTEGER NOT NULL)`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_stock_moves_item ON stock_moves(item_id)");
  await d.execute(`CREATE TABLE IF NOT EXISTS sale_lines(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL REFERENCES stock_events(id),item_id INTEGER NOT NULL REFERENCES items(id),qty_milli INTEGER NOT NULL,net_tzs INTEGER NOT NULL,cost_tzs INTEGER NOT NULL)`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_sale_lines_item ON sale_lines(item_id)");
  await d.execute(`CREATE TABLE IF NOT EXISTS stock_event_links(event_id INTEGER NOT NULL REFERENCES stock_events(id),journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),PRIMARY KEY(event_id,journal_entry_id))`);
}

export const eventRef = (id: number) => `STK-${String(id).padStart(6, "0")}`;
const whole = (n: unknown, what: string) => { if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new Error(`${what} must be a whole number of TZS (0 or more).`); return n; };
const checkDate = (s: string) => { if (!DATE.test(s)) throw new Error("Enter a valid date."); };

// ---------- product categories ----------
export type ItemCategory = { id: number; name: string };
export async function listItemCategories(): Promise<ItemCategory[]> {
  const d = await db(), biz = await getActiveBusiness();
  return d.select<ItemCategory[]>("SELECT id,name FROM item_categories WHERE business_id=? ORDER BY name COLLATE NOCASE", [biz.id]);
}
export async function saveItemCategory(name: string, id?: number) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 60) throw new Error("Enter a category name of 1–60 characters.");
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const duplicate = await tx.select<Array<{id:number}>>("SELECT id FROM item_categories WHERE business_id=? AND name=? COLLATE NOCASE", [biz.id, clean]);
    if (duplicate.length && duplicate[0].id !== id) throw new Error(`The category ${clean} already exists.`);
    if (id === undefined) {
      const r = await tx.execute("INSERT INTO item_categories(business_id,name) VALUES(?,?)", [biz.id, clean]);
      const newId = insertedId(r, "category");
      await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('CREATE','item_category',?,?)", [String(newId), JSON.stringify({name:clean})]);
      return newId;
    }
    const current = await tx.select<Array<{id:number}>>("SELECT id FROM item_categories WHERE id=? AND business_id=?", [id,biz.id]);
    if (!current.length) throw new Error("Category not found.");
    const old = await tx.select<Array<{name:string}>>("SELECT name FROM item_categories WHERE id=?", [id]);
    await tx.execute("UPDATE item_categories SET name=? WHERE id=? AND business_id=?", [clean,id,biz.id]);
    await tx.execute("UPDATE items SET category=? WHERE business_id=? AND category=?", [clean,biz.id,old[0].name]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','item_category',?,?)", [String(id), JSON.stringify({old:old[0].name,name:clean})]);
    return id;
  });
}
export async function deleteItemCategory(id: number) {
  const biz = await getActiveBusiness();
  await withTransaction(async tx => {
    const row = await tx.select<Array<{name:string}>>("SELECT name FROM item_categories WHERE id=? AND business_id=?", [id,biz.id]);
    if (!row.length) throw new Error("Category not found.");
    const used = await tx.select<Array<{n:number}>>("SELECT COUNT(*) n FROM items WHERE business_id=? AND category=?", [biz.id,row[0].name]);
    if (used[0].n) throw new Error("This category is assigned to items. Reassign those items before deleting it.");
    await tx.execute("DELETE FROM item_categories WHERE id=? AND business_id=?", [id,biz.id]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('DELETE','item_category',?,?)", [String(id), JSON.stringify({name:row[0].name})]);
  });
}

// ---------- items ----------
export async function listItems(includeInactive = false): Promise<Item[]> {
  const d = await db(), biz = await getActiveBusiness();
  return d.select<Item[]>(`SELECT ${COLS} FROM items WHERE business_id=? AND (is_active=1 OR ?=1) ORDER BY name COLLATE NOCASE`, [biz.id, includeInactive ? 1 : 0]);
}
async function getItems(tx: Conn, biz: number, ids: number[]): Promise<Map<number, Item>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = await tx.select<Item[]>(`SELECT ${COLS} FROM items WHERE business_id=? AND id IN (${uniq.map(() => "?").join(",")})`, [biz, ...uniq]);
  return new Map(rows.map(r => [r.id, r]));
}
const need = (m: Map<number, Item>, id: number) => { const it = m.get(id); if (!it) throw new Error("An item on this form no longer exists."); return it; };

async function saveItemTx(tx: Conn, biz: number, input: ItemInput, id?: number): Promise<{ id: number; created: boolean }> {
  const code = input.code.trim(), name = input.name.trim().replace(/\s+/g, " "), barcode = (input.barcode ?? "").trim();
  if (!code || code.length > 40) throw new Error("Enter an item code of up to 40 characters.");
  if (!name || name.length > 120) throw new Error("Enter an item name of up to 120 characters.");
  if (!KINDS.includes(input.kind)) throw new Error("Choose stock item, service or menu item.");
  const vat = input.vat ?? "standard"; if (!VATS.includes(vat)) throw new Error("Choose a valid VAT treatment.");
  const price = whole(input.price, `The price of ${name}`);
  const reorder = input.kind === "stock" ? (input.reorderMilli ?? 0) : 0;
  if (!Number.isSafeInteger(reorder) || reorder < 0) throw new Error("The reorder level cannot be negative.");
  const dupCode = await tx.select<Array<{ id: number }>>("SELECT id FROM items WHERE business_id=? AND code=? COLLATE NOCASE", [biz, code]);
  if (dupCode.length && dupCode[0].id !== id) { if (id === undefined) { id = dupCode[0].id; } else throw new Error(`Another item already uses the code ${code}.`); }
  if (barcode) { const dupBar = await tx.select<Array<{ id: number }>>("SELECT id FROM items WHERE business_id=? AND barcode=?", [biz, barcode]); if (dupBar.length && dupBar[0].id !== id) throw new Error(`Another item already uses the barcode ${barcode}.`); }
  const category = (input.category ?? "").trim().replace(/\s+/g, " ");
  if (category) await tx.execute("INSERT OR IGNORE INTO item_categories(business_id,name) VALUES(?,?)", [biz,category]);
  const vals = [code, barcode, name, category, input.kind, (input.unit ?? "piece").trim() || "piece", price, input.priceIncludesVat === false ? 0 : 1, vat, reorder];
  if (id === undefined) {
    const ins = await tx.execute("INSERT INTO items(business_id,code,barcode,name,category,kind,unit,price_tzs,price_includes_vat,vat_treatment,reorder_milli) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [biz, ...vals]);
    return { id: insertedId(ins, "item"), created: true };
  }
  const cur = (await tx.select<Item[]>(`SELECT ${COLS} FROM items WHERE id=? AND business_id=?`, [id, biz]))[0];
  if (!cur) throw new Error("Item not found.");
  if (cur.kind !== input.kind) {
    const moved = await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM stock_moves WHERE item_id=?", [id]);
    if (moved[0].n) throw new Error(`${cur.name} has stock history, so its type cannot be changed. Make a new item instead.`);
  }
  await tx.execute("UPDATE items SET code=?,barcode=?,name=?,category=?,kind=?,unit=?,price_tzs=?,price_includes_vat=?,vat_treatment=?,reorder_milli=? WHERE id=?", [...vals, id]);
  return { id, created: false };
}
export async function saveItem(input: ItemInput, id?: number) {
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const r = await saveItemTx(tx, biz.id, input, id);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES(?,?,?,?)", [r.created ? "CREATE" : "UPDATE", "item", String(r.id), JSON.stringify(input)]);
    return r;
  });
}
export async function setItemActive(id: number, active: boolean) {
  const biz = await getActiveBusiness();
  await withTransaction(async tx => {
    await tx.execute("UPDATE items SET is_active=? WHERE id=? AND business_id=?", [active ? 1 : 0, id, biz.id]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','item',?,?)", [String(id), JSON.stringify({ active })]);
  });
}

export type RecipeLine = { ingredientId: number; qtyMilli: number; ingredient?: string; unit?: string };
export async function getRecipe(menuItemId: number): Promise<RecipeLine[]> {
  const d = await db();
  return d.select<RecipeLine[]>(`SELECT r.ingredient_id AS ingredientId,r.qty_milli AS qtyMilli,i.name AS ingredient,i.unit FROM recipe_lines r JOIN items i ON i.id=r.ingredient_id WHERE r.menu_item_id=? ORDER BY i.name COLLATE NOCASE`, [menuItemId]);
}
export async function setRecipe(menuItemId: number, lines: Array<{ ingredientId: number; qtyMilli: number }>) {
  const biz = await getActiveBusiness();
  await withTransaction(async tx => {
    const items = await getItems(tx, biz.id, [menuItemId, ...lines.map(l => l.ingredientId)]);
    if (need(items, menuItemId).kind !== "menu") throw new Error("Recipes belong to menu items.");
    const seen = new Set<number>();
    for (const l of lines) {
      const ing = need(items, l.ingredientId);
      if (ing.kind !== "stock") throw new Error(`${ing.name} is not a stock item, so it cannot be an ingredient.`);
      if (seen.has(l.ingredientId)) throw new Error(`${ing.name} is listed twice in the recipe.`);
      if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new Error(`Enter the amount of ${ing.name} used.`);
      seen.add(l.ingredientId);
    }
    await tx.execute("DELETE FROM recipe_lines WHERE menu_item_id=?", [menuItemId]);
    for (const l of lines) await tx.execute("INSERT INTO recipe_lines(menu_item_id,ingredient_id,qty_milli) VALUES(?,?,?)", [menuItemId, l.ingredientId, l.qtyMilli]);
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','recipe',?,?)", [String(menuItemId), JSON.stringify(lines)]);
  });
}

// ---------- stock movement plumbing ----------
async function newEvent(tx: Conn, biz: number, kind: string, date: string, reference = "", note = "") {
  checkDate(date);
  const ins = await tx.execute("INSERT INTO stock_events(business_id,kind,event_date,reference,note) VALUES(?,?,?,?,?)", [biz, kind, date, reference.trim(), note.trim()]);
  const id = insertedId(ins, "stock event");
  return { id, ref: eventRef(id) };
}
const link = (tx: Conn, eventId: number, journalId: number) => tx.execute("INSERT OR IGNORE INTO stock_event_links(event_id,journal_entry_id) VALUES(?,?)", [eventId, journalId]);
async function journalOfTransaction(tx: Conn, txId: number) {
  const r = await tx.select<Array<{ id: number }>>("SELECT id FROM journal_entries WHERE source_type='transaction' AND source_id=?", [String(txId)]);
  if (!r.length) throw new Error("The sale was saved without a ledger entry. Nothing was recorded; please try again.");
  return r[0].id;
}
async function applyMove(tx: Conn, eventId: number, item: Item, qtyDelta: number, valueDelta: number) {
  const q = item.qty_milli + qtyDelta, v = item.value_tzs + valueDelta;
  if (q < 0) throw new Error(`Not enough ${item.name} in stock: ${fmtQty(item.qty_milli)} ${item.unit} on hand.`);
  if (v < 0) throw new Error(`That would make the stock value of ${item.name} negative.`);
  if (q === 0 && v !== 0) throw new Error(`That would leave stock value on ${item.name} with no quantity. Check the cost.`);
  await tx.execute("UPDATE items SET qty_milli=?,value_tzs=? WHERE id=?", [q, v, item.id]);
  await tx.execute("INSERT INTO stock_moves(event_id,item_id,qty_milli,value_tzs) VALUES(?,?,?,?)", [eventId, item.id, qtyDelta, valueDelta]);
  item.qty_milli = q; item.value_tzs = v;
}
const audit = (tx: Conn, type: string, eventId: number, details: unknown) => tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES(?,?,?,?)", [type, "stock_event", String(eventId), JSON.stringify(details)]);

// ---------- opening stock and CSV import ----------
export type OpeningLine = { itemId: number; qtyMilli: number; unitCost: number };
async function openingTx(tx: Conn, biz: number, date: string, lines: OpeningLine[], postToLedger: boolean) {
  if (!lines.length) throw new Error("Add at least one item with an opening quantity.");
  const items = await getItems(tx, biz, lines.map(l => l.itemId));
  const ev = await newEvent(tx, biz, "opening", date, "", postToLedger ? "Opening stock posted to Inventory" : "Opening stock already in the books");
  let total = 0; const seen = new Set<number>();
  for (const l of lines) {
    const it = need(items, l.itemId);
    if (it.kind !== "stock") throw new Error(`${it.name} is not a stock item.`);
    if (seen.has(l.itemId)) throw new Error(`${it.name} is listed twice.`);
    seen.add(l.itemId);
    const moved = await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM stock_moves WHERE item_id=?", [it.id]);
    if (moved[0].n) throw new Error(`${it.name} already has stock history. Use Receive stock or Adjust stock instead.`);
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new Error(`Enter the opening quantity of ${it.name}.`);
    if (!Number.isFinite(l.unitCost) || l.unitCost < 0) throw new Error(`Enter the cost per ${it.unit} of ${it.name}.`);
    const value = lineAmount(l.qtyMilli, l.unitCost);
    await applyMove(tx, ev.id, it, l.qtyMilli, value);
    total += value;
  }
  if (postToLedger && total > 0) {
    const j = await insertJournal({ date, description: `Opening stock ${ev.ref}`, sourceType: "stock_opening", sourceId: String(ev.id), lines: [{ accountCode: INVENTORY, debitTzs: total, description: "Opening stock" }, { accountCode: OPENING_OFFSET, creditTzs: total, description: "Opening stock" }] }, tx);
    await link(tx, ev.id, j.id);
  }
  await audit(tx, "STOCK", ev.id, { kind: "opening", total, postToLedger });
  return { eventId: ev.id, reference: ev.ref, total };
}
export async function openingStock(input: { date: string; lines: OpeningLine[]; postToLedger: boolean }) {
  const biz = await getActiveBusiness();
  return withTransaction(tx => openingTx(tx, biz.id, input.date, input.lines, input.postToLedger));
}

/** Creates or updates items from a parsed CSV in one all-or-nothing step, optionally loading opening stock. */
export async function importItems(rows: ImportRow[], opts: { date: string; postToLedger: boolean }) {
  if (!rows.length) throw new Error("There are no items to import.");
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    let created = 0, updated = 0; const opening: OpeningLine[] = [];
    for (const r of rows) {
      let res;
      try { res = await saveItemTx(tx, biz.id, { code: r.code, barcode: r.barcode, name: r.name, category: r.category, kind: r.kind, unit: r.unit, price: r.price, priceIncludesVat: r.priceIncludesVat, vat: r.vat, reorderMilli: r.reorderMilli }); }
      catch (e) { throw new Error(`Row ${r.line} (${r.code}): ${e instanceof Error ? e.message : e}`); }
      if (res.created) created++; else updated++;
      if (r.openingMilli > 0) opening.push({ itemId: res.id, qtyMilli: r.openingMilli, unitCost: r.openingUnitCost });
    }
    let openingTotal = 0;
    if (opening.length) {
      try { openingTotal = (await openingTx(tx, biz.id, opts.date, opening, opts.postToLedger)).total; }
      catch (e) { throw new Error(`Opening stock: ${e instanceof Error ? e.message : e}`); }
    }
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('IMPORT','item','0',?)", [JSON.stringify({ created, updated, opening: opening.length, openingTotal })]);
    return { created, updated, opening: opening.length, openingTotal };
  });
}

// ---------- buying stock ----------
export type ReceiveInput = { date: string; supplierId?: number; paymentMethod?: string; dueDate?: string; reference?: string; lines: Array<{ itemId: number; qtyMilli: number; lineTotal: number }>; vatTreatment: ItemVat; vatRate: number; amountIncludesVat: boolean; vatRegistered: boolean };
/** Stock bought on credit becomes a supplier bill (Dr Inventory, Dr Input VAT, Cr Accounts Payable); stock paid for now becomes a "Stock purchase" expense. */
export async function receiveStock(input: ReceiveInput) {
  checkDate(input.date);
  if (!input.lines.length) throw new Error("Add at least one item.");
  if (!input.supplierId && !input.paymentMethod) throw new Error("Choose a supplier (buy on credit) or how you paid.");
  const biz = await getActiveBusiness();
  const treatment: ItemVat = input.vatRegistered ? input.vatTreatment : "none";
  return withTransaction(async tx => {
    const items = await getItems(tx, biz.id, input.lines.map(l => l.itemId));
    const merged = new Map<number, { qty: number; total: number }>();
    for (const l of input.lines) {
      const it = need(items, l.itemId);
      if (it.kind !== "stock") throw new Error(`${it.name} is not a stock item.`);
      if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new Error(`Enter the quantity received of ${it.name}.`);
      if (!Number.isSafeInteger(l.lineTotal) || l.lineTotal <= 0) throw new Error(`Enter the total cost of ${it.name} in whole TZS.`);
      const m = merged.get(l.itemId) ?? { qty: 0, total: 0 }; m.qty += l.qtyMilli; m.total += l.lineTotal; merged.set(l.itemId, m);
    }
    const ev = await newEvent(tx, biz.id, "purchase", input.date, input.reference ?? "");
    const entered = [...merged.values()].reduce((s, m) => s + m.total, 0);
    const desc = `Stock received ${ev.ref}${input.reference?.trim() ? " · " + input.reference.trim() : ""}`.slice(0, 190);
    let net: number, journalId: number, docNumber: string | null = null;
    if (input.supplierId) {
      const doc = await createDocument({ docType: "bill", partyId: input.supplierId, docDate: input.date, dueDate: input.dueDate || input.date, description: desc, amountTzs: entered, vatRate: input.vatRate, accountCode: INVENTORY, vatTreatment: treatment, amountIncludesVat: input.amountIncludesVat }, tx);
      const row = (await tx.select<Array<{ net_tzs: number; journal_entry_id: number }>>("SELECT net_tzs,journal_entry_id FROM documents WHERE id=?", [doc.id]))[0];
      net = row.net_tzs; journalId = row.journal_entry_id; docNumber = doc.number;
    } else {
      const txId = await addTransactionWithJournal({ date: input.date, kind: "expense", category: "Stock purchase", description: desc, amount: entered, payment_method: input.paymentMethod!, reference: ev.ref, vat_treatment: treatment, vat_rate: input.vatRate, amount_includes_vat: input.amountIncludesVat }, tx);
      const row = (await tx.select<Array<{ amount: number; vat_tzs: number }>>("SELECT amount,vat_tzs FROM transactions WHERE id=?", [txId]))[0];
      net = row.amount - row.vat_tzs; journalId = await journalOfTransaction(tx, txId);
    }
    await link(tx, ev.id, journalId);
    const ids = [...merged.keys()], shares = allocate(net, ids.map(i => merged.get(i)!.total));
    for (let k = 0; k < ids.length; k++) await applyMove(tx, ev.id, items.get(ids[k])!, merged.get(ids[k])!.qty, shares[k]);
    await audit(tx, "STOCK", ev.id, { kind: "purchase", net, entered, bill: docNumber });
    return { eventId: ev.id, reference: ev.ref, net, billNumber: docNumber };
  });
}

// ---------- selling ----------
export type SaleInput = { date: string; paymentMethod?: string; payments?: Array<{ method: string; amount: number }>; customerId?: number; dueDate?: string; reference?: string; lines: Array<{ itemId: number; qtyMilli: number; unitPrice?: number; discountTzs?: number }>; vat: VatContext; actor: Actor; discountReason?: string };
/** Revenue goes through the normal sale transaction (paid now) or customer invoice (on credit), grouped by VAT treatment. Cost of goods sold is posted separately at weighted-average cost. */
export async function sellStock(input: SaleInput) {
  checkDate(input.date);
  if (!input.lines.length) throw new Error("Add at least one item to the sale.");
  const split = input.payments && input.payments.length > 1 ? input.payments : null;
  if (split && input.customerId) throw new Error("A sale on credit cannot also be split between payment methods.");
  if (!input.customerId && !input.paymentMethod && !split) throw new Error("Choose how the customer paid, or choose a customer to sell on credit.");
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const items = await getItems(tx, biz.id, input.lines.map(l => l.itemId));
    const recipes = await tx.select<Array<{ menu_item_id: number; ingredient_id: number; qty_milli: number }>>("SELECT menu_item_id,ingredient_id,qty_milli FROM recipe_lines");
    const ingredientIds = recipes.map(r => r.ingredient_id);
    const all = await getItems(tx, biz.id, [...input.lines.map(l => l.itemId), ...ingredientIds]);
    const groups = new Map<string, { account: string; treatment: ItemVat; includes: boolean; total: number; parts: string[] }>();
    const needs = new Map<number, number>();
    const recs: Array<{ it: Item; qty: number; amount: number; disc: number; key: string; uses: Map<number, number> }> = [];
    const costOf = new Map<number, number>(), groupNet = new Map<string, number>(), groupGrossActual = new Map<string, number>();
    for (const l of input.lines) {
      const it = need(items, l.itemId);
      if (!it.is_active) throw new Error(`${it.name} is switched off. Switch it on in Items to sell it.`);
      if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new Error(`Enter the quantity of ${it.name}.`);
      const price = l.unitPrice ?? it.price_tzs;
      if (!Number.isSafeInteger(price) || price <= 0) throw new Error(`${it.name} has no selling price. Set one in Items or type the price on the sale.`);
      const entered = lineAmount(l.qtyMilli, price), disc = l.discountTzs ?? 0;
      if (entered <= 0) throw new Error(`The amount for ${it.name} rounds to zero.`);
      if (!Number.isSafeInteger(disc) || disc < 0 || disc >= entered) throw new Error(`The discount on ${it.name} must be a whole amount smaller than the line.`);
      const amount = entered - disc; // every later figure (VAT, ledger, refunds) works from the discounted amount
      const treatment: ItemVat = input.vat.registered ? it.vat_treatment : "none";
      const includes = treatment === "standard" ? !!it.price_includes_vat : true;
      const account = it.kind === "service" ? "4100" : "4000", key = `${account}|${treatment}|${includes}`;
      const g = groups.get(key) ?? { account, treatment, includes, total: 0, parts: [] }; g.total += amount; g.parts.push(`${fmtQty(l.qtyMilli)} x ${it.name}`); groups.set(key, g);
      const uses = new Map<number, number>();
      if (it.kind === "stock") uses.set(it.id, l.qtyMilli);
      if (it.kind === "menu") for (const r of recipes.filter(r => r.menu_item_id === it.id)) uses.set(r.ingredient_id, Math.round((r.qty_milli * l.qtyMilli) / 1000));
      for (const [ing, q] of uses) needs.set(ing, (needs.get(ing) ?? 0) + q);
      recs.push({ it, qty: l.qtyMilli, amount, disc, key, uses });
    }
    const discTotal = recs.reduce((s, r) => s + r.disc, 0);
    if (discTotal > 0 && !(input.discountReason ?? "").trim()) throw new Error("A reason is required for a discount.");
    const ev = await newEvent(tx, biz.id, "sale", input.date, input.reference ?? "");
    let cogs = 0;
    for (const [id, qty] of needs) {
      const it = need(all, id);
      if (qty <= 0) continue;
      if (qty > it.qty_milli) throw new Error(`Not enough ${it.name} in stock: ${fmtQty(it.qty_milli)} ${it.unit} on hand, ${fmtQty(qty)} needed.`);
      const cost = issueValue(it.qty_milli, it.value_tzs, qty);
      await applyMove(tx, ev.id, it, -qty, -cost); cogs += cost; costOf.set(id, cost);
    }
    // What each group really costs the customer (VAT added on top for VAT-exclusive prices), worked out the same way the ledger does.
    const groupGross = new Map<string, number>();
    for (const [key, g] of groups) groupGross.set(key, g.treatment === "standard" ? vatFromEntered(g.total, input.vat.rate, g.includes).gross : g.total);
    if (split) { const bad = checkSplit(split, [...groupGross.values()].reduce((a, b) => a + b, 0)); if (bad) throw new Error(bad); }
    const docs: string[] = []; let revenue = 0, grossTotal = 0, vatTotal = 0;
    for (const [key, g] of groups) {
      const desc = `Sale ${ev.ref}: ${g.parts.join(", ")}`.slice(0, 190);
      let journalId: number;
      if (input.customerId) {
        const doc = await createDocument({ docType: "invoice", partyId: input.customerId, docDate: input.date, dueDate: input.dueDate || input.date, description: desc, amountTzs: g.total, vatRate: input.vat.rate, accountCode: g.account, vatTreatment: g.treatment, amountIncludesVat: g.includes }, tx);
        const row = (await tx.select<Array<{ journal_entry_id: number; net_tzs: number; vat_tzs: number; total_tzs: number }>>("SELECT journal_entry_id,net_tzs,vat_tzs,total_tzs FROM documents WHERE id=?", [doc.id]))[0];
        journalId = row.journal_entry_id; groupNet.set(key, row.net_tzs); docs.push(doc.number); grossTotal += row.total_tzs; vatTotal += row.vat_tzs; groupGrossActual.set(key, row.total_tzs);
      } else if (split) {
        // Split payment: the group's gross is shared across the payment methods; each part is posted as a VAT-inclusive receipt so every part balances.
        const parts = allocate(groupGross.get(key)!, split.map(p => p.amount));
        let net = 0, gsum = 0; journalId = 0;
        for (let k = 0; k < split.length; k++) {
          if (parts[k] <= 0) continue;
          const txId = await addTransactionWithJournal({ date: input.date, kind: "income", category: g.account === "4100" ? "Services" : "Sales", description: desc, amount: parts[k], payment_method: split[k].method, reference: ev.ref, vat_treatment: g.treatment, vat_rate: input.vat.rate, amount_includes_vat: true }, tx);
          journalId = await journalOfTransaction(tx, txId); await link(tx, ev.id, journalId);
          const row = (await tx.select<Array<{ amount: number; vat_tzs: number }>>("SELECT amount,vat_tzs FROM transactions WHERE id=?", [txId]))[0];
          net += row.amount - row.vat_tzs; gsum += row.amount; grossTotal += row.amount; vatTotal += row.vat_tzs;
        }
        groupNet.set(key, net); groupGrossActual.set(key, gsum);
      } else {
        const txId = await addTransactionWithJournal({ date: input.date, kind: "income", category: g.account === "4100" ? "Services" : "Sales", description: desc, amount: g.total, payment_method: input.paymentMethod!, reference: ev.ref, vat_treatment: g.treatment, vat_rate: input.vat.rate, amount_includes_vat: g.includes }, tx);
        journalId = await journalOfTransaction(tx, txId);
        const row = (await tx.select<Array<{ amount: number; vat_tzs: number }>>("SELECT amount,vat_tzs FROM transactions WHERE id=?", [txId]))[0];
        groupNet.set(key, row.amount - row.vat_tzs); grossTotal += row.amount; vatTotal += row.vat_tzs; groupGrossActual.set(key, row.amount);
      }
      await link(tx, ev.id, journalId);
      revenue += g.total;
    }
    // Per-item sales and cost, for the Sales by item report. Net sales are shared out of each group's real net amount; each ingredient's cost is shared across the lines that used it.
    const netShare = new Map<number, number>(), costShare = new Map<number, number>();
    for (const key of groups.keys()) { const idx = recs.map((r, i) => (r.key === key ? i : -1)).filter(i => i >= 0); allocate(groupNet.get(key) ?? 0, idx.map(i => recs[i].amount)).forEach((v, k) => netShare.set(idx[k], v)); }
    const grossShare = new Map<number, number>();
    for (const key of groups.keys()) { const idx = recs.map((r, i) => (r.key === key ? i : -1)).filter(i => i >= 0); allocate(groupGrossActual.get(key) ?? 0, idx.map(i => recs[i].amount)).forEach((v, k) => grossShare.set(idx[k], v)); }
    for (const [ing, cost] of costOf) { const idx = recs.map((r, i) => (r.uses.get(ing) ? i : -1)).filter(i => i >= 0); if (idx.length) allocate(cost, idx.map(i => recs[i].uses.get(ing)!)).forEach((v, k) => costShare.set(idx[k], (costShare.get(idx[k]) ?? 0) + v)); }
    for (let i = 0; i < recs.length; i++) { const gr = grossShare.get(i) ?? 0, nt = netShare.get(i) ?? 0; await tx.execute("INSERT INTO sale_lines(event_id,item_id,qty_milli,net_tzs,cost_tzs,gross_tzs,vat_tzs,discount_tzs) VALUES(?,?,?,?,?,?,?,?)", [ev.id, recs[i].it.id, recs[i].qty, nt, costShare.get(i) ?? 0, gr, Math.max(0, gr - nt), recs[i].disc]); }
    if (cogs > 0) {
      const j = await insertJournal({ date: input.date, description: `Cost of goods sold ${ev.ref}`, sourceType: "stock_cogs", sourceId: String(ev.id), lines: [{ accountCode: COGS, debitTzs: cogs, description: "Cost of goods sold" }, { accountCode: INVENTORY, creditTzs: cogs, description: "Stock sold" }] }, tx);
      await link(tx, ev.id, j.id);
    }
    const a = input.actor, reason = (input.discountReason ?? "").trim();
    await tx.execute("INSERT INTO sale_meta(event_id,user_id,approver_id,shift_id,discount_tzs,discount_reason) VALUES(?,?,?,?,?,?)", [ev.id, a.userId, a.approverId ?? null, a.shiftId ?? null, discTotal, discTotal > 0 ? reason : ""]);
    await recordAction(tx, { businessId: biz.id, kind: "sale", userId: a.userId, shiftId: a.shiftId, eventId: ev.id, amount: grossTotal });
    await queueFiscal(tx, biz.id, ev.id, { reference: ev.ref, date: input.date, vatRegistered: input.vat.registered, vatRatePercent: input.vat.rate, payment: input.customerId ? "credit" : split ? "split" : input.paymentMethod ?? "",
      totals: { net: grossTotal - vatTotal, vat: vatTotal, gross: grossTotal },
      lines: recs.map((r, i) => { const gr = grossShare.get(i) ?? 0, nt = netShare.get(i) ?? 0; return { item: r.it.name, code: r.it.code, qtyMilli: r.qty, discountTzs: r.disc, netTzs: nt, vatTzs: Math.max(0, gr - nt), grossTzs: gr, vatTreatment: r.it.vat_treatment }; }) });
    if (discTotal > 0) await recordAction(tx, { businessId: biz.id, kind: "discount", userId: a.userId, approverId: a.approverId, shiftId: a.shiftId, eventId: ev.id, amount: discTotal, reason });
    await audit(tx, "STOCK", ev.id, { kind: "sale", revenue, cogs, invoices: docs, by: a.userId, ...(discTotal > 0 ? { discount: discTotal, discountReason: reason, approvedBy: a.approverId ?? null } : {}) });
    return { eventId: ev.id, reference: ev.ref, total: grossTotal, cogs, invoices: docs, net: grossTotal - vatTotal, vat: vatTotal };
  });
}

// ---------- adjustments ----------
export type AdjustReason = "wastage" | "damage" | "count" | "own_use" | "other";
export const REASON_LABEL: Record<AdjustReason, string> = { wastage: "Wastage / spoilage", damage: "Damaged or expired", count: "Stock-take difference", own_use: "Used by the business / owner", other: "Other" };
/** qtyMilli < 0 takes stock out at average cost (Dr cost of goods sold or other expenses, Cr Inventory); qtyMilli > 0 adds stock (Dr Inventory, Cr cost of goods sold). */
export async function adjustStock(input: { date: string; itemId: number; qtyMilli: number; reason: AdjustReason; unitCost?: number; note?: string }) {
  checkDate(input.date);
  if (!Number.isSafeInteger(input.qtyMilli) || input.qtyMilli === 0) throw new Error("Enter how much stock to add or remove.");
  if (!(input.reason in REASON_LABEL)) throw new Error("Choose a reason.");
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const items = await getItems(tx, biz.id, [input.itemId]), it = need(items, input.itemId);
    if (it.kind !== "stock") throw new Error(`${it.name} is not a stock item.`);
    const ev = await newEvent(tx, biz.id, "adjustment", input.date, REASON_LABEL[input.reason], input.note ?? "");
    let value: number;
    if (input.qtyMilli < 0) {
      const q = -input.qtyMilli;
      if (q > it.qty_milli) throw new Error(`Not enough ${it.name} in stock: ${fmtQty(it.qty_milli)} ${it.unit} on hand.`);
      value = -issueValue(it.qty_milli, it.value_tzs, q);
    }
    else {
      if (input.unitCost !== undefined) value = lineAmount(input.qtyMilli, input.unitCost);
      else if (it.qty_milli > 0) value = mulDiv(it.value_tzs, input.qtyMilli, it.qty_milli);   // at the current average cost
      else throw new Error(`Enter the cost per ${it.unit} for the stock you are adding.`);
    }
    await applyMove(tx, ev.id, it, input.qtyMilli, value);
    const abs = Math.abs(value);
    if (abs > 0) {
      const expense = input.reason === "own_use" || input.reason === "other" ? "6900" : COGS;
      const lines = value < 0 ? [{ accountCode: expense, debitTzs: abs, description: REASON_LABEL[input.reason] }, { accountCode: INVENTORY, creditTzs: abs, description: it.name }]
        : [{ accountCode: INVENTORY, debitTzs: abs, description: it.name }, { accountCode: expense, creditTzs: abs, description: REASON_LABEL[input.reason] }];
      const j = await insertJournal({ date: input.date, description: `Stock adjustment ${ev.ref}: ${it.name} (${REASON_LABEL[input.reason]})`, sourceType: "stock_adjustment", sourceId: String(ev.id), lines }, tx);
      await link(tx, ev.id, j.id);
    }
    await audit(tx, "STOCK", ev.id, { kind: "adjustment", item: it.name, qtyMilli: input.qtyMilli, value, reason: input.reason });
    return { eventId: ev.id, reference: ev.ref, value };
  });
}

// ---------- undoing ----------
/** Reverses every ledger entry of a stock event and puts the stock back, all or nothing. */
export async function voidStockEvent(eventId: number, date: string, reason: string, actor: Actor) {
  checkDate(date);
  if (!reason.trim()) throw new Error("A reason is required.");
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const ev = (await tx.select<Array<{ id: number; kind: string; voided: number; event_date: string }>>("SELECT id,kind,voided,event_date FROM stock_events WHERE id=? AND business_id=?", [eventId, biz.id]))[0];
    if (!ev) throw new Error("Stock event not found.");
    if (ev.voided || ev.kind === "void") throw new Error("This stock event has already been reversed.");
    if (date < ev.event_date) throw new Error(`The reversal date cannot be before ${ev.event_date}.`);
    if (ev.kind === "sale") {
      const rets = await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM sale_returns r JOIN sale_lines l ON l.id=r.sale_line_id JOIN stock_events re ON re.id=r.return_event_id WHERE l.event_id=? AND re.voided=0", [eventId]);
      if ((rets[0]?.n ?? 0) > 0) throw new Error("Items from this sale have been returned. Reverse the return(s) on the Stock page first, then reverse the sale.");
    }
    const journals = await tx.select<Array<{ id: number; status: string }>>("SELECT j.id,j.status FROM stock_event_links l JOIN journal_entries j ON j.id=l.journal_entry_id WHERE l.event_id=? ORDER BY j.id DESC", [eventId]);
    for (const j of journals) if (j.status === "posted") await reverseJournalEntry(j.id, date, `${eventRef(eventId)}: ${reason.trim()}`, tx);
    const moves = await tx.select<Array<{ item_id: number; qty_milli: number; value_tzs: number }>>("SELECT item_id,qty_milli,value_tzs FROM stock_moves WHERE event_id=?", [eventId]);
    const items = await getItems(tx, biz.id, moves.map(m => m.item_id));
    const vev = await newEvent(tx, biz.id, "void", date, `Reverses ${eventRef(eventId)}`, reason);
    for (const m of moves) await applyMove(tx, vev.id, need(items, m.item_id), -m.qty_milli, -m.value_tzs);
    await tx.execute("UPDATE stock_events SET voided=1 WHERE id=?", [eventId]);
    const gross = ev.kind === "sale" ? Number((await tx.select<Array<{ g: number }>>("SELECT COALESCE(SUM(gross_tzs),0) g FROM sale_lines WHERE event_id=?", [eventId]))[0]?.g ?? 0) : 0;
    await recordAction(tx, { businessId: biz.id, kind: "void", userId: actor.userId, approverId: actor.approverId, shiftId: actor.shiftId, eventId, amount: gross, reason, detail: { eventKind: ev.kind, voidEvent: vev.ref } });
    await audit(tx, "STOCK", eventId, { kind: "void", reason: reason.trim(), voidEvent: vev.ref, by: actor.userId, approvedBy: actor.approverId ?? null });
    return { reference: vev.ref };
  });
}

// ---------- reading ----------
export type StockEventRow = { id: number; reference: string; kind: string; event_date: string; note: string; voided: number; lines: number; value: number; journals: string };
export async function listStockEvents(limit = 200): Promise<StockEventRow[]> {
  const d = await db(), biz = await getActiveBusiness();
  const rows = await d.select<Array<Omit<StockEventRow, "reference"> & { ref_text: string }>>(
    `SELECT e.id,e.kind,e.event_date,e.note,e.voided,e.reference ref_text,
      (SELECT COUNT(*) FROM stock_moves m WHERE m.event_id=e.id) lines,
      COALESCE((SELECT SUM(m.value_tzs) FROM stock_moves m WHERE m.event_id=e.id),0) value,
      COALESCE((SELECT GROUP_CONCAT(j.entry_number,', ') FROM stock_event_links l JOIN journal_entries j ON j.id=l.journal_entry_id WHERE l.event_id=e.id),'') journals
     FROM stock_events e WHERE e.business_id=? ORDER BY e.id DESC LIMIT ?`, [biz.id, limit]);
  return rows.map(r => ({ ...r, reference: eventRef(r.id) }));
}
export async function getEventMoves(eventId: number) {
  const d = await db();
  return d.select<Array<{ name: string; unit: string; qty_milli: number; value_tzs: number }>>("SELECT i.name,i.unit,m.qty_milli,m.value_tzs FROM stock_moves m JOIN items i ON i.id=m.item_id WHERE m.event_id=? ORDER BY m.id", [eventId]);
}

export type StockSummary = { items: Item[]; valuation: number; ledger: number; difference: number; low: Item[]; hasStock: boolean };
export async function getStockSummary(): Promise<StockSummary> {
  const d = await db(), all = await listItems(true), stock = all.filter(i => i.kind === "stock");
  const valuation = stock.reduce((s, i) => s + i.value_tzs, 0);
  const l = (await d.select<Array<{ b: number }>>(`SELECT COALESCE(SUM(l.debit_tzs-l.credit_tzs),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code=? AND j.status IN ('posted','reversed')`, [INVENTORY]))[0]?.b ?? 0;
  return { items: stock, valuation, ledger: Number(l), difference: valuation - Number(l), low: stock.filter(i => i.is_active && i.reorder_milli > 0 && i.qty_milli <= i.reorder_milli), hasStock: stock.some(i => i.qty_milli > 0 || i.value_tzs > 0) };
}

export async function stockChecks(): Promise<IntegrityCheck[]> {
  const d = await db(), biz = await getActiveBusiness(), out: IntegrityCheck[] = [];
  const itemCount = (await d.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM items WHERE business_id=? AND kind='stock'", [biz.id]))[0].n;
  if (!itemCount) return [{ name: "Stock records agree with the ledger", ok: true, detail: "No stock items yet." }];
  const s = await getStockSummary();
  out.push({ name: "Stock valuation agrees with Inventory (1200)", ok: s.difference === 0, detail: s.difference === 0 ? `Both total TZS ${s.valuation.toLocaleString("en-TZ")}.` : `Stock records TZS ${s.valuation.toLocaleString("en-TZ")} vs ledger TZS ${s.ledger.toLocaleString("en-TZ")}. Purchases, journals or adjustments posted to Inventory outside the Items module cause differences; enter opening stock "already in my books" or adjust stock to match a stock-take.` });
  const off = await d.select<Array<{ name: string }>>(`SELECT i.name FROM items i WHERE i.business_id=? AND (i.qty_milli<>COALESCE((SELECT SUM(m.qty_milli) FROM stock_moves m WHERE m.item_id=i.id),0) OR i.value_tzs<>COALESCE((SELECT SUM(m.value_tzs) FROM stock_moves m WHERE m.item_id=i.id),0))`, [biz.id]);
  out.push({ name: "Every item's stock equals its movements", ok: off.length === 0, detail: off.length ? `Out of step: ${off.slice(0, 5).map(o => o.name).join(", ")}` : "All items agree with their stock movements." });
  const bad = await d.select<Array<{ id: number }>>(`SELECT DISTINCT e.id FROM stock_events e JOIN stock_event_links l ON l.event_id=e.id JOIN journal_entries j ON j.id=l.journal_entry_id WHERE e.business_id=? AND e.voided=0 AND e.kind<>'void' AND j.status='reversed'`, [biz.id]);
  out.push({ name: "No stock event was reversed in the ledger only", ok: bad.length === 0, detail: bad.length ? `${bad.slice(0, 5).map(b => eventRef(b.id)).join(", ")}: a journal was reversed on the Journal entries page. Use Reverse on the Stock page for these events so the quantities are restored.` : "Every reversed sale or purchase also restored its stock." });
  return out;
}

// ---------- sales by item ----------
export type SalesByItemRow = { item_id: number; code: string; name: string; unit: string; kind: ItemKind; qty_milli: number; net_tzs: number; cost_tzs: number; profit_tzs: number; margin_pct: number | null };
/** Sales (before VAT), cost and profit per item for a period. Reversed sales are left out. Only sales recorded from v0.6.1 on are included. */
export async function getSalesByItem(from: string, to: string): Promise<SalesByItemRow[]> {
  const d = await db(), biz = await getActiveBusiness();
  const rows = await d.select<Array<Omit<SalesByItemRow, "profit_tzs" | "margin_pct">>>(
    `SELECT i.id item_id,i.code,i.name,i.unit,i.kind,SUM(l.qty_milli) qty_milli,SUM(l.net_tzs) net_tzs,SUM(l.cost_tzs) cost_tzs
     FROM sale_lines l JOIN stock_events e ON e.id=l.event_id JOIN items i ON i.id=l.item_id
     WHERE e.business_id=? AND e.kind='sale' AND e.voided=0 AND e.event_date>=? AND e.event_date<=? GROUP BY i.id ORDER BY SUM(l.net_tzs-l.cost_tzs) DESC`, [biz.id, from, to]);
  // Returns reduce sales in the period they were refunded.
  const rets = await d.select<Array<Omit<SalesByItemRow, "profit_tzs" | "margin_pct">>>(
    `SELECT i.id item_id,i.code,i.name,i.unit,i.kind,SUM(r.qty_milli) qty_milli,SUM(r.net_tzs) net_tzs,SUM(r.cost_tzs) cost_tzs
     FROM sale_returns r JOIN sale_lines l ON l.id=r.sale_line_id JOIN stock_events e ON e.id=r.return_event_id JOIN items i ON i.id=l.item_id
     WHERE e.business_id=? AND e.voided=0 AND e.event_date>=? AND e.event_date<=? GROUP BY i.id`, [biz.id, from, to]);
  for (const x of rets) {
    const row = rows.find(r => r.item_id === x.item_id);
    if (row) { row.qty_milli -= x.qty_milli; row.net_tzs -= x.net_tzs; row.cost_tzs -= x.cost_tzs; }
    else rows.push({ ...x, qty_milli: -x.qty_milli, net_tzs: -x.net_tzs, cost_tzs: -x.cost_tzs });
  }
  return rows.map(r => ({ ...r, profit_tzs: r.net_tzs - r.cost_tzs, margin_pct: r.net_tzs > 0 ? Math.round(((r.net_tzs - r.cost_tzs) / r.net_tzs) * 1000) / 10 : null }));
}


// ---------- refunds and returns ----------
export async function initialiseReturns() {
  const d = await db();
  const cols = await d.select<Array<{ name: string }>>("PRAGMA table_info(sale_lines)");
  if (!cols.some(c => c.name === "gross_tzs")) await d.execute("ALTER TABLE sale_lines ADD COLUMN gross_tzs INTEGER"); // NULL on sales made before v0.7.0
  if (!cols.some(c => c.name === "vat_tzs")) await d.execute("ALTER TABLE sale_lines ADD COLUMN vat_tzs INTEGER");
  if (!cols.some(c => c.name === "discount_tzs")) await d.execute("ALTER TABLE sale_lines ADD COLUMN discount_tzs INTEGER NOT NULL DEFAULT 0"); // v0.9.0: discount taken off this line (on the entered amount)
  await d.execute(`CREATE TABLE IF NOT EXISTS sale_returns(id INTEGER PRIMARY KEY AUTOINCREMENT,sale_line_id INTEGER NOT NULL REFERENCES sale_lines(id),return_event_id INTEGER NOT NULL REFERENCES stock_events(id),qty_milli INTEGER NOT NULL CHECK(qty_milli>0),gross_tzs INTEGER NOT NULL,net_tzs INTEGER NOT NULL,vat_tzs INTEGER NOT NULL,cost_tzs INTEGER NOT NULL,payment_method TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_sale_returns_line ON sale_returns(sale_line_id)");
}

export type SaleLineView = { id: number; item_id: number; name: string; unit: string; kind: ItemKind; qty_milli: number; gross: number | null; net: number; vat: number; cost: number; returned_milli: number };
export type SaleView = { event_id: number; ref: string; reference: string; date: string; gross: number | null; credit: boolean; lines: SaleLineView[] };

/** Recent sales (newest first) with what has already been returned, for the refund screen. */
export async function listRecentSales(limit = 40): Promise<SaleView[]> {
  const d = await db(), biz = await getActiveBusiness();
  const ev = await d.select<Array<{ id: number; event_date: string; reference: string; credit: number }>>(
    `SELECT e.id,e.event_date,e.reference,
       EXISTS(SELECT 1 FROM documents x JOIN stock_event_links l ON l.journal_entry_id=x.journal_entry_id WHERE l.event_id=e.id) credit
     FROM stock_events e WHERE e.business_id=? AND e.kind='sale' AND e.voided=0 ORDER BY e.id DESC LIMIT ?`, [biz.id, limit]);
  const out: SaleView[] = [];
  for (const e of ev) {
    const lines = await d.select<Array<{ id: number; item_id: number; name: string; unit: string; kind: ItemKind; qty_milli: number; gross_tzs: number | null; net_tzs: number; vat_tzs: number | null; cost_tzs: number; returned: number }>>(
      `SELECT l.id,l.item_id,i.name,i.unit,i.kind,l.qty_milli,l.gross_tzs,l.net_tzs,l.vat_tzs,l.cost_tzs,
         COALESCE((SELECT SUM(r.qty_milli) FROM sale_returns r JOIN stock_events re ON re.id=r.return_event_id WHERE r.sale_line_id=l.id AND re.voided=0),0) returned
       FROM sale_lines l JOIN items i ON i.id=l.item_id WHERE l.event_id=? ORDER BY l.id`, [e.id]);
    out.push({
      event_id: e.id, ref: eventRef(e.id), reference: e.reference, date: e.event_date, credit: !!e.credit,
      gross: lines.some(l => l.gross_tzs === null) ? null : lines.reduce((s, l) => s + Number(l.gross_tzs), 0),
      lines: lines.map(l => ({ id: l.id, item_id: l.item_id, name: l.name, unit: l.unit, kind: l.kind, qty_milli: l.qty_milli, gross: l.gross_tzs === null ? null : Number(l.gross_tzs), net: Number(l.net_tzs), vat: Number(l.vat_tzs ?? 0), cost: Number(l.cost_tzs), returned_milli: Number(l.returned) })),
    });
  }
  return out;
}

export type RefundInput = { eventId: number; date: string; paymentMethod: string; reason: string; lines: Array<{ lineId: number; qtyMilli: number }>; actor: Actor };
/**
 * Refunds returned items from a paid sale.
 * Ledger: Dr Sales (net) + Dr Output VAT, Cr cash/bank/mobile (gross); and for stock items Dr Inventory, Cr Cost of goods sold at the original cost.
 * Stock items go back on the shelf at their original cost. Menu items and services are refunded without restocking.
 */
export async function refundSale(input: RefundInput) {
  checkDate(input.date);
  if (!input.reason.trim()) throw new Error("A reason is required for a refund.");
  if (!["Cash", "Mobile money", "Bank", "Card"].includes(input.paymentMethod)) throw new Error("Choose how the refund is paid.");
  const asked = input.lines.filter(l => l.qtyMilli > 0);
  if (!asked.length) throw new Error("Enter the quantity to return on at least one line.");
  const biz = await getActiveBusiness();
  return withTransaction(async tx => {
    const ev = (await tx.select<Array<{ id: number; event_date: string; voided: number; kind: string }>>("SELECT id,event_date,voided,kind FROM stock_events WHERE id=? AND business_id=?", [input.eventId, biz.id]))[0];
    if (!ev || ev.kind !== "sale") throw new Error("Sale not found.");
    if (ev.voided) throw new Error("This sale has been reversed. There is nothing to refund.");
    if (input.date < ev.event_date) throw new Error(`The refund date cannot be before the sale date (${ev.event_date}).`);
    const credit = (await tx.select<Array<{ n: number }>>("SELECT COUNT(*) n FROM documents x JOIN stock_event_links l ON l.journal_entry_id=x.journal_entry_id WHERE l.event_id=?", [ev.id]))[0].n;
    if (credit > 0) throw new Error("This sale was on credit (invoiced). Refunding invoiced sales is not supported yet. Reverse the sale from the Stock page, or adjust the customer invoice.");
    const lines = await tx.select<Array<{ id: number; item_id: number; qty_milli: number; net_tzs: number; cost_tzs: number; gross_tzs: number | null; vat_tzs: number | null }>>("SELECT id,item_id,qty_milli,net_tzs,cost_tzs,gross_tzs,vat_tzs FROM sale_lines WHERE event_id=?", [ev.id]);
    const items = await getItems(tx, biz.id, lines.map(l => l.item_id));
    const byAccount = new Map<string, number>(); let gross = 0, vat = 0, stockCost = 0;
    const parts: Array<{ lineId: number; qty: number; gross: number; net: number; vat: number; cost: number; itemId: number }> = [];
    for (const a of asked) {
      const l = lines.find(x => x.id === a.lineId);
      if (!l) throw new Error("A selected line is not part of this sale.");
      if (l.gross_tzs === null) throw new Error("This sale was recorded before refunds were supported (no VAT breakdown was saved). Reverse the whole sale from the Stock page instead.");
      const it = need(items, l.item_id);
      const done = (await tx.select<Array<{ q: number; g: number; n: number; v: number; c: number }>>("SELECT COALESCE(SUM(r.qty_milli),0) q,COALESCE(SUM(r.gross_tzs),0) g,COALESCE(SUM(r.net_tzs),0) n,COALESCE(SUM(r.vat_tzs),0) v,COALESCE(SUM(r.cost_tzs),0) c FROM sale_returns r JOIN stock_events re ON re.id=r.return_event_id WHERE r.sale_line_id=? AND re.voided=0", [l.id]))[0];
      const sh = returnShare({ qty: l.qty_milli, gross: Number(l.gross_tzs), net: l.net_tzs, vat: Number(l.vat_tzs ?? 0), cost: l.cost_tzs }, { qty: Number(done.q), gross: Number(done.g), net: Number(done.n), vat: Number(done.v), cost: Number(done.c) }, a.qtyMilli);
      const cost = it.kind === "stock" ? sh.cost : 0;
      const account = it.kind === "service" ? "4100" : "4000";
      byAccount.set(account, (byAccount.get(account) ?? 0) + sh.net); gross += sh.gross; vat += sh.vat; stockCost += cost;
      parts.push({ lineId: l.id, qty: a.qtyMilli, gross: sh.gross, net: sh.net, vat: sh.vat, cost, itemId: it.id });
    }
    if (gross <= 0) throw new Error("The refund amount is zero.");
    const rev = await newEvent(tx, biz.id, "return", input.date, eventRef(ev.id), input.reason);
    const jl: Array<{ accountCode: string; debitTzs?: number; creditTzs?: number; description: string }> = [];
    for (const [account, net] of byAccount) if (net > 0) jl.push({ accountCode: account, debitTzs: net, description: `Refund ${eventRef(ev.id)}` });
    if (vat > 0) jl.push({ accountCode: VAT_PAYABLE, debitTzs: vat, description: "Output VAT reversed" });
    jl.push({ accountCode: cashAccountFor(input.paymentMethod), creditTzs: gross, description: `Refund paid by ${input.paymentMethod}` });
    const j = await insertJournal({ date: input.date, description: `Refund of sale ${eventRef(ev.id)}: ${input.reason.trim()}`.slice(0, 190), sourceType: "stock_return", sourceId: String(rev.id), lines: jl }, tx);
    await link(tx, rev.id, j.id);
    if (stockCost > 0) {
      const cj = await insertJournal({ date: input.date, description: `Returned stock ${rev.ref}`, sourceType: "stock_return_cogs", sourceId: String(rev.id), lines: [{ accountCode: INVENTORY, debitTzs: stockCost, description: "Stock returned" }, { accountCode: COGS, creditTzs: stockCost, description: "Cost of goods sold reversed" }] }, tx);
      await link(tx, rev.id, cj.id);
    }
    for (const p of parts) {
      const it = need(items, p.itemId);
      if (it.kind === "stock") await applyMove(tx, rev.id, it, p.qty, p.cost);
      await tx.execute("INSERT INTO sale_returns(sale_line_id,return_event_id,qty_milli,gross_tzs,net_tzs,vat_tzs,cost_tzs,payment_method,reason) VALUES(?,?,?,?,?,?,?,?,?)", [p.lineId, rev.id, p.qty, p.gross, p.net, p.vat, p.cost, input.paymentMethod, input.reason.trim()]);
    }
    const a = input.actor;
    await recordAction(tx, { businessId: biz.id, kind: "refund", userId: a.userId, approverId: a.approverId, shiftId: a.shiftId, eventId: rev.id, amount: gross, reason: input.reason, detail: { sale: eventRef(ev.id), method: input.paymentMethod } });
    await audit(tx, "STOCK", rev.id, { kind: "return", sale: eventRef(ev.id), gross, vat, stockCost, method: input.paymentMethod, reason: input.reason.trim(), by: a.userId, approvedBy: a.approverId ?? null });
    return { reference: rev.ref, gross, vat, entryNumber: j.entryNumber };
  });
}
