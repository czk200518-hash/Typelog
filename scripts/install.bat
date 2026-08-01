@echo off
REM TypeLog build + install to vault. Usage: install.bat [vault-path]
setlocal

cd /d "%~dp0.."

echo [1/4] Building plugin...
call npm run build
if errorlevel 1 (
  echo Build failed, check errors above.
  exit /b 1
)

set "VAULT=%~1"
if "%VAULT%"=="" set "VAULT=%CD%\test-vault"
set "DEST=%VAULT%\.obsidian\plugins\typelog"

echo [2/4] Copying to %DEST%
if not exist "%DEST%" mkdir "%DEST%"
copy /Y main.js "%DEST%\main.js" >nul
copy /Y manifest.json "%DEST%\manifest.json" >nul
copy /Y styles.css "%DEST%\styles.css" >nul
copy /Y versions.json "%DEST%\versions.json" >nul
if errorlevel 1 (
  echo Copy failed.
  exit /b 1
)

echo [3/4] Enabling plugin...
if not exist "%VAULT%\.obsidian" mkdir "%VAULT%\.obsidian"
if not exist "%VAULT%\.obsidian\community-plugins.json" (
  echo []> "%VAULT%\.obsidian\community-plugins.json"
)
REM Write UTF-8 without BOM (Set-Content adds BOM which breaks JSON parsing)
powershell -NoProfile -Command "$p='%VAULT%\.obsidian\community-plugins.json'; $list=@(); foreach($x in (Get-Content $p -Raw | ConvertFrom-Json)){ $list += $x }; if($list -notcontains 'typelog'){ $list += 'typelog'; [System.IO.File]::WriteAllText($p, ($list | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false)) }"
if errorlevel 1 (
  echo Enable plugin config failed.
  exit /b 1
)

echo [4/4] Done!
echo Open vault in Obsidian: %VAULT%
echo If Obsidian is already running, reload plugins (Settings - Community plugins - Reload plugins) or restart.
endlocal
