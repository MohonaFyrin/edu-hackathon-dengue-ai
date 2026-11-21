import sys
from pathlib import Path

import joblib
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import app, week_forecast  # noqa: E402
from common import FEATURES, MODEL_PATH, add_features, load_data, tier_of  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health").json()
    assert r["status"] == "ok" and r["model_loaded"] and r["dataset_rows"] == 31320


def test_wards_and_issue_weeks(client):
    w = client.get("/api/wards").json()
    assert len(w["wards"]) == 60 and len(w["cities"]) == 5
    assert len(client.get("/api/wards?city=Gazipur").json()["wards"]) == 5
    weeks = client.get("/api/issue-weeks").json()
    assert weeks["latest"] == "2025-12-29" and weeks["data_through"] == "2025-12-29"


@pytest.mark.parametrize("h", [2, 3, 4])
def test_forecast_matches_direct_model_inference(client, h):
    day, ward = "2025-07-07", "CCC_Ward_01"
    api = client.get("/api/forecast", params={"ward_id": ward, "issue_date": day, "horizon_weeks": h}).json()
    bundle = joblib.load(MODEL_PATH)
    f = add_features(load_data())
    row = f[(f.ward_id == ward) & (f.date == day)]
    direct = max(0.0, float(bundle["models"][h].predict(row[FEATURES])[0]))
    assert api["predicted_cases"] == pytest.approx(direct, abs=0.006)
    assert api["risk_tier"] == tier_of(api["predicted_cases"], bundle["thresholds"])
    assert api["target_date"] == str((row.date.iloc[0] + __import__("pandas").Timedelta(weeks=h)).date())
    assert api["lower_cases"] <= api["predicted_cases"] <= api["upper_cases"]
    assert set(api["weather"]["rain_by_lag_mm"]) == {"0", "1", "2", "3", "4"}


def test_horizons_give_different_dynamic_answers(client):
    vals = {h: client.get("/api/forecast", params={"ward_id": "DNCC_Ward_01", "issue_date": "2025-08-04",
                                                    "horizon_weeks": h}).json() for h in (2, 3, 4)}
    assert len({v["target_date"] for v in vals.values()}) == 3
    assert len({v["predicted_cases"] for v in vals.values()}) > 1


def test_risk_tiers_consistent_for_all_wards(client):
    d = client.get("/api/forecast/all", params={"issue_date": "2025-09-01", "horizon_weeks": 3}).json()
    cuts = d["tier_cutoffs"]
    assert len(d["wards"]) == 60
    for r in d["wards"]:
        assert r["risk_tier"] == tier_of(r["predicted_cases"], cuts)
    assert {r["risk_tier"] for r in d["wards"]} >= {"Medium", "High"}


def test_low_tier_reachable_in_dry_season(client):
    d = client.get("/api/forecast/all", params={"issue_date": "2025-02-03", "horizon_weeks": 2}).json()
    assert any(r["risk_tier"] == "Low" for r in d["wards"])


def test_priority_is_top_10_sorted(client):
    d = client.get("/api/priority", params={"issue_date": "2025-09-01", "horizon_weeks": 2}).json()
    cases = [r["predicted_cases"] for r in d["wards"]]
    assert len(cases) == 10 and cases == sorted(cases, reverse=True)


def test_compare_ward_and_city(client):
    w = client.get("/api/compare", params={"issue_date": "2025-09-01", "ward_id": "CCC_Ward_01"}).json()
    assert [i["horizon_weeks"] for i in w["items"]] == [2, 3, 4]
    c = client.get("/api/compare", params={"issue_date": "2025-09-01", "city": "Chattogram"}).json()
    assert c["scope"] == "city" and len(c["items"]) == 3
    assert all(i["risk_tier"] in ("Low", "Medium", "High", "Critical") for i in c["items"])


def test_history_is_observed_data_only(client):
    h = client.get("/api/history", params={"issue_date": "2025-06-02", "ward_id": "CCC_Ward_01", "weeks": 16}).json()
    assert len(h["weeks"]) == 16 and h["weeks"][-1]["date"] == "2025-06-02"


def test_metrics_endpoint(client):
    m = client.get("/api/metrics").json()
    for h in ("2", "3", "4"):
        x = m["horizons"][h]
        assert x["test"]["mae"] < x["baseline_last_week"]["mae"]
        assert x["test"]["rmse"] > 0


@pytest.mark.parametrize("url,status,code", [
    ("/api/forecast?ward_id=NOPE&issue_date=2025-07-07&horizon_weeks=2", 404, "UNKNOWN_WARD"),
    ("/api/forecast?ward_id=CCC_Ward_01&issue_date=2025-07-08&horizon_weeks=2", 422, "UNAVAILABLE_ISSUE_DATE"),
    ("/api/forecast?ward_id=CCC_Ward_01&issue_date=2025-07-07&horizon_weeks=5", 422, "INVALID_INPUT"),
    ("/api/forecast?ward_id=CCC_Ward_01&issue_date=not-a-date&horizon_weeks=2", 422, "INVALID_INPUT"),
    ("/api/wards?city=Atlantis", 404, "UNKNOWN_CITY"),
    ("/api/compare?issue_date=2025-07-07", 422, "INVALID_INPUT"),
])
def test_errors(client, url, status, code):
    r = client.get(url)
    assert r.status_code == status and r.json()["error"]["code"] == code


def test_forecasts_are_cached(client):
    week_forecast.cache_clear()
    client.get("/api/forecast/all", params={"issue_date": "2025-05-05", "horizon_weeks": 2})
    client.get("/api/forecast/all", params={"issue_date": "2025-05-05", "horizon_weeks": 2})
    client.get("/api/forecast", params={"ward_id": "CCC_Ward_01", "issue_date": "2025-05-05", "horizon_weeks": 2})
    info = week_forecast.cache_info()
    assert info.misses == 1 and info.hits >= 2
