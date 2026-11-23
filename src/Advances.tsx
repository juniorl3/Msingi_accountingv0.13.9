import { useEffect, useMemo, useState } from "react";
import { HandCoins, Undo2 } from "lucide-react";
import { issueAdvance, listAdvances, openOnly, recordAdvanceRepayment } from "./advanceDb";
import type { Advance } from "./advanceDb";
import { listEmployees } from "./employeeDb";
import type { Employee } from "./employeeDb";
import { Modal } from "./ui";
import DateField from "./DateField";
import { localDate } from "./parties";

const METHODS = ["Bank", "Cash", "Mobile money"];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const whole = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(/,/g, "")));

export default function Advances({ money, onNotice, onChanged, refreshKey }: { money: (n: number) => string; onNotice: (m: string) => void; onChanged: () => Promise<void>; refreshKey: number }) {
  const [list, setList] = useState<Advance[]>([]), [staff, setStaff] = useState<Employee[]>([]), [filter, setFilter] = useState<"open" | "all">("open"), [busy, setBusy] = useState(false);
  const [giving, setGiving] = useState(false), [repaying, setRepaying] = useState<{ employeeId: number; name: string; owed: number } | null>(null);
  const [f, setF] = useState({ employeeId: "", date: localDate(), amount: "", monthly: "", method: "Cash", reason: "" });
  const [r, setR] = useState({ amount: "", date: localDate(), method: "Cash" });

  async function reload() { try { const [a, e] = await Promise.all([listAdvances(), listEmployees(true)]); setList(a); setStaff(e); } catch (e) { onNotice(msg(e)); } }
  useEffect(() => { reload(); }, [refreshKey]);

  const owedBy = useMemo(() => { const m = new Map<number, number>(); for (const a of openOnly(list)) m.set(a.employee_id, (m.get(a.employee_id) ?? 0) + a.outstanding); return m; }, [list]);
  const totalOwed = [...owedBy.values()].reduce((s, v) => s + v, 0);
  const visible = list.filter(a => filter === "all" || (a.status === "posted" && a.outstanding > 0));
  const chosen = staff.find(e => String(e.id) === f.employeeId);
  const amount = whole(f.amount), already = chosen ? owedBy.get(chosen.id) ?? 0 : 0;
  const warn = chosen && amount > 0 && chosen.gross_salary > 0 && already + amount > chosen.gross_salary ? `With this advance ${chosen.full_name} would owe ${money(already + amount)}, more than one month's gross salary (${money(chosen.gross_salary)}).` : "";

  async function give(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const res = await issueAdvance({ employeeId: Number(f.employeeId), date: f.date, amount, monthlyRecovery: whole(f.monthly), paymentMethod: f.method, reason: f.reason });
      onNotice(`Advance recorded as ${res.entryNumber}.`); setGiving(false); setF({ ...f, employeeId: "", amount: "", monthly: "", reason: "" }); await onChanged(); await reload();
    } catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }
  async function repay(e: React.FormEvent) {
    e.preventDefault(); if (!repaying) return; setBusy(true);
    try {
      const res = await recordAdvanceRepayment({ employeeId: repaying.employeeId, amount: whole(r.amount), date: r.date, paymentMethod: r.method });
      onNotice(`Repayment recorded as ${res.entryNumber}.`); setRepaying(null); await onChanged(); await reload();
    } catch (err) { onNotice(msg(err)); }
    setBusy(false);
  }

  return <>
    <section className="panel" style={{ marginBottom: 17 }}>
      <div className="panel-head"><div><h3>Salary advances</h3><p>Money paid to an employee before payday. It is recorded as an asset (account 1340) and recovered through payroll or repaid in cash. Total outstanding: <b>{money(totalOwed)}</b></p></div>
        <button className="primary" onClick={() => setGiving(true)}><HandCoins size={16} /> Give advance</button></div>
      <div className="table-actions wrap" style={{ marginBottom: 12 }}><label className="filter-date">Show <select value={filter} onChange={e => setFilter(e.target.value as "open" | "all")}><option value="open">Outstanding only</option><option value="all">All advances</option></select></label></div>
      <div className="table-wrap"><table><thead><tr><th>DATE</th><th>EMPLOYEE</th><th className="right">ADVANCE</th><th className="right">RECOVERED</th><th className="right">OUTSTANDING</th><th className="right">MONTHLY RECOVERY</th><th>STATUS</th><th></th></tr></thead><tbody>
        {visible.map(a => <tr key={a.id}>
          <td>{a.advance_date}</td><td className="description">{a.employee_no} · {a.full_name}{a.reason && <small style={{ display: "block", color: "#8995a3" }}>{a.reason}</small>}</td>
          <td className="right">{money(a.amount)}</td><td className="right">{money(a.recovered)}</td><td className="right"><b>{money(a.outstanding)}</b></td><td className="right">{a.monthly_recovery ? money(a.monthly_recovery) : "Set each month"}</td>
          <td>{a.status !== "posted" ? "Reversed" : a.outstanding === 0 ? "Fully recovered" : "Outstanding"}</td>
          <td>{a.status === "posted" && a.outstanding > 0 && <button className="secondary" onClick={() => { setRepaying({ employeeId: a.employee_id, name: a.full_name, owed: owedBy.get(a.employee_id) ?? 0 }); setR({ amount: "", date: localDate(), method: "Cash" }); }}><Undo2 size={14} /> Repayment</button>}</td></tr>)}
        {!visible.length && <tr><td colSpan={8} className="empty">{filter === "open" ? "No outstanding advances." : "No advances recorded."}</td></tr>}
      </tbody></table></div>
      <p style={{ fontSize: 11, color: "#8995a3", marginTop: 10 }}>To recover an advance from salary, select the employee in Payroll and the Advance recovery column is filled from the monthly recovery you set here. To cancel a mistaken advance, reverse its journal on the Journal entries page (reverse any repayments or recoveries first). Check with your accountant whether any interest-free staff loan has tax consequences, and make sure deductions from pay are agreed in writing with the employee.</p>
    </section>

    {giving && <Modal eyebrow="SALARY ADVANCE" title="Give advance" onClose={() => setGiving(false)}>
      <form onSubmit={give} className="stack-form" style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <label>Employee<select value={f.employeeId} onChange={e => setF({ ...f, employeeId: e.target.value })} required><option value="">Select employee</option>{staff.filter(e => e.status === "Active").map(e => <option key={e.id} value={e.id}>{e.employee_no} · {e.full_name}{owedBy.get(e.id) ? ` (owes ${money(owedBy.get(e.id)!)})` : ""}</option>)}</select></label>
        <label>Date<DateField type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required /></label>
        <label>Amount (TZS)<input inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} required /></label>
        <label>Recover per month (TZS) — optional<input inputMode="numeric" value={f.monthly} onChange={e => setF({ ...f, monthly: e.target.value })} placeholder="0 = decide each payroll" /></label>
        <label>Paid from<select value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Reason / note<input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></label>
        {warn && <p style={{ fontSize: 12, color: "#b7791f", margin: 0 }}>⚠ {warn}</p>}
        <div style={{ display: "flex", gap: 10 }}><button className="primary" disabled={busy}>{busy ? "Saving…" : "Record advance"}</button><button type="button" className="secondary" onClick={() => setGiving(false)}>Cancel</button></div>
      </form></Modal>}

    {repaying && <Modal eyebrow="ADVANCE REPAYMENT" title={`Repayment from ${repaying.name}`} onClose={() => setRepaying(null)}>
      <form onSubmit={repay} style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <p style={{ fontSize: 12, color: "#59697a", margin: 0 }}>Outstanding: <b>{money(repaying.owed)}</b>. Applied to the oldest advance first.</p>
        <label>Amount received (TZS)<input inputMode="numeric" value={r.amount} onChange={e => setR({ ...r, amount: e.target.value })} placeholder={String(repaying.owed)} required /></label>
        <label>Date<DateField type="date" value={r.date} onChange={e => setR({ ...r, date: e.target.value })} required /></label>
        <label>Received into<select value={r.method} onChange={e => setR({ ...r, method: e.target.value })}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
        <div style={{ display: "flex", gap: 10 }}><button className="primary" disabled={busy}>{busy ? "Saving…" : "Record repayment"}</button><button type="button" className="secondary" onClick={() => setRepaying(null)}>Cancel</button></div>
      </form></Modal>}
  </>;
}
