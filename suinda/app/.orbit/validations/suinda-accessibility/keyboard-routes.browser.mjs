import { existsSync } from "node:fs";
import { chromium } from "playwright";

const baseUrl = (process.env.SUINDA_A11Y_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find((candidate) => existsSync(candidate));
const stepLimit = Math.max(20, Math.min(300, Number.parseInt(process.env.SUINDA_KEYBOARD_MAX_STEPS || "180", 10) || 180));
const routes = [
  "/", "/auth/login", "/auth/register", "/auth/recover", "/auth/reset", "/profile", "/workspaces",
  "/calendar", "/search", "/inbox", "/plugins", "/access", "/extensions", "/boards", "/suinda", "/suinda/catalog",
  "/suinda/course/00000000-0000-4000-8000-000000000301",
  "/suinda/certificates/SUINDA-00000000-0000-4000-8000-000000000302", "/suinda/checkin",
  "/suinda/learning/00000000-0000-4000-8000-000000000303",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/agreements",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/assessments",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/attendance",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/documents",
  "/suinda/learning/00000000-0000-4000-8000-000000000303/surveys",
  "/suinda/messages/00000000-0000-4000-8000-000000000303", "/suinda/privacy", "/suinda/privacy-management",
  "/suinda/profile", "/suinda/reports", "/suinda/alumni", "/suinda/affiliates", "/suinda/corporate",
  "/suinda/subscriptions", "/suinda/integrations/certificate-signing", "/suinda/integrations/crm",
  "/suinda/integrations/open-badges", "/suinda/portfolio", "/suinda/terms",
];
const requestedRoutes = process.env.SUINDA_KEYBOARD_ROUTES?.split(",").map((route) => route.trim()).filter(Boolean);
const selectedRoutes = requestedRoutes?.length ? routes.filter((route) => requestedRoutes.includes(route)) : routes;
if (requestedRoutes?.length && selectedRoutes.length !== new Set(requestedRoutes).size) {
  throw new Error("SUINDA_KEYBOARD_ROUTES contém rota inexistente ou duplicada.");
}
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];
const auditEmail = process.env.SUINDA_A11Y_EMAIL;
const auditPassword = process.env.SUINDA_A11Y_PASSWORD;
if (Boolean(auditEmail) !== Boolean(auditPassword)) {
  throw new Error("Configure SUINDA_A11Y_EMAIL e SUINDA_A11Y_PASSWORD juntos para ativar a varredura autenticada.");
}
let authenticatedSession = null;
if (auditEmail && auditPassword) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: auditEmail, password: auditPassword }),
  });
  if (!login.ok) throw new Error(`Login de auditoria recusado (HTTP ${login.status}); nenhuma credencial foi registrada.`);
  const session = await login.json();
  if (!session.token) throw new Error("A conta de auditoria exige autenticação adicional ou não criou sessão.");
  authenticatedSession = { token: session.token, user: session.user };
}
const modes = [{ name: "anonymous", session: null }];
if (authenticatedSession) modes.push({ name: "authenticated", session: authenticatedSession });

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}), args: ["--no-sandbox"] });
const results = [];
const focusableSelector = [
  "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])", "select:not([disabled])",
  "textarea:not([disabled])", "iframe", "object", "embed", "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])",
].join(",");

