"""Phase 2 API: allocation plan, overflow routing, vector-control simulator, dispatch and exports.

Every endpoint is a deterministic GET over the same inputs, so the screen, the printable brief,
the SMS/WhatsApp text and the CSV export are generated from one computation (`compute_plan`).
"""
from __future__ import annotations

import csv
import html
import io
from datetime import date
from functools import lru_cache
from typing import Annotated, Literal

import numpy as np
from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

import app as core
import operations as op

router = APIRouter(prefix="/api")

ASSUMPTIONS = [
    "Forecasts are retrospective replays of the supplied dataset (ends 2025-12-29), not live surveillance.",
    "Supply demand = forecast cases x per-case ratios recovered exactly from the onsite dataset "
    "(saline 2.385, kits 1.164, beds 0.298, rounded half-up; reproduces all 31,320 rows).",
    "Available stock = slider % x total demand in scope (the dataset contains no stock levels).",
    "Bed capacity is not in the dataset: default = each ward's 90th-percentile weekly bed requirement "
    "in 2016-2022, times the capacity scale. Replace with real hospital capacity before operational use.",
    "Spraying effect is an explicit planning assumption (no verified efficacy figure in the data): "
    "reduction = 1-(1-p)^crews, capped, applied to the ML baseline with onset 50% / 85% / 100% at 2 / 3 / 4 weeks.",
    "Larvicide/fogging supply is not in the dataset: one supply set per crew is assumed, so deployable crews = "
    "floor(total crews x larvicide supply %). Crew need is taken as at least one crew per High or Critical ward.",
    "Overflow routing has no travel distances or hospital identities (not in the data); transfers are ward-to-ward "
    "planning recommendations within one city pool, not clinical transfer orders.",
]
ONSET_NOTE = ("Onset reflects published timing: Aedes egg-to-adult 7-10 days (CDC), extrinsic incubation 8-12 days "
              "and symptom onset 4-10 days after infection (WHO), so averted infections appear in reported cases "
              "about 2-4 weeks after deployment.")
LABELS = {"saline_bags_needed": "Saline bags", "diagnostic_kits_needed": "Diagnostic kits",
          "hospital_beds_required": "Hospital beds"}
LABELS_BN = {"saline_bags_needed": "স্যালাইন", "diagnostic_kits_needed": "টেস্ট কিট",
             "hospital_beds_required": "হাসপাতাল বেড"}
TIER_BN = {"Low": "নিম্ন", "Medium": "মাঝারি", "High": "উচ্চ", "Critical": "অতি উচ্চ"}
BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


class PlanQuery(BaseModel):
    issue_date: date
    horizon_weeks: int = Field(2, ge=2, le=4)
    city: str | None = None
    stock_pct: float = Field(60, ge=30, le=100, description="Available regional stock, % of demand")
    saline_pct: float | None = Field(None, ge=30, le=100)
    kits_pct: float | None = Field(None, ge=30, le=100)
    beds_pct: float | None = Field(None, ge=30, le=100)
    total_crews: int = Field(12, ge=0, le=200)
    larvicide_pct: float = Field(100, ge=30, le=100, description="Larvicide/fogging supply, % of what all crews need")
    max_crews_per_ward: int = Field(3, ge=1, le=10)
    floor_pct: float = Field(25, ge=0, le=100, description="Minimum share of demand every ward receives first")
    capacity_scale: float = Field(1.0, ge=0.25, le=4.0)
    efficacy_per_crew: float = Field(0.10, ge=0.0, le=0.6, description="Assumed transmission reduction per crew")
    efficacy_cap: float = Field(0.5, ge=0.0, le=0.9)


