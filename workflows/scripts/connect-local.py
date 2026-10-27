#!/usr/bin/env python3
"""Enable one existing employee's real AI run after credential/network preflight."""
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
const result=await pool.query('SELECT e.status,j.processing_status,j.attempts,j.orchestration_result IS NOT NULL AS has_result FROM employees e JOIN onboarding_jobs j ON j.employee_id=e.id WHERE e.id=$1',[process.env.TARGET_EMPLOYEE_ID]);
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

subprocess.run([sys.executable,'workflows/scripts/prepare-local.py'],check=True)
# Preparation may have generated the independent webhook secret on a fresh setup.
for line in env_path.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        k,v=line.split('=',1);env[k.strip()]=v.strip().strip(chr(34)+chr(39))
subprocess.run([sys.executable,'workflows/scripts/import-local.py'],check=True)
result=subprocess.run(['docker','exec','wbs-employee-onboarding-n8n-1','n8n','publish:workflow','--id=wbsOnboardingLocal'],capture_output=True)
if result.returncode:raise SystemExit('Local employee workflow publication failed; dispatch stays disabled.')
subprocess.run(['docker','restart','wbs-employee-onboarding-n8n-1'],check=True,stdout=subprocess.DEVNULL)
subprocess.run([sys.executable,'workflows/scripts/check-local.py'],check=True)

# Confirm the actual employee webhook is registered and its deterministic validation runs.
req=urllib.request.Request('http://localhost:5681/webhook/wbs-onboarding',data=b'{}',headers={'Authorization':'Bearer '+env['N8N_ONBOARDING_WEBHOOK_SECRET'],'Content-Type':'application/json'})
try:
    urllib.request.urlopen(req,timeout=15)
    raise SystemExit('Unexpected webhook acceptance of invalid body; dispatch stays disabled.')
except urllib.error.HTTPError as error:
    if error.code!=400:raise SystemExit(f'Employee webhook preflight failed (HTTP {error.code}); dispatch stays disabled.') from None

updates={'N8N_ONBOARDING_WEBHOOK_URL':'http://n8n:5678/webhook/wbs-onboarding','ONBOARDING_WORKER_EMPLOYEE_ID':employee_id}
lines=[line for line in env_path.read_text().splitlines() if line.split('=',1)[0] not in updates]
lines.extend(f'{k}={v}' for k,v in updates.items())
env_path.write_text('\n'.join(lines)+'\n');env_path.chmod(0o600)
subprocess.run(['docker','compose','--env-file','backend/.env','-f','backend/compose.yaml','-f','backend/compose.n8n.yaml','up','--build','-d','api'],check=True)
print('Backend connected to local n8n. Only the selected existing employee is eligible for dispatch; no registration was created.')
for attempt in range(45):
    state=status()
    if state['processing_status'] in ['completed','failed']:
        print('Existing job processing_status:',state['processing_status'])
        if state['processing_status']=='completed':
            print('Real processing completed. HR approval is enabled; approve and send the invitation in the HR dashboard, then open it in Mailpit.')
        else:
            print('Processing failed. Inspect the existing job; no reset or synthetic completion was attempted.')
        break
    time.sleep(1)
else:
    print('Job is still processing; inspect the existing employee in the HR dashboard. No duplicate submission is necessary.')
