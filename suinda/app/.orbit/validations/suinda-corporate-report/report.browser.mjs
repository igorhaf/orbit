import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const baseUrl = (process.env.SUINDA_CORPORATE_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/google/chrome/chrome"]
  .find((candidate) => existsSync(candidate));
const workspace = { id: "00000000-0000-4000-8000-000000000101", name: "Instituição de auditoria" };
const makeRow = (index) => ({
  cohort_link_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  company_name: `Empresa ${Math.floor(index / 10) + 1}`,
  course_title: `Curso ${Math.floor(index / 5) + 1}`,
  cohort_title: `Turma ${index + 1}`,
  currency: "BRL", agreed_price_amount: 1250, enrollments: 12, active: 8, completed: 2, withdrawn: 2, distinct_learners: 12,
});
let reportRequests = 0;
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}), args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route("**/api/workspaces", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([workspace]) }));
  await page.route("**/api/extensions/suinda-corporate/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/report")) return route.continue();
    reportRequests += 1;
    const cursor = url.searchParams.get("cursor");
    const rows = cursor ? [makeRow(50)] : Array.from({ length: 50 }, (_, index) => makeRow(index));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      cohorts: rows, total_cohorts: 51, next_cursor: cursor ? null : "cursor-next-page", limit: 50,
    }) });
  });

  const response = await page.goto(`${baseUrl}/suinda/corporate`, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200);
  await page.getByText("Exibindo 50 de 51 turmas corporativas.").waitFor({ state: "visible" });
  assert.equal(await page.locator("table tbody tr").count(), 50);
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await page.getByText("Exibindo 51 de 51 turmas corporativas.").waitFor({ state: "visible" });
  assert.equal(await page.locator("table tbody tr").count(), 51);
  assert.equal(reportRequests, 2);
  assert.equal(await page.getByText(/Desistências nas turmas carregadas: 102/).count(), 1);
  console.log(JSON.stringify({ page_http: response.status(), report_requests: reportRequests, rows_after_pagination: 51, total: 51, duplicate_rows: 0 }));
} finally {
  await browser.close();
}