def plan_query(
    issue_date: date, horizon_weeks: Annotated[int, Query(ge=2, le=4)] = 2, city: str | None = None,
    stock_pct: Annotated[float, Query(ge=30, le=100)] = 60, saline_pct: Annotated[float | None, Query(ge=30, le=100)] = None,
    kits_pct: Annotated[float | None, Query(ge=30, le=100)] = None, beds_pct: Annotated[float | None, Query(ge=30, le=100)] = None,
    total_crews: Annotated[int, Query(ge=0, le=200)] = 12, larvicide_pct: Annotated[float, Query(ge=30, le=100)] = 100,
    max_crews_per_ward: Annotated[int, Query(ge=1, le=10)] = 3,
    floor_pct: Annotated[float, Query(ge=0, le=100)] = 25, capacity_scale: Annotated[float, Query(ge=0.25, le=4.0)] = 1.0,
    efficacy_per_crew: Annotated[float, Query(ge=0.0, le=0.6)] = 0.10, efficacy_cap: Annotated[float, Query(ge=0.0, le=0.9)] = 0.5,
) -> PlanQuery:
    q = PlanQuery(**{k: v for k, v in locals().items()})
    if q.city:
        core.need_city(q.city)
    core.need_week(q.issue_date)
    return q


def deployable_crews(q: PlanQuery) -> int:
    """Crews that can be equipped: floor(total crews x larvicide supply %). One supply set per crew (assumption)."""
    return int(np.floor(q.total_crews * q.larvicide_pct / 100 + 1e-9))


def _pct(q: PlanQuery, res: str) -> float:
    return {"saline_bags_needed": q.saline_pct, "diagnostic_kits_needed": q.kits_pct,
            "hospital_beds_required": q.beds_pct}[res] or q.stock_pct


def _scope_rows(q: PlanQuery, h: int) -> list[dict]:
    return [r for r in core.week_forecast(q.issue_date, h) if q.city is None or r["city"] == q.city]


@lru_cache(maxsize=128)
def _plan_cached(key: str) -> dict:
    return _compute(PlanQuery.model_validate_json(key))


def compute_plan(q: PlanQuery) -> dict:
    return _plan_cached(q.model_dump_json())


