# Dengue Early Warning System

The Bangla/English dashboard replays weekly dengue forecasts for 60 wards across five cities. Select an issue week and compare estimated cases and risk tiers two, three or four weeks ahead. The officer view ranks wards for review, while the hospital view supports preparedness discussions.

## Run locally on Windows

Use Python 3.14.6 and Node.js 22 with npm. Run these commands in PowerShell. Install dependencies once. The existing model is used directly.

~~~powershell
git clone https://github.com/MohonaFyrin/edu-hackathon-dengue-ai.git
cd edu-hackathon-dengue-ai
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt openpyxl
Push-Location frontend
npm ci
npm run build
Pop-Location
~~~

**Required inputs.** Obtain the official workbook privately from the organiser and the matching aggregate ML report from M's team handoff. The backend reads the latter at `backend/reports/validation.json` on startup. Copy that file there if your checkout lacks it. Keep your workbook outside the clone.

In PowerShell, set the workbook path to your authorised copy. These commands check the original workbook and derived CSV against the committed manifest. The original captured CSV is also valid if provided privately by the organiser or an authorised team member.

~~~powershell
$workbook = Join-Path $HOME 'Downloads/hackathon_preli_dataset.xlsx'
$manifest = Get-Content backend/reports/source.json -Raw | ConvertFrom-Json
if ((Get-FileHash $workbook).Hash -ne $manifest.xlsx_sha256) { throw 'Workbook does not match the supplied edition' }
.\.venv\Scripts\python.exe backend/prepare_data.py $workbook
if ($LASTEXITCODE -ne 0) { throw 'Workbook conversion failed' }
if ((Get-FileHash backend/data/official.csv).Hash -ne $manifest.csv_sha256) { throw 'CSV differs from the model input. Use the authorised byte-identical copy.' }
if (!(Test-Path backend/reports/validation.json)) { throw 'Missing ML validation report' }
.\start.cmd
~~~

Open http://127.0.0.1:8000 for the dashboard or http://127.0.0.1:8000/docs for the API. Keep the generated CSV private and out of Git staging. The converter rewrites the local source manifest. Use the committed manifest as the reference for any retry.

## Data, permissions and validation

The organiser workbook supplies the worksheet `bangladesh_dengue_large_dataset`. The source manifest records its fingerprints. Rulebook §12 requires teams to hold publication rights. Neither the supplied source information nor the rulebook expressly grants redistribution of the workbook or its CSV conversion. This project documents private reconstruction for authorised holders. Public reviewers without the workbook can inspect the aggregate validation report, architecture and recorded demonstration.

Dataset validation passed for 31,320 records and 60 wards. The team's existing pipeline run passed 12 of 12 tests. Held-out two-week mean absolute error was 1.037 cases per ward-week versus 1.691 for repeating the last observation. See [architecture and all horizons](ARCHITECTURE.md).

## Architecture and limitations

Pandas computes weather and case lags separately within each ward. FastAPI loads the saved scikit-learn model and serves cached forecasts to React. The data ends on 29 December 2025. Outputs are historical replays. Risk tiers describe relative case counts. Ward boundaries, reliable ward population denominators and hospital admissions are unavailable. Prediction intervals describe error on this dataset and require validation before operational use.

## Team and AI disclosure

| Member | Responsibility |
|---|---|
| S (GitHub: shahrudrahman) | Dataset provenance, validation, pipeline checks and submission documentation |
| M (commit author: Marwa Mohammed Jashim) | Forecast models, evaluation, model artefact and FastAPI |
| F (GitHub: MohonaFyrin) | React dashboard, interface and API integration |

The team handoff identifies Claude via Claude Code for generating and testing code and documentation. OpenAI Codex compared the existing ML report with the architecture and prepared the submission documentation and demo script. Runtime inference uses the saved local model. It calls no external AI or weather APIs. The stack uses FastAPI, Uvicorn, pandas, NumPy, SciPy, scikit-learn, joblib, React and Vite.

[Two-minute live demo script](docs/DEMO_SCRIPT.md)

## Local operation and privacy

After the private inputs and frontend build are in place, run `.\start.cmd` from the repository root for subsequent starts. The launcher binds to the loopback address. Public, Officer and Hospital are demonstration views with no login or access control. Use aggregate ward data only. Keep the workbook outside the repository. In a fresh clone, add a local Git exclusion before creating the CSV:

~~~powershell
Add-Content .git/info/exclude '/backend/data/official.csv'
~~~

The Public view includes Bangla/English education and source links to WHO and CDC. Officer rankings support prioritisation and Hospital comparisons show ward burden over time. The API exposes health, wards, issue weeks, forecast, forecast/all, priority, compare, history and metrics under `/api`. Interactive parameters and responses are available at `/docs`.

For frontend development, run FastAPI on port 8000 and run `npm run dev` in `frontend`. To run backend tests, install `backend/requirements-dev.txt` in the same environment and run `python -m pytest -q tests` from `backend` using that environment. With the app running, the browser checks are available through `npm run test:e2e` in `frontend`.
