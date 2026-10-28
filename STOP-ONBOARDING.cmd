@echo off
cd /d "%~dp0"
set "ONBOARDING_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%ONBOARDING_PYTHON%" (
  "%ONBOARDING_PYTHON%" -X utf8 scripts\local.py stop
) else (
  py -3 -X utf8 scripts\local.py stop
)
pause
