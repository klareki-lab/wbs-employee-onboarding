$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$crmDocker = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $crmDocker) { $crmDocker = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
& $crmDocker compose --profile local-core stop
Write-Host 'Nur die CRM-Testumgebung wurde gestoppt. Die Daten bleiben erhalten.'
