"""Convert the official XLSX to value-preserving CSVs (run once in setup).

Usage: python prepare_data.py path/to/bangladesh_dengue_large_dataset_onsite.xlsx

* data/official.csv - the 12 Phase 1 columns (model input; fingerprinted against the model).
* data/supply.csv   - ward_id, date, dengue_cases and the three Phase 2 supply columns
                      (saline_bags_needed, diagnostic_kits_needed, hospital_beds_required),
                      used to fit and verify the per-case demand ratios.
The Phase 1 (preliminary) XLSX with only 12 columns is also accepted.
"""
import json
import sys
from pathlib import Path

import pandas as pd

from common import COLUMNS, DATA_CSV, REPORTS, SUPPLY_COLUMNS, SUPPLY_CSV, sha256_file

SHEET = "bangladesh_dengue_large_dataset"


def main(xlsx: str) -> None:
    df = pd.read_excel(xlsx, sheet_name=SHEET)
    cols = list(df.columns)
    assert cols[:len(COLUMNS)] == COLUMNS, f"Unexpected columns: {cols}"
    extra = cols[len(COLUMNS):]
    assert extra in ([], SUPPLY_COLUMNS), f"Unexpected extra columns: {extra}"
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    DATA_CSV.parent.mkdir(parents=True, exist_ok=True)
    df[COLUMNS].to_csv(DATA_CSV, index=False)
    if extra:
        df[["ward_id", "date", "dengue_cases", *SUPPLY_COLUMNS]].to_csv(SUPPLY_CSV, index=False)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "source.json").write_text(json.dumps({
        "source_file": Path(xlsx).name,
        "sheet": SHEET,
        "xlsx_sha256": sha256_file(Path(xlsx)),
        "csv_sha256": sha256_file(DATA_CSV),
        "supply_csv_sha256": sha256_file(SUPPLY_CSV) if extra else None,
        "rows": len(df),
    }, indent=2))
    print("Wrote", DATA_CSV, len(df), "rows", "+ supply.csv" if extra else "")


if __name__ == "__main__":
    main(sys.argv[1])
