import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const baseUrl = (process.env.SUINDA_A11Y_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const baseOrigin = new URL(baseUrl).origin;
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find(candidate => existsSync(candidate));
const boardId = "synthetic-context-board";
const cardId = "synthetic-context-card";
const listId = "synthetic-context-list";
const cardToken = "synthetic-context-token";
const user = { id: "synthetic-a11y-user", name: "Pessoa de teste", email: "a11y@example.invalid",
  role: "root", is_root: true, permissions: ["*"], preferences: { theme: "dark", shortcuts: true } };
const card = { id: cardId, url_token: cardToken, kind: "normal", list_id: listId,
  title: "Cartão sintético para testar contexto", description: "", position: 0,
  start_date: null, due_date: null, reminder_minutes: null, recurrence: null,
  labels: [], comment_count: 0, checklist_total: 0, checklist_done: 0 };
const board = { id: boardId, title: "Quadro sintético de acessibilidade", background: "blue", starred: false,
  owner_id: user.id, lists: [{ id: listId, board_id: boardId, title: "A fazer", position: 0,
    color: null, collapsed: false, cards: [card] }], labels: [], members: [], custom_fields: [] };
const candidates = [
  { id: "synthetic-context-one", title: "Contexto sintético Alpha", url_token: "synthetic-alpha" },
  { id: "synthetic-context-two", title: "Contexto sintético Beta", url_token: "synthetic-beta" },
];
const viewState = { canWrite: false, views: [], preferredViewId: null, savedFilters: [] };
const contextsResponse = selected => ({ selected, candidates, children: [], inherited: [], prompt: "" });

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}),
  args: ["--no-sandbox"] });
