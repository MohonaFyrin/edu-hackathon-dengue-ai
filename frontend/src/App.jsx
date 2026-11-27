import { useEffect, useState } from "react";
import { ClipboardList, Hospital, House, Map as MapIcon, Megaphone, Phone, ShieldPlus, WifiOff } from "lucide-react";
import { api } from "./api.js";
import { Loading, useAsync } from "./components.jsx";
import { bnDigits, dataBanner, edu, hotlines, setLang, tx } from "./i18n.js";
import { MapHubView } from "./MapHub.jsx";
import { useConnectivity } from "./net.js";
import { OPS_DEFAULTS } from "./ops.jsx";
import { ReportView } from "./Report.jsx";
import { HospitalView, ModelView, OfficerView, PublicView } from "./views.jsx";

// Opening week: a 2025 monsoon-season week (inside the held-out test period). The latest data week is dry-season.
const DEMO_ISSUE = "2025-08-04";
const VIEWS = ["public", "map", "report", "officer", "hospital", "model"];
const readRole = () => {
  const h = window.location.hash.slice(1);
  return VIEWS.includes(h) ? h : "public"; // the site always opens on the Public view
};

function useRole() {
  const [role, setRole] = useState(readRole);
  useEffect(() => {
    const on = () => { setRole(readRole()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [role, (r) => { window.location.hash = r; }];
}

/** Hotlines stay at the bottom of every view. Tap to call. */
function HotlineBar() {
  return (
    <aside className="hotbar" aria-label={tx("জরুরি হটলাইন", "Emergency hotlines")}>
      <div className="wrap">
        {hotlines().filter((h) => h.tel).map((h) => (
          <a key={h.id} href={`tel:${h.tel}`} aria-label={`${tx("কল করুন", "Call")} ${h.number}, ${h.name}`}>
            <Phone size={20} aria-hidden="true" />
            <span className="hot-num">{bnDigits(h.number)}</span>
            <span className="hot-name">{h.short}</span>
          </a>
        ))}
      </div>
    </aside>
  );
}

function Shell({ meta, lang, onLang }) {
  const [role, goRole] = useRole();
  const net = useConnectivity();
  const firstWard = (city) => meta.wards.find((w) => !city || w.city === city)?.ward_id || "";
  const [sel, setSel] = useState({ city: "Dhaka North", ward: firstWard("Dhaka North"), issue: meta.issueDates.includes(DEMO_ISSUE) ? DEMO_ISSUE : meta.latest, h: 2 });
  const [ops, setOps] = useState(OPS_DEFAULTS); // stock / crew / capacity settings, shared by every operational view
  const set = {
    city: (city) => setSel((s) => ({ ...s, city, ward: city && s.ward && meta.wards.find((w) => w.ward_id === s.ward)?.city !== city ? firstWard(city) : s.ward })),
    ward: (ward) => setSel((s) => ({ ...s, ward })),
    issue: (issue) => setSel((s) => ({ ...s, issue })),
    h: (h) => setSel((s) => ({ ...s, h })),
    pick: (ward, city) => setSel((s) => ({ ...s, ward, city: s.city ? city : "" })),
  };
  // Keep selections valid when moving between views: only Officer and Map can show all cities at once.
  useEffect(() => {
    setSel((s) => {
      let { city, ward } = s;
      if (role !== "officer" && role !== "map" && !city) city = meta.wards.find((w) => w.ward_id === ward)?.city || "Dhaka North";
      if (role !== "hospital" && !ward) ward = firstWard(city);
      return city === s.city && ward === s.ward ? s : { ...s, city, ward };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const NAV = [
    ["public", tx("জনসাধারণ", "Public"), House], ["map", tx("মানচিত্র", "Map"), MapIcon], ["report", tx("অভিযোগ", "Report"), Megaphone],
    ["officer", tx("সরকারি কর্মকর্তা", "Government Officer"), ClipboardList], ["hospital", tx("হাসপাতাল", "Hospital"), Hospital],
  ];
  const props = { meta, sel, set, ops, setOps, net };
  return (
    <>
      <a className="skip" href="#main">{tx("মূল অংশে যান", "Skip to content")}</a>
      <header className="top">
        <div className="wrap head">
          <a className="brand" href="#public">
            <span className="mark" aria-hidden="true"><ShieldPlus size={26} /></span>
            <span className="brand-text">
              <h1>{tx("ডেঙ্গু আগাম সতর্কতা", "Dengue Early Warning")}</h1>
              <small>{tx("ওয়ার্ডভিত্তিক পূর্বাভাস ও সাড়া", "Ward forecasts and response")}</small>
            </span>
          </a>
          <div className="tools">
            {net.checked && !net.service && (
              <span className="net off" role="status"><WifiOff size={16} aria-hidden="true" /> {tx("সার্ভারে সংযোগ নেই", "Service unreachable")}</span>
            )}
            {net.checked && net.service && !net.internet && (
              <span className="net" role="status"><WifiOff size={16} aria-hidden="true" /> {tx("অফলাইন: সব হিসাব এই কম্পিউটারে চলছে", "Offline: all calculations run on this computer")}</span>
            )}
            <div className="lang" role="group" aria-label={tx("ভাষা", "Language")}>
              <button className={lang === "bn" ? "on" : ""} aria-pressed={lang === "bn"} lang="bn" onClick={() => onLang("bn")}>বাংলা</button>
              <button className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} lang="en" onClick={() => onLang("en")}>English</button>
            </div>
          </div>
        </div>
        <nav aria-label={tx("প্রধান মেনু", "Main menu")} className="roles">
          <div className="wrap">
            {NAV.map(([k, label, Icon]) => (
              <button key={k} className={role === k ? "on" : ""} aria-current={role === k ? "page" : undefined} onClick={() => goRole(k)}>
                <Icon size={20} aria-hidden="true" /><span>{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </header>
      <div className="banner"><p className="wrap">{dataBanner()}</p></div>
      <main id="main" className={`wrap view-${role}`} tabIndex={-1}>
        {role === "public" && <PublicView {...props} />}
        {role === "map" && <MapHubView {...props} />}
        {role === "report" && <ReportView {...props} />}
        {role === "officer" && <OfficerView {...props} />}
        {role === "hospital" && <HospitalView {...props} />}
        {role === "model" && <ModelView />}
      </main>
      <footer className="foot">
        <div className="wrap">
          <p>{tx("ভূমিকা-ভিউ শুধু প্রদর্শনের জন্য; লগইন বা ব্যক্তিগত তথ্য নেই। ডেটা: হ্যাকাথনের অফিসিয়াল ডেটাসেট (২০১৬–২০২৫), উৎস ও সংগ্রহ-পদ্ধতি অজানা। এটি সরকারি অনুমোদিত সাইট নয়।",
            "Role views are for demonstration; no login or personal data. Data: the hackathon's official dataset (2016–2025); source and collection methods unspecified. This is not an officially endorsed government site.")}</p>
          <p>{tx("সূত্র", "Sources")}: {edu().sources.map(([t, u]) => <span key={u}><a href={u} target="_blank" rel="noreferrer">{t}</a>, </span>)}
            {hotlines().filter((h) => h.tel).map((h) => <span key={h.id}><a href={h.src} target="_blank" rel="noreferrer">{h.srcName}</a>, </span>)}
            <a href="#model">{tx("মডেল পারফরম্যান্স", "Model performance")}</a></p>
          <p>{tx("ছবি: এডিস ইজিপ্টাই মশা, James Gathany / CDC (পাবলিক ডোমেইন)। সীমানা: geoBoundaries (CC BY 3.0 IGO)। স্বাস্থ্যসেবা: © OpenStreetMap অবদানকারীরা (ODbL)।",
            "Photo: Aedes aegypti, James Gathany / CDC (public domain). Borders: geoBoundaries (CC BY 3.0 IGO). Facilities: © OpenStreetMap contributors (ODbL).")}</p>
        </div>
      </footer>
      <HotlineBar />
    </>
  );
}

export default function App() {
  const [lang, setLangState] = useState("bn"); // Bangla by default; switching keeps all selections
  setLang(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = tx("ডেঙ্গু আগাম সতর্কতা | ওয়ার্ডভিত্তিক পূর্বাভাস", "Dengue Early Warning | Ward-level forecasts");
  }, [lang]);
  const r = useAsync(async () => {
    const [w, i, m] = await Promise.all([api("wards"), api("issue-weeks"), api("metrics")]);
    return { cities: w.cities, wards: w.wards, issueDates: i.issue_dates, latest: i.latest, cuts: m.thresholds };
  }, []);
  return <Loading r={r}>{(meta) => <Shell meta={meta} lang={lang} onLang={setLangState} />}</Loading>;
}
