// Local Bangla/English dictionaries and formatters. No external translation service.
// The language is a module-level value set by <App> before each render, so every
// helper below returns text for the current language.
let LANG = "bn";
export const setLang = (l) => { LANG = l; };
export const getLang = () => LANG;
export const tx = (b, e) => (LANG === "bn" ? b : e);

const nfs = { bn: [0, 1, 2].map((d) => new Intl.NumberFormat("bn-BD", { minimumFractionDigits: d, maximumFractionDigits: d })),
  en: [0, 1, 2].map((d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })) };
export const bn = (v, d = 0) => (v == null || Number.isNaN(v) ? "—" : nfs[LANG][d].format(v));
const DIGITS = "০১২৩৪৫৬৭৮৯";
export const bnDigits = (s) => (LANG === "bn" ? String(s).replace(/\d/g, (x) => DIGITS[x]) : String(s));

const dfs = (o) => ({ bn: new Intl.DateTimeFormat("bn-BD", { ...o, timeZone: "UTC" }), en: new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }) });
const DAY = dfs({ day: "numeric", month: "long", year: "numeric" });
const SHORT = dfs({ day: "numeric", month: "short" });
const MONTH = dfs({ month: "short", year: "2-digit" });
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
export const fmtDate = (iso) => DAY[LANG].format(toDate(iso));
export const fmtShort = (iso) => SHORT[LANG].format(toDate(iso));
export const fmtMonth = (iso) => MONTH[LANG].format(toDate(iso));
export const weekOf = (iso) => tx(`${fmtDate(iso)} থেকে শুরু সপ্তাহ`, `week starting ${fmtDate(iso)}`);

const CITY = {
  Chattogram: ["চট্টগ্রাম", "Chattogram"], "Dhaka North": ["ঢাকা উত্তর", "Dhaka North"], "Dhaka South": ["ঢাকা দক্ষিণ", "Dhaka South"],
  Gazipur: ["গাজীপুর", "Gazipur"], Narayanganj: ["নারায়ণগঞ্জ", "Narayanganj"],
};
export const cityLabel = (c) => (CITY[c] ? tx(...CITY[c]) : c);
export const wardLabel = (id) => `${tx("ওয়ার্ড", "Ward")} ${bnDigits(id.split("_").pop())}`;
export const wardFull = (id, city) => `${wardLabel(id)}, ${cityLabel(city)}`;

export const TIER = {
  Low: { sym: "●", cls: "t-low", n: ["নিম্ন", "Low"] },
  Medium: { sym: "▲", cls: "t-medium", n: ["মাঝারি", "Medium"] },
  High: { sym: "◆", cls: "t-high", n: ["উচ্চ", "High"] },
  Critical: { sym: "■", cls: "t-critical", n: ["অতি উচ্চ", "Critical"] },
};
export const tierName = (t) => tx(...TIER[t].n);
export const TIERS = ["Low", "Medium", "High", "Critical"];

export function tierRanges(cuts) {
  const [a, b, c] = cuts;
  return {
    Low: a === 0 ? bn(0) : `${bn(0)}–${bn(a)}`,
    Medium: `${bn(a + 1)}–${bn(b)}`,
    High: `${bn(b + 1)}–${bn(c)}`,
    Critical: tx(`${bn(c + 1)} বা বেশি`, `${bn(c + 1)} or more`),
  };
}

export const modeNote = (m) => (m === "in_sample"
  ? tx("প্রশিক্ষণ-সময়কালের সপ্তাহ: শুধু প্রদর্শনের জন্য, মডেল এই সময়ের তথ্য শিখেছে।", "Training-period week: for demonstration only; the model has seen this period.")
  : tx("পরীক্ষা-সময়কাল (২০২৪ থেকে): মডেল এই সময়ের তথ্য আগে দেখেনি।", "Held-out test period (2024 onward): the model has not seen this period."));