const results = [];
try {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(currentUser => {
      localStorage.setItem("orbit_token", "synthetic-a11y-token-never-valid-outside-this-browser");
      localStorage.setItem("orbit_user", JSON.stringify(currentUser));
    }, user);
    const page = await context.newPage();
    const apiRequests = [];
    const mutationRequests = [];
    const unexpectedApiRequests = [];
    const pageErrors = [];
    let selectedContexts = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.route("**/socket.io/**", route => route.abort("blockedbyclient"));
    await page.route("**/*", async route => {
      if (new URL(route.request().url()).origin !== baseOrigin) await route.abort("blockedbyclient");
      else await route.fallback();
    });
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api/, "");
      apiRequests.push(`${request.method()} ${path}`);
      const respond = (data, status = 200) => route.fulfill({ status,
        contentType: "application/json; charset=utf-8", body: JSON.stringify(data) });
      if (request.method() !== "GET" && request.method() !== "HEAD" && request.method() !== "OPTIONS") {
        if (path === `/cards/${cardId}/contexts` && request.method() === "PATCH") {
          const body = request.postDataJSON();
          mutationRequests.push({ path, body });
          selectedContexts = body.ids.map(id => candidates.find(item => item.id === id)).filter(Boolean);
          return respond(contextsResponse(selectedContexts));
        }
        mutationRequests.push({ path, method: request.method() });
        return respond({ ok: true, synthetic: true });
      }
      if (path === "/auth/me") return respond(user);
      if (path === "/plugins") return respond({ plugins: [] });
      if (path === "/notifications") return respond([]);
      if (path === "/boards") return respond([board]);
      if (path === `/boards/${boardId}`) return respond(board);
      if (path === `/boards/${boardId}/card-types`) return respond({ types: [] });
      if (path === `/boards/${boardId}/views`) return respond(viewState);
      if (path === "/inbox/cards") return respond([]);
      if (path === "/branding" || path === "/public/workspace-branding/host") return respond({});
      if (path === `/cards/${cardId}/details`) return respond({ comments: [], checklist: [], externalResources: [], attachments: [] });
      if (path === `/cards/${cardId}/plugins`) return respond({ selected: [], available: [], slots: [], data: {} });
      if (path === `/cards/${cardId}/type`) return respond({ types: [], currentTypeId: null });
      if (path === `/cards/${cardId}/extensions`) return respond({ checklists: [], values: [] });
      if (path === `/cards/${cardId}/contexts`) return respond(contextsResponse(selectedContexts));
      unexpectedApiRequests.push(`${request.method()} ${path}`);
      return respond({});
    });
    const response = await page.goto(`${baseUrl}/board/${boardId}?card=${cardId}&token=${cardToken}`,
      { waitUntil: "networkidle", timeout: 30000 });
    assert.equal(response?.status(), 200, `${viewport.name}: rota do quadro deve carregar`);
    const section = page.getByRole("region", { name: "Contextos associados" });
    await section.waitFor({ state: "visible" });
    const add = section.getByRole("button", { name: "Adicionar contexto" });
    await add.click();
    const input = section.getByRole("combobox", { name: "Buscar cartão de contexto 1" });
    await input.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.activeElement === document.querySelector(
      '[role="combobox"][aria-label="Buscar cartão de contexto 1"]'));
    assert.equal(await input.getAttribute("aria-expanded"), "true");

    await page.addScriptTag({ path: axePath });
    const openedAxe = await page.evaluate(async () => {
      const root = document.querySelector('[aria-label="Contextos associados"]');
      return window.axe.run(root, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } });
    });
    assert.deepEqual(openedAxe.violations.map(item => item.id), [], `${viewport.name}: Axe deve aprovar o combobox aberto`);

    await input.press("ArrowDown");
    const firstId = await input.getAttribute("aria-activedescendant");
    assert.ok(firstId, `${viewport.name}: ArrowDown deve expor a opção ativa`);
    assert.equal(await page.locator(`#${firstId}`).getAttribute("aria-selected"), "true");
    await input.press("Escape");
    assert.equal(await input.getAttribute("aria-expanded"), "false", `${viewport.name}: Escape deve fechar a lista`);
    assert.equal(await input.getAttribute("aria-activedescendant"), null);
    assert.equal(mutationRequests.length, 0, `${viewport.name}: Escape não deve salvar alterações`);

    await input.click();
    await page.waitForFunction(() => Boolean(document.querySelector(
      '[role="combobox"][aria-label="Buscar cartão de contexto 1"]')?.getAttribute("aria-activedescendant")));
    const activeFirstId = await input.getAttribute("aria-activedescendant");
    await input.press("ArrowDown");
    const activeSecondId = await input.getAttribute("aria-activedescendant");
    assert.notEqual(activeSecondId, activeFirstId, `${viewport.name}: setas devem percorrer as opções`);
    assert.equal(await page.locator(`#${activeSecondId}`).getAttribute("aria-selected"), "true");
    await input.press("Enter");
    await section.getByRole("link", { name: "Abrir contexto associado Contexto sintético Beta" }).waitFor({ state: "visible" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")
      === "Abrir contexto associado Contexto sintético Beta");
    assert.deepEqual(mutationRequests, [{ path: `/cards/${cardId}/contexts`, body: { ids: [candidates[1].id] } }]);
    assert.deepEqual(unexpectedApiRequests, [], `${viewport.name}: todas as chamadas da jornada devem ter fixture explícita`);
    assert.deepEqual(pageErrors, [], `${viewport.name}: não deve haver erros de runtime`);
    results.push({ viewport: viewport.name, api_requests: apiRequests.length, mutations: mutationRequests.length,
      axe_violations: openedAxe.violations.length, steps: ["Adicionar contexto foca o combobox", "setas atualizam opção ativa e aria-selected",
        "Escape fecha sem persistir", "Enter salva a opção ativa e move o foco ao contexto escolhido"] });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ status: "passed", standard: "WCAG 2.2 AA keyboard interaction and axe checks",
  route: "/board/synthetic-context-board", route_viewports: results.length, external_origins_blocked: true,
  mutations_fulfilled_only_by_local_fixtures: true, results }, null, 2));
