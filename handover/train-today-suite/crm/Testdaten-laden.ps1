$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$crmDocker = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $crmDocker) { $crmDocker = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath '.env')) { throw 'Zuerst Start-CRM.ps1 ausführen.' }
if (-not (Test-Path -LiteralPath $crmDocker)) { throw 'Docker Desktop bitte installieren und starten.' }
& "$PSScriptRoot\Sicherung-CRM.ps1"
& $crmDocker compose up -d --build app
if ($LASTEXITCODE) { throw 'Lokale Anwendung konnte nicht gestartet werden.' }
& $crmDocker compose exec -T db psql -U crm_owner -d crm -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/013-crm-workspace.sql -f /docker-entrypoint-initdb.d/014-project-management.sql
if ($LASTEXITCODE) { throw 'CRM-Erweiterungen konnten nicht eingerichtet werden.' }
Get-Content -Raw .env | & $crmDocker compose exec -T app node src/populate-leadership-demo.mjs
if ($LASTEXITCODE) { throw 'Testdaten konnten nicht vollständig geladen werden. Nach Behebung kann das Skript fortsetzen.' }
& $crmDocker compose exec -T app node src/seed-projects.mjs
if ($LASTEXITCODE) { throw 'Kundenprojektpläne konnten nicht vollständig eingerichtet werden.' }
& $crmDocker compose cp app:/tmp/crm-leadership-demo-report.json leadership-demo-report.json
if ($LASTEXITCODE) { throw 'Der Importbericht konnte nicht kopiert werden.' }
& $crmDocker compose cp app:/tmp/crm-project-data-report.json project-data-report.json
if ($LASTEXITCODE) { throw 'Der Projektbericht konnte nicht kopiert werden.' }
Write-Host 'Testbestand bereit: http://localhost:3080'
Write-Host 'Mit leitung anmelden. Testanleitung: LEITUNG-TESTDATEN.txt'
Write-Host 'Bereits fertig geladene Testbestände werden nicht überschrieben.'
