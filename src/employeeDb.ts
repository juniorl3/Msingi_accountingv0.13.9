import { db, withTransaction, insertedId } from "./db";
import type { Conn } from "./db";
import { getActiveBusiness } from "./business";
import { isRealDate, nextEmployeeNo } from "./employeeRules";

export type Employee = {
  id:number; employee_no:string; full_name:string; phone:string; email:string;
  job_title:string; department:string; start_date:string; employment_type:string;
  pay_frequency:string; gross_salary:number; status:string; notes:string; end_date:string;
};
export type EmployeeDraft = Omit<Employee,"id"|"employee_no">;

export async function initialiseEmployees(){
  const d=await db();
  await d.execute(`CREATE TABLE IF NOT EXISTS employees(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    employee_no TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,
    employment_type TEXT NOT NULL DEFAULT 'Permanent',
    pay_frequency TEXT NOT NULL DEFAULT 'Monthly',
    gross_salary INTEGER NOT NULL DEFAULT 0 CHECK(gross_salary>=0),
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive','Terminated')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id,employee_no)
  )`);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_employees_business_status ON employees(business_id,status)");
  // v0.6.6: end date (additive migration; existing rows get '').
  const cols=await d.select<Array<{name:string}>>("PRAGMA table_info(employees)");
  if(!cols.some(c=>c.name==="end_date")) await d.execute("ALTER TABLE employees ADD COLUMN end_date TEXT NOT NULL DEFAULT ''");
}
export async function listEmployees(includeInactive=true):Promise<Employee[]>{
  const biz=await getActiveBusiness(), d=await db();
  return d.select<Employee[]>(`SELECT id,employee_no,full_name,phone,email,job_title,department,start_date,employment_type,pay_frequency,gross_salary,status,notes,end_date
    FROM employees WHERE business_id=? ${includeInactive?"":"AND status='Active'"} ORDER BY CASE status WHEN 'Active' THEN 0 ELSE 1 END,full_name COLLATE NOCASE`,[biz.id]);
}
/** Employees by id for one business. Takes the caller's connection and business id so it is safe inside a transaction (never calls db()). */
export async function employeesByIds(ids:number[],businessId:number,conn:Conn):Promise<Employee[]>{
  if(!ids.length) return [];
  return conn.select<Employee[]>(`SELECT id,employee_no,full_name,phone,email,job_title,department,start_date,employment_type,pay_frequency,gross_salary,status,notes,end_date FROM employees WHERE business_id=? AND id IN (${ids.map(()=>"?").join(",")})`,[businessId,...ids]);
}
export async function saveEmployee(input:EmployeeDraft,id?:number){
  const biz=await getActiveBusiness();
  if(!input.full_name.trim()) throw new Error("Enter the employee's full name.");
  if(!isRealDate(input.start_date)) throw new Error("Enter a valid employment start date.");
  if(input.end_date&&!isRealDate(input.end_date)) throw new Error("Enter a valid end date, or leave it blank.");
  if(input.end_date&&input.end_date<input.start_date) throw new Error("The end date cannot be before the start date.");
  if(input.status==="Terminated"&&!input.end_date) throw new Error("Enter the end date for a terminated employee.");
  if(input.email.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new Error("Enter a valid email address, or leave it blank.");
  if(!Number.isSafeInteger(input.gross_salary)||input.gross_salary<0) throw new Error("Enter gross salary as a whole TZS amount.");
  if(!["Active","Inactive","Terminated"].includes(input.status)) throw new Error("Choose a valid employee status.");
  return withTransaction(async tx=>{
    if(id){
      const prev=(await tx.select<Employee[]>("SELECT * FROM employees WHERE id=? AND business_id=?",[id,biz.id]))[0];
      if(!prev) throw new Error("Employee record not found.");
      await tx.execute(`UPDATE employees SET full_name=?,phone=?,email=?,job_title=?,department=?,start_date=?,end_date=?,employment_type=?,pay_frequency=?,gross_salary=?,status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?`,
      [input.full_name.trim(),input.phone,input.email.trim(),input.job_title,input.department,input.start_date,input.end_date,input.employment_type,input.pay_frequency,input.gross_salary,input.status,input.notes,id,biz.id]);
      const changes:Record<string,{from:unknown;to:unknown}>={};
      for(const k of ["full_name","job_title","department","start_date","end_date","employment_type","pay_frequency","gross_salary","status"] as const){
        const to=k==="full_name"?input.full_name.trim():input[k];
        if(prev[k]!==to) changes[k]={from:prev[k],to};
      }
      await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('UPDATE','employee',?,?)",[String(id),JSON.stringify({employee:prev.employee_no,changes})]);
      return id;
    }
    const nums=await tx.select<Array<{employee_no:string}>>("SELECT employee_no FROM employees WHERE business_id=?",[biz.id]);
    const employeeNo=nextEmployeeNo(nums.map(r=>r.employee_no));
    const result=await tx.execute(`INSERT INTO employees(business_id,employee_no,full_name,phone,email,job_title,department,start_date,end_date,employment_type,pay_frequency,gross_salary,status,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[biz.id,employeeNo,input.full_name.trim(),input.phone,input.email.trim(),input.job_title,input.department,input.start_date,input.end_date,input.employment_type,input.pay_frequency,input.gross_salary,input.status,input.notes]);
    const newId=insertedId(result,"employee");
    await tx.execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('CREATE','employee',?,?)",[String(newId),JSON.stringify({employeeNo,name:input.full_name})]);
    return newId;
  });
}
