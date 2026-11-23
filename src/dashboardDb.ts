// Figures for the dashboard's "money" cards. All read straight from the ledger.
import { db } from "./db.ts";
import { getIncomeStatement } from "./ledger.ts";

export type DashboardFigures = { cash: number; owedToYou: number; youOwe: number; stockValue: number; hasStock: boolean; monthIncome: number; monthGrossProfit: number; monthNetProfit: number; hasCogs: boolean };

async function balances(codes: string[]) {
  const d = await db();
  const rows = await d.select<Array<{ code: string; b: number }>>(
    `SELECT a.code,COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.debit_tzs-l.credit_tzs ELSE 0 END),0) b
     FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code IN (${codes.map(() => "?").join(",")}) GROUP BY a.id`, codes);
  return new Map(rows.map(r => [r.code, Number(r.b)]));
}

export async function getDashboardFigures(monthStart: string, today: string): Promise<DashboardFigures> {
  const b = await balances(["1000", "1010", "1020", "1100", "2000", "1200"]);
  const m = await getIncomeStatement(monthStart, today);
  return {
    cash: (b.get("1000") ?? 0) + (b.get("1010") ?? 0) + (b.get("1020") ?? 0), owedToYou: b.get("1100") ?? 0, youOwe: -(b.get("2000") ?? 0),
    stockValue: b.get("1200") ?? 0, hasStock: (b.get("1200") ?? 0) !== 0,
    monthIncome: m.totalIncome, monthGrossProfit: m.grossProfit, monthNetProfit: m.netProfit, hasCogs: m.costOfSales.length > 0,
  };
}
