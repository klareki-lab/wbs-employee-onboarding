#!/usr/bin/env python3
"""Import only this project's local workflow/credentials; production is never contacted."""
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
LOCAL=ROOT/'workflows/.local/bootstrap'
CONTAINER='wbs-employee-onboarding-n8n-1'

def run(args, data=None):
    result=subprocess.run(['docker','exec','-i',CONTAINER,*args],input=data,capture_output=True)
    if result.returncode:
        # Do not echo n8n exception bodies: imported credential JSON can appear in them.
        raise SystemExit('Local n8n import command failed; no credential contents logged. Check isolated container health and CLI version.')

for file,kind in [('credentials.json','credentials'),('onboarding.json','workflow'),('connectivity.json','workflow')]:
    data=(LOCAL/file).read_bytes()
    run(['sh','-c',f'umask 077; cat > /tmp/wbs-import.json; n8n import:{kind} --input=/tmp/wbs-import.json; result=$?; rm -f /tmp/wbs-import.json; exit "$result"'],data)
    print(f'Imported local {kind}: {file}')
(LOCAL/'credentials.json').unlink()
run(['n8n','publish:workflow','--id=wbsOnboardingConnectivity'])
print('Connectivity workflow published locally. Employee workflow remains unpublished until OpenAI readiness checks pass. Restart the local n8n container to load it.')
