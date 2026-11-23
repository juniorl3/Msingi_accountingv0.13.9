import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Upload, Download } from "lucide-react";
import { deleteItemCategory, getRecipe, importItems, listItemCategories, listItems, openingStock, saveItem, saveItemCategory, setItemActive, setRecipe } from "./itemsDb";
import type { Item } from "./itemsDb";
import { IMPORT_TEMPLATE, KIND_LABEL, fmtQty, lineAmount, parseItemImport, toMilli } from "./itemsCalc";
import type { ImportRow, ItemKind, ItemVat } from "./itemsCalc";
import type { VatPrefs } from "./business";
import { localDate } from "./parties";
import { Modal, downloadCsv, downloadText, msg } from "./ui";
import DateField from "./DateField";

type Props = { money: (n: number) => string; onNotice: (m: string) => void; onChanged: () => Promise<void>; version: number; vatPrefs: VatPrefs };
const VAT_LABEL: Record<ItemVat, string> = { standard: "Standard rate", zero: "Zero-rated", exempt: "Exempt", none: "No VAT" };

export default function Items(p: Props) {
  const [items, setItems] = useState<Item[]>([]), [categories, setCategories] = useState<Array<{id:number;name:string}>>([]), [q, setQ] = useState(""), [inactive, setInactive] = useState(false), [kind, setKind] = useState("all"), [categoryFilter,setCategoryFilter] = useState("all");
  const [edit, setEdit] = useState<Item | "new" | null>(null), [importing, setImporting] = useState(false), [manageCategories,setManageCategories] = useState(false);
  const load = async () => { try { const [rows,cats] = await Promise.all([listItems(true),listItemCategories()]); setItems(rows); setCategories(cats); } catch(e) { p.onNotice(msg(e)); } };
  useEffect(() => { load(); }, [p.version]);
  const shown = useMemo(() => items.filter(i => (inactive || i.is_active) && (kind === "all" || i.kind === kind) && (categoryFilter === "all" || i.category === categoryFilter) && [i.code, i.name, i.barcode, i.category].join(" ").toLowerCase().includes(q.toLowerCase())), [items, q, inactive, kind, categoryFilter]);
  const avg = (i: Item) => (i.qty_milli > 0 ? Math.round((i.value_tzs / i.qty_milli) * 1000) : 0);
  const changed = async () => { await load(); await p.onChanged(); };
  function exportCsv() {
    downloadCsv(`msingi-items-${localDate()}.csv`, [["code", "name", "barcode", "category", "type", "unit", "price", "price_includes_vat", "vat", "reorder_level", "on_hand", "average_cost", "stock_value"],
      ...items.map(i => [i.code, i.name, i.barcode, i.category, i.kind, i.unit, i.price_tzs, i.price_includes_vat ? "yes" : "no", i.vat_treatment, i.reorder_milli / 1000 || "", i.kind === "stock" ? i.qty_milli / 1000 : "", i.kind === "stock" ? avg(i) : "", i.kind === "stock" ? i.value_tzs : ""])]);
  }
  return <section className="panel">
    <div className="panel-head"><div><h3>Items</h3><p>{items.filter(i => i.is_active).length} active · products you sell, services, and menu items</p></div>
      <div className="table-actions wrap" style={{ flexWrap: "wrap" }}>
        <div className="search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, code or barcode" /></div>
        <select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All types</option><option value="stock">Stock items</option><option value="service">Services</option><option value="menu">Menu items</option></select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="all">All categories</option>{categories.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select>
        <button className="secondary" onClick={() => setManageCategories(true)}>Manage categories</button>
        <label className="filter-date"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} /> Show switched off</label>
        <button className="secondary" onClick={() => setImporting(true)}><Upload size={15} /> Import</button>
        <button className="secondary" onClick={exportCsv} disabled={!items.length}><Download size={15} /> Export</button>
        <button className="primary" onClick={() => setEdit("new")}><Plus size={16} /> Add item</button></div></div>
    <div className="table-wrap"><table><thead><tr><th>CODE</th><th>ITEM</th><th>TYPE</th><th className="right">PRICE</th><th>VAT</th><th className="right">ON HAND</th><th className="right">AVG COST</th><th className="right">STOCK VALUE</th><th></th></tr></thead><tbody>
      {shown.map(i => <tr key={i.id} style={i.is_active ? undefined : { opacity: .55 }}>
        <td>{i.code}</td><td className="description">{i.name}{i.barcode && <small style={{ display: "block", fontWeight: 400, color: "#9aa5b2" }}>{i.barcode}</small>}</td>
        <td>{i.kind === "stock" ? "Stock" : i.kind === "service" ? "Service" : "Menu"}</td>
        <td className="right">{p.money(i.price_tzs)}{i.price_includes_vat && i.vat_treatment === "standard" && <small> incl. VAT</small>}</td>
        <td>{VAT_LABEL[i.vat_treatment]}</td>
        <td className="right">{i.kind === "stock" ? <span className={i.reorder_milli > 0 && i.qty_milli <= i.reorder_milli ? "red-text" : ""}>{fmtQty(i.qty_milli)} {i.unit}</span> : "—"}</td>
        <td className="right">{i.kind === "stock" && i.qty_milli > 0 ? p.money(avg(i)) : "—"}</td><td className="right">{i.kind === "stock" ? p.money(i.value_tzs) : "—"}</td>
        <td><button className="text-button journal-link" onClick={() => setEdit(i)}>Edit</button></td></tr>)}
      {!shown.length && <tr><td colSpan={9} className="empty">{items.length ? "No items match." : "No items yet. Add your first item, or import a list from a CSV file."}</td></tr>}
    </tbody></table></div>
    {edit && <ItemForm {...p} item={edit === "new" ? null : edit} allItems={items} categories={categories} onClose={() => setEdit(null)} changed={changed} />}
    {manageCategories && <CategoryModal categories={categories} onClose={() => setManageCategories(false)} onNotice={p.onNotice} changed={changed} />}
    {importing && <ImportModal {...p} onClose={() => setImporting(false)} changed={changed} />}
  </section>;
}

