import { useEffect, useRef, useState } from "react";
import {
  TIER, actions, bn, cityLabel, errText, fmtDate, fmtMonth, fmtShort, hotlines, horizonCopy, modeNote, tierName, tx,
  wardLabel, weekOf, bnDigits,
} from "./i18n.js";

export function useAsync(fn, deps) {
  const [state, set] = useState({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && set({ data, loading: false }))
      .catch((error) => live && set({ error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

export function Loading({ r, children }) {
  if (r.error) {
    return (
      <div className="notice err" role="alert">
        <p>{errText()}</p>
        <button className="btn" onClick={r.retry}>{tx("আবার চেষ্টা করুন", "Try again")}</button>
      </div>
    );
  }
  if (r.loading && !r.data) return <p className="muted" role="status">{tx("লোড হচ্ছে…", "Loading…")}</p>;
  return children(r.data);
}

export function TierBadge({ tier, big }) {
  const t = TIER[tier];
  return <span className={`tier ${t.cls}${big ? " big" : ""}`}><span aria-hidden="true">{t.sym}</span> {tierName(tier)}</span>;
}

export const ModeNote = ({ mode }) => <p className={`mode ${mode}`}>{modeNote(mode)}</p>;

export function Card({ title, id, children, className = "" }) {
  return (
    <section id={id} className={`card ${className}`} aria-labelledby={`${id}-h`}>
      {title && <h2 id={`${id}-h`}>{title}</h2>}
      {children}
    </section>
  );
}

export function addWeeks(iso, w) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * w);
  return d.toISOString().slice(0, 10);
}

export function ActionPanel({ role, h, tier }) {
  const a = actions(role, h, tier || "Low");
  return (
    <div className="actions" aria-live="polite">
      <h3>{a.heading}</h3>
      <ul>{a.bullets.map((b, i) => <li key={i} className={b.emph && (tier === "High" || tier === "Critical") ? "emph" : ""}>{b.t}</li>)}</ul>
      {a.note && <p className="note">{a.note}</p>}
    </div>
  );
}

/** City / ward / issue-week selects, compact horizon selector and a slot for the action bullets. */
export function Filters({ sel, set, meta, role, allCities = false, allWards = false, children }) {
  const cityWards = meta.wards.filter((w) => !sel.city || w.city === sel.city);
  const copy = horizonCopy(role);
  return (
    <div className="filters card" role="group" aria-label={tx("নির্বাচন", "Selection")}>
      <div className="selects">
        <label><span>{tx("শহর", "City")}</span>
          <select value={sel.city} onChange={(e) => set.city(e.target.value)}>
            {allCities && <option value="">{tx("সব শহর", "All cities")}</option>}
            {meta.cities.map((c) => <option key={c} value={c}>{cityLabel(c)}</option>)}
          </select>
        </label>
        <label><span>{tx("ওয়ার্ড", "Ward")}</span>
          <select value={sel.ward} onChange={(e) => set.ward(e.target.value)}>
            {allWards && <option value="">{tx("সব ওয়ার্ড", "All wards")}</option>}
            {cityWards.map((w) => <option key={w.ward_id} value={w.ward_id}>{wardLabel(w.ward_id)}{sel.city ? "" : `, ${cityLabel(w.city)}`}</option>)}
          </select>
        </label>
        <label><span>{tx("তথ্যের সপ্তাহ", "Data week")}</span>
          <select value={sel.issue} onChange={(e) => set.issue(e.target.value)}>
            {[...meta.issueDates].reverse().map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="horizon">
        <legend>{copy.label}</legend>
        <div className="hzrow">
          <div className="seg">
            {[2, 3, 4].map((h) => (
              <label key={h} className={sel.h === h ? "on" : ""}>
                <input type="radio" name={`h-${role}`} checked={sel.h === h} onChange={() => set.h(h)} />
                <span>{copy.opts[h]}</span>
              </label>
            ))}
          </div>
          <p className="chip" data-testid="target-week">
            {tx("লক্ষ্য সপ্তাহ", "Target week")}: <strong>{fmtDate(addWeeks(sel.issue, sel.h))}</strong>
          </p>
        </div>
        {sel.issue !== meta.latest && (
          <button type="button" className="link inline" onClick={() => set.issue(meta.latest)}>
            {tx(`সর্বশেষ সপ্তাহ (${fmtDate(meta.latest)}) দেখুন`, `Go to latest data week (${fmtDate(meta.latest)})`)}
          </button>
        )}
      </fieldset>
      {children}
    </div>
  );
}

/** Observed weekly cases (solid bars) and clearly separate hatched forecast bars. */
export function CaseChart({ history, forecasts = [], title }) {
  const W = 720, H = 250, L = 44, R = 12, T = 18, B = 40;
  const n = history.length, slots = n + 4;
  const vals = [...history.map((x) => x.cases), ...forecasts.flatMap((f) => [f.upper ?? f.value, f.actual ?? 0, f.value])];
  const max = Math.max(4, Math.ceil(Math.max(...vals) * 1.1));
  const step = (W - L - R) / slots, bw = Math.max(2, step * 0.7);
  const x = (i) => L + i * step + (step - bw) / 2;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const every = Math.ceil(n / 6);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${tx("ভরাট স্তম্ভ অতীতের নথিভুক্ত রোগী; ডোরাকাটা স্তম্ভ পূর্বাভাস।", "Solid bars are reported cases; hatched bars are forecasts.")}`}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#fff" /><rect width="3" height="6" fill="#7a4a00" />
          </pattern>
        </defs>
        <rect x={L + n * step} y={T} width={4 * step} height={H - T - B} fill="#f1efe8" />
        <text x={L + n * step + 2 * step} y={T + 12} textAnchor="middle" className="svg-note">{tx("পূর্বাভাস", "Forecast")}</text>
        {[0, 0.5, 1].map((k) => Math.round(max * k)).map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="svg-axis">{bn(t)}</text></g>
        ))}
        {history.map((p, i) => <rect key={p.date} x={x(i)} y={y(p.cases)} width={bw} height={Math.max(0, y(0) - y(p.cases))} fill="#1d5c96" />)}
        {history.map((p, i) => i % every === 0 && <text key={`l${p.date}`} x={x(i) + bw / 2} y={H - 22} textAnchor="middle" className="svg-axis">{fmtMonth(p.date)}</text>)}
        {forecasts.map((f) => {
          const i = n - 1 + f.h, cx = x(i) + bw / 2;
          return (
            <g key={f.h}>
              <rect x={x(i)} y={y(f.value)} width={bw} height={Math.max(0, y(0) - y(f.value))} fill="url(#hatch)" stroke="#7a4a00" />
              {f.lower != null && <line x1={cx} x2={cx} y1={y(f.upper)} y2={y(f.lower)} stroke="#222" strokeWidth="2" />}
              {f.actual != null && <circle cx={cx} cy={y(f.actual)} r="4.5" fill="#fff" stroke="#111" strokeWidth="2" />}
              <text x={cx} y={H - 22} textAnchor="middle" className="svg-axis">+{bn(f.h)}{tx(" সপ্তাহ", "w")}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span className="key blue" /> {tx("নথিভুক্ত প্রকৃত রোগী", "Reported cases")}
        <span className="key hatch" /> {tx("পূর্বাভাস (অনুমান)", "Forecast (estimate)")}
        <span className="key bar" /> {tx("৮০% পরিসর", "80% range")}
        {forecasts.some((f) => f.actual != null) && <><span className="key dot" /> {tx("পরে নথিভুক্ত প্রকৃত", "Later reported actual")}</>}
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>{tx("সপ্তাহ", "Week")}</th><th>{tx("প্রকৃত রোগী", "Reported cases")}</th></tr></thead>
        <tbody>{history.map((p) => <tr key={p.date}><td>{fmtShort(p.date)}</td><td>{bn(p.cases)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export function Weather({ w }) {
  const rows = [4, 3, 2, 1, 0].map((k) => [k, w.rain_by_lag_mm[String(k)]]);
  const max = Math.max(1, ...rows.map((e) => e[1]));
  const diff = w.rain_4w_normal_mm > 0 ? ((w.rain_4w_mm - w.rain_4w_normal_mm) / w.rain_4w_normal_mm) * 100 : null;
  return (
    <>
      <ul className="bars" aria-label={tx("বিগত সপ্তাহগুলোর বৃষ্টিপাত", "Rainfall in recent weeks")}>
        {rows.map(([k, v]) => (
          <li key={k}>
            <span className="bl">{k === 0 ? tx("নির্বাচিত সপ্তাহ", "Selected week") : tx(`${bn(k)} সপ্তাহ আগে`, `${bn(k)} wk before`)}</span>
            <span className="track"><span className="fill rain" style={{ width: `${(v / max) * 100}%` }} /></span>
            <span className="bv">{bn(v, 1)} {tx("মিমি", "mm")}</span>
          </li>
        ))}
      </ul>
      <dl className="facts">
        <div><dt>{tx("গত ৪ সপ্তাহের বৃষ্টি", "Rain, last 4 weeks")}</dt><dd>{bn(w.rain_4w_mm, 1)} {tx("মিমি", "mm")}
          {diff != null && <small> ({tx("মাসের গড়ের চেয়ে", "vs monthly norm")} {diff >= 0 ? "+" : "−"}{bn(Math.abs(diff))}%)</small>}</dd></div>
        <div><dt>{tx("গত ৮ সপ্তাহের বৃষ্টি", "Rain, last 8 weeks")}</dt><dd>{bn(w.rain_8w_mm, 1)} {tx("মিমি", "mm")}</dd></div>
        <div><dt>{tx("তাপমাত্রা", "Temperature")}</dt><dd>{bn(w.avg_temp_c, 1)}° {tx("সে.", "C")}</dd></div>
        <div><dt>{tx("আর্দ্রতা", "Humidity")}</dt><dd>{bn(w.humidity_pct, 1)}%</dd></div>
      </dl>
    </>
  );
}

export function TierLegend({ cuts }) {
  const [a, b, c] = cuts;
  const rows = [["Low", bn(0) + (a ? `–${bn(a)}` : "")], ["Medium", `${bn(a + 1)}–${bn(b)}`], ["High", `${bn(b + 1)}–${bn(c)}`],
    ["Critical", tx(`${bn(c + 1)} বা বেশি`, `${bn(c + 1)} or more`)]];
  return (
    <ul className="legend" aria-label={tx("ঝুঁকির স্তরের মান", "Risk tier ranges")}>
      {rows.map(([t, r]) => <li key={t}><TierBadge tier={t} /> {r} {tx("জন/ওয়ার্ড/সপ্তাহ", "cases/ward/week")}</li>)}
    </ul>
  );
}

/** Compact, scrollable hotline strip. No auto-scroll; buttons move one card; reduced motion respected. */
export function HotlineStrip() {
  const ref = useRef(null);
  const move = (dir) => {
    const el = ref.current;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * (el.firstElementChild?.getBoundingClientRect().width + 12 || 240), behavior: smooth ? "smooth" : "auto" });
  };
  return (
    <section className="card hotlines" id="hotlines" aria-labelledby="hotlines-h">
      <div className="hl-head">
        <h2 id="hotlines-h">{tx("স্বাস্থ্য ও জরুরি হটলাইন", "Health and emergency hotlines")}</h2>
        <div className="hl-btns">
          <button className="btn sq" onClick={() => move(-1)} aria-label={tx("আগের কার্ড", "Previous card")}>‹</button>
          <button className="btn sq" onClick={() => move(1)} aria-label={tx("পরের কার্ড", "Next card")}>›</button>
        </div>
      </div>
      <ul className="hl-strip" ref={ref} tabIndex={0} aria-label={tx("হটলাইন তালিকা, স্ক্রল করা যায়", "Hotline list, scrollable")}>
        {hotlines().map((h) => (
          <li key={h.id} className="hl-card">
            <strong>{h.name}</strong>
            {h.tel
              ? <a className="hl-num" href={`tel:${h.tel}`} aria-label={`${tx("কল করুন", "Call")} ${h.number}`}>{bnDigits(h.number)}</a>
              : <a className="hl-num web" href={h.href} target="_blank" rel="noreferrer">{h.number}</a>}
            <span>{h.use}</span>
            <small>{tx("সূত্র", "Source")}: <a href={h.src} target="_blank" rel="noreferrer">{h.srcName}</a></small>
          </li>
        ))}
      </ul>
      <p className="muted small">{tx("এই সাইট সরকারি নয়; নম্বর ব্যবহারের আগে উৎসে যাচাই করুন।", "This site is not a government service; confirm numbers at the source before relying on them.")}</p>
    </section>
  );
}

export { cityLabel, fmtDate, weekOf };
