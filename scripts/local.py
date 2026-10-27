#!/usr/bin/env python3
"""Portable clean-clone installer. Python stdlib + Docker Compose only; no shell secrets."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def private_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    # Restrict permissions before writing, including on first creation.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.chmod(path, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write(text)


def load_env(path):
    # Installer writes single-quoted Compose literals. No shell execution/interpolation.
    values = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value[1:-1] if value.startswith("'") else value
    return values


def ask_secret(name, prompt):
    value = os.environ.get(name)
    if value is None:
        if not sys.stdin.isatty():
            raise SystemExit('Run configure in an interactive terminal for hidden credential entry.')
        value = getpass.getpass(prompt)
    if not value or any(c in value for c in ["'", '\n', '\r']):
        raise SystemExit('Credential missing or contains unsupported quote/newline. Nothing was configured.')
    return value


def run(command, *, data=None, env=None):
    result = subprocess.run(command, cwd=ROOT, input=data, capture_output=True, env=env)
    if result.returncode:
        # Docker/provider/import errors can contain credentials. Do not echo arbitrary output.
        raise SystemExit('Local command failed: ' + command[0] + ' (exit ' + str(result.returncode) + ')' +
                         '. No raw output printed. Check Docker Desktop, free ports, network and configured credentials. '
                         'Existing accounts/volumes were not reset.')
    return result.stdout.decode('utf-8').strip()


def request(url, data=None, bearer=None):
    headers = {'Content-Type': 'application/json'}
    if bearer:
        headers['Authorization'] = 'Bearer ' + bearer
    req = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def wait_ready(url):
    for _ in range(90):
        try:
            if request(url)[0] == 200:
                return
        except OSError:
            pass
        time.sleep(1)
    raise SystemExit('Local service not ready: ' + url + '. Check Docker resources and port availability.')


def configure(args, state):
    path = state / 'install.env'
    if path.exists():
        raise SystemExit('Already configured. Edit your ignored install.env privately; retain database/encryption/bearer secrets, then run up. '
                         'For an OpenAI key change update the existing credential in your local n8n editor. No values were overwritten.')
    ports = [args.web_port, args.api_port, args.n8n_port, args.mailpit_port]
    if len(set(ports)) != 4 or any(not 1024 <= p <= 65535 for p in ports):
        raise SystemExit('Choose four distinct ports between 1024 and 65535.')
    key = ask_secret('WBS_SETUP_OPENAI_API_KEY', 'Your authorized OpenAI API key (hidden): ')
    values = dict(WEB_PORT=str(args.web_port), API_PORT=str(args.api_port), N8N_PORT=str(args.n8n_port),
                  MAILPIT_PORT=str(args.mailpit_port), OPENAI_API_KEY=key, OPENAI_MODEL='gpt-4o-mini',
                  SMTP_MODE=args.mail_mode, SMTP_HOST='smtp.resend.com', SMTP_PORT='465', SMTP_SECURE='true',
                  SMTP_USER='resend', SMTP_PASSWORD='', SMTP_FROM='onboarding@example.invalid')
    if args.mail_mode == 'external':
        values['SMTP_PASSWORD'] = ask_secret('WBS_SETUP_SMTP_PASSWORD', 'Your authorized Resend API key (hidden): ')
        sender = os.environ.get('WBS_SETUP_SMTP_FROM') or input('Your Resend verified sender address: ').strip()
        if not re.fullmatch(r"[^\s@'\r\n]+@[^\s@'\r\n]+\.[^\s@'\r\n]+", sender) or sender.endswith('.invalid'):
            raise SystemExit('Supply an independently authorized, verified sender email address.')
        values['SMTP_FROM'] = sender
    elif args.mail_mode == 'capture':
        values.update(SMTP_HOST='mailpit', SMTP_PORT='1025', SMTP_SECURE='false')
    for name in ['DATABASE_PASSWORD', 'INTERNAL_API_SECRET', 'DEPARTMENTS_API_SECRET',
                 'N8N_ONBOARDING_WEBHOOK_SECRET', 'N8N_ENCRYPTION_KEY']:
        values[name] = secrets.token_hex(32)
    private_write(path, '# PRIVATE: do not share, commit or paste this file.\n' +
                  '\n'.join(k + "='" + v + "'" for k, v in values.items()) + '\n')
    print('Independent local configuration created. Credentials were not displayed. Run up next.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default='wbs-onboarding-local', help='isolated Compose project/state directory')
    sub = parser.add_subparsers(dest='command', required=True)
    init = sub.add_parser('configure', help='generate independent secrets and enter provider keys privately')
    init.add_argument('--mail-mode', choices=['external', 'capture', 'disabled'], default='external')
    for name, default in [('web', 5173), ('api', 3009), ('n8n', 5681), ('mailpit', 8025)]:
        init.add_argument('--' + name + '-port', type=int, default=default)
    for name in ['up', 'hr', 'check', 'stop', 'down', 'status']:
        sub.add_parser(name)
    destroy = sub.add_parser('destroy', help='delete only this installation and its volumes')
    destroy.add_argument('--confirm-delete-local-data', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'wbs-onboarding-[a-z0-9-]{1,40}', args.project):
        parser.error('Project must start wbs-onboarding- and contain lowercase letters, digits or hyphens.')
    state = ROOT / '.local-install' / args.project
    if args.command == 'configure':
        configure(args, state)
        return
    path = state / 'install.env'
    if not path.exists():
        raise SystemExit('Run configure first. No local installation found for this project.')
    values = load_env(path)
    # Prevent caller environment from silently overriding Compose file configuration.
    process_env = {k: v for k, v in os.environ.items() if k not in values}
    process_env['WBS_DISPATCH_URL'] = 'http://n8n:5678/webhook/wbs-onboarding'
    compose = ['docker', 'compose', '-p', args.project, '--env-file', str(path),
               '-f', str(ROOT / 'deploy/local/compose.yaml')]

    def dc(*command, data=None):
        return run(compose + list(command), data=data, env=process_env)

    def container(service):
        return dc('ps', '-q', service)

    def prepare_import():
        print('Preparing private workflow and credential imports...', flush=True)
        run([sys.executable, str(ROOT / 'workflows/scripts/prepare-local.py'),
             '--env-file', str(path), '--local-dir', str(state / 'n8n')])
        run([sys.executable, str(ROOT / 'workflows/scripts/import-local.py'),
             '--bootstrap-dir', str(state / 'n8n/bootstrap'), '--container', container('n8n')])
        print('Publishing the local employee webhook...', flush=True)
        dc('exec', '-T', 'n8n', 'n8n', 'publish:workflow', '--id=wbsOnboardingLocal')
        private_write(state / 'imported', 'Workflows imported and published; retain this marker across restarts.\n')
        dc('restart', 'n8n')

    web = 'http://localhost:' + values['WEB_PORT']
    api = 'http://localhost:' + values['API_PORT']
    n8n = 'http://localhost:' + values['N8N_PORT']

    def check():
        wait_ready(api + '/health')
        wait_ready(n8n + '/healthz/readiness')
        secret = values['N8N_ONBOARDING_WEBHOOK_SECRET']
        for credential, expected in [(None, 403), ('invalid-diagnostic-credential', 403), (secret, 400)]:
            if request(n8n + '/webhook/wbs-onboarding', {}, credential)[0] != expected:
                raise SystemExit('Employee webhook authentication/schema check failed; dispatch must stay disabled.')
        code, raw = request(n8n + '/webhook/wbs-onboarding-connectivity', {}, secret)
        if code != 200:
            raise SystemExit('Local n8n connectivity workflow failed.')
        result = json.loads(raw)
        if isinstance(result, list):
            result = result[0]
        if result.get('departments_count') != 3 or result.get('callback_http_status') != 400 or result.get('callback_error_code') != 'VALIDATION_ERROR':
            raise SystemExit('Department lookup/callback authentication check failed.')
        if values['SMTP_MODE'] == 'external':
            dc('exec', '-T', 'api', 'node', 'dist/verify-smtp.js')
            print('SMTP authentication and mandatory TLS verified. No email sent; sender authorization/inbox delivery require provider acceptance.')
        for _ in range(15):
            try:
                if request(web + '/api/auth/me')[0] == 401:
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise SystemExit('Frontend same-origin API proxy verification failed.')
        print('Health, webhook authentication, department lookup, callback schema rejection and frontend API proxy passed.')

    if args.command == 'up':
        # Never enable dispatch before a fresh installation's authenticated preflight passes.
        process_env['WBS_DISPATCH_URL'] = ''
        print('Building frontend/backend and starting this isolated installation (first build may take several minutes)...', flush=True)
        dc('up', '--build', '-d')
        wait_ready(n8n + '/healthz/readiness')
        if not (state / 'imported').exists():
            prepare_import()
        check()
        process_env['WBS_DISPATCH_URL'] = 'http://n8n:5678/webhook/wbs-onboarding'
        dc('up', '-d', '--no-deps', 'api')
        wait_ready(api + '/health')
        print('Automatic AI onboarding enabled for all registrations. HR approval and invitation sending remain manual.')
        print('Application: ' + web + '/login\nBackend: ' + api + '/health\nn8n: ' + n8n +
              '\nMailpit (capture only): http://localhost:' + values['MAILPIT_PORT'])
        print('Run hr to create your own HR account using hidden password entry.')
    elif args.command == 'hr':
        if not sys.stdin.isatty():
            raise SystemExit('Run hr from an interactive terminal; no shared/default HR account is provided.')
        username = input('Choose HR username (3–64 lowercase letters/digits/._-): ').strip()
        if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,63}', username):
            raise SystemExit('Invalid username.')
        password = getpass.getpass('Choose HR password (12–128 characters; hidden): ')
        if not 12 <= len(password) <= 128 or password != getpass.getpass('Confirm HR password (hidden): '):
            raise SystemExit('Password length or confirmation invalid. No account created.')
        script = "const fs=await import('node:fs');const v=JSON.parse(fs.readFileSync(0,'utf8'));process.env.HR_USERNAME=v.username;process.env.HR_PASSWORD=v.password;await import('./dist/provision-hr.js');"
        dc('exec', '-T', 'api', 'node', '--input-type=module', '-e', script,
           data=json.dumps({'username': username, 'password': password}).encode())
        print('HR account created. Sign in at ' + web + '/login. Existing usernames are never overwritten.')
    elif args.command == 'check':
        check()
    elif args.command == 'status':
        print(dc('ps'))
    elif args.command in ['stop', 'down']:
        dc(args.command)
        print('Local services stopped. Database, n8n volume and private configuration retained; run up to restart.')
    elif args.command == 'destroy':
        if not args.confirm_delete_local_data:
            raise SystemExit('Destructive: add --confirm-delete-local-data to delete only this project’s database/n8n volumes and private files.')
        dc('down', '--volumes')
        import shutil
        shutil.rmtree(state)
        print('Only this local installation’s volumes and private configuration deleted.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('Local setup failed. Check Docker/Python availability, network and private configuration. No raw secret-bearing error printed.') from None