export const tierPublic = (t) => ({
  Low: tx("ঐতিহাসিক তুলনায় রোগী কম হওয়ার সম্ভাবনা।", "Fewer cases than usual are likely."),
  Medium: tx("রোগীর সংখ্যা মাঝারি হতে পারে।", "A moderate number of cases is likely."),
  High: tx("ঐতিহাসিক তুলনায় রোগী বেশি হতে পারে।", "More cases than usual are possible."),
  Critical: tx("ঐতিহাসিক তুলনায় রোগী অনেক বেশি হতে পারে।", "Many more cases than usual are possible."),
}[t]);

export const horizonCopy = (role) => {
  const pub = { label: tx("কোন সপ্তাহের পূর্বাভাস দেখতে চান?", "Which week's forecast do you want to see?"),
    opts: { 2: tx("২ সপ্তাহ পরে", "In 2 weeks"), 3: tx("৩ সপ্তাহ পরে", "In 3 weeks"), 4: tx("৪ সপ্তাহ পরে", "In 4 weeks") } };
  if (role === "officer") return { label: tx("আগাম পরিকল্পনার সময়সীমা", "Planning horizon"),
    opts: { 2: tx("২ সপ্তাহ", "2 weeks"), 3: tx("৩ সপ্তাহ", "3 weeks"), 4: tx("৪ সপ্তাহ", "4 weeks") } };
  if (role === "hospital") return { ...pub, label: tx("কোন সময়ের জন্য প্রস্তুতি নিতে চান?", "Which period are you preparing for?") };
  return pub;
};

