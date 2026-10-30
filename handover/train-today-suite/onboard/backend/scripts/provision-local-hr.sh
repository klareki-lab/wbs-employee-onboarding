#!/usr/bin/env bash
# Interactive local-only HR provisioning. Never pass credentials as command arguments.
set -euo pipefail
set +x
cd "$(dirname "$0")/../.."
trap 'unset HR_PASSWORD HR_USERNAME' EXIT
printf 'Local WBS onboarding HR account (isolated Docker database)\n'
while true; do
  printf 'Username (3–64 lowercase letters/digits/._-, start with letter/digit): '
  IFS= read -r HR_USERNAME
  if [[ ! "$HR_USERNAME" =~ ^[a-z0-9][a-z0-9._-]{2,63}$ ]]; then
    printf 'Invalid username. Use lowercase characters and the stated length.\n'
    continue
  fi
  printf 'Password (12–128 characters; input hidden): '
  IFS= read -rs HR_PASSWORD
  printf '\n'
  if (( ${#HR_PASSWORD} < 12 || ${#HR_PASSWORD} > 128 )); then
    unset HR_PASSWORD
    printf 'Password must contain 12–128 characters. Try again.\n'
    continue
  fi
  export HR_USERNAME HR_PASSWORD
  if ! docker compose --env-file backend/.env -f backend/compose.yaml exec -T \
    -e HR_USERNAME -e HR_PASSWORD api node dist/provision-hr.js >/dev/null 2>&1; then
    unset HR_PASSWORD
    printf 'Could not create account. Choose an unused username; existing accounts are never overwritten. Ensure Compose is running.\n'
    continue
  fi
  printf 'HR account created. Checking login through the local Vite proxy...\n'
  node --input-type=module <<'JS'
const base='http://localhost:5173/api';
try {
  const response=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({username:process.env.HR_USERNAME,password:process.env.HR_PASSWORD}),signal:AbortSignal.timeout(10000)});
  if(response.status!==200)throw new Error();
  const login=(await response.json()).data;
  const cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(login.user.role!=='hr'||!cookie)throw new Error();
  const profile=await fetch(base+'/auth/me',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
  if(profile.status!==200||(await profile.json()).data.user.role!=='hr')throw new Error();
  const logout=await fetch(base+'/auth/logout',{method:'POST',headers:{Origin:'http://localhost:5173',Cookie:cookie,'X-CSRF-Token':login.csrf_token},signal:AbortSignal.timeout(10000)});
  if(logout.status!==200)throw new Error();
  console.log('Verified: login, session profile and CSRF-protected logout. Open http://localhost:5173/login and use your chosen credentials.');
}catch{
  console.error('Account created, but proxy verification failed. Check that Vite is running on localhost:5173. Credentials were not logged.');
  process.exitCode=1;
}
JS
  break
done
