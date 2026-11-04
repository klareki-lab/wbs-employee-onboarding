import { Router } from 'express';
import { z } from 'zod';
import { authenticate, csrf } from '../middleware/auth.js';
import { pool, transaction } from '../repositories/db.js';
import { ApiError } from '../middleware/errors.js';
export const workspace=Router();
workspace.use(authenticate,csrf);
async function admin(id:string){return !!(await pool.query('SELECT 1 FROM workspace_permissions WHERE user_id=$1 AND system_admin=true',[id])).rowCount;}
workspace.get('/profile',async(req,res)=>{
 const p=req.principal!;
 res.json({data:{username:p.username,role:p.account_role,employeeId:p.employee_id,systemAdmin:await admin(p.id),leadership:!!(await pool.query('SELECT 1 FROM workspace_permissions WHERE user_id=$1 AND leadership',[p.id])).rowCount,csrf:p.csrf_token}});
});
workspace.get('/rules',async(req,res)=>{
 res.json({data:(await pool.query('SELECT r.*,a.acknowledged_at FROM company_rules r LEFT JOIN rule_acknowledgements a ON a.rule_id=r.id AND a.version=r.version AND a.user_id=$1 ORDER BY r.position',[req.principal!.id])).rows});
});
workspace.post('/rules/:id/acknowledge',async(req,res)=>{
 const result=await pool.query('INSERT INTO rule_acknowledgements(user_id,rule_id,version) SELECT $1,id,version FROM company_rules WHERE id=$2 ON CONFLICT DO NOTHING RETURNING rule_id',[req.principal!.id,req.params.id]);
 if(!result.rowCount && !(await pool.query('SELECT 1 FROM company_rules WHERE id=$1',[req.params.id])).rowCount)throw new ApiError(404,'RULE_NOT_FOUND');
 res.json({data:{ok:true}});
});
workspace.get('/team',async(req,res)=>{
 const p=req.principal!;
 const dept=p.employee_id?(await pool.query('SELECT department FROM employees WHERE id=$1',[p.employee_id])).rows[0]?.department:'Personal';
 const colleagues=(await pool.query('SELECT id,first_name,last_name,role,department FROM employees WHERE department=$1 AND ($2::uuid IS NULL OR id<>$2) ORDER BY last_name,first_name',[dept,p.employee_id])).rows;
 res.json({data:{department:dept,colleagues,contact:(await pool.query('SELECT team_lead FROM departments WHERE name=$1',[dept])).rows[0]?.team_lead||'Personalabteilung'}});
});
workspace.get('/accesses',async(req,res)=>{
 const p=req.principal!,isAdmin=await admin(p.id),manage=req.query.manage==='1';
 if(manage&&!isAdmin)throw new ApiError(403,'FORBIDDEN');
 const entries=(await pool.query(`SELECT a.id,a.employee_id,a.system_name,a.username,a.login_url,a.status,a.updated_at,e.first_name,e.last_name,e.department
 FROM employee_accesses a JOIN employees e ON e.id=a.employee_id WHERE ($1::boolean OR a.employee_id=$2) ORDER BY e.last_name,a.system_name`,[manage,p.employee_id])).rows;
 res.json({data:{entries,portal:manage?null:{system_name:'Train Today Onboard',username:p.username,login_url:'http://localhost:5173/login',status:'active'},systemAdmin:isAdmin}});
});
workspace.patch('/accesses/:id',async(req,res)=>{
 const p=req.principal!;if(!await admin(p.id))throw new ApiError(403,'FORBIDDEN');
 const data=z.object({username:z.string().trim().max(160),login_url:z.string().trim().max(500),status:z.enum(['requested','in_progress','active','blocked','disabled']),evidence:z.string().trim().min(8).max(2000)}).strict().parse(req.body);
 if(data.login_url){let url:URL;try{url=new URL(data.login_url);}catch{throw new ApiError(400,'INVALID_URL');}if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='localhost'))throw new ApiError(400,'INVALID_URL');if(url.username||url.password)throw new ApiError(400,'INVALID_URL');}
 if(data.status==='active'&&(!data.username||!data.login_url))throw new ApiError(400,'ACCESS_DETAILS_REQUIRED');
 const id=z.uuid().parse(req.params.id);
 await transaction(async db=>{
  const r=await db.query('UPDATE employee_accesses SET username=$1,login_url=$2,status=$3,evidence=$4,updated_by=$5,updated_at=now() WHERE id=$6 RETURNING id',[data.username,data.login_url,data.status,data.evidence,p.id,id]);
  if(!r.rowCount)throw new ApiError(404,'ACCESS_NOT_FOUND');
  await db.query('INSERT INTO access_events(access_id,actor,status,evidence) VALUES($1,$2,$3,$4)',[id,p.id,data.status,data.evidence]);
 });res.json({data:{ok:true}});
});

