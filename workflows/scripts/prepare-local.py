#!/usr/bin/env python3
"""Prepare isolated n8n imports. Secrets stay in ignored 0600 local files."""
import json
import argparse
import subprocess
import os
import secrets
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--retry-job-id')
parser.add_argument('--env-file', type=Path)
parser.add_argument('--local-dir', type=Path)
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
LOCAL = args.local_dir or ROOT / 'workflows/.local'
BOOTSTRAP = LOCAL / 'bootstrap'
BOOTSTRAP.mkdir(parents=True, exist_ok=True)
LOCAL.chmod(0o700)
# Container uid 1000 must be able to traverse the read-only bind mount.
BOOTSTRAP.chmod(0o755)

def read_env(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip().strip('\"\'')
    return values

def private_write(path, value):
    path.write_text(value)
    path.chmod(0o600)

path = args.env_file or ROOT / 'backend/.env'
env = read_env(path)
updates = {}
for key in ['DEPARTMENTS_API_SECRET', 'N8N_ONBOARDING_WEBHOOK_SECRET']:
    if not env.get(key):
        updates[key] = secrets.token_hex(32)
if not env.get('INTERNAL_API_SECRET'):
    raise SystemExit('Configure backend INTERNAL_API_SECRET first; no secret was printed.')
if updates:
    private_write(path, path.read_text().rstrip()+'\n'+'\n'.join(f'{k}={v}' for k,v in updates.items())+'\n')
    env.update(updates)
n8n_path = LOCAL / 'n8n.env'
if not n8n_path.exists():
    private_write(n8n_path, f'N8N_ENCRYPTION_KEY={secrets.token_hex(32)}\n')

credentials = []
for id_, name, secret in [
    ('wbsOnboardingWebhook','Onboarding Webhook Secret (Header Auth)',env['N8N_ONBOARDING_WEBHOOK_SECRET']),
    ('wbsOnboardingDepartments','Departments API Secret (Header Auth)',env['DEPARTMENTS_API_SECRET']),
    ('wbsOnboardingCallback','Internal API Secret (Header Auth)',env['INTERNAL_API_SECRET'])
]:
    credentials.append({'id':id_,'name':name,'type':'httpHeaderAuth','data':{'name':'Authorization','value':'Bearer '+secret}})
key = env.get('OPENAI_API_KEY') or os.environ.get('OPENAI_API_KEY')
if key:
    credentials.append({'id':'wbsOnboardingOpenAI','name':'Onboarding OpenAI (local only)','type':'openAiApi','data':{'apiKey':key}})
private_write(BOOTSTRAP/'credentials.json',json.dumps(credentials))

workflow = json.loads((ROOT/'workflows/onboarding-webhook.json').read_text())
workflow['id']='wbsOnboardingLocal'
workflow['name']='WBS Onboarding — isolated local'
workflow['active']=False
ids={'REPLACE_OPENAI_CREDENTIAL_ID':'wbsOnboardingOpenAI','REPLACE_DEPARTMENTS_CREDENTIAL_ID':'wbsOnboardingDepartments','REPLACE_INTERNAL_API_CREDENTIAL_ID':'wbsOnboardingCallback','REPLACE_WEBHOOK_CREDENTIAL_ID':'wbsOnboardingWebhook'}
for n in workflow['nodes']:
    for c in n.get('credentials',{}).values():
        c['id']=ids[c['id']]
    if 'url' in n['parameters']:
        n['parameters']['url']=n['parameters']['url'].replace('={{ $env.BACKEND_BASE_URL }}','http://api:3001')
    if n['type'].endswith('.lmChatOpenAi'):
        n['parameters']['model']={'__rl':True,'mode':'id','value':env.get('OPENAI_MODEL','gpt-4o-mini')}
if args.retry_job_id:
    # Preserve the previous failed n8n dedup record rather than removing history.
    script="const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});const r=db.prepare('SELECT staticData FROM workflow_entity WHERE id=?').get('wbsOnboardingLocal');console.log(r?.staticData||'null');"
    result=subprocess.run(['docker','exec','wbs-employee-onboarding-n8n-1','node','-e',script],capture_output=True,check=True)
    static=json.loads(result.stdout) or {}
    global_data=static.setdefault('global',{})
    jobs=global_data.setdefault('jobs',{})
    previous=jobs.get(args.retry_job_id)
    if previous:
        if previous.get('status')!='failed':
            raise SystemExit('Only a failed dedup record may be archived for an explicit local retry.')
        global_data.setdefault('archivedAttempts',[]).append({'job_id':args.retry_job_id,'record':previous})
        del jobs[args.retry_job_id]
    workflow['staticData']=static
private_write(BOOTSTRAP/'onboarding.json',json.dumps(workflow,ensure_ascii=False))

# A real n8n connectivity workflow: authenticated reads and a rejected (non-mutating) callback.
probe={'id':'wbsOnboardingConnectivity','name':'WBS Onboarding — connectivity only','active':False,'nodes':[
 {'id':'webhook','name':'Connectivity Webhook','type':'n8n-nodes-base.webhook','typeVersion':2,'webhookId':'fb3df0e8-d447-43e4-a267-60a866d16ce1','position':[0,0], 'parameters':{'httpMethod':'POST','path':'wbs-onboarding-connectivity','authentication':'headerAuth','responseMode':'lastNode','options':{}},'credentials':{'httpHeaderAuth':{'id':'wbsOnboardingWebhook','name':'Onboarding Webhook Secret (Header Auth)'}}},
 {'id':'departments','name':'Read Departments','type':'n8n-nodes-base.httpRequest','typeVersion':4.2,'position':[200,0], 'parameters':{'url':'http://api:3001/api/internal/departments','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','options':{'timeout':10000}},'credentials':{'httpHeaderAuth':{'id':'wbsOnboardingDepartments','name':'Departments API Secret (Header Auth)'}}},
 {'id':'callback','name':'Callback Schema Probe','type':'n8n-nodes-base.httpRequest','typeVersion':4.2,'position':[400,0], 'parameters':{'method':'POST','url':'http://api:3001/api/internal/onboarding/result','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','sendBody':True,'specifyBody':'json','jsonBody':'{}','options':{'timeout':10000,'response':{'response':{'fullResponse':True,'neverError':True}}}},'credentials':{'httpHeaderAuth':{'id':'wbsOnboardingCallback','name':'Internal API Secret (Header Auth)'}}},
 {'id':'summary','name':'Connectivity Summary','type':'n8n-nodes-base.code','typeVersion':2,'position':[600,0], 'parameters':{'jsCode':"return [{json:{departments_count:$('Read Departments').first().json.data.length,callback_http_status:$json.statusCode,callback_error_code:$json.body.error.code,mutated_employee:false}}];"}}
 ],'connections':{},'settings':{'executionOrder':'v1','saveDataSuccessExecution':'none','saveDataErrorExecution':'none','saveManualExecutions':False}}
names=[n['name'] for n in probe['nodes']]
for a,b in zip(names,names[1:]):probe['connections'][a]={'main':[[{'node':b,'type':'main','index':0}]]}
private_write(BOOTSTRAP/'connectivity.json',json.dumps(probe))
print('Local encryption key, independent bearer credentials and import files prepared; secret values not displayed.')
print('OpenAI credential available: '+str(bool(key)))
print('Live employee dispatch remains disabled until credentials and workflow checks pass.')
