import { db, withTransaction, insertedId, inTx } from "./db";
import type { Conn } from "./db";
import { vatFromEntered, VAT_PAYABLE, VAT_RECEIVABLE } from "./vat";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type Account = { id:number; code:string; name:string; account_type:AccountType; normal_balance:"debit"|"credit" };
export type JournalLineInput = { accountCode:string; description?:string; debitTzs?:number; creditTzs?:number };
export type JournalInput = { date:string; description:string; sourceType?:string; sourceId?:string; lines:JournalLineInput[] };
export type JournalEntry = { id:number; entry_number:string; entry_date:string; description:string; status:string; total_debit:number; total_credit:number };
export type LedgerRow = { entry_date:string; entry_number:string; description:string; line_description:string|null; debit_tzs:number; credit_tzs:number; running_balance:number };

const defaults:Array<[string,string,AccountType,"debit"|"credit"]> = [
  ["1000","Cash on Hand","asset","debit"],["1010","Bank Account","asset","debit"],["1020","Mobile Money","asset","debit"],
  ["1100","Accounts Receivable","asset","debit"],["1340","Employee Salary Advances","asset","debit"],["1300","VAT Receivable (Input VAT)","asset","debit"],["1200","Inventory","asset","debit"],
  ["2000","Accounts Payable","liability","credit"],["2100","VAT Payable","liability","credit"],
  ["3000","Owner Capital","equity","credit"],["3100","Retained Earnings","equity","credit"],
  ["4000","Sales Revenue","income","credit"],["4100","Service Revenue","income","credit"],["4900","Other Income","income","credit"],
  ["5000","Cost of Goods Sold","expense","debit"],["6000","Rent Expense","expense","debit"],
  ["6100","Salaries Expense","expense","debit"],["6200","Transport Expense","expense","debit"],
  ["6300","Utilities Expense","expense","debit"],["6900","Other Operating Expenses","expense","debit"],
  // v0.5.3 statutory tax accounts (Mainland and Zanzibar). Added alongside the existing chart; no existing code changes.
  ["1310","WHT Receivable (tax withheld by customers)","asset","debit"],["1320","Income Tax Paid in Advance","asset","debit"],["1330","Customs & Clearance Deposits","asset","debit"],
  ["2110","WHT Payable (withholding tax)","liability","credit"],["2120","PAYE Payable","liability","credit"],["2130","SDL Payable (Skills Development Levy)","liability","credit"],
  ["2140","Social Security Payable (NSSF / PSSSF / ZSSF)","liability","credit"],["2150","WCF Payable (Workers Compensation)","liability","credit"],
  ["2160","Income Tax Payable (corporate / turnover tax)","liability","credit"],["2170","Local Service Levy Payable","liability","credit"],
  ["6400","Employer Social Security Contribution","expense","debit"],["6410","SDL Expense","expense","debit"],["6420","WCF Expense","expense","debit"],
  ["6430","Licences & Municipal Fees","expense","debit"],["6440","Stamp Duty Expense","expense","debit"],["6450","Local Service Levy Expense","expense","debit"],
  ["6500","Income Tax Expense","expense","debit"]
];

