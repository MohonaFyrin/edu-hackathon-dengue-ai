@echo off
setlocal
REM One-click start. Fully offline: installs nothing and downloads nothing. Run setup.cmd once first.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (echo Run setup.cmd first. & pause & exit /b 1)
if not exist backend\data\official.csv (echo Dataset missing. Run setup.cmd first. & pause & exit /b 1)
if not exist frontend\dist\index.html (echo Website build missing. Run setup.cmd first. & pause & exit /b 1)
if not exist .run mkdir .run

REM Already running? Just open the browser.
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/api/health) | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto open

powershell -NoProfile -Command "$p = Start-Process -FilePath '.venv\Scripts\python.exe' -ArgumentList '-m','uvicorn','app:app','--app-dir','backend','--host','127.0.0.1','--port','8000' -WindowStyle Minimized -RedirectStandardError '.run\server.log' -PassThru; Set-Content -Path '.run\server.pid' -Value $p.Id"
echo Starting Dengue Early Warning (model loads in about 10 seconds)...
powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/api/health) | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (echo The server did not start. See .run\server.log & pause & exit /b 1)

:open
if not defined NO_BROWSER start "" http://127.0.0.1:8000/
echo Running at http://127.0.0.1:8000/   Close it with stop.cmd
exit /b 0
