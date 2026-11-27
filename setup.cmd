@echo off
setlocal
REM One-time setup (needs internet). Afterwards start.cmd runs fully offline.
REM Usage: setup.cmd [path\to\bangladesh_dengue_large_dataset_onsite.xlsx]
cd /d "%~dp0"

echo [1/5] Python environment
where py >nul 2>nul && (py -3 -c "import sys; sys.exit(sys.version_info < (3, 12))" && set "PY=py -3")
if not defined PY python -c "import sys; sys.exit(sys.version_info < (3, 12))" && set "PY=python"
if not defined PY (echo Python 3.12 or newer is required. & goto failed)
if not exist .venv\Scripts\python.exe %PY% -m venv .venv || goto failed
.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt || goto failed

echo [2/5] Dataset
if not exist backend\data\official.csv (
  if "%~1"=="" (echo Pass the onsite XLSX path: setup.cmd path\to\dataset.xlsx & goto failed)
  pushd backend & ..\.venv\Scripts\python.exe prepare_data.py "%~f1" & popd
)
if not exist backend\data\official.csv goto failed

echo [3/5] Model and validation report
pushd backend
if not exist reports\validation.json ..\.venv\Scripts\python.exe train.py || (popd & goto failed)
popd

echo [4/5] Website build
where npm >nul 2>nul
if errorlevel 1 (
  if exist frontend\dist\index.html (echo Node.js not found; using the existing build in frontend\dist.) else (echo Node.js is needed to build the website. & goto failed)
) else (
  pushd frontend & call npm ci --no-audit --no-fund && call npm run build & popd
)
if not exist frontend\dist\index.html goto failed

echo [5/5] Self-check
pushd backend
..\.venv\Scripts\python.exe -m pytest -q -p no:warnings tests || (popd & echo Tests failed; see above. & goto failed)
popd
echo.
echo Setup complete. Run start.cmd (works without internet).
exit /b 0

:failed
echo Setup did not finish. Read the message above.
exit /b 1