export async function initialiseLedger(){
  const d=await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,account_type TEXT NOT NULL CHECK(account_type IN ('asset','liability','equity','income','expense')),normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),parent_id INTEGER REFERENCES accounts(id),is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute(`CREATE TABLE IF NOT EXISTS journal_entries(id INTEGER PRIMARY KEY AUTOINCREMENT,entry_number TEXT NOT NULL UNIQUE,entry_date TEXT NOT NULL,description TEXT NOT NULL,source_type TEXT NOT NULL DEFAULT 'manual',source_id TEXT,status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('draft','posted','reversed')),created_by TEXT NOT NULL DEFAULT 'local-user',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reversed_entry_id INTEGER REFERENCES journal_entries(id))`);
  await d.execute(`CREATE TABLE IF NOT EXISTS journal_lines(id INTEGER PRIMARY KEY AUTOINCREMENT,journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),account_id INTEGER NOT NULL REFERENCES accounts(id),description TEXT,debit_tzs INTEGER NOT NULL DEFAULT 0 CHECK(debit_tzs>=0),credit_tzs INTEGER NOT NULL DEFAULT 0 CHECK(credit_tzs>=0),CHECK((debit_tzs>0 AND credit_tzs=0) OR (credit_tzs>0 AND debit_tzs=0)))`);
  await d.execute(`CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date,id)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id,journal_entry_id)");
  for(const [code,name,type,normal] of defaults) await d.execute("INSERT OR IGNORE INTO accounts(code,name,account_type,normal_balance) VALUES(?,?,?,?)",[code,name,type,normal]);
}

function validate(input:JournalInput){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!input.description.trim()) throw new Error("A valid date and description are required.");
  if(input.lines.length<2) throw new Error("A journal entry needs at least two lines.");
  let debits=0,credits=0;
  for(const line of input.lines){
    const debit=line.debitTzs??0,credit=line.creditTzs??0;
    if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit<0||credit<0||(debit>0)===(credit>0)) throw new Error("Each line must contain either a positive whole-TZS debit or credit.");
    debits+=debit;credits+=credit;
  }
  if(!Number.isSafeInteger(debits)||debits!==credits||debits<=0) throw new Error("Journal entry is not balanced. Total debits must equal total credits.");
  return debits;
}
/** Posts a journal. Pass the `tx` of an open withTransaction(); without one the writes are not atomic. */
export async function insertJournal(input:JournalInput,conn?:Conn){
  const d=conn??await db(); const total=validate(input);
  const seq=await d.select<Array<{n:number}>>("SELECT COALESCE(MAX(id),0)+1 AS n FROM journal_entries");
  const entryNumber=`JE-${String(seq[0]?.n??1).padStart(6,"0")}`;
  const inserted=await d.execute("INSERT INTO journal_entries(entry_number,entry_date,description,source_type,source_id,status) VALUES(?,?,?,?,?,'posted')",[entryNumber,input.date,input.description.trim(),input.sourceType??"manual",input.sourceId??null]);
  const id=insertedId(inserted,"journal entry");
  for(const line of input.lines){
    const a=await d.select<Array<{id:number}>>("SELECT id FROM accounts WHERE code=? AND is_active=1",[line.accountCode]);
    if(!a.length) throw new Error(`Unknown or inactive account: ${line.accountCode}`);
    await d.execute("INSERT INTO journal_lines(journal_entry_id,account_id,description,debit_tzs,credit_tzs) VALUES(?,?,?,?,?)",[id,a[0].id,line.description??null,line.debitTzs??0,line.creditTzs??0]);
  }
  await d.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('POST','journal_entry',?,?)",[String(id),JSON.stringify({entryNumber,total})]);
  return {id,entryNumber,totalTzs:total};
}
export async function postJournalEntry(input:JournalInput){
  validate(input);
  return withTransaction(tx=>insertJournal(input,tx));
}
export async function getAccounts(){
  const d=await db();return d.select<Account[]>("SELECT id,code,name,account_type,normal_balance FROM accounts WHERE is_active=1 ORDER BY code");
}
export async function getJournalEntries(){
  const d=await db();return d.select<JournalEntry[]>(`SELECT j.id,j.entry_number,j.entry_date,j.description,j.status,
    COALESCE(SUM(l.debit_tzs),0) total_debit,COALESCE(SUM(l.credit_tzs),0) total_credit
    FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_entry_id=j.id GROUP BY j.id ORDER BY j.entry_date DESC,j.id DESC`);
}
/** Statutory tax accounts added in v0.5.3. Always available for posting, but kept out of trial balance and income statement until they have activity, so existing reports look as they did. */
const TAX_ACCOUNT_SQL="'1310','1320','1330','2110','2120','2130','2140','2150','2160','2170','6400','6410','6420','6430','6440','6450','6500'";
const HIDE_UNUSED_TAX="HAVING (a.code NOT IN ("+TAX_ACCOUNT_SQL+") OR COUNT(l.id)>0)";

export async function getTrialBalance(asOfDate:string){
  const d=await db();
  return d.select<Array<{code:string;name:string;account_type:AccountType;debits:number;credits:number;balance:number}>>(
  `SELECT a.code,a.name,a.account_type,
   COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') AND j.entry_date<=? THEN l.debit_tzs ELSE 0 END),0) debits,
   COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') AND j.entry_date<=? THEN l.credit_tzs ELSE 0 END),0) credits,
   CASE WHEN a.normal_balance='debit' THEN COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') AND j.entry_date<=? THEN l.debit_tzs-l.credit_tzs ELSE 0 END),0)
   ELSE COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') AND j.entry_date<=? THEN l.credit_tzs-l.debit_tzs ELSE 0 END),0) END balance
   FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries j ON j.id=l.journal_entry_id
   WHERE a.is_active=1 GROUP BY a.id ${HIDE_UNUSED_TAX} ORDER BY a.code`,[asOfDate,asOfDate,asOfDate,asOfDate]);
}
export async function getAccountLedger(code:string){
  const d=await db();
  const account=await d.select<Array<{name:string;normal_balance:string}>>("SELECT name,normal_balance FROM accounts WHERE code=?",[code]);
  if(!account.length) throw new Error("Account not found.");
  const rows=await d.select<Array<Omit<LedgerRow,"running_balance">>>(
    `SELECT j.entry_date,j.entry_number,j.description,l.description line_description,l.debit_tzs,l.credit_tzs
     FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id
     WHERE a.code=? AND j.status IN ('posted','reversed') ORDER BY j.entry_date,j.id,l.id`,[code]);
  let balance=0;
  return rows.map(r=>{balance+=account[0].normal_balance==="debit"?r.debit_tzs-r.credit_tzs:r.credit_tzs-r.debit_tzs;return {...r,running_balance:balance};});
}
export async function getAuditLog(){
  const d=await db();return d.select<Array<{event_type:string;entity_type:string;entity_id:string;details:string;created_at:string}>>("SELECT event_type,entity_type,entity_id,details,created_at FROM audit_log ORDER BY id DESC LIMIT 200");
}
export async function migrateLegacyTransactions(){
  const d=await db();
  const legacy=await d.select<Array<{id:number;date:string;kind:"income"|"expense";category:string;description:string;amount:number;payment_method:string}>>(
    "SELECT id,date,kind,category,description,amount,payment_method FROM transactions ORDER BY id");
  const linked=await d.select<Array<{source_id:string}>>("SELECT source_id FROM journal_entries WHERE source_type='transaction' AND source_id IS NOT NULL");
  const done=new Set(linked.map(x=>String(x.source_id)));
  let migrated=0,skipped=0;
  for(const tx of legacy){
    if(done.has(String(tx.id))) continue;
    if(!Number.isSafeInteger(tx.amount)||tx.amount<=0){skipped++;continue;}
    const cashCode=tx.payment_method==="Bank"?"1010":tx.payment_method==="Mobile money"?"1020":"1000";
    let accountCode="6900";
    if(tx.kind==="income") accountCode=tx.category==="Services"?"4100":tx.category==="Other income"?"4900":tx.category==="Capital introduced"?"3000":"4000";
    else if(tx.category==="Rent") accountCode="6000";
    else if(tx.category==="Salaries") accountCode="6100";
    else if(tx.category==="Transport") accountCode="6200";
    else if(tx.category==="Utilities") accountCode="6300";
    else if(tx.category==="Stock purchase") accountCode="1200";
    const lines:JournalLineInput[]=tx.kind==="income"
      ?[{accountCode:cashCode,debitTzs:tx.amount,description:tx.payment_method},{accountCode,creditTzs:tx.amount,description:tx.category}]
      :[{accountCode,debitTzs:tx.amount,description:tx.category},{accountCode:cashCode,creditTzs:tx.amount,description:tx.payment_method}];
    await postJournalEntry({date:tx.date,description:tx.description,sourceType:"transaction",sourceId:String(tx.id),lines});
    migrated++;
  }
  return {migrated,skipped};
}

export type TxVatTreatment = "none"|"standard"|"zero"|"exempt";
/** Posts a transaction and its journal together. `amount` is what the user typed: the VAT-inclusive total when
 *  amount_includes_vat is true (the default, as in earlier versions), or the amount before VAT when false, in which
 *  case VAT is added on top. The stored amount is always the total paid or received. */
export async function addTransactionWithJournal(tx:{date:string;kind:"income"|"expense";category:string;description:string;amount:number;payment_method:string;reference?:string;vat_treatment?:TxVatTreatment;vat_rate?:number;amount_includes_vat?:boolean},conn?:Conn){
  if(!Number.isSafeInteger(tx.amount)||tx.amount<=0) throw new Error("Enter an amount in whole TZS.");
  const treatment:TxVatTreatment=tx.vat_treatment??"none";
  if(treatment!=="none"&&(tx.category==="Capital introduced"||tx.category==="Salaries")) throw new Error("VAT does not apply to "+tx.category.toLowerCase()+".");
  let rate=0,net=tx.amount,vat=0,gross=tx.amount;
  const includes=treatment==="standard"?(tx.amount_includes_vat??true):true;
  if(treatment==="standard"){
    rate=tx.vat_rate??0;
    if(!(rate>0)) throw new Error("Enter a VAT rate above 0, or choose zero-rated or exempt.");
    ({net,vat,gross}=vatFromEntered(tx.amount,rate,includes));
  }
  return inTx(conn,async d=>{
    const ins=await d.execute("INSERT INTO transactions(date,kind,category,description,amount,payment_method,reference,vat_tzs,vat_treatment,vat_rate,amount_includes_vat) VALUES(?,?,?,?,?,?,?,?,?,?,?)",[tx.date,tx.kind,tx.category,tx.description,gross,tx.payment_method,tx.reference??"",vat,treatment,rate,includes?1:0]);
    const id=insertedId(ins,"transaction");
    const cashCode=cashAccountFor(tx.payment_method);
    let accountCode="6900";
    if(tx.kind==="income") accountCode=tx.category==="Services"?"4100":tx.category==="Other income"?"4900":tx.category==="Capital introduced"?"3000":"4000";
    else if(tx.category==="Rent") accountCode="6000";
    else if(tx.category==="Salaries") accountCode="6100";
    else if(tx.category==="Transport") accountCode="6200";
    else if(tx.category==="Utilities") accountCode="6300";
    else if(tx.category==="Stock purchase") accountCode="1200";
    const lines:JournalLineInput[]=tx.kind==="income"
      ?[{accountCode:cashCode,debitTzs:gross,description:tx.payment_method},{accountCode,creditTzs:net,description:tx.category}]
      :[{accountCode,debitTzs:net,description:tx.category},{accountCode:cashCode,creditTzs:gross,description:tx.payment_method}];
    if(vat>0){
      if(tx.kind==="income") lines.push({accountCode:VAT_PAYABLE,creditTzs:vat,description:`Output VAT ${rate}%`});
      else lines.splice(1,0,{accountCode:VAT_RECEIVABLE,debitTzs:vat,description:`Input VAT ${rate}%`});
    }
    await insertJournal({date:tx.date,description:tx.description,sourceType:"transaction",sourceId:String(id),lines},d);
    return id;
  });
}
/** Cash, bank or mobile-money account used for a payment method (Card and Other post to Cash on Hand, as before). */
export const cashAccountFor=(method:string)=>method==="Bank"?"1010":method==="Mobile money"?"1020":"1000";


export type JournalLink = {kind:"reversal_of"|"reversed_by";number:string}|null;
export type JournalLineDetail = {
  account_code:string;
  account_name:string;
  line_description:string|null;
  debit_tzs:number;
  credit_tzs:number;
};
export async function getJournalEntryDetails(entryId:number){
  const d=await db();
  const headers=await d.select<Array<JournalEntry & {entry_date:string}>>(
    `SELECT j.id,j.entry_number,j.entry_date,j.description,j.status,
      COALESCE(SUM(l.debit_tzs),0) total_debit,
      COALESCE(SUM(l.credit_tzs),0) total_credit
     FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_entry_id=j.id
     WHERE j.id=? GROUP BY j.id`,[entryId]);
  if(!headers.length) throw new Error("Journal entry not found.");
  const lines=await d.select<JournalLineDetail[]>(
    `SELECT a.code account_code,a.name account_name,l.description line_description,
      l.debit_tzs,l.credit_tzs
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id
     WHERE l.journal_entry_id=? ORDER BY l.id`,[entryId]);
  const linkRows=await d.select<Array<{entry_number:string;source_type:string}>>(
    `SELECT o.entry_number,j.source_type FROM journal_entries j JOIN journal_entries o ON o.id=j.reversed_entry_id WHERE j.id=?`,[entryId]);
  const link=linkRows.length?{kind:(linkRows[0].source_type==="reversal"?"reversal_of":"reversed_by") as "reversal_of"|"reversed_by",number:linkRows[0].entry_number}:null;
  return {entry:headers[0],lines,link};
}


/**
 * Reverse a posted journal with a new, linked journal that swaps every debit
 * and credit. The original is retained and marked reversed for auditability.
 * Works for manual journals and journals migrated from legacy transactions.
 */
export async function reverseJournalEntry(entryId:number, reversalDate:string, reason:string, conn?:Conn){
  if(!Number.isSafeInteger(entryId)||entryId<=0) throw new Error("Select a valid journal entry.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reversalDate)) throw new Error("Enter a valid reversal date.");
  if(!reason.trim()) throw new Error("A reversal reason is required.");
  return inTx(conn,async d=>{
    const headers=await d.select<Array<{id:number;entry_number:string;entry_date:string;description:string;status:string;reversed_entry_id:number|null;source_type:string;source_id:string|null}>>(
      "SELECT id,entry_number,entry_date,description,status,reversed_entry_id,source_type,source_id FROM journal_entries WHERE id=?",[entryId]);
    if(!headers.length) throw new Error("Original journal entry was not found.");
    const original=headers[0];
    if(original.status!=="posted") throw new Error("Only a currently posted journal can be reversed.");
    if(original.reversed_entry_id!==null) throw new Error("This journal already has a linked reversal.");
    if((original.source_type==="invoice"||original.source_type==="bill")&&original.source_id){
      const paid=await d.select<Array<{n:number}>>("SELECT COUNT(*) n FROM doc_payments x JOIN journal_entries jp ON jp.id=x.journal_entry_id WHERE x.document_id=CAST(? AS INTEGER) AND jp.status='posted'",[original.source_id]);
      if((paid[0]?.n??0)>0) throw new Error("This invoice or bill has payments recorded. Reverse its payment journals first, then reverse the document.");
    }
    if(original.source_type==="salary_advance"){
      const rec=await d.select<Array<{n:number}>>("SELECT COUNT(*) n FROM salary_advance_recoveries r JOIN journal_entries rj ON rj.id=r.journal_id JOIN salary_advances a ON a.id=r.advance_id WHERE a.journal_id=? AND rj.status='posted'",[entryId]);
      if((rec[0]?.n??0)>0) throw new Error("This advance has repayments or payroll recoveries recorded. Reverse those journals first, then reverse the advance.");
    }
    if(reversalDate<original.entry_date) throw new Error(`Reversal date cannot be earlier than the original entry date (${original.entry_date}).`);
    const lines=await d.select<Array<{account_code:string;description:string|null;debit_tzs:number;credit_tzs:number}>>(
      `SELECT a.code account_code,l.description,l.debit_tzs,l.credit_tzs
       FROM journal_lines l JOIN accounts a ON a.id=l.account_id
       WHERE l.journal_entry_id=? ORDER BY l.id`,[entryId]);
    if(lines.length<2) throw new Error("The original journal has no valid lines to reverse.");
    const reversalLines:JournalLineInput[]=lines.map(line=>({
      accountCode:line.account_code,
      description:`Reversal of ${original.entry_number}${line.description?": "+line.description:""}`,
      debitTzs:line.credit_tzs,
      creditTzs:line.debit_tzs
    }));
    const reversal=await insertJournal({
      date:reversalDate,
      description:`REVERSAL of ${original.entry_number}: ${reason.trim()}`,
      sourceType:"reversal",
      sourceId:String(entryId),
      lines:reversalLines
    },d);
    await d.execute("UPDATE journal_entries SET status='reversed',reversed_entry_id=? WHERE id=? AND status='posted'",[reversal.id,entryId]);
    await d.execute("UPDATE journal_entries SET reversed_entry_id=? WHERE id=?",[entryId,reversal.id]);
    await d.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('REVERSE','journal_entry',?,?)",
      [String(entryId),JSON.stringify({originalEntry:original.entry_number,reversalEntry:reversal.entryNumber,reversalId:reversal.id,reversalDate,reason:reason.trim()})]);
    return {originalEntryNumber:original.entry_number,reversalEntryNumber:reversal.entryNumber,reversalId:reversal.id};
  });
}


// ===== v0.2.7: financial statements, integrity checks, exports =====
export type StatementRow = { code:string; name:string; amount:number };
export type IncomeStatement = { from:string; to:string; income:StatementRow[]; expenses:StatementRow[]; totalIncome:number; totalExpenses:number; netProfit:number;
  /** Expense accounts 5000-5999 (cost of goods sold). `expenses` and `totalExpenses` still hold ALL expenses, as before. */
  costOfSales:StatementRow[]; totalCostOfSales:number; grossProfit:number; grossMarginPct:number|null; operatingExpenses:StatementRow[]; totalOperatingExpenses:number };
export type BalanceSheet = { asOf:string; assets:StatementRow[]; liabilities:StatementRow[]; equity:StatementRow[]; currentEarnings:number; totalAssets:number; totalLiabilities:number; totalEquity:number; totalLiabilitiesAndEquity:number; difference:number; balanced:boolean };
export type IntegrityCheck = { name:string; ok:boolean; detail:string };
type BalanceRow = { code:string; name:string; account_type:AccountType; normal_balance:"debit"|"credit"; debits:number; credits:number };

async function accountBalances(from:string,to:string){
  const d=await db();
  return d.select<BalanceRow[]>(`SELECT a.code,a.name,a.account_type,a.normal_balance,
   COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') AND j.entry_date>=? AND j.entry_date<=? THEN l.debit_tzs ELSE 0 END),0) debits,
   COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') AND j.entry_date>=? AND j.entry_date<=? THEN l.credit_tzs ELSE 0 END),0) credits
   FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries j ON j.id=l.journal_entry_id
   WHERE a.is_active=1 GROUP BY a.id ${HIDE_UNUSED_TAX} ORDER BY a.code`,[from,to,from,to]);
}
const natural=(r:BalanceRow)=>r.normal_balance==="debit"?r.debits-r.credits:r.credits-r.debits;
const toRows=(rows:BalanceRow[])=>rows.filter(r=>r.debits>0||r.credits>0).map(r=>({code:r.code,name:r.name,amount:natural(r)}));
const sumRows=(rows:StatementRow[])=>rows.reduce((s,r)=>s+r.amount,0);

/** Income statement from the ledger. Counts posted and reversed journals (an original and its reversal net to zero); drafts are excluded. */
export async function getIncomeStatement(from:string,to:string):Promise<IncomeStatement>{
  const rows=await accountBalances(from,to);
  const income=toRows(rows.filter(r=>r.account_type==="income")),expenses=toRows(rows.filter(r=>r.account_type==="expense"));
  const totalIncome=sumRows(income),totalExpenses=sumRows(expenses);
  const isCost=(r:StatementRow)=>r.code.startsWith("5");
  const costOfSales=expenses.filter(isCost),operatingExpenses=expenses.filter(r=>!isCost(r));
  const totalCostOfSales=sumRows(costOfSales),grossProfit=totalIncome-totalCostOfSales;
  return {from,to,income,expenses,totalIncome,totalExpenses,netProfit:totalIncome-totalExpenses,costOfSales,totalCostOfSales,grossProfit,grossMarginPct:totalIncome>0?Math.round(grossProfit/totalIncome*1000)/10:null,operatingExpenses,totalOperatingExpenses:sumRows(operatingExpenses)};
}
/** Balance sheet as at a date. Profit to date is shown inside equity because no period closing exists yet. */
export async function getBalanceSheet(asOf:string):Promise<BalanceSheet>{
  const rows=await accountBalances("0000-01-01",asOf);
  const assets=toRows(rows.filter(r=>r.account_type==="asset")),liabilities=toRows(rows.filter(r=>r.account_type==="liability")),equity=toRows(rows.filter(r=>r.account_type==="equity"));
  const currentEarnings=sumRows(toRows(rows.filter(r=>r.account_type==="income")))-sumRows(toRows(rows.filter(r=>r.account_type==="expense")));
  const totalAssets=sumRows(assets),totalLiabilities=sumRows(liabilities),totalEquity=sumRows(equity)+currentEarnings;
  const totalLiabilitiesAndEquity=totalLiabilities+totalEquity,difference=totalAssets-totalLiabilitiesAndEquity;
  return {asOf,assets,liabilities,equity,currentEarnings,totalAssets,totalLiabilities,totalEquity,totalLiabilitiesAndEquity,difference,balanced:difference===0};
}
export async function runIntegrityChecks():Promise<IntegrityCheck[]>{
  const d=await db(),out:IntegrityCheck[]=[];
  const list=(xs:Array<{entry_number:string}>)=>xs.slice(0,5).map(x=>x.entry_number).join(", ")+(xs.length>5?` and ${xs.length-5} more`:"");
  const unbal=await d.select<Array<{entry_number:string}>>(`SELECT j.entry_number FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_entry_id=j.id
   WHERE j.status IN ('posted','reversed') GROUP BY j.id
   HAVING COALESCE(SUM(l.debit_tzs),0)<>COALESCE(SUM(l.credit_tzs),0) OR COUNT(l.id)<2`);
  out.push({name:"Every journal balances and has at least two lines",ok:unbal.length===0,detail:unbal.length?`Problem entries: ${list(unbal)}`:"All journals balance."});
  const tot=await d.select<Array<{d:number;c:number}>>(`SELECT COALESCE(SUM(l.debit_tzs),0) d,COALESCE(SUM(l.credit_tzs),0) c FROM journal_lines l
   JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.status IN ('posted','reversed')`);
  const td=tot[0]?.d??0,tc=tot[0]?.c??0;
  out.push({name:"Total debits equal total credits",ok:td===tc,detail:td===tc?`Both total ${td.toLocaleString("en-US")} TZS.`:`Debits ${td} vs credits ${tc}.`});
  const orphan=await d.select<Array<{n:number}>>(`SELECT COUNT(*) n FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL`);
  out.push({name:"No journal lines without a journal",ok:(orphan[0]?.n??0)===0,detail:(orphan[0]?.n??0)===0?"None found.":`${orphan[0].n} orphan line(s).`});
  const rev=await d.select<Array<{entry_number:string}>>(`SELECT j.entry_number FROM journal_entries j WHERE j.status='reversed' AND (j.reversed_entry_id IS NULL OR NOT EXISTS
   (SELECT 1 FROM journal_entries r WHERE r.id=j.reversed_entry_id AND r.source_type='reversal' AND r.reversed_entry_id=j.id))`);
  out.push({name:"Every reversed journal has a matching linked reversal",ok:rev.length===0,detail:rev.length?`Check: ${list(rev)}`:"All reversal links are consistent."});
  const unl=await d.select<Array<{n:number}>>(`SELECT COUNT(*) n FROM transactions t WHERE NOT EXISTS
   (SELECT 1 FROM journal_entries j WHERE j.source_type='transaction' AND j.source_id=CAST(t.id AS TEXT))`);
  out.push({name:"Every transaction record is posted to the ledger",ok:(unl[0]?.n??0)===0,detail:(unl[0]?.n??0)===0?"All transactions have a journal.":`${unl[0].n} transaction(s) have no journal (for example non-whole TZS amounts needing review).`});
  return out;
}
export async function getLedgerExport(){
  const d=await db();
  return d.select<Array<{entry_number:string;entry_date:string;status:string;source_type:string;description:string;account_code:string;account_name:string;line_description:string|null;debit_tzs:number;credit_tzs:number}>>(`SELECT j.entry_number,j.entry_date,j.status,j.source_type,j.description,a.code account_code,a.name account_name,
   l.description line_description,l.debit_tzs,l.credit_tzs
   FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id JOIN accounts a ON a.id=l.account_id ORDER BY j.id,l.id`);
}
export async function getFullAuditLog(){
  const d=await db();return d.select<Array<{id:number;event_type:string;entity_type:string;entity_id:string;details:string;created_at:string}>>("SELECT id,event_type,entity_type,entity_id,details,created_at FROM audit_log ORDER BY id");
}


// ===== v0.6.3: management analytics (ledger-derived) =====
export type MonthlyManagementRow = { month:string; income:number; expenses:number; netProfit:number; cashIn:number; cashOut:number };
export type ExpenseCategoryRow = { code:string; name:string; amount:number };
export type ManagementAnalytics = { monthly:MonthlyManagementRow[]; expenseCategories:ExpenseCategoryRow[]; totalCashIn:number; totalCashOut:number; netCashMovement:number };

/**
 * Management analytics use posted/reversed journal lines only. Income and expense
 * values follow the same natural-balance rules as the income statement. Cash figures
 * show gross debit/credit movement on configured cash and bank accounts (1000-1020);
 * transfers between those accounts may appear on both sides and are not a formal
 * statement of cash flows.
 */
export async function getManagementAnalytics(from:string,to:string):Promise<ManagementAnalytics>{
  const d=await db();
  const monthly=await d.select<MonthlyManagementRow[]>(`
    SELECT strftime('%Y-%m',j.entry_date) month,
      COALESCE(SUM(CASE WHEN a.account_type='income' THEN l.credit_tzs-l.debit_tzs ELSE 0 END),0) income,
      COALESCE(SUM(CASE WHEN a.account_type='expense' THEN l.debit_tzs-l.credit_tzs ELSE 0 END),0) expenses,
      COALESCE(SUM(CASE WHEN a.account_type='income' THEN l.credit_tzs-l.debit_tzs WHEN a.account_type='expense' THEN l.credit_tzs-l.debit_tzs ELSE 0 END),0) netProfit,
      COALESCE(SUM(CASE WHEN a.code IN ('1000','1010','1020') THEN l.debit_tzs ELSE 0 END),0) cashIn,
      COALESCE(SUM(CASE WHEN a.code IN ('1000','1010','1020') THEN l.credit_tzs ELSE 0 END),0) cashOut
    FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id JOIN accounts a ON a.id=l.account_id
    WHERE j.status IN ('posted','reversed') AND j.entry_date>=? AND j.entry_date<=?
    GROUP BY strftime('%Y-%m',j.entry_date) ORDER BY month`,[from,to]);
  const expenseCategories=await d.select<ExpenseCategoryRow[]>(`
    SELECT a.code,a.name,COALESCE(SUM(l.debit_tzs-l.credit_tzs),0) amount
    FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id JOIN accounts a ON a.id=l.account_id
    WHERE j.status IN ('posted','reversed') AND j.entry_date>=? AND j.entry_date<=?
      AND a.account_type='expense'
    GROUP BY a.id HAVING amount<>0 ORDER BY amount DESC`,[from,to]);
  const totalCashIn=monthly.reduce((s,r)=>s+Number(r.cashIn),0),totalCashOut=monthly.reduce((s,r)=>s+Number(r.cashOut),0);
  return {monthly:monthly.map(r=>({...r,income:Number(r.income),expenses:Number(r.expenses),netProfit:Number(r.netProfit),cashIn:Number(r.cashIn),cashOut:Number(r.cashOut)})),
    expenseCategories:expenseCategories.map(r=>({...r,amount:Number(r.amount)})),totalCashIn,totalCashOut,netCashMovement:totalCashIn-totalCashOut};
}


/** Cash and bank balances across configured cash accounts at two dates. */
export async function getCashPosition(openingAsAt:string,closingAsAt:string):Promise<{opening:number;closing:number;change:number}>{
 const openingRows=await accountBalances("0000-01-01",openingAsAt);
 const closingRows=await accountBalances("0000-01-01",closingAsAt);
 const cashCodes=new Set(["1000","1010","1020"]);
 const balance=(rows:BalanceRow[])=>rows.filter(r=>cashCodes.has(r.code)).reduce((sum,r)=>sum+natural(r),0);
 const opening=balance(openingRows),closing=balance(closingRows);return {opening,closing,change:closing-opening};
}
