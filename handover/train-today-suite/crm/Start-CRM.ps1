$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$crmDocker = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $crmDocker) { $crmDocker = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath $crmDocker)) { throw 'Docker Desktop bitte installieren und starten.' }
$crmNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $crmNode) { $crmNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath '.env')) { & $crmNode src/setup.mjs; if ($LASTEXITCODE) { throw 'Einrichtung fehlgeschlagen.' } }
& $crmDocker compose --profile local-core up -d --build
if ($LASTEXITCODE) { throw 'Docker-Start fehlgeschlagen.' }
& $crmDocker compose exec -T db psql -U crm_owner -d crm -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/013-crm-workspace.sql
if ($LASTEXITCODE) { throw 'CRM-Erweiterung konnte nicht eingespielt werden.' }
& $crmDocker compose exec -T db psql -U crm_owner -d crm -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/014-project-management.sql
if ($LASTEXITCODE) { throw 'Projektplanung konnte nicht eingerichtet werden.' }
if (-not (Test-Path -LiteralPath '.local-n8n.json')) {
  Write-Host 'Warte auf die erstmalige Einrichtung der separaten n8n-Testinstanz ...'
  $crmReady = $false
  for ($crmAttempt = 0; $crmAttempt -lt 30; $crmAttempt++) {
    try { $crmResponse = Invoke-WebRequest -Uri 'http://localhost:5682/healthz' -TimeoutSec 2; if ($crmResponse.StatusCode -eq 200) { $crmReady = $true; break } } catch { }
    Start-Sleep -Seconds 2
  }
  if (-not $crmReady) { throw 'n8n ist noch nicht bereit. Das Startskript in einer Minute erneut starten.' }
  & $crmNode src/local-core-setup.mjs
  if ($LASTEXITCODE) { throw 'Lokale Kernanbindung fehlgeschlagen; ANLEITUNG.txt beachten.' }
  & $crmDocker compose up -d app
  & $crmDocker compose exec -T app node src/seed.mjs
  if ($LASTEXITCODE) { throw 'Demodaten konnten nicht vollständig geladen werden.' }
  & $crmDocker compose exec -T app node src/repair-demo.mjs
}
Write-Host 'CRM: http://localhost:3080'
Write-Host 'Separate n8n-Testinstanz: http://localhost:5682'
Write-Host 'Persönliche Testzugänge: LOKALE-ZUGAENGE.txt'
