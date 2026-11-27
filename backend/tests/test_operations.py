"""Phase 2 engine: invariants, optimality checks and the data-derived demand formula."""
import itertools

import numpy as np
import pandas as pd
import pytest
from scipy.optimize import linprog

import operations as op
from common import SUPPLY_COLUMNS, SUPPLY_CSV


@pytest.fixture(scope="module")
def supply():
    return pd.read_csv(SUPPLY_CSV)


def test_demand_ratios_reproduce_every_dataset_row(supply):
    got = op.demand_from_cases(supply.dengue_cases)
    for col in SUPPLY_COLUMNS:
        assert (got[col] == supply[col].to_numpy()).all(), col
    assert len(supply) == 31320


def test_round_half_up_rule():
    assert list(op.round_half_up([0.5, 1.5, 2.5, 2.4999999999, 0.0])) == [1, 2, 3, 3, 0]


def test_priority_risk_dominates_density():
    s = op.priority_scores(["Medium", "High", "Low", "Critical"], [1.0, 0.0, 1.0, 0.0])
    assert s[1] > s[0] and s[3] >= s[1] and s[0] > s[2]
    dense, sparse = op.priority_scores(["High", "High"], [0.9, 0.1])
    assert dense > sparse


RNG = np.random.default_rng(0)
CASES = [(RNG.integers(0, 40, 25), RNG.random(25) * 4 + 0.5, frac, floor)
         for frac in (0.3, 0.55, 0.8, 1.0, 1.3) for floor in (0.0, 0.25, 0.6)]


@pytest.mark.parametrize("demand,prio,frac,floor", CASES)
def test_allocation_constraints_and_lp_optimality(demand, prio, frac, floor):
    supply = int(frac * demand.sum())
    x = op.allocate(demand, prio, supply, floor)
    assert x.dtype.kind == "i"
    assert (x >= 0).all() and (x <= demand).all()
    assert x.sum() == min(supply, demand.sum())          # stock conserved, nothing wasted
    floors = np.floor(floor * demand + 1e-9)
    if floors.sum() <= supply:
        assert (x >= floors).all()
        # LP: max prio.x  s.t. sum x <= S, floors <= x <= demand
        lp = linprog(-prio, A_ub=[np.ones(len(demand))], b_ub=[supply],
                     bounds=list(zip(floors, demand)), method="highs")
        assert lp.status == 0
        assert prio @ x == pytest.approx(-lp.fun, rel=1e-9, abs=1e-6)


def test_allocation_is_deterministic_and_full_when_stock_suffices():
    d, p = np.array([5, 0, 7, 3]), np.array([2.0, 4.0, 2.0, 1.0])
    assert (op.allocate(d, p, 100) == d).all()
    assert (op.allocate(d, p, 9, 0.0) == op.allocate(d, p, 9, 0.0)).all()
    assert list(op.allocate(d, p, 9, 0.0)) == [5, 0, 4, 0]  # equal priority tie -> lower index first


def test_allocation_zero_stock_and_zero_demand():
    assert op.allocate(np.array([3, 4]), np.array([1.0, 2.0]), 0).sum() == 0
    assert op.allocate(np.array([0, 0]), np.array([1.0, 2.0]), 10).sum() == 0


def test_largest_remainder_exact_total():
    x = op.largest_remainder([3, 3, 3], 4, [1, 2, 3])
    assert x.sum() == 4 and list(x) == [1, 1, 2]


def test_crew_reduction_concave_capped():
    r = op.crew_reduction(np.arange(8), 0.2, 0.6)
    assert r[0] == 0 and r.max() <= 0.6
    gains = np.diff(r)
    assert (gains >= -1e-12).all() and (np.diff(gains) <= 1e-12).all()


def test_scenario_never_negative_or_above_baseline():
    base = np.array([0.0, 3.2, 10.0])
    for h in (2, 3, 4):
        s = op.scenario_cases(base, [0, 2, 10], h, 0.3, 0.9)
        assert (s >= 0).all() and (s <= base).all() and s[0] == 0
    assert (op.scenario_cases(base, [0, 0, 0], 4, 0.3, 0.9) == base).all()
    # later horizons show at least as much of the effect (onset)
    assert op.scenario_cases([10], [2], 2, 0.2, 0.9)[0] >= op.scenario_cases([10], [2], 4, 0.2, 0.9)[0]


def test_crew_assignment_matches_brute_force():
    base = np.array([12.0, 3.0, 7.5, 0.0])
    prio = np.ones(4)
    curves = op.response_curves(base, 3, 3, 0.15, 0.5)
    for total in range(0, 8):
        x = op.assign_crews(curves, total, 3, prio)
        assert x.sum() <= total and (x <= 3).all()
        prevented = lambda k: sum(curves[i, 0] - curves[i, k[i]] for i in range(4))
        best = max(prevented(k) for k in itertools.product(range(4), repeat=4) if sum(k) <= total)
        assert prevented(x) == pytest.approx(best)
        assert x[3] == 0  # never sends a crew where there is nothing to prevent
    assert op.assign_crews(curves, 0, 3, prio).sum() == 0


def test_overflow_conservation_and_same_pool():
    ids = ["A", "B", "C", "D"]
    res = op.route_city(ids, demand=[9, 2, 1, 6], capacity=[4, 4, 3, 6])
    w = {x["ward_id"]: x for x in res["wards"]}
    out = sum(x["transferred_out"] for x in res["wards"])
    inn = sum(x["transferred_in"] for x in res["wards"])
    assert out == inn == sum(t["patients"] for t in res["transfers"]) == 4  # headroom 2 + 2
    assert res["unmet_after"] == 1                                         # excess 5 - headroom 4
    for x in res["wards"]:
        treated_here = min(x["bed_demand"], x["capacity"]) + x["transferred_in"]
        assert treated_here <= x["capacity"]                               # no bed counted twice
    assert all(t["from_ward"] != t["to_ward"] for t in res["transfers"])
    assert {t["to_ward"] for t in res["transfers"]} <= set(ids)
    assert w["D"]["transferred_in"] == 0                                    # full ward receives nothing
    assert res["headroom_after"] == 0 and res["occupied_after"] == res["capacity"]


def test_overflow_no_capacity_and_no_excess():
    res = op.route_city(["A", "B"], [3, 0], [0, 0])
    assert res["unmet_after"] == 3 and res["transfers"] == [] and res["wards"][0]["utilisation_before"] is None
    res = op.route_city(["A", "B"], [1, 1], [2, 2])
    assert res["transfers"] == [] and res["headroom_after"] == 2