/** Short, role-specific "what to do" bullets linked to the selected horizon and risk tier. */
export function actions(role, h, tier) {
  const hi = tier === "High" || tier === "Critical";
  if (role === "officer") {
    return {
      heading: tx("অগ্রাধিকারমূলক করণীয়", "Priority actions"),
      bullets: [
        { t: { 2: tx("২ সপ্তাহ: উচ্চ ও অতি উচ্চ স্তরের ওয়ার্ডে দ্রুত মাঠ-যাচাই করুন।", "2 weeks: field-check High and Critical wards promptly."),
          3: tx("৩ সপ্তাহ: মাঠ-যাচাইয়ের পর মশক-নিয়ন্ত্রণ পরিকল্পনা চূড়ান্ত করুন।", "3 weeks: finalise mosquito-control plans after field checks."),
          4: tx("৪ সপ্তাহ: আগাম প্রস্তুতি ও সমন্বয় পর্যালোচনা করুন; নতুন সপ্তাহে আবার দেখুন।", "4 weeks: review early preparation and coordination; re-check as new weeks arrive.") }[h] },
        { t: tx("জমা পানি, নালা-নর্দমা ও আবর্জনায় সম্ভাব্য প্রজননস্থল এবং স্যানিটেশন ও নিষ্কাশন-ঝুঁকি যাচাই করুন।", "Check stagnant water, drains and waste for breeding sites, and review sanitation and drainage risks.") },
        { emph: true, t: hi
          ? tx("এই স্তরে মাঠ-যাচাইয়ে নিশ্চিত প্রজননস্থলে সময়মতো লার্ভিসাইড প্রয়োগ বিবেচনা করুন, স্থানীয় জনস্বাস্থ্য পদ্ধতি ও অনুমোদিত নির্দেশনা অনুযায়ী।", "At this tier, consider timely larvicide at field-confirmed breeding sites, following local public-health procedures and approved guidance.")
          : tx("লার্ভিসাইড-সিদ্ধান্ত হবে মাঠ-যাচাই ও অনুমোদিত নির্দেশনার ভিত্তিতে; নিম্ন বা মাঝারি স্তরে নিয়মিত পর্যবেক্ষণ চালান।", "Larvicide decisions rest on field assessment and approved guidance; keep routine monitoring at Low or Medium.") },
      ],
      note: tx("মডেলের স্তর একা প্রয়োগের নির্দেশ নয়; নির্বিচারে লার্ভিসাইড প্রয়োগ নয়। বৃষ্টির প্রভাব সাধারণত ২–৪ সপ্তাহ পরে রোগীর সংখ্যায় দেখা যায়।",
        "The model tier alone is not an instruction to apply anything, and larvicide must not be applied indiscriminately. Rainfall effects usually show in cases 2–4 weeks later."),
    };
  }
  if (role === "hospital") {
    return {
      heading: tx("প্রস্তুতির জন্য করণীয়", "Preparedness"),
      bullets: [
        { t: { 2: tx("২ সপ্তাহ: কর্মী-রোস্টার ও জরুরি বিভাগের সাধারণ প্রস্তুতি পর্যালোচনা করুন।", "2 weeks: review staff rosters and general emergency readiness."),
          3: tx("৩ সপ্তাহ: ডেঙ্গুর চিকিৎসা-নির্দেশিকা ও বিপদচিহ্ন শনাক্তকরণ প্রক্রিয়া হালনাগাদ করুন।", "3 weeks: update dengue clinical guidance and warning-sign triage."),
          4: tx("৪ সপ্তাহ: পরীক্ষাগার-সামগ্রী ও সরবরাহের মজুত সাধারণভাবে যাচাই করুন।", "4 weeks: check laboratory and supply stocks in general terms.") }[h] },
        { t: hi ? tx("এলাকায় আপেক্ষিক রোগীর চাপ বেশি: রেফারেল ও সমন্বয়ের পথ দেখে রাখুন।", "Relative case burden is higher here: confirm referral and coordination routes.")
          : tx("আপেক্ষিক চাপ কম বা মাঝারি: নিয়মিত প্রস্তুতি বজায় রাখুন।", "Relative burden is low or moderate: maintain routine readiness.") },
        { t: tx("বেড-চাহিদা = অনুমানিত রোগী × ডেটাসেটের অনুপাত (প্রতি রোগীতে ০.২৯৮ বেড); ধারণক্ষমতা ধরে নেওয়া মান। এটি পরিকল্পনার সহায়ক, ভর্তির পূর্বাভাস নয়।",
          "Bed demand = estimated cases × the dataset's ratio (0.298 beds per case); capacity is an assumed value. A planning aid, not an admissions forecast.") },
      ],
    };
  }
  return {
    heading: tx("এখন কী করবেন?", "What should I do now?"),
    bullets: [
      { t: { 2: tx("২ সপ্তাহ পরের জন্য: ফুলের টব, বালতি, টায়ারে জমা পানি এখনই ফেলুন।", "For 2 weeks ahead: empty water from flower pots, buckets and tyres now."),
        3: tx("৩ সপ্তাহ পরের জন্য: প্রতিবেশীদের সঙ্গে নিয়মিত পরিষ্কারের সময় ঠিক করুন।", "For 3 weeks ahead: agree a regular clean-up routine with neighbours."),
        4: tx("৪ সপ্তাহ পরের জন্য: পরিষ্কারের অভ্যাস চালু রাখুন এবং পরে আবার দেখুন।", "For 4 weeks ahead: keep up the habit and check again later.") }[h] },
      { t: hi ? tx("পানির পাত্র ঢেকে রাখুন এবং লম্বা হাতার জামা পরুন।", "Cover water containers and wear long sleeves.")
        : tx("মশারি ও মশা-নিরোধক ব্যবহারের অভ্যাস বজায় রাখুন।", "Keep using mosquito nets and repellent.") },
      { t: tx("জ্বর হলে বা সতর্কতার লক্ষণ দেখা দিলে দ্রুত চিকিৎসকের কাছে যান।", "See a doctor quickly if you have fever or any warning sign.") },
    ],
  };
}

