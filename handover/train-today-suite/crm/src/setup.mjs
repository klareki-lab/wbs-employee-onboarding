import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const secret=()=>randomBytes(24).toString('hex');
if(fs.existsSync(path.join(root,'.env'))) { console.log('Konfiguration existiert bereits; keine Zugangsdaten geändert.'); process.exit(0); }
const env={DB_OWNER_PASSWORD:secret(),DB_APP_PASSWORD:secret(),DB_AGENT_PASSWORD:secret(),INTERNAL_KEY:secret(),CORE_KEY:secret(),CORE_BASE_URL:''};
fs.writeFileSync(path.join(root,'.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
const accounts=[['leitung','Mara Winter','manager'],['anna','Anna Berger','advisor'],['ben','Ben Richter','advisor'],['cem','Cem Yilmaz','advisor'],['dora','Dora Neumann','advisor'],['eva','Eva Sommer','advisor']];
let sql=`ALTER ROLE crm_app PASSWORD '${env.DB_APP_PASSWORD}';\nALTER ROLE crm_agent PASSWORD '${env.DB_AGENT_PASSWORD}';\n`;
let access='TRAIN TODAY CRM – ausschließlich lokale Testzugänge\nhttp://localhost:3080\nNicht weitergeben oder auf Neon übernehmen.\n\n';
for(const [login,name,role] of accounts){const pw=secret().slice(0,18);sql+=`INSERT INTO crm.users(login,name,role,password_hash) VALUES('${login}','${name}','${role}',crypt('${pw}',gen_salt('bf',10)));\n`;access+=`${name} (${login}): ${pw}\n`;}
for(const role of ['crm_capture','crm_worker','crm_status','crm_operator']) {const pw=secret();sql+=`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${pw}';\n`;env[role.toUpperCase()+'_PASSWORD']=pw;}
fs.writeFileSync(path.join(root,'.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
fs.writeFileSync(path.join(root,'sql/002-local-passwords.sql'),sql);
fs.writeFileSync(path.join(root,'sql/008-local-authority.sql'),`INSERT INTO crm.private_settings(key,value) VALUES('context_key','${env.INTERNAL_KEY}') ON CONFLICT(key) DO NOTHING;\n`);
fs.writeFileSync(path.join(root,'LOKALE-ZUGAENGE.txt'),access);
const src='C:/Users/jurib/Desktop/N8N/trade_fair_assistant';
for(const [from,to] of [['trade_fair_schema.sql','010-core-schema.sql'],['migrations/002_processing.sql','011-core-processing.sql']])if(!fs.existsSync(path.join(root,'sql',to)))fs.copyFileSync(path.join(src,from),path.join(root,'sql',to));
if(!fs.existsSync(path.join(root,'sql/012-core-grants.sql')))fs.writeFileSync(path.join(root,'sql/012-core-grants.sql'),`\\set app_role crm_capture\n\\set app_database crm\n`+fs.readFileSync(path.join(src,'ops/grant_app_role.sql'),'utf8')+`\n\\set worker_role crm_worker\n\\set status_role crm_status\n\\set operator_role crm_operator\n`+fs.readFileSync(path.join(src,'ops/grant_processing_roles.sql'),'utf8'));
if(!fs.existsSync(path.join(root,'src/demo-conversations.json')))fs.copyFileSync(path.join(root,'../testpaket-02/alle-40-messegespraeche.json'),path.join(root,'src/demo-conversations.json'));
console.log('Lokale Konfiguration, sechs Testzugänge und unveränderte Kopien von Sergiis Schema angelegt.');
