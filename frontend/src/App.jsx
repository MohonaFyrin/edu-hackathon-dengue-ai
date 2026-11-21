import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Loading, useAsync } from "./components.jsx";
import { dataBanner, edu, setLang, tx } from "./i18n.js";
import { HospitalView, ModelView, OfficerView, PublicView } from "./views.jsx";

// Opening week: a 2025 monsoon-season week (inside the held-out test period). The latest data week is dry-season.
const DEMO_ISSUE = "2025-08-04";
const VIEWS = ["public", "officer", "hospital", "model"];
const readRole = () => {
  const h = window.location.hash.slice(1);
  return VIEWS.includes(h) ? h : "public"; // the site always opens on the Public view
};

function useRole() {
  const [role, setRole] = useState(readRole);
  useEffect(() => {
    const on = () => setRole(readRole());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [role, (r) => { window.location.hash = r; }];
}

function Shell({ meta, lang, onLang }) {
  const [role, goRole] = useRole();
  const firstWard = (city) => meta.wards.find((w) => !city || w.city === city)?.ward_id || "";
  const [sel, setSel] = useState({ city: "Dhaka North", ward: firstWard("Dhaka North"), issue: meta.issueDates.includes(DEMO_ISSUE) ? DEMO_ISSUE : meta.latest, h: 2 });
  const set = {
    city: (city) => setSel((s) => ({ ...s, city, ward: city && s.ward && meta.wards.find((w) => w.ward_id === s.ward)?.city !== city ? firstWard(city) : s.ward })),
    ward: (ward) => setSel((s) => ({ ...s, ward })),
    issue: (issue) => setSel((s) => ({ ...s, issue })),
    h: (h) => setSel((s) => ({ ...s, h })),
    pick: (ward, city) => setSel((s) => ({ ...s, ward, city: s.city ? city : "" })),
  };
  // Keep selections valid when moving between views.
  useEffect(() => {
    setSel((s) => {
      let { city, ward } = s;
      if (role !== "officer" && !city) city = meta.wards.find((w) => w.ward_id === ward)?.city || "Dhaka North";
      if (role !== "hospital" && !ward) ward = firstWard(city);
      return city === s.city && ward === s.ward ? s : { ...s, city, ward };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const ROLES = [["public", tx("জনসাধারণ", "Public")], ["officer", tx("সরকারি কর্মকর্তা", "Government Officer")], ["hospital", tx("হাসপাতাল", "Hospital")]];
  const props = { meta, sel, set };
  return (
    <>
      <a className="skip" href="#main">{tx("মূল অংশে যান", "Skip to content")}</a>
      <header className="top">
        <div className="wrap head">
          <div className="brand">
            <span className="mark" aria-hidden="true">🦟</span>
            <div>
              <h1>{tx("ডেঙ্গু আগাম সতর্কতা", "Dengue Early Warning")}</h1>
              <p className="sub">{tx("ওয়ার্ডভিত্তিক সাপ্তাহিক পূর্বাভাস · প্রোটোটাইপ", "Ward-level weekly forecasts · prototype")}</p>
            </div>
          </div>
          <div className="tools">
            <div className="lang" role="group" aria-label={tx("ভাষা", "Language")}>
              <button className={lang === "bn" ? "on" : ""} aria-pressed={lang === "bn"} lang="bn" onClick={() => onLang("bn")}>বাংলা</button>
              <button className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} lang="en" onClick={() => onLang("en")}>English</button>
            </div>
            <nav aria-label={tx("ভূমিকা নির্বাচন", "Choose view")} className="roles">
              {ROLES.map(([k, label]) => (
                <button key={k} className={role === k ? "on" : ""} aria-current={role === k ? "page" : undefined} onClick={() => goRole(k)}>{label}</button>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <div className="banner"><p className="wrap">{dataBanner()}</p></div>
      <main id="main" className="wrap" tabIndex={-1}>
        {role === "public" && <PublicView {...props} />}
        {role === "officer" && <OfficerView {...props} />}
        {role === "hospital" && <HospitalView {...props} />}
        {role === "model" && <ModelView />}
      </main>
      <footer className="foot">
        <div className="wrap">
          <p>{tx("ভূমিকা-ভিউ শুধু প্রদর্শনের জন্য; লগইন বা ব্যক্তিগত তথ্য নেই। ডেটা: হ্যাকাথনের অফিসিয়াল ডেটাসেট (২০১৬–২০২৫), উৎস ও সংগ্রহ-পদ্ধতি অজানা। এটি সরকারি অনুমোদিত সাইট নয়।",
            "Role views are for demonstration; no login or personal data. Data: the hackathon's official dataset (2016–2025); source and collection methods unspecified. This is not an officially endorsed government site.")}</p>
          <p>{tx("সূত্র", "Sources")}: {edu().sources.map(([t, u], i) => <span key={u}>{i ? " · " : ""}<a href={u} target="_blank" rel="noreferrer">{t}</a></span>)}
            {" · "}<a href="#model">{tx("মডেল পারফরম্যান্স", "Model performance")}</a></p>
        </div>
      </footer>
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
