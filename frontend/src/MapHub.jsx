// Map Hub: real district outlines (geoBoundaries) + the team's WardMap tiles with operational overlays
// + nearby health facilities (OpenStreetMap). Ward positions are schematic: no verified ward boundaries exist.
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BedDouble, Navigation, Phone, SprayCan, TriangleAlert } from "lucide-react";
import { api } from "./api.js";
import { Card, Loading, useAsync } from "./components.jsx";
import { bn, cityLabel, fmtDate, getLang, tx, wardLabel } from "./i18n.js";
import { usePlan } from "./ops.jsx";
import { WardMap } from "./WardMap.jsx";

// Same city-corporation centres WardMap uses (official admin file): [lat, lon].
const CENTRE = {
  Gazipur: [23.9999, 90.4203], "Dhaka North": [23.8103, 90.4125], "Dhaka South": [23.7104, 90.4074],
  Narayanganj: [23.6238, 90.5], Chattogram: [22.3569, 91.7832],
};
const TIER_DOT = { Low: "#2e7d4f", Medium: "#b98900", High: "#c2571f", Critical: "#b42318" };
const TIER_RANK = ["Low", "Medium", "High", "Critical"];
const TYPES = [["hospital", "হাসপাতাল", "Hospitals"], ["clinic", "ক্লিনিক", "Clinics"], ["pharmacy", "ফার্মেসি", "Pharmacies"]];
const TYPE_ONE = { hospital: ["হাসপাতাল", "Hospital"], clinic: ["ক্লিনিক", "Clinic"], pharmacy: ["ফার্মেসি", "Pharmacy"] };
const LAYERS = [
  ["borders", "জেলার সীমানা", "District borders", "সবার জন্য", "Everyone"],
  ["supply", "সামগ্রীর ঘাটতি", "Supply shortage", "কর্মকর্তা ও কমিশনার", "Officers and commissioners"],
  ["crews", "মশা নিধন দল", "Spraying crews", "মাঠ কর্মকর্তা", "Field officers"],
  ["beds", "বেড স্থানান্তর", "Bed overflow", "হাসপাতাল পরিকল্পনা", "Hospital planners"],
  ["facilities", "কাছের স্বাস্থ্যসেবা", "Nearby healthcare", "নাগরিক", "Citizens"],
];

const W = 640, H = 420;

function project(view) {
  const [lon0, lon1, lat0, lat1] = view;
  const k = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
  const sx = W / ((lon1 - lon0) * k), sy = H / (lat1 - lat0), s = Math.min(sx, sy);
  const ox = (W - (lon1 - lon0) * k * s) / 2, oy = (H - (lat1 - lat0) * s) / 2;
  return (lon, lat) => [ox + (lon - lon0) * k * s, oy + (lat1 - lat) * s];
}

