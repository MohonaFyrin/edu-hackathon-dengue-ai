@echo off
setlocal
REM Stops the server that start.cmd launched (by its saved process id only).
cd /d "%~dp0"
if not exist .run\server.pid (echo Not running. & exit /b 0)
set /p PID=<.run\server.pid
powershell -NoProfile -Command "$p = Get-Process -Id %PID% -ErrorAction SilentlyContinue; if ($p -and $p.Path -like '*\.venv\*python*') { Stop-Process -Id %PID%; 'Stopped.' } else { 'Not running.' }"
del .run\server.pid >nul 2>nul
exit /b 0
