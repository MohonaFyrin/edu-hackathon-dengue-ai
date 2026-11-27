// Citizen field reports (waterlogging, open garbage, broken sewer) and the officer review list.
// No name or phone number is collected. Photos are re-encoded in the browser, which removes location metadata.
import { useRef, useState } from "react";
import { Camera, CircleCheck, Droplets, Images, LocateFixed, Trash2, Waves, WifiOff, X } from "lucide-react";
import { apiFresh, apiPost } from "./api.js";
import { Card, Loading, useAsync } from "./components.jsx";
import { bn, cityLabel, tx, wardFull } from "./i18n.js";

export const CATEGORIES = [
  ["waterlogging", "জমা পানি", "Standing water", Droplets],
  ["garbage", "খোলা আবর্জনা", "Open garbage", Trash2],
  ["sewer", "ভাঙা নর্দমা", "Broken sewer", Waves],
];
const catLabel = (k) => { const c = CATEGORIES.find((x) => x[0] === k); return c ? tx(c[1], c[2]) : k; };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Downscale and re-encode to JPEG (max 1280 px). Drops EXIF, including GPS. */
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("image")); i.src = url; });
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } finally { URL.revokeObjectURL(url); }
}

export function ReportView({ meta, sel, net }) {
  const [cat, setCat] = useState("");
  const [ward, setWard] = useState(sel.ward || meta.wards[0].ward_id);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [loc, setLoc] = useState(null);
  const [msg, setMsg] = useState(null);       // {kind: "error" | "info", text}
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const clientId = useRef(newId());
  const camRef = useRef(null), galRef = useRef(null);

  const pickPhoto = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { setMsg({ kind: "error", text: tx("শুধু ছবি যোগ করা যায়।", "Only pictures can be attached.") }); return; }
    try { setPhoto(await shrink(f)); setMsg(null); } catch { setMsg({ kind: "error", text: tx("ছবিটি পড়া যায়নি। অন্য ছবি বেছে নিন।", "That picture could not be read. Choose another.") }); }
  };
  const locate = () => {
    if (!navigator.geolocation) { setMsg({ kind: "info", text: tx("এই ফোনে অবস্থান পাওয়া যায় না। ওয়ার্ড বেছে নিলেই হবে।", "Location is not available on this device. Choosing the ward is enough.") }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setLoc({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5) }); setMsg(null); },
      () => setMsg({ kind: "info", text: tx("অবস্থানের অনুমতি পাওয়া যায়নি। ওয়ার্ড বেছে নিলেই হবে।", "Location permission was not given. Choosing the ward is enough.") }),
      { timeout: 8000, maximumAge: 60000 });
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!cat) { setMsg({ kind: "error", text: tx("সমস্যার ধরন বেছে নিন।", "Choose the type of problem.") }); return; }
    setBusy(true); setMsg(null);
    try {
      const inBD = loc && loc.lat >= 20 && loc.lat <= 27 && loc.lon >= 88 && loc.lon <= 93;
      const r = await apiPost("reports", { client_id: clientId.current, category: cat, ward_id: ward, note: note.trim(), photo, ...(inBD ? loc : {}) });
      setDone(r.report);
    } catch (err) {
      setMsg({ kind: "error", text: `${tx("জমা হয়নি। আবার চেষ্টা করুন।", "Not saved. Please try again.")} (${err.message})` });
    } finally { setBusy(false); }
  };
  const again = () => { clientId.current = newId(); setDone(null); setCat(""); setNote(""); setPhoto(null); setLoc(null); setMsg(null); };

  if (done) {
    return (
      <Card title={tx("অভিযোগ জমা হয়েছে", "Report saved")} id="report-done" className="done">
        <p className="ok-line"><CircleCheck size={28} aria-hidden="true" /> {tx("ধন্যবাদ। আপনার অভিযোগ সংরক্ষিত হয়েছে।", "Thank you. Your report has been stored.")}</p>
        <dl className="facts">
          <div><dt>{tx("নম্বর", "Reference")}</dt><dd>{done.id.slice(0, 8)}</dd></div>
          <div><dt>{tx("ধরন", "Type")}</dt><dd>{catLabel(done.category)}</dd></div>
          <div><dt>{tx("এলাকা", "Area")}</dt><dd>{wardFull(done.ward_id, done.city)}</dd></div>
        </dl>
        <button className="btn primary" onClick={again}>{tx("আরেকটি অভিযোগ", "Report another")}</button>
      </Card>
    );
  }
  return (
    <form className="card report" onSubmit={submit} noValidate>
      <h2>{tx("এলাকার সমস্যা জানান", "Report a problem in your area")}</h2>
      <p className="muted">{tx("নাম বা ফোন নম্বর লাগে না।", "No name or phone number is needed.")}</p>
      {!net.service && (
        <p className="notice warn" role="status"><WifiOff size={18} aria-hidden="true" /> {tx("সংযোগ নেই। সংযোগ ফিরলে অভিযোগ জমা দেওয়া যাবে।", "No connection. You can send a report when the connection returns.")}</p>
      )}
      <fieldset className="cats">
        <legend>{tx("কী সমস্যা?", "What is the problem?")}</legend>
        {CATEGORIES.map(([k, b, e, Icon]) => (
          <label key={k} className={cat === k ? "on" : ""}>
            <input type="radio" name="cat" checked={cat === k} onChange={() => setCat(k)} />
            <Icon size={32} aria-hidden="true" /><span>{tx(b, e)}</span>
          </label>
        ))}
      </fieldset>
      <label className="field"><span>{tx("কোন ওয়ার্ড?", "Which ward?")}</span>
        <select value={ward} onChange={(e) => setWard(e.target.value)}>
          {meta.wards.map((w) => <option key={w.ward_id} value={w.ward_id}>{wardFull(w.ward_id, w.city)}</option>)}
        </select>
      </label>
      <div className="row">
        <button type="button" className="btn" onClick={locate}><LocateFixed size={18} aria-hidden="true" /> {loc ? tx("অবস্থান যোগ হয়েছে", "Location added") : tx("আমার অবস্থান যোগ করুন (ঐচ্ছিক)", "Add my location (optional)")}</button>
        {loc && <button type="button" className="btn ghost" onClick={() => setLoc(null)}><X size={18} aria-hidden="true" /> {tx("অবস্থান বাদ দিন", "Remove location")}</button>}
      </div>
      <fieldset className="photo">
        <legend>{tx("ছবি (ঐচ্ছিক)", "Photo (optional)")}</legend>
        {photo ? (
          <div className="preview">
            <img src={photo} alt={tx("যোগ করা ছবি", "Attached photo")} />
            <button type="button" className="btn ghost" onClick={() => setPhoto(null)}><X size={18} aria-hidden="true" /> {tx("ছবি বাদ দিন", "Remove photo")}</button>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="btn" onClick={() => camRef.current.click()}><Camera size={18} aria-hidden="true" /> {tx("ছবি তুলুন", "Take a photo")}</button>
            <button type="button" className="btn" onClick={() => galRef.current.click()}><Images size={18} aria-hidden="true" /> {tx("গ্যালারি থেকে", "Choose from gallery")}</button>
          </div>
        )}
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
        <input ref={galRef} type="file" accept="image/jpeg,image/png" hidden onChange={pickPhoto} />
      </fieldset>
      <label className="field"><span>{tx("কিছু লিখতে চান? (ঐচ্ছিক)", "Anything to add? (optional)")}</span>
        <textarea value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} />
      </label>
      {msg && <p className={`notice ${msg.kind === "error" ? "err" : ""}`} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</p>}
      <button className="btn primary big" type="submit" disabled={busy || !net.service}>{busy ? tx("জমা হচ্ছে…", "Saving…") : tx("অভিযোগ জমা দিন", "Send report")}</button>
    </form>
  );
}

