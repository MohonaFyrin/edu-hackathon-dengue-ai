"""Phase 2 operations engine: demand, constrained allocation, crew assignment,
intra-city hospital overflow routing and the vector-control counterfactual simulator.

All functions are pure and deterministic (same inputs -> same outputs); the API layer
only gathers inputs from the loaded model/data and serialises results.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Demand: per-case ratios recovered from the onsite dataset.
# Every one of the 31,320 rows satisfies  column == round_half_up(cases * ratio).
# Identifiable intervals (all ratios inside reproduce 100% of rows):
#   saline 2.3834-2.3863, kits 1.1618-1.1666, beds 0.2970-0.2995. We use mid-points.
# tests/test_operations.py re-verifies this against data/supply.csv.
# ---------------------------------------------------------------------------
RATIOS = {"saline_bags_needed": 2.385, "diagnostic_kits_needed": 1.164, "hospital_beds_required": 0.298}
RESOURCES = list(RATIOS)
TIER_WEIGHT = {"Low": 1.0, "Medium": 2.0, "High": 3.0, "Critical": 4.0}


def round_half_up(x) -> np.ndarray:
    """Round half up (the dataset's rule); the inner round removes float noise like 2.4999999."""
    return np.floor(np.round(np.asarray(x, dtype=float), 9) + 0.5).astype(int)


def demand_from_cases(cases) -> dict[str, np.ndarray]:
    cases = np.clip(np.asarray(cases, dtype=float), 0, None)
    return {k: round_half_up(cases * r) for k, r in RATIOS.items()}


def priority_scores(tiers, density_pct) -> np.ndarray:
    """Priority = risk-tier weight (1-4) x density factor (0.75-1.0, from the ward's density percentile).
    A higher tier always ranks at least as high as any ward of a lower tier (min High 2.25 > max Medium 2.0);
    within a tier, denser wards rank higher."""
    w = np.array([TIER_WEIGHT[t] for t in tiers], dtype=float)
    return w * (0.75 + 0.25 * np.asarray(density_pct, dtype=float))


def largest_remainder(weights, total: int, priority, cap=None) -> np.ndarray:
    """Split integer `total` proportionally to `weights` (Hamilton method); leftovers go to the largest
    fractional parts, then higher priority, then lower index. Never exceeds `cap` (defaults to weights)."""
    w = np.asarray(weights, dtype=float)
    cap = np.asarray(w if cap is None else cap, dtype=float)
    n = len(w)
    if total <= 0 or w.sum() <= 0:
        return np.zeros(n, dtype=int)
    total = int(min(total, cap.sum()))
    q = total * w / w.sum()
    x = np.minimum(np.floor(q), cap).astype(int)
    order = sorted(range(n), key=lambda i: (-(q[i] - np.floor(q[i])), -priority[i], i))
    left = total - int(x.sum())
    while left > 0:
        moved = False
        for i in order:
            if left == 0:
                break
            if x[i] < cap[i]:
                x[i] += 1
                left -= 1
                moved = True
        if not moved:
            break
    return x


def allocate(demand, priority, supply: int, floor_frac: float = 0.25) -> np.ndarray:
    """Integer allocation with sum(x) <= supply and 0 <= x_w <= demand_w.

    Stage 1 (fairness floor): every ward first receives floor_frac of its demand (proportionally
    scaled down by largest remainder if even the floors do not fit).
    Stage 2: remaining units go to wards in descending priority until their demand is met.
    Stage 2 is the exact optimum of  max sum(priority_w * x_w)  s.t. the floors, stock and demand caps
    (a fractional knapsack with unit weights has an integral greedy optimum); verified against
    scipy.optimize.linprog in the tests.
    """
    d = np.asarray(demand, dtype=int)
    p = np.asarray(priority, dtype=float)
    supply = int(max(0, min(supply, d.sum())))
    floors = np.floor(floor_frac * d + 1e-9).astype(int)
    if floors.sum() >= supply:
        return largest_remainder(floors, supply, p)
    x = floors.copy()
    left = supply - int(x.sum())
    for i in sorted(range(len(d)), key=lambda i: (-p[i], i)):
        if left == 0:
            break
        take = min(int(d[i] - x[i]), left)
        x[i] += take
        left -= take
    return x


# ---------------------------------------------------------------------------
# Vector-control counterfactual
# ---------------------------------------------------------------------------
# Why not perturb the forecaster's inputs? Tested 2026-11-27: scaling the recent-case features moved
# city totals by <1%, and scaling rain features gave non-monotone responses in up to a third of steps
# (tree-model extrapolation). A trained correlational model is not a causal model of spraying, so the
# effect is applied explicitly to the model's per-ward, per-horizon baseline and every parameter is
# exposed and disclosed. See docs/DECISIONS.md.
ONSET = {2: 0.5, 3: 0.85, 4: 1.0}  # share of the crew effect visible in reported cases h weeks after deployment


def crew_reduction(crews, per_crew: float, cap: float) -> np.ndarray:
    """Fractional reduction in transmission from k crews in a ward: 1 - (1 - per_crew)^k, capped.
    Concave in k (diminishing returns), so each extra crew in the same ward adds less."""
    k = np.asarray(crews, dtype=float)
    return np.minimum(cap, 1.0 - np.power(1.0 - per_crew, k))


def scenario_cases(baseline, crews, h: int, per_crew: float, cap: float, onset=ONSET) -> np.ndarray:
    """Counterfactual cases at horizon h = ML baseline x (1 - reduction(k) x onset(h)). Never negative,
    never above baseline."""
    base = np.clip(np.asarray(baseline, dtype=float), 0, None)
    return base * (1.0 - crew_reduction(crews, per_crew, cap) * onset[h])


def response_curves(baseline, h: int, max_crews: int, per_crew: float, cap: float) -> np.ndarray:
    """Cases for every ward with 0..max_crews crews -> array [n_wards, max_crews+1] (non-increasing)."""
    n = len(baseline)
    return np.stack([scenario_cases(baseline, np.full(n, k), h, per_crew, cap)
                     for k in range(max_crews + 1)], axis=1)


def assign_crews(curves: np.ndarray, total: int, max_per_ward: int, priority) -> np.ndarray:
    """Greedy marginal-gain assignment: each next crew goes to the ward where it prevents the most
    predicted cases (ties -> higher priority, then index). Because each ward's curve is concave in k,
    this greedy is an exact optimum of max total cases prevented s.t. the crew budget (separable
    concave resource allocation); verified by brute force in the tests."""
    n = curves.shape[0]
    x = np.zeros(n, dtype=int)
    p = np.asarray(priority, dtype=float)
    for _ in range(int(total)):
        best, best_key = -1, None
        for i in range(n):
            if x[i] >= max_per_ward:
                continue
            gain = curves[i, x[i]] - curves[i, x[i] + 1]
            key = (gain, p[i], -i)
            if best_key is None or key > best_key:
                best, best_key = i, key
        if best < 0 or best_key[0] <= 1e-9:
            break  # no ward left where a crew changes the forecast
        x[best] += 1
    return x


# ---------------------------------------------------------------------------
# Hospital overflow routing (strictly within one city pool)
# ---------------------------------------------------------------------------
def route_city(ward_ids, demand, capacity) -> dict:
    """Move excess bed demand from over-capacity wards to wards with headroom in the same city.
    Each unit goes to the receiver whose post-transfer utilisation is lowest (water-filling), so
    load is levelled and no bed is counted twice. Transfers = min(total excess, total headroom)."""
    ids = list(ward_ids)
    d = np.asarray(demand, dtype=int)
    c = np.asarray(capacity, dtype=int)
    load = np.minimum(d, c).astype(int)          # patients treated locally
    excess = np.maximum(d - c, 0).astype(int)    # patients needing a bed elsewhere
    inbound = np.zeros(len(ids), dtype=int)
    flows: dict[tuple[int, int], int] = {}
    for i in sorted(range(len(ids)), key=lambda i: (-excess[i], ids[i])):
        while excess[i] > 0:
            free = [j for j in range(len(ids)) if j != i and load[j] + inbound[j] < c[j]]
            if not free:
                break
            j = min(free, key=lambda j: ((load[j] + inbound[j] + 1) / c[j], ids[j]))
            inbound[j] += 1
            excess[i] -= 1
            flows[(i, j)] = flows.get((i, j), 0) + 1
    after = load + inbound
    util = lambda x, cap: None if cap == 0 else round(float(x) / cap, 3)
    wards = [{
        "ward_id": ids[k], "bed_demand": int(d[k]), "capacity": int(c[k]),
        "local_deficit": int(max(d[k] - c[k], 0)), "transferred_in": int(inbound[k]),
        "transferred_out": int(sum(v for (a, _), v in flows.items() if a == k)),
        "unmet_after_routing": int(excess[k]),
        "utilisation_before": util(d[k], c[k]), "utilisation_after": util(after[k], c[k]),
    } for k in range(len(ids))]
    cap_total, dem_total = int(c.sum()), int(d.sum())
    return {
        "wards": wards,
        "transfers": [{"from_ward": ids[a], "to_ward": ids[b], "patients": v}
                      for (a, b), v in sorted(flows.items(), key=lambda kv: (-kv[1], ids[kv[0][0]], ids[kv[0][1]]))],
        "capacity": cap_total, "bed_demand": dem_total,
        "occupied_after": int(after.sum()),
        "headroom_after": int(cap_total - after.sum()),
        "unmet_after": int(excess.sum()),
        "utilisation_before": util(dem_total, cap_total),
        "utilisation_after": util(int(after.sum()), cap_total),
    }
