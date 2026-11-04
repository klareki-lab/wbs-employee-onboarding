import pg from 'pg';
export const pool=new pg.Pool();
// One coordinator owns the in-memory working set; Postgres is the durable source.
const owner=await pool.connect();
if(!(await owner.query('SELECT pg_try_advisory_lock(30102026) AS acquired')).rows[0].acquired)throw new Error('Coordinator already running');
owner.on('error',()=>process.exit(1));
await pool.query(`CREATE TABLE IF NOT EXISTS coordinator_cases (
 id uuid PRIMARY KEY, document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS coordinator_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, case_id uuid REFERENCES coordinator_cases(id),
 actor text NOT NULL, kind text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS coordinator_mail (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES coordinator_cases(id), kind text NOT NULL,
 recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE(case_id,kind));`);
await pool.query("UPDATE coordinator_mail SET status='unknown' WHERE status='sending'");
export const cases=new Map((await pool.query('SELECT id,document FROM coordinator_cases ORDER BY document->>\'createdAt\'')).rows.map(r=>[r.id,r.document]));
let tail=Promise.resolve();
export function save(c,actor='system',kind='state',detail={},mail=null){
 c.updatedAt=new Date().toISOString();
 const snapshot=JSON.stringify(c);
 const operation=tail.then(async()=>{const db=await pool.connect();try{
  await db.query('BEGIN');
  await db.query('INSERT INTO coordinator_cases(id,document) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET document=$2,updated_at=now()',[c.id,snapshot]);
  await db.query('INSERT INTO coordinator_events(case_id,actor,kind,detail) VALUES($1,$2,$3,$4)',[c.id,actor,kind,JSON.stringify(detail)]);
  if(mail)await db.query('INSERT INTO coordinator_mail(id,case_id,kind,recipient,subject,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(case_id,kind) DO NOTHING',[mail.id,c.id,mail.kind,mail.recipient,mail.subject,mail.body]);
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');setImmediate(()=>process.exit(1));throw e;}finally{db.release();}});
 tail=operation.catch(()=>{});return operation;
}
for(const c of cases.values())if(['running','deciding'].includes(c.status)){
 c.status='error';c.error='Dienst wurde während der Verarbeitung unterbrochen. n8n-Ausführung prüfen; keine automatische Wiederholung.';
 for(const r of c.runs||[]){r.capability=null;if(['starting','running'].includes(r.status))r.status='interrupted';}
 await save(c,'system','restart-interrupted');
}
export async function messages(id){return (await pool.query('SELECT id,kind,recipient,subject,body,status,created_at,sent_at FROM coordinator_mail WHERE case_id=$1 ORDER BY created_at',[id])).rows;}
