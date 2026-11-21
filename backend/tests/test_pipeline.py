import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import (FEATURES, HORIZONS, MODEL_PATH, TEST_START, TRAIN_END, VAL_END, add_features,  # noqa: E402
                    count_tier_index, estimate_tier_index, load_data, split_masks, validate_data)


@pytest.fixture(scope="module")
def df():
    return load_data()


@pytest.fixture(scope="module")
def feat(df):
    return add_features(df)


def test_dataset_integrity(df):
    r = validate_data(df)
    assert r["ok"], r["checks"]
    assert (r["rows"], r["wards"], r["weeks_per_ward"]) == (31320, 60, 522)
    assert r["last_week"] == "2025-12-29"


def test_lags_are_ward_specific_and_correct(df, feat):
    for ward in ("CCC_Ward_01", df.ward_id.iloc[-1]):
        raw = df[df.ward_id == ward].reset_index(drop=True)
        f = feat[feat.ward_id == ward].reset_index(drop=True)
        for i in (10, 200, 521):
            for k in (1, 2, 3, 4):
                assert f.loc[i, f"rain_lag{k}"] == raw.rainfall_mm[i - k]
            assert f.loc[i, "rain_sum_4w"] == pytest.approx(raw.rainfall_mm[i - 3:i + 1].sum())
            assert f.loc[i, "rain_sum_8w"] == pytest.approx(raw.rainfall_mm[i - 7:i + 1].sum())
            assert f.loc[i, "cases_lag2"] == raw.dengue_cases[i - 2]
    # first rows of a ward must not borrow values from the previous ward
    first = feat.groupby("ward_id").head(1)
    assert first.rain_lag1.isna().all()


def test_targets_are_future_cases(df, feat):
    raw = df[df.ward_id == "CCC_Ward_02"].reset_index(drop=True)
    f = feat[feat.ward_id == "CCC_Ward_02"].reset_index(drop=True)
    for h in HORIZONS:
        assert f.loc[50, f"target_{h}"] == raw.dengue_cases[50 + h]


def test_no_future_leakage_in_features(df):
    """Scrambling every observation after week t must not change any feature at or before t."""
    cut = pd.Timestamp("2022-06-06")
    altered = df.copy()
    rng = np.random.default_rng(0)
    after = altered.date > cut
    for col in ("rainfall_mm", "avg_temp_c", "relative_humidity_pct", "dengue_cases"):
        altered.loc[after, col] = rng.permutation(altered.loc[after, col].to_numpy())
    a, b = add_features(df), add_features(altered)
    keep = a.date <= cut
    pd.testing.assert_frame_equal(a.loc[keep, FEATURES], b.loc[keep, FEATURES])


@pytest.mark.parametrize("h", HORIZONS)
def test_chronological_splits_do_not_overlap(feat, h):
    tr, va, te = split_masks(feat, h)
    assert tr.sum() > 0 and va.sum() > 0 and te.sum() > 0
    target = feat.date + pd.Timedelta(weeks=h)
    assert target[tr].max() <= TRAIN_END
    assert feat.date[va].min() > TRAIN_END and target[va].max() <= VAL_END
    assert feat.date[te].min() >= TEST_START
    assert not (tr & va).any() and not (tr & te).any() and not (va & te).any()
    # every training target is strictly earlier than every validation issue week's target
    assert target[tr].max() < target[va].min()


def test_tier_estimate_matches_count_tiers_for_integers():
    cuts = [0, 5, 13]
    for k in range(0, 200):
        assert estimate_tier_index(float(k), cuts) == count_tier_index(k, cuts)
    # tiny positive estimate is Low (observed 0 is Low); estimates are monotone in tier
    assert estimate_tier_index(0.004, cuts) == 0
    est = np.linspace(0, 60, 601)
    assert (np.diff(estimate_tier_index(est, cuts)) >= 0).all()
    assert estimate_tier_index(5.49, cuts) == 1 and estimate_tier_index(5.51, cuts) == 2


def test_bundle_thresholds_come_from_training_data_only(df):
    bundle = joblib.load(MODEL_PATH)
    train = df[df.date <= TRAIN_END].dengue_cases
    expected = [int(np.quantile(train, q, method="higher")) for q in (0.5, 0.8, 0.95)]
    assert bundle["thresholds"] == expected


@pytest.mark.parametrize("h", HORIZONS)
def test_trained_model_loads_and_beats_baseline(feat, h):
    bundle = joblib.load(MODEL_PATH)
    _, _, te = split_masks(feat, h)
    X, y = feat.loc[te, FEATURES], feat.loc[te, f"target_{h}"]
    pred = np.clip(bundle["models"][h].predict(X), 0, None)
    mae = np.abs(pred - y).mean()
    base = np.abs(feat.loc[te, "cases_now"] - y).mean()
    assert mae < base
    assert len(np.unique(pred.round(3))) > 100  # dynamic, not constant output
