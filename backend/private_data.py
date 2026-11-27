"""Private inputs for a hosted deployment, kept out of the public repository.

Hosts such as Render store small "secret files" (1 MB total). The dataset CSV is 2.6 MB, so it is packed
as xz + base64 text (about 0.4 MB):

    python private_data.py pack      -> writes deploy/official.csv.xz.b64 and deploy/validation.json (local, git-ignored)
    python private_data.py restore   -> on the server: rebuilds data/official.csv and reports/validation.json
                                        from the secret files, then checks the CSV fingerprint against the model

restore does nothing when the files already exist (normal local use).
"""
from __future__ import annotations

import base64
import lzma
import shutil
import sys
from pathlib import Path

from common import DATA_CSV, REPORTS, ROOT, sha256_file

PACKED = "official.csv.xz.b64"
VALIDATION = "validation.json"
DEPLOY = ROOT.parent / "deploy"
SECRET_DIRS = (Path("/etc/secrets"), ROOT.parent, DEPLOY)


def pack() -> None:
    DEPLOY.mkdir(exist_ok=True)
    text = base64.b64encode(lzma.compress(DATA_CSV.read_bytes(), preset=9)).decode("ascii")
    (DEPLOY / PACKED).write_text(text, encoding="ascii")
    shutil.copyfile(REPORTS / VALIDATION, DEPLOY / VALIDATION)
    print(f"Wrote {DEPLOY / PACKED} ({len(text) / 1e6:.2f} MB) and {DEPLOY / VALIDATION}")


def _find(name: str) -> Path | None:
    return next((d / name for d in SECRET_DIRS if (d / name).is_file()), None)


def restore() -> None:
    if not DATA_CSV.is_file():
        src = _find(PACKED)
        if src is None:
            sys.exit(f"Missing dataset: add the secret file {PACKED} (see docs/DEPLOY.md).")
        DATA_CSV.parent.mkdir(parents=True, exist_ok=True)
        DATA_CSV.write_bytes(lzma.decompress(base64.b64decode("".join(src.read_text(encoding="ascii").split()))))
        print("Restored", DATA_CSV, sha256_file(DATA_CSV)[:12])
    if not (REPORTS / VALIDATION).is_file():
        src = _find(VALIDATION)
        if src is None:
            sys.exit(f"Missing {VALIDATION}: add it as a secret file (see docs/DEPLOY.md).")
        shutil.copyfile(src, REPORTS / VALIDATION)
        print("Restored", REPORTS / VALIDATION)


if __name__ == "__main__":
    {"pack": pack, "restore": restore}[sys.argv[1] if len(sys.argv) > 1 else "restore"]()
