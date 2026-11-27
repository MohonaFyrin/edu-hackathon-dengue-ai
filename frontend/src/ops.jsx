// Phase 2 operations UI: supply allocation, spraying crews, bed overflow, simulator and dispatch.
// Every number on these panels comes from the backend (/api/plan, /api/simulate, /api/dispatch);
// the browser only displays it.
import { useEffect, useState } from "react";
import { BedDouble, Copy, Download, Droplet, Printer, SprayCan, TestTube, TriangleAlert } from "lucide-react";
import { api } from "./api.js";
import { Card, Loading, TierBadge, useAsync } from "./components.jsx";
import { bn, cityLabel, fmtDate, tx, wardLabel, wardFull } from "./i18n.js";

export const OPS_DEFAULTS = {
  stock_pct: 60, saline_pct: null, kits_pct: null, beds_pct: null, total_crews: 12, larvicide_pct: 100, max_crews_per_ward: 3,
  floor_pct: 25, capacity_scale: 1, efficacy_per_crew: 0.1, efficacy_cap: 0.5,
};

const RES = [
  ["saline_bags_needed", "saline_pct", "স্যালাইন ব্যাগ", "Saline bags", Droplet],
  ["diagnostic_kits_needed", "kits_pct", "টেস্ট কিট", "Diagnostic kits", TestTube],
  ["hospital_beds_required", "beds_pct", "হাসপাতাল বেড", "Hospital beds", BedDouble],
];

/** Delay value updates while a slider is being dragged, so each stop is one request. */
function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function planParams(sel, ops, city) {
  return { issue_date: sel.issue, horizon_weeks: sel.h, city, ...ops };
}

function query(params) {
  return new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
}

export function usePlan(sel, ops, city) {
  const p = useDebounced(planParams(sel, ops, city));
  const key = query(p);
  return useAsync(() => api("plan", p), [key]);
}

