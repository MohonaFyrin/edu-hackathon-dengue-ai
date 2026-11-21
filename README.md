# ডেঙ্গু আগাম সতর্কতা — Dengue Early Warning (Phase 1)

Ward-level dengue forecasts (2, 3, 4 weeks ahead) from weather lags, for the EDU AI Engineering Hackathon 2026 preliminary round.
Bangla-first website (Bangla/English toggle, local dictionaries) with Public, Government Officer and Hospital views (demonstration views, no login) plus a Model Performance page. The Public page includes a small hotline strip (999 National Emergency Service, 16263 DGHS Shastho Batayon, dghs.gov.bd) with source links; numbers were cross-checked in news and government-project listings in Nov 2026 - re-verify before publishing. Larvicide guidance in the Officer view is a planning prompt only, not an instruction.
All forecasts are **retrospective** on the official dataset (to 2025-12-29), not live surveillance. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Run on Windows 10 (≈ 1–3 minutes, Python 3.12+; Node is NOT needed — the built UI is included)
```powershell
git clone <your-repo-url> dengue-early-warning
cd dengue-early-warning
.\start.cmd
```
Then open **http://127.0.0.1:8000** (first start can take ~20 s while data and features load). `start.cmd` creates `.venv`, installs `backend\requirements.txt` and starts FastAPI, which also serves the UI.
Manual equivalent:
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd backend
..\.venv\Scripts\python.exe -m uvicorn app:app --port 8000
```
API docs: http://127.0.0.1:8000/docs

## Tests
```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
cd backend; ..\.venv\Scripts\python.exe -m pytest -q tests          # 31 backend tests (data, lags, leakage, model, tiers, API)
cd ..\frontend; npm install; node e2e\browser-test.mjs                # Playwright e2e, 14 checks incl. Bangla/English, hotlines, mobile (needs Chrome/Edge, app on :8000)
```
Rebuild UI: `cd frontend; npm install; npm run build` (Node 22+). Dev mode: run FastAPI on 8000, then `npm run dev` (proxy included).
Retrain: `cd backend; ..\.venv\Scripts\python.exe train.py` (about 1 minute; rewrites `models/` and `reports/`).

## API (`/api`)
`GET /health` · `/wards?city=` · `/issue-weeks` · `/forecast?ward_id&issue_date&horizon_weeks=2|3|4` · `/forecast/all?issue_date&horizon_weeks&city=` ·
`/priority?issue_date&horizon_weeks&city=&limit=10` · `/compare?issue_date&ward_id|city` · `/history?issue_date&ward_id|city&weeks=` · `/metrics`.
Errors: `{"error":{"code","message"}}` with 404 (unknown ward/city) or 422 (bad date/horizon).

## Team responsibilities (fill in real names; commits must be made by each member)
| Member | Area |
|---|---|
| _Member A_ | Data validation, feature pipeline (`backend/common.py`, `prepare_data.py`) |
| _Member B_ | Model training/evaluation and FastAPI (`train.py`, `app.py`, `tests/`) |
| _Member C_ | React UI, Bangla content, e2e tests (`frontend/`) |

## AI assistants and external APIs (disclosure)
* **Claude (Anthropic, via Claude Code)** generated and tested the code and documentation of this project. Team members must review it and record their own contributions.
* No external APIs, LLM endpoints or paid services are called by the application at runtime. Google Fonts/CDNs are not used (system Bengali fonts).
* Libraries: FastAPI, Uvicorn, pandas, NumPy, SciPy, scikit-learn, joblib; React 18, Vite; Playwright (tests only).

## Data and attributions
Official hackathon dataset `hackathon_preli_dataset.xlsx` (sheet `bangladesh_dengue_large_dataset`), converted value-for-value to `backend/data/official.csv`
(hashes in `backend/reports/source.json`). Redistribution terms and data provenance were not stated by the organisers — confirm before publishing the repository.
Prevention/warning-sign text follows general public guidance from [WHO](https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue) and [CDC](https://www.cdc.gov/dengue/); the site does not diagnose.

## Limitations
Retrospective replay only; weeks inside 2016–2023 are in-sample (labelled). No ward boundaries in the data, so a ward grid replaces a map.
Tiers are relative to training-period case counts, not per-capita. Case counts as supplied; reporting methods unknown. No admissions, beds or patient data.