function ItemForm({ item, allItems, categories, onClose, onNotice, changed, vatPrefs, money }: Props & { item: Item | null; allItems: Item[]; categories: Array<{id:number;name:string}>; onClose: () => void; changed: () => Promise<void> }) {
  const [f, setF] = useState({ code: item?.code ?? "", name: item?.name ?? "", barcode: item?.barcode ?? "", category: item?.category ?? "", kind: (item?.kind ?? "stock") as ItemKind, unit: item?.unit ?? "piece",
    price: item ? String(item.price_tzs) : "", includes: item ? !!item.price_includes_vat : vatPrefs.amountIncludesVat, vat: (item?.vat_treatment ?? (vatPrefs.vatRegistered ? vatPrefs.docTreatment : "none")) as ItemVat, reorder: item && item.reorder_milli ? String(item.reorder_milli / 1000) : "", openQty: "", openCost: "", inBooks: false });
  const [recipe, setRecipeRows] = useState<Array<{ ingredientId: string; qty: string }>>([]), [busy, setBusy] = useState(false);
  useEffect(() => { if (item?.kind === "menu") getRecipe(item.id).then(r => setRecipeRows(r.map(x => ({ ingredientId: String(x.ingredientId), qty: String(x.qtyMilli / 1000) })))).catch(e => onNotice(msg(e))); }, []);
  const stockItems = allItems.filter(i => i.kind === "stock" && i.is_active);
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const price = Number(f.price.replace(/,/g, ""));
      const res = await saveItem({ code: f.code, barcode: f.barcode, name: f.name, category: f.category, kind: f.kind, unit: f.unit, price, priceIncludesVat: f.includes, vat: vatPrefs.vatRegistered ? f.vat : "none", reorderMilli: f.reorder.trim() ? toMilli(f.reorder) : 0 }, item?.id);
      if (f.kind === "menu") await setRecipe(res.id, recipe.filter(r => r.ingredientId && r.qty.trim()).map(r => ({ ingredientId: Number(r.ingredientId), qtyMilli: toMilli(r.qty) })));
      if (!item && f.kind === "stock" && f.openQty.trim()) await openingStock({ date: localDate(), postToLedger: !f.inBooks, lines: [{ itemId: res.id, qtyMilli: toMilli(f.openQty), unitCost: Number(f.openCost.replace(/,/g, "")) || 0 }] });
      onNotice(`${f.name.trim()} saved.`); await changed(); onClose();
    } catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  async function toggle() { if (!item) return; try { await setItemActive(item.id, !item.is_active); onNotice(item.is_active ? `${item.name} switched off. Its history is kept.` : `${item.name} switched on.`); await changed(); onClose(); } catch (err) { onNotice(msg(err)); } }
  const hasHistory = !!item && (item.qty_milli !== 0 || item.value_tzs !== 0);
  const openValue = (() => { try { return f.openQty.trim() ? lineAmount(toMilli(f.openQty), Number(f.openCost.replace(/,/g, "")) || 0) : 0; } catch { return 0; } })();
  return <Modal eyebrow={item ? "EDIT ITEM" : "NEW ITEM"} title={item ? item.name : "Add item"} onClose={onClose} wide>
    <form onSubmit={save}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <label>Item name<input value={f.name} onChange={e => set("name", e.target.value)} autoFocus /></label>
        <label>Code (your own short code)<input value={f.code} onChange={e => set("code", e.target.value)} /></label>
        <label>Type<select value={f.kind} onChange={e => set("kind", e.target.value)} disabled={hasHistory}>{(Object.keys(KIND_LABEL) as ItemKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        <label>Barcode (optional)<input value={f.barcode} onChange={e => set("barcode", e.target.value)} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} placeholder="Click here, then scan or type" autoComplete="off" /></label>
        <label>Unit<input value={f.unit} onChange={e => set("unit", e.target.value)} placeholder="piece, kg, litre, plate" /></label>
        <label>Category (optional)<select value={f.category} onChange={e => set("category", e.target.value)}><option value="">Uncategorised</option>{categories.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select></label>
        <label>Selling price (TZS)<input inputMode="numeric" value={f.price} onChange={e => set("price", e.target.value)} placeholder="0" /></label>
        {f.kind === "stock" && <label>Warn when stock falls to<input inputMode="decimal" value={f.reorder} onChange={e => set("reorder", e.target.value)} placeholder="optional" /></label>}
      </div>
      {vatPrefs.vatRegistered && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <label>VAT on sales<select value={f.vat} onChange={e => set("vat", e.target.value)}>{(Object.keys(VAT_LABEL) as ItemVat[]).map(v => <option key={v} value={v}>{VAT_LABEL[v]}{v === "standard" ? ` (${vatPrefs.rate}%)` : ""}</option>)}</select></label>
        {f.vat === "standard" && <label className="check-label"><input type="checkbox" checked={f.includes} onChange={e => set("includes", e.target.checked)} /><span><b>Price includes VAT</b><small>Untick if the price is before VAT and VAT is added on top.</small></span></label>}
      </div>}
      {f.kind === "menu" && <div className="vat-prefs-box"><h3>Recipe</h3><p>What one serving uses from stock. Each sale takes these ingredients out of stock at their average cost. Leave empty if you do not track ingredients.</p>
        {recipe.map((r, i) => <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
          <select value={r.ingredientId} onChange={e => setRecipeRows(recipe.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))} style={{ flex: 1 }}><option value="">Choose ingredient</option>{stockItems.map(s => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}</select>
          <input inputMode="decimal" value={r.qty} onChange={e => setRecipeRows(recipe.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} placeholder="Amount used" style={{ width: 120 }} />
          <button type="button" className="delete" onClick={() => setRecipeRows(recipe.filter((_, j) => j !== i))}>Remove</button></div>)}
        <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={() => setRecipeRows([...recipe, { ingredientId: "", qty: "" }])}><Plus size={15} /> Add ingredient</button></div>}
      {!item && f.kind === "stock" && <div className="vat-prefs-box"><h3>Opening stock (optional)</h3><p>What you already have on the shelf today.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}><label>Quantity<input inputMode="decimal" value={f.openQty} onChange={e => set("openQty", e.target.value)} /></label><label>Cost per {f.unit || "unit"} (TZS, before VAT)<input inputMode="decimal" value={f.openCost} onChange={e => set("openCost", e.target.value)} /></label></div>
        {f.openQty.trim() && <label className="check-label"><input type="checkbox" checked={f.inBooks} onChange={e => set("inBooks", e.target.checked)} /><span><b>This stock is already in my books</b><small>{f.inBooks ? "Nothing will be posted: use this if you already recorded this stock in the Inventory account." : `Msingi will post ${money(openValue)} to Inventory, with Owner Capital as the other side.`}</small></span></label>}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save item"}</button>
        {item && <button type="button" className="secondary" onClick={toggle}>{item.is_active ? "Switch off" : "Switch on"}</button>}</div>
    </form>
  </Modal>;
}

function CategoryModal({categories,onClose,onNotice,changed}:{categories:Array<{id:number;name:string}>;onClose:()=>void;onNotice:(m:string)=>void;changed:()=>Promise<void>}) {
  const [name,setName]=useState(""), [editing,setEditing]=useState<number|null>(null), [busy,setBusy]=useState(false);
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);try{await saveItemCategory(name,editing??undefined);onNotice(editing?"Category updated.":"Category added.");setName("");setEditing(null);await changed();}catch(err){onNotice(msg(err));}setBusy(false);}
  async function remove(id:number,label:string){if(!window.confirm(`Delete category “${label}”?`))return;try{await deleteItemCategory(id);onNotice("Category deleted.");await changed();}catch(err){onNotice(msg(err));}}
  return <Modal eyebrow="PRODUCT SETUP" title="Manage categories" onClose={onClose}>
    <form onSubmit={save}><label>Category name<input value={name} onChange={e=>setName(e.target.value)} maxLength={60} placeholder="e.g. Beverages" required /></label><div style={{display:"flex",gap:8,marginTop:10}}><button className="primary" disabled={busy}>{busy?"Saving…":editing?"Update category":"Add category"}</button>{editing!==null&&<button type="button" className="secondary" onClick={()=>{setEditing(null);setName("")}}>Cancel</button>}</div></form>
    <div className="table-wrap" style={{marginTop:18}}><table><thead><tr><th>CATEGORY</th><th></th></tr></thead><tbody>{categories.map(c=><tr key={c.id}><td>{c.name}</td><td style={{whiteSpace:"nowrap"}}><button className="text-button" onClick={()=>{setEditing(c.id);setName(c.name)}}>Rename</button> <button className="text-button" onClick={()=>remove(c.id,c.name)}>Delete</button></td></tr>)}{!categories.length&&<tr><td colSpan={2} className="empty">No categories yet. Add your first category above.</td></tr>}</tbody></table></div>
    <p style={{fontSize:12,color:"#64748b"}}>Renaming a category updates the category on its existing items. A category cannot be deleted while items still use it.</p>
  </Modal>;
}

