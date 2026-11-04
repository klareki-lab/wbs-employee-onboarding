import pg from 'pg';
import {createHmac} from 'node:crypto';
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,statement_timeout:10000});
export const reader=new pg.Pool({connectionString:process.env.AGENT_DATABASE_URL,max:3,statement_timeout:5000});
export async function transaction(user,fn,readOnly=false){
 const c=await(readOnly?reader:pool).connect();
 try{await c.query('BEGIN');const signature=createHmac('sha256',process.env.INTERNAL_KEY).update(user.id).digest('hex');await c.query("SELECT set_config('crm.actor_id',$1,true),set_config('crm.actor_signature',$2,true)",[user.id,signature]);const result=await fn(c);await c.query('COMMIT');return result;}
 catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
export function manager(u){if(!['manager','admin'].includes(u.role))fail('Nur die Geschäftsführung darf diese Aktion ausführen.',403);}
export async function audit(c,u,action,id,before,after,reason=''){await c.query('INSERT INTO crm.audit(actor_id,action,record_id,before_data,after_data,reason) VALUES($1,$2,$3,$4,$5,$6)',[u.id,action,id,before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after),reason]);}
export async function record(c,id,kind){if(!uuid.test(id||''))fail('Ungültige Datensatz-ID.');const shared=['company','event','service','availability','task_template'].includes(kind);const r=(await c.query('SELECT * FROM crm.records WHERE id=$1'+(shared?'':' FOR UPDATE'),[id])).rows[0];if(!r||kind&&r.kind!==kind)fail('Datensatz nicht gefunden oder nicht freigegeben.',404);return r;}
export async function add(c,u,kind,data,project=null,owner=u.id){return(await c.query('INSERT INTO crm.records(kind,project_id,owner_id,data,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[kind,project,owner,data,u.id])).rows[0];}
export async function put(c,r,data){return(await c.query('UPDATE crm.records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[r.id,data])).rows[0];}
