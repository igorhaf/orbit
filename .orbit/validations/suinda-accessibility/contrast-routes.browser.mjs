import { chromium } from "playwright";
import { existsSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { getContrastRunnerFailures } from "./contrast-runner-result.mjs";

const baseUrl = (process.env.SUINDA_A11Y_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find((candidate) => existsSync(candidate));

// Kept in sync with accessibility.mjs; that file is deliberately not imported
// because importing it launches a separate audit as a side effect.
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
const syntheticCardBoardId = "00000000-0000-4000-8000-000000000444";
const syntheticCardId = "00000000-0000-4000-8000-000000000447";
const routeSelection = process.env.SUINDA_CONTRAST_ROUTES || process.env.SUINDA_CONTRAST_ROUTE;
const auditAllInteractiveStates = process.env.SUINDA_CONTRAST_ALL_INTERACTIVES === "1";
const openSyntheticGalleryModal = process.env.SUINDA_CONTRAST_GALLERY_MODAL !== "0";
const openSyntheticPluginMenu = process.env.SUINDA_CONTRAST_PLUGIN_MENU === "1";
const openSyntheticAccountMenu = process.env.SUINDA_CONTRAST_ACCOUNT_MENU === "1";
const openSyntheticCreateMenu = process.env.SUINDA_CONTRAST_CREATE_MENU === "1";
const openSyntheticSearchPanel = process.env.SUINDA_CONTRAST_SEARCH_PANEL === "1";
const openSyntheticNotificationPanel = process.env.SUINDA_CONTRAST_NOTIFICATION_PANEL === "1";
const openSyntheticBoardsMenu = process.env.SUINDA_CONTRAST_BOARDS_MENU === "1";
const openSyntheticCreateBoardDialog = process.env.SUINDA_CONTRAST_CREATE_BOARD_DIALOG === "1";
const openSyntheticCalendarEventDialog = process.env.SUINDA_CONTRAST_CALENDAR_EVENT_DIALOG === "1";
const openSyntheticCalendarEventDetails = process.env.SUINDA_CONTRAST_CALENDAR_EVENT_DETAILS === "1";
const openSyntheticPluginDetailsDialog = process.env.SUINDA_CONTRAST_PLUGIN_DETAILS_DIALOG === "1";
const openSyntheticProjectDirectoryDialog = process.env.SUINDA_CONTRAST_PROJECT_DIRECTORY_DIALOG === "1";
const openSyntheticBoardDeleteDialog = process.env.SUINDA_CONTRAST_BOARD_DELETE_DIALOG === "1";
const openSyntheticBoardBackgroundDialog = process.env.SUINDA_CONTRAST_BOARD_BACKGROUND_DIALOG === "1";
const openSyntheticCardDialog = process.env.SUINDA_CONTRAST_CARD_DIALOG === "1";
if (openSyntheticCardDialog) routes.push(`/board/${syntheticCardBoardId}?card=${syntheticCardId}`);
if (openSyntheticBoardBackgroundDialog) routes.push(`/board/${syntheticCardBoardId}`);
const syntheticClosedBoard = { id: "synthetic-closed-board", title: "Quadro fechado sintético",
  closed_at: "2026-10-20T12:00:00.000Z", background: "blue", starred: false, is_inbox: false, is_collection: false };
if (openSyntheticCreateBoardDialog && openSyntheticBoardDeleteDialog) {
  throw new Error("SUINDA_CONTRAST_CREATE_BOARD_DIALOG e SUINDA_CONTRAST_BOARD_DELETE_DIALOG abrem modais exclusivos na mesma rota; execute-os em chamadas separadas.");
}
if (openSyntheticCalendarEventDialog && openSyntheticCalendarEventDetails) {
  throw new Error("SUINDA_CONTRAST_CALENDAR_EVENT_DIALOG e SUINDA_CONTRAST_CALENDAR_EVENT_DETAILS usam estados exclusivos; execute-os em chamadas separadas.");
}
if (openSyntheticCardDialog && openSyntheticBoardBackgroundDialog) {
  throw new Error("SUINDA_CONTRAST_CARD_DIALOG e SUINDA_CONTRAST_BOARD_BACKGROUND_DIALOG usam a mesma rota; execute-os em chamadas separadas.");
}
const selectedRoutes = routeSelection
  ? routeSelection.split(",").map((route) => route.trim()).filter(Boolean)
    .map((route) => route.startsWith("/") ? route : `/${route}`)
  : routes;
const syntheticEnrollmentId = "00000000-0000-4000-8000-000000000303";
const syntheticCalendarEvent = (() => {
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { id: "synthetic-calendar-event-details", sourceId: "synthetic-calendar-source", resourceType: "event",
    title: "Evento sintético de contraste", description: "Descrição sintética para verificar contraste no diálogo de detalhes.",
    start: start.toISOString(), end: end.toISOString(), allDay: false, timeZone: "America/Recife",
    location: "Sala sintética", recurrence: [], attendees: [], conference: null, metadata: {} };
})();
const syntheticLearning = {
  enrollment: { id: syntheticEnrollmentId, title: "Matrícula de teste: acessibilidade digital", state: "enrolled" },
  course: { id: "synthetic-course", title: "Acessibilidade digital", payload: { workload_hours: 1, objectives: [] } },
  progress: { required_total: 1, required_completed: 0, percent: 0 },
  attendance: { percent: null, minimum_percent: 75, attended_minutes: 0, scheduled_minutes: 0,
    sessions_present: 0, sessions_absent: 0, sessions_unmarked: 0, meets_minimum: null },
  workload_progress: { attended_class_hours: 0, validated_practice_hours: 0, credited_practice_hours: 0, completed_hours: 0 },
  live_sessions: [], submissions: [],
  assignments: [{ id: "synthetic-assignment", title: "Reflexão sobre acessibilidade", payload: {
    instructions: "Resposta sintética para validar contraste do histórico de entrega.",
    due_at: "2026-12-31T23:59:00.000Z", group_submission: false, rubric: [] }, groups: [],
    submission: { id: "synthetic-submission", state: "submitted", revision: 1,
      answer: "Resposta fictícia já enviada para teste de contraste.", submitted_at: "2026-10-20T12:00:00.000Z",
      version: 1, score: 8, feedback: "Retorno sintético da equipe docente.", files: [] } }], practices: [],
  modules: [{ id: "synthetic-module", title: "Conteúdo acessível", completed: false, available: true,
    progress: { required_total: 1, required_completed: 0, percent: 0 }, payload: { position: 1, objectives: [] }, units: [],
    lessons: [{ id: "synthetic-lesson", title: "Legendas e transcrição", revision: 1, state: "published", completed: false,
      required: true, available: true,
      payload: { position: 1, content_type: "video", workload_minutes: 1,
        content_url: "https://media.invalid/synthetic-accessibility-video.mp4",
        transcript: "Esta é uma transcrição sintética para auditoria de interface.", transcript_reviewed: true,
        captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nLegenda sintética para teste.",
        captions_language: "pt-BR", captions_label: "Português (Brasil)", captions_reviewed: true,
        provider_captions_confirmed: false, attachments: [] } },
      { id: "synthetic-gallery-lesson", title: "Galeria sintética acessível", revision: 1, state: "published", completed: false,
        required: false, available: true,
        payload: { position: 2, content_type: "gallery", workload_minutes: 1, downloadable: false,
          attachments: [
            { id: "synthetic-image-1", revision: 1, file_name: "Diagrama acessível 1.png", mime_type: "image/png", size_bytes: 68, alt_text: "Diagrama sintético de navegação" },
            { id: "synthetic-image-2", revision: 1, file_name: "Diagrama acessível 2.png", mime_type: "image/png", size_bytes: 68, alt_text: "Segundo diagrama sintético de navegação" },
          ] } },
    ],
  }],
};
const syntheticEnrollment = {
  id: syntheticEnrollmentId, workspace_id: "synthetic-workspace", title: "Matrícula de teste: acessibilidade digital",
  state: "enrolled", revision: 1,
  payload: { payment_status: "paid", amount_due: 0, course_record_id: "synthetic-course", course_revision: 1 },
  dashboard: { next_sessions: [], pending_assignments: [],
    payment_entries: [{ id: "synthetic-payment-entry", currency: "BRL", amount: 10, payment_method: "pix",
      paid_at: "2026-01-15T12:00:00.000Z", payment_reference: "referencia-sintetica", notes: null }], payment_schedule: [],
    scholarship_applications: [], gamification: { points: 120, level: 2, next_level_points: 200,
      lessons_completed: 4, assessments_completed: 1, study_streak_days: 3,
      weekly_goal: { metric: "study_days", active_days: 3, target_days: 5, current_value: 3,
        target_value: 5, unit: "dias ativos", percent: 60 }, ranking_position: 1, badges: [], challenges: [],
      leaderboard: [{ name: "Estudante fictício", points: 120, rank: 1 }] },
    certificate: null, certificates: [], announcements: [] },
};
const syntheticTeaching = { courses: [{ id: "synthetic-course", title: "Acessibilidade digital", state: "published", modality: "online" }],
  lesson_materials: [], cohorts: [{ id: "synthetic-cohort", title: "Turma de teste", state: "active",
    course_record_id: "synthetic-course", starts_at: "2026-10-01T00:00:00.000Z", ends_at: "2026-12-31T23:59:59.000Z",
    capacity: 20 }], sessions: [{ id: "synthetic-session", revision: 1, title: "Encontro de acessibilidade",
    state: "scheduled", cohort_record_id: "synthetic-cohort", starts_at: "2026-11-01T15:00:00.000Z",
    ends_at: "2026-11-01T16:00:00.000Z", modality: "online", meeting_provider: "google_meet",
    meeting_url: null, location: null, room_name: null, upcoming: true }], attendance: [], roster: [],
  announcement_receipts: [], attendance_alerts: [], submissions: [{ id: "synthetic-teacher-submission", revision: 1,
    title: "Entrega sintética", state: "submitted", assessment_title: "Reflexão sobre acessibilidade",
    learner_user_id: "synthetic-learner", submitted_at: "2026-10-20T12:00:00.000Z",
    answer: "Resposta fictícia para medir contraste dos campos de correção docente.", version: 1, files: [] }],
  assessment_attempts: [], pending_practices: [],
  pending_documents: [], pending_justifications: [], pending_makeup_fees: [], counts: { courses: 1, cohorts: 1,
    upcoming_sessions: 1, active_learners: 0, submissions_to_review: 1, assessment_attempts_to_review: 0,
    practices_to_review: 0, documents_to_review: 0, attendance_justifications_to_review: 0, attendance_alerts: 0 } };
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];
const auditEmail = process.env.SUINDA_A11Y_EMAIL;
const auditPassword = process.env.SUINDA_A11Y_PASSWORD;
const syntheticAuthAudit = process.env.SUINDA_CONTRAST_SYNTHETIC_AUTH === "1";
const syntheticOnlyAudit = process.env.SUINDA_CONTRAST_SYNTHETIC_ONLY === "1";
const syntheticProfileName = process.env.SUINDA_CONTRAST_PROFILE || "root";
const syntheticProfiles = {
  root: { id: "synthetic-contrast-root", name: "Pessoa de teste ROOT", email: "root-contrast@example.invalid",
    role: "root", is_root: true, permissions: ["*"] },
  teacher: { id: "synthetic-contrast-teacher", name: "Docente sintético", email: "teacher-contrast@example.invalid",
    role: "user", is_root: false, permissions: ["plugin.suinda-learning.read", "plugin.suinda-learning.write"] },
  learner: { id: "synthetic-contrast-learner", name: "Aluna sintética", email: "learner-contrast@example.invalid",
    role: "user", is_root: false, permissions: ["plugin.suinda-learning.read"], roles: [{ role_id: "suinda_student",
      name: "Aluna Suindá", permissions: ["plugin.suinda-learning.read"] }] },
  workspace_manager: { id: "synthetic-contrast-manager", name: "Gestora sintética", email: "manager-contrast@example.invalid",
    role: "user", is_root: false, permissions: ["plugin.suinda-learning.read"], roles: [{ role_id: "suinda_workspace_manager",
      name: "Gestora acadêmica da unidade", permissions: ["plugin.suinda-learning.manage"] }] },
};
if (!syntheticProfiles[syntheticProfileName]) {
  throw new Error(`SUINDA_CONTRAST_PROFILE inválido: ${syntheticProfileName}. Use ${Object.keys(syntheticProfiles).join(", ")}.`);
}
if (syntheticProfileName !== "root" && !syntheticAuthAudit) {
  throw new Error("SUINDA_CONTRAST_PROFILE diferente de root exige SUINDA_CONTRAST_SYNTHETIC_AUTH=1.");
}
if (Boolean(auditEmail) !== Boolean(auditPassword)) {
  throw new Error("Configure SUINDA_A11Y_EMAIL e SUINDA_A11Y_PASSWORD juntos para ativar a varredura autenticada.");
}
if (syntheticAuthAudit && auditEmail) {
  throw new Error("Escolha SUINDA_CONTRAST_SYNTHETIC_AUTH ou credenciais de auditoria, não ambos.");
}
if (syntheticOnlyAudit && !syntheticAuthAudit) {
  throw new Error("SUINDA_CONTRAST_SYNTHETIC_ONLY exige SUINDA_CONTRAST_SYNTHETIC_AUTH=1.");
}

async function auditSession(base) {
  if (!auditEmail) return null;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: auditEmail, password: auditPassword }),
  });
  if (!login.ok) throw new Error(`Login de auditoria recusado (HTTP ${login.status}); nenhuma credencial foi registrada.`);
  const session = await login.json();
  if (!session.token) throw new Error("A conta de auditoria exige autenticação adicional ou não criou sessão.");
  const profile = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${session.token}` } });
  if (!profile.ok) throw new Error(`Não foi possível carregar o perfil da conta de auditoria (HTTP ${profile.status}).`);
  return { token: session.token, user: await profile.json() };
}

const browser = await chromium.launch({
  headless: true,
  ...(chromePath ? { executablePath: chromePath } : {}),
  args: ["--no-sandbox"],
});
const modes = syntheticOnlyAudit ? [] : [{ name: "anonymous", session: null }];
const authenticatedSession = await auditSession(baseUrl);
if (authenticatedSession) modes.push({ name: "authenticated", session: authenticatedSession });
if (syntheticAuthAudit) modes.push({ name: "authenticated-synthetic", session: {
  synthetic: true,
  token: "synthetic-contrast-a11y-token-never-valid-outside-this-browser",
  user: { ...syntheticProfiles[syntheticProfileName], preferences: { theme: "dark", fontScale: "normal",
    notifications: false, browserNotifications: false, emailNotifications: false } },
} });
const violations = [];
const nonTextViolations = [];
const unresolved = [];
const routeErrors = [];
const exclusionCounts = {};
const disabledExclusions = [];
const interactionStateFailures = [];
const interactionStateUnresolved = [];
const focusCoverageErrors = [];
const interactionStatePasses = [];
const expandedDisclosures = [];
const hoverStateErrors = [];
const keyboardInteractionChecks = [];
const galleryKeyboardChecks = [];
let hoverStatesChecked = 0;
let focusVisibleStatesChecked = 0;
let blockedMutationRequests = 0;
let syntheticMutationRequests = 0;
const syntheticMutationDetails = [];
let auditedSamples = 0;
let pixelGradientSamples = 0;
let completedRouteViewports = 0;

function parseCssRgb(raw) {
  const value = String(raw || "").trim().toLowerCase();
  const values = value.match(/^rgba?\((.*)\)$/)?.[1].replace(/\s*\/\s*/g, " ").split(/[\s,]+/).filter(Boolean);
  if (values && values.length >= 3 && values.length <= 4) {
    const channel = (part) => part.endsWith("%") ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part);
    const alpha = values[3] === undefined ? 1 : values[3].endsWith("%") ? Number.parseFloat(values[3]) / 100 : Number.parseFloat(values[3]);
    const color = { r: channel(values[0]), g: channel(values[1]), b: channel(values[2]), a: alpha };
    return Object.values(color).every(Number.isFinite) ? { r: Math.min(255, Math.max(0, color.r)),
      g: Math.min(255, Math.max(0, color.g)), b: Math.min(255, Math.max(0, color.b)), a: Math.min(1, Math.max(0, color.a)) } : null;
  }
  const oklab = value.match(/^oklab\(\s*([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  const lab = value.match(/^lab\(\s*([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (!oklab && !lab) return null;
  const encode = (channel) => {
    const bounded = Math.min(1, Math.max(0, channel));
    return 255 * (bounded <= 0.0031308 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055);
  };
  const alphaToken = (oklab || lab)[4];
  const a = alphaToken === undefined ? 1 : Number.parseFloat(alphaToken) / (alphaToken.endsWith("%") ? 100 : 1);
  if (oklab) {
    const L = Number.parseFloat(oklab[1]) / (oklab[1].endsWith("%") ? 100 : 1);
    const axisA = Number.parseFloat(oklab[2]) / (oklab[2].endsWith("%") ? 250 : 1);
    const axisB = Number.parseFloat(oklab[3]) / (oklab[3].endsWith("%") ? 250 : 1);
    const l = (L + 0.3963377774 * axisA + 0.2158037573 * axisB) ** 3;
    const m = (L - 0.1055613458 * axisA - 0.0638541728 * axisB) ** 3;
    const s = (L - 0.0894841775 * axisA - 1.291485548 * axisB) ** 3;
    return { r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3414186147 * s),
      b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), a };
  }
  const L = Number.parseFloat(lab[1]), axisA = Number.parseFloat(lab[2]), axisB = Number.parseFloat(lab[3]);
  const fy = (L + 16) / 116, fx = fy + axisA / 500, fz = fy - axisB / 200;
  const inverse = (n) => n ** 3 > 216 / 24389 ? n ** 3 : (116 * n - 16) / (24389 / 27);
  const x50 = 0.96422 * inverse(fx), y50 = inverse(fy), z50 = 0.82521 * inverse(fz);
  const x = 0.9555766 * x50 - 0.0230393 * y50 + 0.0631636 * z50;
  const y = -0.0282895 * x50 + 1.0099416 * y50 + 0.0210077 * z50;
  const z = 0.0122982 * x50 - 0.020483 * y50 + 1.3299098 * z50;
  return { r: encode(3.2406 * x - 1.5372 * y - 0.4986 * z),
    g: encode(-0.9689 * x + 1.8758 * y + 0.0415 * z), b: encode(0.0557 * x - 0.204 * y + 1.057 * z), a };
}
function cssLuminance({ r, g, b }) {
  const linear = (channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function cssContrast(first, second) {
  if (!first || !second) return null;
  const a = cssLuminance(first), b = cssLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

try {
  for (const mode of modes) {
    for (const viewport of viewports) {
      for (const route of selectedRoutes) {
        const pageRoute = route;
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
        let accountMenuHoverAnchor = null;
        let calendarEventTrigger = null;
        let pluginDetailsTrigger = null;
        let projectDirectoryTrigger = null;
        if (mode.session) {
          await page.addInitScript(({ token, user }) => {
            localStorage.setItem("orbit_token", token);
            localStorage.setItem("orbit_user", JSON.stringify(user));
          }, mode.session);
        }
        let response;
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push({ message: error.message.slice(0, 240), stack: error.stack?.split("\n").slice(0, 5).join("\n") || null }));
        await page.route("**/api/**", async (route) => {
          if (mode.session?.synthetic) {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
              syntheticMutationRequests += 1;
              if (syntheticMutationDetails.length < 100) syntheticMutationDetails.push({
                route: pageRoute, viewport: viewport.name, method: request.method(), path: pathname,
              });
            }
            if (/\/materials\/synthetic-image-[12]\/preview$/.test(pathname)) {
              await route.fulfill({ status: 200, contentType: "image/png",
                body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pV8AAAAASUVORK5CYII=", "base64") });
              return;
            }
            const account = mode.session.user;
            const accountWithSettings = { ...account, preferences: account.preferences, mfa_enabled: false };
            const syntheticCardBoard = { id: syntheticCardBoardId,
              title: "Quadro sintético para auditoria de contraste", background: "blue", starred: false,
              owner_id: account.id, lists: [{ id: "00000000-0000-4000-8000-000000000446", board_id: syntheticCardBoardId,
                title: "Lista sintética", position: 0, color: null, collapsed: false,
                cards: [{ id: syntheticCardId, list_id: "00000000-0000-4000-8000-000000000446",
                  title: "Cartão sintético para auditoria de contraste", description: "", position: 0,
                  start_date: null, due_date: null, reminder_minutes: null, recurrence: null,
                  labels: [], comment_count: 0, checklist_total: 0, checklist_done: 0 }] }],
              labels: [], members: [], custom_fields: [] };
            const fixtures = [
              [/\/auth\/me$/, account],
              [new RegExp(`/cards/${syntheticCardId}/plugins$`), { selected: [], available: [], slots: [], data: {} }],
              [new RegExp(`/cards/${syntheticCardId}/extensions$`), { checklists: [], values: [] }],
              [/\/plugins(?:\/catalog)?$/, { plugins: [{ id: "suinda-learning", name: "Aprendizagem Suindá", enabled: true,
                status: "active", version: "1.0.0", actions: [{ id: "catalog", name: "Consultar cursos" }],
                capabilities: [{ id: "learning", name: "Aprendizagem" }], contributions: { navigation: [
                  { id: "suinda", label: "Minha aprendizagem", href: "/suinda", permission: "plugin.suinda-learning.read", order: 5,
                    group: { id: "learning", label: "Aprendizagem", order: 5 } },
                  { id: "suinda-catalog", label: "Catálogo de cursos", href: "/suinda/catalog", permission: "plugin.suinda-learning.read", order: 6,
                    group: { id: "learning", label: "Aprendizagem", order: 5 } },
                ] } }, { id: "project-boards", name: "Quadros", enabled: true, status: "active", version: "1.0.0",
                actions: [], capabilities: [], contributions: { boardCreators: [] } }] }],
              [/\/branding$/, { app_name: "Suindá", icon_kind: "orbit", custom_icon_data: null,
                login_tagline: "Aprenda no seu ritmo.", login_description: "Cursos, encontros e atividades em um só lugar.", login_benefits: [] }],
              [/\/public\/workspace-branding\/host$/, null],
              [/\/extensions\/suinda-learning\/me\/(?:teaching-)?profiles$/, []],
              [/\/extensions\/suinda-learning\/me\/favorites$/, []],
              [/\/extensions\/suinda-learning\/me\/recommendations$/, { recommendations: [] }],
              [/\/extensions\/suinda-learning\/me\/dashboard$/, [syntheticEnrollment]],
              [/\/extensions\/suinda-learning\/me\/teaching$/, syntheticTeaching],
              [/\/extensions\/suinda-learning\/me\/teaching\/community-reports$/, []],
              [/\/extensions\/suinda-learning\/me\/teaching\/courses\/[^/]+\/community$/, []],
              [/\/extensions\/suinda-learning\/me\/teaching\/cohorts\/[^/]+\/announcement-templates$/, { templates: [] }],
              [/\/extensions\/suinda-learning\/me\/teaching\/surveys(?:\?.*)?$/, { surveys: [], next_cursor: null }],
              [/\/extensions\/suinda-learning\/me\/scholarship-counterparties$/, []],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/signatures$/, { signer_name: "", terms: [], history: [] }],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/documents$/, { documents: [], academic_documents: [], checklist: [],
                course_revision: 1, enrollment_state: "enrolled", enrollment_revision: 1 }],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/surveys$/, { surveys: [] }],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/messages$/, { viewer_role: "learner", contacts: [], messages: [] }],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/attendance-justifications$/, { sessions: [] }],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/assessments$/, []],
              [/\/extensions\/suinda-learning\/me\/privacy-requests(?:\?.*)?$/, []],
              [/\/extensions\/suinda-learning\/me\/(?:privacy-notices|privacy-consents)(?:\?.*)?$/, []],
              [/\/extensions\/suinda-learning\/me\/privacy-workspaces$/, []],
              [/\/extensions\/suinda-learning\/me\/(?:alumni|portfolio)$/, []],
              [/\/extensions\/suinda-learning\/me\/scholarships(?:\?.*)?$/, []],
              [/\/extensions\/suinda-learning\/me\/reports(?:\?.*)?$/, { generated_at: "2026-01-01T00:00:00.000Z", range: { from: "2026-01-01", to: "2026-12-31" },
                workspace_count: 0, unit_scope: false, totals: {}, courses: [], cohort_occupancy: [], monthly_trend: [], cohort_attrition: [],
                referral_origins: [], teaching_workload: [], teacher_evaluations: [], most_sought_courses: [], financial_by_cohort: [],
                financial: { collected_in_period: [], outstanding_current: [], by_course: [] }, unit_summary: [], unit_financial: [] }],
              [/\/extensions\/suinda-learning\/me\/transcript$/, { entries: [] }],
              [/\/extensions\/suinda-learning\/me\/seasons$/, { seasons: [{ id: "synthetic-season",
                title: "Temporada sintética de aprendizagem", description: "Dados fictícios para contraste.",
                opens_at: "2026-01-01T00:00:00.000Z", closes_at: "2026-12-31T23:59:59.000Z",
                my_points: 10, my_rank: 1,
                leaderboard: [{ name: "Estudante fictício", score: 10, rank: 1 }], course_standings: [] }] }],
              [/\/extensions\/suinda-learning\/me\/learning-paths$/, { paths: [], profile_selection_required: false }],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/learning$/, syntheticLearning],
              [/\/public\/suinda\/courses\/[^/]+\/cohorts(?:\?.*)?$/, []],
              [/\/public\/suinda\/courses\/[^/]+$/, { id: "00000000-0000-4000-8000-000000000301", workspace_id: "synthetic-workspace",
                workspace_name: "Instituição de teste", instructors: [], title: "Curso de demonstração", state: "published",
                payload: { summary: "Conteúdo sintético para auditoria visual.", description: "", category: "Formação", tags: [],
                  modality: "online", format: "open", level: "introductory", workload_hours: 8, objectives: [], price_amount: 0,
                  currency: "BRL", required_document_categories: [], application_form_fields: [] } }],
              [/\/public\/suinda\/certificates\/[^/]+$/, { authentic: true, status: "valid", certificate_code: "SUINDA-TESTE",
                learner_name: "Pessoa de teste", course_title: "Curso de demonstração", workload_hours: 8,
                issued_at: "2026-01-01T12:00:00.000Z", expires_at: null, signer_names: [] }],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/community\/groups$/, []],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/community\/participants$/, []],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/community\/connections$/, []],
              [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/community(?:\?.*)?$/, { moderator: false,
                threads: [{ id: "synthetic-community-thread", title: "Pergunta fictícia sobre acessibilidade",
                  state: "open", created_at: "2026-10-01T12:00:00.000Z", pinned: false,
                  payload: { author_user_id: "synthetic-other-learner", thread_type: "question",
                    body: "Tópico fictício para medir contraste do formulário de denúncia." },
                  replies: [], reactions: { like: 1 }, my_reaction: null }] }],
              [/\/public\/suinda\/courses(?:\?.*)?$/, []],
              [/\/home$/, { upNext: [], highlights: [], yourItems: [], recentBoards: [], favorites: [], recentConversations: [] }],
              [/\/calendar\/sources$/, [{ id: "synthetic-calendar-source", provider_id: "orbit_cards", connection_id: null,
                external_id: "synthetic-calendar", name: "Agenda sintética", time_zone: "America/Recife", color: "#0c66e4",
                access_role: "owner", is_primary: true, selected: true, visible: true, is_default: true,
                capabilities: { read: true, create: true, update: true, delete: true }, metadata: {}, settings: {} }]],
              [/\/ai\/projects$/, []],
              [/\/ai\/projects\/directories(?:\?.*)?$/, { path: "/home/synthetic", parent: null, name: "synthetic",
                folders: [{ name: "projeto-de-teste", path: "/home/synthetic/projeto-de-teste" }] }],
              [/\/(?:backups|workspaces|extensions|calendar\/items|saved-searches|access\/(?:users|roles|permissions|audit))(?:\?.*)?$/, []],
              [/\/search\/advanced(?:\?.*)?$/, { cards: [] }],
              [/\/account\/mfa$/, { enabled: false }],
              [/\/zoom\/status$/, { configured: false, connections: [] }],
              [/\/account$/, accountWithSettings],
              [/\/boards$/, []],
              [new RegExp(`/boards/${syntheticCardBoardId}$`), syntheticCardBoard],
              [new RegExp(`/boards/${syntheticCardBoardId}/views$`), { canWrite: true,
                views: [{ id: "board", name: "Quadro", renderer: "board", permission: "board.read", pluginId: "project-boards" }],
                preferredViewId: "board", savedFilters: [] }],
              [new RegExp(`/boards/${syntheticCardBoardId}/card-types$`), { types: [] }],
              [new RegExp(`/cards/${syntheticCardId}/details$`), { comments: [], checklist: [], externalResources: [], attachments: [] }],
              [new RegExp(`/cards/${syntheticCardId}/type$`), { types: [], requiresSelection: false, currentTypeId: null }],
              [new RegExp(`/cards/${syntheticCardId}/contexts$`), { prompt: "", selected: [], candidates: [] }],
              [new RegExp(`/cards/${syntheticCardId}/prompt-runs$`), []],
              [/\/ai\/models$/, []],
              [/\/notifications(?:\/unread-count|\/count)?$/, [{ id: "synthetic-contrast-notification",
                plugin_id: "suinda-learning", kind: "announcement", title: "Aviso sintético",
                body: "Mensagem fictícia para medir o painel de notificações.",
                created_at: "2026-10-15T12:00:00.000Z", read_at: null, target_url: null, board_id: null,
                board_title: null, card_id: null }]],
              [/\/notifications\/push\/config$/, { enabled: false, public_key: null, subscribed: false }],
              [/\/inbox\/cards$/, []],
            ];
            const matchingFixture = fixtures.find(([pattern]) => pattern.test(pathname));
            const fixture = (openSyntheticCardDialog || openSyntheticBoardBackgroundDialog) && mode.session?.synthetic && pathname === `/boards/${syntheticCardBoardId}`
              ? syntheticCardBoard
              : openSyntheticCardDialog && mode.session?.synthetic && pathname === "/boards" ? [syntheticCardBoard]
              : /\/calendar\/items$/.test(pathname) && openSyntheticCalendarEventDetails && mode.session?.synthetic
              ? [syntheticCalendarEvent]
              : /\/boards$/.test(pathname) && openSyntheticBoardDeleteDialog && mode.session?.synthetic
              ? new URL(route.request().url()).searchParams.get("status") === "closed" ? [syntheticClosedBoard] : []
              : matchingFixture ? matchingFixture[1] : {};
            await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(fixture) });
            return;
          }
          if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
            blockedMutationRequests += 1;
            await route.abort("blockedbyclient");
          } else await route.continue();
        });
        try {
          response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
          if (!response || response.status() >= 400) {
            routeErrors.push({ mode: mode.name, route, viewport: viewport.name, status: response?.status() ?? null,
              error: "A rota não respondeu com sucesso." });
            await page.close();
            continue;
          }
          const errorBoundaryVisible = await page.evaluate(() => document.body.innerText.includes("This page couldn’t load"));
          if (pageErrors.length || errorBoundaryVisible) {
            routeErrors.push({ mode: mode.name, route, viewport: viewport.name,
              error: errorBoundaryVisible ? "A página exibiu o limite de erro do Next.js." : "A rota lançou uma exceção no navegador.",
              details: pageErrors.slice(0, 5) });
            await page.close();
            continue;
          }
          // Development tooling is not part of Orbit/Suindá product surfaces.
          // Development-only overlays are not application content and can sit
          // over fixed-position page content in a full-page screenshot.
          await page.addStyleTag({ content: "nextjs-portal, div[aria-label^='Ambiente de desenvolvimento'] { display: none !important; }" });
          if (auditAllInteractiveStates) {
            const notificationsTrigger = page.getByRole("button", { name: /^Notificações,/ });
            if (mode.session?.synthetic && route === "/suinda" && await notificationsTrigger.count()) {
              await notificationsTrigger.click();
              await page.getByRole("region", { name: "Notificações" }).waitFor({ state: "visible" });
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Painel de notificações"] });
            }
            if (route === "/suinda") {
              const meetingTrigger = page.getByRole("button", { name: "Criar videoconferência", exact: true });
              if (await meetingTrigger.count()) {
                await meetingTrigger.click();
                await page.getByRole("region", { name: "Criação de videoconferência" }).waitFor({ state: "visible" });
                expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                  labels: ["Região Criação de videoconferência"] });
              }
            }
            if (openSyntheticPluginMenu && mode.session?.synthetic && route === "/suinda") {
              if (viewport.name === "desktop") {
                const menuTrigger = page.getByRole("button", { name: "Aprendizagem", exact: true });
                await menuTrigger.waitFor({ state: "visible" });
                await menuTrigger.click();
                await page.getByRole("navigation", { name: "Aprendizagem" }).waitFor({ state: "visible" });
              } else {
                const menuTrigger = page.getByRole("button", { name: "Abrir navegação", exact: true });
                await menuTrigger.waitFor({ state: "visible" });
                await menuTrigger.click();
                await page.getByRole("navigation", { name: "Navegação principal" }).waitFor({ state: "visible" });
              }
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: [viewport.name === "desktop" ? "Menu Orbit de Aprendizagem" : "Navegação principal móvel com Aprendizagem"] });
            }
            if (openSyntheticAccountMenu && mode.session?.synthetic && route === "/suinda") {
              const trigger = page.locator('button[title="Conta"]');
              await trigger.waitFor({ state: "visible" });
              await trigger.click();
              await page.getByText("Perfil e atividade", { exact: true }).waitFor({ state: "visible" });
              const menu = trigger.locator("xpath=..").locator(":scope > div.absolute");
              const box = await menu.boundingBox();
              if (!box) throw new Error("O menu sintético da conta não tem uma área renderizada.");
              accountMenuHoverAnchor = { x: box.x + box.width - 4, y: box.y + 4 };
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Menu da conta Orbit"] });
            }
            if (openSyntheticBoardsMenu && mode.session?.synthetic && route === "/suinda" && viewport.name === "desktop") {
              const trigger = page.locator("header nav").getByRole("button", { name: "Quadros", exact: true });
              await trigger.waitFor({ state: "visible" });
              await trigger.click();
              await page.getByRole("region", { name: "Alternar quadro" }).waitFor({ state: "visible" });
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Menu Quadros do Orbit"] });
            }
            if (openSyntheticCreateMenu && mode.session?.synthetic && route === "/suinda") {
              const trigger = page.getByRole("button", { name: "Criar", exact: true });
              await trigger.waitFor({ state: "visible" });
              await trigger.click();
              await page.getByRole("button", { name: /Criar quadro/ }).waitFor({ state: "visible" });
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Menu Criar do Orbit"] });
            }
            if (openSyntheticSearchPanel && mode.session?.synthetic && route === "/suinda") {
              const trigger = page.getByRole("button", { name: "Pesquisar em todos os quadros", exact: true });
              await trigger.focus();
              await page.keyboard.press("Enter");
              await page.getByPlaceholder("Pesquisar cartões e quadros...", { exact: true }).waitFor({ state: "visible" });
              if (await trigger.getAttribute("aria-expanded") !== "true")
                throw new Error("Enter não abriu a pesquisa global pelo acionador Orbit.");
              if (!await page.getByPlaceholder("Pesquisar cartões e quadros...", { exact: true })
                .evaluate((element) => document.activeElement === element))
                throw new Error("A pesquisa global abriu sem transferir o foco ao campo de consulta.");
              await page.getByText("Digite pelo menos 2 caracteres para buscar em todos os quadros.", { exact: true })
                .waitFor({ state: "visible" });
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Painel de pesquisa Orbit"] });
            }
            if (openSyntheticNotificationPanel && mode.session?.synthetic && route === "/suinda") {
              await page.locator('button[aria-controls="notification-panel"]').click();
              await page.locator("#notification-panel").waitFor({ state: "visible" });
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Painel de notificações Orbit"] });
            }
            if (openSyntheticBoardBackgroundDialog && mode.session?.synthetic && route === `/board/${syntheticCardBoardId}`) {
              const menuTrigger = page.getByRole("button", { name: "Menu do quadro", exact: true });
              await menuTrigger.waitFor({ state: "visible" });
              await menuTrigger.focus();
              await page.keyboard.press("Enter");
              const backgroundAction = page.getByRole("button", { name: "Plano de fundo", exact: true });
              await backgroundAction.waitFor({ state: "visible" });
              await backgroundAction.focus();
              await page.keyboard.press("Enter");
              const dialog = page.getByRole("dialog", { name: "Plano de fundo", exact: true });
              await dialog.waitFor({ state: "visible" });
              await page.waitForTimeout(250);
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Modal Orbit · Plano de fundo do quadro"] });
            }
            if (openSyntheticCreateBoardDialog && mode.session?.synthetic && route === "/boards") {
              const trigger = page.getByRole("button", { name: "Criar quadro", exact: true });
              await trigger.waitFor({ state: "visible" });
              await trigger.focus();
              await page.keyboard.press("Enter");
              const dialog = page.getByRole("dialog", { name: "Criar quadro" });
              await dialog.waitFor({ state: "visible" });
              await page.waitForTimeout(250); // Let the shared fade-in finish before sampling contrast.
              if (await dialog.getAttribute("aria-modal") !== "true")
                throw new Error("O modal de criação de quadro não está exposto como diálogo modal.");
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Modal Orbit · Criar quadro"] });
            }
            if (openSyntheticBoardDeleteDialog && mode.session?.synthetic && route === "/boards") {
              const trigger = page.getByRole("button", { name: "Excluir", exact: true });
              if (await trigger.count() !== 1) {
                const pageText = await page.locator("main").innerText().catch(async () =>
                  page.evaluate(() => document.body?.innerText || ""));
                throw new Error(`A fixture não exibiu exatamente uma ação Excluir; texto da página: ${pageText.slice(0, 500)}`);
              }
              await trigger.waitFor({ state: "visible", timeout: 5000 });
              await trigger.focus();
              await page.keyboard.press("Enter");
              const dialog = page.getByRole("dialog", { name: "Excluir quadro" });
              await dialog.waitFor({ state: "visible" });
              await page.waitForTimeout(250);
              if (await dialog.getAttribute("aria-modal") !== "true")
                throw new Error("A confirmação de exclusão de quadro não declara aria-modal=true.");
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Modal Orbit · Confirmar exclusão de quadro"] });
            }
            if (openSyntheticCalendarEventDialog && mode.session?.synthetic && route === "/calendar") {
              const trigger = page.getByRole("button", { name: "Criar evento", exact: true });
              await trigger.waitFor({ state: "visible" });
              await trigger.focus();
              await page.keyboard.press("Enter");
              const dialog = page.getByRole("dialog", { name: "Novo evento" });
              await dialog.waitFor({ state: "visible" });
              await page.waitForTimeout(250);
              if (await dialog.getAttribute("aria-modal") !== "true")
                throw new Error("O diálogo de criação de evento não declara aria-modal=true.");
              calendarEventTrigger = trigger;
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Modal Orbit · Novo evento"] });
            }
            if (openSyntheticCalendarEventDetails && mode.session?.synthetic && route === "/calendar") {
              const trigger = page.getByRole("button", { name: /Evento sintético de contraste/ });
              await trigger.waitFor({ state: "visible" });
              await trigger.click();
              const dialog = page.getByRole("dialog");
              await dialog.waitFor({ state: "visible" });
              await page.waitForTimeout(250);
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Modal Orbit · Detalhes de evento de calendário"] });
            }
            if (openSyntheticPluginDetailsDialog && mode.session?.synthetic && route === "/plugins") {
              const trigger = page.getByRole("button", { name: "Ações", exact: true }).first();
              await trigger.waitFor({ state: "visible" });
              await trigger.focus();
              await page.keyboard.press("Enter");
              const dialog = page.getByRole("dialog", { name: "Aprendizagem Suindá" });
              await dialog.waitFor({ state: "visible" });
              await page.waitForTimeout(250);
              if (await dialog.getAttribute("aria-modal") !== "true")
                throw new Error("O diálogo de detalhes de plugin não declara aria-modal=true.");
              pluginDetailsTrigger = trigger;
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Modal Orbit · Detalhes de plugin"] });
            }
            if (openSyntheticProjectDirectoryDialog && mode.session?.synthetic && route === "/profile?tab=projects") {
              const trigger = page.getByRole("button", { name: "Navegar pelas pastas", exact: true });
              await trigger.waitFor({ state: "visible" });
              await trigger.focus();
              await page.keyboard.press("Enter");
              const dialog = page.getByRole("dialog", { name: "Selecionar pasta do projeto" });
              await dialog.waitFor({ state: "visible" });
              await page.getByRole("button", { name: "projeto-de-teste", exact: true }).waitFor({ state: "visible" });
              await page.waitForTimeout(250);
              if (await dialog.getAttribute("aria-modal") !== "true")
                throw new Error("O seletor de pastas do projeto não declara aria-modal=true.");
              projectDirectoryTrigger = trigger;
              expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                labels: ["Modal Orbit · Selecionar pasta do projeto"] });
            }
            if (route === "/suinda/learning/00000000-0000-4000-8000-000000000303") {
              const reportTrigger = page.getByRole("button", { name: "Denunciar", exact: true });
              if (await reportTrigger.count()) {
                await reportTrigger.click();
                await page.getByLabel("Motivo da denúncia").waitFor({ state: "visible" });
                expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                  labels: ["Formulário Denunciar tópico comunitário"] });
              }
              const galleryLesson = page.getByRole("button", { name: /Galeria sintética acessível/ });
              if (!await galleryLesson.count()) {
                const content = await page.locator("main").innerText().catch(() => "");
                throw new Error(`A rota de aprendizagem não exibiu a aula sintética da galeria; texto: ${content.slice(0, 400)}`);
              }
              {
                await galleryLesson.focus();
                await page.keyboard.press("Enter");
                if (openSyntheticGalleryModal) {
                  const imageTrigger = page.getByRole("button", { name: "Ampliar imagem 1: Diagrama acessível 1.png" });
                  await imageTrigger.waitFor({ state: "visible" });
                  await imageTrigger.focus();
                  await page.keyboard.press("Enter");
                  let galleryDialog = page.getByRole("dialog", { name: "Imagem 1 de 2" });
                  await galleryDialog.waitFor({ state: "visible" });
                  await page.keyboard.press("ArrowRight");
                  galleryDialog = page.getByRole("dialog", { name: "Imagem 2 de 2" });
                  await galleryDialog.waitFor({ state: "visible" });
                  if (await galleryDialog.getByRole("img", { name: "Segundo diagrama sintético de navegação" }).count() !== 1)
                    throw new Error("A seta para a direita não atualizou a imagem ativa e sua descrição.");
                  await page.keyboard.press("ArrowLeft");
                  galleryDialog = page.getByRole("dialog", { name: "Imagem 1 de 2" });
                  await galleryDialog.waitFor({ state: "visible" });
                  const galleryPrevious = galleryDialog.getByRole("button", { name: "Imagem anterior" });
                  const galleryClose = galleryDialog.getByRole("button", { name: "Fechar" });
                  await galleryPrevious.focus();
                  await page.keyboard.press("Shift+Tab");
                  if (!await galleryClose.evaluate((element) => document.activeElement === element))
                    throw new Error("Shift+Tab não manteve o foco dentro do diálogo da galeria.");
                  await page.keyboard.press("Tab");
                  if (!await galleryPrevious.evaluate((element) => document.activeElement === element))
                    throw new Error("Tab não manteve o foco dentro do diálogo da galeria.");
                  await page.keyboard.press("Escape");
                  await page.getByRole("dialog", { name: "Imagem 1 de 2" }).waitFor({ state: "detached" });
                  try {
                    await page.waitForFunction((element) => document.activeElement === element,
                      await imageTrigger.elementHandle(), { timeout: 3000 });
                  } catch {
                    throw new Error("Escape fechou a galeria sem restaurar o foco à miniatura acionadora.");
                  }
                  await page.keyboard.press("Enter");
                  galleryDialog = page.getByRole("dialog", { name: "Imagem 1 de 2" });
                  await galleryDialog.waitFor({ state: "visible" });
                  galleryKeyboardChecks.push({ mode: mode.name, route, viewport: viewport.name,
                    checks: ["ArrowRight troca a imagem e seu texto alternativo", "ArrowLeft retorna à imagem anterior",
                      "Shift+Tab e Tab mantêm foco dentro do diálogo", "Escape fecha o diálogo",
                      "o foco retorna à miniatura acionadora"] });
                  await page.waitForTimeout(250);
                  expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
                    labels: ["Modal da galeria de aula · Imagem 1 de 2"] });
                }
              }
            }
            const labels = await page.locator("details").evaluateAll((items) => {
              for (const item of items) item.open = true;
              return items.map((item) => item.querySelector("summary")?.innerText?.replace(/\s+/g, " ").trim() || "Disclosure sem rótulo");
            });
            if (labels.length) expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name, labels });
          }

          if (openSyntheticCardDialog && mode.session?.synthetic && route.split("?")[0] === `/board/${syntheticCardBoardId}`) {
            const dialog = page.getByRole("dialog", { name: "Cartão: Cartão sintético para auditoria de contraste", exact: true });
            await dialog.waitFor({ state: "visible", timeout: 8_000 });
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.waitForFunction(() => {
              const modal = document.querySelector('[role="dialog"][aria-modal="true"][aria-label="Cartão: Cartão sintético para auditoria de contraste"]');
              return Boolean(modal && modal.contains(document.activeElement));
            }, null, { timeout: 3_000 });
            expandedDisclosures.push({ mode: mode.name, route, viewport: viewport.name,
              labels: ["Modal Orbit · Detalhes do cartão"] });
          }

          // Capture element rectangles only after the page is at the same origin
          // used by the later full-page gradient screenshot, including in modal journeys.
          await page.evaluate(() => window.scrollTo(0, 0));
          if (accountMenuHoverAnchor) await page.mouse.move(accountMenuHoverAnchor.x, accountMenuHoverAnchor.y);
          else await page.mouse.move(viewport.width - 2, viewport.height - 2);
          const result = await page.evaluate(() => {
            const parseColor = (raw) => {
              const value = String(raw || "").trim().toLowerCase();
              if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
              const oklab = value.match(/^oklab\(\s*([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
              if (oklab) {
                const L = Number.parseFloat(oklab[1]) / (oklab[1].endsWith("%") ? 100 : 1);
                const a = Number.parseFloat(oklab[2]) / (oklab[2].endsWith("%") ? 250 : 1);
                const b = Number.parseFloat(oklab[3]) / (oklab[3].endsWith("%") ? 250 : 1);
                const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
                const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
                const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
                const encode = (channel) => {
                  const bounded = Math.min(1, Math.max(0, channel));
                  return 255 * (bounded <= 0.0031308 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055);
                };
                const alpha = oklab[4] === undefined ? 1 : Number.parseFloat(oklab[4]) / (oklab[4].endsWith("%") ? 100 : 1);
                const color = {
                  r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
                  g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
                  b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), a: alpha,
                };
                return Object.values(color).every(Number.isFinite) ? color : null;
              }
              const lab = value.match(/^lab\(\s*([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
              if (lab) {
                const L = Number.parseFloat(lab[1]), a = Number.parseFloat(lab[2]), b = Number.parseFloat(lab[3]);
                const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
                const inverse = (value) => value ** 3 > 216 / 24389 ? value ** 3 : (116 * value - 16) / (24389 / 27);
                const x50 = 0.96422 * inverse(fx), y50 = inverse(fy), z50 = 0.82521 * inverse(fz);
                const x = 0.9555766 * x50 - 0.0230393 * y50 + 0.0631636 * z50;
                const y = -0.0282895 * x50 + 1.0099416 * y50 + 0.0210077 * z50;
                const z = 0.0122982 * x50 - 0.020483 * y50 + 1.3299098 * z50;
                const encode = (channel) => {
                  const bounded = Math.min(1, Math.max(0, channel));
                  return 255 * (bounded <= 0.0031308 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055);
                };
                const alpha = lab[4] === undefined ? 1 : Number.parseFloat(lab[4]) / (lab[4].endsWith("%") ? 100 : 1);
                const color = { r: encode(3.2406 * x - 1.5372 * y - 0.4986 * z),
                  g: encode(-0.9689 * x + 1.8758 * y + 0.0415 * z),
                  b: encode(0.0557 * x - 0.204 * y + 1.057 * z), a: alpha };
                return Object.values(color).every(Number.isFinite) ? color : null;
              }
              const match = value.match(/^rgba?\((.*)\)$/);
              if (!match) return null;
              const parts = match[1].replace(/\s*\/\s*/g, " ").split(/[\s,]+/).filter(Boolean);
              if (parts.length < 3 || parts.length > 4) return null;
              const channel = (part) => part.endsWith("%") ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part);
              const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%")
                ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
              const color = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
              return Object.values(color).every(Number.isFinite)
                ? { r: Math.min(255, Math.max(0, color.r)), g: Math.min(255, Math.max(0, color.g)),
                  b: Math.min(255, Math.max(0, color.b)), a: Math.min(1, Math.max(0, color.a)) } : null;
            };
            const contrastFor = (fontSize, fontWeight) => {
              const large = fontSize >= 24 || (fontSize >= 18.6667 && fontWeight >= 700);
              return { large, threshold: large ? 3 : 4.5 };
            };
            const composite = (over, under) => {
              const alpha = over.a + under.a * (1 - over.a);
              if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
              return {
                r: (over.r * over.a + under.r * under.a * (1 - over.a)) / alpha,
                g: (over.g * over.a + under.g * under.a * (1 - over.a)) / alpha,
                b: (over.b * over.a + under.b * under.a * (1 - over.a)) / alpha,
                a: alpha,
              };
            };
            const asCss = (color) => `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
            const linear = (channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
            };
            const luminance = (color) => 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
            const selectorFor = (element) => {
              if (element.id) return `#${CSS.escape(element.id)}`;
              const parts = [];
              let current = element;
              while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
                if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break; }
                const tag = current.localName;
                const classes = [...current.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join("");
                const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.localName === tag) : [];
                const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
                parts.unshift(`${tag}${classes}${nth}`);
                current = current.parentElement;
              }
              return parts.join(" > ") || "html";
            };
            const transparent = { r: 0, g: 0, b: 0, a: 0 };
            const opaqueCanvas = { r: 255, g: 255, b: 255, a: 1 };
            const colorsAt = (element, foregroundRaw, pseudo = null) => {
              const path = [];
              for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) path.unshift(node);
              const layers = path.map((node) => ({ node, style: getComputedStyle(node), selector: selectorFor(node) }));
              if (pseudo) layers.push({ node: element, style: getComputedStyle(element, `::${pseudo}`), selector: `${selectorFor(element)}::${pseudo}` });
              const hasOpaqueDescendant = (index) => layers.slice(index + 1)
                .some((layer) => (parseColor(layer.style.backgroundColor)?.a ?? 0) >= 0.999);
              const foreground = parseColor(foregroundRaw);
              if (!foreground) return { error: `Não foi possível interpretar a cor de texto "${foregroundRaw}".` };
              const imageLayerCandidates = [];
              const blendLayers = [];
              const colorErrors = [];
              for (const [index, layer] of layers.entries()) {
                const { style } = layer;
                if (!parseColor(style.backgroundColor)) colorErrors.push({ selector: layer.selector, value: style.backgroundColor });
                if (style.backgroundImage !== "none") imageLayerCandidates.push({ index, selector: layer.selector,
                  value: style.backgroundImage, backgroundClip: style.backgroundClip });
                const unresolvedBackdropFilter = style.backdropFilter !== "none" && !hasOpaqueDescendant(index);
                if (style.mixBlendMode !== "normal" || style.filter !== "none" || unresolvedBackdropFilter || style.textShadow !== "none") {
                  blendLayers.push({ selector: layer.selector, mixBlendMode: style.mixBlendMode, filter: style.filter,
                    backdropFilter: unresolvedBackdropFilter ? style.backdropFilter : "none", textShadow: style.textShadow });
                }
              }
              const imageLayers = imageLayerCandidates.filter((candidate) => !layers.some((descendant, index) => {
                if (index <= candidate.index || (parseColor(descendant.style.backgroundColor)?.a ?? 0) < 0.999) return false;
                return layers.slice(candidate.index + 1, index + 1).every((entry) => Number.parseFloat(entry.style.opacity) === 1);
              })).map((layer) => {
                const imageLayer = { ...layer };
                delete imageLayer.index;
                return imageLayer;
              });
              const walk = (index, backdrop) => {
                const style = layers[index].style;
                const layer = parseColor(style.backgroundColor) || transparent;
                const localBackground = composite(layer, backdrop);
                let pair;
                if (index === layers.length - 1) pair = { background: localBackground, text: composite(foreground, localBackground) };
                else pair = walk(index + 1, localBackground);
                const opacity = Math.min(1, Math.max(0, Number.parseFloat(style.opacity) || 0));
                return {
                  background: composite({ ...pair.background, a: pair.background.a * opacity }, backdrop),
                  text: composite({ ...pair.text, a: pair.text.a * opacity }, backdrop),
                };
              };
              const pair = walk(0, opaqueCanvas);
              const foregroundLum = luminance(pair.text);
              const backgroundLum = luminance(pair.background);
              const ratio = (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
              return { foreground: asCss(pair.text), background: asCss(pair.background), ratio, imageLayers, blendLayers, colorErrors };
            };
            const visibleReason = (element, range = null, pseudo = null) => {
              for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.display === "none") return "display:none";
                if (style.visibility === "hidden" || style.visibility === "collapse") return `visibility:${style.visibility}`;
                if (style.contentVisibility === "hidden") return "content-visibility:hidden";
                if (Number.parseFloat(style.opacity) === 0) return "opacity:0";
              }
              if (pseudo) {
                const style = getComputedStyle(element, `::${pseudo}`);
                if (style.display === "none") return `::${pseudo} display:none`;
                if (style.visibility === "hidden" || style.visibility === "collapse") return `::${pseudo} visibility:${style.visibility}`;
                if (Number.parseFloat(style.opacity) === 0) return `::${pseudo} opacity:0`;
              }
              if (typeof element.checkVisibility === "function"
                && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return "checkVisibility=false";
              const rects = range ? range.getClientRects() : element.getClientRects();
              if (!rects.length || ![...rects].some((rect) => rect.width > 0 && rect.height > 0)) return "sem área renderizada";
              return null;
            };
            const resolvedBackground = (element) => {
              const ancestry = [];
              for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) ancestry.unshift(node);
              let color = { ...opaqueCanvas };
              for (const node of ancestry) {
                const layer = parseColor(getComputedStyle(node).backgroundColor);
                if (layer) color = composite(layer, color);
              }
              return color;
            };
            const contrastRatio = (first, second) => {
              const a = luminance(first), b = luminance(second);
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            };
            const samples = [];
            const documentScrollY = window.scrollY;
            const accountMenu = document.querySelector('button[title="Conta"]')?.parentElement?.querySelector(':scope > div.absolute');
            const scanRoot = document.querySelector('[role="dialog"][aria-modal="true"]') || accountMenu || document.body || document.documentElement;
            const excludedDisabled = [];
            const exclusions = {};
            const seen = new Set();
            const addSample = (element, text, pseudo = null) => {
              const value = String(text || "").replace(/\s+/g, " ").trim();
              if (!value) return;
              if (element.classList.contains("sr-only")) {
                exclusions["visualmente oculto (controle ou conteúdo auxiliar)"] = (exclusions["visualmente oculto (controle ou conteúdo auxiliar)"] || 0) + 1;
                return;
              }
              const selector = selectorFor(element) + (pseudo ? `::${pseudo}` : "");
              const key = `${selector}\0${pseudo || "node"}\0${value.slice(0, 180)}`;
              if (seen.has(key)) return;
              seen.add(key);
              const disabled = element.closest(":disabled");
              if (disabled) {
                excludedDisabled.push({ selector: selectorFor(disabled), text: value.slice(0, 120), reason: "componente nativo disabled; exceção de componente inativo em WCAG 1.4.3" });
                return;
              }
              const reason = visibleReason(element, null, pseudo);
              if (reason) { exclusions[reason] = (exclusions[reason] || 0) + 1; return; }
              const style = pseudo ? getComputedStyle(element, `::${pseudo}`) : getComputedStyle(element);
              const fontSize = Number.parseFloat(style.fontSize) || 16;
              const fontWeight = Number.parseFloat(style.fontWeight) || (style.fontWeight === "bold" ? 700 : 400);
              const { large, threshold } = contrastFor(fontSize, fontWeight);
              const foregroundRaw = style.webkitTextFillColor && style.webkitTextFillColor !== "currentcolor"
                ? style.webkitTextFillColor : style.color;
              const composed = colorsAt(element, foregroundRaw, pseudo);
              const rects = [...element.getClientRects()].map(({ x, y, width, height }) => ({ x, y: y + documentScrollY, width, height }));
              let effectiveOpacity = 1;
              for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
                effectiveOpacity *= Number.parseFloat(getComputedStyle(node).opacity) || 0;
              }
              if (pseudo) effectiveOpacity *= Number.parseFloat(getComputedStyle(element, `::${pseudo}`).opacity) || 0;
              samples.push({ selector, text: value.slice(0, 180), foregroundRaw, foregroundProbe: parseColor(foregroundRaw),
                effectiveOpacity, rects, pixelProbeEligible: false, fontSize, fontWeight, large, threshold, ...composed });
            };
            const walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (!node.nodeValue?.trim()) continue;
              const parent = node.parentElement;
              if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName)) continue;
              if (parent.classList.contains("sr-only")) {
                exclusions["visualmente oculto (controle ou conteúdo auxiliar)"] = (exclusions["visualmente oculto (controle ou conteúdo auxiliar)"] || 0) + 1;
                continue;
              }
              const range = document.createRange();
              range.selectNodeContents(node);
              const value = node.nodeValue.replace(/\s+/g, " ").trim();
              const selector = selectorFor(parent);
              const key = `${selector}\0node\0${value.slice(0, 180)}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const disabled = parent.closest(":disabled");
              if (disabled) {
                excludedDisabled.push({ selector: selectorFor(disabled), text: value.slice(0, 120), reason: "componente nativo disabled; exceção de componente inativo em WCAG 1.4.3" });
                continue;
              }
              const reason = visibleReason(parent, range);
              if (reason) { exclusions[reason] = (exclusions[reason] || 0) + 1; continue; }
              const style = getComputedStyle(parent);
              const fontSize = Number.parseFloat(style.fontSize) || 16;
              const fontWeight = Number.parseFloat(style.fontWeight) || (style.fontWeight === "bold" ? 700 : 400);
              const { large, threshold } = contrastFor(fontSize, fontWeight);
              const foregroundRaw = style.webkitTextFillColor && style.webkitTextFillColor !== "currentcolor"
                ? style.webkitTextFillColor : style.color;
              const composed = colorsAt(parent, foregroundRaw);
              const rects = [...range.getClientRects()].map(({ x, y, width, height }) => ({ x, y: y + documentScrollY, width, height }));
              let effectiveOpacity = 1;
              for (let node = parent; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
                effectiveOpacity *= Number.parseFloat(getComputedStyle(node).opacity) || 0;
              }
              samples.push({ selector, text: value.slice(0, 180), foregroundRaw, foregroundProbe: parseColor(foregroundRaw),
                effectiveOpacity, rects, pixelProbeEligible: true, fontSize, fontWeight, large, threshold, ...composed });
            }
            const visibleTextInputs = "input:not([type]),input[type=text],input[type=search],input[type=email],input[type=url],input[type=tel],input[type=password],input[type=number],input[type=date],input[type=month],input[type=week],input[type=time],input[type=datetime-local],textarea";
            const visibleTextInputsWithPlaceholder = visibleTextInputs.split(",").map((selector) => `${selector}[placeholder]`).join(",");
            const visibleTextInputsWithoutSrOnly = visibleTextInputs.split(",").map((selector) => `${selector}:not(.sr-only)`).join(",");
            for (const element of scanRoot.querySelectorAll(visibleTextInputsWithPlaceholder)) {
              const value = element.getAttribute("placeholder");
              if (value) addSample(element, value, "placeholder");
            }
            for (const element of scanRoot.querySelectorAll("input[type=button],input[type=submit],input[type=reset]")) {
              if (element.value) addSample(element, element.value);
            }
            for (const element of scanRoot.querySelectorAll("select")) {
              const label = [...element.selectedOptions].map((option) => option.textContent || "").join(" ").trim();
              if (label) addSample(element, label);
            }
            for (const element of scanRoot.querySelectorAll(visibleTextInputsWithoutSrOnly)) {
              if (element.value) addSample(element, element.value);
            }
            for (const element of scanRoot.querySelectorAll("*")) {
              for (const pseudo of ["before", "after"]) {
                const content = getComputedStyle(element, `::${pseudo}`).content;
                if (!content || ["none", "normal", "\"\"", "''"].includes(content)) continue;
                const text = content.replace(/^(["'])(.*)\1$/, "$2");
                if (text && !/^url\(/i.test(text)) addSample(element, text, pseudo);
              }
            }
            const issues = [];
            for (const sample of samples) {
              if (sample.error) {
                issues.push({ ...sample, type: "unresolved", reason: sample.error });
                continue;
              }
              if (sample.imageLayers?.length || sample.blendLayers?.length || sample.colorErrors?.length) {
                issues.push({ ...sample, type: "unresolved", reason: "Fundo com imagem/gradiente, cor não reconhecida, filtro ou blend não é calculado sem análise de pixels.",
                  imageLayers: sample.imageLayers, blendLayers: sample.blendLayers, colorErrors: sample.colorErrors });
                continue;
              }
              if (sample.ratio + 1e-9 < sample.threshold) issues.push({ ...sample, type: "contrast-failure" });
            }
            const nonTextIssues = [];
            const nonTextSelector = "input:not([type=hidden]),select,textarea,button,[role=button],[role=dialog]";
            const nonTextElements = [
              ...(scanRoot.matches(nonTextSelector) ? [scanRoot] : []),
              ...scanRoot.querySelectorAll(nonTextSelector),
            ];
            for (const element of nonTextElements) {
              if (element.closest(":disabled") || element.classList.contains("sr-only") || visibleReason(element)) continue;
              const isField = element.matches("input:not([type=hidden]),select,textarea");
              const style = getComputedStyle(element);
              const inside = resolvedBackground(element);
              const outside = resolvedBackground(element.parentElement || scanRoot);
              const fill = parseColor(style.backgroundColor);
              const fillSurface = fill ? composite(fill, outside) : outside;
              const fillRatio = contrastRatio(fillSurface, outside);
              if (fillRatio >= 3) continue;
              const borderSides = ["Top", "Right", "Bottom", "Left"].map((side) => ({
                side: side.toLowerCase(), width: Number.parseFloat(style[`border${side}Width`]) || 0,
                style: style[`border${side}Style`], color: parseColor(style[`border${side}Color`]),
              })).filter((side) => side.width > 0 && side.style !== "none" && side.color && side.color.a > 0);
              const fontSize = Number.parseFloat(style.fontSize) || 16;
              const fontWeight = Number.parseFloat(style.fontWeight) || 400;
              const textThreshold = fontSize >= 24 || (fontSize >= 18.6667 && fontWeight >= 700) ? 3 : 4.5;
              const textOnlySubtleFill = !isField && !borderSides.length && fill && fill.a > 0 && fill.a < 0.2
                && Boolean(element.textContent?.trim())
                && (contrastRatio(parseColor(style.color), fillSurface) ?? 0) >= textThreshold;
              if (textOnlySubtleFill) continue;
              // Plain text/icon buttons do not expose a non-text surface to measure;
              // their visible text/icon contrast is covered by 1.4.3. Inputs still
              // require a perceivable boundary even when author styles are absent.
              if (!isField && (!fill || fill.a === 0) && !borderSides.length) continue;
              const weakBorder = borderSides.find(({ color }) => contrastRatio(color, inside) < 3 || contrastRatio(color, outside) < 3);
              if (!borderSides.length || weakBorder) nonTextIssues.push({ selector: selectorFor(element),
                accessible_name: (element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140),
                class_name: typeof element.className === "string" ? element.className.slice(0, 220) : "",
                hovered: element.matches(":hover"), border_sides: borderSides.map(({ side, width, style: borderStyle, color }) => ({ side, width, style: borderStyle, color: color ? asCss(color) : null })),
                foreground: style.color,
                fill: fill ? asCss(fillSurface) : null, fill_against_outside_ratio: fillRatio,
                weak_border_side: weakBorder?.side || null,
                border: weakBorder?.color ? asCss(weakBorder.color) : null,
                inside: asCss(inside), outside: asCss(outside),
                inside_ratio: weakBorder ? contrastRatio(weakBorder.color, inside) : null,
                outside_ratio: weakBorder ? contrastRatio(weakBorder.color, outside) : null,
                criterion: "1.4.11", reason: "A superfície de preenchimento não distingue o controle do entorno e sua borda não atinge 3:1 contra ambas as superfícies adjacentes." });
            }
            return { samples: samples.length, issues, nonTextIssues, exclusions, excludedDisabled };
          });

          const readStateStyle = (locator) => locator.evaluate((element) => {
            const style = getComputedStyle(element);
            const parentBackgroundLayers = [];
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const backgroundColor = getComputedStyle(parent).backgroundColor;
              if (backgroundColor !== "rgba(0, 0, 0, 0)" && backgroundColor !== "transparent") parentBackgroundLayers.push(backgroundColor);
            }
            return { selector: element.id ? `#${CSS.escape(element.id)}` : `${element.localName}.${[...element.classList].slice(0, 2).join(".")}`,
              accessible_name: (element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.value || "").replace(/\s+/g, " ").trim().slice(0, 120),
              background: style.backgroundColor, parentBackground: parentBackgroundLayers[0] || "rgb(255, 255, 255)", parentBackgroundLayers,
              foregroundColor: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight,
              borderColor: style.borderTopColor, borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle,
              outlineColor: style.outlineColor, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle,
              boxShadow: style.boxShadow, hovered: element.matches(":hover"), focused: element.matches(":focus-visible") };
          });
          const readActiveStateStyle = () => page.evaluate(async () => {
            const element = document.activeElement;
            if (!(element instanceof HTMLElement) || !element.matches("input:not([type=hidden]):not(.sr-only),select,textarea,button,a[href],[role=button],[tabindex]:not([tabindex='-1'])")) return null;
            const transitions = element.getAnimations().filter((animation) => animation instanceof CSSTransition);
            if (transitions.length) await Promise.race([
              Promise.allSettled(transitions.map((animation) => animation.finished)),
              new Promise((resolve) => setTimeout(resolve, 250)),
            ]);
            const focusAuditId = element.getAttribute("data-orbit-contrast-focus-id") || (() => {
              const nextId = String(document.querySelectorAll("[data-orbit-contrast-focus-id]").length + 1);
              element.setAttribute("data-orbit-contrast-focus-id", nextId);
              return nextId;
            })();
            const style = getComputedStyle(element);
            const parentBackgroundLayers = [];
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const backgroundColor = getComputedStyle(parent).backgroundColor;
              if (backgroundColor !== "rgba(0, 0, 0, 0)" && backgroundColor !== "transparent") parentBackgroundLayers.push(backgroundColor);
            }
            return { focus_audit_id: focusAuditId, focus_candidate_index: element.getAttribute("data-orbit-contrast-candidate-index"),
              selector: element.id ? `#${CSS.escape(element.id)}` : `${element.localName}.${[...element.classList].slice(0, 2).join(".")}`,
              accessible_name: (element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.value || "").replace(/\s+/g, " ").trim().slice(0, 120),
              background: style.backgroundColor, parentBackground: parentBackgroundLayers[0] || "rgb(255, 255, 255)", parentBackgroundLayers,
              foregroundColor: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight,
              borderColor: style.borderTopColor, borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle,
              outlineColor: style.outlineColor, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle,
              boxShadow: style.boxShadow, hovered: element.matches(":hover"), focused: element.matches(":focus-visible") };
          });
          const assessState = (state, stateName, before = null) => {
            const background = parseCssRgb(state.background);
            const parentBackground = (state.parentBackgroundLayers || [state.parentBackground]).slice().reverse().reduce((surface, raw) => {
              const layer = parseCssRgb(raw);
              if (!layer) return surface;
              return { r: layer.r * layer.a + surface.r * (1 - layer.a),
                g: layer.g * layer.a + surface.g * (1 - layer.a),
                b: layer.b * layer.a + surface.b * (1 - layer.a), a: 1 };
            }, { r: 255, g: 255, b: 255, a: 1 });
            const outline = parseCssRgb(state.outlineColor);
            const fill = background && parentBackground
              ? { r: background.r * background.a + parentBackground.r * (1 - background.a),
                g: background.g * background.a + parentBackground.g * (1 - background.a),
                b: background.b * background.a + parentBackground.b * (1 - background.a), a: 1 }
              : null;
            const fillRatio = cssContrast(fill, parentBackground);
            const outlineRatio = cssContrast(outline, parentBackground);
            const borderRatio = cssContrast(parseCssRgb(state.borderColor), fill);
            const outlineVisible = state.outlineStyle !== "none" && Number.parseFloat(state.outlineWidth) > 0;
            const borderVisible = state.borderStyle !== "none" && Number.parseFloat(state.borderWidth) > 0;
            const fontSize = Number.parseFloat(state.fontSize) || 16;
            const fontWeight = Number.parseFloat(state.fontWeight) || 400;
            const textThreshold = fontSize >= 24 || (fontSize >= 18.6667 && fontWeight >= 700) ? 3 : 4.5;
            const hoverTextCuePass = stateName === "hover" && before
              && state.foregroundColor !== before.foregroundColor
              && (cssContrast(parseCssRgb(state.foregroundColor), fill) ?? 0) >= textThreshold;
            const unresolvedFocusIndicator = stateName === "focus-visible" && !outlineVisible;
            const alternateBoundaryPass = (borderVisible && borderRatio !== null && borderRatio >= 3)
              || (outlineVisible && outlineRatio !== null && outlineRatio >= 3);
            const failure = stateName === "focus-visible"
              ? (outlineVisible && outlineRatio !== null && outlineRatio < 3)
              : state.backgroundChanged && fillRatio !== null && fillRatio > 1.01 && fillRatio < 3
                && !alternateBoundaryPass && !hoverTextCuePass;
            return { ...state, state: stateName, fill_contrast: fillRatio, border_contrast: borderRatio,
              outline_contrast: outlineRatio, unresolved_focus_indicator: unresolvedFocusIndicator, failure };
          };

          // Exercise hover without activating anything. Keyboard Tab is used to
          // reach one naturally focus-visible control; no Enter/Space is sent.
          const controlSelector = "input:not([type=hidden]):not(.sr-only):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href],[role=button]:not([aria-disabled=true]),[tabindex]:not([tabindex='-1'])";
          // Development overlays may expose their own non-modal dialogs (for
          // example a Reload control). Only constrain the audit to an actual
          // product modal that declares aria-modal=true.
          const activeDialog = page.locator('[role="dialog"][aria-modal="true"]');
          const accountMenu = page.locator('button[title="Conta"]').locator("xpath=..").locator(":scope > div.absolute");
          const accountMenuOpen = openSyntheticAccountMenu && route === "/suinda" && await accountMenu.isVisible().catch(() => false);
          const searchPanel = page.getByPlaceholder("Pesquisar cartões e quadros...", { exact: true }).locator("xpath=../..");
          const searchPanelOpen = openSyntheticSearchPanel && route === "/suinda" && await searchPanel.isVisible().catch(() => false);
          const notificationPanel = page.locator("#notification-panel");
          const notificationPanelOpen = openSyntheticNotificationPanel && route === "/suinda" && await notificationPanel.isVisible().catch(() => false);
          const boardsMenu = page.getByRole("region", { name: "Alternar quadro" });
          const boardsMenuOpen = openSyntheticBoardsMenu && route === "/suinda" && viewport.name === "desktop"
            && await boardsMenu.isVisible().catch(() => false);
          const controls = await activeDialog.count() ? activeDialog.locator(controlSelector)
            : notificationPanelOpen ? notificationPanel.locator(controlSelector)
              : boardsMenuOpen ? boardsMenu.locator(controlSelector)
              : accountMenuOpen ? accountMenu.locator(controlSelector)
              : searchPanelOpen ? searchPanel.locator(controlSelector) : page.locator(controlSelector);
          const controlCount = await controls.count();
          const hoverIndexes = auditAllInteractiveStates
            ? await controls.evaluateAll((elements) => elements.flatMap((element, index) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
              const eligible = !element.closest('[inert],[aria-hidden="true"]')
                && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
                // Fixed controls outside the viewport are commonly visually hidden until focus
                // (for example, the skip-to-main link); Playwright cannot scroll them into view.
                && (style.position !== "fixed" || inViewport)
                && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
              if (!eligible) return [];
              element.setAttribute("data-orbit-contrast-hover-candidate", String(index));
              return [index];
            }))
            : Array.from({ length: controlCount }, (_, index) => index);
          const visibleHoverControls = hoverIndexes.length;
          const hoverCount = Math.min(hoverIndexes.length, auditAllInteractiveStates ? 400 : 3);
          if (auditAllInteractiveStates && visibleHoverControls > 400) hoverStateErrors.push({ mode: mode.name, route, viewport: viewport.name,
            reason: "A rota excedeu o limite de 400 controles renderizados para hover no modo integral.", rendered_controls: visibleHoverControls });
          for (let index = 0; index < hoverCount; index += 1) {
            const control = auditAllInteractiveStates
              ? page.locator(`[data-orbit-contrast-hover-candidate="${hoverIndexes[index]}"]`)
              : controls.nth(hoverIndexes[index]);
            try {
              const before = await readStateStyle(control);
              await control.hover({ timeout: auditAllInteractiveStates ? 1500 : 1200 });
              const state = await readStateStyle(control);
              if (state.hovered) {
                hoverStatesChecked += 1;
                const assessed = assessState({ ...state, backgroundChanged: state.background !== before.background }, "hover", before);
                if (assessed.failure) interactionStateFailures.push({ mode: mode.name, route, viewport: viewport.name, ...assessed });
                else interactionStatePasses.push({ mode: mode.name, route, viewport: viewport.name, selector: assessed.selector,
                  state: assessed.state, fill_contrast: assessed.fill_contrast, border_contrast: assessed.border_contrast });
              }
            } catch (error) {
              if (auditAllInteractiveStates) hoverStateErrors.push({ mode: mode.name, route, viewport: viewport.name,
                selector: await control.evaluate((element) => element.id ? `#${element.id}`
                  : `${element.localName}${[...element.classList].slice(0, 2).map((name) => `.${name}`).join("")}`).catch(() => null),
                reason: error instanceof Error ? error.message.slice(0, 240) : "O estado hover visível não pôde ser exercitado." });
            }
          }
          const focusStyles = [];
          let visibleControlVisits = 0;
          const focusCandidates = auditAllInteractiveStates
            ? await controls.evaluateAll((elements) => elements.filter((element) => {
              const style = getComputedStyle(element);
              return element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest('[inert],[aria-hidden="true"]')
                && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
                && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
            }).filter((element, index, candidates) => {
              if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) return true;
              const sameGroup = candidates.filter((candidate) => candidate instanceof HTMLInputElement
                && candidate.type === "radio" && candidate.name === element.name && candidate.form === element.form);
              return element === (sameGroup.find((candidate) => candidate.checked) || sameGroup[0]);
            }).map((element, index) => {
              element.setAttribute("data-orbit-contrast-candidate-index", String(index));
              return { index, tag: element.localName, name: (element.getAttribute("aria-label") || element.getAttribute("title")
                || element.innerText || element.value || "").replace(/\s+/g, " ").trim().slice(0, 80),
                selector: element.id ? `#${element.id}` : `${element.localName}.${[...element.classList].slice(0, 2).join(".")}` };
            }))
            : [];
          const visibleControlCount = auditAllInteractiveStates ? focusCandidates.length : 1;
          const focusLimit = auditAllInteractiveStates ? Math.min(visibleControlCount + 30, 430) : 20;
          if (auditAllInteractiveStates && visibleControlCount > 400) focusCoverageErrors.push({ mode: mode.name, route,
            viewport: viewport.name, reason: "A rota excedeu o limite de 400 controles de foco do modo integral.",
            visible_controls: visibleControlCount, focus_limit: focusLimit });
          const visitedFocusIds = new Set();
          for (let tab = 0; tab < focusLimit; tab += 1) {
            await page.keyboard.press("Tab");
            const focusStyle = await readActiveStateStyle();
            if (!focusStyle) continue;
            if (!focusStyle?.focused) continue;
            const focusIdentity = focusStyle.focus_candidate_index ?? focusStyle.focus_audit_id;
            if (!visitedFocusIds.has(focusIdentity)) {
              visitedFocusIds.add(focusIdentity);
              visibleControlVisits += 1;
              focusStyles.push(focusStyle);
            }
            if (!auditAllInteractiveStates) break;
            if (visibleControlVisits >= visibleControlCount) break;
          }
          if (auditAllInteractiveStates && visibleControlVisits < visibleControlCount) focusCoverageErrors.push({ mode: mode.name, route,
            viewport: viewport.name, reason: "Nem todos os controles focáveis visíveis foram alcançados por Tab antes do limite do percurso.",
            visible_controls: visibleControlCount, unique_controls_reached: visibleControlVisits, focus_limit: focusLimit,
            not_reached: focusCandidates.filter((candidate) => !visitedFocusIds.has(String(candidate.index))) });
          for (const focusStyle of focusStyles) {
            focusVisibleStatesChecked += 1;
            const assessed = assessState(focusStyle, "focus-visible");
            if (assessed.failure) interactionStateFailures.push({ mode: mode.name, route, viewport: viewport.name, ...assessed });
            else if (assessed.unresolved_focus_indicator) interactionStateUnresolved.push({ mode: mode.name, route, viewport: viewport.name, ...assessed });
            else interactionStatePasses.push({ mode: mode.name, route, viewport: viewport.name, selector: assessed.selector,
              state: assessed.state, outline_contrast: assessed.outline_contrast, outline_style: assessed.outlineStyle,
              outline_width: assessed.outlineWidth });
          }

          // For CSS gradients, hide rendered text and sample the pixels under its
          // line boxes. Adjacent pixels may belong to a neighboring colored item
          // (for example, a stat in the next dashboard column), so they are not a
          // reliable estimate of the text's actual backdrop.
          const gradientSamples = result.issues.filter((item) => item.type === "unresolved"
            && item.pixelProbeEligible
            && item.imageLayers?.length
            && item.imageLayers.every((layer) => /^(repeating-)?(linear|radial|conic)-gradient\(/i.test(layer.value)
              && !/\btext\b/.test(layer.backgroundClip))
            && !item.blendLayers?.length && !item.colorErrors?.length);
          if (gradientSamples.length) {
            await page.mouse.move(0, 0);
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.addStyleTag({ content: "* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; transition: none !important; animation: none !important; caret-color: transparent !important; } svg { visibility: hidden !important; }" });
            const screenshotBytes = await page.screenshot({ fullPage: true });
            if (process.env.SUINDA_CONTRAST_DEBUG_SCREENSHOT_PREFIX)
              writeFileSync(`${process.env.SUINDA_CONTRAST_DEBUG_SCREENSHOT_PREFIX}-${mode.name}-${route.replaceAll("/", "_") || "root"}-${viewport.name}.png`, screenshotBytes);
            const screenshot = PNG.sync.read(screenshotBytes);
            const linear = (channel) => {
              const value = channel / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            };
            const luminance = (rgb) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
            const contrastRatio = (foreground, background) => {
              const a = luminance(foreground), b = luminance(background);
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            };
            for (const item of gradientSamples) {
              const color = item.foregroundProbe;
              if (!color || !item.rects?.length || !Number.isFinite(item.effectiveOpacity)) continue;
              const backgrounds = [];
              for (const rect of item.rects) {
                // Probe a 5×3 grid within the rendered text line after making all
                // text transparent. This samples the actual gradient without
                // including glyph antialiasing or adjacent sibling foregrounds.
                for (const fx of [0.15, 0.325, 0.5, 0.675, 0.85]) for (const fy of [0.25, 0.5, 0.75]) {
                  const x = Math.floor(rect.x + rect.width * fx);
                  const sampleY = Math.floor(rect.y + rect.height * fy);
                  if (x < 0 || x >= screenshot.width || sampleY < 0 || sampleY >= screenshot.height) continue;
                  const index = (sampleY * screenshot.width + x) * 4;
                  const pixel = [screenshot.data[index], screenshot.data[index + 1], screenshot.data[index + 2]];
                  backgrounds.push(pixel);
                }
              }
              if (backgrounds.length < Math.max(2, item.rects.length)) continue;
              pixelGradientSamples += 1;
              let minimum = Infinity;
              let worstBackground;
              let worstForeground;
              const alpha = color.a * item.effectiveOpacity;
              for (const background of backgrounds) {
                const foreground = [color.r, color.g, color.b].map((channel, index) => channel * alpha + background[index] * (1 - alpha));
                const ratio = contrastRatio(foreground, background);
                if (ratio < minimum) { minimum = ratio; worstBackground = background; worstForeground = foreground; }
              }
              item.type = minimum + 1e-9 < item.threshold ? "contrast-failure" : "pixel-contrast-pass";
              item.ratio = minimum;
              item.background = `rgb(${worstBackground.map(Math.round).join(", ")})`;
              item.foreground = `rgb(${worstForeground.map(Math.round).join(", ")})`;
              item.reason = `Menor contraste amostrado sob as linhas: ${minimum.toFixed(2)}:1.`;
            }
          }

          if (openSyntheticSearchPanel && mode.session?.synthetic && route === "/suinda") {
            const trigger = page.getByRole("button", { name: "Pesquisar em todos os quadros", exact: true });
            await page.getByPlaceholder("Pesquisar cartões e quadros...", { exact: true }).focus();
            await page.keyboard.press("Escape");
            await page.locator("#global-search-panel").waitFor({ state: "hidden" });
            const restoredFocus = await trigger.evaluate((element) => document.activeElement === element);
            const expandedState = await trigger.getAttribute("aria-expanded");
            keyboardInteractionChecks.push({ mode: mode.name, route, viewport: viewport.name,
              interaction: "Enter abre pesquisa; Escape fecha e restaura o foco", passed: restoredFocus && expandedState === "false",
              trigger_aria_expanded: expandedState });
          }
          if (openSyntheticCalendarEventDialog && mode.session?.synthetic && route === "/calendar" && calendarEventTrigger) {
            const dialog = page.getByRole("dialog", { name: "Novo evento" });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            const triggerHandle = await calendarEventTrigger.elementHandle();
            if (!triggerHandle) throw new Error("O acionador de criação foi removido antes da restauração do foco.");
            await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
            keyboardInteractionChecks.push({ mode: mode.name, route, viewport: viewport.name,
              interaction: "Enter abre Novo evento; Escape fecha e restaura o foco sem criar evento", passed: true });
          }
          if (openSyntheticPluginDetailsDialog && mode.session?.synthetic && route === "/plugins" && pluginDetailsTrigger) {
            const dialog = page.getByRole("dialog", { name: "Aprendizagem Suindá" });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            const triggerHandle = await pluginDetailsTrigger.elementHandle();
            if (!triggerHandle) throw new Error("O acionador do plugin foi removido antes da restauração do foco.");
            await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
            keyboardInteractionChecks.push({ mode: mode.name, route, viewport: viewport.name,
              interaction: "Enter abre detalhes de plugin; Escape fecha e restaura o foco", passed: true });
          }
          if (openSyntheticProjectDirectoryDialog && mode.session?.synthetic && route === "/profile?tab=projects" && projectDirectoryTrigger) {
            const dialog = page.getByRole("dialog", { name: "Selecionar pasta do projeto" });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            const triggerHandle = await projectDirectoryTrigger.elementHandle();
            if (!triggerHandle) throw new Error("O acionador Navegar pelas pastas foi removido antes da restauração do foco.");
            await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
            keyboardInteractionChecks.push({ mode: mode.name, route, viewport: viewport.name,
              interaction: "Enter abre seletor de pastas; Escape fecha e restaura o foco sem criar diretórios", passed: true });
          }
          if (openSyntheticCreateBoardDialog && mode.session?.synthetic && route === "/boards") {
            const trigger = page.getByRole("button", { name: "Criar quadro", exact: true }).first();
            const dialog = page.getByRole("dialog", { name: "Criar quadro" });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            const triggerHandle = await trigger.elementHandle();
            if (!triggerHandle) throw new Error("O acionador de exclusão foi removido antes da restauração do foco.");
            await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
            const restoredFocus = await trigger.evaluate((element) => document.activeElement === element);
            keyboardInteractionChecks.push({ mode: mode.name, route, viewport: viewport.name,
              interaction: "Enter abre o modal e Escape fecha/restaura foco, sem criar quadro", passed: restoredFocus });
          }
          if (openSyntheticBoardDeleteDialog && mode.session?.synthetic && route === "/boards") {
            const trigger = page.getByRole("button", { name: "Excluir", exact: true });
            const dialog = page.getByRole("dialog", { name: "Excluir quadro" });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            const triggerHandle = await trigger.elementHandle();
            if (!triggerHandle) throw new Error("O acionador de exclusão foi removido antes da restauração do foco.");
            await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
            const restoredFocus = await trigger.evaluate((element) => document.activeElement === element);
            keyboardInteractionChecks.push({ mode: mode.name, route, viewport: viewport.name,
              interaction: "Enter abre a confirmação; Escape fecha, restaura foco e preserva o quadro", passed: restoredFocus });
          }

          auditedSamples += result.samples;
          for (const item of result.nonTextIssues) nonTextViolations.push({ mode: mode.name, route, viewport: viewport.name, ...item });
          for (const [reason, count] of Object.entries(result.exclusions)) exclusionCounts[reason] = (exclusionCounts[reason] || 0) + count;
          for (const entry of result.excludedDisabled) disabledExclusions.push({ mode: mode.name, route, viewport: viewport.name, ...entry });
          for (const item of result.issues) {
            const isUnresolved = item.type === "unresolved";
            const record = { mode: mode.name, route, viewport: viewport.name, selector: item.selector,
              text: item.text, foreground: isUnresolved ? (item.foregroundRaw || null) : (item.foreground || null),
              foreground_css: item.foregroundRaw || null,
              composited_foreground_estimate: isUnresolved ? (item.foreground || null) : undefined,
              background: isUnresolved ? null : (item.background || null),
              composited_background_estimate: isUnresolved ? (item.background || null) : undefined,
              ratio: isUnresolved ? null : (item.ratio ?? null), threshold: item.threshold,
              type: item.type, reason: item.reason || null, imageLayers: item.imageLayers || undefined,
              blendLayers: item.blendLayers || undefined, colorErrors: item.colorErrors || undefined };
            if (process.env.SUINDA_CONTRAST_DEBUG_SCREENSHOT_PREFIX && item.pixelProbeEligible) {
              record.sample_rects = item.rects;
              if (item.type === "contrast-failure" && item.rects?.[0]) record.hit_test = await page.evaluate(({ x, y }) =>
                document.elementsFromPoint(x, y).slice(0, 5).map((element) => {
                  const style = getComputedStyle(element);
                  const rect = element.getBoundingClientRect();
                  return { tag: element.tagName, id: element.id || null, class_name: String(element.className || "").slice(0, 180),
                    text: (element.textContent || "").trim().slice(0, 80), position: style.position, z_index: style.zIndex,
                    background: style.backgroundColor, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
                }), { x: item.rects[0].x + item.rects[0].width / 2,
                  y: item.rects[0].y + item.rects[0].height / 2 });
            }
            if (item.type === "contrast-failure") violations.push(record);
            else if (item.type === "pixel-contrast-pass") continue;
            else unresolved.push(record);
          }
        } catch (error) {
          routeErrors.push({ mode: mode.name, route, viewport: viewport.name,
            error: error instanceof Error ? error.message : "Falha desconhecida na inspeção." });
        } finally {
          await page.close();
          completedRouteViewports += 1;
          if (auditAllInteractiveStates) console.error(`[contrast] ${completedRouteViewports}/${selectedRoutes.length * viewports.length * modes.length} ${mode.name} ${route} ${viewport.name}`);
        }
      }
    }
  }
} finally {
  await browser.close();
}

