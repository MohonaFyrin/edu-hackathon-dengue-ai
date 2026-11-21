"""Convert the official XLSX to a value-preserving CSV (run once; the CSV is committed).

Usage: python prepare_data.py path/to/hackathon_preli_dataset.xlsx
"""
import json
import sys

import pandas as pd

from common import COLUMNS, DATA_CSV, REPORTS, sha256_file

SHEET = "bangladesh_dengue_large_dataset"


def main(xlsx: str) -> None:
    df = pd.read_excel(xlsx, sheet_name=SHEET)
    assert list(df.columns) == COLUMNS, f"Unexpected columns: {list(df.columns)}"
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    DATA_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(DATA_CSV, index=False)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "source.json").write_text(json.dumps({
        "source_file": "hackathon_preli_dataset.xlsx",
        "sheet": SHEET,
        "xlsx_sha256": sha256_file(__import__("pathlib").Path(xlsx)),
        "csv_sha256": sha256_file(DATA_CSV),
        "rows": len(df),
    }, indent=2))
    print("Wrote", DATA_CSV, len(df), "rows")


if __name__ == "__main__":
    main(sys.argv[1])
