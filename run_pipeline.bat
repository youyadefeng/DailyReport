@echo off
setlocal

cd /d "%~dp0"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "STAMP=%%I"

if not exist logs mkdir logs

set "LOG_FILE=logs\pipeline_%STAMP%.log"

"C:\Program Files\nodejs\node.exe" src\main.mjs --verbose > "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" (
  powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('PresentationFramework') | Out-Null; [System.Windows.MessageBox]::Show('Pipeline finished. Log saved to %LOG_FILE%','Pipeline Finished')"
) else (
  powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('PresentationFramework') | Out-Null; [System.Windows.MessageBox]::Show('Pipeline failed. Check %LOG_FILE%','Pipeline Failed')"
)

endlocal
