"""Data loading, validation and leakage-free feature engineering.

Every feature in a row dated t is computed only from observations dated <= t
of the same ward, so a forecast issued in week t never sees the future.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA_CSV = ROOT / "data" / "official.csv"
SUPPLY_CSV = ROOT / "data" / "supply.csv"
SUPPLY_COLUMNS = ["saline_bags_needed", "diagnostic_kits_needed", "hospital_beds_required"]
MODEL_PATH = ROOT / "models" / "forecaster.joblib"
REPORTS = ROOT / "reports"

COLUMNS = [
    "date", "city", "ward_id", "population_density_sqkm", "water_logging_risk_index",
    "sanitation_score", "avg_temp_c", "max_temp_c", "min_temp_c", "rainfall_mm",
    "relative_humidity_pct", "dengue_cases",
]
TRAITS = ["population_density_sqkm", "water_logging_risk_index", "sanitation_score"]
HORIZONS = (2, 3, 4)
TIERS = ["Low", "Medium", "High", "Critical"]

# Chronological split (by target date, so train targets never overlap validation).
TRAIN_END = pd.Timestamp("2022-12-31")
VAL_END = pd.Timestamp("2023-12-31")
TEST_START = pd.Timestamp("2024-01-01")

FEATURE_GROUPS = {
    "rain_lags": ["rain_now", "rain_lag1", "rain_lag2", "rain_lag3", "rain_lag4",
                  "rain_sum_4w", "rain_sum_8w"],
    "temperature": ["temp_now", "temp_mean_4w"],
    "humidity": ["hum_now", "hum_mean_4w"],
    "recent_cases": ["cases_now", "cases_lag1", "cases_lag2", "cases_lag3", "cases_mean_4w"],
    "vulnerability": TRAITS,
    "season": ["week_sin", "week_cos"],
}
FEATURES = [c for cols in FEATURE_GROUPS.values() for c in cols]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_data(path: Path = DATA_CSV) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["date"])
    return df.sort_values(["ward_id", "date"]).reset_index(drop=True)


def validate_data(df: pd.DataFrame) -> dict:
    """Integrity checks on the official dataset. Returns a JSON-serialisable report."""
    checks: dict[str, bool] = {}
    checks["expected_columns"] = list(df.columns) == COLUMNS
    checks["no_missing_values"] = bool(df[COLUMNS].notna().all().all()) if checks["expected_columns"] else False
    if not checks["expected_columns"]:
        return {"ok": False, "checks": checks}
    checks["unique_ward_date"] = not df.duplicated(["ward_id", "date"]).any()
    weeks = df.groupby("ward_id").date.agg(["count", "min", "max"])
    checks["same_weeks_for_every_ward"] = weeks["count"].nunique() == 1 and weeks["min"].nunique() == 1
    gaps = df.groupby("ward_id").date.diff().dropna()
    checks["strictly_weekly_spacing"] = bool((gaps == pd.Timedelta(days=7)).all())
    checks["each_ward_in_one_city"] = bool((df.groupby("ward_id").city.nunique() == 1).all())
    checks["traits_constant_per_ward"] = bool((df.groupby("ward_id")[TRAITS].nunique() == 1).all().all())
    checks["humidity_0_100"] = bool(df.relative_humidity_pct.between(0, 100).all())
    checks["rainfall_non_negative"] = bool((df.rainfall_mm >= 0).all())
    checks["cases_non_negative_integer"] = bool((df.dengue_cases >= 0).all())
    checks["min_avg_max_temperature_order"] = bool(
        ((df.min_temp_c <= df.avg_temp_c) & (df.avg_temp_c <= df.max_temp_c)).all())
    return {
        "ok": all(checks.values()),
        "rows": int(len(df)),
        "wards": int(df.ward_id.nunique()),
        "cities": {k: int(v) for k, v in df.groupby("city").ward_id.nunique().items()},
        "weeks_per_ward": int(weeks["count"].iloc[0]),
        "first_week": str(df.date.min().date()),
        "last_week": str(df.date.max().date()),
        "total_cases": int(df.dengue_cases.sum()),
        "checks": checks,
    }


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """Ward-grouped lag / rolling features plus targets (cases h weeks ahead)."""
    f = df.sort_values(["ward_id", "date"]).reset_index(drop=True).copy()
    g = f.groupby("ward_id", sort=False)
    rain, temp, hum, cases = g.rainfall_mm, g.avg_temp_c, g.relative_humidity_pct, g.dengue_cases
    f["rain_now"] = f.rainfall_mm
    for k in (1, 2, 3, 4):
        f[f"rain_lag{k}"] = rain.shift(k)
    f["rain_sum_4w"] = rain.transform(lambda s: s.rolling(4).sum())
    f["rain_sum_8w"] = rain.transform(lambda s: s.rolling(8).sum())
    f["temp_now"] = f.avg_temp_c
    f["temp_mean_4w"] = temp.transform(lambda s: s.rolling(4).mean())
    f["hum_now"] = f.relative_humidity_pct
    f["hum_mean_4w"] = hum.transform(lambda s: s.rolling(4).mean())
    f["cases_now"] = f.dengue_cases
    for k in (1, 2, 3):
        f[f"cases_lag{k}"] = cases.shift(k)
    f["cases_mean_4w"] = cases.transform(lambda s: s.rolling(4).mean())
    week = f.date.dt.isocalendar().week.astype(float)
    f["week_sin"] = np.sin(2 * np.pi * week / 52.18)
    f["week_cos"] = np.cos(2 * np.pi * week / 52.18)
    for h in HORIZONS:
        f[f"target_{h}"] = cases.shift(-h)
    return f


def split_masks(f: pd.DataFrame, h: int):
    """Chronological train / validation / test masks for horizon h (by target date)."""
    target_date = f.date + pd.Timedelta(weeks=h)
    ok = f[FEATURES + [f"target_{h}"]].notna().all(axis=1)
    train = ok & (target_date <= TRAIN_END)
    val = ok & (f.date > TRAIN_END) & (target_date <= VAL_END)
    test = ok & (f.date >= TEST_START)
    return train, val, test


def count_tier_index(counts, cuts):
    """Tier index of observed integer weekly counts. cuts = training percentiles [c1, c2, c3]:
    Low: k <= c1 | Medium: c1 < k <= c2 | High: c2 < k <= c3 | Critical: k > c3."""
    return np.searchsorted(np.asarray(cuts), counts, side="left")


def estimate_tier_index(estimates, cuts):
    """Tier index of a *continuous* estimated count. Observed counts are integers, so the
    estimate is compared at the half-integer boundaries c + 0.5 (continuity correction).
    For every integer k this equals count_tier_index(k) -- verified in the tests -- so a
    predicted 0.004 cases is Low, exactly as an observed 0 is Low, with no ad-hoc rounding."""
    return np.searchsorted(np.asarray(cuts) + 0.5, estimates, side="right")


def tier_of(estimate, cuts) -> str:
    return TIERS[int(estimate_tier_index(estimate, cuts))]
