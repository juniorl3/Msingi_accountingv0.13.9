// Pure payroll arithmetic. Imports only pure helpers: easy to test.
import { assertNoDuplicateEmployees } from "./employeeRules.ts";
//
// Rates below were checked on 2026-11-11 against TRA (SDL page), PaySpace's Tanzania and Zanzibar payroll
// guides and the Finance Act 2026 summary. They are DEFAULTS only: every rate can be edited per business on the
// Payroll screen, and each employer must confirm them with TRA (Mainland) or ZRB / ZSSF (Zanzibar).

export type Band = { upTo: number | null; rate: number }; // upTo = top of the band in monthly TZS; null = no upper limit; rate in percent
export type PayrollRates = {
  bands: Band[];            // monthly PAYE bands on taxable pay (gross less employee social security)
  ssName: string;           // NSSF / PSSSF on the Mainland, ZSSF in Zanzibar
  employeeSsPct: number;
  employerSsPct: number;
  sdlPct: number;           // Skills Development Levy, employer only, on total gross
  sdlMinEmployees: number;  // SDL applies when the payroll has at least this many employees
  wcfPct: number;           // Workers Compensation Fund, employer only, on total gross
  wcfApplies: boolean;
  verifiedOn: string;       // date the defaults were last checked
};

const PAYE_BANDS: Band[] = [
  { upTo: 270000, rate: 0 }, { upTo: 520000, rate: 8 }, { upTo: 760000, rate: 20 }, { upTo: 1000000, rate: 25 }, { upTo: null, rate: 30 },
];
export const DEFAULT_RATES: Record<"mainland" | "zanzibar", PayrollRates> = {
  mainland: { bands: PAYE_BANDS, ssName: "NSSF / PSSSF", employeeSsPct: 10, employerSsPct: 10, sdlPct: 3.5, sdlMinEmployees: 10, wcfPct: 0.5, wcfApplies: true, verifiedOn: "2026-11-11" },
  // Zanzibar: PaySpace (2024) lists ZSSF 7% + 14% and SDL 5%; v0.5.3 notes said SDL 4%. The sources disagree, so confirm with ZRB.
  zanzibar: { bands: PAYE_BANDS, ssName: "ZSSF", employeeSsPct: 7, employerSsPct: 14, sdlPct: 5, sdlMinEmployees: 1, wcfPct: 0.5, wcfApplies: true, verifiedOn: "2026-11-11" },
};

/** Percentage of a whole-TZS amount, rounded to the nearest shilling. The rate is held in hundredths of a percent so the product is an exact integer. */
export const pct = (amount: number, ratePct: number) => Math.round((amount * Math.round(ratePct * 100)) / 10000);

/** Progressive PAYE: each rate applies only to the slice of taxable pay inside its band. */
export function payeOn(taxable: number, bands: Band[]): number {
  let tax = 0, lower = 0;
  for (const b of bands) {
    const top = b.upTo ?? Infinity;
    if (taxable > lower) tax += (Math.min(taxable, top) - lower) * (Math.round(b.rate * 100) / 10000);
    if (taxable <= top) break;
    lower = top;
  }
  return Math.round(tax);
}

export type EmployeeInput = { name: string; gross: number; employeeId?: number; advance?: number }; // advance = salary advance recovered from this month's pay
export type EmployeeResult = { name: string; employeeId?: number; gross: number; employeeSs: number; employerSs: number; taxable: number; paye: number; advance?: number; net: number };
export type PayrollTotals = { gross: number; employeeSs: number; employerSs: number; paye: number; sdl: number; wcf: number; advance?: number; net: number; employerCost: number; sdlApplies: boolean };

export function validateRates(r: PayrollRates): string | null {
  if (!r.bands.length) return "Add at least one PAYE band.";
  let prev = 0;
  for (let i = 0; i < r.bands.length; i++) {
    const b = r.bands[i];
    if (!Number.isFinite(b.rate) || b.rate < 0 || b.rate > 100) return "Each PAYE rate must be from 0 to 100.";
    if (b.upTo === null) { if (i !== r.bands.length - 1) return "Only the last PAYE band can have no upper limit."; }
    else if (!Number.isFinite(b.upTo) || b.upTo <= prev) return "PAYE band limits must increase from one band to the next.";
    else prev = b.upTo;
  }
  if (r.bands[r.bands.length - 1].upTo !== null) return "The last PAYE band must have no upper limit.";
  for (const [label, v] of [["Employee social security", r.employeeSsPct], ["Employer social security", r.employerSsPct], ["SDL", r.sdlPct], ["WCF", r.wcfPct]] as const)
    if (!Number.isFinite(v) || v < 0 || v >= 100) return `${label} rate must be from 0 to under 100.`;
  if (!Number.isSafeInteger(r.sdlMinEmployees) || r.sdlMinEmployees < 1) return "The SDL employee threshold must be a whole number of 1 or more.";
  return null;
}

