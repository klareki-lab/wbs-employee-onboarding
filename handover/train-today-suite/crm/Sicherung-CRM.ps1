$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$crmDocker = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $crmDocker) { $crmDocker = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
New-Item -ItemType Directory -Path 'backups' -Force | Out-Null
$crmBackup = 'crm-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump'
& $crmDocker compose exec -T db pg_dump -U crm_owner -d crm --format=custom --no-owner --no-acl --file=/tmp/crm-backup.dump
if ($LASTEXITCODE) { throw 'Sicherung fehlgeschlagen.' }
& $crmDocker compose cp db:/tmp/crm-backup.dump "backups/$crmBackup"
Write-Host "Sicherung erstellt: backups/$crmBackup. Enthält Testdaten und Passwort-Hashes; vertraulich behandeln."
