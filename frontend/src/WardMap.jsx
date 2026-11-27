import { TIER, bn, cityLabel, tierName, tx, wardLabel } from "./i18n.js";
import "./wardmap.css";

// Real city-corporation centres from the official admin file. Used only to place the city dots.
const CITY_XY = {
  "Gazipur": [23.9999, 90.4203],
  "Dhaka North": [23.8103, 90.4125],
  "Dhaka South": [23.7104, 90.4074],
  "Narayanganj": [23.6238, 90.5],
  "Chattogram": [22.3569, 91.7832],
};
const WORST = ["t-low", "t-medium", "t-high", "t-critical"];
const DOT = { "t-low": "#2e7d4f", "t-medium": "#c79a00", "t-high": "#d9622b", "t-critical": "#9b1c1c" };

// Converts longitude/latitude to a position on the small 300 x 260 picture.
const px = (lon) => 20 + ((lon - 90.3) / 1.6) * 260;
const py = (lat) => 20 + ((24.1 - lat) / 1.9) * 220;

function Tile({ w, selected, rank, onPick, extra }) {
  const t = TIER[w.risk_tier];
  return (
    <button
      type="button"
      className={`wm-tile ${t.cls}${selected ? " wm-sel" : ""}`}
      aria-pressed={selected}
      aria-label={`${wardLabel(w.ward_id)}: ${tierName(w.risk_tier)}, ${bn(w.predicted_cases, 1)} ${tx("জন", "cases")}`}
      onClick={() => onPick?.(w.ward_id, w.city)}
    >
      {rank && <span className="wm-rank" aria-hidden="true">{bn(rank)}</span>}
      <strong>{wardLabel(w.ward_id)}</strong>
      <span>{t.sym} {tierName(w.risk_tier)}</span>
      <span>{bn(w.predicted_cases, 1)} {tx("জন", "cases")}</span>
      {extra?.(w)}
    </button>
  );
}

// Phase 2 additions (optional, default off): `extra(w)` adds overlay lines inside a tile; `mini={false}` hides the
// city-dot picture when the Map Hub draws real district outlines instead.
export function WardMap({ meta, wards, activeCity = "", selectedWard = "", ranks = {}, onPick, onCity, extra, mini = true }) {
  const cityOf = Object.fromEntries(meta.wards.map((w) => [w.ward_id, w.city]));
  const list = wards.map((w) => ({ ...w, city: cityOf[w.ward_id] || w.city }));
  const cities = meta.cities.filter((c) => list.some((w) => w.city === c));
  const worstOf = (c) => {
    let best = 0;
    list.filter((w) => w.city === c).forEach((w) => { best = Math.max(best, WORST.indexOf(TIER[w.risk_tier].cls)); });
    return WORST[best];
  };
  const groups = cities
    .filter((c) => !activeCity || c === activeCity)
    .map((c) => ({
      c,
      items: list.filter((w) => w.city === c).sort((a, b) => a.ward_id.localeCompare(b.ward_id)),
    }));

  return (
    <div className={mini ? "wm-wrap" : "wm-wrap wm-solo"}>
      {mini && <figure className="wm-mini">
        <svg viewBox="0 0 300 260" className="wm-svg" role="group" aria-label={tx("শহরের অবস্থান", "City positions")}>
          {cities.map((c) => {
            const [lat, lon] = CITY_XY[c];
            const x = px(lon);
            const y = py(lat);
            const on = c === activeCity;
            return (
              <g
                key={c}
                className={`wm-city${on ? " on" : ""}`}
                role={onCity ? "button" : undefined}
                tabIndex={onCity ? 0 : undefined}
                aria-label={cityLabel(c)}
                aria-pressed={onCity ? on : undefined}
                onClick={() => onCity?.(c)}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && onCity) onCity(c); }}
              >
                <circle cx={x} cy={y} r={on ? 9 : 7} fill={DOT[worstOf(c)]} />
                <text x={x + 11} y={y + 4}>{cityLabel(c)}</text>
              </g>
            );
          })}
        </svg>
        <figcaption className="wm-note">
          {tx("বিন্দুর রং: ওই শহরের সবচেয়ে উচ্চ ঝুঁকির স্তর।", "Dot colour: highest risk tier in that city.")}
        </figcaption>
      </figure>

      <div className="wm-cities">
        {groups.map(({ c, items }) => (
          <section key={c} className="wm-block" aria-label={cityLabel(c)}>
            <h3>{cityLabel(c)} <small>({bn(items.length)} {tx("ওয়ার্ড", "wards")})</small></h3>
            <ul className="wm-grid">
              {items.map((w) => (
                <li key={w.ward_id}>
                  <Tile
                    w={w}
                    selected={w.ward_id === selectedWard}
                    rank={ranks[w.ward_id]}
                    onPick={onPick}
                    extra={extra}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}