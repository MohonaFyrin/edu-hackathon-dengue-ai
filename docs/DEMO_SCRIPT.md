# Phase 1 demo (≤ 3:00, one uncut screen recording, no slides)

Start: `.\start.cmd`, open http://127.0.0.1:8000 (opens on the Public view, issue week 4 Aug 2025).

| Time | Screen | Voiceover (say in your own words) |
|---|---|---|
| 0:00–0:20 | Public home | "Dengue follows rain by 2–4 weeks. This site turns ward-level weather history into weekly forecasts. Data ends Dec 2025, so these are retrospective forecasts, not live." |
| 0:20–0:55 | Public: horizon buttons | "Pick city, ward, issue week. Switch 2→3→4 weeks: target week, predicted cases and risk tier change from the real model API. Tier is relative to 2016–22 counts." Point at the grid, the chart (blue = reported, hatched = forecast), weather context. |
| 0:55–1:10 | Public: scroll | "Plain-Bangla education: what dengue is, prevention, warning signs, when to see a doctor." |
| 1:10–1:50 | Officer | "Top-10 priority wards; rainfall at lags 0–4 weeks vs the monthly norm; temperature, humidity; vulnerability percentiles; model drivers. Horizon changes re-rank wards. It supports review, not dispatch." |
| 1:50–2:15 | Hospital | "Area forecast, 2/3/4-week comparison, history, general preparedness. No admissions or bed predictions." |
| 2:15–2:45 | Model Performance | "Chronological split: train to 2022, validate 2023, test 2024–25. Test MAE ≈ 1.0–1.3 vs last-week baseline 1.7–2.1. Lags are per ward, no leakage, model saved with joblib, forecasts cached." |
| 2:45–3:00 | Terminal/`/docs` | "31 backend tests and a Playwright test pass. No external APIs or LLM calls." |
