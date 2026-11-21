import { useState } from "react";
import { api } from "./api.js";
import {
  ActionPanel, Card, CaseChart, Filters, HotlineStrip, Loading, ModeNote, TierBadge, TierLegend, Weather, addWeeks, useAsync,
} from "./components.jsx";
import {
  TIERS, bn, cityLabel, driverName, edu, fmtDate, modelName, tierName, tierPublic, tierRanges, tx, wardFull, wardLabel, weekOf,
} from "./i18n.js";

const bars = (items) => items.map((i) => ({ h: i.horizon_weeks, value: i.predicted_cases, lower: i.lower_cases, upper: i.upper_cases, actual: i.observed_cases }));
const range = (f) => `${bn(f.lower_cases, 1)}–${bn(f.upper_cases, 1)}`;
const casesWord = () => tx("জন", "cases");

function EduBlock({ k }) {
  const e = edu()[k];
  return (
    <Card title={e.title} id={`edu-${k}`} className={`edu edu-${k}`}>
      {e.lead && <p className="muted">{e.lead}</p>}
      <ul>{e.items.map((t) => <li key={t}>{t}</li>)}</ul>
    </Card>
  );
}

function Result({ f, who, extra }) {
  return (
    <Card title={who} id="result" className="result-card">
      <p className="muted">{tx("পূর্বাভাসের সপ্তাহ", "Forecast for")} {weekOf(f.target_date)} ({tx("একটি নির্দিষ্ট সপ্তাহ, যোগফল নয়", "one specific week, not a total")})</p>
      <div className="result">
        <div>
          <span className="num">{bn(f.predicted_cases, 1)}</span> <span className="unit">{tx("জন রোগী (সাপ্তাহিক অনুমান)", "cases (weekly estimate)")}</span>
          <p className="muted">{tx("৮০% সম্ভাব্য পরিসর", "80% range")}: {range(f)}</p>
        </div>
        <div className="tierbox"><span className="muted">{tx("ঝুঁকির স্তর", "Risk tier")}</span><TierBadge tier={f.risk_tier} big /></div>
      </div>
      {extra}
      {f.observed_cases != null && <p className="muted">{tx("পুনর্বিশ্লেষণ: পরে নথিভুক্ত প্রকৃত রোগী", "Replay: cases actually reported later")}: {bn(f.observed_cases)}</p>}
      <ModeNote mode={f.mode} />
      <details>
        <summary>{tx("স্তর কীভাবে ঠিক হয়?", "How are tiers set?")}</summary>
        <p className="muted">{tx("২০১৬–২০২২ সালের সাপ্তাহিক রোগীর সংখ্যার সঙ্গে তুলনা (আপেক্ষিক স্তর, জনসংখ্যা-ভিত্তিক হার নয়)।", "Compared with 2016–2022 weekly counts (relative tiers, not per-capita rates).")}</p>
        <TierLegend cuts={f.tier_cutoffs} />
      </details>
    </Card>
  );
}

