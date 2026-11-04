import fs from 'node:fs';
import {spawn} from 'node:child_process';
const access=fs.readFileSync(0,'utf8'),env={...process.env,PORT:'3081',TEST_BASE:'http://localhost:3081',AI_API_KEY:'',CORE_BASE_URL:''};
for(const key of ['DATABASE_URL','AGENT_DATABASE_URL']){const u=new URL(env[key]);if(u.hostname!=='db'||u.pathname!=='/crm')throw Error('Nur im lokalen CRM-Container starten.');u.pathname='/crm_regression_20261025';env[key]=u.href;}
const names=process.argv.slice(2);if(names.some(n=>!['integration','workspace','projects'].includes(n)))throw Error('Unbekannte Prüfsuite.');
const server=spawn(process.execPath,['src/server.mjs'],{env,stdio:['ignore','ignore','pipe']});let serverError='';server.stderr.on('data',d=>serverError+=d.toString());
const report=[];
try{
 let ready=false;for(let i=0;i<40;i++){if(server.exitCode!==null)throw Error('Prüfserver konnte nicht starten: '+serverError);try{if((await fetch(env.TEST_BASE+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw Error('Prüfserver nicht bereit.');
 for(const name of names){const exit=await new Promise(resolve=>{const child=spawn(process.execPath,['tests/'+name+'.mjs'],{env,stdio:['pipe','inherit','inherit']});child.stdin.end(access);child.on('exit',resolve);});report.push({suite:name,exit_code:exit});if(exit)process.exitCode=1;}
}finally{server.kill('SIGTERM');fs.writeFileSync('/tmp/crm-regression-runs.json',JSON.stringify({at:new Date().toISOString(),database:'crm_regression_20261025',suites:report},null,2));}
