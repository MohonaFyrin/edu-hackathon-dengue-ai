// Round 2 end-to-end checks (Playwright + installed Chrome/Edge). Run with the app serving on BASE_URL.
//   node e2e/round2-test.mjs
// Every page here runs with ALL non-local network requests blocked, so the checks prove the app works with no internet.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;
let browser;
for (const channel of ["chrome", "msedge"]) {
  // Dead proxy for everything except the local app: external requests fail exactly as with Wi-Fi off.
  try { browser = await chromium.launch({ channel, args: ["--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=127.0.0.1;localhost"] }); break; } catch { /* try next */ }
}
if (!browser) throw new Error("No Chrome/Edge found for Playwright");

const problems = [];
const external = new Set();
const results = [];
const ok = (name) => { results.push(name); console.log("PASS", name); };

async function offlinePage(viewport) {
  const ctx = await browser.newContext({ viewport, locale: "bn-BD" });
  const page = await ctx.newPage();
  page.on("request", (r) => { if (!LOCAL.test(r.url()) && !r.url().startsWith("data:")) external.add(r.url()); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return { ctx, page };
}
const latin = (s) => s.replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d));

// ---------- Desktop, internet blocked ----------
const { ctx, page } = await offlinePage({ width: 1280, height: 900 });
await page.goto(BASE);
await page.locator("#hero-h").waitFor();
await page.locator("#result .num").waitFor();
ok("home loads and shows a ward forecast with the internet blocked");

assert.ok(await page.locator(".hero-photo img").evaluate((img) => img.complete && img.naturalWidth > 0), "hero photo must load from local assets");
const fonts = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("16px 'Noto Sans Bengali'", "ডেঙ্গু"); });
assert.ok(fonts, "Bengali font must be loaded locally");
ok("photo and Bengali font load from local files");

assert.equal(await page.locator(".hotbar a[href='tel:999']").count(), 1);
assert.equal(await page.locator(".hotbar a[href='tel:16263']").count(), 1);
ok("hotlines 999 and 16263 are pinned with tap-to-call");

await page.locator(".seg label", { hasText: "৪ সপ্তাহ" }).first().click();
await page.waitForFunction(() => document.querySelector("[data-testid=target-week]")?.textContent.includes("১ সেপ্টেম্বর"));
ok("changing horizon gives a fresh 4-week forecast");

await page.getByRole("button", { name: "English" }).click();
await page.waitForFunction(() => document.documentElement.lang === "en");
assert.ok((await page.locator("[data-testid=target-week]").innerText()).includes("1 September 2025"), "language switch keeps the horizon");
await page.getByRole("button", { name: "বাংলা" }).click();
ok("language switch keeps selections");

// Map Hub
await page.getByRole("button", { name: /মানচিত্র/ }).first().click();
await page.locator(".dmap-land").first().waitFor();
assert.ok(await page.locator(".dmap-land").count() >= 4, "district outlines drawn");
await page.locator(".wm-tile").first().waitFor();
assert.equal(await page.locator(".wm-tile").count(), 20, "Dhaka North shows its 20 ward tiles");
await page.getByLabel(/বেড স্থানান্তর/).check();
await page.getByLabel(/কাছের স্বাস্থ্যসেবা/).check();
await page.locator(".fac-list li").first().waitFor();
assert.ok(await page.locator(".dmap .fac").count() > 0, "facility points drawn on the map");
assert.equal(await page.getByRole("link", { name: /মানচিত্র$/ }).count(), 0, "outside-map links hidden while offline");
ok("Map Hub: real district borders, ward tiles, overlays and local facilities work offline");

