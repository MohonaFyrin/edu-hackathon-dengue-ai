// Renders Judge_QA_Guide.html to PDF with the locally installed Chrome/Edge (no download).
//   cd frontend; node e2e/render-qa-pdf.mjs
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "qa");
let browser;
for (const channel of ["chrome", "msedge"]) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* next */ }
}
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(dir, "Judge_QA_Guide.html")).href);
await page.pdf({
  path: path.join(dir, "Judge_QA_Guide.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: "<span></span>",
  footerTemplate: '<div style="font:8px Segoe UI,sans-serif;color:#4a5a55;width:100%;text-align:center">Dengue Early Warning — Judge Q&amp;A · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
});
await browser.close();
console.log("written");
