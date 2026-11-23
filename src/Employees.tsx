import { useEffect,useState } from "react";
import { Plus, Pencil, X } from "lucide-react";
import { listEmployees, saveEmployee } from "./employeeDb";
import type { Employee, EmployeeDraft } from "./employeeDb";
import { localDate } from "./parties";
import DateField from "./DateField";
import Advances from "./Advances";

const blank=():EmployeeDraft=>({full_name:"",phone:"",email:"",job_title:"",department:"",start_date:localDate(),end_date:"",employment_type:"Permanent",pay_frequency:"Monthly",gross_salary:0,status:"Active",notes:""});
const money=(n:number)=>new Intl.NumberFormat("en-TZ",{style:"currency",currency:"TZS",maximumFractionDigits:0}).format(n);
export default function Employees({onNotice,onChanged}:{onNotice:(m:string)=>void;onChanged:()=>Promise<void>}){
 const [items,setItems]=useState<Employee[]>([]),[editing,setEditing]=useState<Employee|null>(null),[draft,setDraft]=useState<EmployeeDraft>(blank()),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[filter,setFilter]=useState("Active");
 async function reload(){try{setItems(await listEmployees());}catch(e){onNotice(String(e));}}
 useEffect(()=>{reload();},[]);
 const visible=items.filter(x=>filter==="All"||x.status===filter);
 function start(item?:Employee){setEditing(item??null);setDraft(item?{full_name:item.full_name,phone:item.phone,email:item.email,job_title:item.job_title,department:item.department,start_date:item.start_date,end_date:item.end_date,employment_type:item.employment_type,pay_frequency:item.pay_frequency,gross_salary:item.gross_salary,status:item.status,notes:item.notes}:blank());setShow(true);}
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);try{await saveEmployee(draft,editing?.id);onNotice(editing?"Employee record updated.":"Employee registered successfully.");setShow(false);await reload();}catch(err){onNotice(err instanceof Error?err.message:String(err));}finally{setBusy(false);}}
 const field=(label:string,key:keyof EmployeeDraft,type="text")=><label className="filter-date">{label}{type==="date"?<DateField type="date" value={String(draft[key]??"")} onChange={e=>setDraft({...draft,[key]:e.target.value} as EmployeeDraft)}/>:<input type={type} value={String(draft[key]??"")} onChange={e=>setDraft({...draft,[key]:type==="number"?Number(e.target.value):e.target.value} as EmployeeDraft)}/>}</label>;
 return <>
 <section className="panel" style={{marginBottom:17}}>
  <div className="panel-head"><div><h3>Employee register</h3><p>Register employees here before adding them to payroll. Employee records do not create software login accounts.</p></div><button className="primary" onClick={()=>start()}><Plus size={16}/> Register employee</button></div>
  <div className="table-actions wrap" style={{marginBottom:12}}><label className="filter-date">Show <select value={filter} onChange={e=>setFilter(e.target.value)}><option>Active</option><option>Inactive</option><option>Terminated</option><option>All</option></select></label><span className="count-tag">{items.length} employee record(s)</span></div>
  <div className="table-wrap"><table><thead><tr><th>EMPLOYEE ID</th><th>NAME</th><th>JOB TITLE / DEPARTMENT</th><th>START / END</th><th className="right">GROSS PAY</th><th>STATUS</th><th></th></tr></thead><tbody>
  {visible.map(x=><tr key={x.id}><td>{x.employee_no}</td><td className="description">{x.full_name}<small style={{display:"block",color:"#8995a3"}}>{x.phone||x.email}</small></td><td>{x.job_title||"—"}<small style={{display:"block",color:"#8995a3"}}>{x.department}</small></td><td>{x.start_date}{x.end_date&&<small style={{display:"block",color:"#8995a3"}}>to {x.end_date}</small>}</td><td className="right">{money(x.gross_salary)}</td><td><span className="type-tag">{x.status}</span></td><td><button className="secondary" onClick={()=>start(x)}><Pencil size={14}/> Edit</button></td></tr>)}
  {!visible.length&&<tr><td colSpan={7} className="empty">No employees in this view. Register an employee to begin.</td></tr>}
  </tbody></table></div>
 </section>
 {show&&<div className="modal-backdrop"><section className="panel modal" style={{maxWidth:850,width:"96%",maxHeight:"90vh",overflowY:"auto"}}><div className="panel-head"><div><h3>{editing?"Edit employee":"Register employee"}</h3><p>Employee information and payroll profile</p></div><button className="delete" onClick={()=>setShow(false)}><X size={18}/></button></div>
 <form onSubmit={submit}><div className="table-actions wrap" style={{gap:12,alignItems:"flex-end"}}>
 {field("Full name *","full_name")}{field("Phone","phone")}{field("Email","email")}{field("Job title","job_title")}{field("Department","department")}{field("Start date *","start_date","date")}{field("End date (if left)","end_date","date")}
 <label className="filter-date">Employment type<select value={draft.employment_type} onChange={e=>setDraft({...draft,employment_type:e.target.value})}>{["Permanent","Contract","Part-time","Casual","Intern"].map(x=><option key={x}>{x}</option>)}</select></label>
 <label className="filter-date">Pay frequency<select value={draft.pay_frequency} onChange={e=>setDraft({...draft,pay_frequency:e.target.value})}>{["Monthly","Weekly","Daily","Hourly"].map(x=><option key={x}>{x}</option>)}</select></label>
 {field("Gross pay (TZS)","gross_salary","number")}
 <label className="filter-date">Status<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}>{["Active","Inactive","Terminated"].map(x=><option key={x}>{x}</option>)}</select></label>
 <label className="filter-date" style={{minWidth:260}}>Notes<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
 </div><div className="table-actions" style={{justifyContent:"flex-end",marginTop:18}}><button type="button" className="secondary" onClick={()=>setShow(false)}>Cancel</button><button className="primary" disabled={busy}>{busy?"Saving…":"Save employee"}</button></div></form>
 </section></div>}
 <Advances money={money} onNotice={onNotice} onChanged={onChanged} refreshKey={items.length}/>
 <div className="note"><b>Record keeping</b><span>Changing an employee to Inactive or Terminated preserves the employee record and past payroll history. Set an end date so a final month's salary can still be paid. Employee records are separate from user accounts and do not grant application access.</span></div>
 </>;
}
