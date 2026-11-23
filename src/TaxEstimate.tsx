import { useEffect, useMemo, useState } from "react";
import { getIncomeStatement } from "./ledger";
import { getOtherTaxes } from "./taxRatesDb";
import { estimateTaxes, whtOn } from "./taxRatesCalc";
import type { IncomeStatement } from "./ledger";
import type { OtherTaxes } from "./taxRatesCalc";
import { localDate } from "./parties";
import DateField from "./DateField";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function TaxEstimate({ money, onNotice, version }: { money: (n: number) => string; onNotice: (m: string) => void; version: number }) {
  const [from, setFrom] = useState(`${localDate().slice(0, 4)}-01-01`), [to, setTo] = useState(localDate());
  const [stmt, setStmt] = useState<IncomeStatement | null>(null), [rates, setRates] = useState<OtherTaxes | null>(null);
  const [whtKey, setWhtKey] = useState(""), [amount, setAmount] = useState("");
  useEffect(() => { Promise.all([getIncomeStatement(from, to), getOtherTaxes()]).then(([s, r]) => { setStmt(s); setRates(r); setWhtKey(k => k || r.wht[0]?.key || ""); }).catch(e => onNotice(msg(e))); }, [from, to, version]);
  const est = useMemo(() => (stmt && rates ? estimateTaxes(stmt.totalIncome, stmt.netProfit, rates) : null), [stmt, rates]);
  const wht = useMemo(() => {
    const rate = rates?.wht.find(w => w.key === whtKey); const a = Number(amount.replace(/,/g, ""));
    if (!rate || !amount.trim()) return null;
    try { return { rate, ...whtOn(a, rate.pct), error: "" }; } catch (e) { return { rate, withheld: 0, netPayable: 0, error: msg(e) }; }
  }, [rates, whtKey, amount]);

  return <>
    <div className="note" style={{ marginTop: 0, marginBottom: 17 }}><b>Estimates only, not a tax return</b><span>These use your ledger and the rates in Settings → Tax rates. Taxable profit differs from accounting profit (disallowed expenses, capital allowances, losses brought forward), so have a tax adviser confirm before you file or pay.</span></div>
    <section className="panel" style={{ marginBottom: 17 }}>
      <div className="panel-head"><div><h3>Tax estimate</h3><p>From your income statement for the period</p></div>
        <div className="table-actions"><label className="filter-date">From <DateField type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label className="filter-date">To <DateField type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div></div>
      {stmt && rates && est && <>
        <div className="stmt-row"><span>Total income (turnover)</span><b>{money(stmt.totalIncome)}</b></div>
        <div className="stmt-row"><span>Total expenses</span><b>{money(stmt.totalExpenses)}</b></div>
        <div className="stmt-row"><span>Accounting profit</span><b>{money(stmt.netProfit)}</b></div>
        <div className="stmt-row"><span>Corporate income tax at {rates.corporatePct}% of profit</span><b>{money(est.corporate)}</b></div>
        <div className="stmt-row"><span>Turnover tax at {rates.turnoverPct}% of turnover (instead of income tax, resident individuals)</span><b>{est.turnoverTax === null ? "Not applicable" : money(est.turnoverTax)}</b></div>
        <div className="stmt-row muted"><span>{est.turnoverNote}</span><span /></div>
        <div className="stmt-row"><span>Local service levy at {rates.levyPct}% of turnover</span><b>{money(est.levy)}</b></div>
      </>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h3>Withholding tax calculator</h3><p>Work out what to withhold from a payment to a resident supplier or landlord. Withholding is not posted automatically in this version.</p></div></div>
      <div className="table-actions" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="filter-date">Payment type <select value={whtKey} onChange={e => setWhtKey(e.target.value)}>{rates?.wht.map(w => <option key={w.key} value={w.key}>{w.label} ({w.pct}%)</option>)}</select></label>
        <label className="filter-date">Amount before withholding (TZS) <input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 150 }} /></label>
      </div>
      {wht && (wht.error ? <p className="red-text" style={{ fontSize: 12, marginTop: 12 }}>{wht.error}</p> : <div style={{ marginTop: 12 }}>
        <div className="stmt-row"><span>Withhold {wht.rate.pct}% and pay to the authority</span><b>{money(wht.withheld)}</b></div>
        <div className="stmt-row"><span>Pay the supplier</span><b>{money(wht.netPayable)}</b></div></div>)}
    </section>
  </>;
}
