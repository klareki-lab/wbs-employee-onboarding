import {Router} from 'express';
import {z} from 'zod';
import rateLimit from 'express-rate-limit';
import {authenticate,csrf} from '../middleware/auth.js';
import {pool,transaction} from '../repositories/db.js';
import {ApiError} from '../middleware/errors.js';
export const crmLeadership=Router();
crmLeadership.use(authenticate,csrf,async(req,res,next)=>{
 if(!(await pool.query('SELECT 1 FROM workspace_permissions WHERE user_id=$1 AND leadership',[req.principal!.id])).rowCount)throw new ApiError(403,'LEADERSHIP_REQUIRED');next();
});
async function crm(path:string,data?:unknown){
 const base=process.env.CRM_LEADERSHIP_URL,key=process.env.CRM_LEADERSHIP_KEY;if(!base||!key)throw new ApiError(503,'CRM_NOT_CONFIGURED');
 let r:Response;try{r=await fetch(base+'/integration/leadership/'+path,{method:data?'POST':'GET',headers:{'X-Leadership-Key':key,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(path==='assistant'?60000:15000),redirect:'error'});}catch{throw new ApiError(503,'CRM_UNAVAILABLE');}
 const result=await r.json().catch(()=>({}));if(!r.ok)throw new ApiError(r.status>=500?503:r.status,typeof result.error==='string'?result.error:'CRM_REQUEST_FAILED');return result;
}
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
crmLeadership.get('/overview',async(req,res)=>{
 const data=await crm('snapshot');const absences=(await pool.query('SELECT id,crm_user_id,starts_on::text,ends_on::text,category,version FROM crm_absences WHERE NOT cancelled ORDER BY starts_on DESC')).rows;
 res.json({data:{...data,absences}});
});
crmLeadership.post('/absences',async(req,res)=>{
 const b=z.object({crm_user_id:z.uuid(),starts_on:day,ends_on:day,category:z.enum(['sick','leave','unavailable'])}).strict().parse(req.body);
 if(b.ends_on<b.starts_on)throw new ApiError(400,'INVALID_DATES');
 const snapshot=await crm('snapshot');if(!snapshot.people.some((p:{id:string})=>p.id===b.crm_user_id))throw new ApiError(400,'CRM_PERSON_NOT_FOUND');
 const result=await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,19))',[b.crm_user_id]);
  if((await db.query('SELECT 1 FROM crm_absences WHERE crm_user_id=$1 AND NOT cancelled AND starts_on<=$3 AND ends_on>=$2',[b.crm_user_id,b.starts_on,b.ends_on])).rowCount)throw new ApiError(409,'ABSENCE_OVERLAP');
  const row=(await db.query('INSERT INTO crm_absences(crm_user_id,starts_on,ends_on,category,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[b.crm_user_id,b.starts_on,b.ends_on,b.category,req.principal!.id])).rows[0];
  await db.query("INSERT INTO crm_leadership_events(actor_id,action,detail) VALUES($1,'absence_created',$2)",[req.principal!.id,{id:row.id,...b}]);return row;
 });res.status(201).json({data:result});
});
crmLeadership.post('/absences/:id/cancel',async(req,res)=>{
 const id=z.uuid().parse(req.params.id),{version}=z.object({version:z.number().int().positive()}).strict().parse(req.body);
 await transaction(async db=>{const r=await db.query('UPDATE crm_absences SET cancelled=true,version=version+1 WHERE id=$1 AND version=$2 AND NOT cancelled RETURNING id',[id,version]);if(!r.rowCount)throw new ApiError(409,'ABSENCE_CHANGED');await db.query("INSERT INTO crm_leadership_events(actor_id,action,detail) VALUES($1,'absence_cancelled',$2)",[req.principal!.id,{id}]);});res.json({data:{ok:true}});
});
crmLeadership.post('/reassign',async(req,res)=>{
 const b=z.object({request_id:z.uuid(),id:z.uuid(),version:z.number().int().positive(),assignee_id:z.uuid(),reason:z.string().trim().min(5).max(1000),grant_project_access:z.boolean()}).strict().parse(req.body);
 if((await pool.query("SELECT 1 FROM crm_absences WHERE crm_user_id=$1 AND NOT cancelled AND starts_on<=(now() AT TIME ZONE 'Europe/Berlin')::date AND ends_on>=(now() AT TIME ZONE 'Europe/Berlin')::date",[b.assignee_id])).rowCount)throw new ApiError(409,'Die ausgewählte Vertretung ist heute als abwesend hinterlegt.');
 const result=await crm('reassign',{...b,actor:req.principal!.username+' ('+req.principal!.id+')'});
 res.json({data:result});
});
crmLeadership.get('/assistant/history',async(req,res)=>{
 const project=req.query.project_id?z.uuid().parse(req.query.project_id):null;
 const rows=(await pool.query('SELECT id,question,response,created_at FROM crm_assistant_messages WHERE user_id=$1 AND project_id IS NOT DISTINCT FROM $2::uuid ORDER BY id DESC LIMIT 20',[req.principal!.id,project])).rows.reverse();res.json({data:rows});
});
crmLeadership.post('/assistant',rateLimit({windowMs:60000,limit:8,keyGenerator:req=>req.principal!.id,standardHeaders:true,legacyHeaders:false}),async(req,res)=>{
 const b=z.object({question:z.string().trim().min(1).max(2000),project_id:z.uuid().nullable().optional()}).strict().parse(req.body);
 const history=(await pool.query('SELECT question,response->>\'answer\' AS answer FROM crm_assistant_messages WHERE user_id=$1 AND project_id IS NOT DISTINCT FROM $2::uuid ORDER BY id DESC LIMIT 4',[req.principal!.id,b.project_id||null])).rows.reverse();
 const result=await crm('assistant',{...b,history});
 await pool.query('INSERT INTO crm_assistant_messages(user_id,project_id,question,response) VALUES($1,$2,$3,$4)',[req.principal!.id,b.project_id||null,b.question,result]);res.json({data:result});
});