function ImportModal({ onClose, onNotice, changed, money }: Props & { onClose: () => void; changed: () => Promise<void> }) {
  const [parsed, setParsed] = useState<{ rows: ImportRow[]; errors: string[] } | null>(null), [file, setFile] = useState(""), [date, setDate] = useState(localDate()), [inBooks, setInBooks] = useState(false), [busy, setBusy] = useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; setFile(f.name); try { setParsed(parseItemImport(await f.text())); } catch (err) { onNotice(msg(err)); } }
  const withOpening = parsed?.rows.filter(r => r.openingMilli > 0) ?? [];
  const openingTotal = withOpening.reduce((s, r) => s + lineAmount(r.openingMilli, r.openingUnitCost), 0);
  async function go() {
    if (!parsed || parsed.errors.length || !parsed.rows.length) return;
    setBusy(true);
    try { const r = await importItems(parsed.rows, { date, postToLedger: !inBooks }); onNotice(`Imported: ${r.created} new, ${r.updated} updated${r.opening ? `, opening stock for ${r.opening} item(s) worth ${money(r.openingTotal)}` : ""}.`); await changed(); onClose(); }
    catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  return <Modal eyebrow="IMPORT" title="Import items from a file" onClose={onClose} wide>
    <p style={{ fontSize: 12, color: "#59697a", lineHeight: 1.5 }}>Use a CSV file with one item per row. In Excel, choose File → Save As → CSV. Rows whose code already exists are updated. Nothing is saved unless every row is valid.</p>
    <button type="button" className="secondary" onClick={() => downloadText("msingi-items-template.csv", IMPORT_TEMPLATE)}><Download size={15} /> Download template</button>
    <label>Choose your file<input type="file" accept=".csv,.txt,text/csv" onChange={pick} /></label>
    {parsed && parsed.errors.length > 0 && <div className="note" style={{ borderColor: "#f1d3ce", background: "#fff7f5" }}><b style={{ color: "#b54d42" }}>{parsed.errors.length} problem(s) in {file}. Fix them and choose the file again.</b>{parsed.errors.slice(0, 12).map((x, i) => <span key={i}>{x}</span>)}{parsed.errors.length > 12 && <span>…and {parsed.errors.length - 12} more.</span>}</div>}
    {parsed && !parsed.errors.length && <>
      <div className="note"><b>{parsed.rows.length} item(s) ready to import</b><span>{parsed.rows.filter(r => r.kind === "stock").length} stock · {parsed.rows.filter(r => r.kind === "service").length} services · {parsed.rows.filter(r => r.kind === "menu").length} menu{withOpening.length ? ` · opening stock for ${withOpening.length} item(s) worth ${money(openingTotal)}` : ""}</span></div>
      {withOpening.length > 0 && <><label>Opening stock date<DateField type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="check-label"><input type="checkbox" checked={inBooks} onChange={e => setInBooks(e.target.checked)} /><span><b>This stock is already in my books</b><small>{inBooks ? "Nothing will be posted to the ledger." : `Msingi will post ${money(openingTotal)} to Inventory, with Owner Capital as the other side.`}</small></span></label></>}
      <button type="button" className="primary submit" disabled={busy} onClick={go}>{busy ? "Importing…" : "Import items"}</button></>}
  </Modal>;
}
