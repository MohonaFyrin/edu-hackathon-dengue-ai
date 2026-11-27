"""Builds a ready-to-deploy Vercel folder (../vercel-deploy) from this project.

The folder contains the full backend (real model, same code as start.cmd), the built website and the
private dataset, so it is deployed with the Vercel CLI from this computer and is NEVER pushed to GitHub.

    .venv\\Scripts\\python.exe make_vercel.py
"""
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "vercel-deploy"
BACK = HERE / "backend"

REQUIRED = [BACK / "data" / "official.csv", BACK / "reports" / "validation.json",
            BACK / "models" / "forecaster.joblib", HERE / "frontend" / "dist" / "index.html"]
missing = [str(p) for p in REQUIRED if not p.is_file()]
if missing:
    raise SystemExit("Run setup.cmd first. Missing: " + ", ".join(missing))

if OUT.exists():
    shutil.rmtree(OUT)
(OUT / "backend").mkdir(parents=True)

for py in BACK.glob("*.py"):
    shutil.copy2(py, OUT / "backend" / py.name)
for sub in ("models", "geo", "reports"):
    shutil.copytree(BACK / sub, OUT / "backend" / sub)
(OUT / "backend" / "data").mkdir()
shutil.copy2(BACK / "data" / "official.csv", OUT / "backend" / "data" / "official.csv")
shutil.copytree(HERE / "frontend" / "dist", OUT / "frontend" / "dist")   # served by FastAPI
shutil.copytree(HERE / "frontend" / "dist", OUT / "public")              # also served by Vercel's CDN

shutil.copy2(BACK / "requirements.txt", OUT / "requirements.txt")
(OUT / ".python-version").write_text("3.14\n")
(OUT / "index.py").write_text('''"""Vercel entrypoint: the same FastAPI app that start.cmd runs locally."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app import app  # noqa: E402,F401
''')
(OUT / "README-DEPLOY.txt").write_text(
    "Deploy from this folder with the Vercel CLI:  npx vercel --prod\n"
    "It contains the private dataset (backend/data/official.csv). Do not upload it to GitHub.\n")

size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
print(f"Built {OUT} ({size / 1e6:.1f} MB)")
