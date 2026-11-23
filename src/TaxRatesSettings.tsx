import { useEffect, useState } from "react";
import { getPayrollRates, resetPayrollRates, savePayrollRates } from "./payrollDb";
import { getOtherTaxes, resetOtherTaxes, saveOtherTaxes } from "./taxRatesDb";
import type { PayrollRates } from "./payrollCalc";
import type { OtherTaxes } from "./taxRatesCalc";
import { Confirm } from "./ui";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const n = (v: string) => Number(v.replace(/,/g, ""));

/** Every tax rate in one place: VAT (edited in the VAT block above), payroll taxes, and corporate / turnover / levy / withholding. */
export default function TaxRatesSettings({ vatRate, vatRegistered, onNotice, version }: { vatRate: number; vatRegistered: boolean; onNotice: (m: string) => void; version: number }) {
  const [pay, setPay] = useState<PayrollRates | null>(null), [oth, setOth] = useState<OtherTaxes | null>(null), [busy, setBusy] = useState(false), [ask, setAsk] = useState<{ what: string; job: () => Promise<unknown> } | null>(null);
  const load = async () => { try { setPay(await getPayrollRates()); setOth(await getOtherTaxes()); } catch (e) { onNotice(msg(e)); } };
  useEffect(() => { load(); }, [version]);
  if (!pay || !oth) return null;

  async function run(job: () => Promise<unknown>, done: string) { setBusy(true); try { await job(); onNotice(done); await load(); } catch (e) { onNotice(msg(e)); } setBusy(false); }
  const reset = (what: string, job: () => Promise<unknown>) => setAsk({ what, job });
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 4 } as const;

  return <>
  {ask && <Confirm title="Restore default rates?" message={`Replace your edited ${ask.what} rates with the defaults for your jurisdiction? Entries already posted are not changed.`} yes="Restore defaults" onNo={() => setAsk(null)} onYes={() => { const a = ask; setAsk(null); run(a.job, `Default ${a.what} rates restored.`); }} />}
  <section className="panel settings-panel">
    <h3>Tax rates</h3>
    <p>Every rate Msingi uses is editable here. Defaults were checked on {oth.verifiedOn} but laws change: confirm with TRA (Mainland) or ZRB (Zanzibar) and change anything that is out of date. A change applies to what you record or calculate from now on; entries already posted are not changed.</p>

    <div className="vat-prefs-box" style={{ borderTop: 0, marginTop: 8, paddingTop: 0 }}><h3>VAT</h3>
      <p>{vatRegistered ? `Standard rate ${vatRate}%. Change it, the default treatment and "amount includes VAT" in the VAT preferences block above.` : "This business is not VAT-registered, so no VAT is recorded."}</p></div>

  </section>

  <section className="panel settings-panel">
    <h3>Payroll taxes</h3>
    <div className="vat-prefs-box" style={{ borderTop: 0, marginTop: 8, paddingTop: 0 }}>
      <p>PAYE bands are monthly taxable pay (gross less employee social security).</p>
      <div className="table-wrap"><table><thead><tr><th>MONTHLY TAXABLE PAY UP TO (TZS)</th><th>PAYE RATE %</th></tr></thead><tbody>
        {pay.bands.map((b, i) => <tr key={i}><td>{b.upTo === null ? "No upper limit" : <input inputMode="numeric" value={String(b.upTo)} onChange={e => setPay({ ...pay, bands: pay.bands.map((x, j) => j === i ? { ...x, upTo: n(e.target.value) } : x) })} />}</td>
          <td><input inputMode="decimal" value={String(b.rate)} onChange={e => setPay({ ...pay, bands: pay.bands.map((x, j) => j === i ? { ...x, rate: n(e.target.value) } : x) })} /></td></tr>)}
      </tbody></table></div>
      <div style={grid}>
        <label>Employee {pay.ssName} %<input inputMode="decimal" value={String(pay.employeeSsPct)} onChange={e => setPay({ ...pay, employeeSsPct: n(e.target.value) })} /></label>
        <label>Employer {pay.ssName} %<input inputMode="decimal" value={String(pay.employerSsPct)} onChange={e => setPay({ ...pay, employerSsPct: n(e.target.value) })} /></label>
        <label>Skills Development Levy %<input inputMode="decimal" value={String(pay.sdlPct)} onChange={e => setPay({ ...pay, sdlPct: n(e.target.value) })} /></label>
        <label>SDL applies from this many employees<input inputMode="numeric" value={String(pay.sdlMinEmployees)} onChange={e => setPay({ ...pay, sdlMinEmployees: n(e.target.value) })} /></label>
        <label>Workers Compensation (WCF) %<input inputMode="decimal" value={String(pay.wcfPct)} onChange={e => setPay({ ...pay, wcfPct: n(e.target.value) })} /></label>
      </div>
      <label className="check-label"><input type="checkbox" checked={pay.wcfApplies} onChange={e => setPay({ ...pay, wcfApplies: e.target.checked })} /><span><b>Charge WCF</b><small>Turn off if your business is exempt or pays WCF another way.</small></span></label>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}><button className="primary" disabled={busy} onClick={() => run(() => savePayrollRates(pay), "Payroll rates saved.")}>Save payroll rates</button><button className="secondary" disabled={busy} onClick={() => reset("payroll", resetPayrollRates)}>Restore defaults</button></div>
    </div>

  </section>

  <section className="panel settings-panel">
    <h3>Income tax, turnover tax and service levy</h3>
    <div className="vat-prefs-box" style={{ borderTop: 0, marginTop: 8, paddingTop: 0 }}>
      <p>Used by the Tax estimate page. Zanzibar and the service levy have no TRA-published figure, so check those first.</p>
      <div style={grid}>
        <label>Corporate income tax %<input inputMode="decimal" value={String(oth.corporatePct)} onChange={e => setOth({ ...oth, corporatePct: n(e.target.value) })} /></label>
        <label>Turnover tax %<input inputMode="decimal" value={String(oth.turnoverPct)} onChange={e => setOth({ ...oth, turnoverPct: n(e.target.value) })} /></label>
        <label>Turnover tax from annual turnover (TZS)<input inputMode="numeric" value={String(oth.turnoverMin)} onChange={e => setOth({ ...oth, turnoverMin: n(e.target.value) })} /></label>
        <label>Turnover tax up to annual turnover (TZS)<input inputMode="numeric" value={String(oth.turnoverMax)} onChange={e => setOth({ ...oth, turnoverMax: n(e.target.value) })} /></label>
        <label>Local service levy % of turnover<input inputMode="decimal" value={String(oth.levyPct)} onChange={e => setOth({ ...oth, levyPct: n(e.target.value) })} /></label>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}><button className="primary" disabled={busy} onClick={() => run(() => saveOtherTaxes(oth), "Tax rates saved.")}>Save these rates</button><button className="secondary" disabled={busy} onClick={() => reset("income tax, levy and withholding", resetOtherTaxes)}>Restore defaults</button></div>
    </div>

  </section>

  <section className="panel settings-panel">
    <h3>Withholding tax on payments to residents</h3>
    <div className="vat-prefs-box" style={{ borderTop: 0, marginTop: 8, paddingTop: 0 }}>
      <div className="table-wrap"><table><thead><tr><th>PAYMENT</th><th>RATE %</th></tr></thead><tbody>
        {oth.wht.map((w, i) => <tr key={w.key}><td className="description">{w.label}</td><td><input inputMode="decimal" style={{ width: 90 }} value={String(w.pct)} onChange={e => setOth({ ...oth, wht: oth.wht.map((x, j) => j === i ? { ...x, pct: n(e.target.value) } : x) })} /></td></tr>)}
      </tbody></table></div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}><button className="primary" disabled={busy} onClick={() => run(() => saveOtherTaxes(oth), "Tax rates saved.")}>Save these rates</button><button className="secondary" disabled={busy} onClick={() => reset("income tax, levy and withholding", resetOtherTaxes)}>Restore defaults</button></div>
    </div>
  </section>
  </>;
}
