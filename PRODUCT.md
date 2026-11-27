# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: government health officers and city commissioners** responsible for the 60 urban wards (Dhaka North, Dhaka South, Chattogram, Gazipur, Narayanganj). They decide which wards get saline bags, diagnostic kits, hospital beds and spraying crews when stock is short, and send ward-level instructions. When role needs conflict, their workflow wins.
- **Hospital and health-centre managers** preparing for predicted bed demand and routing overflow patients to other wards in the same city.
- **The public**: residents checking their ward's risk and what to do. This includes children, elderly people, rural migrants and first-time smartphone users with limited literacy.

## Product Purpose

Dengue Early Warning predicts weekly dengue cases for every ward 2, 3 and 4 weeks ahead from rainfall, temperature and humidity lags, and turns those forecasts into operational decisions: constrained supply allocation, spraying-crew deployment, intra-city hospital overflow routing, what-if intervention simulation, and dispatch notices (SMS, WhatsApp, printable commissioner briefs). Success means officers can act in the window between rain and cases, before hospitals fill, and can defend every recommendation.

Built for the EDU AI Engineering Hackathon 2026 (Phase 1 forecasting prototype; Phase 2 onsite operational extension).

## Positioning

- **Every number is traceable.** Forecasts come from a validated model; supply needs use per-case ratios recovered exactly from the official dataset; anything the data lacks (bed capacity, stock levels, spraying efficacy, distances) is a labelled, adjustable assumption. Retrospective replays are never presented as live surveillance.
- **Ward-level, 2–4 weeks ahead.** The forecast horizon matches the rain → breeding → transmission → reported-case delay, so the product acts before the surge, not after it.
- **Bangla-first for everyone.** Bangla is the default language in all three roles; English is a switch that keeps every selection.

## Operating Context

- Officers work from ward lists, priority rankings and supply tables; they adjust available stock (30–100% of demand) and total crews, then copy dispatch text into an approved gateway or print a brief. Nothing is sent automatically.
- Judging and demonstrations happen live, including with the network disconnected; the app runs on a local machine at `http://127.0.0.1:8000`.
- Data: the hackathon's official dataset, 31,320 weekly rows, 60 wards, 5 cities, 2016-01-04 to 2025-12-29. Provenance and redistribution terms are unspecified.

## Capabilities and Constraints

- Stack in place: FastAPI + pandas + scikit-learn backend (CSV in memory, no database), React 18 + Vite frontend with plain CSS and local Bangla/English dictionaries, Playwright and pytest tests.
- Model: per-horizon HistGradientBoosting (Poisson loss), chronological split (train ≤ 2022, validation 2023, test 2024–2025), training-percentile risk tiers Low / Medium / High / Critical (cut-offs 0, 5, 13 cases per ward-week). Model, split and tiers change only with team agreement.
- Must run fully offline after one-time setup: no cloud AI, CDN, external fonts or hotlinked assets at runtime.
- No verified ward boundaries or coordinates exist; the ward view is a schematic grid and must never be presented as a real map. A separate team GIS workflow (WardMap) exists but has not been supplied or verified.
- Role views have no login; no personal or patient data is stored.
- Outputs are planning recommendations, not clinical orders or patient-transfer instructions. Community risk is not an individual diagnosis.
- Open: real bed capacity, stock levels and spraying efficacy figures (awaiting organisers); hotline numbers (999, 16263) not yet verified at an official DGHS source.

## Brand Commitments

- Name: **Dengue Early Warning** / **ডেঙ্গু আগাম সতর্কতা**. "WardDesk" is not the product name.
- The team asked for a professional green and white design.
- Voice: plain, calm, factual; states uncertainty and limitations openly; never alarmist; explicitly not an officially endorsed government site.

## Evidence on Hand

- Measured on the held-out 2024–2025 test set (re-run 2026-11-27): MAE 1.037 / 1.065 / 1.279 cases per ward-week at 2 / 3 / 4 weeks, versus 1.691 / 1.924 / 2.136 for the last-week baseline (`backend/reports/validation.json`).
- Dataset checks: `backend/reports/data_validation.json`; supply ratios reproduce all 31,320 rows (`backend/tests/test_operations.py`).
- Phase 1 screenshots: `docs/screenshots/` (Bangla and English, desktop and mobile).
- No testimonials, user research, field pilots, deployment history or official endorsement exist. Do not fabricate them.

## Product Principles

1. Officers decide; the product shows its working. Every recommendation exposes its inputs, method and assumptions.
2. Honest over impressive: label what is measured, estimated, assumed or simulated, and never let the interface imply more certainty than the data holds.
3. Act early, per ward: the forecast window and ward granularity are the point. Do not drift into generic city dashboards.
4. Every control does what it says, offline. No decorative or fake functionality.
5. One product, three audiences: shared data and language, with each view appropriate to its user.

## Accessibility & Inclusion

- **Binding for the Public view:** picture-led content, short everyday Bangla labels, large touch targets (≥ 44 px), minimal typing, and risk never conveyed by colour alone (colour + symbol + word).
- No audio guidance, text-to-speech, voice assistant or voice commands (team decision, Round 2 brief). No AI-generated images; photographs must be real, licensed and attributed.
- No separate accessibility mode: accessibility is built into the default experience.
- Usability for low-literacy users stays labelled "untested" until tested with representative users.
- All views: WCAG 2.2 AA as the working standard, keyboard access, visible focus, screen-reader labels, reduced-motion respected, usable at 360 px width and on low bandwidth.