/* ------------------------------ Public ------------------------------ */
export function PublicView({ meta, sel, set }) {
  const [q, setQ] = useState("");
  const fc = useAsync(() => api("forecast", { ward_id: sel.ward, issue_date: sel.issue, horizon_weeks: sel.h }), [sel.ward, sel.issue, sel.h]);
  const all = useAsync(() => api("forecast/all", { issue_date: sel.issue, horizon_weeks: sel.h, city: sel.city }), [sel.city, sel.issue, sel.h]);
  const hist = useAsync(() => api("history", { issue_date: sel.issue, ward_id: sel.ward, weeks: 26 }), [sel.ward, sel.issue]);
  const e = edu();
  return (
    <>
      <Card title={tx("এই সাইট কী দেখায়?", "What this site shows")} id="about" className="intro">
        <p>{tx("বৃষ্টি, তাপমাত্রা ও আর্দ্রতার অতীত তথ্য থেকে ওয়ার্ডভিত্তিক সাপ্তাহিক ডেঙ্গু রোগীর সম্ভাব্য সংখ্যা ও ঝুঁকির স্তর দেখানো হয়। এটি রোগ নির্ণয় নয়।",
          "Estimated weekly dengue cases and a risk tier per ward, based on past rainfall, temperature and humidity. It is not a diagnosis.")}</p>
      </Card>
      <Filters sel={sel} set={set} meta={meta} role="public">
        <ActionPanel role="public" h={sel.h} tier={fc.data?.risk_tier} />
      </Filters>
      <Loading r={fc}>{(f) => (
        <Result f={f} who={wardFull(f.ward_id, f.city)} extra={<p className="explain">{tierPublic(f.risk_tier)}</p>} />
      )}</Loading>
      <Loading r={fc}>{(f) => (
        <Card title={tx("আবহাওয়া", "Weather")} id="wx">
          <p className="muted">{wardLabel(f.ward_id)}, {weekOf(f.weather.week)}</p>
          <Weather w={f.weather} />
        </Card>
      )}</Loading>
      <Card title={tx("ওয়ার্ডভিত্তিক ঝুঁকি", "Risk by ward")} id="grid">
        <p className="muted">{cityLabel(sel.city)} · {all.data ? weekOf(all.data.target_date) : ""}. {tx("ওয়ার্ডে ক্লিক করুন। (ওয়ার্ড-সীমানার তথ্য নেই, তাই মানচিত্রের বদলে ছক।)", "Select a ward. (No ward boundaries in the data, so a grid replaces a map.)")}</p>
        <label className="search"><span>{tx("ওয়ার্ড খুঁজুন", "Find a ward")}</span>
          <input type="search" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={tx("যেমন: ০৫", "e.g. 05")} />
        </label>
        <Loading r={all}>{(d) => (
          <ul className="grid" aria-label={tx("ওয়ার্ডভিত্তিক ঝুঁকি", "Risk by ward")}>
            {d.wards.filter((w) => !q || wardLabel(w.ward_id).includes(q) || w.ward_id.toLowerCase().includes(q.toLowerCase())).map((w) => (
              <li key={w.ward_id}>
                <button className={`cell ${w.ward_id === sel.ward ? "sel" : ""}`} aria-pressed={w.ward_id === sel.ward} onClick={() => set.ward(w.ward_id)}>
                  <strong>{wardLabel(w.ward_id)}</strong>
                  <TierBadge tier={w.risk_tier} />
                  <span>{bn(w.predicted_cases, 1)} {casesWord()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}</Loading>
      </Card>
      <Card title={tx("নথিভুক্ত রোগী ও পূর্বাভাস", "Reported cases and forecast")} id="hist">
        <Loading r={hist}>{(h) => (
          <Loading r={fc}>{(f) => <CaseChart history={h.weeks} forecasts={bars([f])} title={`${wardLabel(sel.ward)}: ${tx("সাপ্তাহিক রোগী", "weekly cases")}`} />}</Loading>
        )}</Loading>
      </Card>
      <div className="two">{["what", "prevent", "signs", "doctor"].map((k) => <EduBlock key={k} k={k} />)}</div>
      <HotlineStrip />
      <p className="muted small">{e.sources.map(([t, u], i) => <span key={u}>{i ? " · " : ""}<a href={u} target="_blank" rel="noreferrer">{t}</a></span>)}</p>
    </>
  );
}

/* ------------------------------ Officer ------------------------------ */
function Vulnerability({ v }) {
  const rows = [
    ["population_density_sqkm", tx("জনঘনত্ব (প্রতি বর্গ কিমি)", "Population density (per sq km)"), (x) => bn(x)],
    ["water_logging_risk_index", tx("জলাবদ্ধতার ঝুঁকি (০–১)", "Waterlogging risk (0–1)"), (x) => bn(x, 2)],
    ["sanitation_score", tx("স্যানিটেশন স্কোর (কম = দুর্বল)", "Sanitation score (low = weak)"), (x) => bn(x, 2)],
  ];
  return (
    <ul className="bars" aria-label={tx("ওয়ার্ডের ঝুঁকির বৈশিষ্ট্য", "Ward vulnerability")}>
      {rows.map(([k, label, f]) => (
        <li key={k} className="wide">
          <span className="bl">{label}</span>
          <span className="track"><span className="fill vul" style={{ width: `${v[k].percentile * 100}%` }} /></span>
          <span className="bv">{f(v[k].value)} <small>({tx("৬০ ওয়ার্ডে", "among 60 wards")} {bn(Math.round(v[k].percentile * 100))}%)</small></span>
        </li>
      ))}
    </ul>
  );
}

function Drivers({ m, h }) {
  const d = m.horizons[String(h)].driver_importance_mae_increase;
  const total = Object.values(d).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return (
    <ul className="bars" aria-label={tx("মডেলের নির্ভরশীল তথ্য", "Model inputs by influence")}>
      {Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
        <li key={k} className="wide">
          <span className="bl">{driverName(k)}</span>
          <span className="track"><span className="fill drv" style={{ width: `${(Math.max(0, v) / total) * 100}%` }} /></span>
          <span className="bv">{bn((Math.max(0, v) / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

function planningText(f) {
  const w = f.weather;
  const diff = w.rain_4w_normal_mm > 0 ? ((w.rain_4w_mm - w.rain_4w_normal_mm) / w.rain_4w_normal_mm) * 100 : 0;
  const rain = Math.abs(diff) < 10 ? tx("মাসের গড়ের কাছাকাছি", "close to the monthly norm")
    : tx(`মাসের গড়ের চেয়ে প্রায় ${bn(Math.abs(diff))}% ${diff > 0 ? "বেশি" : "কম"}`, `about ${bn(Math.abs(diff))}% ${diff > 0 ? "above" : "below"} the monthly norm`);
  return tx(`গত ৪ সপ্তাহের বৃষ্টি ${rain}। ${weekOf(f.target_date)}-এ অনুমান প্রায় ${bn(f.predicted_cases, 1)} জন (${tierName(f.risk_tier)})। মাঠ-তথ্যের সঙ্গে মিলিয়ে দেখুন।`,
    `Rain over the last 4 weeks is ${rain}. Estimate for ${weekOf(f.target_date)}: about ${bn(f.predicted_cases, 1)} cases (${tierName(f.risk_tier)}). Compare with field information.`);
}

export function OfficerView({ meta, sel, set }) {
  const pr = useAsync(() => api("priority", { issue_date: sel.issue, horizon_weeks: sel.h, city: sel.city, limit: 10 }), [sel.city, sel.issue, sel.h]);
  const fc = useAsync(() => api("forecast", { ward_id: sel.ward, issue_date: sel.issue, horizon_weeks: sel.h }), [sel.ward, sel.issue, sel.h]);
  const hist = useAsync(() => api("history", { issue_date: sel.issue, ward_id: sel.ward, weeks: 52 }), [sel.ward, sel.issue]);
  const met = useAsync(() => api("metrics"), []);
  const top = pr.data?.wards;
  const flagged = top ? top.filter((w) => w.risk_tier === "High" || w.risk_tier === "Critical").length : 0;
  return (
    <>
      <Filters sel={sel} set={set} meta={meta} role="officer" allCities>
        <ActionPanel role="officer" h={sel.h} tier={top?.[0]?.risk_tier} />
      </Filters>
      <Card title={tx("পর্যালোচনার জন্য অগ্রাধিকার ওয়ার্ড (শীর্ষ ১০)", "Priority wards for review (top 10)")} id="top10">
        <p className="muted">{sel.city ? cityLabel(sel.city) : tx("সব শহর", "All cities")} · {weekOf(addWeeks(sel.issue, sel.h))}. {tx("পর্যালোচনার সহায়ক তালিকা, স্বয়ংক্রিয় নির্দেশ নয়।", "A review aid, not an automatic instruction.")}</p>
        {top && (
          <p className={`flag ${flagged ? "on" : ""}`}>
            {flagged
              ? tx(`শীর্ষ ১০-এর ${bn(flagged)}টি ওয়ার্ড উচ্চ বা অতি উচ্চ স্তরে: মাঠ-যাচাইয়ে অগ্রাধিকার দিন।`, `${bn(flagged)} of the top 10 are High or Critical: prioritise for field verification.`)
              : tx("শীর্ষ ১০-এর কোনোটি উচ্চ বা অতি উচ্চ স্তরে নয়।", "None of the top 10 is High or Critical.")}
          </p>
        )}
        <Loading r={pr}>{(d) => (
          <div className="tablewrap">
            <table>
              <caption className="sr-only">{tx("শীর্ষ ১০ অগ্রাধিকার ওয়ার্ড", "Top 10 priority wards")}</caption>
              <thead><tr><th>#</th><th>{tx("ওয়ার্ড", "Ward")}</th><th>{tx("শহর", "City")}</th><th>{tx("অনুমানিত রোগী", "Estimated cases")}</th><th>{tx("স্তর", "Tier")}</th></tr></thead>
              <tbody>
                {d.wards.map((w, i) => (
                  <tr key={w.ward_id} className={w.ward_id === sel.ward ? "sel" : ""}>
                    <td>{bn(i + 1)}</td>
                    <td><button className="link" onClick={() => set.pick(w.ward_id, w.city)}>{wardLabel(w.ward_id)}</button></td>
                    <td>{cityLabel(w.city)}</td>
                    <td>{bn(w.predicted_cases, 1)} <small>({range(w)})</small></td>
                    <td><TierBadge tier={w.risk_tier} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}</Loading>
        <Loading r={pr}>{(d) => <ModeNote mode={d.mode} />}</Loading>
      </Card>
      <Loading r={fc}>{(f) => (
        <>
          <Result f={f} who={`${tx("নির্বাচিত ওয়ার্ড", "Selected ward")}: ${wardFull(f.ward_id, f.city)}`} extra={<p className="explain">{planningText(f)}</p>} />
          <div className="two">
            <Card title={tx("বৃষ্টির বিলম্ব ও আবহাওয়া", "Rainfall lags and weather")} id="wx"><Weather w={f.weather} /></Card>
            <Card title={tx("নগর-ঝুঁকির বৈশিষ্ট্য", "Urban vulnerability")} id="vul"><Vulnerability v={f.vulnerability} /></Card>
          </div>
        </>
      )}</Loading>
      <Card title={tx("ঐতিহাসিক প্রবণতা (৫২ সপ্তাহ)", "Historical trend (52 weeks)")} id="trend">
        <Loading r={hist}>{(h) => (
          <Loading r={fc}>{(f) => <CaseChart history={h.weeks} forecasts={bars([f])} title={`${wardLabel(sel.ward)}: ${tx("সাপ্তাহিক রোগী", "weekly cases")}`} />}</Loading>
        )}</Loading>
      </Card>
      <Card title={tx("মডেল কোন তথ্যের ওপর নির্ভর করে", "What the model relies on")} id="drivers">
        <p className="muted">{tx("এলোমেলো করলে যাচাই-ত্রুটি কতটা বাড়ে তার আপেক্ষিক অংশ।", "Share of validation-error increase when each group is shuffled.")} <a href="#model">{tx("মডেল মূল্যায়ন", "Model performance")}</a></p>
        <Loading r={met}>{(m) => <Drivers m={m} h={sel.h} />}</Loading>
      </Card>
    </>
  );
}

/* ------------------------------ Hospital ------------------------------ */
export function HospitalView({ meta, sel, set }) {
  const scope = sel.ward ? { ward_id: sel.ward } : { city: sel.city };
  const cmp = useAsync(() => api("compare", { issue_date: sel.issue, ...scope }), [sel.ward, sel.city, sel.issue]);
  const hist = useAsync(() => api("history", { issue_date: sel.issue, weeks: 52, ...scope }), [sel.ward, sel.city, sel.issue]);
  const name = sel.ward ? wardFull(sel.ward, sel.city) : `${cityLabel(sel.city)} (${tx("সব ওয়ার্ডের যোগফল", "all wards combined")})`;
  const cur = cmp.data?.items.find((i) => i.horizon_weeks === sel.h);
  return (
    <>
      <Filters sel={sel} set={set} meta={meta} role="hospital" allWards>
        <ActionPanel role="hospital" h={sel.h} tier={cur?.risk_tier} />
      </Filters>
      <Loading r={cmp}>{(c) => {
        const now = c.items.find((i) => i.horizon_weeks === sel.h);
        const cuts = now.tier_cutoffs || meta.cuts;
        return (
          <>
            <Card title={`${tx("নির্বাচিত এলাকা", "Selected area")}: ${name}`} id="area" className="result-card">
              <p className="muted">{weekOf(now.target_date)}</p>
              <div className="result">
                <div>
                  <span className="num">{bn(now.predicted_cases, 1)}</span> <span className="unit">{tx("জন (এলাকার সাপ্তাহিক সম্ভাব্য ডেঙ্গু রোগী)", "cases (estimated weekly dengue cases in the area)")}</span>
                  {now.lower_cases != null && <p className="muted">{tx("৮০% সম্ভাব্য পরিসর", "80% range")}: {range(now)}</p>}
                </div>
                <div className="tierbox"><span className="muted">{tx("আপেক্ষিক চাপ", "Relative burden")}</span><TierBadge tier={now.risk_tier} big /></div>
              </div>
              <ModeNote mode={now.mode} />
              <details>
                <summary>{tx("স্তরের মান", "Tier ranges")} ({c.scope === "city" ? tx("শহরের সাপ্তাহিক মোট", "city weekly total") : tx("প্রতি ওয়ার্ডে সাপ্তাহিক", "per ward per week")})</summary>
                <ul className="legend">{TIERS.map((t) => <li key={t}><TierBadge tier={t} /> {tierRanges(cuts)[t]}</li>)}</ul>
              </details>
            </Card>
            <Card title={tx("২, ৩ ও ৪ সপ্তাহের তুলনা", "2, 3 and 4 weeks compared")} id="cmp">
              <div className="tablewrap">
                <table>
                  <caption className="sr-only">{tx("তিনটি সময়সীমার পূর্বাভাস", "Forecasts for three horizons")}</caption>
                  <thead><tr><th>{tx("সময়সীমা", "Horizon")}</th><th>{tx("সপ্তাহ", "Week")}</th><th>{tx("অনুমানিত", "Estimate")}</th><th>{tx("স্তর", "Tier")}</th><th>{tx("পরে নথিভুক্ত", "Reported later")}</th></tr></thead>
                  <tbody>
                    {c.items.map((i) => (
                      <tr key={i.horizon_weeks} className={i.horizon_weeks === sel.h ? "sel" : ""}>
                        <td><button className="link" onClick={() => set.h(i.horizon_weeks)}>{tx(`${bn(i.horizon_weeks)} সপ্তাহ পরে`, `In ${bn(i.horizon_weeks)} weeks`)}</button></td>
                        <td>{fmtDate(i.target_date)}</td>
                        <td>{bn(i.predicted_cases, 1)}</td>
                        <td><TierBadge tier={i.risk_tier} /></td>
                        <td>{i.observed_cases == null ? tx("ডেটায় নেই", "not in data") : bn(i.observed_cases)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">{tx("প্রতিটি সারি আলাদা সপ্তাহের অনুমান; যোগ করা যায় না।", "Each row is a separate week; rows cannot be added together.")}</p>
            </Card>
            <Card title={tx("ঐতিহাসিক প্রবণতা (৫২ সপ্তাহ)", "Historical trend (52 weeks)")} id="trend">
              <Loading r={hist}>{(h) => <CaseChart history={h.weeks} forecasts={bars(c.items)} title={`${name}: ${tx("সাপ্তাহিক রোগী", "weekly cases")}`} />}</Loading>
            </Card>
          </>
        );
      }}</Loading>
    </>
  );
}

/* ------------------------------ Model performance ------------------------------ */
const f3 = (x) => bn(x, 2);

export function ModelView() {
  const met = useAsync(() => api("metrics"), []);
  return (
    <Loading r={met}>{(m) => {
      const H = ["2", "3", "4"];
      return (
        <>
          <Card title={tx("মডেল পারফরম্যান্স (প্রযুক্তিগত)", "Model performance (technical)")} id="mp">
            <ul className="plain">
              <li>{tx("সময়ক্রম: প্রশিক্ষণ (লক্ষ্য-সপ্তাহ ৩১ ডিসেম্বর ২০২২ পর্যন্ত) → যাচাই (২০২৩) → পরীক্ষা (ইস্যু-সপ্তাহ ১ জানুয়ারি ২০২৪ থেকে)।", "Chronological split: train (targets to 31 Dec 2022) → validation (2023) → test (issue weeks from 1 Jan 2024).")}</li>
              <li>{tx("যাচাইয়ে মডেল নির্বাচন; চূড়ান্ত মডেল প্রশিক্ষণ+যাচাই তথ্যে পুনঃপ্রশিক্ষিত; পরীক্ষার তথ্য একবারই ব্যবহৃত।", "Model chosen on validation, refit on train+validation; test used once.")}</li>
              <li>{tx("ত্রুটির একক: ওয়ার্ড প্রতি সপ্তাহে রোগী।", "Error unit: cases per ward per week.")}</li>
            </ul>
            <div className="tablewrap">
              <table>
                <caption className="sr-only">{tx("পরীক্ষা-সময়কালের ত্রুটি", "Test-period error")}</caption>
                <thead><tr><th>{tx("সময়সীমা", "Horizon")}</th><th>{tx("মডেল", "Model")}</th><th>MAE</th><th>RMSE</th>
                  <th>{tx("বেসলাইন: গত সপ্তাহ (MAE / RMSE)", "Baseline: last week (MAE / RMSE)")}</th><th>{tx("বেসলাইন: ওয়ার্ড-গড় (MAE / RMSE)", "Baseline: ward mean (MAE / RMSE)")}</th><th>{tx("MAE উন্নতি", "MAE gain")}</th></tr></thead>
                <tbody>{H.map((h) => {
                  const x = m.horizons[h];
                  return (
                    <tr key={h}><td>{tx(`${bn(h)} সপ্তাহ`, `${h} wk`)}</td><td>{modelName(x.selected_model)}</td>
                      <td><strong>{f3(x.test.mae)}</strong></td><td><strong>{f3(x.test.rmse)}</strong></td>
                      <td>{f3(x.baseline_last_week.mae)} / {f3(x.baseline_last_week.rmse)}</td>
                      <td>{f3(x.baseline_ward_training_mean.mae)} / {f3(x.baseline_ward_training_mean.rmse)}</td>
                      <td>{bn((1 - x.test.mae / x.baseline_last_week.mae) * 100)}%</td></tr>
                  );
                })}</tbody>
              </table>
            </div>
          </Card>
          <div className="two">
            <Card title={tx("বছরভিত্তিক পরীক্ষা-ত্রুটি", "Test error by year")} id="yr">
              <div className="tablewrap"><table>
                <thead><tr><th>{tx("সময়সীমা", "Horizon")}</th><th>{bn(2024)} MAE / RMSE</th><th>{bn(2025)} MAE / RMSE</th></tr></thead>
                <tbody>{H.map((h) => (
                  <tr key={h}><td>{tx(`${bn(h)} সপ্তাহ`, `${h} wk`)}</td>
                    {["2024", "2025"].map((y) => { const e = m.horizons[h].test_by_year[y]; return <td key={y}>{e ? `${f3(e.mae)} / ${f3(e.rmse)}` : "—"}</td>; })}</tr>))}</tbody>
              </table></div>
            </Card>
            <Card title={tx("ঝুঁকির স্তর ও পরিসর", "Tiers and range coverage")} id="tiers">
              <div className="tablewrap"><table>
                <thead><tr><th>{tx("সময়সীমা", "Horizon")}</th><th>{tx("স্তর হুবহু", "Exact tier")}</th><th>{tx("এক স্তরের মধ্যে", "Within one tier")}</th><th>{tx("৮০% পরিসর", "80% range")}</th></tr></thead>
                <tbody>{H.map((h) => { const x = m.horizons[h]; return (
                  <tr key={h}><td>{tx(`${bn(h)} সপ্তাহ`, `${h} wk`)}</td><td>{bn(x.tier_exact_accuracy * 100)}%</td><td>{bn(x.tier_within_one * 100)}%</td><td>{bn(x.interval_80_coverage * 100)}%</td></tr>); })}</tbody>
              </table></div>
              <p className="muted small">{tx("কাট-অফ (প্রশিক্ষণের ৫০/৮০/৯৫ শতাংশক)", "Cut-offs (training 50/80/95th percentile)")}: {m.thresholds.map((t) => bn(t)).join(", ")}</p>
            </Card>
          </div>
          <Card title={tx("যাচাই-সময়কালে মডেল নির্বাচন (২০২৩, MAE)", "Model selection on validation (2023, MAE)")} id="sel">
            <div className="tablewrap"><table>
              <thead><tr><th>{tx("সময়সীমা", "Horizon")}</th>{Object.keys(m.horizons["2"].validation_candidates).map((k) => <th key={k}>{modelName(k)}</th>)}</tr></thead>
              <tbody>{H.map((h) => (
                <tr key={h}><td>{tx(`${bn(h)} সপ্তাহ`, `${h} wk`)}</td>{Object.entries(m.horizons[h].validation_candidates).map(([k, v]) => <td key={k}>{f3(v.mae)}{k === m.horizons[h].selected_model ? " ✔" : ""}</td>)}</tr>))}</tbody>
            </table></div>
          </Card>
          <Card title={tx("অফিসিয়াল ডেটাসেটের মান যাচাই", "Official dataset checks")} id="dq">
            <p>{bn(m.data.rows)} {tx("সারি", "rows")} · {bn(m.data.wards)} {tx("ওয়ার্ড", "wards")} · {bn(m.data.weeks_per_ward)} {tx("সপ্তাহ/ওয়ার্ড", "weeks/ward")} · {fmtDate(m.data.first_week)} – {fmtDate(m.data.last_week)}</p>
            <ul className="checks">{Object.entries(m.data.checks).map(([k, ok]) => <li key={k}><span aria-hidden="true">{ok ? "✔" : "✘"}</span> <code>{k}</code> {ok ? tx("ঠিক", "OK") : tx("ব্যর্থ", "failed")}</li>)}</ul>
          </Card>
        </>
      );
    }}</Loading>
  );
}