const STATUS = { new: ["নতুন", "New"], reviewed: ["দেখা হয়েছে", "Reviewed"], resolved: ["সমাধান হয়েছে", "Resolved"] };

export function ReportsReview({ city }) {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(null);
  const r = useAsync(() => apiFresh("reports", { city }), [city, tick]);
  const setStatus = async (id, status) => { await apiPost(`reports/${id}/status`, { status }); setTick((t) => t + 1); };
  return (
    <Card title={tx("নাগরিক অভিযোগ", "Citizen reports")} id="reports">
      <p className="muted small">{city ? cityLabel(city) : tx("সব শহর", "All cities")} · {tx("নাম বা ফোন নম্বর সংগ্রহ করা হয় না। এই প্রদর্শনী সংস্করণে লগইন নেই; চালুর আগে প্রবেশাধিকার সীমিত করতে হবে।",
        "No names or phone numbers are collected. This demo has no login; access must be restricted before real use.")}</p>
      <Loading r={r}>{(d) => d.reports.length === 0
        ? <p className="muted">{tx("এখনও কোনো অভিযোগ নেই।", "No reports yet.")}</p>
        : (
          <>
            <p className="flag">{tx(`নতুন ${bn(d.counts.new)} · দেখা ${bn(d.counts.reviewed)} · সমাধান ${bn(d.counts.resolved)}`, `New ${d.counts.new} · Reviewed ${d.counts.reviewed} · Resolved ${d.counts.resolved}`)}</p>
            <ul className="rep-list">
              {d.reports.map((x) => (
                <li key={x.id}>
                  <div>
                    <strong>{catLabel(x.category)}</strong> · {wardFull(x.ward_id, x.city)}
                    <small>{new Date(x.created_at).toLocaleString(tx("bn-BD", "en-GB"))}{x.lat != null ? ` · ${x.lat}, ${x.lon}` : ""}</small>
                    {x.note && <p>{x.note}</p>}
                    {x.has_photo && (open === x.id
                      ? <img className="rep-photo" src={`/api/reports/${x.id}/photo`} alt={tx("অভিযোগের ছবি", "Report photo")} />
                      : <button className="link" onClick={() => setOpen(x.id)}>{tx("ছবি দেখুন", "View photo")}</button>)}
                  </div>
                  <label className="field compact"><span className="sr-only">{tx("অবস্থা", "Status")}</span>
                    <select value={x.status} onChange={(e) => setStatus(x.id, e.target.value)}>
                      {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{tx(...v)}</option>)}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}</Loading>
    </Card>
  );
}
