"""Independent local handover; no production access and no automatic workflow activation."""
import argparse,pathlib,secrets,json,subprocess,shutil,time
ROOT=pathlib.Path(__file__).resolve().parent
docker=shutil.which('docker') or str(pathlib.Path.home()/'AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe')
p=argparse.ArgumentParser();p.add_argument('action',choices=['configure','restore','up','stop','status']);p.add_argument('--data-dir',type=pathlib.Path);p.add_argument('--port-offset',type=int,default=0);a=p.parse_args()
def dc(*args,data=None,capture=False):
 r=subprocess.run([docker,'compose','--env-file',str(ROOT/'.env'),'-f',str(ROOT/'compose.yaml'),*args],cwd=ROOT,input=data,stdout=subprocess.PIPE if capture else None,stderr=subprocess.PIPE)
 if r.returncode:raise SystemExit('Docker action failed: '+r.stderr.decode(errors='replace')[-1500:])
 return r.stdout
def load():return dict(l.split('=',1) for l in (ROOT/'.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
if a.action=='configure':
 if (ROOT/'.env').exists():raise SystemExit('.env already exists; unchanged.')
 values={k:secrets.token_hex(32) for k in ['HR_DB_PASSWORD','COORDINATOR_DB_PASSWORD','CRM_DB_PASSWORD','CRM_APP_PASSWORD','CRM_AGENT_PASSWORD','CRM_INTERNAL_KEY','LEADERSHIP_BRIDGE_KEY','INTERNAL_API_SECRET','DEPARTMENTS_API_SECRET','N8N_ONBOARDING_WEBHOOK_SECRET','N8N_ENCRYPTION_KEY']}
 values.update({k:str(v+a.port_offset) for k,v in {'WEB_PORT':5173,'API_PORT':3009,'COORDINATOR_PORT':3010,'CRM_PORT':3080,'N8N_PORT':5681,'MAILPIT_PORT':8025}.items()})
 values.update({'HR_WEBHOOK_URL':'','SYSTEM_ADMIN_EMAIL':'','LEADERSHIP_AI_KEY':'','AI_API_KEY':''})
 (ROOT/'.private').mkdir(exist_ok=True);(ROOT/'.env').write_text('\n'.join(k+'='+v for k,v in values.items())+'\n');(ROOT/'.private/mcp.json').write_text(json.dumps({'mcpServers':{'n8n-mcp':{'url':'http://n8n:5678/mcp-server/http','headers':{'Authorization':'Bearer CONFIGURE_YOUR_OWN_MCP_TOKEN'}}}},indent=2));print('Private local configuration created. No API keys copied.');raise SystemExit
if not (ROOT/'.env').exists():raise SystemExit('Run configure first.')
if a.action=='restore':
 folder=a.data_dir.resolve() if a.data_dir else None
 if not folder or not all((folder/n).is_file() for n in ['onboard.dump','coordinator.dump','crm.dump']):raise SystemExit('Supply --data-dir with the three decrypted database dumps.')
 dc('up','-d','--wait','hr-db','coordinator-db','crm-db')
 dbs=[('hr-db','onboarding','onboarding','onboard.dump','employee_onboarding'),('coordinator-db','coordinator','coordinator','coordinator.dump','public'),('crm-db','crm_owner','crm','crm.dump','crm')]
 for service,user,db,file,schema in dbs:
  count=dc('exec','-T',service,'psql','-U',user,'-d',db,'-Atc',"SELECT count(*) FROM pg_tables WHERE schemaname='"+schema+"'",capture=True).strip()
  if count!=b'0':raise SystemExit('Restore refused: '+service+' already contains application tables. No data replaced.')
 env=load();roles=['crm_app','crm_agent','crm_capture','crm_worker','crm_status','crm_operator'];statement='\n'.join('CREATE ROLE '+role+' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;' for role in roles)
 dc('exec','-T','crm-db','psql','-v','ON_ERROR_STOP=1','-U','crm_owner','-d','crm',data=statement.encode())
 for service,user,db,file,schema in dbs:dc('exec','-T',service,'pg_restore','-U',user,'-d',db,'--no-owner','--exit-on-error',data=(folder/file).read_bytes())
 # Rebind local DB credentials/context signing to fresh configuration, never reuse source infrastructure secrets.
 statement="ALTER ROLE crm_app PASSWORD '"+env['CRM_APP_PASSWORD']+"'; ALTER ROLE crm_agent PASSWORD '"+env['CRM_AGENT_PASSWORD']+"'; ALTER ROLE crm_agent SET default_transaction_read_only=on; INSERT INTO crm.private_settings(key,value) VALUES('context_key','"+env['CRM_INTERNAL_KEY']+"') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;"
 dc('exec','-T','crm-db','psql','-v','ON_ERROR_STOP=1','-U','crm_owner','-d','crm',data=statement.encode())
 if (folder/'mailpit').is_dir():
  dc('create','mailpit');container=dc('ps','-aq','mailpit',capture=True).decode().strip();r=subprocess.run([docker,'cp',str(folder/'mailpit')+'/.',container+':/data'],capture_output=True)
  if r.returncode:raise SystemExit('Mailbox copy failed; databases restored. Inspect local Docker permissions.')
 (ROOT/'.private/restored').write_text('Databases restored into isolated local volumes.\n');print('Restore complete. Start with: python local-suite.py up')
elif a.action=='up':
 if not (ROOT/'.private/restored').exists():raise SystemExit('Restore the provided databases first. No application started.')
 dc('up','-d','--build','api','onboarding-dashboard','web','crm','mailpit')
 print('Local applications started. Workflow activation and external AI keys are separate manual steps; see README.md.')
elif a.action=='stop':dc('stop')
else:dc('ps')