export const edu = () => ({
  what: { title: tx("ডেঙ্গু কী?", "What is dengue?"), items: [
    tx("ডেঙ্গু ভাইরাসজনিত জ্বর; সংক্রমিত এডিস মশার কামড়ে ছড়ায়।", "Dengue is a viral fever spread by the bite of an infected Aedes mosquito."),
    tx("এডিস মশা সাধারণত দিনে কামড়ায় এবং বাড়ির আশপাশের জমা পরিষ্কার পানিতে ডিম পাড়ে।", "Aedes mosquitoes usually bite in the daytime and lay eggs in clean standing water near homes."),
    tx("এটি সরাসরি মানুষ থেকে মানুষে ছড়ায় না।", "It does not spread directly from person to person."),
    tx("অনেকের উপসর্গ হালকা, কিন্তু কারও অবস্থা দ্রুত গুরুতর হতে পারে। সময়মতো চিকিৎসায় বেশিরভাগ সুস্থ হন।", "Many people have mild illness, but some become seriously ill quickly. Most recover with timely care."),
  ] },
  prevent: { title: tx("প্রতিরোধের উপায়", "How to prevent dengue"), items: [
    tx("সপ্তাহে অন্তত একবার ফুলের টব, ফ্রিজের ট্রে, বালতি, টায়ার ও ডাবের খোসায় জমা পানি ফেলুন।", "At least weekly, empty water from flower pots, fridge trays, buckets, tyres and coconut shells."),
    tx("পানির পাত্র ঢেকে রাখুন ও ধুয়ে পরিষ্কার করুন।", "Keep water containers covered and scrub them clean."),
    tx("দিনে-রাতে মশারি, জানালায় নেট ও প্রয়োজনে মশা-নিরোধক ব্যবহার করুন।", "Use nets, window screens and repellent, day and night."),
    tx("বাইরে গেলে লম্বা হাতা জামা ও লম্বা প্যান্ট পরুন।", "Wear long sleeves and trousers outdoors."),
    tx("নালা, ছাদ ও আবর্জনা পরিষ্কার রাখুন; সিটি কর্পোরেশনের কার্যক্রমে সহযোগিতা করুন।", "Keep drains, roofs and waste clear, and cooperate with city clean-up programmes."),
  ] },
  signs: { title: tx("সতর্কতার লক্ষণ", "Warning signs"),
    lead: tx("জ্বর কমে আসার সময় বা পরে (সাধারণত জ্বর শুরুর ৩–৭ দিনে) এগুলো বিপদচিহ্ন হতে পারে:", "Around the time fever settles (usually day 3–7), these can be danger signs:"),
    items: [
      tx("তীব্র পেটব্যথা বা পেটে চাপ", "Severe abdominal pain or tenderness"),
      tx("বারবার বমি", "Persistent vomiting"),
      tx("মাড়ি বা নাক থেকে রক্তপাত; বমি বা মলে রক্ত", "Bleeding from gums or nose; blood in vomit or stool"),
      tx("অতিরিক্ত দুর্বলতা, অস্থিরতা বা ঝিমুনি", "Extreme weakness, restlessness or drowsiness"),
      tx("দ্রুত শ্বাস বা শ্বাসকষ্ট", "Rapid breathing or difficulty breathing"),
      tx("হাত-পা ঠান্ডা ও ফ্যাকাসে, অতিরিক্ত তৃষ্ণা", "Cold, pale skin and extreme thirst"),
    ] },
  doctor: { title: tx("কখন চিকিৎসকের কাছে যাবেন?", "When to see a doctor"), items: [
    tx("হঠাৎ জ্বর, তীব্র মাথাব্যথা, চোখের পেছনে বা শরীরে ব্যথা, বমি ভাব বা ফুসকুড়ি হলে চিকিৎসকের পরামর্শ নিন।", "See a doctor for sudden fever, severe headache, pain behind the eyes or in the body, nausea or rash."),
    tx("“সতর্কতার লক্ষণ”-এর একটিও দেখা দিলে দেরি না করে নিকটস্থ হাসপাতাল বা জরুরি বিভাগে যান।", "If any warning sign appears, go to the nearest hospital or emergency department without delay."),
    tx("চিকিৎসকের পরামর্শ ছাড়া অ্যাসপিরিন বা আইবুপ্রোফেন খাবেন না।", "Do not take aspirin or ibuprofen without medical advice."),
    tx("বিশ্রাম নিন এবং প্রচুর তরল (পানি, স্যালাইন, ফলের রস) পান করুন।", "Rest and drink plenty of fluids (water, oral saline, fruit juice)."),
  ] },
  sources: [["WHO: Dengue and severe dengue", "https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue"], ["CDC: Dengue", "https://www.cdc.gov/dengue/"]],
});

