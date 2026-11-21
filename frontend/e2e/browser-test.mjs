// End-to-end browser test (Playwright + installed Chrome/Edge). Run with the app serving on BASE_URL.
//   node e2e/browser-test.mjs            (default http://127.0.0.1:8000)
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const SHOTS = new URL("../../docs/screenshots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(SHOTS, { recursive: true });

const latin = (s) => s.replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d)).replace(/[^\d.]/g, "");
let browser;
for (const channel of ["chrome", "msedge"]) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* try next */ }
}
if (!browser) throw new Error("No Chrome/Edge found for Playwright (install Chrome or run: npx playwright install chromium)");

const problems = [];
const results = [];
const ok = (name) => { results.push(name); console.log("PASS", name); };

async function newPage(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, locale: "bn-BD", ...extra });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return page;
}
const api = async (page, path) => (await page.request.get(`${BASE}/api/${path}`)).json();
const text = (page) => page.locator("body").innerText();
const BANGLA = /[ঀ-৿]/;
const toEnglish = async (page) => { await page.getByRole("button", { name: "English" }).click(); await page.waitForFunction(() => document.documentElement.lang === "en"); };
const toBangla = async (page) => { await page.getByRole("button", { name: "বাংলা" }).click(); await page.waitForFunction(() => document.documentElement.lang === "bn"); };
const stripToggle = (s) => s.replace(/বাংলা/g, "");

// ---------- Desktop ----------
const page = await newPage({ width: 1280, height: 900 });
await page.goto(BASE);
await page.waitForSelector(".result-card .num");

assert.equal(await page.locator("html").getAttribute("lang"), "bn");
assert.match(await page.locator("h1").innerText(), /ডেঙ্গু আগাম সতর্কতা/);
assert.equal(await page.locator(".roles button.on").innerText(), "জনসাধারণ");
ok("site opens on the Bangla Public view by default");

let body = await text(page);
for (const t of ["ডেঙ্গু কী?", "প্রতিরোধের উপায়", "সতর্কতার লক্ষণ", "কখন চিকিৎসকের কাছে যাবেন?", "কোন সপ্তাহের পূর্বাভাস দেখতে চান?",
  "এখন কী করবেন?", "নথিভুক্ত রোগী ও পূর্বাভাস", "স্বাস্থ্য ও জরুরি হটলাইন", "লাইভ"]) assert.ok(body.includes(t), `missing: ${t}`);
assert.ok(!/MAE|RMSE/.test(body), "Public view must not show MAE/RMSE");
assert.equal(await page.locator(".actions li").count(), 3);
ok("Public view: compact action bullets, education, hotlines; no MAE/RMSE");

