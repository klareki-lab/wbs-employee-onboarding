import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authenticate, csrf } from '../middleware/auth.js';
import { pool, transaction } from '../repositories/db.js';
import { ApiError } from '../middleware/errors.js';
export const chat=Router();
chat.use(authenticate,csrf);
const display="COALESCE(NULLIF(concat_ws(' ',e.first_name,e.last_name),''),u.username)";
async function member(conversation:string,user:string){
 if(!(await pool.query('SELECT 1 FROM chat_members WHERE conversation_id=$1 AND user_id=$2',[conversation,user])).rowCount)throw new ApiError(404,'CHAT_NOT_FOUND');
}
async function isAdmin(user:string){return !!(await pool.query('SELECT 1 FROM workspace_permissions WHERE user_id=$1 AND system_admin',[user])).rowCount;}
chat.get('/bootstrap',async(req,res)=>{
 const p=req.principal!;
 const users=(await pool.query(`SELECT u.id,u.username,${display} AS name,COALESCE(e.department,'Personal') AS department,COALESCE(e.role,'HR-Administration') AS position FROM user_accounts u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id<>$1 AND (u.account_role='hr' OR e.status='active') ORDER BY name`,[p.id])).rows;
 res.json({data:{selfId:p.id,csrf:p.csrf_token,canCreateGroup:await isAdmin(p.id),users}});
});
chat.get('/conversations',async(req,res)=>{
 const rows=(await pool.query(`SELECT c.id,c.kind,c.title,c.created_at,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',${display},'department',COALESCE(e.department,'Personal')) ORDER BY u.username) FROM chat_members cm JOIN user_accounts u ON u.id=cm.user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE cm.conversation_id=c.id),'[]'::jsonb) AS members,
 (SELECT body FROM chat_messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) AS preview,
 COALESCE((SELECT created_at FROM chat_messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1),c.created_at) AS updated_at,
 (SELECT count(*)::int FROM chat_messages WHERE conversation_id=c.id AND sender_id<>$1 AND id>mine.last_read_id) AS unread
 FROM chat_conversations c JOIN chat_members mine ON mine.conversation_id=c.id AND mine.user_id=$1 ORDER BY updated_at DESC,c.id`,[req.principal!.id])).rows;
 res.json({data:rows});
});
chat.post('/direct',async(req,res)=>{
 const p=req.principal!,{user_id:other}=z.object({user_id:z.uuid()}).strict().parse(req.body);
 if(other===p.id)throw new ApiError(400,'SELF_CHAT_NOT_ALLOWED');
 const key=[p.id,other].sort().join(':');
 const id=await transaction(async db=>{
  if(!(await db.query("SELECT 1 FROM user_accounts u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=$1 AND (u.account_role='hr' OR e.status='active')",[other])).rowCount)throw new ApiError(404,'USER_NOT_FOUND');
  const c=(await db.query("INSERT INTO chat_conversations(kind,direct_key,created_by) VALUES('direct',$1,$2) ON CONFLICT(direct_key) DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id",[key,p.id])).rows[0];
  await db.query('INSERT INTO chat_members(conversation_id,user_id) VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING',[c.id,p.id,other]);return c.id;
 });res.json({data:{id}});
});
chat.post('/groups',async(req,res)=>{
 const p=req.principal!;if(!await isAdmin(p.id))throw new ApiError(403,'GROUP_CREATION_IT_ONLY');
 const input=z.object({title:z.string().trim().min(1).max(100),user_ids:z.array(z.uuid()).min(1).max(40)}).strict().parse(req.body);
 const ids=[...new Set([p.id,...input.user_ids])];if(ids.length<2)throw new ApiError(400,'MEMBERS_REQUIRED');
 const id=await transaction(async db=>{
  const found=await db.query("SELECT u.id FROM user_accounts u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=ANY($1::uuid[]) AND (u.account_role='hr' OR e.status='active')",[ids]);
  if(found.rowCount!==ids.length)throw new ApiError(400,'INVALID_MEMBERS');
  const c=(await db.query("INSERT INTO chat_conversations(kind,title,created_by) VALUES('group',$1,$2) RETURNING id",[input.title,p.id])).rows[0];
  await db.query('INSERT INTO chat_members(conversation_id,user_id) SELECT $1,unnest($2::uuid[])',[c.id,ids]);return c.id;
 });res.status(201).json({data:{id}});
});
chat.get('/:id/messages',async(req,res)=>{
 const id=z.uuid().parse(req.params.id),before=z.string().regex(/^[1-9][0-9]{0,18}$/).optional().parse(req.query.before);
 await member(id,req.principal!.id);
 const rows=(await pool.query(`SELECT m.id::text,m.sender_id,m.body,m.created_at,${display} AS sender_name FROM chat_messages m JOIN user_accounts u ON u.id=m.sender_id LEFT JOIN employees e ON e.id=u.employee_id WHERE m.conversation_id=$1 AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 61`,[id,before||null])).rows;
 res.json({data:{messages:rows.slice(0,60).reverse(),hasMore:rows.length>60}});
});
const messageLimit=rateLimit({windowMs:60000,limit:60,keyGenerator:req=>req.principal!.id,standardHeaders:true,legacyHeaders:false,message:{error:{code:'CHAT_RATE_LIMIT'}}});
chat.post('/:id/messages',messageLimit,async(req,res)=>{
 const id=z.uuid().parse(req.params.id),p=req.principal!;
 await member(id,p.id);
 const input=z.object({body:z.string().trim().min(1).max(4000),client_id:z.uuid()}).strict().parse(req.body);
 const row=(await pool.query('INSERT INTO chat_messages(conversation_id,sender_id,client_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(conversation_id,sender_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id RETURNING id::text,sender_id,body,created_at',[id,p.id,input.client_id,input.body])).rows[0];
 res.status(201).json({data:row});
});
chat.post('/:id/read',async(req,res)=>{
 const id=z.uuid().parse(req.params.id),p=req.principal!;
 await member(id,p.id);
 const {last_message_id}=z.object({last_message_id:z.string().regex(/^[1-9][0-9]{0,18}$/)}).strict().parse(req.body);
 if(!(await pool.query('SELECT 1 FROM chat_messages WHERE conversation_id=$1 AND id=$2',[id,last_message_id])).rowCount)throw new ApiError(400,'MESSAGE_NOT_FOUND');
 await pool.query('UPDATE chat_members SET last_read_id=GREATEST(last_read_id,$3::bigint) WHERE conversation_id=$1 AND user_id=$2',[id,p.id,last_message_id]);res.json({data:{ok:true}});
});