// Verified on official .gov.bd pages on 2026-11-27 (bangladesh.gov.bd lists 999; 16263.dghs.gov.bd and dghs.gov.bd list 16263).
export const hotlines = () => [
  { id: "999", number: "999", tel: "999", name: tx("জাতীয় জরুরি সেবা", "National Emergency Service"), short: tx("জরুরি", "Emergency"),
    use: tx("পুলিশ, ফায়ার সার্ভিস ও অ্যাম্বুলেন্সের জরুরি সহায়তা", "Emergency police, fire and ambulance help"),
    src: "https://bangladesh.gov.bd/", srcName: "bangladesh.gov.bd" },
  { id: "16263", number: "16263", tel: "16263", name: tx("স্বাস্থ্য বাতায়ন (স্বাস্থ্য অধিদপ্তর)", "Shastho Batayon (DGHS health line)"), short: tx("স্বাস্থ্য বাতায়ন", "Health line"),
    use: tx("২৪ ঘণ্টা স্বাস্থ্য পরামর্শ", "Health advice, 24 hours"),
    src: "https://16263.dghs.gov.bd/", srcName: "16263.dghs.gov.bd" },
  { id: "dghs", number: "dghs.gov.bd", href: "https://www.dghs.gov.bd", name: tx("স্বাস্থ্য অধিদপ্তর (DGHS)", "Directorate General of Health Services (DGHS)"),
    use: tx("সরকারি স্বাস্থ্য তথ্য ও বিজ্ঞপ্তি", "Official health information and notices"), src: "https://www.dghs.gov.bd", srcName: "dghs.gov.bd" },
];

export const driverName = (k) => ({
  rain_lags: tx("বৃষ্টিপাত (বিগত ১–৮ সপ্তাহ)", "Rainfall (past 1–8 weeks)"), temperature: tx("তাপমাত্রা", "Temperature"),
  humidity: tx("আর্দ্রতা", "Humidity"), recent_cases: tx("সাম্প্রতিক নথিভুক্ত রোগী", "Recent reported cases"),
  vulnerability: tx("ওয়ার্ডের ঝুঁকির বৈশিষ্ট্য", "Ward vulnerability"), season: tx("ঋতু (বছরের সময়)", "Season"),
}[k]);
export const modelName = (k) => ({ ridge: tx("রিজ রিগ্রেশন", "Ridge regression"), hist_gradient_boosting: tx("হিস্ট গ্রেডিয়েন্ট বুস্টিং (পয়সন)", "Hist gradient boosting (Poisson)") }[k] || k);
export const errText = () => tx("ডেটা লোড করা যায়নি। সার্ভার চালু আছে কিনা দেখে আবার চেষ্টা করুন।", "Could not load data. Check that the server is running and try again.");
export const dataBanner = () => tx("ডেটা ২৯ ডিসেম্বর ২০২৫ পর্যন্ত। সব পূর্বাভাস অতীত তথ্যের পুনর্বিশ্লেষণ; এটি চলমান (লাইভ) নজরদারি নয়।",
  "Data run to 29 December 2025. All forecasts are retrospective replays, not live surveillance.");