// 2/3/4 horizon: real API values; keyboard operable.
const numFor = async () => Number(latin(await page.locator(".result-card .num").first().innerText()));
const issue = await page.locator(".filters select").nth(2).inputValue();
const ward = await page.locator(".filters select").nth(1).inputValue();
const fmt = (iso) => new Intl.DateTimeFormat("bn-BD", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
const seen = new Set();
for (const h of [2, 3, 4]) {
  await page.locator(".seg input").nth(h - 2).check();
  const want = await api(page, `forecast?ward_id=${ward}&issue_date=${issue}&horizon_weeks=${h}`);
  await page.waitForFunction((t) => document.querySelector('[data-testid="target-week"]').innerText.includes(t), fmt(want.target_date));
  assert.equal(await numFor(), Number(want.predicted_cases.toFixed(1)), `horizon ${h} number matches API`);
  seen.add(want.target_date);
}
assert.equal(seen.size, 3);
await page.locator(".seg input").nth(0).focus();
await page.keyboard.press("ArrowRight"); // keyboard: radio group moves 2 -> 3 weeks
const w3 = await api(page, `forecast?ward_id=${ward}&issue_date=${issue}&horizon_weeks=3`);
await page.waitForFunction((t) => document.querySelector('[data-testid="target-week"]').innerText.includes(t), fmt(w3.target_date));
assert.equal(await numFor(), Number(w3.predicted_cases.toFixed(1)));
ok("2/3/4-week selector (mouse + keyboard) updates target week and prediction from the API");

// Selections survive a language switch (city, ward, week, horizon, prediction).
await page.locator(".filters select").nth(0).selectOption("Chattogram");
await page.waitForFunction(() => document.querySelectorAll("ul.grid li").length === 10);
await page.locator(".grid .cell").nth(3).click();
await page.locator(".filters select").nth(2).selectOption("2025-07-07");
await page.locator(".seg input").nth(2).check();
const snap = async () => ({
  city: await page.locator(".filters select").nth(0).inputValue(), ward: await page.locator(".filters select").nth(1).inputValue(),
  issue: await page.locator(".filters select").nth(2).inputValue(), h: await page.locator(".seg input:checked").evaluate((e) => [...e.closest(".seg").querySelectorAll("input")].indexOf(e)),
  num: await numFor(),
});
await page.waitForTimeout(500);
const before = await snap();
await page.screenshot({ path: `${SHOTS}public-desktop.png`, fullPage: true });
await page.locator(".filters").screenshot({ path: `${SHOTS}horizon-bn-desktop.png` });
await toEnglish(page);
body = await text(page);
assert.ok(body.includes("What should I do now?") && body.includes("Health and emergency hotlines") && body.includes("Which week's forecast do you want to see?"));
assert.ok(!BANGLA.test(stripToggle(body)), `Bangla text left in English Public view: ${stripToggle(body).match(/.{0,20}[ঀ-৿]+.{0,20}/)?.[0]}`);
await page.waitForTimeout(300);
assert.deepEqual(await snap(), before, "selections preserved after switching to English");
await page.locator(".filters").screenshot({ path: `${SHOTS}horizon-en-desktop.png` });
await page.screenshot({ path: `${SHOTS}public-en-desktop.png`, fullPage: true });
await toBangla(page);
assert.deepEqual(await snap(), before, "selections preserved after switching back to Bangla");
ok("Bangla/English toggle: full Public view translated; city, ward, week, horizon and prediction preserved");

// Hotlines.
const tels = await page.locator(".hl-card a[href^='tel:']").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
assert.deepEqual(tels, ["tel:999", "tel:16263"]);
assert.ok((await page.locator(".hl-card a[href^='http']").count()) >= 3, "each hotline card cites a source link");
await page.locator(".hl-num").first().focus();
assert.equal(await page.evaluate(() => document.activeElement.className), "hl-num");
ok("Hotline strip: verified numbers with tap-to-call links, sources, keyboard focus");

// Ward selection in grid.
assert.equal(await page.locator(".grid .cell.sel").count(), 1);
ok("city selection filters wards; risk grid click selects a ward");

// Officer.
await page.getByRole("button", { name: "সরকারি কর্মকর্তা" }).click();
await page.waitForSelector("#top10 tbody tr");
assert.equal(await page.locator("#top10 tbody tr").count(), 10);
body = await text(page);
for (const t of ["আগাম পরিকল্পনার সময়সীমা", "অগ্রাধিকারমূলক করণীয়", "লার্ভিসাইড", "নগর-ঝুঁকির বৈশিষ্ট্য", "বৃষ্টির বিলম্ব", "নির্বিচারে"]) assert.ok(body.includes(t), `missing: ${t}`);
assert.equal(await page.locator(".actions li").count(), 3);
assert.match(page.url(), /#officer$/);
const firstRow = await page.locator("#top10 tbody tr").first().innerText();
await page.locator(".seg input").nth(0).check();
await page.waitForFunction((prev) => document.querySelector("#top10 tbody tr")?.innerText !== prev, firstRow);
await page.waitForSelector("#drivers .bars li");
const top = await api(page, `priority?issue_date=2025-07-07&horizon_weeks=2&city=Chattogram&limit=10`);
assert.equal(top.wards.length, 10);
ok("Officer view: Top-10, planning bullets with larvicide caution, weather lags, vulnerability, drivers; horizon re-ranks");
await page.screenshot({ path: `${SHOTS}officer-desktop.png`, fullPage: true });
await toEnglish(page);
body = await text(page);
for (const t of ["Priority actions", "larvicide", "Planning horizon", "Urban vulnerability", "Priority wards for review", "indiscriminately"]) assert.ok(body.toLowerCase().includes(t.toLowerCase()), `missing EN: ${t}`);
assert.ok(!BANGLA.test(stripToggle(body)), "Bangla text left in English Officer view");
assert.equal(await page.locator("#top10 tbody tr").count(), 10);
await page.screenshot({ path: `${SHOTS}officer-en-desktop.png`, fullPage: true });
await toBangla(page);
ok("Officer view translated to English without Bangla remnants; Top-10 intact");

// Hospital.
await page.getByRole("button", { name: "হাসপাতাল" }).click();
await page.waitForSelector("#cmp tbody tr");
assert.equal(await page.locator("#cmp tbody tr").count(), 3);
body = await text(page);
for (const t of ["কোন সময়ের জন্য প্রস্তুতি নিতে চান?", "প্রস্তুতির জন্য করণীয়", "শয্যা-দখল"]) assert.ok(body.includes(t), `missing: ${t}`);
assert.equal(await page.locator(".actions li").count(), 3);
assert.ok(!/ভর্তি রোগীর সংখ্যা: |bed occupancy: \d/.test(body));
await page.locator(".filters select").nth(1).selectOption("");
await page.waitForFunction(() => document.body.innerText.includes("সব ওয়ার্ডের যোগফল"));
await page.screenshot({ path: `${SHOTS}hospital-desktop.png`, fullPage: true });
await toEnglish(page);
body = await text(page);
for (const t of ["Preparedness", "Which period are you preparing for?", "bed occupancy", "all wards combined"]) assert.ok(body.includes(t), `missing EN: ${t}`);
assert.ok(!BANGLA.test(stripToggle(body)), "Bangla text left in English Hospital view");
await page.screenshot({ path: `${SHOTS}hospital-en-desktop.png`, fullPage: true });
await toBangla(page);
ok("Hospital view: 3-horizon comparison, area-level forecast, preparedness bullets; English complete");

// Model performance.
await page.goto(`${BASE}/#model`);
await page.waitForSelector("#mp table");
body = await text(page);
assert.ok(body.includes("MAE") && body.includes("RMSE") && body.includes("বেসলাইন"));
const metrics = await api(page, "metrics");
assert.ok(latin(body).includes(metrics.horizons["2"].test.mae.toFixed(2)), "model view shows measured MAE");
await page.screenshot({ path: `${SHOTS}model-desktop.png`, fullPage: true });
await toEnglish(page);
body = await text(page);
assert.ok(body.includes("Model performance") && body.includes("Baseline: last week") && !BANGLA.test(stripToggle(body)));
ok("Model Performance: measured MAE/RMSE vs baselines, Bangla and English");

await page.goto(BASE);
await page.waitForSelector(".result-card .num");
assert.equal(await page.locator(".roles button.on").innerText(), "জনসাধারণ");
ok("plain URL returns to the Bangla Public homepage");

// ---------- Mobile (both languages, reduced motion on) ----------
const m = await newPage({ width: 375, height: 812 }, { reducedMotion: "reduce" });
for (const lang of ["bn", "en"]) {
  for (const [view, sel] of [["", ".result-card .num"], ["#officer", "#top10 tbody tr"], ["#hospital", "#cmp tbody tr"], ["#model", "#mp table"]]) {
    await m.goto(`${BASE}/${view}`);
    await m.waitForSelector(sel);
    if (lang === "en") await toEnglish(m);
    await m.waitForTimeout(300);
    const { sw, iw } = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(sw <= iw + 1, `horizontal overflow on mobile ${lang} ${view || "public"}: ${sw} > ${iw}`);
    const tiny = await m.evaluate(() => [...document.querySelectorAll("button, select, input")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40 && !e.closest(".sr-only") && !e.classList.contains("inline") && e.type !== "radio").length);
    assert.equal(tiny, 0, `touch targets >= 40px (${lang} ${view})`);
    const name = `${view.slice(1) || "public"}${lang === "en" ? "-en" : ""}-mobile`;
    await m.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });
    if (!view) await m.locator(".filters").screenshot({ path: `${SHOTS}horizon-${lang}-mobile.png` });
  }
}
ok("mobile 375px (Bangla and English): no horizontal overflow, large touch targets, all four views render");

await m.goto(BASE);
await m.waitForSelector("#hotlines");
await m.locator("#hotlines").scrollIntoViewIfNeeded();
await m.screenshot({ path: `${SHOTS}hotlines-mobile.png` });
const before0 = await m.locator(".hl-strip").evaluate((e) => e.scrollLeft);
await m.getByRole("button", { name: /পরের কার্ড/ }).click();
await m.waitForTimeout(200);
const after = await m.locator(".hl-strip").evaluate((e) => e.scrollLeft);
assert.ok(after > before0, "next-card control scrolls the strip");
await m.getByRole("button", { name: /আগের কার্ড/ }).click();
await m.waitForTimeout(200);
assert.ok((await m.locator(".hl-strip").evaluate((e) => e.scrollLeft)) < after, "previous-card control scrolls back");
ok("hotline carousel controls work on mobile with reduced motion; no auto-scroll");

assert.deepEqual(problems, [], `Browser problems:\n${problems.join("\n")}`);
ok("no console errors, page errors, failed or 4xx/5xx requests");
await browser.close();
console.log(`\n${results.length} browser checks passed`);
