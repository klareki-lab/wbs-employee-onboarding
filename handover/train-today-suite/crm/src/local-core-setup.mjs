// Initializes ONLY the dedicated CRM n8n container on localhost:5682.
// Core algorithms stay unchanged. Test-only overlays replace provider URLs and schedule frequency.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const file=path.join(root,'.local-n8n.json');let local=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)): {email:'crm-owner@example.test',password:'Crm!'+randomBytes(18).toString('hex'),workflows:[],credentials:{}};
fs.writeFileSync(file,JSON.stringify(local,null,2));
let cookie='';
async function call(route,data,method=data?'POST':'GET'){const r=await fetch('http://localhost:5682'+route,{method,headers:{'Content-Type':'application/json',Origin:'http://localhost:5682',...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});const set=r.headers.getSetCookie();if(set.length)cookie=set.map(v=>v.split(';')[0]).join('; ');const d=await r.json();if(!r.ok)throw Error(route+' HTTP '+r.status+' '+JSON.stringify(d).slice(0,300));return d.data??d;}
try{await call('/rest/login',{emailOrLdapLoginId:local.email,password:local.password});}catch{await call('/rest/owner/setup',{email:local.email,firstName:'CRM',lastName:'Local',password:local.password});}
async function credential(key,name,type,data){if(local.credentials[key])return local.credentials[key];const r=await call('/rest/credentials',{name,type,data});const value={id:r.id,name:r.name};local.credentials[key]=value;fs.writeFileSync(file,JSON.stringify(local,null,2));return value;}
for(const [key,role]of [['capture','crm_capture'],['worker','crm_worker'],['status','crm_status']])await credential(key,'CRM Lokal PostgreSQL '+key,'postgres',{host:'db',port:5432,database:'crm',user:role,password:env[role.toUpperCase()+'_PASSWORD'],ssl:'disable',allowUnauthorizedCerts:false,maxConnections:4});
await credential('gateway','CRM Lokal Gateway','httpHeaderAuth',{name:'X-Trade-Fair-Key',value:env.CORE_KEY});
await credential('mock','CRM Lokal ausschließlich Testdienste','httpHeaderAuth',{name:'Authorization',value:'Bearer local-fixture-only'});
await credential('internal','CRM Lokaler interner Dienst','httpHeaderAuth',{name:'X-CRM-Internal-Key',value:env.INTERNAL_KEY});
for(const f of fs.readdirSync(path.join(root,'workflows')).filter(x=>/^0[1-9]-.*\.json$/.test(x))){if(local.workflows.some(w=>w.file===f))continue;const w=JSON.parse(fs.readFileSync(path.join(root,'workflows',f)));w.name+=' [LOKAL · TESTDIENSTE]';w.settings={...w.settings,saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false};
 for(const n of w.nodes){if(n.type==='n8n-nodes-base.postgres')n.credentials={postgres:local.credentials[f.startsWith('01')?'capture':f.startsWith('03')?'status':'worker']};
 if(n.type==='n8n-nodes-base.webhook'&&n.parameters.authentication==='headerAuth')n.credentials={httpHeaderAuth:local.credentials.gateway};
 const route={'Research Company':'tavily','Extract Meeting Notes':'openai','Send Sales Report':'resend'}[n.name];if(route){n.parameters.url='http://mock-providers:3090/'+route;n.parameters.authentication='genericCredentialType';n.parameters.genericAuthType='httpHeaderAuth';delete n.parameters.nodeCredentialType;n.credentials={httpHeaderAuth:local.credentials.mock};}
 if(n.type==='n8n-nodes-base.httpRequest'&&n.parameters.url?.startsWith('http://host.docker.internal:3080')){n.parameters.url=n.parameters.url.replace('http://host.docker.internal:3080','http://app:3080');if(n.credentials)n.credentials={httpHeaderAuth:local.credentials.internal};}
 if(n.type==='n8n-nodes-base.scheduleTrigger')n.parameters={rule:{interval:[{field:'seconds',secondsInterval:10}]}};
 }
 const created=await call('/rest/workflows',w);local.workflows.push({file:f,id:created.id,name:created.name});fs.writeFileSync(file,JSON.stringify(local,null,2));await call('/rest/workflows/'+created.id+'/activate',{versionId:created.versionId});
}
env.CORE_BASE_URL='http://n8n-crm:5678/webhook';env.CORE_MODE='local_mock';fs.writeFileSync(path.join(root,'.env'),Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n');
fs.writeFileSync(path.join(root,'local-n8n-result.json'),JSON.stringify({url:'http://localhost:5682',mode:'Local fixture providers; no external calls or email',workflows:local.workflows},null,2));
console.log(`${local.workflows.length} Workflows in der separaten lokalen CRM-n8n-Instanz eingerichtet. Anbieteraufrufe werden ausschließlich lokal simuliert.`);
