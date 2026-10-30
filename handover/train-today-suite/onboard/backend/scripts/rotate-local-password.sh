#!/usr/bin/env bash
# Local operator command: hidden entry, no passwords in arguments/files/logs.
set -euo pipefail
set +x
cd "$(dirname "$0")/../.."
username="${1:-}"
if [[ ! "$username" =~ ^[a-z0-9][a-z0-9._-]{2,63}$ ]]; then
  printf 'Usage: bash backend/scripts/rotate-local-password.sh <existing-employee-username>\n'
  exit 1
fi
trap 'unset NEW_PASSWORD confirmation' EXIT
printf 'Rotate password for existing employee account %s. All sessions for this account will be revoked.\n' "$username"
printf 'New password (12–128 characters, hidden): '
IFS= read -rs NEW_PASSWORD
printf '\nConfirm new password (hidden): '
IFS= read -rs confirmation
printf '\n'
if (( ${#NEW_PASSWORD} < 12 || ${#NEW_PASSWORD} > 128 )) || [[ "$NEW_PASSWORD" != "$confirmation" ]]; then
  printf 'Passwords must match and contain 12–128 characters. No change made.\n'
  exit 1
fi
export NEW_PASSWORD
docker exec -i -e NEW_PASSWORD wbs-employee-onboarding-api-1 node dist/rotate-local-password.js "$username"
