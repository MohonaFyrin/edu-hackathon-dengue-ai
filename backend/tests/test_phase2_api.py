"""Phase 2 endpoints: live scarcity controls, city-pool routing, simulator, dispatch and exports."""
import pytest
from fastapi.testclient import TestClient

import app as core

WEEK = "2025-08-04"      # monsoon week in the held-out test period
PEAK = "2024-08-12"      # week where default capacity forces routing and leaves unmet demand


@pytest.fixture(scope="module")
def client():
    with TestClient(core.app) as c:
        yield c


def plan(client, **kw):
    r = client.get("/api/plan", params={"issue_date": WEEK, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_full_stock_has_no_deficit(client):
    p = plan(client, stock_pct=100)
    for v in p["resources"].values():
        assert v["deficit"] == 0 and v["allocated"] == v["demand"]
    assert p["alerts"] == []


@pytest.mark.parametrize("pct", [30, 45, 70, 99])
def test_scarcity_never_over_allocates(client, pct):
    p = plan(client, stock_pct=pct)
    for res, v in p["resources"].items():
        assert v["allocated"] <= v["available_stock"]
        assert v["deficit"] == v["demand"] - v["allocated"]
        assert sum(w["allocated"][res] for w in p["wards"]) == v["allocated"]
        assert all(0 <= w["allocated"][res] <= w["demand"][res] for w in p["wards"])
    assert p["alerts"], "scarcity must raise deficit alerts"


def test_slider_changes_result_live(client):
    low, high = plan(client, stock_pct=30), plan(client, stock_pct=90)
    assert low["resources"]["saline_bags_needed"]["deficit"] > high["resources"]["saline_bags_needed"]["deficit"]


def test_per_resource_slider(client):
    p = plan(client, stock_pct=100, beds_pct=40)
    assert p["resources"]["saline_bags_needed"]["deficit"] == 0
    assert p["resources"]["hospital_beds_required"]["deficit"] > 0


def test_higher_tier_fulfilled_at_least_as_well(client):
    p = plan(client, stock_pct=40, floor_pct=0)
    order = {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}
    by_tier = {}
    for w in p["wards"]:
        if w["demand"]["saline_bags_needed"]:
            by_tier.setdefault(order[w["risk_tier"]], []).append(w["fulfilment"]["saline_bags_needed"])
    tiers = sorted(by_tier)
    for a, b in zip(tiers, tiers[1:]):
        assert min(by_tier[b]) >= max(by_tier[a]) - 1e-9


def test_crews_respect_budget_and_zero(client):
    p = plan(client, total_crews=7, max_crews_per_ward=2)
    assert p["crews"]["assigned"] <= 7 and all(w["crews"] <= 2 for w in p["wards"])
    z = plan(client, total_crews=0)
    assert z["crews"]["assigned"] == 0 and z["crews"]["cases_prevented_estimate"] == 0


def test_overflow_stays_inside_city_pool(client):
    r = client.get("/api/plan", params={"issue_date": PEAK}).json()
    city_of = {w["ward_id"]: w["city"] for w in r["wards"]}
    routed = 0
    for c in r["overflow"]["cities"]:
        for t in c["transfers"]:
            assert city_of[t["from_ward"]] == city_of[t["to_ward"]] == c["city"]
            routed += t["patients"]
        assert c["occupied_after"] <= c["capacity"]
        assert c["headroom_after"] >= 0
    assert routed > 0 and r["overflow"]["unmet_after"] > 0


def test_city_scope(client):
    p = plan(client, city="Gazipur")
    assert {w["city"] for w in p["wards"]} == {"Gazipur"} and len(p["wards"]) == 5


def test_invalid_inputs_are_rejected(client):
    r = client.get("/api/plan", params={"issue_date": WEEK, "stock_pct": 20})
    assert r.status_code == 422 and "stock_pct" in r.json()["error"]["fields"]
    assert client.get("/api/plan", params={"issue_date": "2030-01-01"}).status_code == 422
    assert client.get("/api/plan", params={"issue_date": WEEK, "city": "Paris"}).status_code == 404


def test_simulator_counterfactual_and_roi(client):
    s = client.get("/api/simulate", params={"issue_date": WEEK, "total_crews": 10}).json()
    assert [h["horizon_weeks"] for h in s["horizons"]] == [2, 3, 4]
    for h in s["horizons"]:
        assert 0 <= h["scenario_cases"] <= h["baseline_cases"]
        assert h["scenario_beds"] <= h["baseline_beds"] and h["scenario_saline"] <= h["baseline_saline"]
    rois = [r["roi_cases_per_crew"] for r in s["roi_ranking"]]
    assert rois == sorted(rois, reverse=True) and s["crews_used"] <= 10


def test_simulator_manual_deployment_and_limits(client):
    q = {"issue_date": WEEK, "total_crews": 3}
    s = client.get("/api/simulate", params={**q, "crews": "DNCC_Ward_01:2"}).json()
    assert s["deployment_source"] == "manual" and s["crews_used"] == 2
    assert client.get("/api/simulate", params={**q, "crews": "DNCC_Ward_01:4"}).json()["error"]["code"] == "CREW_LIMIT"
    assert client.get("/api/simulate", params={**q, "crews": "Nope:1"}).status_code == 404
    assert client.get("/api/simulate", params={**q, "crews": "bad"}).status_code == 422
    zero = client.get("/api/simulate", params={"issue_date": WEEK, "total_crews": 0}).json()
    assert zero["roi_cases_per_crew"] is None and zero["cases_prevented_2_4w"] == 0


def test_dispatch_templates(client):
    d = client.get("/api/dispatch", params={"issue_date": WEEK, "stock_pct": 40}).json()
    assert "Not sent" in d["delivery"] and len(d["messages"]) == 60
    for m in d["messages"]:
        assert m["sms_en_chars"] <= 160 and m["ward_id"] in m["sms_en"] and m["ward_id"] in m["whatsapp_en"]
    p = plan(client, stock_pct=40)
    w = next(x for x in p["wards"] if x["alert"])
    m = next(x for x in d["messages"] if x["ward_id"] == w["ward_id"])
    assert f"{w['allocated']['saline_bags_needed']}/{w['demand']['saline_bags_needed']}" in m["sms_en"]


def test_brief_and_exports(client):
    b = client.get("/api/brief", params={"issue_date": WEEK})
    assert b.status_code == 200 and "text/html" in b.headers["content-type"]
    for text in ("Supplies", "Hospital overflow", "Vector-control simulation", "assumptions", "window.print()"):
        assert text in b.text
    for kind in ("allocation", "overflow", "simulation", "dispatch"):
        r = client.get(f"/api/export/{kind}.csv", params={"issue_date": WEEK})
        assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
        assert len(r.text.splitlines()) > 1
    assert client.get("/api/export/secrets.csv", params={"issue_date": WEEK}).status_code == 422


def test_phase2_is_deterministic(client):
    assert plan(client, stock_pct=55, total_crews=9) == plan(client, stock_pct=55, total_crews=9)


def test_larvicide_supply_limits_crews(client):
    p = plan(client, total_crews=10, larvicide_pct=50)["crews"]
    assert p["deployable"] == 5 and p["grounded_by_larvicide"] == 5 and p["assigned"] <= 5
    assert p["deficit"] is True and len(p["high_risk_wards_without_crew"]) > 0
    r = client.get("/api/simulate", params={"issue_date": WEEK, "total_crews": 10, "larvicide_pct": 50,
                                            "crews": "DNCC_Ward_01:3,DNCC_Ward_02:3"})
    assert r.json()["error"]["code"] == "CREW_LIMIT"


def test_notices_carry_issue_and_target_dates(client):
    p = plan(client, stock_pct=30)
    m = client.get("/api/dispatch", params={"issue_date": WEEK, "stock_pct": 30}).json()["messages"]
    assert all(p["issue_date"] in x["sms_en"] and p["target_date"] in x["sms_en"] for x in m)
    assert all(p["issue_date"] in x["whatsapp_en"] for x in m)
