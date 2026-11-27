# Round 2 (Phase 2 onsite): what was added and how to run it

## Run (Windows)

~~~
setup.cmd path\to\bangladesh_dengue_large_dataset_onsite.xlsx   (once, needs internet)
start.cmd                                                      (one click, fully offline)
stop.cmd
~~~

`setup.cmd` creates `.venv`, installs pinned packages, converts the workbook, regenerates `reports/validation.json`, builds the website and runs the tests. `start.cmd` installs and downloads nothing; it starts the server, waits for `/api/health` and opens http://127.0.0.1:8000. `stop.cmd` stops only the process `start.cmd` recorded.

## Modules

| Requirement (points) | Where | How it works |
|---|---|---|
| Constrained allocation (15) | Officer → Supplies & crews; `/api/plan` | Demand = ML forecast × per-case ratios recovered from the onsite data (saline 2.385, kits 1.164, beds 0.298, round half up; reproduces all 31,320 rows). Stock slider 30–100% per resource. Fairness floor, then priority greedy (risk tier first, density within tier); exact optimum of max Σ priority × units, checked against an LP solver. Never exceeds stock or demand. Deficit alerts per ward. |
| Crews and larvicide | same | Larvicide supply % limits deployable crews (one supply set per crew, assumed). Crews go greedily to the largest marginal cases prevented; optimal because each ward's response is concave (brute-force tested). Flags High/Critical wards left without a crew. |
| Overflow routing (10) | Hospital view; Map Hub "Bed overflow" layer | Per city only. Excess beds go unit by unit to the ward with the lowest post-transfer utilisation. Shows demand, assumed capacity, before/after utilisation, transfers, headroom and unmet demand. Capacity is not in the data: default = ward's 2016–2022 p90 weekly bed need × scale slider. |
| Vector-control simulator (10) | Officer → Spray simulator; `/api/simulate` | ML forecast for weeks 2, 3, 4 is the baseline; scenario = baseline × (1 − reduction(crews) × onset(h)), reduction = 1 − (1 − p)^k capped. Onset 50/85/100% from CDC/WHO timing. Δcases, Δbeds, Δsaline, ROI = cases prevented per crew, next-best-crew ranking. Efficacy is an adjustable assumption, not a causal claim. |
| Dispatch (part of 10) | Officer → Dispatch & briefs; `/api/dispatch`, `/api/brief`, `/api/export/*.csv` | SMS (≤160 chars, Bangla and English), WhatsApp text, printable HTML brief, CSV exports. All from the same computed plan. Nothing is sent. |
| Offline resilience (15) | everything | Forecast, allocation, routing, simulation, dispatch, map outlines, facilities, fonts, icons and photo are local. Connectivity indicator checks the app's own service, not just `navigator.onLine`. |
| Map Hub | Map | Team's `WardMap.jsx` tiles + real district outlines (geoBoundaries) + layer toggles (borders, supply shortage, crews, bed transfers, nearby healthcare). Ward positions are schematic: no verified ward boundaries exist. |
| Nearby healthcare | Map → Nearby healthcare | 2,420 OpenStreetMap hospitals/clinics/pharmacies within 7 km of each city centre, stored locally. Unverified, no capacity. Call buttons only where OSM has a number; outside-map links hidden offline. |
| Field reports | Report; Officer → Citizen reports; `/api/reports` | Standing water / garbage / broken sewer, ward, optional location and photo. No name or phone. Photos re-encoded in the browser (removes GPS metadata), checked by content type, stored locally. Duplicate taps stored once. Submit disabled when the service is unreachable. Officer can mark reviewed/resolved. |

## Data added

See `ASSETS.md` for sources and licences: `backend/geo/districts.json` (CC BY 3.0 IGO), `backend/geo/facilities.json` (ODbL), `frontend/public/assets/aedes-aegypti-cdc-gathany.jpg` (public domain).

## Known limitations

- Bed capacity, stock levels, spraying efficacy and distances are not in the data; all are labelled, adjustable assumptions.
- Ward boundaries do not exist in the data; wards are a schematic grid. District outlines and city centres are real.
- Report review has no login in this demo; access must be restricted before real use.
- Low-literacy usability has not been tested with real users.
- Forecasts are retrospective replays of data ending 2025-12-29, not live surveillance.
