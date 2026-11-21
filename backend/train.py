"""Train, select, evaluate and serialise the 2/3/4-week ward forecasters.

Chronology: train (targets <= 2022-12-31) -> validation (2023) picks the model and
fits the uncertainty bands -> final model refit on train+validation -> test (2024-2025)
is touched exactly once for reporting. Risk-tier cut-offs use training data only.
"""
import json
import sys

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from common import (DATA_CSV, FEATURE_GROUPS, FEATURES, HORIZONS, MODEL_PATH, REPORTS, TIERS,
                    TRAIN_END, add_features, count_tier_index, estimate_tier_index, load_data,
                    sha256_file, split_masks, validate_data)

QUANTILES = (0.5, 0.8, 0.95)  # tier cut-offs (training percentiles): Low <= p50 < Medium <= p80 < High <= p95 < Critical


def candidates():
    return {
        "ridge": make_pipeline(StandardScaler(), Ridge(alpha=10.0)),
        "hist_gradient_boosting": HistGradientBoostingRegressor(
            loss="poisson", learning_rate=0.05, max_iter=300, max_depth=6,
            min_samples_leaf=30, l2_regularization=1.0, random_state=42),
    }


def predict(model, X):
    return np.clip(model.predict(X), 0, None)


def scores(y, p):
    return {"mae": float(mean_absolute_error(y, p)),
            "rmse": float(np.sqrt(mean_squared_error(y, p)))}


def group_importance(model, X, y, rng):
    """Increase in validation MAE when one feature group is shuffled."""
    base = mean_absolute_error(y, predict(model, X))
    out = {}
    for name, cols in FEATURE_GROUPS.items():
        Xp = X.copy()
        idx = rng.permutation(len(Xp))
        Xp[cols] = Xp[cols].to_numpy()[idx]
        out[name] = float(mean_absolute_error(y, predict(model, Xp)) - base)
    return out


def main():
    df = load_data()
    report = validate_data(df)
    report["csv_sha256"] = sha256_file(DATA_CSV)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "data_validation.json").write_text(json.dumps(report, indent=2))
    if not report["ok"]:
        sys.exit("Dataset validation failed: " + json.dumps(report["checks"]))

    f = add_features(df)
    train_cases = df.loc[df.date <= TRAIN_END, "dengue_cases"]
    thresholds = [int(np.quantile(train_cases, q, method="higher")) for q in QUANTILES]
    totals = (df[df.date <= TRAIN_END].groupby(["city", "date"]).dengue_cases.sum()
              .groupby("city").quantile(list(QUANTILES)).unstack())
    city_thresholds = {c: [int(np.ceil(v)) for v in row] for c, row in totals.iterrows()}

    bundle = {"models": {}, "selected": {}, "intervals": {}, "drivers": {}, "thresholds": thresholds,
              "city_thresholds": city_thresholds, "features": FEATURES,
              "sklearn_version": sklearn.__version__, "dataset_sha256": report["csv_sha256"],
              "split": {"train_targets_through": "2022-12-31", "validation_targets_through": "2023-12-31",
                        "test_issue_weeks_from": "2024-01-01"}}
    metrics = {"thresholds": thresholds, "tier_quantiles": list(QUANTILES), "horizons": {}}
    rng = np.random.default_rng(7)

    for h in HORIZONS:
        tr, va, te = split_masks(f, h)
        y = f"target_{h}"
        Xtr, ytr, Xva, yva = f.loc[tr, FEATURES], f.loc[tr, y], f.loc[va, FEATURES], f.loc[va, y]
        val_scores, fitted = {}, {}
        for name, model in candidates().items():
            model.fit(Xtr, ytr)
            fitted[name] = model
            val_scores[name] = scores(yva, predict(model, Xva))
        best = min(val_scores, key=lambda n: val_scores[n]["mae"])

        # Uncertainty band: validation residual 10th/90th percentiles per predicted tier.
        pva = predict(fitted[best], Xva)
        resid = yva.to_numpy() - pva
        tiers_va = estimate_tier_index(pva, thresholds)
        overall = (float(np.quantile(resid, 0.1)), float(np.quantile(resid, 0.9)))
        bands = []
        for t in range(4):
            r = resid[tiers_va == t]
            bands.append([float(np.quantile(r, 0.1)), float(np.quantile(r, 0.9))] if len(r) >= 30 else list(overall))
        bundle["drivers"][h] = group_importance(fitted[best], Xva, yva, rng)

        # Final model: refit on train + validation; test is untouched until now.
        final = candidates()[best]
        final.fit(f.loc[tr | va, FEATURES], f.loc[tr | va, y])
        Xte, yte = f.loc[te, FEATURES], f.loc[te, y]
        pte = predict(final, Xte)
        base_last = f.loc[te, "cases_now"]
        ward_mean = f.loc[te, "ward_id"].map(f.loc[tr].groupby("ward_id")[y].mean())
        tier_pred = estimate_tier_index(pte, thresholds)
        lo = np.maximum(0, pte + np.array(bands)[tier_pred, 0])
        hi = pte + np.array(bands)[tier_pred, 1]
        tier_obs = count_tier_index(yte.to_numpy(), thresholds)
        by_year = {str(yr): scores(yte[f.loc[te, "date"].dt.year == yr], pte[(f.loc[te, "date"].dt.year == yr).to_numpy()])
                   for yr in sorted(f.loc[te, "date"].dt.year.unique())}
        metrics["horizons"][str(h)] = {
            "selected_model": best,
            "train_rows": int(tr.sum()), "validation_rows": int(va.sum()), "test_rows": int(te.sum()),
            "validation_candidates": val_scores,
            "test": scores(yte, pte),
            "baseline_last_week": scores(yte, base_last),
            "baseline_ward_training_mean": scores(yte, ward_mean),
            "test_by_year": by_year,
            "tier_exact_accuracy": float((tier_pred == tier_obs).mean()),
            "tier_within_one": float((abs(tier_pred - tier_obs) <= 1).mean()),
            "interval_80_coverage": float(((yte.to_numpy() >= lo) & (yte.to_numpy() <= hi)).mean()),
            "test_issue_weeks": [str(f.loc[te, "date"].min().date()), str(f.loc[te, "date"].max().date())],
            "driver_importance_mae_increase": bundle["drivers"][h],
        }
        bundle["models"][h], bundle["selected"][h], bundle["intervals"][h] = final, best, bands
        m = metrics["horizons"][str(h)]
        print(f"h={h} {best}: test MAE {m['test']['mae']:.3f} RMSE {m['test']['rmse']:.3f} | "
              f"last-week MAE {m['baseline_last_week']['mae']:.3f} | "
              f"tier acc {m['tier_exact_accuracy']:.2f} | 80% cov {m['interval_80_coverage']:.2f}")

    metrics["tiers"] = TIERS
    metrics["split"] = bundle["split"]
    MODEL_PATH.parent.mkdir(exist_ok=True)
    joblib.dump(bundle, MODEL_PATH, compress=3)
    (REPORTS / "validation.json").write_text(json.dumps(metrics, indent=2))
    print("Thresholds:", thresholds, "Saved", MODEL_PATH)


if __name__ == "__main__":
    main()