/* ------------------------------ controls ------------------------------ */
function Slider({ label, value, min, max, step = 1, onChange, unit = "", hint }) {
  const id = `s-${label.replace(/\W+/g, "")}`;
  return (
    <div className="slider">
      <label htmlFor={id}><span>{label}</span><output htmlFor={id}>{bn(value, step < 1 ? 2 : 0)}{unit}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        aria-valuetext={`${value}${unit}`} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function SupplyControls({ ops, setOps }) {
  const set = (k) => (v) => setOps((o) => ({ ...o, [k]: v }));
  return (
    <Card title={tx("মজুত ও দল নিয়ন্ত্রণ", "Stock and crew controls")} id="controls" className="controls">
      <div className="ctl-grid">
        <Slider label={tx("আঞ্চলিক মজুত (চাহিদার %)", "Available regional stock (% of demand)")} value={ops.stock_pct} min={30} max={100}
          unit="%" onChange={(v) => setOps((o) => ({ ...o, stock_pct: v, saline_pct: null, kits_pct: null, beds_pct: null }))} />
        <Slider label={tx("মোট মশা নিধন দল", "Total spraying crews")} value={ops.total_crews} min={0} max={60} onChange={set("total_crews")} />
        <Slider label={tx("লার্ভিসাইড/ফগিং সামগ্রী (দলের প্রয়োজনের %)", "Larvicide/fogging supply (% of crew need)")} value={ops.larvicide_pct} min={30} max={100} unit="%"
          onChange={set("larvicide_pct")} hint={tx("ধরে নেওয়া: প্রতি দলে এক সেট সামগ্রী।", "Assumed: one supply set per crew.")} />
      </div>
      <details>
        <summary>{tx("প্রতিটি সামগ্রী আলাদা করে ও নীতিমালা", "Per-resource stock and policy settings")}</summary>
        <div className="ctl-grid">
          {RES.map(([, k, b, e]) => (
            <Slider key={k} label={tx(`${b} মজুত`, `${e} stock`)} value={ops[k] ?? ops.stock_pct} min={30} max={100} unit="%" onChange={set(k)} />
          ))}
          <Slider label={tx("প্রতিটি ওয়ার্ডের ন্যূনতম অংশ", "Minimum share for every ward")} value={ops.floor_pct} min={0} max={100} unit="%"
            onChange={set("floor_pct")} hint={tx("আগে সবাইকে এই অংশ, বাকিটা ঝুঁকি অনুযায়ী।", "Everyone first gets this share; the rest goes by priority.")} />
          <Slider label={tx("এক ওয়ার্ডে সর্বোচ্চ দল", "Max crews per ward")} value={ops.max_crews_per_ward} min={1} max={10} onChange={set("max_crews_per_ward")} />
        </div>
      </details>
    </Card>
  );
}

/* ------------------------------ allocation ------------------------------ */
function Bar({ value, max, cls = "" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className={`bar ${cls}`} aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>;
}

export function AllocationPanel({ p }) {
  const [showAll, setShowAll] = useState(false);
  const rows = [...p.wards].sort((a, b) => a.priority_rank - b.priority_rank);
  const shown = showAll ? rows : rows.slice(0, 15);
  return (
    <>
      <Card title={tx("সামগ্রী বরাদ্দ", "Supply allocation")} id="alloc">
        <p className="muted">{p.scope === "All cities" ? tx("সব শহর", "All cities") : cityLabel(p.scope)} · {tx("লক্ষ্য সপ্তাহ", "target week")} {fmtDate(p.target_date)} · {tx("চাহিদা = পূর্বাভাসিত রোগী × ডেটা থেকে পাওয়া অনুপাত", "demand = forecast cases × ratios recovered from the dataset")}</p>
        <div className="res-grid">
          {RES.map(([k, , b, e, Icon]) => {
            const v = p.resources[k];
            return (
              <div key={k} className={`res ${v.deficit ? "short" : "ok"}`}>
                <h3><Icon size={20} aria-hidden="true" /> {tx(b, e)}</h3>
                <p className="big">{bn(v.allocated)} <small>/ {bn(v.demand)} {tx("প্রয়োজন", "needed")}</small></p>
                <Bar value={v.allocated} max={v.demand} cls={v.deficit ? "warn" : ""} />
                <p className="small">{tx("মজুত", "Stock")} {bn(v.available_stock)} ({bn(v.stock_pct)}%)
                  {v.deficit ? <strong className="def"> · {tx("ঘাটতি", "Deficit")} {bn(v.deficit)}, {bn(v.wards_in_deficit)} {tx("ওয়ার্ড", "wards")}</strong> : <> · {tx("সম্পূর্ণ সরবরাহ", "fully supplied")}</>}</p>
              </div>
            );
          })}
          <div className={`res ${p.crews.deficit ? "short" : "ok"}`}>
            <h3><SprayCan size={20} aria-hidden="true" /> {tx("মশা নিধন দল", "Spraying crews")}</h3>
            <p className="big">{bn(p.crews.assigned)} <small>/ {bn(p.crews.total_available)} {tx("দল", "crews")}</small></p>
            <Bar value={p.crews.assigned} max={Math.max(p.crews.total_available, 1)} cls={p.crews.deficit ? "warn" : ""} />
            <p className="small">{p.crews.grounded_by_larvicide > 0 && <>{tx(`সামগ্রীর অভাবে ${bn(p.crews.grounded_by_larvicide)}টি দল বসে আছে · `, `${bn(p.crews.grounded_by_larvicide)} crews idle for lack of larvicide · `)}</>}
              {p.crews.deficit
                ? <strong className="def">{tx(`উচ্চ ঝুঁকির ${bn(p.crews.high_risk_wards_without_crew.length)}টি ওয়ার্ডে দল নেই`, `${bn(p.crews.high_risk_wards_without_crew.length)} high-risk wards have no crew`)}</strong>
                : tx("সব উচ্চ ঝুঁকির ওয়ার্ডে দল আছে", "every high-risk ward has a crew")}</p>
          </div>
        </div>
      </Card>
      <Card title={tx("জরুরি ঘাটতি সতর্কতা", "Critical supply deficit alerts")} id="alerts" className={p.alerts.length ? "alert-card" : ""}>
        {p.alerts.length === 0
          ? <p className="flag">{tx("সব ওয়ার্ডের চাহিদা ১০০% পূরণ হয়েছে।", "Every ward's demand is 100% met.")}</p>
          : <>
            <p className="flag on" role="status"><TriangleAlert size={18} aria-hidden="true" /> {tx(`${bn(p.alerts.length)}টি ওয়ার্ডের চাহিদা পুরো পূরণ হয়নি (${bn(p.alerts.filter((a) => a.alert === "critical").length)}টি জরুরি)।`,
              `${bn(p.alerts.length)} wards cannot be fully supplied (${bn(p.alerts.filter((a) => a.alert === "critical").length)} critical).`)}</p>
            <ul className="alert-list">
              {p.alerts.filter((a) => a.alert === "critical").slice(0, 8).map((w) => (
                <li key={w.ward_id}><strong>{wardFull(w.ward_id, w.city)}</strong> <TierBadge tier={w.risk_tier} /> {RES.filter(([k]) => w.deficit[k]).map(([k, , b, e]) => `${tx(b, e)} −${bn(w.deficit[k])}`).join(" · ")}</li>
              ))}
            </ul>
          </>}
      </Card>
      <Card title={tx("ওয়ার্ডভিত্তিক বরাদ্দ (অগ্রাধিকার ক্রমে)", "Ward allocation (priority order)")} id="wardalloc">
        <p className="muted small">{tx("অগ্রাধিকার: আগে ঝুঁকির স্তর, একই স্তরে বেশি জনঘনত্ব আগে। সংখ্যা = বরাদ্দ/প্রয়োজন।", "Priority: risk tier first; within a tier, denser wards first. Numbers = allocated/required.")}</p>
        <div className="tablewrap">
          <table className="alloc">
            <caption className="sr-only">{tx("ওয়ার্ডভিত্তিক বরাদ্দ", "Allocation by ward")}</caption>
            <thead><tr><th>#</th><th>{tx("ওয়ার্ড", "Ward")}</th><th>{tx("স্তর", "Tier")}</th><th>{tx("রোগী", "Cases")}</th><th>{tx("ঘনত্ব/কিমি²", "Density/km²")}</th>
              {RES.map(([k, , b, e]) => <th key={k}>{tx(b, e)}</th>)}<th>{tx("দল", "Crews")}</th></tr></thead>
            <tbody>
              {shown.map((w) => (
                <tr key={w.ward_id} className={w.alert ? `row-${w.alert}` : ""}>
                  <td>{bn(w.priority_rank)}</td>
                  <td>{wardLabel(w.ward_id)}{p.scope === "All cities" && <small> {cityLabel(w.city)}</small>}</td>
                  <td><TierBadge tier={w.risk_tier} /></td>
                  <td>{bn(w.predicted_cases, 1)}</td>
                  <td>{bn(w.population_density_sqkm)}</td>
                  {RES.map(([k]) => <td key={k} className={w.deficit[k] ? "short" : ""}>{bn(w.allocated[k])}/{bn(w.demand[k])}{w.deficit[k] ? <TriangleAlert size={14} aria-label={tx("ঘাটতি", "short")} /> : null}</td>)}
                  <td>{w.crews ? bn(w.crews) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 15 && <button className="btn ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? tx("কম দেখান", "Show fewer") : tx(`সব ${bn(rows.length)}টি ওয়ার্ড দেখান`, `Show all ${bn(rows.length)} wards`)}</button>}
        <details className="method">
          <summary>{tx("পদ্ধতি ও অনুমান", "Method and assumptions")}</summary>
          {tx(<p className="small">পদ্ধতির বিবরণ ইংরেজিতে, কারণ এটি কারিগরি যাচাইয়ের জন্য।</p>, null)}
          <ul>{Object.values(p.methods).map((m) => <li key={m}>{m}</li>)}{p.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      </Card>
    </>
  );
}

/* ------------------------------ overflow (hospital) ------------------------------ */
const pct = (x) => (x == null ? "—" : `${bn(Math.round(x * 100))}%`);

export function OverflowPanel({ p, city, ops, setOps }) {
  const cities = p.overflow.cities;
  const focus = cities.find((c) => c.city === city) || cities[0];
  return (
    <>
      <Card title={tx("হাসপাতাল বেড: চাহিদা ও স্থানান্তর", "Hospital beds: demand and overflow routing")} id="overflow">
        <p className="notice warn small">{tx("ডেটাসেটে বেড-ধারণক্ষমতা নেই। ধরে নেওয়া ধারণক্ষমতা = ২০১৬–২০২২ সালে ওয়ার্ডের সাপ্তাহিক বেড-চাহিদার ৯০তম শতাংশ × নিচের মাপক। আসল হাসপাতাল-তথ্য পেলে বদলাতে হবে।",
          "The dataset has no bed capacity. Assumed capacity = each ward's 90th-percentile weekly bed need in 2016–2022 × the scale below. Replace with real hospital data before use.")}</p>
        <Slider label={tx("ধারণক্ষমতার মাপক", "Capacity scale")} value={ops.capacity_scale} min={0.5} max={2} step={0.05}
          unit="×" onChange={(v) => setOps((o) => ({ ...o, capacity_scale: v }))} />
        <div className="tablewrap">
          <table>
            <caption className="sr-only">{tx("শহরভিত্তিক বেড ব্যবহার", "Bed utilisation by city")}</caption>
            <thead><tr><th>{tx("শহর", "City")}</th><th>{tx("বেড", "Beds")}</th><th>{tx("চাহিদা", "Demand")}</th><th>{tx("আগে", "Before")}</th><th>{tx("স্থানান্তরের পরে", "After routing")}</th><th>{tx("স্থানান্তর", "Routed")}</th><th>{tx("খালি বেড", "Headroom")}</th><th>{tx("অপূর্ণ", "Unmet")}</th></tr></thead>
            <tbody>
              {cities.map((c) => (
                <tr key={c.city} className={c.city === focus.city ? "sel" : ""}>
                  <td>{cityLabel(c.city)}</td><td>{bn(c.capacity)}</td><td>{bn(c.bed_demand)}</td>
                  <td>{pct(c.utilisation_before)}</td><td>{pct(c.utilisation_after)}</td>
                  <td>{bn(c.transfers.reduce((s, t) => s + t.patients, 0))}</td><td>{bn(c.headroom_after)}</td>
                  <td className={c.unmet_after ? "short" : ""}>{bn(c.unmet_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={`${cityLabel(focus.city)}: ${tx("ওয়ার্ডভিত্তিক বেড", "beds by ward")}`} id="beds">
        <p className="muted small">{tx("স্থানান্তর শুধু একই শহরের ভেতরে। এটি পরিকল্পনার সুপারিশ, রোগী স্থানান্তরের আদেশ নয়; দূরত্বের তথ্য নেই।",
          "Transfers stay inside the same city. Planning recommendation, not a patient transfer order; no distance data exists.")}</p>
        <ul className="beds">
          {focus.wards.map((w) => (
            <li key={w.ward_id}>
              <span className="bw">{wardLabel(w.ward_id)}</span>
              <span className="bt">
                <Bar value={w.bed_demand} max={Math.max(w.capacity, 1) * 1.5} cls={w.local_deficit ? "warn" : ""} />
                <small>{bn(w.bed_demand)} / {bn(w.capacity)} {tx("বেড", "beds")} · {tx("আগে", "before")} {pct(w.utilisation_before)} → {pct(w.utilisation_after)}
                  {w.transferred_out ? ` · ${tx("পাঠানো", "out")} ${bn(w.transferred_out)}` : ""}{w.transferred_in ? ` · ${tx("গ্রহণ", "in")} ${bn(w.transferred_in)}` : ""}
                  {w.unmet_after_routing ? ` · ${tx("অপূর্ণ", "unmet")} ${bn(w.unmet_after_routing)}` : ""}</small>
              </span>
            </li>
          ))}
        </ul>
        <h3>{tx("প্রস্তাবিত স্থানান্তর", "Recommended transfers")}</h3>
        {focus.transfers.length === 0
          ? <p className="muted">{tx("এই সপ্তাহে এই শহরে কোনো স্থানান্তর দরকার নেই।", "No transfers are needed in this city this week.")}</p>
          : <ul>{focus.transfers.map((t) => <li key={`${t.from_ward}-${t.to_ward}`}>{wardLabel(t.from_ward)} → {wardLabel(t.to_ward)}: <strong>{bn(t.patients)}</strong> {tx("জন রোগী", "patient(s)")}</li>)}</ul>}
      </Card>
    </>
  );
}

/* ------------------------------ simulator ------------------------------ */
export function SimulatorPanel({ sel, ops, setOps, city, meta }) {
  const [manual, setManual] = useState([]); // [{ward, crews}]
  const [pick, setPick] = useState("");
  const crews = manual.filter((m) => m.crews > 0).map((m) => `${m.ward}:${m.crews}`).join(",");
  const params = useDebounced({ ...planParams(sel, ops, city), crews: crews || null });
  const sim = useAsync(() => api("simulate", params), [query(params)]);
  const used = manual.reduce((s, m) => s + m.crews, 0);
  const deployable = Math.floor((ops.total_crews * ops.larvicide_pct) / 100 + 1e-9);
  const wards = meta.wards.filter((w) => !city || w.city === city);
  const add = () => {
    if (!pick) return;
    setManual((m) => (m.some((x) => x.ward === pick) ? m : [...m, { ward: pick, crews: 1 }]));
  };
  const change = (ward, d) => setManual((m) => m.map((x) => (x.ward === ward ? { ...x, crews: Math.max(0, Math.min(10, x.crews + d)) } : x)).filter((x) => x.crews > 0));
  return (
    <>
      <Card title={tx("মশা নিধন সিমুলেটর: কী হলে কী হয়", "Vector-control what-if simulator")} id="sim">
        <p className="notice warn small">{tx("কার্যকারিতা একটি ধরে নেওয়া মান (ডেটায় নেই)। মডেলের পূর্বাভাস ভিত্তি ধরে, দল পাঠালে সংক্রমণ কতটা কমতে পারে তা দেখানো হয়। এটি কারণ-প্রমাণ নয়।",
          "Effect size is an assumption (not in the data). The ML forecast is the baseline; the simulator shows how far cases would fall if crews cut transmission by the set amount. This is not proof of cause.")}</p>
        <div className="ctl-grid">
          <Slider label={tx("প্রতি দলে সংক্রমণ কমে (ধরে নেওয়া)", "Transmission cut per crew (assumed)")} value={Math.round(ops.efficacy_per_crew * 100)} min={0} max={40} unit="%"
            onChange={(v) => setOps((o) => ({ ...o, efficacy_per_crew: v / 100 }))} />
          <Slider label={tx("এক ওয়ার্ডে সর্বোচ্চ প্রভাব", "Maximum effect in one ward")} value={Math.round(ops.efficacy_cap * 100)} min={0} max={90} unit="%"
            onChange={(v) => setOps((o) => ({ ...o, efficacy_cap: v / 100 }))} />
        </div>
        <fieldset className="deploy">
          <legend>{tx("দল কোথায় যাবে", "Where crews go")}</legend>
          <p className="small">{manual.length === 0
            ? tx(`এখন সর্বোত্তম পরিকল্পনা দেখানো হচ্ছে (${bn(deployable)}টি দল)। নিজে ওয়ার্ড বেছে নিতে নিচে যোগ করুন।`, `Showing the optimised plan (${bn(deployable)} crews). Add wards below to deploy crews yourself.`)
            : tx(`নিজে বেছে নেওয়া: ${bn(used)} / ${bn(deployable)}টি দল`, `Manual deployment: ${bn(used)} of ${bn(deployable)} crews`)}</p>
          <div className="row">
            <select aria-label={tx("ওয়ার্ড বেছে নিন", "Choose ward")} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{tx("ওয়ার্ড বেছে নিন", "Choose a ward")}</option>
              {wards.map((w) => <option key={w.ward_id} value={w.ward_id}>{wardFull(w.ward_id, w.city)}</option>)}
            </select>
            <button className="btn" onClick={add} disabled={!pick || used >= deployable}>{tx("দল যোগ করুন", "Add crew")}</button>
            {manual.length > 0 && <button className="btn ghost" onClick={() => setManual([])}>{tx("সর্বোত্তম পরিকল্পনায় ফিরুন", "Back to optimised plan")}</button>}
          </div>
          {manual.length > 0 && (
            <ul className="deploy-list">
              {manual.map((m) => (
                <li key={m.ward}>
                  <span>{wardLabel(m.ward)}</span>
                  <button className="step" aria-label={tx("এক দল কমান", "Remove one crew")} onClick={() => change(m.ward, -1)}>−</button>
                  <strong aria-live="polite">{bn(m.crews)}</strong>
                  <button className="step" aria-label={tx("এক দল বাড়ান", "Add one crew")} onClick={() => change(m.ward, 1)} disabled={used >= deployable}>+</button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </Card>
      <Loading r={sim}>{(s) => (
        <>
          <Card title={tx("ফলাফল: ২ থেকে ৪ সপ্তাহ", "Result: 2 to 4 weeks ahead")} id="simres">
            <p className="result-line"><span className="num">{bn(s.cases_prevented_2_4w, 1)}</span> {tx("জন রোগী কম (২–৪ সপ্তাহে মোট, আনুমানিক)", "fewer cases (weeks 2–4 combined, estimated)")}
              {s.roi_cases_per_crew != null && <> · <strong>{bn(s.roi_cases_per_crew, 2)}</strong> {tx("জন প্রতি দলে", "per crew")}</>}</p>
            <div className="tablewrap">
              <table>
                <caption className="sr-only">{tx("ভিত্তি বনাম দল পাঠানোর পরে", "Baseline vs with crews")}</caption>
                <thead><tr><th>{tx("সময়সীমা", "Horizon")}</th><th>{tx("সপ্তাহ", "Week")}</th><th>{tx("রোগী: ভিত্তি → দলসহ", "Cases: baseline → with crews")}</th><th>{tx("বেড", "Beds")}</th><th>{tx("স্যালাইন", "Saline")}</th><th>{tx("কিট", "Kits")}</th></tr></thead>
                <tbody>
                  {s.horizons.map((h) => (
                    <tr key={h.horizon_weeks}>
                      <td>{tx(`${bn(h.horizon_weeks)} সপ্তাহ`, `${h.horizon_weeks} weeks`)}</td><td>{fmtDate(h.target_date)}</td>
                      <td>{bn(h.baseline_cases, 1)} → <strong>{bn(h.scenario_cases, 1)}</strong> (−{bn(h.cases_prevented, 1)})</td>
                      <td>{bn(h.baseline_beds)} → {bn(h.scenario_beds)}</td><td>{bn(h.baseline_saline)} → {bn(h.scenario_saline)}</td><td>{bn(h.baseline_kits)} → {bn(h.scenario_kits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="two">
            <Card title={tx("দলপ্রতি ফল (ROI) অনুযায়ী ক্রম", "Ranked by return per crew (ROI)")} id="roi">
              {s.roi_ranking.length === 0 ? <p className="muted">{tx("কোনো দল পাঠানো হয়নি।", "No crews deployed.")}</p> : (
                <ol className="roi">{s.roi_ranking.map((r) => (
                  <li key={r.ward_id}><strong>{wardFull(r.ward_id, r.city)}</strong> <TierBadge tier={r.risk_tier} /><br />
                    <small>{bn(r.crews)} {tx("দল", "crews")} · {bn(r.cases_prevented_2_4w, 2)} {tx("জন কম", "fewer cases")} · <strong>{bn(r.roi_cases_per_crew, 2)}</strong> {tx("প্রতি দলে", "per crew")}</small></li>))}
                </ol>)}
            </Card>
            <Card title={tx("পরের দল কোথায় সবচেয়ে কাজে আসবে", "Where the next crew helps most")} id="next">
              <ol className="roi">{s.next_crew_candidates.slice(0, 6).map((r) => (
                <li key={r.ward_id}>{wardFull(r.ward_id, r.city)} <small>+{bn(r.next_crew_cases_prevented, 2)} {tx("জন কম", "fewer cases")}</small></li>))}
              </ol>
            </Card>
          </div>
          <details className="method card">
            <summary>{tx("সিমুলেশনের অনুমান", "Simulation assumptions")}</summary>
            <ul>{s.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        </>
      )}</Loading>
    </>
  );
}

/* ------------------------------ dispatch ------------------------------ */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}

function CopyBox({ label, text, meta }) {
  const [done, setDone] = useState(false);
  return (
    <div className="msg">
      <div className="msg-head"><strong>{label}</strong>{meta && <small>{meta}</small>}
        <button className="btn small" onClick={async () => { setDone(await copyText(text)); setTimeout(() => setDone(false), 2000); }}>
          <Copy size={16} aria-hidden="true" /> {done ? tx("কপি হয়েছে", "Copied") : tx("কপি", "Copy")}</button></div>
      <pre>{text}</pre>
    </div>
  );
}

export function DispatchPanel({ sel, ops, city }) {
  const [onlyAlerts, setOnlyAlerts] = useState(true);
  const [ward, setWard] = useState("");
  const base = useDebounced(planParams(sel, ops, city));
  const d = useAsync(() => api("dispatch", { ...base, only_alerts: onlyAlerts }), [query(base), onlyAlerts]);
  const qs = query(base);
  return (
    <Card title={tx("নির্দেশনা বার্তা ও প্রতিবেদন", "Dispatch notices and reports")} id="dispatch">
      <p className="notice small">{tx("বার্তা পাঠানো হয় না। অনুমোদিত SMS/WhatsApp ব্যবস্থায় কপি করে পাঠান।", "Nothing is sent. Copy into an approved SMS/WhatsApp gateway.")}</p>
      <div className="row wrap-row">
        <a className="btn primary" href={`/api/brief?${qs}`} target="_blank" rel="noreferrer"><Printer size={18} aria-hidden="true" /> {tx("কমিশনার ব্রিফ (ছাপা/PDF)", "Commissioner brief (print/PDF)")}</a>
        {[["allocation", "বরাদ্দ", "Allocation"], ["overflow", "বেড স্থানান্তর", "Overflow"], ["simulation", "সিমুলেশন", "Simulation"], ["dispatch", "সব বার্তা", "All messages"]].map(([k, b, e]) => (
          <a key={k} className="btn ghost" href={`/api/export/${k}.csv?${qs}`} download><Download size={18} aria-hidden="true" /> {tx(`${b} CSV`, `${e} CSV`)}</a>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} /> {tx("শুধু ঘাটতির ওয়ার্ড", "Only wards with deficits")}</label>
      <Loading r={d}>{(x) => {
        const msgs = x.messages;
        const cur = msgs.find((m) => m.ward_id === ward) || msgs[0];
        if (!cur) return <p className="muted">{tx("কোনো ঘাটতির ওয়ার্ড নেই। সব ওয়ার্ড দেখতে টিক তুলে দিন।", "No wards have deficits. Untick the box to see all wards.")}</p>;
        return (
          <>
            <label className="pick"><span>{tx("ওয়ার্ড", "Ward")} ({bn(msgs.length)})</span>
              <select value={cur.ward_id} onChange={(e) => setWard(e.target.value)}>
                {msgs.map((m) => <option key={m.ward_id} value={m.ward_id}>{wardFull(m.ward_id, m.city)}{m.alert === "critical" ? ` (${tx("জরুরি", "critical")})` : ""}</option>)}
              </select></label>
            <div className="two">
              <CopyBox label="SMS (English)" text={cur.sms_en} meta={`${cur.sms_en_chars}/160`} />
              <CopyBox label="SMS (বাংলা)" text={cur.sms_bn} meta={tx(`${bn(cur.sms_bn_segments)} অংশ`, `${cur.sms_bn_segments} part(s)`)} />
              <CopyBox label="WhatsApp (English)" text={cur.whatsapp_en} />
              <CopyBox label="WhatsApp (বাংলা)" text={cur.whatsapp_bn} />
            </div>
          </>
        );
      }}</Loading>
    </Card>
  );
}
