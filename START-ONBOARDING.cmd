@echo off
cd /d "%~dp0"
set "ONBOARDING_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%ONBOARDING_PYTHON%" (
  "%ONBOARDING_PYTHON%" -X utf8 scripts\local.py up
) else (
  py -3 -X utf8 scripts\local.py up
)
if errorlevel 1 (
  echo Start fehlgeschlagen. Bitte Docker Desktop starten und Meldung pruefen.
  pause
  exit /b 1
)
start "" http://localhost:5173/login
pause
