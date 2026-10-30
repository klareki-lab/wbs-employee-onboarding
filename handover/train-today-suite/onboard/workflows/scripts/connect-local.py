#!/usr/bin/env python3
"""Enable automatic local onboarding and observe one existing employee after preflight."""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
parser=argparse.ArgumentParser()
parser.add_argument('--employee-id',required=True,type=uuid.UUID)
args=parser.parse_args()
employee_id=str(args.employee_id)
env_path=ROOT/'backend/.env'
env={}
for line in env_path.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        k,v=line.split('=',1);env[k.strip()]=v.strip().strip(chr(34)+chr(39))
key=env.get('OPENAI_API_KEY') or os.environ.get('OPENAI_API_KEY')
if not key:
    raise SystemExit('Missing OPENAI_API_KEY. Add it privately to backend/.env and rerun this command. Existing employee/jobs were not changed.')

# Check actual model/tool access and billing with a tiny request before touching the employee job.
body={'model':env.get('OPENAI_MODEL','gpt-4o-mini'),'messages':[{'role':'user','content':'Call readiness_check.'}],'tools':[{'type':'function','function':{'name':'readiness_check','description':'Confirm model function-call access.','parameters':{'type':'object','properties':{}}}}],'tool_choice':{'type':'function','function':{'name':'readiness_check'}},'max_tokens':32}
req=urllib.request.Request('https://api.openai.com/v1/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
try:
    with urllib.request.urlopen(req,timeout=30) as r: result=json.load(r)
except urllib.error.HTTPError as error:
    raise SystemExit(f'OpenAI preflight failed (HTTP {error.code}). Verify the key, model access and API billing. No employee job was dispatched.') from None
except OSError:
    raise SystemExit('OpenAI preflight connection failed. No employee job was dispatched.') from None
if not result.get('choices',[{}])[0].get('message',{}).get('tool_calls'):
    raise SystemExit('Model did not confirm tool-call support. No employee job was dispatched.')
print('OpenAI model/tool-call readiness passed; no employee information sent in preflight.')

status_code="""
import {pool} from './dist/repositories/db.js';
const result=await pool.query('SELECT e.status,j.id AS job_id,j.processing_status,j.attempts,jsonb_array_length(j.attempt_history) AS archived_attempts,j.orchestration_result IS NOT NULL AS has_result FROM employees e JOIN onboarding_jobs j ON j.employee_id=e.id WHERE e.id=$1',[process.env.TARGET_EMPLOYEE_ID]);
console.log(JSON.stringify(result.rows[0]||null));await pool.end();
"""
def status():
    r=subprocess.run(['docker','exec','-i','-e','TARGET_EMPLOYEE_ID='+employee_id,'wbs-employee-onboarding-api-1','node','--input-type=module'],input=status_code.encode(),capture_output=True,check=True)
    return json.loads(r.stdout)
state=status()
if not state:
    raise SystemExit('The specified employee does not exist; no new employee was created.')
if state['has_result'] or state['processing_status'] not in ['unavailable','queued']:
    raise SystemExit('Existing job is already dispatched or terminal; inspect its status rather than replaying/resetting it.')
if state['status']!='pending':
    raise SystemExit('Employee is no longer pending; no dispatch performed.')

prepare=[sys.executable,'workflows/scripts/prepare-local.py']
if state['attempts']>0:
    if not state['archived_attempts']:
        raise SystemExit('A previous attempt must be explicitly archived by the local recovery command before retry.')
    prepare.extend(['--retry-job-id',state['job_id']])
subprocess.run(prepare,check=True)
# Preparation may have generated the independent webhook secret on a fresh setup.
for line in env_path.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        k,v=line.split('=',1);env[k.strip()]=v.strip().strip(chr(34)+chr(39))
subprocess.run([sys.executable,'workflows/scripts/import-local.py'],check=True)
result=subprocess.run(['docker','exec','wbs-employee-onboarding-n8n-1','n8n','publish:workflow','--id=wbsOnboardingLocal'],capture_output=True)
if result.returncode:raise SystemExit('Local employee workflow publication failed; dispatch stays disabled.')
subprocess.run(['docker','restart','wbs-employee-onboarding-n8n-1'],check=True,stdout=subprocess.DEVNULL)
subprocess.run([sys.executable,'workflows/scripts/check-local.py','--employee-webhook'],check=True)

updates={'N8N_ONBOARDING_WEBHOOK_URL':'http://n8n:5678/webhook/wbs-onboarding'}
lines=[line for line in env_path.read_text().splitlines() if line.split('=',1)[0] not in {*updates,'ONBOARDING_WORKER_EMPLOYEE_ID'}]
lines.extend(f'{k}={v}' for k,v in updates.items())
env_path.write_text('\n'.join(lines)+'\n');env_path.chmod(0o600)
compose=['docker','compose','--env-file','backend/.env']
# Preserve an already configured real SMTP profile during n8n bootstrap/recovery.
if (ROOT/'backend/.env.smtp').exists() and env.get('SMTP_MODE')!='capture':
    from_env={}
    for line in (ROOT/'backend/.env.smtp').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);from_env[k.strip()]=v.strip().strip(chr(34)+chr(39))
    real_smtp=all(from_env.get(k) for k in ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','SMTP_FROM']) and not from_env.get('SMTP_HOST','').endswith('.invalid')
else: real_smtp=False
if real_smtp: compose.extend(['--env-file','backend/.env.smtp'])
compose.extend(['-f','backend/compose.yaml','-f','backend/compose.n8n.yaml'])
if real_smtp: compose.extend(['-f','backend/compose.smtp.yaml'])
subprocess.run(compose+['up','--build','-d','api'],check=True)
print('Backend connected to local n8n. All eligible jobs and future registrations are dispatched automatically; the selected employee is observed only, not a worker restriction.')
for attempt in range(45):
    state=status()
    if state['processing_status'] in ['completed','failed']:
        print('Existing job processing_status:',state['processing_status'])
        if state['processing_status']=='completed':
            print('Real processing completed. HR approval is enabled; approve and send the invitation in the HR dashboard, then verify its configured delivery status and actual recipient inbox.')
        else:
            print('Processing failed. Inspect the existing job; no reset or synthetic completion was attempted.')
        break
    time.sleep(1)
else:
    print('Job is still processing; inspect the existing employee in the HR dashboard. No duplicate submission is necessary.')
