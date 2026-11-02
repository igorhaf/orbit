import { chromium } from "playwright";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const baseUrl = (process.env.SUINDA_A11Y_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find((candidate) => existsSync(candidate));
const routes = [
  "/",
  "/auth/login",
  "/auth/register",
  "/auth/recover",
  "/auth/reset",
  "/profile",
  "/workspaces",
  "/calendar",
  "/search",
  "/inbox",
  "/plugins",
  "/access",
  "/extensions",
  "/boards",
  "/suinda",
  "/suinda/catalog",
  "/suinda/course/00000000-0000-4000-8000-000000000301",
  "/suinda/certificates/SUINDA-00000000-0000-4000-8000-000000000302",
  "/suinda/checkin",
  "/suinda/learning/00000000-0000-4000-8000-000000000303",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/agreements",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/assessments",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/attendance",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/documents",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/surveys",
  "/suinda/messages/00000000-0000-4000-8000-000000000303",
  "/suinda/privacy",
  "/suinda/privacy-management",
  "/suinda/profile",
  "/suinda/reports",
  "/suinda/alumni",
  "/suinda/affiliates",
  "/suinda/corporate",
  "/suinda/subscriptions",
  "/suinda/integrations/certificate-signing",
  "/suinda/integrations/crm",
  "/suinda/integrations/open-badges",
  "/suinda/portfolio",
  "/suinda/terms",
];
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const runRouteSweep = process.env.SUINDA_A11Y_INTERACTIONS_ONLY !== "1";
const auditEmail = process.env.SUINDA_A11Y_EMAIL;
const auditPassword = process.env.SUINDA_A11Y_PASSWORD;
if (Boolean(auditEmail) !== Boolean(auditPassword)) {
  throw new Error("Configure SUINDA_A11Y_EMAIL e SUINDA_A11Y_PASSWORD juntos para ativar a varredura autenticada.");
}
let authenticatedSession = null;
if (auditEmail && auditPassword) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: auditEmail, password: auditPassword }),
  });
  if (!login.ok) throw new Error(`Login de auditoria recusado (HTTP ${login.status}); nenhuma credencial foi registrada.`);
  const session = await login.json();
  if (!session.token) throw new Error("A conta de auditoria exige uma etapa de autenticação adicional ou não criou sessão.");
  const profile = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: `Bearer ${session.token}` } });
  if (!profile.ok) throw new Error(`Não foi possível carregar o perfil da conta de auditoria (HTTP ${profile.status}).`);
  authenticatedSession = { token: session.token, user: await profile.json() };
}
const modes = [{ name: "anonymous", session: null }];
if (authenticatedSession) modes.push({ name: "authenticated", session: authenticatedSession });
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({
  headless: true,
  ...(chromePath ? { executablePath: chromePath } : {}),
  args: ["--no-sandbox"],
});
const results = [];
const interactionChecks = [];
async function axeViolations(page) {
  const hasAxe = await page.evaluate(() => Boolean(window.axe));
  if (!hasAxe) await page.addScriptTag({ path: axePath });
  return page.evaluate(async (tags) => {
    const audit = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
    return audit.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }));
  }, wcagTags);
}
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    let mutationRequests = 0;
    await page.route("**/api/**", async (route) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) mutationRequests += 1;
      await route.continue();
    });
    const response = await page.goto(`${baseUrl}/suinda/catalog`, { waitUntil: "networkidle" });
    const modality = page.locator("select").nth(1);
    let focusedByTab = false;
    for (let step = 0; step < 180; step += 1) {
      if (await modality.evaluate((element) => document.activeElement === element)) { focusedByTab = true; break; }
      await page.keyboard.press("Tab");
    }
    const before = focusedByTab ? await modality.evaluate((element) => ({ value: element.value, index: element.selectedIndex })) : null;
    if (focusedByTab) await page.keyboard.press("ArrowDown");
    const down = focusedByTab ? await modality.evaluate((element) => ({ value: element.value, index: element.selectedIndex,
      retainedFocus: document.activeElement === element })) : null;
    if (focusedByTab) await page.keyboard.press("ArrowUp");
    const up = focusedByTab ? await modality.evaluate((element) => ({ value: element.value, index: element.selectedIndex,
      retainedFocus: document.activeElement === element })) : null;
    const passed = Boolean(response && response.status() < 400 && focusedByTab && before?.index === 0
      && down?.value === "online" && down.index === 1 && down.retainedFocus
      && up?.value === before.value && up.index === before.index && up.retainedFocus && mutationRequests === 0);
    interactionChecks.push({
      check: `Native modality filter supports ArrowDown/ArrowUp without leaving keyboard focus or mutating data (${viewport.name})`,
      passed, selected_before: before, after_arrow_down: down, after_arrow_up: up, mutation_requests: mutationRequests,
    });
    await page.close();
  }

  if (runRouteSweep) {
    for (const mode of modes) {
      for (const viewport of viewports) {
        for (const route of routes) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
        if (mode.session) {
          await page.addInitScript(({ token, user }) => {
            localStorage.setItem("orbit_token", token);
            localStorage.setItem("orbit_user", JSON.stringify(user));
          }, mode.session);
        }
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
        if (!response || response.status() >= 400) {
          results.push({ mode: mode.name, route, viewport: viewport.name, status: response?.status() ?? null, error: "A rota não respondeu com sucesso." });
          await page.close();
          continue;
        }
        await page.keyboard.press("Tab");
        await page.waitForTimeout(250);
        const firstTab = await page.evaluate(() => {
          const element = document.activeElement;
          const rect = element?.getBoundingClientRect();
          const style = element ? getComputedStyle(element) : null;
          const text = element?.textContent?.replace(/\s+/g, " ").trim() || "";
          const visible = Boolean(rect && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight);
          const focusVisible = Boolean(style && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2);
          return { text, href: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null, visible, focus_visible: focusVisible,
            passed: element instanceof HTMLAnchorElement && text === "Ir para o conteúdo principal" && element.getAttribute("href") === "#main-content" && visible && focusVisible };
        });
        await page.addScriptTag({ path: axePath });
        const audit = await page.evaluate(async (tags) => {
          const report = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
          return report.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: violation.nodes.map((node) => ({ target: node.target, failure: node.failureSummary })),
          }));
        }, wcagTags);
        results.push({ mode: mode.name, route, viewport: viewport.name, status: response.status(), keyboard_first_tab: firstTab, violations: audit });
          await page.close();
        }
      }
    }
  }
  const checkinPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await checkinPage.addInitScript(() => localStorage.setItem("orbit_token", "a11y-keyboard-session"));
  await checkinPage.route("**/api/extensions/suinda-learning/me/checkin", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ already_checked_in: false, status: "present", geolocation_verified: false }) });
  });
  const checkinResponse = await checkinPage.goto(`${baseUrl}/suinda/checkin?session=00000000-0000-4000-8000-000000000001&token=a11y.audit.signature`, { waitUntil: "networkidle" });
  const confirmButton = checkinPage.locator("main button[type=button]");
  await checkinPage.getByRole("button", { name: "Confirmar presença" }).waitFor({ state: "visible" });
  await confirmButton.focus();
  await checkinPage.keyboard.press("Enter");
  await checkinPage.locator("#checkin-progress").waitFor({ state: "attached" });
  const retainedDuringRequest = await confirmButton.evaluate((element) => document.activeElement === element);
  await checkinPage.getByRole("status").filter({ hasText: "Presença confirmada." }).waitFor({ state: "visible" });
  const resultButton = checkinPage.locator("main button[type=button]");
  const retainedAfterResult = await resultButton.evaluate((element) => document.activeElement === element);
  const resultIsAnnounced = await checkinPage.locator("#checkin-result[role=status][aria-live=polite]").count() === 1;
  const checkinAxe = await axeViolations(checkinPage);
  interactionChecks.push({
    check: "QR check-in keeps keyboard focus on the action while pending and after success",
    passed: Boolean(checkinResponse && checkinResponse.status() < 400 && retainedDuringRequest && retainedAfterResult && resultIsAnnounced && checkinAxe.length === 0),
    focused_during_request: retainedDuringRequest,
    focused_after_result: retainedAfterResult,
    result_announced: resultIsAnnounced,
    axe_violations: checkinAxe,
  });
  await checkinPage.close();

  const enrollmentId = "00000000-0000-4000-8000-000000000101";
  const surveyId = "00000000-0000-4000-8000-000000000102";
  const surveyUrl = `**/api/extensions/suinda-learning/me/enrollments/${enrollmentId}/surveys`;
  const surveyOne = { id: surveyId, title: "Pesquisa enviada", anonymous: true, closes_at: null,
    questions: [{ id: "question-1", type: "text", label: "Comentário", required: true, options: [], max_length: 500 }] };
  const surveyTwo = { ...surveyOne, id: "00000000-0000-4000-8000-000000000103", title: "Outra pesquisa aberta" };
  const surveyPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await surveyPage.addInitScript(() => localStorage.setItem("orbit_token", "a11y-keyboard-session"));
  let surveyLoads = 0;
  let surveySubmitted = false;
  await surveyPage.route(surveyUrl, async (route) => {
    surveyLoads++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ surveys: surveySubmitted ? [surveyTwo] : [surveyOne, surveyTwo] }) });
  });
  await surveyPage.route(`**/api/extensions/suinda-learning/me/enrollments/${enrollmentId}/surveys/${surveyId}/responses`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    surveySubmitted = true;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "response-1" }) });
  });
  const surveyResponse = await surveyPage.goto(`${baseUrl}/suinda/learning/${enrollmentId}/surveys`, { waitUntil: "networkidle" });
  const surveyForm = surveyPage.locator(`#survey-${surveyId}`);
  await surveyForm.waitFor({ state: "visible" });
  const surveyLoadsBeforeSubmit = surveyLoads;
  await surveyForm.getByRole("textbox", { name: "Comentário" }).fill("Boa experiência");
  await surveyForm.getByRole("button", { name: "Enviar resposta" }).click();
  await surveyPage.getByRole("status").filter({ hasText: "Resposta enviada: Pesquisa enviada" }).waitFor({ state: "visible" });
  const surveyFocus = await surveyPage.evaluate(() => document.activeElement?.getAttribute("role") === "status"
    && document.activeElement?.textContent?.includes("Resposta enviada: Pesquisa enviada"));
  const nextSurveyVisible = await surveyPage.getByRole("heading", { name: "Outra pesquisa aberta" }).isVisible();
  const surveyNoLoadingFlash = surveyLoads > surveyLoadsBeforeSubmit && !(await surveyPage.getByText("Carregando pesquisas…").count());
  const surveyAxe = await axeViolations(surveyPage);
  interactionChecks.push({
    check: "Survey submission focuses its announced result and preserves the remaining list",
    passed: Boolean(surveyResponse && surveyResponse.status() < 400 && surveyFocus && nextSurveyVisible && surveyNoLoadingFlash && surveyAxe.length === 0),
    focused_result: surveyFocus, remaining_list_visible: nextSurveyVisible, list_reload_count: surveyLoads - surveyLoadsBeforeSubmit, axe_violations: surveyAxe,
  });
  await surveyPage.close();

  const errorSurveyPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await errorSurveyPage.addInitScript(() => localStorage.setItem("orbit_token", "a11y-keyboard-session"));
  let errorSurveyLoads = 0;
  await errorSurveyPage.route(surveyUrl, async (route) => {
    errorSurveyLoads++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ surveys: [surveyOne] }) });
  });
  await errorSurveyPage.route(`**/api/extensions/suinda-learning/me/enrollments/${enrollmentId}/surveys/${surveyId}/responses`, async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Falha simulada" }) });
  });
  await errorSurveyPage.goto(`${baseUrl}/suinda/learning/${enrollmentId}/surveys`, { waitUntil: "networkidle" });
  const errorSurveyForm = errorSurveyPage.locator(`#survey-${surveyId}`);
  await errorSurveyForm.waitFor({ state: "visible" });
  const errorSurveyLoadsBeforeSubmit = errorSurveyLoads;
  await errorSurveyForm.getByRole("textbox", { name: "Comentário" }).fill("Tentar enviar");
  const errorSurveyButton = errorSurveyForm.getByRole("button", { name: "Enviar resposta" });
  await errorSurveyButton.click();
  await errorSurveyPage.getByText("Falha simulada", { exact: true }).waitFor({ state: "visible" });
  const errorSurveyFocus = await errorSurveyButton.evaluate((element) => document.activeElement === element);
  const errorSurveyFocusWithinForm = await errorSurveyForm.evaluate((form) => form.contains(document.activeElement));
  const errorSurveyFormVisible = await errorSurveyForm.isVisible();
  const surveyErrorNoReload = errorSurveyLoads === errorSurveyLoadsBeforeSubmit;
  const errorSurveyAxe = await axeViolations(errorSurveyPage);
  interactionChecks.push({
    check: "Survey API error keeps focus in the form without reloading its list",
    passed: Boolean(errorSurveyFocusWithinForm && errorSurveyFormVisible && surveyErrorNoReload && errorSurveyAxe.length === 0),
    focus_stays_on_submit: errorSurveyFocus, focus_stays_in_form: errorSurveyFocusWithinForm, form_visible: errorSurveyFormVisible, list_reload_count: errorSurveyLoads - errorSurveyLoadsBeforeSubmit, axe_violations: errorSurveyAxe,
  });
  await errorSurveyPage.close();

  const sessionId = "00000000-0000-4000-8000-000000000201";
  const attendanceUrl = `**/api/extensions/suinda-learning/me/enrollments/${enrollmentId}/attendance-justifications`;
  const baseSession = { id: sessionId, title: "Encontro de demonstração", starts_at: "2026-10-20T12:00:00.000Z",
    request_deadline_at: "2026-11-20T12:00:00.000Z", attendance_status: "absent", can_request: true, request: null,
    can_request_makeup: true, makeup_request: null, makeup_slots: [] };
  async function runAttendanceFlow(kind, outcome) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => localStorage.setItem("orbit_token", "a11y-keyboard-session"));
    let attendanceLoads = 0;
    let attendanceSubmitted = false;
    await page.route(attendanceUrl, async (route) => {
      attendanceLoads++;
      const session = !attendanceSubmitted ? baseSession : kind === "justification"
        ? { ...baseSession, can_request: false, request: { id: "justification-1", revision: 1, state: "submitted", reason: "Teste", file_name: "comprovante.pdf" } }
        : { ...baseSession, can_request_makeup: false, makeup_request: { id: "makeup-1", revision: 1, state: "submitted", reason: "Teste" } };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sessions: [session] }) });
    });
    const endpoint = kind === "justification"
      ? `**/api/extensions/suinda-learning/me/enrollments/${enrollmentId}/sessions/${sessionId}/attendance-justifications`
      : `**/api/extensions/suinda-learning/me/enrollments/${enrollmentId}/sessions/${sessionId}/makeup-requests`;
    await page.route(endpoint, async (route) => {
      if (outcome === "error") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Falha simulada" }) });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 250));
        attendanceSubmitted = true;
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: `${kind}-request` }) });
      }
    });
    const response = await page.goto(`${baseUrl}/suinda/learning/${enrollmentId}/attendance`, { waitUntil: "networkidle" });
    const card = page.locator("li").filter({ has: page.getByRole("heading", { name: "Encontro de demonstração" }) });
    await card.waitFor({ state: "visible" });
    const attendanceLoadsBeforeSubmit = attendanceLoads;
    if (kind === "justification") {
      await card.getByLabel("Motivo da ausência").fill("Imprevisto de saúde");
      await card.locator('input[type="file"]').setInputFiles({ name: "comprovante.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-demo") });
      const submit = card.getByRole("button", { name: "Enviar para análise" });
      await submit.click();
      if (outcome === "success") await page.locator(`#attendance-justification-${sessionId}`).waitFor({ state: "visible" });
      else await page.getByText("Falha simulada", { exact: true }).waitFor({ state: "visible" });
      const focus = await (outcome === "success" ? page.locator(`#attendance-justification-${sessionId}`) : submit)
        .evaluate((element) => document.activeElement === element);
      const focusWithinForm = await card.locator("form").first().evaluate((form) => form.contains(document.activeElement));
      const preserved = await card.isVisible();
      const reloads = attendanceLoads - attendanceLoadsBeforeSubmit;
      const statusText = await page.locator(`#attendance-justification-${sessionId}`).textContent().catch(() => "");
      const statusVisible = outcome !== "success" || Boolean(statusText?.includes("Justificativa em análise"));
      const axe = await axeViolations(page);
      await page.close();
      return { response, focus, focusWithinForm, preserved, reloads, statusVisible, statusText, axe };
    }
    const makeupForm = card.locator("form").filter({ has: page.getByRole("heading", { name: "Solicitar reposição" }) });
    await makeupForm.getByLabel("Motivo", { exact: true }).fill("Imprevisto de saúde");
    const submit = makeupForm.getByRole("button", { name: "Enviar pedido de reposição" });
    await submit.click();
    if (outcome === "success") await page.locator(`#attendance-makeup-${sessionId}`).waitFor({ state: "visible" });
    else await page.getByText("Falha simulada", { exact: true }).waitFor({ state: "visible" });
    const focus = await (outcome === "success" ? page.locator(`#attendance-makeup-${sessionId}`) : submit)
      .evaluate((element) => document.activeElement === element);
    const focusWithinForm = outcome === "success" ? true : await makeupForm.evaluate((form) => form.contains(document.activeElement));
    const preserved = await card.isVisible();
    const reloads = attendanceLoads - attendanceLoadsBeforeSubmit;
    const statusText = await page.locator(`#attendance-makeup-${sessionId}`).textContent().catch(() => "");
    const statusVisible = outcome !== "success" || Boolean(statusText?.includes("Pedido de reposição enviado para análise."));
    const axe = await axeViolations(page);
    await page.close();
    return { response, focus, focusWithinForm, preserved, reloads, statusVisible, statusText, axe };
  }

  for (const [kind, name] of [["justification", "Justification"], ["makeup", "Makeup"]]) {
    const success = await runAttendanceFlow(kind, "success");
    const passed = Boolean(success.response && success.response.status() < 400 && success.focus && success.preserved && success.reloads === 1 && success.statusVisible && success.axe.length === 0);
    interactionChecks.push({
      check: `${name} success focuses updated status, preserves the session list and has no axe violations`,
      passed, focused_result: success.focus, status_visible: success.statusVisible, status_text: success.statusText, session_visible: success.preserved, list_reload_count: success.reloads, axe_violations: success.axe,
    });
    const failure = await runAttendanceFlow(kind, "error");
    const failurePassed = Boolean(failure.focusWithinForm && failure.preserved && failure.reloads === 0 && failure.axe.length === 0);
    interactionChecks.push({
      check: `${name} API error preserves the form focus without reload or axe violations`,
      passed: failurePassed, focus_stays_on_submit: failure.focus, focus_stays_in_form: failure.focusWithinForm, session_visible: failure.preserved, list_reload_count: failure.reloads, axe_violations: failure.axe,
    });
  }

  const skipLinkPage = await browser.newPage({ viewport: { width: 320, height: 800 } });
  const skipResponse = await skipLinkPage.goto(`${baseUrl}/suinda`, { waitUntil: "networkidle" });
  await skipLinkPage.keyboard.press("Tab");
  const skipLinkFocused = await skipLinkPage.evaluate(() => document.activeElement instanceof HTMLAnchorElement
    && document.activeElement.getAttribute("href") === "#main-content"
    && document.activeElement.textContent?.replace(/\s+/g, " ").trim() === "Ir para o conteúdo principal");
  await skipLinkPage.keyboard.press("Enter");
  const mainFocused = await skipLinkPage.waitForFunction(() => document.activeElement instanceof HTMLElement
    && document.activeElement.matches("main#main-content[tabindex=\"-1\"]"), null, { timeout: 3000 }).then(() => true).catch(() => false);
  const skipLinkAxe = await axeViolations(skipLinkPage);
  interactionChecks.push({
    check: "Skip link is first keyboard target and Enter moves focus to main content at 320px without axe violations",
    passed: Boolean(skipResponse && skipResponse.status() < 400 && skipLinkFocused && mainFocused && skipLinkAxe.length === 0),
    first_tab_focused_skip_link: skipLinkFocused, enter_focused_main: mainFocused, axe_violations: skipLinkAxe,
  });
  await skipLinkPage.close();

  const fontScalePage = await browser.newPage({ viewport: { width: 320, height: 800 } });
  const account = { id: "a11y-font-scale-user", preferences: { fontScale: "normal" } };
  await fontScalePage.addInitScript(({ user }) => {
    localStorage.setItem("orbit_token", "a11y-font-scale-session");
    if (!localStorage.getItem("orbit_user")) localStorage.setItem("orbit_user", JSON.stringify(user));
  }, { user: account });
  await fontScalePage.route("**/api/extensions/suinda-learning/me/profiles", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await fontScalePage.route("**/api/account/mfa", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false }) });
  });
  let fontScaleWrites = 0;
  let currentFontScale = "normal";
  await fontScalePage.route("**/api/account", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...account, preferences: { ...account.preferences, fontScale: currentFontScale } }) });
  });
  await fontScalePage.route("**/api/account/preferences/font-scale", async (route) => {
    fontScaleWrites++;
    const body = route.request().postDataJSON();
    currentFontScale = body.fontScale;
    const updated = { ...account, preferences: { ...account.preferences, fontScale: currentFontScale } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(updated) });
  });
  const profileResponse = await fontScalePage.goto(`${baseUrl}/suinda/profile`, { waitUntil: "networkidle" });
  const largestScale = fontScalePage.locator('input[name="suinda-font-scale"][value="largest"]');
  const normalScale = fontScalePage.locator('input[name="suinda-font-scale"][value="normal"]');
  await largestScale.waitFor({ state: "visible" });
  const keyboardTransitions = [];
  const moveScaleByKeyboard = async (key, expectedScale) => {
    await fontScalePage.keyboard.press(key);
    await fontScalePage.waitForFunction((scale) => {
      const input = document.querySelector(`input[name="suinda-font-scale"][value="${scale}"]`);
      return document.getElementById("suinda-root")?.getAttribute("data-suinda-font-scale") === scale
        && input instanceof HTMLInputElement && !input.disabled;
    }, expectedScale);
    keyboardTransitions.push({ key, expected_scale: expectedScale,
      selected: await fontScalePage.locator(`input[name="suinda-font-scale"][value="${expectedScale}"]`).isChecked(),
      focus_remained_in_group: await fontScalePage.evaluate(() => document.activeElement instanceof HTMLInputElement
        && document.activeElement.name === "suinda-font-scale") });
  };
  await normalScale.focus();
  await moveScaleByKeyboard("ArrowRight", "large");
  await moveScaleByKeyboard("ArrowRight", "largest");
  await fontScalePage.waitForFunction(() => document.getElementById("suinda-root")?.getAttribute("data-suinda-font-scale") === "largest");
  const largestFontSize = await fontScalePage.locator("#suinda-root").evaluate((element) => getComputedStyle(element).getPropertyValue("--text-base").trim());
  const profileOverflow = await fontScalePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const selectionPersisted = await fontScalePage.evaluate(() => JSON.parse(localStorage.getItem("orbit_user") || "null")?.preferences?.fontScale === "largest");
  await fontScalePage.addScriptTag({ path: axePath });
  const profileAxe = await fontScalePage.evaluate(async (tags) => (await window.axe.run(document, { runOnly: { type: "tag", values: tags } })).violations
    .map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length })), wcagTags);
  await fontScalePage.reload({ waitUntil: "networkidle" });
  const afterReload = await fontScalePage.locator("#suinda-root").getAttribute("data-suinda-font-scale");
  await fontScalePage.goto(`${baseUrl}/suinda/catalog`, { waitUntil: "networkidle" });
  const afterNavigation = await fontScalePage.locator("#suinda-root").getAttribute("data-suinda-font-scale");
  const catalogOverflow = await fontScalePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await fontScalePage.addScriptTag({ path: axePath });
  const catalogAxe = await fontScalePage.evaluate(async (tags) => (await window.axe.run(document, { runOnly: { type: "tag", values: tags } })).violations
    .map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length })), wcagTags);
  await fontScalePage.goto(`${baseUrl}/suinda/profile`, { waitUntil: "networkidle" });
  await fontScalePage.locator('input[name="suinda-font-scale"][value="largest"]').focus();
  await moveScaleByKeyboard("ArrowLeft", "large");
  await moveScaleByKeyboard("ArrowLeft", "normal");
  const restoredFontScale = await fontScalePage.locator('input[name="suinda-font-scale"][value="normal"]').isChecked();
  interactionChecks.push({
    check: "Suindá font-scale radio group supports ArrowRight/ArrowLeft, persists 125% across reload/navigation, and restores the preference without 320px overflow or axe violations",
    passed: Boolean(profileResponse && profileResponse.status() < 400 && fontScaleWrites === 4 && keyboardTransitions.length === 4
      && keyboardTransitions.every((transition) => transition.selected && transition.focus_remained_in_group)
      && restoredFontScale && largestFontSize === "1.25rem" && selectionPersisted && afterReload === "largest"
      && afterNavigation === "largest" && !profileOverflow && !catalogOverflow && profileAxe.length === 0 && catalogAxe.length === 0),
    saved_requests: fontScaleWrites, keyboard_transitions: keyboardTransitions, preference_restored: restoredFontScale,
    largest_base_font_size: largestFontSize, preference_persisted: selectionPersisted,
    scale_after_reload: afterReload, scale_after_navigation: afterNavigation, profile_overflow: profileOverflow, catalog_overflow: catalogOverflow,
    profile_axe_violations: profileAxe, catalog_axe_violations: catalogAxe,
  });
  await fontScalePage.close();
} finally {
  await browser.close();
}

const failures = results.filter((result) => result.error || !result.keyboard_first_tab?.passed || result.violations?.length);
console.log(JSON.stringify({ base_url: baseUrl, standard: "WCAG 2.2 A/AA automated rules", route_sweep: runRouteSweep, modes: modes.map((mode) => mode.name), route_viewports: results.length, results, interaction_checks: interactionChecks }, null, 2));
if (failures.length || interactionChecks.some((check) => !check.passed)) process.exitCode = 1;
