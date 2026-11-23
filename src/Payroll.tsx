import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { getPayrollLiabilities, getPayrollRates, listPayrollRuns, postPayrollRun, remitPayrollTax } from "./payrollDb";
import type { PayrollRun } from "./payrollDb";
import { computePayroll, pct, payeOn } from "./payrollCalc";
import type { PayrollRates } from "./payrollCalc";
import { localDate } from "./parties";
import { Confirm } from "./ui";
import { listEmployees } from "./employeeDb";
import { listAdvances, openOnly } from "./advanceDb";
import type { Advance } from "./advanceDb";
import { suggestedRecovery } from "./advanceRules";
import type { Employee } from "./employeeDb";
import { payrollProblem, proratingWarning, prorateDays, prorateGross } from "./employeeRules";
import DateField from "./DateField";

/** Scheduled advance recovery for an employee's gross pay: instalments set on their advances, capped at what is owed and at take-home pay. */
function scheduledRecovery(employeeId: number, gross: number, rates: PayrollRates | null, adv: Advance[]): number {
  if (!rates || !Number.isSafeInteger(gross) || gross <= 0) return 0;
  const ss = pct(gross, rates.employeeSsPct), take = gross - ss - payeOn(gross - ss, rates.bands);
  return suggestedRecovery(openOnly(adv.filter(a => a.employee_id === employeeId)), take);
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const METHODS = ["Bank", "Cash", "Mobile money"];
type Row = { employeeId: string; gross: string; advance: string };
type Liab = Awaited<ReturnType<typeof getPayrollLiabilities>>;

export default function Payroll({ money, onNotice, onChanged, version }: { money: (n: number) => string; onNotice: (m: string) => void; onChanged: () => Promise<void>; version: number }) {
  const [rates, setRates] = useState<PayrollRates | null>(null), [runs, setRuns] = useState<PayrollRun[]>([]), [liab, setLiab] = useState<Liab>([]);
  const [rows, setRows] = useState<Row[]>([{ employeeId: "", gross: "", advance: "" }]),[staffAll,setStaffAll]=useState<Employee[]>([]),[advances,setAdvances]=useState<Advance[]>([]), [period, setPeriod] = useState(localDate().slice(0, 7)), [payDate, setPayDate] = useState(localDate()), [method, setMethod] = useState("Bank");
  const [dup, setDup] = useState<string | null>(null), [busy, setBusy] = useState(false), [open, setOpen] = useState<number | null>(null);
  const [remit, setRemit] = useState({ code: "2120", amount: "", date: localDate(), method: "Bank" });

  async function reload(prefill = false) {
    try {
      const [r, list, l, staff, adv] = await Promise.all([getPayrollRates(), listPayrollRuns(), getPayrollLiabilities(), listEmployees(true), listAdvances()]);
      setRates(r); setRuns(list); setLiab(l); setStaffAll(staff); setAdvances(adv);
      if (prefill && list[0]) setRows(list[0].lines.map(x => { const match=(x.employeeId!==undefined?staff.find(e=>e.id===x.employeeId):undefined)??staff.filter(e=>e.full_name===x.name).filter((_,__,a)=>a.length===1)[0]; return { employeeId:match?String(match.id):"", gross:String(match?match.gross_salary:x.gross), advance:(()=>{const sc=match?scheduledRecovery(match.id,match.gross_salary,r,adv):0;return sc?String(sc):"";})() }; }));
    } catch (e) { onNotice(msg(e)); }
  }
  useEffect(() => { reload(true); }, []);
  useEffect(() => { reload(); }, [version]);

  const employees = useMemo(() => staffAll.filter(e => !payrollProblem(e, period)), [staffAll, period]);
  const preview = useMemo(() => {
    if (!rates) return { error: "", result: null as ReturnType<typeof computePayroll> | null };
    const filled = rows.filter(r => r.employeeId || r.gross.trim());
    if (!filled.length) return { error: "", result: null };
    try { return { error: "", result: computePayroll(filled.map(r => { const employee=employees.find(e=>String(e.id)===r.employeeId); if(!employee) throw new Error("Select a registered active employee for every payroll line."); return { employeeId:employee.id, name:employee.full_name, gross:Number(r.gross.replace(/,/g,"")), advance:r.advance.trim()===""?0:Number(r.advance.replace(/,/g,"")) }; }), rates) }; }
    catch (e) { return { error: msg(e), result: null }; }
  }, [rows, rates, employees]);
  useEffect(() => { setRows(rs => rs.map(r => r.employeeId && !employees.some(e => String(e.id) === r.employeeId) ? { employeeId: "", gross: "", advance: "" } : r)); }, [employees]);

  async function post(allowDuplicate = false) {
    if (!preview.result) return;
    setBusy(true);
    try {
      const filled = rows.filter(r => r.employeeId || r.gross.trim());
      if(filled.some(x=>!employees.some(e=>String(e.id)===x.employeeId))) throw new Error("Every payroll line must use an eligible registered employee for the selected month.");
      if(new Set(filled.map(x=>x.employeeId)).size!==filled.length) throw new Error("An employee can appear only once in a payroll run.");
      const r = await postPayrollRun({ period, payDate, paymentMethod: method, employees: filled.map(x => ({ employeeId:employees.find(e=>String(e.id)===x.employeeId)!.id, name: employees.find(e=>String(e.id)===x.employeeId)!.full_name, gross: Number(x.gross.replace(/,/g, "")), advance: x.advance.trim()===""?0:Number(x.advance.replace(/,/g, "")) })), allowDuplicate });
      onNotice(`Payroll for ${period} posted as ${r.entryNumber}. Net pay ${money(r.totals.net)}.`); await onChanged(); await reload();
    } catch (e) {
      const m = msg(e);
      if (/already been posted/.test(m)) { setDup(m); setBusy(false); return; }
      onNotice(m);
    }
    setBusy(false);
  }
  async function doRemit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const j = await remitPayrollTax({ code: remit.code, amount: Number(remit.amount.replace(/,/g, "")), date: remit.date, paymentMethod: remit.method }); onNotice(`Payment posted as ${j.entryNumber}.`); setRemit({ ...remit, amount: "" }); await onChanged(); await reload(); }
    catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  const setRow = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const openFor = (id: number) => openOnly(advances.filter(a => a.employee_id === id));
  const owedFor = (id: number) => openFor(id).reduce((s, a) => s + a.outstanding, 0);
  const chooseEmployee=(i:number,id:string)=>{const emp=employees.find(e=>String(e.id)===id);const sched=emp?scheduledRecovery(emp.id,emp.gross_salary,rates,advances):0;setRows(rows.map((r,j)=>j===i?{...r,employeeId:id,gross:emp?String(emp.gross_salary):r.gross,advance:sched?String(sched):""}:r));};
  const t = preview.result?.totals;
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

  return <>
    {dup && <Confirm title="Post this month again?" message={dup + " Post it again as an additional run?"} yes="Post again" onNo={() => setDup(null)} onYes={() => { setDup(null); post(true); }} />}
    <div className="note" style={{ marginTop: 0, marginBottom: 17 }}><b>Check these rates before you rely on them</b>
      <span>Defaults for {rates?.ssName ?? "…"} were last checked on {rates?.verifiedOn ?? "…"} against TRA and published payroll guides. Zanzibar employers should confirm with ZRB and ZSSF; the Zanzibar SDL rate in particular is reported differently by different sources. You can edit every rate in Settings → Tax rates.</span></div>

    <section className="panel" style={{ marginBottom: 17 }}>
      <div className="panel-head"><div><h3>Run payroll</h3><p>Select registered employees. Their saved monthly gross salary is prefilled and can be adjusted for the selected pay period. Listed: monthly-paid employees who are active, plus those who left during or after the selected month (for a final salary). Anyone who starts after the month ends is not listed. Msingi calculates PAYE, social security, SDL and WCF and posts one journal.</p></div></div>
      <div className="table-actions wrap" style={{ gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <label className="filter-date">Payroll month <DateField type="month" value={period} onChange={e => setPeriod(e.target.value)} /></label>
        <label className="filter-date">Pay date <DateField type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></label>
        <label className="filter-date">Net pay from <select value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
      </div>
      <div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th className="right">GROSS PAY</th><th className="right">SOCIAL SECURITY</th><th className="right">PAYE</th><th className="right">ADVANCE RECOVERY</th><th className="right">NET PAY</th><th></th></tr></thead><tbody>
        {rows.map((r, i) => { const calc = preview.result?.lines.find((_, k) => k === rows.filter(x => x.employeeId || x.gross.trim()).indexOf(r));
          return <tr key={i}>
            <td><select value={r.employeeId} onChange={e=>chooseEmployee(i,e.target.value)} style={{minWidth:210}}><option value="">Select registered employee</option>{employees.map(emp=><option key={emp.id} value={emp.id}>{emp.employee_no} · {emp.full_name}</option>)}</select>{r.employeeId&&owedFor(Number(r.employeeId))>0&&<small style={{display:"block",color:"#b7791f"}}>Owes {money(owedFor(Number(r.employeeId)))} in advances</small>}</td>
            <td className="right"><input inputMode="numeric" value={r.gross} onChange={e => setRow(i, "gross", e.target.value)} placeholder="0" style={{ width: 130, textAlign: "right" }} /></td>
            <td className="right">{calc ? money(calc.employeeSs) : "—"}</td><td className="right">{calc ? money(calc.paye) : "—"}</td><td className="right"><input inputMode="numeric" value={r.advance} onChange={e => setRow(i, "advance", e.target.value)} placeholder="0" disabled={!r.employeeId||owedFor(Number(r.employeeId))===0} style={{ width: 110, textAlign: "right" }} /></td><td className="right"><b>{calc ? money(calc.net) : "—"}</b></td>
            <td><button type="button" className="delete" title="Remove" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ employeeId: "", gross: "", advance: "" }])}><Trash2 size={15} /></button></td></tr>; })}
      </tbody></table></div>
      <button type="button" className="secondary" style={{ marginTop: 12 }} onClick={() => setRows([...rows, { employeeId: "", gross: "", advance: "" }])}><Plus size={15} /> Add employee</button>
      {rows.map((r,i)=>{const e=staffAll.find(x=>String(x.id)===r.employeeId);if(!e)return null;const w=proratingWarning(e,period);if(!w)return null;const pd=prorateDays(e,period);const amt=pd?prorateGross(e.gross_salary,pd.days,pd.of):0;
        return <p key={i} style={{marginTop:8,fontSize:12,color:"#b7791f"}}>⚠ {w} {pd&&<button type="button" className="secondary" style={{marginLeft:6}} onClick={()=>setRow(i,"gross",String(amt))}>Prorate to {pd.days}/{pd.of} days = {money(amt)}</button>}</p>;})}
      {!employees.length&&<p className="red-text" style={{marginTop:10}}>No payable employees found for this month. Register monthly-paid employees in the Employees section first.</p>}
      {preview.error && <p className="red-text" style={{ marginTop: 12, fontSize: 12 }}>{preview.error}</p>}
      {t && <div style={{ marginTop: 16 }}>
        <div className="stmt-row"><span>Gross salaries (expense)</span><b>{money(t.gross)}</b></div>
        <div className="stmt-row"><span>Employer social security ({rates?.ssName}, {rates?.employerSsPct}%)</span><b>{money(t.employerSs)}</b></div>
        <div className="stmt-row"><span>SDL ({rates?.sdlPct}%){t.sdlApplies ? "" : ` — not charged: fewer than ${rates?.sdlMinEmployees} employees`}</span><b>{money(t.sdl)}</b></div>
        <div className="stmt-row"><span>WCF ({rates?.wcfPct}%){rates?.wcfApplies ? "" : " — switched off"}</span><b>{money(t.wcf)}</b></div>
        <div className="stmt-row"><span><b>Total cost to the business</b></span><b>{money(t.employerCost)}</b></div>
        <div className="stmt-row"><span>Owed to TRA/ZRB: PAYE {money(t.paye)} · SDL {money(t.sdl)}. Owed to {rates?.ssName}: {money(t.employeeSs + t.employerSs)} · WCF {money(t.wcf)}</span><span /></div>
        {!!t.advance&&<div className="stmt-row"><span>Salary advances recovered from pay (reduces net pay)</span><b>{money(t.advance)}</b></div>}
        <div className="stmt-row"><span><b>Net pay to employees, paid from {method}</b></span><b>{money(t.net)}</b></div>
      </div>}
      <button className="primary submit" style={{ maxWidth: 260 }} disabled={busy || !preview.result} onClick={() => post()}>{busy ? "Posting…" : "Post payroll"}</button>
    </section>

    <section className="panel" style={{ marginBottom: 17 }}>
      <div className="panel-head"><div><h3>Owed to authorities</h3><p>Payroll taxes and contributions you have withheld or incurred and not yet paid over</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>WHAT</th><th>PAID TO</th><th className="right">STILL OWED</th></tr></thead><tbody>
        {liab.map(l => <tr key={l.code}><td className="description">{l.label}</td><td>{l.authority}</td><td className="right">{money(l.balance)}</td></tr>)}
      </tbody></table></div>
      <form className="table-actions wrap" style={{ gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "flex-end" }} onSubmit={doRemit}>
        <label className="filter-date">Pay <select value={remit.code} onChange={e => { const l = liab.find(x => x.code === e.target.value); setRemit({ ...remit, code: e.target.value, amount: l && l.balance > 0 ? String(l.balance) : "" }); }}>{liab.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select></label>
        <label className="filter-date">Amount (TZS) <input inputMode="numeric" value={remit.amount} onChange={e => setRemit({ ...remit, amount: e.target.value })} style={{ width: 130 }} /></label>
        <label className="filter-date">Date <DateField type="date" value={remit.date} onChange={e => setRemit({ ...remit, date: e.target.value })} /></label>
        <label className="filter-date">From <select value={remit.method} onChange={e => setRemit({ ...remit, method: e.target.value })}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
        <button className="secondary" disabled={busy || !(num(remit.amount) > 0)}>Record payment</button>
      </form>
      <p style={{ fontSize: 11, color: "#8995a3", marginTop: 10 }}>PAYE and SDL are due by the 7th of the month after payroll. Check the due dates for {rates?.ssName}, WCF and Zanzibar with the authority.</p>
    </section>

    <section className="panel" style={{ marginBottom: 17 }}>
      <div className="panel-head"><div><h3>Payroll runs</h3><p>{runs.length} run(s) posted. To undo one, reverse its journal on the Journal entries page.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>MONTH</th><th>JOURNAL</th><th>PAY DATE</th><th className="right">EMPLOYEES</th><th className="right">GROSS</th><th className="right">PAYE</th><th className="right">NET PAY</th><th>STATUS</th></tr></thead><tbody>
        {runs.map(r => <Fragment key={r.id}>
          <tr key={r.id}><td><button className="text-button journal-link" onClick={() => setOpen(open === r.id ? null : r.id)}>{r.period}</button></td><td>{r.entry_number}</td><td>{r.pay_date}</td><td className="right">{r.lines.length}</td><td className="right">{money(r.totals.gross)}</td><td className="right">{money(r.totals.paye)}</td><td className="right">{money(r.totals.net)}</td><td>{r.status === "posted" ? "Posted" : "Reversed"}</td></tr>
          {open === r.id && r.lines.map((l, i) => <tr key={r.id + "-" + i}><td colSpan={2} style={{ paddingLeft: 28 }}>{l.name}</td><td></td><td></td><td className="right">{money(l.gross)}</td><td className="right">{money(l.paye)}</td><td className="right">{money(l.net)}</td><td>SS {money(l.employeeSs)}{l.advance?` · Adv ${money(l.advance)}`:""}</td></tr>)}
        </Fragment>)}
        {!runs.length && <tr><td colSpan={8} className="empty">No payroll posted yet.</td></tr>}
      </tbody></table></div>
    </section>

    <div className="note" style={{ marginTop: 0 }}><b>Payroll rates</b><span>{rates ? `${rates.ssName}: employee ${rates.employeeSsPct}%, employer ${rates.employerSsPct}% · SDL ${rates.sdlPct}% · WCF ${rates.wcfPct}% · ${rates.bands.length} PAYE bands. ` : ""}To change any rate, go to Settings → Tax rates.</span></div>
  </>;
}