const uniqueDisabled = [...new Map(disabledExclusions.map((entry) => [
  `${entry.mode}\0${entry.route}\0${entry.viewport}\0${entry.selector}\0${entry.text}`, entry,
])).values()];
const summary = {
  base_url: baseUrl,
  standard: "WCAG 2.2 AA — critérios 1.4.3 (contraste de texto) e 1.4.11 (contraste não textual)",
  routes: selectedRoutes.length,
  route_viewports: selectedRoutes.length * viewports.length * modes.length,
  viewports_per_route: viewports.length,
  route_viewports_completed: completedRouteViewports,
  modes: modes.map(({ name }) => name),
  synthetic_profile: syntheticAuthAudit ? syntheticProfileName : null,
  audited_visible_text_samples: auditedSamples,
  gradient_text_samples_checked_by_pixels_under_text: pixelGradientSamples,
  contrast_failures: violations.length,
  non_text_contrast_failures: nonTextViolations.length,
  non_text_violations: nonTextViolations,
  hover_states_checked: hoverStatesChecked,
  hover_state_errors: hoverStateErrors,
  focus_visible_states_checked: focusVisibleStatesChecked,
  interaction_state_failures: interactionStateFailures,
  interaction_state_unresolved: interactionStateUnresolved,
  focus_coverage_errors: focusCoverageErrors,
  interaction_state_passes: interactionStatePasses,
  keyboard_interaction_checks: keyboardInteractionChecks,
  gallery_keyboard_checks: galleryKeyboardChecks,
  disclosures_expanded_for_contrast: expandedDisclosures,
  blocked_non_get_requests: blockedMutationRequests,
  synthetic_mutation_requests_intercepted: syntheticMutationRequests,
  synthetic_mutation_details: syntheticMutationDetails,
  unresolved_samples: unresolved.length,
  exclusions: { hidden_or_unrendered_counts: exclusionCounts,
    disabled_native_controls_count: uniqueDisabled.length,
    disabled_native_controls: uniqueDisabled,
    disabled_exclusion_rule: "Somente descendentes de controles nativos :disabled foram excluídos; aria-disabled permanece auditado." },
  violations,
  unresolved,
  route_errors: routeErrors,
  limits: [
    "A auditoria calcula cores CSS e opacidade alfa; para gradientes CSS atrás de texto DOM normal, oculta texto/ícones na captura e amostra pixels sob as caixas de linha. Isso não prova contraste em todos os pixels do gradiente, imagens, vídeo, canvas, filtros, blend modes, sombras de texto ou sobreposição de irmãos; casos não suportados são reportados como não resolvidos quando detectáveis.",
    "A amostragem inspeciona texto DOM renderizado, placeholders, valores de campos e conteúdo textual ::before/::after; não inspeciona texto desenhado em imagens, SVG/canvas sem nós de texto ou conteúdo de origem dentro de iframes cross-origin.",
    "Texto auxiliar e valores internos de controles com .sr-only são excluídos da amostragem visual; seus rótulos renderizados continuam sendo avaliados.",
    auditAllInteractiveStates
      ? "O modo SUINDA_CONTRAST_ALL_INTERACTIVES=1 abre disclosures nativos, percorre por hover até 400 controles renderizados por rota, inclusive abaixo da dobra (Playwright rola cada controle à vista), e usa Tab para medir foco em links e controles focáveis distintos (limite 430 visitas), sem ativar ações. Excesso do limite, cobertura incompleta, falhas, amostras não resolvidas e erros de rota fazem o comando sair com status diferente de zero. Flags opcionais abrem individualmente os menus sintéticos de navegação, quadros, conta, criação, pesquisa e notificações em /suinda; a galeria abre o diálogo de imagem; outras flags abrem Novo evento, Detalhes do evento, Detalhes de plugin, Selecionar pasta do projeto, Criar quadro, exclusão de quadro e o modal de plano de fundo da rota sintética de quadro. Menus mutuamente exclusivos devem ser medidos em execuções separadas; o conteúdo depende das fixtures ou credenciais configuradas."
      : "Para 1.4.11, o scan verifica bordas/preenchimentos de campos e botões visíveis, aciona hover por movimento do ponteiro em até três controles por rota e alcança um controle por Tab para inspecionar focus-visible. Não envia Enter/Space nem clica. Menus/modais fechados, validação que exige interação e widgets autenticados não estão cobertos sem credenciais SUINDA_A11Y_EMAIL e SUINDA_A11Y_PASSWORD.",
    "Contraste de texto grande é definido como pelo menos 24 CSS px, ou pelo menos 18.6667 CSS px com peso 700 ou superior. Texto normal exige 4.5:1; grande exige 3:1.",
    "Componentes nativos disabled são excluídos pela exceção de componente inativo de WCAG 1.4.3; aria-disabled não é excluído. Elementos ocultos ou sem área renderizada não são amostras visíveis e suas exclusões são contadas por motivo.",
  ],
};
console.log(JSON.stringify(summary, null, 2));
const failures = getContrastRunnerFailures(summary);
if (failures.length > 0) {
  console.error(`[contrast] auditoria reprovada: ${failures.map(({ field, count }) => `${field}=${count}`).join(", ")}`);
  process.exitCode = 1;
}
