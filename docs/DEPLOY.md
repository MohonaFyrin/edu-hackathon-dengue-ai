# Live deployment (Render)

One Render web service runs the FastAPI backend and serves the built website (`frontend/dist`, committed).
The private dataset is **not** in the repository; it is supplied as two Render Secret Files.

## 1. Make the two secret files (on a computer that already ran setup.cmd)

~~~
cd backend
..\.venv\Scripts\python.exe private_data.py pack
~~~

This writes `deploy/official.csv.xz.b64` (the dataset, compressed to text, about 0.4 MB) and
`deploy/validation.json`. The `deploy/` folder is git-ignored. Do not commit it.

## 2. Create the service

1. render.com → **New → Blueprint** → connect this GitHub repository (branch `main`). Render reads `render.yaml`.
2. Open the new service → **Environment → Secret Files → Add Secret File**, twice:
   - Filename `official.csv.xz.b64`, contents = the whole text of `deploy/official.csv.xz.b64`
   - Filename `validation.json`, contents = the whole text of `deploy/validation.json`
3. **Save, rebuild and deploy.** When the log shows `Application startup complete`, open the service URL.

Settings used by `render.yaml`: build `pip install -r backend/requirements.txt`; start
`python backend/private_data.py restore && uvicorn app:app --app-dir backend --host 0.0.0.0 --port $PORT`;
health check `/api/health`; `PYTHON_VERSION=3.14.10`.

## Things to know

- Free services sleep after 15 minutes without visitors; the first visit afterwards takes about a minute.
- The free disk is temporary: citizen reports are erased on every restart or redeploy.
- The report review list has no login. Anyone with the URL can read submitted reports.
- The site shows forecasts and case history derived from the dataset. Confirm the organisers allow this publicly.
- Startup checks the dataset fingerprint against the model and stops if they differ.
