import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

// Requires an already-running local preview; never starts or stops Orbit services.
// All API requests are intercepted. Non-GET requests are aborted before reaching an API.
const baseUrl = (process.env.SUINDA_A11Y_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/google/chrome/chrome"]
  .find((candidate) => existsSync(candidate));
const boardId = "00000000-0000-4000-8000-000000000444";
const token = "orbit-modal-keyboard-audit-session";
const cardId = "00000000-0000-4000-8000-000000000447";
const user = {
  id: "00000000-0000-4000-8000-000000000445",
  name: "Pessoa sintética de auditoria",
  email: "modal-a11y@example.invalid",
  is_root: true,
  permissions: ["boards.write"],
  preferences: { theme: "dark", notifications: false, browserNotifications: false, emailNotifications: false, shortcuts: false, compactCards: false },
};
const board = {
  id: boardId,
  title: "Quadro sintético para auditoria de modal",
  background: "blue",
  starred: false,
  owner_id: user.id,
  lists: [{ id: "00000000-0000-4000-8000-000000000446", board_id: boardId,
    title: "Lista sintética", position: 0, color: null, collapsed: false,
    cards: [{ id: "00000000-0000-4000-8000-000000000447", list_id: "00000000-0000-4000-8000-000000000446",
      title: "Cartão sintético para teclado", description: "", position: 0, start_date: null, due_date: null,
      reminder_minutes: null, recurrence: null, labels: [], comment_count: 0, checklist_total: 0, checklist_done: 0 }] }],
  labels: [],
  members: [],
  custom_fields: [],
};
const plugins = [{ id: "project-boards", enabled: true, contributions: {} }];
const viewState = { canWrite: true, views: [{ id: "board", name: "Quadro", renderer: "board", permission: "board.read", pluginId: "project-boards" }], preferredViewId: "board", savedFilters: [] };
const cardTypes = { types: [] };
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}), args: ["--no-sandbox"] });
const results = [];
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const blockedWrites = [];
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(({ sessionToken, sessionUser }) => {
      localStorage.setItem("orbit_token", sessionToken);
      localStorage.setItem("orbit_user", JSON.stringify(sessionUser));
    }, { sessionToken: token, sessionUser: user });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const method = request.method().toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        blockedWrites.push({ method, path: new URL(request.url()).pathname });
        await route.abort("blockedbyclient");
        return;
      }
      const path = new URL(request.url()).pathname.replace(/^\/api(?=\/)/, "");
      let body = {};
      if (path === "/auth/me") body = user;
      else if (path === "/plugins") body = { plugins };
      else if (path === "/boards") body = [board];
      else if (path === `/boards/${boardId}`) body = board;
      else if (path === `/boards/${boardId}/views`) body = viewState;
      else if (path === `/boards/${boardId}/card-types`) body = cardTypes;
      else if (path === `/cards/${cardId}/details`) body = { comments: [], checklist: [], externalResources: [], attachments: [] };
      else if (path === `/cards/${cardId}/plugins`) body = { selected: [], available: [], slots: [], data: {} };
      else if (path === `/cards/${cardId}/type`) body = { types: [], requiresSelection: false, currentTypeId: null };
      else if (path === `/cards/${cardId}/extensions`) body = { checklists: [], values: [] };
      else if (path === `/cards/${cardId}/contexts`) body = { prompt: "", selected: [], candidates: [] };
      else if (path === `/cards/${cardId}/prompt-runs`) body = [];
      else if (path === "/ai/models") body = [];
      else if (path === "/notifications") body = [];
      else if (path === "/inbox/cards") body = [];
      else if (path === "/tools/diagnostics") body = { status: "ready" };
      else if (path.startsWith("/boards/") && path.endsWith("/activity")) body = [];
      else if (path.startsWith("/boards/") && path.endsWith("/trello")) body = [];
      else if (path.startsWith("/boards/") && path.endsWith("/trello/available")) body = [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    // Keep websocket/socket.io clients offline; this audit is entirely fixture-backed.
    await page.route("**/socket.io/**", (route) => route.abort("blockedbyclient"));

    const result = { viewport: viewport.name, checks: {}, blocked_writes: blockedWrites, page_errors: pageErrors };
    try {
      const response = await page.goto(`${baseUrl}/board/${boardId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      result.checks.route_loaded = Boolean(response && response.status() < 400);
      await page.getByRole("button", { name: "Criar", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
      result.checks.fixture_board_rendered = await page.getByRole("button", { name: board.title, exact: true }).count() > 0;
      const actionTrigger = page.getByRole("button", { name: "Ações do cartão", exact: true });
      await actionTrigger.focus();
      await page.keyboard.press("ArrowDown");
      const menuItems = page.getByRole("menuitem");
      await menuItems.first().waitFor({ state: "visible" });
      result.checks.card_menu_opens_on_arrow_down = await menuItems.first().evaluate((element) => element === document.activeElement);
      await page.keyboard.press("ArrowDown");
      result.checks.card_menu_arrow_down_moves_focus = await menuItems.nth(1).evaluate((element) => element === document.activeElement);
      await page.keyboard.press("End");
      result.checks.card_menu_end_moves_to_last = await menuItems.last().evaluate((element) => element === document.activeElement);
      await page.keyboard.press("Home");
      result.checks.card_menu_home_moves_to_first = await menuItems.first().evaluate((element) => element === document.activeElement);
      await page.keyboard.press("ArrowUp");
      result.checks.card_menu_arrow_up_wraps_to_last = await menuItems.last().evaluate((element) => element === document.activeElement);
      await page.keyboard.press("Escape");
      result.checks.card_menu_escape_closes_and_restores_focus = (await page.getByRole("menuitem").count()) === 0
        && await actionTrigger.evaluate((element) => element === document.activeElement);
      await page.keyboard.press("Enter");
      result.checks.card_menu_opens_on_enter = await menuItems.first().waitFor({ state: "visible" }).then(() => true);
      result.checks.card_menu_enter_focuses_first = await menuItems.first().evaluate((element) => element === document.activeElement);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Space");
      result.checks.card_menu_opens_on_space = await menuItems.first().waitFor({ state: "visible" }).then(() => true);
      result.checks.card_menu_space_focuses_first = await menuItems.first().evaluate((element) => element === document.activeElement);
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowUp");
      result.checks.card_menu_arrow_up_opens_on_last = await menuItems.last().waitFor({ state: "visible" }).then(async () =>
        await menuItems.last().evaluate((element) => element === document.activeElement));
      await page.keyboard.press("Tab");
      result.checks.card_menu_tab_closes_without_trapping = await page.getByRole("menuitem").count() === 0;
      result.card_menu_focus_after_tab = await page.evaluate(() => ({ tag: document.activeElement?.tagName || null,
        label: document.activeElement instanceof HTMLElement ? document.activeElement.getAttribute("aria-label") : null,
        text: document.activeElement instanceof HTMLElement ? document.activeElement.innerText?.trim().slice(0, 80) || null : null }));
      result.checks.card_menu_tab_moves_focus_outside_menu = await page.evaluate(() => document.activeElement instanceof HTMLElement
        && document.activeElement !== document.body && !document.activeElement.closest('[role="menu"]'));

      const cardLocator = page.locator(`[data-card-id="${cardId}"]`);
      const cardTrigger = cardLocator.locator("xpath=..");
      await cardTrigger.focus();
      await cardLocator.click({ position: { x: 20, y: 12 } });
      const cardDialog = page.getByRole("dialog", { name: "Cartão: Cartão sintético para teclado", exact: true });
      await cardDialog.waitFor({ state: "visible", timeout: 8_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      result.checks.card_dialog_has_accessible_name = await cardDialog.count() === 1
        && Boolean(await cardDialog.getAttribute("aria-label"));
      result.checks.card_dialog_initial_focus_inside = await cardDialog.evaluate((element) => element.contains(document.activeElement));
      result.checks.card_dialog_focuses_title = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Título do cartão");
      await page.addScriptTag({ path: axePath });
      result.card_dialog_axe = await page.evaluate(async () => {
        const report = await window.axe.run(document.querySelector('[role="dialog"]'), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] },
        });
        return report.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help,
          nodes: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }));
      });
      result.checks.card_dialog_axe_clean = result.card_dialog_axe.length === 0;

      const labelsTrigger = cardDialog.getByRole("button", { name: "Etiquetas", exact: true });
      await labelsTrigger.focus();
      await page.keyboard.press("Enter");
      const labelsDialog = page.getByRole("dialog", { name: "Etiquetas do cartão", exact: true });
      await labelsDialog.waitFor({ state: "visible", timeout: 8_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(250);
      result.checks.card_labels_dialog_has_contextual_name = await labelsDialog.count() === 1;
      result.checks.card_labels_dialog_initial_focus_inside = await labelsDialog.evaluate((element) => element.contains(document.activeElement));
      result.card_labels_dialog_axe = await page.evaluate(async () => {
        const report = await window.axe.run(document.querySelector('[role="dialog"][aria-label="Etiquetas do cartão"]'), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] },
        });
        return report.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help,
          nodes: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }));
      });
      result.checks.card_labels_dialog_axe_clean = result.card_labels_dialog_axe.length === 0;
      await page.keyboard.press("Escape");
      await labelsDialog.waitFor({ state: "hidden" });
      const labelsTriggerHandle = await labelsTrigger.elementHandle();
      if (!labelsTriggerHandle) throw new Error("O acionador de etiquetas foi removido ao fechar o subdiálogo.");
      await page.waitForFunction((element) => document.activeElement === element, labelsTriggerHandle, { timeout: 2_000 });
      result.checks.card_labels_dialog_escape_restores_focus = await labelsTrigger.evaluate((element) => element === document.activeElement);

      const datesTrigger = cardDialog.getByRole("button", { name: "Datas", exact: true });
      await datesTrigger.focus();
      await page.keyboard.press("Enter");
      const datesDialog = page.getByRole("dialog", { name: "Datas do cartão", exact: true });
      await datesDialog.waitFor({ state: "visible", timeout: 8_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(250);
      result.checks.card_dates_dialog_has_contextual_name = await datesDialog.count() === 1;
      result.checks.card_dates_dialog_initial_focus_inside = await datesDialog.evaluate((element) => element.contains(document.activeElement));
      result.card_dates_dialog_axe = await page.evaluate(async () => {
        const report = await window.axe.run(document.querySelector('[role="dialog"][aria-label="Datas do cartão"]'), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] },
        });
        return report.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.length }));
      });
      result.checks.card_dates_dialog_axe_clean = result.card_dates_dialog_axe.length === 0;
      await page.keyboard.press("Escape");
      await datesDialog.waitFor({ state: "hidden" });
      const datesTriggerHandle = await datesTrigger.elementHandle();
      if (!datesTriggerHandle) throw new Error("O acionador de datas foi removido ao fechar o subdiálogo.");
      await page.waitForFunction((element) => document.activeElement === element, datesTriggerHandle, { timeout: 2_000 });
      result.checks.card_dates_dialog_escape_restores_focus = await datesTrigger.evaluate((element) => element === document.activeElement);

      const moveTrigger = cardDialog.getByRole("button", { name: "Lista sintética", exact: true });
      await moveTrigger.focus();
      await page.keyboard.press("Enter");
      const moveDialog = page.getByRole("dialog", { name: "Mover cartão", exact: true });
      await moveDialog.waitFor({ state: "visible", timeout: 8_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(250);
      result.checks.card_move_dialog_has_contextual_name = await moveDialog.count() === 1;
      result.checks.card_move_dialog_initial_focus_inside = await moveDialog.evaluate((element) => element.contains(document.activeElement));
      result.card_move_dialog_axe = await page.evaluate(async () => {
        const report = await window.axe.run(document.querySelector('[role="dialog"][aria-label="Mover cartão"]'), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] },
        });
        return report.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.length }));
      });
      result.checks.card_move_dialog_axe_clean = result.card_move_dialog_axe.length === 0;
      await page.keyboard.press("Escape");
      await moveDialog.waitFor({ state: "hidden" });
      const moveTriggerHandle = await moveTrigger.elementHandle();
      if (!moveTriggerHandle) throw new Error("O acionador de movimento foi removido ao fechar o subdiálogo.");
      await page.waitForFunction((element) => document.activeElement === element, moveTriggerHandle, { timeout: 2_000 });
      result.checks.card_move_dialog_escape_restores_focus = await moveTrigger.evaluate((element) => element === document.activeElement);

      const cardFocusables = cardDialog.locator('a[href]:visible,button:not([disabled]):visible,input:not([disabled]):visible,select:not([disabled]):visible,textarea:not([disabled]):visible,[tabindex]:not([tabindex="-1"]):visible');
      result.checks.card_dialog_has_keyboard_stops = await cardFocusables.count() >= 3;
      await cardFocusables.last().focus();
      await page.keyboard.press("Tab");
      result.checks.card_dialog_tab_wraps_to_first = await cardFocusables.first().evaluate((element) => element === document.activeElement);
      await cardFocusables.first().focus();
      await page.keyboard.press("Shift+Tab");
      result.checks.card_dialog_shift_tab_wraps_to_last = await cardFocusables.last().evaluate((element) => element === document.activeElement);
      await page.keyboard.press("Escape");
      await cardDialog.waitFor({ state: "hidden" });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      result.checks.card_dialog_escape_closes = true;
      result.checks.card_dialog_focus_returns_to_card = await cardTrigger.evaluate((element) => element === document.activeElement);

      const boardToolsTrigger = page.getByRole("button", { name: "Menu do quadro", exact: true });
      await boardToolsTrigger.focus();
      await page.keyboard.press("Enter");
      const backgroundMenuItem = page.getByRole("button", { name: "Plano de fundo", exact: true });
      await backgroundMenuItem.waitFor({ state: "visible" });
      // The advanced-filter disclosure is the first stop in this menu, before its actions.
      for (let index = 0; index < 6; index += 1) await page.keyboard.press("Tab");
      result.checks.board_menu_tab_reaches_background_action = await backgroundMenuItem.evaluate((element) => element === document.activeElement);
      await page.keyboard.press("Enter");
      const backgroundDialog = page.getByRole("dialog", { name: "Plano de fundo", exact: true });
      await backgroundDialog.waitFor({ state: "visible" });
      result.checks.board_background_dialog_named = await backgroundDialog.count() === 1;
      result.checks.board_background_dialog_initial_focus_inside = await backgroundDialog.evaluate((element) => element.contains(document.activeElement));
      const backgroundColorButtons = backgroundDialog.getByRole("button", { name: /^Cor / });
      result.checks.board_background_color_buttons_labeled = await backgroundColorButtons.count() === 8
        && await backgroundColorButtons.evaluateAll((elements) => elements.every((element) => /^Cor (Azul|Turquesa|Roxo|Rosa|Laranja|Verde|Pôr do sol|Oceano)$/.test(element.getAttribute("aria-label") || "")));
      result.checks.board_background_selected_color_announced = await backgroundDialog.locator('button[aria-pressed="true"]').count() === 1
        && await backgroundDialog.getByRole("button", { name: "Cor Azul", exact: true }).getAttribute("aria-pressed") === "true";
      result.board_background_dialog_axe = await page.evaluate(async () => {
        const report = await window.axe.run(document.querySelector('[role="dialog"][aria-labelledby]'), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] },
        });
        return report.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.length }));
      });
      result.checks.board_background_dialog_axe_clean = result.board_background_dialog_axe.length === 0;
      const backgroundFocusables = backgroundDialog.locator('a[href]:visible,button:not([disabled]):visible,input:not([disabled]):visible,select:not([disabled]):visible,textarea:not([disabled]):visible,[tabindex]:not([tabindex="-1"]):visible');
      await backgroundFocusables.last().focus();
      await page.keyboard.press("Tab");
      result.checks.board_background_dialog_tab_wraps_to_first = await backgroundFocusables.first().evaluate((element) => element === document.activeElement);
      await page.keyboard.press("Escape");
      await backgroundDialog.waitFor({ state: "hidden" });
      await page.waitForTimeout(50);
      result.checks.board_background_dialog_escape_restores_menu_trigger = await boardToolsTrigger.evaluate((element) => element === document.activeElement);

      await page.keyboard.press("Enter");
      const aboutBoard = page.getByRole("button", { name: "Sobre este quadro", exact: true });
      await aboutBoard.waitFor({ state: "visible" });
      await aboutBoard.focus();
      await page.keyboard.press("Enter");
      const aboutDialog = page.getByRole("dialog", { name: "Sobre este quadro", exact: true });
      await aboutDialog.waitFor({ state: "visible", timeout: 8_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(250);
      result.checks.board_about_dialog_has_contextual_name = await aboutDialog.count() === 1;
      result.checks.board_about_dialog_initial_focus_inside = await aboutDialog.evaluate((element) => element.contains(document.activeElement));
      result.board_about_dialog_axe = await page.evaluate(async () => {
        const report = await window.axe.run(document.querySelector('[role="dialog"][aria-modal="true"]'), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] },
        });
        return report.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.length }));
      });
      result.checks.board_about_dialog_axe_clean = result.board_about_dialog_axe.length === 0;
      await page.keyboard.press("Escape");
      await aboutDialog.waitFor({ state: "hidden" });
      const boardToolsTriggerHandle = await boardToolsTrigger.elementHandle();
      if (!boardToolsTriggerHandle) throw new Error("O acionador do menu do quadro foi removido ao fechar Sobre este quadro.");
      await page.waitForFunction((element) => document.activeElement === element, boardToolsTriggerHandle, { timeout: 2_000 });
      result.checks.board_about_dialog_escape_restores_focus = await boardToolsTrigger.getAttribute("aria-expanded") === "false"
        && await boardToolsTrigger.evaluate((element) => element === document.activeElement);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Criar", exact: true }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Criar", exact: true }).click();
      const createBoardMenuItem = page.getByRole("button", { name: "Criar quadro", exact: true });
      await createBoardMenuItem.waitFor({ state: "visible" });
      await createBoardMenuItem.click();

      const dialog = page.getByRole("dialog", { name: "Criar quadro" });
      await dialog.waitFor({ state: "visible" });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      result.checks.dialog_has_accessible_name = await dialog.count() === 1;
      result.checks.initial_focus_inside_dialog = await dialog.evaluate((element) => element.contains(document.activeElement));
      result.checks.initial_focus_on_named_field = await page.evaluate(() => document.activeElement?.id === "board-title");

      const focusables = dialog.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      result.checks.dialog_has_multiple_keyboard_stops = await focusables.count() >= 3;
      await focusables.last().focus();
      await page.keyboard.press("Tab");
      result.checks.tab_wraps_to_first_control = await focusables.first().evaluate((element) => element === document.activeElement);
      await focusables.first().focus();
      await page.keyboard.press("Shift+Tab");
      result.checks.shift_tab_wraps_to_last_control = await focusables.last().evaluate((element) => element === document.activeElement);

      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      result.checks.escape_closes_dialog = true;
      result.checks.focus_returns_to_visible_trigger = await page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement && active.isConnected && active.getAttribute("aria-label") !== "" && active.textContent?.trim() === "Criar";
      });
      result.focused_after_close = await page.evaluate(() => ({
        tag: document.activeElement?.tagName || null,
        text: document.activeElement instanceof HTMLElement ? document.activeElement.innerText?.trim().slice(0, 80) || null : null,
        aria_label: document.activeElement instanceof HTMLElement ? document.activeElement.getAttribute("aria-label") : null,
      }));
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      results.push(result);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const requiredChecks = [
  "route_loaded",
  "fixture_board_rendered",
  "card_menu_opens_on_arrow_down",
  "card_menu_arrow_down_moves_focus",
  "card_menu_end_moves_to_last",
  "card_menu_home_moves_to_first",
  "card_menu_arrow_up_wraps_to_last",
  "card_menu_escape_closes_and_restores_focus",
  "card_menu_opens_on_enter",
  "card_menu_enter_focuses_first",
  "card_menu_opens_on_space",
  "card_menu_space_focuses_first",
  "card_menu_arrow_up_opens_on_last",
  "card_menu_tab_closes_without_trapping",
  "card_menu_tab_moves_focus_outside_menu",
  "card_dialog_has_accessible_name",
  "card_dialog_initial_focus_inside",
  "card_dialog_focuses_title",
  "card_dialog_axe_clean",
  "card_labels_dialog_has_contextual_name",
  "card_labels_dialog_initial_focus_inside",
  "card_labels_dialog_axe_clean",
  "card_labels_dialog_escape_restores_focus",
  "card_dates_dialog_has_contextual_name",
  "card_dates_dialog_initial_focus_inside",
  "card_dates_dialog_axe_clean",
  "card_dates_dialog_escape_restores_focus",
  "card_move_dialog_has_contextual_name",
  "card_move_dialog_initial_focus_inside",
  "card_move_dialog_axe_clean",
  "card_move_dialog_escape_restores_focus",
  "card_dialog_has_keyboard_stops",
  "card_dialog_tab_wraps_to_first",
  "card_dialog_shift_tab_wraps_to_last",
  "card_dialog_escape_closes",
  "card_dialog_focus_returns_to_card",
  "board_menu_tab_reaches_background_action",
  "board_background_dialog_named",
  "board_background_dialog_initial_focus_inside",
  "board_background_color_buttons_labeled",
  "board_background_selected_color_announced",
  "board_background_dialog_axe_clean",
  "board_background_dialog_tab_wraps_to_first",
  "board_background_dialog_escape_restores_menu_trigger",
  "board_about_dialog_has_contextual_name",
  "board_about_dialog_initial_focus_inside",
  "board_about_dialog_axe_clean",
  "board_about_dialog_escape_restores_focus",
  "dialog_has_accessible_name",
  "initial_focus_inside_dialog",
  "initial_focus_on_named_field",
  "dialog_has_multiple_keyboard_stops",
  "tab_wraps_to_first_control",
  "shift_tab_wraps_to_last_control",
  "escape_closes_dialog",
  "focus_returns_to_visible_trigger",
];
const failures = results.flatMap((result) => [
  ...requiredChecks.filter((check) => result.checks?.[check] !== true).map((check) => `${result.viewport}: ${check}`),
  ...(result.error ? [`${result.viewport}: ${result.error}`] : []),
  ...(result.blocked_writes?.length ? [`${result.viewport}: ${result.blocked_writes.length} non-GET requests were blocked`] : []),
  ...(result.page_errors?.length ? [`${result.viewport}: ${result.page_errors.length} uncaught page error(s)`] : []),
]);
console.log(JSON.stringify({
  base_url: baseUrl,
  route: `/board/${boardId}`,
  modes: ["synthetic authenticated fixture"],
  viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
  api_mode: "GET fixtures; all non-GET requests aborted before reaching the API",
  required_checks: requiredChecks,
  failure_count: failures.length,
  failures,
  results,
}, null, 2));
if (failures.length) process.exitCode = 1;