// Officer: allocation responds to the stock slider
await page.getByRole("button", { name: /সরকারি কর্মকর্তা/ }).click();
await page.getByRole("button", { name: "সামগ্রী ও দল বরাদ্দ" }).click();
const deficit = async () => Number(latin(await page.locator(".res").first().locator(".def").innerText().catch(() => "0")).match(/\d+/)?.[0] || 0);
await page.locator(".res").first().waitFor();
const before = await deficit();
const slider = page.locator("input[type=range]").first();
await slider.fill("100");
await page.waitForFunction(() => [...document.querySelectorAll(".res")].slice(0, 3).every((e) => !e.classList.contains("short")), null, { timeout: 8000 });
await slider.fill("30");
await page.waitForFunction(() => [...document.querySelectorAll(".res")].slice(0, 3).every((e) => e.classList.contains("short")), null, { timeout: 8000 });
const after = await deficit();
assert.ok(after > before, `30% stock must leave a larger saline deficit than 60% (${before} -> ${after})`);
ok("stock slider recomputes allocation live (100% clears deficits, 30% raises them)");

await page.getByRole("button", { name: "মশা নিধন সিমুলেটর" }).click();
await page.locator("#simres .num").waitFor();
assert.ok(Number(latin(await page.locator("#simres .num").innerText()).replace(/[^\d.]/g, "")) > 0);
ok("simulator returns cases prevented for weeks 2-4");

await page.getByRole("button", { name: "বার্তা ও ব্রিফ" }).click();
await page.locator(".msg pre").first().waitFor();
const sms = await page.locator(".msg pre").first().innerText();
assert.ok(sms.includes("2025-08-04") && sms.length <= 160, "SMS carries the issue date and fits 160 characters");
const [brief] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("link", { name: /কমিশনার ব্রিফ/ }).click()]);
await brief.waitForLoadState();
assert.ok((await brief.content()).includes("Dengue operations brief"));
await brief.close();
ok("dispatch SMS and printable brief generated offline");

// Hospital
await page.getByRole("button", { name: /হাসপাতাল/ }).click();
await page.locator("#overflow table").waitFor();
await page.locator("#hsupply table").waitFor();
ok("hospital view shows supplies needed and overflow by city");

// Report: works while the local service answers
await page.getByRole("button", { name: /অভিযোগ/ }).click();
await page.getByRole("radio", { name: "খোলা আবর্জনা" }).check();
await page.getByRole("button", { name: "অভিযোগ জমা দিন" }).click();
await page.getByText("ধন্যবাদ। আপনার অভিযোগ সংরক্ষিত হয়েছে।").waitFor();
ok("citizen report stored");

// Service unreachable: everything offline, including localhost
await ctx.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event("offline")));
await page.getByRole("button", { name: "আরেকটি অভিযোগ" }).click();
await page.getByText("সংযোগ নেই।").waitFor({ timeout: 8000 });
assert.ok(await page.getByRole("button", { name: "অভিযোগ জমা দিন" }).isDisabled(), "submit disabled without a reachable service");
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
await page.waitForFunction(() => !document.querySelector("button[type=submit]")?.disabled, null, { timeout: 8000 });
ok("report submission is disabled while the service is unreachable and returns with it");
await ctx.close();

// ---------- Mobile, internet blocked ----------
const m = await offlinePage({ width: 360, height: 780 });
for (const hash of ["public", "map", "report", "officer", "hospital"]) {
  await m.page.goto(`${BASE}/#${hash}`);
  await m.page.locator("main h2").first().waitFor();
  await m.page.waitForTimeout(1500); // let data-driven sections render
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `#${hash} scrolls sideways by ${overflow}px at 360px`);
  const small = await m.page.evaluate(() => [...document.querySelectorAll("main button, main a.btn, main select, main input:not([type=radio]):not([type=checkbox]):not([type=file]), .hotbar a, nav button")]
    .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.textContent.trim().slice(0, 30)));
  assert.deepEqual(small, [], `#${hash} has targets under 40px: ${small.join(", ")}`);
}
ok("no sideways scroll and no small touch targets at 360px on all five views");
await m.ctx.close();

await browser.close();
const ext = [...external];
console.log(`\nExternal requests attempted (all blocked): ${ext.length ? ext.join(", ") : "none"}`);
const real = problems.filter((p) => !p.includes("/api/health"));
if (real.length) { console.log("PROBLEMS:\n" + real.join("\n")); process.exit(1); }
console.log(`\n${results.length} checks passed.`);