function DistrictMap({ geo, wardsByCity, city, onCity, showBorders, facilities }) {
  // Whole study area, or one of two metro frames: Dhaka region (Dhaka N/S, Gazipur, Narayanganj) or Chattogram.
  const view = useMemo(() => {
    if (city === "Chattogram") return [91.62, 91.98, 22.2, 22.52];
    if (city) return [90.18, 90.72, 23.52, 24.12];
    return [89.95, 92.45, 21.75, 24.4];
  }, [city]);
  const pt = project(view);
  const path = (ring) => ring.map(([lon, lat], i) => { const [x, y] = pt(lon, lat); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join("") + "Z";
  const worst = (c) => TIER_RANK[Math.max(0, ...(wardsByCity[c] || []).map((w) => TIER_RANK.indexOf(w.risk_tier)))];
  return (
    <figure className="dmap">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={tx("জেলার সীমানা ও শহরের অবস্থান", "District borders and city positions")}>
        <rect width={W} height={H} className="dmap-sea" />
        {showBorders && geo.districts.map((d) => d.rings.map((r, i) => <path key={`${d.district}${i}`} d={path(r)} className="dmap-land" />))}
        {showBorders && geo.districts.map((d) => {
          const r = d.rings[0]; const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cy = r.reduce((s, p) => s + p[1], 0) / r.length;
          const [x, y] = pt(cx, cy);
          if (x < 0 || x > W || y < 0 || y > H) return null;
          const name = d.district === "Dhaka" ? tx("ঢাকা", "Dhaka") : cityLabel(d.district);
          return <text key={d.district} x={x} y={y + 34} textAnchor="middle" className="dmap-name">{tx(`${name} জেলা`, `${name} district`)}</text>;
        })}
        {facilities?.map((f) => {
          const [x, y] = pt(f.lon, f.lat);
          if (x < 0 || x > W || y < 0 || y > H) return null;
          return f.type === "hospital" ? <circle key={f.id} cx={x} cy={y} r="4" className="fac hospital" />
            : f.type === "clinic" ? <rect key={f.id} x={x - 3.5} y={y - 3.5} width="7" height="7" className="fac clinic" />
              : <path key={f.id} d={`M${x},${y - 4}L${x + 4},${y}L${x},${y + 4}L${x - 4},${y}Z`} className="fac pharmacy" />;
        })}
        {Object.entries(CENTRE).map(([c, [lat, lon]]) => {
          const [x, y] = pt(lon, lat);
          if (x < 0 || x > W || y < 0 || y > H) return null;
          const on = c === city, left = c === "Dhaka South" || c === "Gazipur";
          return (
            <g key={c} className={`dmap-city${on ? " on" : ""}`} role="button" tabIndex={0} aria-pressed={on}
              aria-label={`${cityLabel(c)}: ${tx("সর্বোচ্চ স্তর", "highest tier")} ${worst(c)}`}
              onClick={() => onCity(on ? "" : c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCity(on ? "" : c); } }}>
              <circle cx={x} cy={y} r="22" className="hit" />
              <circle cx={x} cy={y} r={on ? 10 : 8} fill={TIER_DOT[worst(c)]} />
              <text x={left ? x - 14 : x + 14} y={y + 5} textAnchor={left ? "end" : "start"}>{cityLabel(c)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        {tx("জেলার সীমানা আসল (geoBoundaries, BBS/OCHA)। ওয়ার্ডের সীমানার যাচাইকৃত তথ্য নেই, তাই ওয়ার্ড নিচে ছকে দেখানো হয়েছে।",
          "District borders are real (geoBoundaries, BBS/OCHA). No verified ward boundaries exist, so wards are shown as a grid below.")}
        {" "}{tx("বিন্দুর রং: শহরের সর্বোচ্চ ঝুঁকির স্তর।", "Dot colour: the city's highest risk tier.")}
      </figcaption>
    </figure>
  );
}

function Facilities({ city, net, onData }) {
  const [type, setType] = useState("hospital");
  const [more, setMore] = useState(false);
  const r = useAsync(async () => { const d = await api("facilities", { city, type, limit: 300 }); onData?.(d.facilities); return d; }, [city, type]);
  const lang = getLang();
  return (
    <Card title={`${tx("কাছের স্বাস্থ্যসেবা", "Nearby healthcare")}: ${cityLabel(city)}`} id="fac">
      <div className="seg" role="group" aria-label={tx("ধরন", "Type")}>
        {TYPES.map(([k, b, e]) => (
          <label key={k} className={type === k ? "on" : ""}>
            <input type="radio" name="factype" checked={type === k} onChange={() => { setType(k); setMore(false); }} /><span>{tx(b, e)}</span>
          </label>
        ))}
      </div>
      <Loading r={r}>{(d) => {
        if (!d.available) return <p className="notice">{tx("স্বাস্থ্যসেবার তালিকা ইনস্টল করা নেই।", "The facility list is not installed.")}</p>;
        if (d.total === 0) return <p className="muted">{tx("এই শহরের জন্য এই ধরনের কোনো তথ্য নেই।", "No records of this type for this city.")}</p>;
        const rows = more ? d.facilities : d.facilities.slice(0, 12);
        return (
          <>
            <p className="muted small">{tx(`শহরের কেন্দ্র থেকে ৭ কিমির মধ্যে ${bn(d.total)}টি। উৎস: OpenStreetMap (স্বেচ্ছাসেবীদের তথ্য, আমরা যাচাই করিনি)। বেডের তথ্য নেই।`,
              `${bn(d.total)} within 7 km of the city centre. Source: OpenStreetMap (volunteer-mapped, not verified by us). No bed data.`)}</p>
            <ul className="fac-list">
              {rows.map((f) => (
                <li key={f.id}>
                  <div>
                    <strong lang={lang === "bn" && f.name_bn ? "bn" : "en"}>{(lang === "bn" && f.name_bn) || f.name_en || f.name_bn}</strong>
                    <small>{tx(...TYPE_ONE[f.type])} · {tx(`কেন্দ্র থেকে ${bn(f.km_from_centre, 1)} কিমি`, `${bn(f.km_from_centre, 1)} km from centre`)}{f.address ? ` · ${f.address}` : ""}</small>
                  </div>
                  <div className="fac-act">
                    {f.phone && <a className="btn small" href={`tel:${f.phone.replace(/[^+\d]/g, "")}`}><Phone size={16} aria-hidden="true" /> {tx("কল", "Call")}</a>}
                    {net.internet && <a className="btn small ghost" target="_blank" rel="noreferrer"
                      href={`https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lon}#map=17/${f.lat}/${f.lon}`}><Navigation size={16} aria-hidden="true" /> {tx("মানচিত্র", "Map")}</a>}
                  </div>
                </li>
              ))}
            </ul>
            {d.facilities.length > 12 && <button className="btn ghost" onClick={() => setMore((m) => !m)}>{more ? tx("কম দেখান", "Show fewer") : tx(`আরও ${bn(d.facilities.length - 12)}টি দেখান`, `Show ${bn(d.facilities.length - 12)} more`)}</button>}
            {!net.internet && <p className="muted small">{tx("ইন্টারনেট নেই, তাই বাইরের মানচিত্রের লিংক লুকানো।", "No internet, so links to the outside map are hidden.")}</p>}
          </>
        );
      }}</Loading>
    </Card>
  );
}

export function MapHubView({ meta, sel, set, ops, net }) {
  const [layers, setLayers] = useState({ borders: true, supply: false, crews: false, beds: false, facilities: false });
  const [facPts, setFacPts] = useState([]);
  const geo = useAsync(() => api("geo/districts"), []);
  const plan = usePlan(sel, ops, null);
  const city = sel.city;
  const toggle = (k) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <>
      <div className="hub">
        <Card title={tx("মানচিত্র", "Map")} id="hubmap" className="hub-map">
          <div className="seg citypick" role="group" aria-label={tx("শহর বেছে নিন", "Choose a city")}>
            {["", ...meta.cities].map((c) => (
              <label key={c || "all"} className={city === c ? "on" : ""}>
                <input type="radio" name="hubcity" checked={city === c} onChange={() => set.city(c)} />
                <span>{c ? cityLabel(c) : tx("সব শহর", "All cities")}</span>
              </label>
            ))}
          </div>
          <p className="muted small">{tx("লক্ষ্য সপ্তাহ", "Target week")}: {plan.data ? fmtDate(plan.data.target_date) : "…"}
            {city && city !== "Chattogram" && <> · {tx("চট্টগ্রাম এই অংশের বাইরে (প্রায় ২৫০ কিমি দূরে); দেখতে ওপরে চট্টগ্রাম বেছে নিন।", "Chattogram is outside this frame (about 250 km away); choose it above.")}</>}</p>
          <Loading r={geo}>{(g) => (
            <Loading r={plan}>{(p) => {
              const byCity = {};
              p.wards.forEach((w) => { (byCity[w.city] ||= []).push(w); });
              return <DistrictMap geo={g} wardsByCity={byCity} city={city} onCity={set.city} showBorders={layers.borders}
                facilities={layers.facilities && city ? facPts : null} />;
            }}</Loading>
          )}</Loading>
        </Card>
        <fieldset className="card layers">
          <legend>{tx("স্তর", "Layers")}</legend>
          {LAYERS.map(([k, b, e, wb, we]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />
              <span>{tx(b, e)}<small>{tx(wb, we)}</small></span>
            </label>
          ))}
          <p className="muted small">{tx("ঝুঁকির স্তর ও অনুমানিত রোগী সব সময় দেখানো হয়।", "Risk tier and estimated cases are always shown.")}</p>
        </fieldset>
      </div>

      <Card title={tx("ওয়ার্ডভিত্তিক ঝুঁকি", "Risk by ward")} id="hubwards">
        <Loading r={plan}>{(p) => {
          const bedOf = {};
          p.overflow.cities.forEach((c) => c.wards.forEach((w) => { bedOf[w.ward_id] = w; }));
          const extra = (w) => {
            const b = bedOf[w.ward_id];
            const short = Object.values(w.deficit).reduce((s, v) => s + v, 0);
            return (
              <>
                {layers.supply && short > 0 && <span className="ov"><TriangleAlert size={14} aria-hidden="true" /> {tx("ঘাটতি", "short")} {bn(short)}</span>}
                {layers.crews && w.crews > 0 && <span className="ov"><SprayCan size={14} aria-hidden="true" /> {bn(w.crews)} {tx("দল", "crew")}</span>}
                {layers.beds && b?.transferred_out > 0 && <span className="ov"><BedDouble size={14} aria-hidden="true" /><ArrowRight size={14} aria-hidden="true" /> {bn(b.transferred_out)} {tx("পাঠাবে", "out")}</span>}
                {layers.beds && b?.transferred_in > 0 && <span className="ov"><BedDouble size={14} aria-hidden="true" /><ArrowLeft size={14} aria-hidden="true" /> {bn(b.transferred_in)} {tx("নেবে", "in")}</span>}
              </>
            );
          };
          const focus = p.overflow.cities.filter((c) => !city || c.city === city);
          const transfers = focus.flatMap((c) => c.transfers.map((t) => ({ ...t, city: c.city })));
          return (
            <>
              <WardMap meta={meta} wards={p.wards} activeCity={city} selectedWard={sel.ward} onPick={(w, c) => set.pick(w, c)} onCity={set.city} extra={extra} mini={false} />
              {layers.supply && (
                <p className={`flag ${p.alerts.length ? "on" : ""}`}>{tx(`মজুত ${bn(ops.stock_pct)}%: ${bn(p.alerts.length)}টি ওয়ার্ডে ঘাটতি।`, `Stock at ${bn(ops.stock_pct)}%: ${bn(p.alerts.length)} wards short.`)}</p>
              )}
              {layers.crews && (
                <p className={`flag ${p.crews.deficit ? "on" : ""}`}>{tx(`দল ${bn(p.crews.assigned)} / ${bn(p.crews.total_available)}; উচ্চ ঝুঁকির ${bn(p.crews.high_risk_wards_without_crew.length)}টি ওয়ার্ডে দল নেই।`,
                  `Crews ${bn(p.crews.assigned)} of ${bn(p.crews.total_available)}; ${bn(p.crews.high_risk_wards_without_crew.length)} high-risk wards have none.`)}</p>
              )}
              {layers.beds && (
                <div className="routes">
                  <h3>{tx("বেড স্থানান্তর (একই শহরের ভেতরে)", "Bed transfers (within the same city)")}</h3>
                  {transfers.length === 0 ? <p className="muted">{tx("এই সপ্তাহে কোনো স্থানান্তর দরকার নেই।", "No transfers needed this week.")}</p> : (
                    <ul>{transfers.map((t) => (
                      <li key={`${t.from_ward}${t.to_ward}`}>{cityLabel(t.city)}: {wardLabel(t.from_ward)} <ArrowRight size={16} aria-label={tx("থেকে", "to")} /> {wardLabel(t.to_ward)} · <strong>{bn(t.patients)}</strong> {tx("জন", "patients")}</li>
                    ))}</ul>
                  )}
                  <p className="muted small">{tx("ধারণক্ষমতা ধরে নেওয়া মান; দূরত্বের তথ্য নেই। পরিকল্পনার সুপারিশ মাত্র।", "Capacity is assumed; no distance data. Planning recommendation only.")}</p>
                </div>
              )}
            </>
          );
        }}</Loading>
      </Card>

      {layers.facilities && (city
        ? <Facilities city={city} net={net} onData={setFacPts} />
        : <p className="notice">{tx("কাছের স্বাস্থ্যসেবা দেখতে একটি শহর বেছে নিন।", "Choose a city to see nearby healthcare.")}</p>)}
    </>
  );
}