workspace.get('/management-roster',async(req,res)=>{
 const p=req.principal!;
 if(p.account_role!=='hr'&&!(await pool.query('SELECT 1 FROM workspace_permissions WHERE user_id=$1 AND leadership',[p.id])).rowCount)throw new ApiError(403,'FORBIDDEN');
 res.json({data:(await pool.query('SELECT id,first_name,last_name,department,role,start_date::text FROM employees ORDER BY last_name,first_name')).rows});
});

// Task execution uses the same browser session and CSRF checks as access management.
workspace.post('/task-access',async(req,res)=>{
 const p=req.principal!,isAdmin=await admin(p.id);
 const b=z.object({employeeId:z.uuid(),taskId:z.string(),username:z.string().trim().min(1).max(160),url:z.string().max(500),scope:z.string().trim().min(1).max(1000)}).strict().parse(req.body);
 const systems:Record<string,string>={G05:'Google Workspace',G09:'NordPass',G10:'voiio',G11:'DataGuard',M01:'HubSpot Marketing Hub',M02:'Canva Pro',M03:'Buffer',M04:'Google Ad Manager',M05:'NordPass · Marketing'};
 const system=systems[b.taskId];
 if(!system||(!isAdmin&&!(p.account_role==='hr'&&['G10','G11','M01','M02','M03','M04'].includes(b.taskId))))throw new ApiError(403,'FORBIDDEN');
 let url:URL;try{url=new URL(b.url);}catch{throw new ApiError(400,'INVALID_URL');}
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='localhost'))||url.username||url.password)throw new ApiError(400,'INVALID_URL');
 await transaction(async db=>{
  if(!(await db.query('SELECT id FROM employees WHERE id=$1',[b.employeeId])).rowCount)throw new ApiError(404,'EMPLOYEE_NOT_FOUND');
  const evidence=`Aufgabe ${b.taskId}: ${b.scope}`;
  const r=await db.query(`INSERT INTO employee_accesses(employee_id,system_name,username,login_url,status,evidence,updated_by)
    VALUES($1,$2,$3,$4,'active',$5,$6) ON CONFLICT(employee_id,system_name) DO UPDATE SET username=$3,login_url=$4,status='active',evidence=$5,updated_by=$6,updated_at=now()
    WHERE (employee_accesses.username,employee_accesses.login_url,employee_accesses.status,employee_accesses.evidence) IS DISTINCT FROM ($3,$4,'active',$5) RETURNING id`,[b.employeeId,system,b.username,url.href,evidence,p.id]);
  if(r.rowCount)await db.query('INSERT INTO access_events(access_id,actor,status,evidence) VALUES($1,$2,$3,$4)',[r.rows[0].id,p.id,'active',evidence]);
 });res.json({data:{ok:true,system}});
});

workspace.get('/portal-check/:employeeId',async(req,res)=>{
 const p=req.principal!;if(p.account_role!=='hr'&&!await admin(p.id))throw new ApiError(403,'FORBIDDEN');
 const id=z.uuid().parse(req.params.employeeId);
 const r=await pool.query(`SELECT u.username,u.account_role,e.department,e.status FROM employees e LEFT JOIN user_accounts u ON u.employee_id=e.id WHERE e.id=$1`,[id]);
 if(!r.rowCount)throw new ApiError(404,'EMPLOYEE_NOT_FOUND');
 res.json({data:{...r.rows[0],ready:!!r.rows[0].username&&r.rows[0].account_role==='employee'&&r.rows[0].status==='active'}});
});