try {
  for (const mode of modes) {
    for (const viewport of viewports) {
      for (const route of selectedRoutes) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      if (mode.session) {
        await page.addInitScript(({ token, user }) => {
          localStorage.setItem("orbit_token", token);
          if (user) localStorage.setItem("orbit_user", JSON.stringify(user));
        }, mode.session);
      }
      let response = null;
      try {
        response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 30000 });
        if (!response || response.status() >= 400) {
          results.push({ route, viewport: viewport.name, status: response?.status() ?? null, error: "Rota não respondeu com sucesso; varredura de foco ignorada." });
          continue;
        }
        // Hide the Next.js development toolbar, which is browser tooling and not part of Orbit.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

        const expectedFocusableCount = await page.locator(focusableSelector).evaluateAll((elements) => elements.filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
            && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })
            && !element.hasAttribute("disabled");
        }).length);
        const maxSteps = Math.min(stepLimit, Math.max(24, Math.min(220, expectedFocusableCount * 2 + 12)));
        const visited = new Map();
        const sequence = [];
        const diagnostics = [];
        let iframeSkipped = false;
        let naturalCycle = false;
        let suspectedTrap = false;
        let bodyBeforeCycle = false;

        for (let step = 1; step <= maxSteps; step += 1) {
          await page.keyboard.press("Tab");
          await page.evaluate(async () => {
            const active = document.activeElement;
            const animations = active?.getAnimations({ subtree: false }) ?? [];
            await Promise.race([
              Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))),
              new Promise((resolve) => setTimeout(resolve, 250)),
            ]);
          });
          const state = await page.evaluate(() => {
            const element = document.activeElement;
            if (!element || element === document.body || element === document.documentElement) {
              return { kind: "body", tag: element?.tagName?.toLowerCase() || null };
            }
            if (element instanceof HTMLIFrameElement) return { kind: "iframe", tag: "iframe", title: element.title || null, src: element.src || null };
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const name = element.getAttribute("aria-label") || element.getAttribute("title")
              || element.innerText?.replace(/\s+/g, " ").trim().slice(0, 100) || element.value || "";
            const path = [];
            let current = element;
            while (current && current !== document.body && path.length < 8) {
              const parent = current.parentElement;
              const index = parent ? [...parent.children].indexOf(current) : 0;
              path.unshift(`${current.tagName.toLowerCase()}:nth-child(${index + 1})`);
              current = parent;
            }
            const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
            const outlineVisible = style.outlineStyle !== "none" && outlineWidth >= 1 && style.outlineColor !== "rgba(0, 0, 0, 0)";
            const shadowVisible = style.boxShadow !== "none";
            const rectVisible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
            const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
            return {
              kind: "element", key: element.id ? `#${element.id}` : path.join(" > "), tag: element.tagName.toLowerCase(),
              input_type: element instanceof HTMLInputElement ? element.type : null,
              role: element.getAttribute("role"), name, href: element instanceof HTMLAnchorElement ? element.href : null,
              tabIndex: element.tabIndex, visible: rectVisible, in_viewport: inViewport,
              focus_indicator: outlineVisible || shadowVisible,
              outline: { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor },
              box_shadow: style.boxShadow !== "none" ? style.boxShadow : null,
              rect: { top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), left: Math.round(rect.left) },
            };
          });

          if (state.kind === "iframe") {
            iframeSkipped = true;
            diagnostics.push({ type: "iframe_focus_uninspected", step, ...state, note: "O foco entrou em iframe; o documento incorporado não é inspecionado por este roteiro." });
            break;
          }
          if (state.kind === "body") {
            sequence.push({ step, target: "body" });
            if (step > 1) {
              const coverage = expectedFocusableCount ? visited.size / expectedFocusableCount : 1;
              if (coverage < 0.6) {
                bodyBeforeCycle = true;
                diagnostics.push({ type: "focus_returned_to_body", step, unique_targets: visited.size,
                  estimated_focusable_targets: expectedFocusableCount,
                  note: "O foco voltou ao body antes de percorrer a maioria dos elementos focáveis visíveis estimados." });
              } else {
                naturalCycle = true;
                diagnostics.push({ type: "tab_order_completed", step, unique_targets: visited.size,
                  estimated_focusable_targets: expectedFocusableCount,
                  note: "O foco deixou os elementos do documento após percorrer a maioria dos candidatos estimados." });
              }
            }
            break;
          }

          sequence.push({ step, target: state.key, tag: state.tag, name: state.name });
          if (!state.visible) diagnostics.push({ type: "focused_element_not_visible", step, target: state });
          if (!state.in_viewport) diagnostics.push({ type: "focused_element_outside_viewport", step, target: state });
          if (!state.focus_indicator) diagnostics.push({ type: "focus_indicator_not_detected", step, target: state,
            note: "Heurística: não foi detectado outline de pelo menos 1px nem box-shadow; revisar manualmente possíveis indicadores por borda ou estilo customizado." });

          if (visited.has(state.key)) {
            if (state.tag === "input" && ["date", "time", "datetime-local", "month", "week"].includes(state.input_type)) {
              diagnostics.push({ type: "native_segment_repeat", step, target: state, note: "O navegador manteve o foco no campo temporal ao percorrer subcontroles internos; a sequência de segmentos nativos não é observável pelo DOM." });
              continue;
            }
            const firstStep = visited.get(state.key);
            const uniqueSeen = visited.size;
            const plausibleCount = Math.max(1, expectedFocusableCount);
            const likelyContainedLoop = firstStep > 1 && uniqueSeen < Math.max(3, Math.ceil(plausibleCount * 0.75));
            const insideModal = await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open], [role="dialog"][aria-modal="true"]')));
            if (likelyContainedLoop && !insideModal) {
              suspectedTrap = true;
              diagnostics.push({ type: "suspected_focus_cycle_or_trap", step, first_seen_at: firstStep, unique_targets_before_repeat: uniqueSeen,
                estimated_focusable_targets: expectedFocusableCount, note: "O foco repetiu um alvo antes de visitar a maioria dos elementos focáveis estimados." });
            } else {
              naturalCycle = true;
              diagnostics.push({ type: insideModal ? "focus_scope_cycle" : "tab_order_cycle", step, first_seen_at: firstStep, unique_targets: uniqueSeen,
                note: insideModal ? "O foco repetiu dentro do diálogo modal acessível, como esperado para um escopo modal." : "O foco voltou a um alvo anterior após percorrer os candidatos; parece ser o wrap normal da ordem de Tab." });
            }
            break;
          }
          visited.set(state.key, step);
        }

        if (!naturalCycle && !suspectedTrap && !iframeSkipped && !bodyBeforeCycle && sequence.length >= maxSteps) {
          diagnostics.push({ type: "step_limit_reached", steps: maxSteps, expected_focusable_targets: expectedFocusableCount,
            note: "Limite atingido sem observar retorno ao body ou repetição; a rota pode ter ordem longa, conteúdo dinâmico ou uma armadilha além do limite." });
        }
        const expectedReverse = [...visited.keys()].reverse();
        const reverseSequence = [];
        let reverseComplete = true;
        await page.evaluate(async () => {
          window.scrollTo(0, 0);
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body) active.blur();
          const animations = document.activeElement?.getAnimations({ subtree: false }) ?? [];
          await Promise.race([
            Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))),
            new Promise((resolve) => setTimeout(resolve, 250)),
          ]);
        });
        for (let step = 1; step <= maxSteps && reverseSequence.length < expectedReverse.length; step += 1) {
          await page.keyboard.press("Shift+Tab");
          await page.evaluate(async () => {
            const animations = document.activeElement?.getAnimations({ subtree: false }) ?? [];
            await Promise.race([
              Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))),
              new Promise((resolve) => setTimeout(resolve, 250)),
            ]);
          });
          const state = await page.evaluate(() => {
            const element = document.activeElement;
            if (!element || element === document.body || element === document.documentElement) return { kind: "body" };
            if (element instanceof HTMLIFrameElement) return { kind: "iframe", title: element.title || null, src: element.src || null };
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const path = [];
            let current = element;
            while (current && current !== document.body && path.length < 8) {
              const parent = current.parentElement;
              const index = parent ? [...parent.children].indexOf(current) : 0;
              path.unshift(`${current.tagName.toLowerCase()}:nth-child(${index + 1})`);
              current = parent;
            }
            const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
            return {
              kind: "element", key: element.id ? `#${element.id}` : path.join(" > "),
              tag: element.tagName.toLowerCase(),
              input_type: element instanceof HTMLInputElement ? element.type : null,
              visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0,
              in_viewport: rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth,
              focus_indicator: style.outlineStyle !== "none" && outlineWidth >= 1 && style.outlineColor !== "rgba(0, 0, 0, 0)"
                || style.boxShadow !== "none",
            };
          });
          if (state.kind === "body") {
            reverseComplete = reverseSequence.length === expectedReverse.length;
            break;
          }
          if (state.kind === "iframe") {
            reverseComplete = false;
            diagnostics.push({ type: "reverse_iframe_focus_uninspected", step, ...state,
              note: "A ordem reversa entrou em iframe, cujo documento não é inspecionado por este roteiro." });
            break;
          }
          if (!state.visible) diagnostics.push({ type: "reverse_focused_element_not_visible", step, target: state });
          if (!state.in_viewport) diagnostics.push({ type: "reverse_focused_element_outside_viewport", step, target: state });
          if (!state.focus_indicator) diagnostics.push({ type: "reverse_focus_indicator_not_detected", step, target: state,
            note: "Heurística: não foi detectado outline de pelo menos 1px nem box-shadow no percurso Shift+Tab." });
          if (reverseSequence.includes(state.key)) {
            if (state.tag === "input" && ["date", "time", "datetime-local", "month", "week"].includes(state.input_type)) {
              diagnostics.push({ type: "reverse_native_segment_repeat", step, target: state,
                note: "O navegador manteve o foco em segmentos internos do controle temporal; a sequência não é observável pelo DOM." });
              continue;
            }
            reverseComplete = reverseSequence.length === expectedReverse.length;
            break;
          }
          reverseSequence.push(state.key);
        }
        if (reverseSequence.length >= expectedReverse.length) reverseComplete = true;
        const reverseOrderMatches = reverseSequence.length === expectedReverse.length
          && reverseSequence.every((target, index) => target === expectedReverse[index]);
        if (!reverseOrderMatches) diagnostics.push({ type: "reverse_focus_order_mismatch", expected_targets: expectedReverse.length,
          observed_targets: reverseSequence.length, note: "A ordem observada por Shift+Tab não corresponde ao inverso dos alvos percorridos por Tab." });
      results.push({ mode: mode.name, route, viewport: viewport.name, status: response.status(), estimated_focusable_targets: expectedFocusableCount,
          steps: sequence.length, cycle_observed: naturalCycle, suspected_trap: suspectedTrap, iframe_uninspected: iframeSkipped,
          returned_to_body_early: bodyBeforeCycle, reverse_steps: reverseSequence.length, reverse_complete: reverseComplete,
          reverse_order_matches: reverseOrderMatches, diagnostics, sequence, reverse_sequence: reverseSequence });
      } catch (error) {
        results.push({ route, viewport: viewport.name, status: response?.status() ?? null, error: error instanceof Error ? error.message : String(error) });
      } finally {
        await page.close();
      }
      }
    }
  }
} finally {
  await browser.close();
}

const issueTypes = new Set(["focused_element_not_visible", "focused_element_outside_viewport", "focus_indicator_not_detected", "suspected_focus_cycle_or_trap", "focus_returned_to_body", "reverse_focused_element_not_visible", "reverse_focused_element_outside_viewport", "reverse_focus_indicator_not_detected", "reverse_focus_order_mismatch"]);
const issueCount = results.reduce((count, result) => count + (result.diagnostics || []).filter((item) => issueTypes.has(item.type)).length + (result.error ? 1 : 0), 0);
console.log(JSON.stringify({ base_url: baseUrl, routes: selectedRoutes.length, modes: modes.map(({ name }) => name), viewports: viewports.map(({ name, width, height }) => ({ name, width, height })), route_viewports: results.length,
  step_limit_configured: stepLimit, issue_count: issueCount, results }, null, 2));
if (results.some((result) => result.error || result.suspected_trap || result.returned_to_body_early
  || !result.reverse_order_matches || result.diagnostics?.some((item) => ["focused_element_not_visible", "focused_element_outside_viewport", "suspected_focus_cycle_or_trap", "focus_returned_to_body", "reverse_focused_element_not_visible", "reverse_focused_element_outside_viewport"].includes(item.type)))) process.exitCode = 1;