def _compute(q: PlanQuery) -> dict:
    s = core.store()
    h = q.horizon_weeks
    rows = _scope_rows(q, h)
    ids = [r["ward_id"] for r in rows]
    cases = np.array([r["predicted_cases"] for r in rows])
    tiers = [r["risk_tier"] for r in rows]
    density = s.traits.loc[ids, "population_density_sqkm"].to_numpy()
    density_pct = s.traits_pct.loc[ids, "population_density_sqkm"].to_numpy()
    prio = op.priority_scores(tiers, density_pct)
    demand = op.demand_from_cases(cases)

    resources = {}
    alloc = {}
    for res in op.RESOURCES:
        d = demand[res]
        stock = int(op.round_half_up(_pct(q, res) / 100 * d.sum()))
        x = op.allocate(d, prio, stock, q.floor_pct / 100)
        alloc[res] = x
        short = d - x
        resources[res] = {"label": LABELS[res], "stock_pct": _pct(q, res), "demand": int(d.sum()),
                          "available_stock": stock, "allocated": int(x.sum()), "deficit": int(short.sum()),
                          "unused_stock": int(stock - x.sum()),
                          "wards_in_deficit": int((short > 0).sum())}

    curves = op.response_curves(cases, h, q.max_crews_per_ward, q.efficacy_per_crew, q.efficacy_cap)
    # Larvicide/fogging supply limits how many of the available crews can actually be equipped.
    deployable = deployable_crews(q)
    crews = op.assign_crews(curves, deployable, q.max_crews_per_ward, prio)
    high = np.array([t in ("High", "Critical") for t in tiers])
    uncovered = [ids[i] for i in range(len(ids)) if high[i] and crews[i] == 0]
    prevented = curves[np.arange(len(ids)), 0] - curves[np.arange(len(ids)), crews]

    wards = []
    for i, r in enumerate(rows):
        dem = {res: int(demand[res][i]) for res in op.RESOURCES}
        got = {res: int(alloc[res][i]) for res in op.RESOURCES}
        fulfil = {res: (1.0 if dem[res] == 0 else round(got[res] / dem[res], 3)) for res in op.RESOURCES}
        worst = min(fulfil.values())
        alert = None
        if worst < 1.0:
            alert = "critical" if (worst < 0.5 or r["risk_tier"] in ("High", "Critical")) else "warning"
        wards.append({
            "ward_id": r["ward_id"], "city": r["city"], "predicted_cases": r["predicted_cases"],
            "lower_cases": r["lower_cases"], "upper_cases": r["upper_cases"], "risk_tier": r["risk_tier"],
            "population_density_sqkm": int(density[i]), "density_percentile": round(float(density_pct[i]), 2),
            "priority_score": round(float(prio[i]), 3), "demand": dem, "allocated": got,
            "deficit": {res: dem[res] - got[res] for res in op.RESOURCES}, "fulfilment": fulfil,
            "alert": alert, "crews": int(crews[i]), "cases_prevented_estimate": round(float(prevented[i]), 2),
        })
    order = sorted(range(len(wards)), key=lambda i: (-prio[i], -cases[i], ids[i]))
    wards = [dict(wards[i], priority_rank=k + 1) for k, i in enumerate(order)]

    overflow = _overflow(q, ids, [r["city"] for r in rows], demand["hospital_beds_required"])
    first = rows[0]
    return {
        "inputs": q.model_dump(mode="json"), "issue_date": q.issue_date.isoformat(),
        "target_date": first["target_date"], "horizon_weeks": h, "mode": first["mode"],
        "scope": q.city or "All cities",
        "resources": resources, "wards": wards,
        "alerts": [w for w in wards if w["alert"]],
        "crews": {"total_available": q.total_crews, "larvicide_pct": q.larvicide_pct, "deployable": deployable,
                  "grounded_by_larvicide": q.total_crews - deployable,
                  "high_risk_wards": int(high.sum()), "high_risk_wards_without_crew": uncovered,
                  "deficit": len(uncovered) > 0, "assigned": int(crews.sum()),
                  "wards_covered": int((crews > 0).sum()),
                  "cases_prevented_estimate": round(float(prevented.sum()), 2)},
        "overflow": overflow,
        "methods": {
            "allocation": "Fairness floor, then priority greedy; exact optimum of max sum(priority x units) "
                          "subject to stock, demand caps and floors (verified against an LP solver in tests).",
            "priority": "risk-tier weight (Low 1, Medium 2, High 3, Critical 4) x (0.75 + 0.25 x density percentile): "
                        "risk tier first, density orders wards within a tier",
            "crews": "Greedy by marginal cases prevented; exact optimum because each ward's response is concave.",
            "overflow": "Intra-city water-filling to the lowest post-transfer utilisation; no bed counted twice.",
        },
        "assumptions": ASSUMPTIONS, "onset_note": ONSET_NOTE, "data_note": core.DATA_NOTE,
    }


def _overflow(q: PlanQuery, ids, cities, bed_demand) -> dict:
    s = core.store()
    cap = op.round_half_up(np.array([s.default_capacity[w] for w in ids]) * q.capacity_scale)
    out = []
    for city in sorted(set(cities)):
        idx = [i for i, c in enumerate(cities) if c == city]
        res = op.route_city([ids[i] for i in idx], bed_demand[idx], cap[idx])
        out.append({"city": city, **res})
    return {"cities": out, "transfers": sum(len(c["transfers"]) for c in out),
            "patients_routed": sum(t["patients"] for c in out for t in c["transfers"]),
            "unmet_after": sum(c["unmet_after"] for c in out),
            "capacity_note": ASSUMPTIONS[3]}


@router.get("/plan")
def plan(q: PlanQuery = Depends(plan_query)):
    return compute_plan(q)


