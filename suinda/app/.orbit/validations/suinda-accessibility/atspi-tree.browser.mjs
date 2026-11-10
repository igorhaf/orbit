import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const baseUrl = (process.env.SUINDA_A11Y_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const pythonPath = process.env.PYTHON3_PATH || "/usr/bin/python3";
const pythonCheck = new URL("./atspi-tree.py", import.meta.url).pathname;
const chromePath = process.env.CHROME_PATH || ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate) => existsSync(candidate));

const browser = await chromium.launch({ headless: false,
  ...(chromePath ? { executablePath: chromePath } : {}),
  args: ["--no-sandbox", "--force-renderer-accessibility"],
});
let report;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseUrl).origin) await route.abort("blockedbyclient");
    else await route.continue();
  });
  const response = await page.goto(`${baseUrl}/suinda/terms`, { waitUntil: "networkidle", timeout: 30_000 });
  if (!response || response.status() >= 400) throw new Error(`Rota pública indisponível: HTTP ${response?.status() ?? "sem resposta"}.`);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(500);
  const expectedHeading = "Termos de uso e aviso de privacidade";
  const expectedFocus = "Ir para o conteúdo principal";
  report = JSON.parse(execFileSync(pythonPath, [pythonCheck, expectedHeading, expectedFocus], { encoding: "utf8", timeout: 15_000 }));
  report.route = "/suinda/terms";
  report.page_title = await page.title();
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  base_url: baseUrl,
  interface: "Chrome accessibility tree through Linux AT-SPI",
  report,
  limitation: "Checks the browser accessibility bridge and focused accessible name; it does not assert synthesized speech, reader navigation commands, authenticated content, or assistive-technology conformance.",
}, null, 2));

if (!report.document_names?.length || !report.expected_heading_seen || !report.expected_focus_seen
  || report.focused_accessible_object?.name !== "Ir para o conteúdo principal"
  || report.unnamed_interactive_controls?.length) process.exitCode = 1;
