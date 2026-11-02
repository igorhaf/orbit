import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const baseUrl = process.env.SUINDA_A11Y_BASE_URL || "http://localhost:3003";
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/google/chrome/chrome"].find(existsSync);
const axePath = require.resolve("axe-core/axe.min.js");
const user = {
  id: "synthetic-subscription-user", name: "Pessoa de teste", email: "subscription@example.invalid",
  role: "root", is_root: true, permissions: ["*"],
  preferences: { theme: "dark", notifications: false, browserNotifications: false, emailNotifications: false },
};
const workspace = { id: "workspace-synthetic", name: "Instituição sintética" };
const course = {
  id: "course-synthetic", title: "Curso semântico", payload: { description: "Curso de demonstração." },
  modules: [{ id: "module-synthetic", title: "Módulo 1", payload: { summary: "Resumo do módulo." }, lessons: [{
    id: "lesson-synthetic", title: "Aula Semântica", revision: 1, completed: false,
    payload: {
      content_type: "article",
      body_markdown: "# Fundamentos\n\n[Material complementar](https://example.test/material)\n\n![Mapa da aula](data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=)\n\n- Primeiro passo\n- Segundo passo",
      attachments: [{ id: "legacy-image", revision: 1, file_name: "mapa-legado.gif", mime_type: "image/gif", size_bytes: 34, alt_text: "\u200b\u2069" }], downloadable: false,
    },
  }] }],
};
const enrollmentLearning = {
  enrollment: { id: "enrollment-synthetic", title: course.title, state: "active" },
  course: { id: course.id, title: course.title, payload: { description: "Matrícula sintética para validação do leitor de aulas." } },
  live_sessions: [],
  modules: [{ id: "module-synthetic", title: "Módulo 1", completed: false, available: true,
    progress: { required_total: 1, required_completed: 0, percent: 0 }, payload: { summary: "Resumo do módulo." }, units: [],
    lessons: [{ id: "lesson-synthetic", title: "Aula Semântica", revision: 1, completed: false, available: true,
      payload: { content_type: "article", body_markdown: "# Fundamentos\n\n[](https://example.test/legacy-link)\n\n![\u200b\u2069](https://example.test/legacy-image.png)",
        attachments: [{ id: "legacy-image", revision: 1, file_name: "mapa-legado.gif", mime_type: "image/gif", size_bytes: 34, alt_text: "\u200b\u2069" }], downloadable: false },
    }],
  }],
  progress: { required_total: 1, required_completed: 0, percent: 0 },
  attendance: { percent: null, minimum_percent: 75, attended_minutes: 0, scheduled_minutes: 0, sessions_present: 0, sessions_absent: 0, sessions_unmarked: 0, meets_minimum: null },
  workload_progress: { attended_class_hours: 0, validated_practice_hours: 0, completed_hours: 0 },
  submissions: [], assignments: [], practices: [],
};
const subscription = {
  id: "subscription-synthetic", workspace_id: workspace.id, plan_record_id: "plan-synthetic",
  state: "active", billing_interval: "month", price_amount: "1000", currency: "BRL",
  plan_title: "Plano de teste", course_record_ids: [course.id],
};
const emptyBrand = {
  app_name: "Suindá", icon_kind: "orbit", custom_icon_data: null,
  login_tagline: "Aprenda no seu ritmo.", login_description: "Cursos em um só lugar.", login_benefits: [],
};
const json = (data) => ({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(data) });
const mutatingRequests = [];
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}), args: ["--no-sandbox"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(({ currentUser }) => {
    localStorage.setItem("orbit_token", "synthetic-subscription-token");
    localStorage.setItem("orbit_user", JSON.stringify(currentUser));
  }, { currentUser: user });
  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      mutatingRequests.push({ method: request.method(), pathname });
      return route.fulfill(json({ error: "Mutations are disabled in this synthetic check." }));
    }
    if (/\/attachments\/\d+\/[^/]+\/preview$/.test(pathname)) return route.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64") });
    if (pathname.endsWith("/me/enrollments/enrollment-synthetic/lessons/lesson-synthetic/materials/legacy-image/preview")) return route.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64") });
    if (pathname === "/api/auth/me") return route.fulfill(json(user));
    if (pathname === "/api/plugins") return route.fulfill(json({ plugins: [{
      id: "suinda-learning", name: "Aprendizagem Suindá", enabled: true, status: "active", version: "1.0.0",
      actions: [], capabilities: [], contributions: { navigation: [] },
    }] }));
    if (pathname === "/api/branding") return route.fulfill(json(emptyBrand));
    if (pathname === "/api/public/workspace-branding/host") return route.fulfill(json(null));
    if (pathname === "/api/home") return route.fulfill(json({ upNext: [], highlights: [], yourItems: [], recentBoards: [], favorites: [], recentConversations: [] }));
    if (["/api/boards", "/api/workspaces/options"].includes(pathname)) return route.fulfill(json([]));
    if (pathname === "/api/notifications/unread-count") return route.fulfill(json({ unread_count: 0 }));
    if (pathname === "/api/workspaces") return route.fulfill(json([workspace]));
    if (pathname.endsWith(`/extensions/suinda-subscriptions/workspaces/${workspace.id}/plans`)) return route.fulfill(json([]));
    if (pathname.endsWith("/extensions/suinda-subscriptions/me/subscriptions")) return route.fulfill(json([subscription]));
    if (pathname.endsWith(`/extensions/suinda-subscriptions/workspaces/${workspace.id}/content/${course.id}`)) return route.fulfill(json(course));
    if (pathname.endsWith("/extensions/suinda-learning/me/enrollments/enrollment-synthetic/learning")) return route.fulfill(json(enrollmentLearning));
    return route.fulfill(json([]));
  });
  await page.route(/^https?:\/\/(?!localhost(?::\d+)?\/).*/, (route) => route.abort());

  await page.goto(`${baseUrl}/suinda/subscriptions?workspaceId=${workspace.id}`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("button", { name: "Abrir conteúdo", exact: true }).click();
  await page.getByRole("heading", { name: "Fundamentos", level: 6 }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Material complementar" }).count(), 1);
  assert.equal(await page.locator('img[alt="Mapa da aula"]').count(), 1);
  assert.equal(await page.getByRole("listitem").filter({ hasText: "Primeiro passo" }).count(), 1);
  assert.equal(await page.getByText("# Fundamentos", { exact: false }).count(), 0);
  await page.getByRole("button", { name: "Visualizar material", exact: true }).click();
  await page.locator('img[alt="Imagem sem descrição alternativa"]').waitFor();
  assert.equal(await page.getByText("Descrição alternativa pendente. Solicite uma descrição à equipe docente.").count(), 1);
  assert.deepEqual(mutatingRequests, [], "the browser fixture must intercept only reads during this journey");

  await page.addScriptTag({ path: axePath });
  const axe = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] },
  }));
  const violations = axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.slice(0, 20).map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  assert.deepEqual(violations, [], `the rendered subscription reader must pass automated WCAG A/AA rules: ${JSON.stringify(violations)}`);

  await page.goto(`${baseUrl}/suinda/learning/enrollment-synthetic`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.addScriptTag({ path: axePath });
  await page.getByRole("heading", { name: "Fundamentos", level: 3 }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Link sem descrição: https://example.test/legacy-link" }).count(), 1);
  assert.equal(await page.locator('img[alt="Imagem sem descrição alternativa"]').count(), 2);
  await page.getByText("Descrição alternativa pendente. Solicite uma descrição à equipe docente.").waitFor();
  const enrollmentAxe = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] },
  }));
  const enrollmentViolations = enrollmentAxe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.slice(0, 20).map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  assert.deepEqual(enrollmentViolations, [], `the rendered enrollment reader must pass automated WCAG A/AA rules: ${JSON.stringify(enrollmentViolations)}`);
  assert.deepEqual(mutatingRequests, [], "both synthetic reader journeys must intercept only reads");
  console.log("PASS: leitores por assinatura e matrícula renderizam Markdown semântico; links vazios e alts Unicode invisíveis recebem nomes/fallbacks; Axe WCAG 2.2 A/AA sem violações nas duas jornadas; nenhuma mutação à API.");
} finally {
  await browser.close();
}