def _parse_crews(text: str | None, valid: set[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    if not text:
        return out
    for part in text.split(","):
        if not part.strip():
            continue
        try:
            ward, n = part.split(":")
            n = int(n)
        except ValueError:
            raise core.ApiError(422, "INVALID_INPUT", "crews must look like DNCC_Ward_01:2,CCC_Ward_03:1")
        if ward not in valid:
            raise core.ApiError(404, "UNKNOWN_WARD", f"Unknown ward_id {ward}.")
        if not 0 <= n <= 10:
            raise core.ApiError(422, "INVALID_INPUT", "Crews per ward must be 0-10.")
        out[ward] = out.get(ward, 0) + n
    return out


@router.get("/simulate")
def simulate(q: PlanQuery = Depends(plan_query), crews: str | None = Query(None, max_length=2000,
             description="Manual deployment, e.g. DNCC_Ward_01:2,CCC_Ward_03:1. Omit to use the optimised plan.")):
    """Counterfactual for target weeks 2, 3 and 4: ML baseline vs the same forecast with crews deployed."""
    rows2 = _scope_rows(q, 2)
    ids = [r["ward_id"] for r in rows2]
    manual = _parse_crews(crews, set(ids))
    if manual:
        if sum(manual.values()) > deployable_crews(q):
            raise core.ApiError(422, "CREW_LIMIT", f"{sum(manual.values())} crews requested but only "
                                                   f"{deployable_crews(q)} can be deployed.")
        k = np.array([manual.get(w, 0) for w in ids])
        source = "manual"
    else:
        plan_wards = {w["ward_id"]: w["crews"] for w in compute_plan(q)["wards"]}
        k = np.array([plan_wards[w] for w in ids])
        source = "optimised plan"
    horizons, per_ward = [], {w: {"ward_id": w, "crews": int(k[i]), "by_horizon": {}} for i, w in enumerate(ids)}
    total_prev = np.zeros(len(ids))
    for h in core.HORIZONS:
        rows = _scope_rows(q, h)
        base = np.array([r["predicted_cases"] for r in rows])
        scen = op.scenario_cases(base, k, h, q.efficacy_per_crew, q.efficacy_cap)
        prev = base - scen
        total_prev += prev
        db, ds = op.demand_from_cases(base), op.demand_from_cases(scen)
        for i, w in enumerate(ids):
            per_ward[w]["by_horizon"][str(h)] = {
                "target_date": rows[i]["target_date"], "baseline_cases": round(float(base[i]), 2),
                "scenario_cases": round(float(scen[i]), 2), "cases_prevented": round(float(prev[i]), 2),
                "beds_saved": int(db["hospital_beds_required"][i] - ds["hospital_beds_required"][i]),
                "saline_saved": int(db["saline_bags_needed"][i] - ds["saline_bags_needed"][i])}
        horizons.append({
            "horizon_weeks": h, "target_date": rows[0]["target_date"],
            "baseline_cases": round(float(base.sum()), 1), "scenario_cases": round(float(scen.sum()), 1),
            "cases_prevented": round(float(prev.sum()), 2),
            "baseline_beds": int(db["hospital_beds_required"].sum()), "scenario_beds": int(ds["hospital_beds_required"].sum()),
            "baseline_saline": int(db["saline_bags_needed"].sum()), "scenario_saline": int(ds["saline_bags_needed"].sum()),
            "baseline_kits": int(db["diagnostic_kits_needed"].sum()), "scenario_kits": int(ds["diagnostic_kits_needed"].sum()),
        })
    ranking = []
    for i, w in enumerate(ids):
        item = per_ward[w]
        item["cases_prevented_2_4w"] = round(float(total_prev[i]), 2)
        item["roi_cases_per_crew"] = None if k[i] == 0 else round(float(total_prev[i] / k[i]), 3)
        # Marginal value of one more crew here (weeks 2-4), for "where should the next crew go?"
        nxt = sum(float(np.asarray(op.scenario_cases([r["predicted_cases"]], [k[i]], h, q.efficacy_per_crew, q.efficacy_cap))[0]
                        - np.asarray(op.scenario_cases([r["predicted_cases"]], [k[i] + 1], h, q.efficacy_per_crew, q.efficacy_cap))[0])
                  for h in core.HORIZONS for r in [_scope_rows(q, h)[i]])
        item["next_crew_cases_prevented"] = round(nxt, 3)
        item["city"] = rows2[i]["city"]
        item["risk_tier"] = rows2[i]["risk_tier"]
        ranking.append(item)
    deployed = sorted([r for r in ranking if r["crews"] > 0], key=lambda r: (-r["roi_cases_per_crew"], r["ward_id"]))
    candidates = sorted(ranking, key=lambda r: (-r["next_crew_cases_prevented"], r["ward_id"]))[:10]
    used = int(k.sum())
    return {
        "issue_date": q.issue_date.isoformat(), "scope": q.city or "All cities", "deployment_source": source,
        "crews_used": used, "crews_available": deployable_crews(q), "horizons": horizons,
        "cases_prevented_2_4w": round(float(total_prev.sum()), 2),
        "roi_cases_per_crew": None if used == 0 else round(float(total_prev.sum() / used), 3),
        "roi_ranking": deployed, "next_crew_candidates": candidates,
        "parameters": {"efficacy_per_crew": q.efficacy_per_crew, "efficacy_cap": q.efficacy_cap, "onset": op.ONSET},
        "assumptions": ASSUMPTIONS[4:5] + [ONSET_NOTE, "Totals are for target weeks 2, 3 and 4 after the issue week; "
                                           "week 1 is not forecast by the model."],
    }


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
def _bn(x) -> str:
    return str(x).translate(BN_DIGITS)


def sms_en(p: dict, w: dict) -> str:
    a, d = w["allocated"], w["demand"]
    deficit = [f"{k} -{d[r] - a[r]}" for r, k in (("saline_bags_needed", "SAL"), ("diagnostic_kits_needed", "KIT"),
                                                  ("hospital_beds_required", "BED")) if d[r] > a[r]]
    txt = (f"DengueEW {w['ward_id']} issued {p['issue_date']} for wk {p['target_date']}: {w['predicted_cases']:.0f} cases ({w['risk_tier']}). "
           f"Saline {a['saline_bags_needed']}/{d['saline_bags_needed']} Kits {a['diagnostic_kits_needed']}/"
           f"{d['diagnostic_kits_needed']} Beds {a['hospital_beds_required']}/{d['hospital_beds_required']}. "
           f"Crews {w['crews']}." + (f" DEFICIT {' '.join(deficit)}" if deficit else " Fully supplied"))
    assert len(txt) <= 160, len(txt)  # worst case measured at 152 characters (tests cover 30% stock)
    return txt


def sms_bn(p: dict, w: dict) -> str:
    a, d = w["allocated"], w["demand"]
    short = sum(d[r] - a[r] for r in op.RESOURCES)
    return (f"DengueEW {w['ward_id']}: {_bn(p['target_date'])} সপ্তাহে {_bn(round(w['predicted_cases']))} রোগী "
            f"({TIER_BN[w['risk_tier']]})। স্যালাইন {_bn(a['saline_bags_needed'])}/{_bn(d['saline_bags_needed'])}, "
            f"কিট {_bn(a['diagnostic_kits_needed'])}/{_bn(d['diagnostic_kits_needed'])}, বেড "
            f"{_bn(a['hospital_beds_required'])}/{_bn(d['hospital_beds_required'])}। দল {_bn(w['crews'])}।"
            + (" ঘাটতি আছে।" if short else ""))


def whatsapp_en(p: dict, w: dict) -> str:
    lines = [f"*Dengue Early Warning dispatch — {w['ward_id']} ({w['city']})*",
             f"Issued {p['issue_date']}. Forecast for week of {p['target_date']} ({p['horizon_weeks']}-week horizon): "
             f"*{w['predicted_cases']:.1f} cases* (80% range {w['lower_cases']:.1f}–{w['upper_cases']:.1f}), risk *{w['risk_tier']}*",
             "", "*Supplies (allocated / required)*"]
    for r in op.RESOURCES:
        gap = w["demand"][r] - w["allocated"][r]
        lines.append(f"• {LABELS[r]}: {w['allocated'][r]} / {w['demand'][r]}" + (f"  ⚠ short {gap}" if gap else ""))
    lines += ["", f"*Spraying teams assigned:* {w['crews']}"
              + (f" (est. {w['cases_prevented_estimate']:.1f} cases prevented, planning assumption)" if w["crews"] else ""),
              f"Priority rank {w['priority_rank']} of {len(p['wards'])}.",
              "_Retrospective replay of the supplied dataset; planning guidance, not a clinical order._"]
    return "\n".join(lines)


def whatsapp_bn(p: dict, w: dict) -> str:
    lines = [f"*ডেঙ্গু আগাম সতর্কতা নির্দেশনা — {w['ward_id']} ({w['city']})*",
             f"প্রকাশ {_bn(p['issue_date'])}। {_bn(p['target_date'])} সপ্তাহের পূর্বাভাস: *{_bn(round(w['predicted_cases'], 1))} জন রোগী*, ঝুঁকি *{TIER_BN[w['risk_tier']]}*",
             "", "*সরবরাহ (বরাদ্দ / প্রয়োজন)*"]
    for r in op.RESOURCES:
        gap = w["demand"][r] - w["allocated"][r]
        lines.append(f"• {LABELS_BN[r]}: {_bn(w['allocated'][r])} / {_bn(w['demand'][r])}" + (f"  ⚠ ঘাটতি {_bn(gap)}" if gap else ""))
    lines += ["", f"*মশা নিধন দল:* {_bn(w['crews'])}",
              "_পুরোনো তথ্যের পুনর্বিশ্লেষণ; পরিকল্পনার নির্দেশনা, চিকিৎসা আদেশ নয়।_"]
    return "\n".join(lines)


def _messages(p: dict, ward_ids: list[str] | None) -> list[dict]:
    pick = [w for w in sorted(p["wards"], key=lambda w: w["priority_rank"])
            if (ward_ids is None or w["ward_id"] in ward_ids)]
    out = []
    for w in pick:
        e, b = sms_en(p, w), sms_bn(p, w)
        out.append({"ward_id": w["ward_id"], "city": w["city"], "risk_tier": w["risk_tier"], "alert": w["alert"],
                    "sms_en": e, "sms_en_chars": len(e), "sms_bn": b, "sms_bn_chars": len(b),
                    "sms_bn_segments": 1 if len(b) <= 70 else -(-len(b) // 67),
                    "whatsapp_en": whatsapp_en(p, w), "whatsapp_bn": whatsapp_bn(p, w)})
    return out


@router.get("/dispatch")
def dispatch(q: PlanQuery = Depends(plan_query), ward_id: str | None = None,
             only_alerts: bool = False):
    p = compute_plan(q)
    ids = None
    if ward_id:
        core.need_ward(ward_id)
        ids = [ward_id]
    elif only_alerts:
        ids = [w["ward_id"] for w in p["alerts"]]
    return {"issue_date": p["issue_date"], "target_date": p["target_date"], "scope": p["scope"],
            "delivery": "Not sent. Templates only — copy into an approved SMS/WhatsApp gateway.",
            "messages": _messages(p, ids)}


# ---------------------------------------------------------------------------
# Printable commissioner brief + CSV exports
# ---------------------------------------------------------------------------
def _pct_text(x) -> str:
    return "n/a" if x is None else f"{x * 100:.0f}%"


def brief_html(p: dict, sim: dict) -> str:
    e = html.escape
    res_rows = "".join(
        f"<tr><td>{e(v['label'])}</td><td>{v['stock_pct']:.0f}%</td><td>{v['demand']}</td><td>{v['available_stock']}</td>"
        f"<td>{v['allocated']}</td><td class='{'bad' if v['deficit'] else ''}'>{v['deficit']}</td><td>{v['wards_in_deficit']}</td></tr>"
        for v in p["resources"].values())
    ward_rows = "".join(
        f"<tr><td>{w['priority_rank']}</td><td>{e(w['ward_id'])}</td><td>{e(w['city'])}</td><td>{w['risk_tier']}</td>"
        f"<td>{w['predicted_cases']:.1f}</td>"
        + "".join(f"<td class='{'bad' if w['deficit'][r] else ''}'>{w['allocated'][r]}/{w['demand'][r]}</td>" for r in op.RESOURCES)
        + f"<td>{w['crews']}</td><td>{'⚠ ' + w['alert'] if w['alert'] else ''}</td></tr>"
        for w in sorted(p["wards"], key=lambda w: w["priority_rank"]))
    city_rows = "".join(
        f"<tr><td>{e(c['city'])}</td><td>{c['capacity']}</td><td>{c['bed_demand']}</td>"
        f"<td>{_pct_text(c['utilisation_before'])}</td><td>{_pct_text(c['utilisation_after'])}</td>"
        f"<td>{sum(t['patients'] for t in c['transfers'])}</td><td>{c['headroom_after']}</td>"
        f"<td class='{'bad' if c['unmet_after'] else ''}'>{c['unmet_after']}</td></tr>"
        for c in p["overflow"]["cities"])
    transfers = "".join(
        f"<li>{e(t['from_ward'])} → {e(t['to_ward'])}: {t['patients']} patient(s) ({e(c['city'])})</li>"
        for c in p["overflow"]["cities"] for t in c["transfers"]) or "<li>No transfers needed.</li>"
    sim_rows = "".join(
        f"<tr><td>{hz['horizon_weeks']} weeks</td><td>{hz['target_date']}</td><td>{hz['baseline_cases']}</td>"
        f"<td>{hz['scenario_cases']}</td><td>{hz['cases_prevented']}</td><td>{hz['baseline_beds']} → {hz['scenario_beds']}</td>"
        f"<td>{hz['baseline_saline']} → {hz['scenario_saline']}</td></tr>" for hz in sim["horizons"])
    roi_rows = "".join(
        f"<tr><td>{e(r['ward_id'])}</td><td>{r['crews']}</td><td>{r['cases_prevented_2_4w']}</td><td>{r['roi_cases_per_crew']}</td></tr>"
        for r in sim["roi_ranking"]) or "<tr><td colspan=4>No crews deployed.</td></tr>"
    assumptions = "".join(f"<li>{e(a)}</li>" for a in p["assumptions"] + [p["onset_note"]])
    q = p["inputs"]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Commissioner brief — {e(p['scope'])} — {p['target_date']}</title>
<style>
body{{font:14px/1.45 "Noto Sans","Segoe UI",system-ui,sans-serif;color:#17212b;margin:24px auto;max-width:1000px;padding:0 16px}}
h1{{font-size:22px;margin:0 0 4px}} h2{{font-size:16px;margin:24px 0 6px;border-bottom:2px solid #17212b;padding-bottom:3px}}
table{{border-collapse:collapse;width:100%;font-size:12.5px}} th,td{{border:1px solid #c9d1d9;padding:4px 6px;text-align:left}}
th{{background:#eef2f5}} .bad{{background:#fde8e4;font-weight:600}} .meta{{color:#4a5560}}
.note{{background:#fff8e1;border-left:4px solid #b7791f;padding:8px 12px;margin:12px 0}}
.toolbar{{margin:12px 0}} button{{font:inherit;padding:8px 14px}}
@media print{{.toolbar{{display:none}} body{{margin:0}} h2{{break-after:avoid}} tr{{break-inside:avoid}}}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print or save as PDF</button></div>
<h1>Dengue operations brief — {e(p['scope'])}</h1>
<p class="meta">Issue week {p['issue_date']} · forecast for week of {p['target_date']} ({p['horizon_weeks']}-week horizon) ·
stock {q['stock_pct']:.0f}% · {q['total_crews']} spraying crews · capacity scale {q['capacity_scale']}</p>
<p class="note">{e(p['data_note'])} Planning recommendations only — not clinical transfer orders.</p>
<h2>Supplies</h2><table><tr><th>Resource</th><th>Stock %</th><th>Required</th><th>Available</th><th>Allocated</th><th>Deficit</th><th>Wards short</th></tr>{res_rows}</table>
<h2>Critical supply alerts: {len(p['alerts'])} ward(s)</h2>
<h2>Ward allocation (priority order)</h2><table><tr><th>#</th><th>Ward</th><th>City</th><th>Risk</th><th>Cases</th>
<th>Saline</th><th>Kits</th><th>Beds</th><th>Crews</th><th>Alert</th></tr>{ward_rows}</table>
<h2>Hospital overflow (within each city)</h2><table><tr><th>City</th><th>Beds (assumed)</th><th>Bed demand</th>
<th>Util. before</th><th>Util. after</th><th>Routed</th><th>Headroom left</th><th>Unmet</th></tr>{city_rows}</table>
<ul>{transfers}</ul>
<h2>Vector-control simulation ({sim['crews_used']} crews, {sim['deployment_source']})</h2>
<table><tr><th>Horizon</th><th>Target week</th><th>Baseline cases</th><th>With crews</th><th>Prevented</th><th>Beds</th><th>Saline</th></tr>{sim_rows}</table>
<p>Total cases prevented, weeks 2–4: <b>{sim['cases_prevented_2_4w']}</b>; ROI {sim['roi_cases_per_crew']} cases per crew.</p>
<table><tr><th>Ward</th><th>Crews</th><th>Cases prevented (wk 2–4)</th><th>Cases per crew</th></tr>{roi_rows}</table>
<h2>Method and assumptions</h2><ul>{assumptions}</ul>
<p class="meta">Generated locally by Dengue Early Warning (no internet or AI service used).</p>
</body></html>"""


@router.get("/brief", response_class=HTMLResponse)
def brief(q: PlanQuery = Depends(plan_query)):
    return HTMLResponse(brief_html(compute_plan(q), simulate(q, None)))


def _csv(rows: list[list], header: list[str], name: str) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/export/{kind}.csv")
def export(kind: Literal["allocation", "overflow", "simulation", "dispatch"], q: PlanQuery = Depends(plan_query)):
    p = compute_plan(q)
    tag = f"{p['issue_date']}_h{p['horizon_weeks']}"
    if kind == "allocation":
        hdr = ["priority_rank", "ward_id", "city", "risk_tier", "predicted_cases", "population_density_sqkm"] + \
              [f"{r}_{x}" for r in op.RESOURCES for x in ("required", "allocated", "deficit")] + ["crews", "alert"]
        rows = [[w["priority_rank"], w["ward_id"], w["city"], w["risk_tier"], w["predicted_cases"], w["population_density_sqkm"]]
                + [v for r in op.RESOURCES for v in (w["demand"][r], w["allocated"][r], w["deficit"][r])]
                + [w["crews"], w["alert"] or ""] for w in sorted(p["wards"], key=lambda w: w["priority_rank"])]
    elif kind == "overflow":
        hdr = ["city", "ward_id", "bed_demand", "capacity", "local_deficit", "transferred_out", "transferred_in",
               "unmet_after_routing", "utilisation_before", "utilisation_after"]
        rows = [[c["city"]] + [w[k] for k in hdr[1:]] for c in p["overflow"]["cities"] for w in c["wards"]]
    elif kind == "simulation":
        sim = simulate(q, None)
        hdr = ["ward_id", "city", "crews", "horizon_weeks", "target_date", "baseline_cases", "scenario_cases",
               "cases_prevented", "beds_saved", "saline_saved", "roi_cases_per_crew_2_4w"]
        rows = [[r["ward_id"], r["city"], r["crews"], h, v["target_date"], v["baseline_cases"], v["scenario_cases"],
                 v["cases_prevented"], v["beds_saved"], v["saline_saved"], r["roi_cases_per_crew"]]
                for r in sim["roi_ranking"] for h, v in r["by_horizon"].items()]
    else:
        hdr = ["ward_id", "city", "risk_tier", "alert", "sms_en", "sms_bn", "whatsapp_en", "whatsapp_bn"]
        rows = [[m[k] or "" for k in hdr] for m in _messages(p, None)]
    return _csv(rows, hdr, f"warddesk_{kind}_{tag}.csv")
