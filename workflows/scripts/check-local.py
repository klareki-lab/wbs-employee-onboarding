#!/usr/bin/env python3
"""Non-mutating n8n/API/Mailpit checks. No bearer, employee data or tokens are printed."""
import json
import argparse
import urllib.request
import urllib.error
import time
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--employee-webhook',action='store_true')
args=parser.parse_args()
ROOT=Path(__file__).resolve().parents[2]
env={}
for line in (ROOT/'backend/.env').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        k,v=line.split('=',1);env[k.strip()]=v.strip().strip(chr(34)+chr(39))

def request(url, data=None, bearer=None):
    headers={'Content-Type':'application/json'}
    if bearer: headers['Authorization']='Bearer '+bearer
    req=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=20) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:
        raw=e.read()
        try:body=json.loads(raw)
        except ValueError:body={}
        return e.code,body

for attempt in range(30):
    try:
        ready,_=request('http://localhost:5681/healthz/readiness')
        if ready==200: break
    except (OSError, ValueError): pass
    time.sleep(1)
else: raise SystemExit('Local n8n did not become ready within 30 seconds')

code,_=request('http://localhost:5681/webhook/wbs-onboarding-connectivity',{})
assert code in [401,403],f'Unexpected unauthenticated webhook status: {code}'
print('n8n webhook rejects missing credential:',code)
code,body=request('http://localhost:5681/webhook/wbs-onboarding-connectivity',{},env['N8N_ONBOARDING_WEBHOOK_SECRET'])
assert code==200,f'Connectivity workflow failed with HTTP {code}'
if isinstance(body,list):body=body[0]
assert body.get('departments_count')==3,'Department lookup did not return the expected registry'
assert body.get('callback_http_status')==400,'Callback authentication or schema validation failed'
assert body.get('callback_error_code')=='VALIDATION_ERROR','Expected schema rejection, not a state mutation'
print('n8n → authenticated department lookup:',body['departments_count'],'departments')
print('n8n → authenticated callback: schema rejected empty body (400); no employee/job mutation')
code,health=request('http://localhost:3009/health')
assert code==200
print('Backend health:',health['data']['status'])
code,_=request('http://localhost:8025/api/v1/info')
assert code==200
print('Mailpit HTTP API reachable')

if args.employee_webhook:
    url='http://localhost:5681/webhook/wbs-onboarding'
    for bearer in [None,'deliberately-invalid-diagnostic-credential']:
        code,_=request(url,{},bearer)
        assert code==403,f'Employee webhook must reject absent/invalid authentication; received {code}'
    code,_=request(url,{},env['N8N_ONBOARDING_WEBHOOK_SECRET'])
    assert code==400,f'Employee webhook preflight failed (HTTP {code}); dispatch stays disabled.'
    print('Employee webhook: missing/wrong credential → 403; authenticated invalid payload → 400')
