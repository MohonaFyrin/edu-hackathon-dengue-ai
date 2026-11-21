"""FastAPI service: loads the serialised model once, caches deterministic forecasts."""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import date, timedelta
from functools import lru_cache
from typing import Annotated

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from common import (DATA_CSV, FEATURES, HORIZONS, MODEL_PATH, REPORTS, ROOT, TIERS, TRAIN_END,
                    VAL_END, add_features, estimate_tier_index, load_data, sha256_file)

Horizon = Annotated[int, Query(ge=2, le=4, description="Weeks ahead: 2, 3 or 4")]
DATA_NOTE = ("Retrospective forecasts built from the supplied dataset (to 2025-12-29). "
             "This is not live surveillance.")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


class Store:
    """Everything loaded once at start-up."""

    def __init__(self):
        self.bundle = joblib.load(MODEL_PATH)
        if self.bundle["dataset_sha256"] != sha256_file(DATA_CSV):
            raise RuntimeError("Model was trained on a different dataset; run train.py")
        self.df = load_data()
        self.feat = add_features(self.df)
        self.feat["day"] = self.feat.date.dt.date
        valid = self.feat.dropna(subset=FEATURES)
        self.weeks = {d: g.reset_index(drop=True) for d, g in valid.groupby("day")}
        self.issue_dates = sorted(self.weeks)
        self.last_data_day = self.df.date.max().date()
        w = self.df[["ward_id", "city"]].drop_duplicates().sort_values(["city", "ward_id"])
        self.wards = w.to_dict("records")
        self.ward_city = dict(zip(w.ward_id, w.city))
        self.cities = sorted(w.city.unique())
        self.metrics = json.loads((REPORTS / "validation.json").read_text())
        self.data_report = json.loads((REPORTS / "data_validation.json").read_text())
        train = self.df[self.df.date <= TRAIN_END]
        self.month_normal = train.groupby(["ward_id", train.date.dt.month]).rainfall_mm.mean()
        self.traits = self.df.groupby("ward_id")[
            ["population_density_sqkm", "water_logging_risk_index", "sanitation_score"]].first()
        self.traits_pct = self.traits.rank(pct=True)

    def mode(self, target: date) -> str:
        return "in_sample" if pd.Timestamp(target) <= VAL_END else "out_of_sample"


app_state: dict[str, Store] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    app_state["store"] = Store()
    yield


app = FastAPI(title="Dengue Early Warning API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET"], allow_headers=["*"])


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


@app.exception_handler(ApiError)
async def api_error(_, exc: ApiError):
    return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message}})


@app.exception_handler(RequestValidationError)
async def invalid(_, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"error": {
        "code": "INVALID_INPUT", "message": "Check issue_date (YYYY-MM-DD), ward_id and horizon (2, 3 or 4)."}})


def store() -> Store:
    return app_state["store"]


def need_week(day: date) -> None:
    if day not in store().weeks:
        raise ApiError(422, "UNAVAILABLE_ISSUE_DATE", "issue_date is not an available weekly issue date.")


def need_ward(ward_id: str) -> None:
    if ward_id not in store().ward_city:
        raise ApiError(404, "UNKNOWN_WARD", "Unknown ward_id.")


def need_city(city: str) -> None:
    if city not in store().cities:
        raise ApiError(404, "UNKNOWN_CITY", "Unknown city.")


@lru_cache(maxsize=256)
def week_forecast(day: date, h: int) -> tuple:
    """Real model inference for every ward for one issue week + horizon (cached)."""
    s = store()
    rows = s.weeks[day]
    model, cuts, bands = s.bundle["models"][h], s.bundle["thresholds"], np.array(s.bundle["intervals"][h])
    pred = np.clip(model.predict(rows[FEATURES]), 0, None)
    tier_idx = estimate_tier_index(pred, cuts)
    target = day + timedelta(weeks=h)
    out = []
    for i, r in rows.iterrows():
        obs = r[f"target_{h}"]
        out.append({
            "ward_id": r.ward_id, "city": r.city, "issue_date": day.isoformat(),
            "target_date": target.isoformat(), "horizon_weeks": h,
            "predicted_cases": round(float(pred[i]), 2),
            "lower_cases": round(float(max(0, pred[i] + bands[tier_idx[i], 0])), 2),
            "upper_cases": round(float(pred[i] + bands[tier_idx[i], 1]), 2),
            "risk_tier": TIERS[tier_idx[i]],
            "observed_cases": None if pd.isna(obs) else int(obs),
            "mode": s.mode(target),
        })
    return tuple(out)


def city_total(day: date, h: int, city: str) -> dict:
    items = [r for r in week_forecast(day, h) if r["city"] == city]
    total = round(sum(r["predicted_cases"] for r in items), 1)
    obs = [r["observed_cases"] for r in items]
    cuts = store().bundle["city_thresholds"][city]
    return {"city": city, "horizon_weeks": h, "target_date": items[0]["target_date"],
            "predicted_cases": total, "risk_tier": TIERS[int(estimate_tier_index(total, cuts))],
            "observed_cases": None if any(o is None for o in obs) else int(sum(obs)),
            "mode": items[0]["mode"], "tier_cutoffs": cuts,
            "wards_by_tier": {t: sum(1 for r in items if r["risk_tier"] == t) for t in TIERS}}