export function computePayroll(employees: EmployeeInput[], rates: PayrollRates): { lines: EmployeeResult[]; totals: PayrollTotals } {
  if (!employees.length) throw new Error("Add at least one employee.");
  assertNoDuplicateEmployees(employees.map(e => e.employeeId));
  const problem = validateRates(rates);
  if (problem) throw new Error(problem);
  const lines = employees.map(e => {
    const name = e.name.trim();
    if (!name) throw new Error("Every employee needs a name.");
    if (!Number.isSafeInteger(e.gross) || e.gross <= 0) throw new Error(`Enter ${name}'s gross monthly pay in whole TZS.`);
    const employeeSs = pct(e.gross, rates.employeeSsPct), employerSs = pct(e.gross, rates.employerSsPct);
    const taxable = e.gross - employeeSs;            // employee social security is deducted before PAYE
    const paye = payeOn(taxable, rates.bands);
    const advance = e.advance ?? 0;
    if (!Number.isSafeInteger(advance) || advance < 0) throw new Error(`Enter ${name}'s advance recovery in whole TZS.`);
    if (advance > e.gross - employeeSs - paye) throw new Error(`${name}'s advance recovery cannot be more than their pay after social security and PAYE (${(e.gross - employeeSs - paye).toLocaleString("en-TZ")}).`);
    return { name, ...(e.employeeId ? { employeeId:e.employeeId } : {}), gross: e.gross, employeeSs, employerSs, taxable, paye, ...(advance ? { advance } : {}), net: e.gross - employeeSs - paye - advance };
  });
  const sum = (f: (l: EmployeeResult) => number) => lines.reduce((s, l) => s + f(l), 0);
  const gross = sum(l => l.gross);
  const sdlApplies = lines.length >= rates.sdlMinEmployees;
  const sdl = sdlApplies ? pct(gross, rates.sdlPct) : 0;
  const wcf = rates.wcfApplies ? pct(gross, rates.wcfPct) : 0;
  const employeeSs = sum(l => l.employeeSs), employerSs = sum(l => l.employerSs);
  const advance = sum(l => l.advance ?? 0);
  return { lines, totals: { gross, employeeSs, employerSs, paye: sum(l => l.paye), sdl, wcf, ...(advance ? { advance } : {}), net: sum(l => l.net), employerCost: gross + employerSs + sdl + wcf, sdlApplies } };
}

export type PayrollJournalLine = { accountCode: string; description: string; debitTzs?: number; creditTzs?: number };
/**
 * Dr Salaries 6100 (gross), Dr employer social security 6400, Dr SDL 6410, Dr WCF 6420
 * Cr PAYE 2120, Cr social security 2140 (employee + employer), Cr SDL 2130, Cr WCF 2150, Cr employee advances 1340 (recovered), Cr cash/bank/mobile (net pay).
 * Always balances because net = gross - employee social security - PAYE - advances recovered.
 */
export function payrollJournalLines(t: PayrollTotals, payAccount: string, period: string): PayrollJournalLine[] {
  const rows: PayrollJournalLine[] = [];
  const dr = (accountCode: string, description: string, v: number) => { if (v > 0) rows.push({ accountCode, description, debitTzs: v }); };
  const cr = (accountCode: string, description: string, v: number) => { if (v > 0) rows.push({ accountCode, description, creditTzs: v }); };
  dr("6100", `Gross salaries ${period}`, t.gross); dr("6400", `Employer social security ${period}`, t.employerSs); dr("6410", `SDL ${period}`, t.sdl); dr("6420", `WCF ${period}`, t.wcf);
  cr("2120", `PAYE withheld ${period}`, t.paye); cr("2140", `Social security (employee + employer) ${period}`, t.employeeSs + t.employerSs);
  cr("1340", `Salary advances recovered ${period}`, t.advance ?? 0); cr("2130", `SDL payable ${period}`, t.sdl); cr("2150", `WCF payable ${period}`, t.wcf); cr(payAccount, `Net pay ${period}`, t.net);
  return rows;
}
