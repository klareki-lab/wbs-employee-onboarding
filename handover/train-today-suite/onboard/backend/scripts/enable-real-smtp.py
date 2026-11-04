#!/usr/bin/env python3
"""Verify separate authorized SMTP before switching this local API. Sends no email."""
import os
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
path=ROOT/'backend/.env.smtp'
if not path.exists():
    path.write_text((ROOT/'backend/smtp.env.example').read_text())
    path.chmod(0o600)
    raise SystemExit('Created ignored backend/.env.smtp. Fill its dedicated SMTP settings privately, then rerun. No email sent.')
path.chmod(0o600)
# Values are checked without printing them. Compose performs the final .env parsing.
values={}
for line in path.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key,value=line.split('=',1);values[key.strip()]=value.strip().strip(chr(34)+chr(39))
required=['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASSWORD','SMTP_FROM']
missing=[key for key in required if not values.get(key)]
if values.get('SMTP_HOST','').endswith('.invalid') and 'SMTP_HOST' not in missing:
    missing.append('SMTP_HOST')
if missing:
    raise SystemExit('Complete the separate backend/.env.smtp: '+', '.join(missing)+'. No email sent.')
compose=['docker','compose','--env-file','backend/.env','--env-file','backend/.env.smtp','-f','backend/compose.yaml','-f','backend/compose.n8n.yaml','-f','backend/compose.smtp.yaml']

def run(args, switching=False):
    result=subprocess.run(compose+args,capture_output=True)
    if result.returncode:
        # A provider/config error can contain a secret. Keep CLI output private.
        if switching:
            raise SystemExit('SMTP verification passed but the API switch failed. Check only the onboarding container status; no email was sent by this script.')
        diagnostic=''
        for line in (result.stdout+result.stderr).decode(errors='replace').splitlines():
            try:
                import json, re
                status=json.loads(line)
                code=status.get('code','')
                if status.get('smtp_connection')=='failed' and re.fullmatch(r'[A-Z_]{2,40}',code): diagnostic=' ('+code+')'
            except (ValueError,AttributeError,TypeError): pass
        raise SystemExit('SMTP setup/verification failed'+diagnostic+'. The running API was not switched. Check provider credentials, TLS mode and connectivity; no email sent.')

run(['build','api'])
run(['run','--rm','--no-deps','-T','api','node','dist/verify-smtp.js'])
print('SMTP connectivity, authentication and required TLS/certificate validation passed. No message sent.')
run(['up','-d','--no-deps','api'],switching=True)
print('Local onboarding API now uses the separate real SMTP adapter. HR must explicitly approve and send from the dashboard. SMTP acceptance alone is not inbox delivery.')
