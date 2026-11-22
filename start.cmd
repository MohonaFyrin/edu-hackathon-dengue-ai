@echo off
REM One-click start (Windows 10, Python 3.12+). Creates .venv, installs deps, serves the app on http://127.0.0.1:8000
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe python -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
if errorlevel 1 goto failed
echo.
echo Open http://127.0.0.1:8000  (press Ctrl+C to stop)
cd backend
..\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
exit /b
:failed
echo Setup failed. Check that Python 3.12+ is on PATH.
pause
exit /b 1