def weather_for(day: date, ward_id: str) -> dict:
    s = store()
    r = s.weeks[day]
    r = r[r.ward_id == ward_id].iloc[0]
    month = pd.Timestamp(day).month
    normal_week = float(s.month_normal[(ward_id, month)])
    return {
        "week": day.isoformat(),
        "avg_temp_c": float(r.temp_now), "avg_temp_4w_c": float(r.temp_mean_4w),
        "humidity_pct": float(r.hum_now), "humidity_4w_pct": float(r.hum_mean_4w),
        "rain_by_lag_mm": {"0": float(r.rain_now), "1": float(r.rain_lag1), "2": float(r.rain_lag2),
                           "3": float(r.rain_lag3), "4": float(r.rain_lag4)},
        "rain_4w_mm": float(r.rain_sum_4w), "rain_8w_mm": float(r.rain_sum_8w),
        "rain_4w_normal_mm": round(4 * normal_week, 1),
        "recent_cases": [int(r.cases_lag3), int(r.cases_lag2), int(r.cases_lag1), int(r.cases_now)],
    }


def vulnerability(ward_id: str) -> dict:
    s = store()
    t, p = s.traits.loc[ward_id], s.traits_pct.loc[ward_id]
    return {k: {"value": float(t[k]), "percentile": round(float(p[k]), 2)} for k in t.index}


@app.get("/api/health")
def health():
    s = store()
    return {"status": "ok", "model_loaded": True, "dataset_rows": len(s.df),
            "last_data_week": s.last_data_day.isoformat(), "note": DATA_NOTE}


@app.get("/api/wards")
def wards(city: str | None = None):
    if city:
        need_city(city)
    s = store()
    return {"cities": s.cities, "wards": [w for w in s.wards if city is None or w["city"] == city]}


@app.get("/api/issue-weeks")
def issue_weeks():
    s = store()
    return {"issue_dates": [d.isoformat() for d in s.issue_dates], "latest": s.issue_dates[-1].isoformat(),
            "data_through": s.last_data_day.isoformat(), "note": DATA_NOTE,
            "out_of_sample_from_target": "2024-01-01"}


@app.get("/api/forecast")
def forecast(ward_id: str, issue_date: date, horizon_weeks: Horizon):
    need_ward(ward_id)
    need_week(issue_date)
    item = next(r for r in week_forecast(issue_date, horizon_weeks) if r["ward_id"] == ward_id)
    s = store()
    return {**item, "weather": weather_for(issue_date, ward_id), "vulnerability": vulnerability(ward_id),
            "tier_cutoffs": s.bundle["thresholds"], "model": s.bundle["selected"][horizon_weeks],
            "data_note": DATA_NOTE}


@app.get("/api/forecast/all")
def forecast_all(issue_date: date, horizon_weeks: Horizon, city: str | None = None):
    if city:
        need_city(city)
    need_week(issue_date)
    rows = [r for r in week_forecast(issue_date, horizon_weeks) if city is None or r["city"] == city]
    cities = [city] if city else store().cities
    return {"issue_date": issue_date.isoformat(), "horizon_weeks": horizon_weeks,
            "target_date": rows[0]["target_date"], "mode": rows[0]["mode"],
            "tier_cutoffs": store().bundle["thresholds"], "wards": rows,
            "cities": [city_total(issue_date, horizon_weeks, c) for c in cities], "data_note": DATA_NOTE}


@app.get("/api/priority")
def priority(issue_date: date, horizon_weeks: Horizon, city: str | None = None, limit: int = Query(10, ge=1, le=60)):
    data = forecast_all(issue_date, horizon_weeks, city)
    top = sorted(data["wards"], key=lambda r: (-r["predicted_cases"], r["ward_id"]))[:limit]
    return {"issue_date": data["issue_date"], "target_date": data["target_date"], "horizon_weeks": horizon_weeks,
            "mode": data["mode"], "wards": top}


@app.get("/api/compare")
def compare(issue_date: date, city: str | None = None, ward_id: str | None = None):
    """The three horizons side by side for one ward or for a whole city (sum of ward forecasts)."""
    need_week(issue_date)
    if ward_id:
        need_ward(ward_id)
        items = [next(r for r in week_forecast(issue_date, h) if r["ward_id"] == ward_id) for h in HORIZONS]
        return {"scope": "ward", "name": ward_id, "city": store().ward_city[ward_id], "items": items}
    if not city:
        raise ApiError(422, "INVALID_INPUT", "Provide city or ward_id.")
    need_city(city)
    return {"scope": "city", "name": city, "city": city, "items": [city_total(issue_date, h, city) for h in HORIZONS]}


@app.get("/api/history")
def history(issue_date: date, city: str | None = None, ward_id: str | None = None, weeks: int = Query(26, ge=4, le=104)):
    """Reported (observed) weekly cases and weather up to and including the issue week."""
    need_week(issue_date)
    s = store()
    d = s.df[s.df.date <= pd.Timestamp(issue_date)]
    if ward_id:
        need_ward(ward_id)
        d = d[d.ward_id == ward_id]
    elif city:
        need_city(city)
        d = d[d.city == city]
    g = d.groupby("date").agg(cases=("dengue_cases", "sum"), rain_mm=("rainfall_mm", "mean"),
                              avg_temp_c=("avg_temp_c", "mean"), humidity_pct=("relative_humidity_pct", "mean"))
    g = g.tail(weeks).round(2).reset_index()
    g["date"] = g.date.dt.strftime("%Y-%m-%d")
    return {"scope": "ward" if ward_id else "city" if city else "all", "weeks": g.to_dict("records")}


@app.get("/api/metrics")
def metrics():
    s = store()
    return {**s.metrics, "data": s.data_report, "feature_groups": {k: v for k, v in s.bundle["drivers"].items()},
            "note": DATA_NOTE, "selected_models": s.bundle["selected"]}


frontend_dist = ROOT.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="site")
