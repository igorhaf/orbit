import { chromium } from "playwright";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasAuthenticatedAccessibilityFailures } from "./authenticated-runner-result.mjs";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const baseUrl = (process.env.SUINDA_A11Y_BASE_URL || "http://localhost:3003").replace(/\/$/, "");
const baseOrigin = new URL(baseUrl).origin;
const chromePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find((candidate) => existsSync(candidate));
const enrollmentId = "00000000-0000-4000-8000-000000000303";
const routes = [
  "/", "/auth/login", "/auth/register", "/auth/recover", "/auth/reset", "/profile", "/workspaces",
  "/calendar", "/search", "/inbox", "/plugins", "/access", "/extensions", "/boards", "/suinda", "/suinda/catalog",
  "/suinda/course/00000000-0000-4000-8000-000000000301",
  "/suinda/certificates/SUINDA-00000000-0000-4000-8000-000000000302", "/suinda/checkin",
  `/suinda/learning/${enrollmentId}`,
  `/suinda/learning/${enrollmentId}/agreements`, `/suinda/learning/${enrollmentId}/assessments`,
  `/suinda/learning/${enrollmentId}/attendance`, `/suinda/learning/${enrollmentId}/documents`,
  `/suinda/learning/${enrollmentId}/surveys`, `/suinda/messages/${enrollmentId}`, "/suinda/privacy",
  "/suinda/privacy-management", "/suinda/profile", "/suinda/reports", "/suinda/alumni", "/suinda/affiliates",
  "/suinda/corporate", "/suinda/subscriptions", "/suinda/integrations/certificate-signing",
  "/suinda/integrations/crm", "/suinda/integrations/open-badges", "/suinda/portfolio", "/suinda/terms",
];
const selectedRoutes = process.env.SUINDA_AUTH_A11Y_ROUTES
  ? process.env.SUINDA_AUTH_A11Y_ROUTES.split(",").map((route) => route.trim()).filter(Boolean)
    .map((route) => route.startsWith("/") ? route : `/${route}`)
  : routes;
const standardViewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];
const narrowViewport = { name: "mobile-320", width: 320, height: 844 };
const zoom200Audit = process.env.SUINDA_AUTH_A11Y_ZOOM_200 === "1";
const realChromeZoomAudit = process.env.SUINDA_AUTH_A11Y_REAL_CHROME_ZOOM_200 === "1";
const zoom200Viewport = { name: "layout-viewport-200-percent", width: 640, height: 400 };
const viewports = zoom200Audit
  ? [zoom200Viewport]
  : realChromeZoomAudit
  ? [{ name: "real-chrome-zoom-200", width: null, height: null }]
  : process.env.SUINDA_AUTH_A11Y_ONLY_NARROW_320 === "1"
  ? [narrowViewport]
  : [...standardViewports, ...(process.env.SUINDA_AUTH_A11Y_NARROW_320 === "1" ? [narrowViewport] : [])];
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const fakeToken = "synthetic-a11y-token-never-valid-outside-this-browser";
const syntheticClosedBoard = { id: "synthetic-closed-board", title: "Quadro fechado sintético",
  closed_at: "2026-10-20T12:00:00.000Z", background: "blue", starred: false, is_inbox: false, is_collection: false };
const largestTextAudit = process.env.SUINDA_AUTH_A11Y_LARGEST_TEXT === "1";
const fullKeyboardAudit = process.env.SUINDA_AUTH_A11Y_FULL_KEYBOARD === "1";
const atspiAudit = process.env.SUINDA_AUTH_A11Y_ATSPI === "1";
const atspiScript = new URL("./atspi-tree.py", import.meta.url).pathname;
const pythonPath = process.env.PYTHON3_PATH || "/usr/bin/python3";
const authProfile = process.env.SUINDA_AUTH_A11Y_PROFILE || "root";
const authProfiles = {
  root: { id: "synthetic-a11y-user", name: "Pessoa de teste", email: "a11y@example.invalid", role: "root", is_root: true,
    permissions: ["*"] },
  learner: { id: "synthetic-a11y-learner", name: "Aluna sintética", email: "learner@example.invalid", role: "user", is_root: false,
    permissions: ["plugin.suinda-learning.read"], roles: [{ role_id: "suinda_student", name: "Aluno Suindá",
      permissions: ["plugin.suinda-learning.read"] }] },
  teacher: { id: "synthetic-a11y-teacher", name: "Docente sintético", email: "teacher@example.invalid", role: "user", is_root: false,
    permissions: ["plugin.suinda-learning.read", "plugin.suinda-learning.write"] },
  workspace_manager: { id: "synthetic-a11y-workspace-manager", name: "Gestora sintética", email: "manager@example.invalid", role: "user", is_root: false,
    permissions: ["plugin.suinda-learning.read"], roles: [{ role_id: "suinda_workspace_manager", name: "Gestora acadêmica da unidade",
      permissions: ["plugin.suinda-learning.manage"] }] },
};
if (!Object.hasOwn(authProfiles, authProfile)) throw new Error(`Perfil autenticado desconhecido: ${authProfile}`);
const user = {
  ...authProfiles[authProfile], preferences: { theme: "dark", notifications: false, browserNotifications: false,
    emailNotifications: false, shortcuts: true, compactCards: false, fontScale: largestTextAudit ? "largest" : "normal" },
};

const json = (data) => ({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(data) });
const emptyObject = {};
const emptyHome = { upNext: [], highlights: [], yourItems: [], recentBoards: [], favorites: [], recentConversations: [] };
const emptyBrand = { app_name: "Suindá", icon_kind: "orbit", custom_icon_data: null,
  login_tagline: "Aprenda no seu ritmo.", login_description: "Cursos, encontros e atividades em um só lugar.", login_benefits: [] };
const emptyTeaching = { courses: [{ id: "synthetic-course", title: "Acessibilidade digital", state: "published", modality: "online" }],
  lesson_materials: [], cohorts: [{ id: "synthetic-cohort", title: "Turma de teste", state: "active",
    course_record_id: "synthetic-course", starts_at: "2026-10-01T00:00:00.000Z", ends_at: "2026-12-31T23:59:59.000Z",
    capacity: 20 }], sessions: [{ id: "synthetic-session", revision: 1, title: "Encontro de acessibilidade",
    state: "scheduled", cohort_record_id: "synthetic-cohort", starts_at: "2026-11-01T15:00:00.000Z",
    ends_at: "2026-11-01T16:00:00.000Z", modality: "online", meeting_provider: "google_meet",
    meeting_url: null, location: null, room_name: null, upcoming: true }], attendance: [], roster: [],
  announcement_receipts: [], attendance_alerts: [], submissions: [{ id: "synthetic-teacher-submission", revision: 1,
    title: "Entrega sintética", state: "submitted", assessment_title: "Reflexão sobre acessibilidade",
    learner_user_id: "synthetic-learner", submitted_at: "2026-10-20T12:00:00.000Z", answer: "Resposta fictícia para correção por teclado.",
    version: 1, files: [] }], assessment_attempts: [], pending_practices: [],
  pending_documents: [], pending_justifications: [], pending_makeup_fees: [], counts: { courses: 1, cohorts: 1,
    upcoming_sessions: 1, active_learners: 0, submissions_to_review: 1, assessment_attempts_to_review: 0,
    practices_to_review: 0, documents_to_review: 0, attendance_justifications_to_review: 0, attendance_alerts: 0 } };
const emptyLearnerTeaching = { ...emptyTeaching, courses: [], cohorts: [], sessions: [], attendance: [], roster: [],
  announcement_receipts: [], attendance_alerts: [], submissions: [], assessment_attempts: [], pending_practices: [],
  pending_documents: [], pending_justifications: [], pending_makeup_fees: [], counts: { courses: 0, cohorts: 0,
    upcoming_sessions: 0, active_learners: 0, submissions_to_review: 0, assessment_attempts_to_review: 0,
    practices_to_review: 0, documents_to_review: 0, attendance_justifications_to_review: 0, attendance_alerts: 0 } };
const syntheticSurvey = { id: "synthetic-survey", title: "Pesquisa de experiência acessível", anonymous: true,
  closes_at: null, questions: [
    { id: "synthetic-nps", type: "nps", label: "Você recomendaria este curso?", required: true, options: [], max_length: 500 },
    { id: "synthetic-choice", type: "single_choice", label: "Qual formato prefere?", required: true,
      options: ["Aulas ao vivo", "Aulas gravadas"], max_length: 500 },
    { id: "synthetic-multiple", type: "multiple_choice", label: "Quais recursos ajudaram?", required: false,
      options: ["Legendas", "Transcrição"], max_length: 500 },
    { id: "synthetic-feedback", type: "text", label: "O que podemos melhorar?", required: true, options: [], max_length: 1000 },
  ] };
const syntheticAssessment = { id: "synthetic-assessment", title: "Avaliação de acessibilidade", available: true,
  payload: { instructions: "Avaliação sintética para percorrer o fluxo de resposta por teclado.",
    due_at: "2026-12-31T23:59:00.000Z", time_limit_minutes: 0, max_attempts: 2, passing_score: 70,
    questions_per_attempt: 0, question_set: [
      { id: "synthetic-assessment-single", type: "single_choice", prompt: "Qual alternativa é correta?", points: 1,
        options: [{ id: "single-a", text: "Use texto com contraste adequado." }, { id: "single-b", text: "Remova o foco visível." }] },
      { id: "synthetic-assessment-multiple", type: "multiple_choice", prompt: "Quais recursos ajudam?", points: 1,
        options: [{ id: "multi-a", text: "Legendas" }, { id: "multi-b", text: "Transcrição" }] },
      { id: "synthetic-assessment-short", type: "short_answer", prompt: "Cite uma forma de operar sem mouse.", points: 1,
        max_length: 300, options: [] },
    ] }, attempts: [], attempts_used: 0, active_session: null };
const syntheticEnrollment = {
  id: enrollmentId, workspace_id: "synthetic-workspace", title: "Matrícula de teste: acessibilidade digital",
  state: "enrolled", revision: 1,
  payload: { payment_status: "paid", amount_due: 0, course_record_id: "synthetic-course", course_revision: 1 },
  dashboard: { next_sessions: [], pending_assignments: [],
    payment_entries: [{ id: "synthetic-payment-entry", currency: "BRL", amount: 10, payment_method: "pix",
      paid_at: "2026-01-15T12:00:00.000Z", payment_reference: "referencia-sintetica", notes: null }], payment_schedule: [],
    scholarship_applications: [], gamification: { points: 120, level: 2, next_level_points: 200,
      lessons_completed: 4, assessments_completed: 1, study_streak_days: 3,
      weekly_goal: { metric: "study_days", active_days: 3, target_days: 5, current_value: 3,
        target_value: 5, unit: "dias ativos", percent: 60 }, ranking_position: 1,
      badges: [{ id: "synthetic-badge", label: "Primeiro passo", description: "Emblema fictício para teste." }],
      challenges: [], leaderboard: [{ name: "Estudante fictício", points: 120, rank: 1 }] },
    certificate: null, certificates: [], announcements: [] },
};
const syntheticLearning = {
  enrollment: { id: enrollmentId, title: syntheticEnrollment.title, state: "enrolled" },
  course: { id: "synthetic-course", title: "Acessibilidade digital", payload: { workload_hours: 1, objectives: [] } },
  progress: { required_total: 1, required_completed: 0, percent: 0 },
  attendance: { percent: null, minimum_percent: 75, attended_minutes: 0, scheduled_minutes: 0,
    sessions_present: 0, sessions_absent: 0, sessions_unmarked: 0, meets_minimum: null },
  workload_progress: { attended_class_hours: 0, validated_practice_hours: 0, credited_practice_hours: 0, completed_hours: 0 },
  live_sessions: [], submissions: [],
  assignments: [{ id: "synthetic-assignment", title: "Reflexão sobre acessibilidade", payload: {
    instructions: "Resposta sintética para validar o histórico de entrega.", due_at: "2026-12-31T23:59:00.000Z",
    group_submission: false, rubric: [{ id: "synthetic-criterion", criterion: "Clareza", points: 10 }] },
    groups: [], submission: { id: "synthetic-submission", state: "returned", revision: 1,
      answer: "Resposta anterior devolvida para revisão.", submitted_at: "2026-10-20T12:00:00.000Z",
      version: 1, score: 8, feedback: "Retorno sintético da equipe docente.",
      rubric_snapshot: [{ id: "synthetic-criterion", criterion: "Clareza", points: 10 }],
      criterion_scores: [{ criterion_id: "synthetic-criterion", score: 8 }], graded_at: "2026-10-21T12:00:00.000Z",
      files: [] } }],
  practices: [],
  modules: [{ id: "synthetic-module", title: "Conteúdo acessível", completed: false, available: true,
    progress: { required_total: 1, required_completed: 0, percent: 0 }, payload: { position: 1, objectives: [] }, units: [],
    lessons: [{ id: "synthetic-lesson", title: "Legendas e transcrição", revision: 1, state: "published", completed: false,
      required: true, available: true,
      payload: { position: 1, content_type: "video", workload_minutes: 1,
        content_url: "https://media.invalid/synthetic-accessibility-video.mp4", transcript: "Esta é uma transcrição sintética para auditoria de interface.",
        transcript_reviewed: true, captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nLegenda sintética para teste.",
        captions_language: "pt-BR", captions_label: "Português (Brasil)", captions_reviewed: true,
        provider_captions_confirmed: false, attachments: [] } },
      { id: "synthetic-gallery-lesson", title: "Galeria sintética acessível", revision: 1, state: "published", completed: false,
        required: false, available: true,
        payload: { position: 2, content_type: "gallery", workload_minutes: 1, downloadable: false,
          attachments: [
            { id: "synthetic-image-1", revision: 1, file_name: "Diagrama acessível 1.png", mime_type: "image/png", size_bytes: 68, alt_text: "Diagrama sintético de navegação" },
            { id: "synthetic-image-2", revision: 1, file_name: "Diagrama acessível 2.png", mime_type: "image/png", size_bytes: 68, alt_text: "Segundo diagrama sintético de navegação" },
          ] } }],
  }],
};
const fixtures = [
  [/\/auth\/me$/, user],
  [/\/ai\/projects\/directories(?:\?.*)?$/, { path: "/home/synthetic", parent: null, name: "synthetic",
    folders: [{ name: "projeto-de-teste", path: "/home/synthetic/projeto-de-teste" }] }],
  [/\/auth\/social\/providers$/, { providers: [] }],
  [/\/branding$/, emptyBrand],
  [/\/public\/workspace-branding\/host$/, null],
  [/\/account\/mfa$/, { enabled: false }],
  [/\/account$/, { ...user, preferences: user.preferences, mfa_enabled: false,
    font_scale: largestTextAudit ? "largest" : "normal" }],
  [/\/calendar\/sources$/, [{ id: "synthetic-calendar-source", provider_id: "orbit_cards", connection_id: null,
    external_id: "synthetic-calendar", name: "Agenda sintética", time_zone: "America/Recife", color: "#0c66e4",
    access_role: "owner", is_primary: true, selected: true, visible: true, is_default: true,
    capabilities: { read: true, create: true, update: true, delete: true }, metadata: {}, settings: {} }]],
  [/\/(?:account\/(?:activity|login-history|cards)|ai\/projects|backups|boards|inbox\/cards|calendar\/items|saved-searches|access\/(?:users|roles|permissions|audit))(?:\?.*)?$/, []],
  [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/learning$/, syntheticLearning],
  [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/signatures$/, { signer_name: "", terms: [], history: [] }],
  [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/community(?:\?.*)?$/, { moderator: false,
    threads: [{ id: "synthetic-community-thread", title: "Pergunta fictícia sobre acessibilidade",
      state: "open", created_at: "2026-10-01T12:00:00.000Z", pinned: false,
      payload: { author_user_id: "synthetic-other-learner", thread_type: "question",
        body: "Tópico fictício para testar o formulário de denúncia pelo teclado." },
      replies: [], reactions: { like: 1 }, my_reaction: null }] }],
  [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/documents$/, { documents: [], academic_documents: [], checklist: [],
    course_revision: 1, enrollment_state: "enrolled", enrollment_revision: 1 }],
  [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/surveys$/, { surveys: [syntheticSurvey] }],
  [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/assessments$/, [syntheticAssessment]],
  [/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/messages$/, { viewer_role: "learner",
    contacts: [{ user_id: "synthetic-teacher-1", name: "Docente fictícia" },
      { user_id: "synthetic-tutor-1", name: "Tutor fictício" }],
    messages: [{ id: "synthetic-message-1", sender_user_id: "synthetic-teacher-1",
      recipient_user_id: user.id, sender_name: "Docente fictícia", recipient_name: user.name,
      body: "Bem-vinda à turma. Pode me chamar por aqui.", sent_at: "2026-10-20T12:00:00.000Z" }] }],
  [/\/extensions\/suinda-learning\/me\/reports(?:\?.*)?$/, { generated_at: "2026-01-01T00:00:00.000Z", range: { from: "2026-01-01", to: "2026-12-31" },
    workspace_count: 0, unit_scope: false, totals: {}, courses: [], cohort_occupancy: [], monthly_trend: [], cohort_attrition: [],
    referral_origins: [], teaching_workload: [], teacher_evaluations: [], most_sought_courses: [], financial_by_cohort: [],
    financial: { collected_in_period: [], outstanding_current: [], by_course: [] }, unit_summary: [], unit_financial: [] }],
  [/\/extensions\/suinda-learning\/me\/(?:privacy-requests|privacy-notices|privacy-consents)(?:\?.*)?$/, []],
  [/\/home$/, emptyHome],
  [/\/extensions\/suinda-learning\/me\/teaching$/, emptyTeaching],
  [/\/extensions\/suinda-learning\/me\/teaching\/community-reports$/, []],
  [/\/extensions\/suinda-learning\/me\/teaching\/courses\/[^/]+\/community$/, []],
  [/\/extensions\/suinda-learning\/me\/teaching\/cohorts\/[^/]+\/announcement-templates$/, { templates: [] }],
  [/\/extensions\/suinda-learning\/me\/teaching\/surveys(?:\?.*)?$/, { surveys: [], next_cursor: null }],
  [/\/extensions\/suinda-learning\/me\/alumni$/, []],
  [/\/workspaces\/options$/, { users: [], roles: [] }],
  [/\/search\/advanced(?:\?.*)?$/, { cards: [] }],
  [/\/notifications$/, [{ id: "synthetic-notification-1", plugin_id: "suinda-learning", kind: "announcement",
    title: "Aviso sintético", body: "Notificação fictícia para testar ações por teclado.", created_at: "2026-01-15T12:00:00.000Z",
    read_at: null, board_id: null, board_title: null, card_id: null, target_url: null }]],
  [/\/notifications(?:\/unread-count|\/count)?$/, { notifications: [], unread_count: 0, count: 0 }],
  [/\/notifications\/push\/config$/, { enabled: false, public_key: null, subscribed: false }],
  [/\/transcript$/, { entries: [] }],
  [/\/seasons$/, { seasons: [{ id: "synthetic-season", title: "Temporada sintética de aprendizagem",
    description: "Dados fictícios para testar a divulgação do ranking.", opens_at: "2026-01-01T00:00:00.000Z",
    closes_at: "2026-12-31T23:59:59.000Z", my_points: 10, my_rank: 1,
    leaderboard: [{ name: "Estudante fictício", score: 10, rank: 1 }], course_standings: [] }] }],
  [/\/learning-paths$/, { paths: [], profile_selection_required: false }],
  [/\/calendar-subscription$/, { active: false }],
  [/\/certificate-signature$/, { status: "not_configured", configured: false }],
  [/\/privacy-workspaces$/, []],
  [/\/profiles$/, []],
  [/\/dashboard$/, [syntheticEnrollment]],
  [/\/portfolio$/, []],
  [/\/public\/suinda\/courses(?:\?.*)?$/, []],
  [/\/public\/suinda\/courses\/[^/]+\/cohorts(?:\?.*)?$/, []],
  [/\/workspaces$/, []],
  [/\/boards$/, []],
  [/\/calendar\/sources$/, []],
  [/\/zoom\/status$/, { configured: false, connections: [] }],
  [/\/plugins(?:\/catalog)?$/, { plugins: [{ id: "suinda-learning", name: "Aprendizagem Suindá", enabled: true,
    status: "active", version: "1.0.0", actions: [{ id: "catalog", name: "Consultar cursos" }], capabilities: [],
    contributions: { navigation: [
      { id: "suinda", label: "Minha aprendizagem", href: "/suinda", permission: "plugin.suinda-learning.read", order: 5,
        group: { id: "learning", label: "Aprendizagem", order: 5 } },
      { id: "suinda-catalog", label: "Catálogo de cursos", href: "/suinda/catalog", permission: "plugin.suinda-learning.read", order: 6,
        group: { id: "learning", label: "Aprendizagem", order: 5 } },
    ] } }, { id: "project-boards", name: "Quadros", enabled: true, status: "active", version: "1.0.0",
    actions: [], capabilities: [], contributions: { boardCreators: [] } }] }],
  [/\/extensions(?:\/catalog)?$/, []],
  [/\/access\/simulation\/roles$/, [
    { id: "user", name: "Aluno de teste", permissions: ["plugin.suinda-learning.read"] },
    { id: "suinda_teacher", name: "Docente de teste", permissions: ["plugin.suinda-learning.read", "plugin.suinda-learning.write"] },
  ]],
  [/\/search(?:\?.*)?$/, { results: [], total: 0 }],
];

function fixtureFor(url, method) {
  const pathname = new URL(url).pathname;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") return { ...json({ ok: true, synthetic: true }), status: 200 };
  const requestUrl = new URL(url);
  if (fullKeyboardAudit && /\/boards$/.test(pathname) && requestUrl.searchParams.get("status") === "closed")
    return json([syntheticClosedBoard]);
  for (const [pattern, value] of fixtures) if (pattern.test(pathname + new URL(url).search)) return json(value);
  if (/\/api\/public\/suinda\/courses\/[^/]+$/.test(pathname)) return json({
    id: pathname.split("/").at(-1), workspace_id: "synthetic-workspace", workspace_name: "Instituição de teste",
    instructors: [], title: "Curso de demonstração", state: "published",
    payload: { summary: "Conteúdo sintético para auditoria de interface.", description: "", category: "Formação",
      tags: [], modality: "online", format: "open", level: "introductory", workload_hours: 8,
      objectives: [], price_amount: 0, currency: "BRL", required_document_categories: [], application_form_fields: [] },
  });
  if (/\/api\/public\/suinda\/certificates\/[^/]+$/.test(pathname)) return json({
    authentic: true, status: "valid", certificate_code: pathname.split("/").at(-1), learner_name: "Pessoa de teste",
    course_title: "Curso de demonstração", workload_hours: 8, issued_at: "2026-01-01T12:00:00.000Z",
    expires_at: null, signer_names: [],
  });
  if (/\/api\/calendar\/items$/.test(pathname)) return json([]);
  if (/\/api\/(?:extensions\/suinda-|public\/suinda\/|extensions\/suinda\/)/.test(pathname)) {
    if (/\/(?:courses|cohorts|enrollments|sessions|requests|documents|surveys|assessments|agreements|certificates|affiliates|privacy-requests|reports|subscriptions|messages|announcements|scholarships|scholarship-counterparties|counterparties|alumni|groups|participants|connections|files|records|students|teachers|campaigns|programs|categories|mappings)(?:\/[^/]+)?$/.test(pathname)) return json([]);
    return json({ items: [], entries: [], results: [], records: [], total: 0, next_cursor: null, configured: false,
      enabled: false, active: false, status: "not_configured", cohorts: [], sessions: [], requests: [], documents: [],
      surveys: [], assessments: [], agreements: [], certificates: [], affiliates: [], privacy_requests: [],
      rows: [], summary: {}, settings: {}, connections: [], workspaces: [], courses: [], enrollments: [],
      recommendations: [],
      can_edit: false, can_manage: false });
  }
  if (/\/api\/(?:auth\/me|users\/me)$/.test(pathname)) return json(user);
  return json(emptyObject);
}

let temporaryZoomProfile = null;
let browser;
let actualBrowserZoom = null;
if (realChromeZoomAudit) {
  temporaryZoomProfile = mkdtempSync(join(tmpdir(), "suinda-real-zoom-"));
  browser = await chromium.launchPersistentContext(temporaryZoomProfile, { headless: false, viewport: null,
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: ["--no-sandbox", "--window-size=1280,800"] });
  const settingsPage = browser.pages()[0] || await browser.newPage();
  await settingsPage.goto("chrome://settings/appearance", { waitUntil: "domcontentloaded" });
  const zoomSelect = settingsPage.locator("settings-ui #zoomLevel");
  await zoomSelect.waitFor({ state: "visible", timeout: 10000 });
  await zoomSelect.selectOption({ label: "200%" });
  actualBrowserZoom = await zoomSelect.locator("option:checked").textContent();
  if (actualBrowserZoom?.trim() !== "200%") throw new Error("O Chrome não confirmou a seleção de zoom real em 200%.");
  await settingsPage.goto("about:blank");
} else {
  browser = await chromium.launch({ headless: !atspiAudit, ...(chromePath ? { executablePath: chromePath } : {}),
    args: ["--no-sandbox", ...(atspiAudit ? ["--force-renderer-accessibility"] : [])] });
}
const routeResults = [];
const apiRequests = new Map();
const apiRequestsObserved = new Map();
const genericFallbacks = new Map();
const blockedExternal = [];
let blockedSocketIoRequests = 0;
const escapedApiRequests = [];
const apiMethods = new Map();
const consoleErrors = [];
const pageErrors = [];
const axeTotals = new Map();
const focusFailures = [];
const atspiFailures = [];
const keyboardSequenceFailures = [];
const keyboardInteractionFailures = [];
const keyboardInteractionResults = [];
const roleAccessFailures = [];
const semanticFailures = [];
const responsiveFailures = [];
let browserFatalError = null;
let realZoomWindowConfigured = false;

function parseCssRgb(raw) {
  const values = String(raw || "").match(/[\d.]+/g)?.map(Number) || [];
  if (values.length < 3 || values.slice(0, 3).some((value) => !Number.isFinite(value))) return null;
  return { r: values[0], g: values[1], b: values[2] };
}
function contrastRatio(foreground, background) {
  if (!foreground || !background) return null;
  const luminance = ({ r, g, b }) => [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function axeViolations(page) {
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ path: axePath });
  return page.evaluate(async (tags) => {
    const report = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
    return report.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length,
      nodes: nodes.slice(0, 5).map((node) => ({ target: node.target, failure: node.failureSummary?.slice(0, 500) })) }));
  }, wcagTags);
}

async function keyboardRoundTrip(page) {
  const maxSteps = 180;
  const candidates = await page.evaluate(() => {
    const selector = 'a[href],button,input:not([type="hidden"]),select,textarea,video[controls],audio[controls],iframe[title],[tabindex]:not([tabindex="-1"]),[contenteditable="true"],summary';
    const elements = [...document.querySelectorAll(selector)].filter((element) => {
      const style = getComputedStyle(element);
      return !element.matches(":disabled") && !element.closest("[aria-hidden=true],[inert],nextjs-portal")
        && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
        && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
    });
    const radioGroups = new Map();
    return elements.filter((element) => {
      if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) return true;
      const form = element.form || document;
      const names = radioGroups.get(form) || new Set();
      radioGroups.set(form, names);
      if (names.has(element.name)) return false;
      names.add(element.name);
      const group = elements.filter((candidate) => candidate instanceof HTMLInputElement && candidate.type === "radio"
        && candidate.name === element.name && (candidate.form || document) === form);
      return element === (group.find((candidate) => candidate.checked) || group[0]);
    }).length;
  });
  const readFocus = () => page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement)
      return { kind: "body", key: "body", visible: true, tag: element?.tagName?.toLowerCase() || null, name: "" };
    const path = [];
    let current = element;
    while (current && current !== document.body && path.length < 32) {
      const parent = current.parentElement;
      if (!parent) break;
      path.unshift([...parent.children].indexOf(current));
      current = parent;
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { kind: element instanceof HTMLIFrameElement ? "iframe" : "element", key: path.join("."), path,
      visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0,
      tag: element.tagName.toLowerCase(), type: element.getAttribute("type"), id: element.id || null,
      class_name: String(element.className || "").slice(0, 100), tabindex: element.getAttribute("tabindex"),
      name: (element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.value || "").replace(/\s+/g, " ").trim().slice(0, 90) };
  });
  const forward = [];
  let forwardCycle = false;
  let forwardIframe = false;
  let forwardEnded = false;
  let forwardStopReason = "step-limit";
  let forwardStopTarget = null;
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const selector = 'a[href],button,input:not([type="hidden"]),select,textarea,video[controls],audio[controls],iframe[title],[tabindex]:not([tabindex="-1"]),[contenteditable="true"],summary';
    const first = [...document.querySelectorAll(selector)].find((element) => {
      const style = getComputedStyle(element);
      return !element.matches(":disabled") && !element.closest("[aria-hidden=true],[inert],nextjs-portal")
        && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
        && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
    });
    first?.focus();
  });
  const firstFocus = await readFocus();
  if (firstFocus.kind === "iframe") forwardIframe = true;
  else if (firstFocus.kind === "element" && firstFocus.visible) forward.push(firstFocus);
  for (let step = 0; step < maxSteps; step += 1) {
    if (forwardIframe) break;
    await page.keyboard.press("Tab");
    const focus = await readFocus();
    if (focus.kind === "iframe") { forwardIframe = true; forwardStopReason = "iframe"; break; }
    if (focus.kind === "body") { forwardEnded = true; forwardStopReason = "document-end"; break; }
    if (!focus.visible) { forwardStopReason = "invisible-target"; forwardStopTarget = focus; break; }
    if (forward.some((item) => item.key === focus.key)) {
      if (focus.tag === "input" && ["date", "time", "datetime-local", "month", "week"].includes(focus.type)) continue;
      forwardCycle = focus.key === forward[0]?.key;
      forwardStopReason = forwardCycle ? "complete-cycle" : "duplicate-target";
      break;
    }
    forward.push(focus);
  }
  let reverseCycle = false;
  let reverseIframe = false;
  let reverseEnded = false;
  let reverseStopReason = "no-start-target";
  let reverseStopTarget = null;
  const reverse = [];
  const last = forward.at(-1);
  if (last) {
    await page.evaluate((path) => {
      let element = document.body;
      for (const index of path) element = element.children[index];
      element?.focus();
    }, last.path);
    reverse.push(last);
    for (let step = 0; step < maxSteps; step += 1) {
      await page.keyboard.press("Shift+Tab");
      const focus = await readFocus();
      if (focus.kind === "iframe") { reverseIframe = true; reverseStopReason = "iframe"; break; }
      if (focus.kind === "body") { reverseEnded = true; reverseStopReason = "document-end"; break; }
      if (!focus.visible) { reverseStopReason = "invisible-target"; reverseStopTarget = focus; break; }
      if (focus.key === last.key) {
        if (focus.tag === "input" && ["date", "time", "datetime-local", "month", "week"].includes(focus.type)) continue;
        reverseCycle = true;
        reverseStopReason = "complete-cycle";
        break;
      }
      if (reverse.some((item) => item.key === focus.key)) {
        if (focus.tag === "input" && ["date", "time", "datetime-local", "month", "week"].includes(focus.type)) continue;
        reverseStopReason = "duplicate-target";
        break;
      }
      reverse.push(focus);
    }
  }
  const expectedReverse = [...forward].reverse().map((item) => item.key);
  const actualReverse = reverse.map((item) => item.key);
  const reverseMatches = expectedReverse.length > 0 && expectedReverse.length === actualReverse.length
    && expectedReverse.every((key, index) => key === actualReverse[index]);
  const candidateCoverage = candidates ? forward.length / candidates : 1;
  return { passed: (forwardEnded || forwardCycle) && (reverseEnded || reverseCycle) && candidateCoverage >= 0.6
      && reverseMatches && !forwardIframe && !reverseIframe,
    estimated_focusable_count: candidates, forward_count: forward.length, reverse_count: reverse.length,
    forward_ended: forwardEnded, reverse_ended: reverseEnded, candidate_coverage: candidateCoverage,
    forward_stop_reason: forwardStopReason, reverse_stop_reason: reverseStopReason,
    forward_stop_target: forwardStopTarget, reverse_stop_target: reverseStopTarget,
    forward_cycle: forwardCycle, reverse_cycle: reverseCycle, reverse_matches: reverseMatches,
    iframe_focus_uninspected: forwardIframe || reverseIframe,
    forward_sequence: forward.map(({ tag, type, id, class_name, tabindex, name }) => ({ tag, type, id, class_name, tabindex, name })),
    reverse_sequence: reverse.map(({ tag, type, id, class_name, tabindex, name }) => ({ tag, type, id, class_name, tabindex, name })) };
}

async function keyboardGalleryInteraction(page) {
  const actions = [];
  const videoLesson = page.getByRole("button", { name: /Legendas e transcrição/ });
  if (await videoLesson.count() !== 1) throw new Error("A aula sintética de vídeo não está disponível para testar a transcrição.");
  await videoLesson.focus();
  await page.keyboard.press("Enter");
  const transcriptDisclosure = await keyboardNativeDisclosureInteractions(page);
  if (!transcriptDisclosure.disclosures.some((disclosure) => disclosure.label.includes("Transcrição")))
    throw new Error(`A transcrição não passou pela ativação genérica de disclosure: ${JSON.stringify(transcriptDisclosure)}.`);
  actions.push("Enter revela e recolhe a transcrição nativa, mantém foco e restaura estado inicial");

  const galleryLesson = page.getByRole("button", { name: /Galeria sintética acessível/ });
  if (await galleryLesson.count() !== 1) throw new Error("A aula de galeria sintética não está disponível na jornada de aprendizagem.");
  await galleryLesson.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-current") === "page");
  actions.push("Enter seleciona a aula da galeria");

  const firstImage = page.getByRole("button", { name: "Ampliar imagem 1: Diagrama acessível 1.png" });
  await firstImage.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Ampliar imagem 1: Diagrama acessível 1.png"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await firstImage.focus();
  await page.keyboard.press("Enter");
  const dialogOne = page.getByRole("dialog", { name: "Imagem 1 de 2" });
  await dialogOne.waitFor({ state: "visible" });
  actions.push("Enter abre o modal da imagem com nome acessível");
  const modalContrast = await dialogOne.evaluate((dialog) => {
    const background = getComputedStyle(dialog).backgroundColor;
    const samples = ["[aria-live]"];
    return { background, text: samples.map((selector) => {
      const element = dialog.querySelector(selector);
      if (!element) return { selector, missing: true };
      return { selector, text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
        foreground: getComputedStyle(element).color, background };
    }) };
  });
  const lowContrastText = modalContrast.text.filter((sample) => !sample.missing
    && (contrastRatio(parseCssRgb(sample.foreground), parseCssRgb(sample.background)) ?? 0) < 4.5);
  if (lowContrastText.length) throw new Error(`Texto do modal abaixo de 4,5:1: ${JSON.stringify(lowContrastText)}.`);
  modalContrast.text = modalContrast.text.map((sample) => ({ ...sample,
    ratio: sample.missing ? null : contrastRatio(parseCssRgb(sample.foreground), parseCssRgb(sample.background)) }));

  await page.waitForTimeout(250);
  const initialModalFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName.toLowerCase() || null,
    aria_label: document.activeElement?.getAttribute("aria-label") || null,
    role: document.activeElement?.getAttribute("role") || null,
    inside_dialog: Boolean(document.activeElement?.closest('[role="dialog"]')) }));
  if (!initialModalFocus.inside_dialog) throw new Error(`O foco inicial ficou fora do modal: ${JSON.stringify(initialModalFocus)}.`);
  const modalFocusables = dialogOne.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  const firstModalControl = modalFocusables.first();
  const lastModalControl = modalFocusables.last();
  await firstModalControl.focus();
  await page.keyboard.press("Shift+Tab");
  if (!await lastModalControl.evaluate((element) => element === document.activeElement))
    throw new Error("Shift+Tab não percorreu do primeiro para o último controle do modal.");
  await page.keyboard.press("Tab");
  if (!await firstModalControl.evaluate((element) => element === document.activeElement))
    throw new Error("Tab não manteve o foco em ciclo dentro do modal.");
  actions.push("foco inicial dentro do modal e Tab/Shift+Tab cíclicos");

  await page.keyboard.press("ArrowRight");
  await page.getByRole("dialog", { name: "Imagem 2 de 2" }).waitFor({ state: "visible" });
  actions.push("seta direita avança a imagem e atualiza o nome do modal");
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("dialog", { name: "Imagem 1 de 2" }).waitFor({ state: "visible" });
  actions.push("seta esquerda retorna à imagem anterior");

  await page.keyboard.press("Tab");
  const focusStyle = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    return { name: element.getAttribute("aria-label"), outline_color: style.outlineColor,
      outline_style: style.outlineStyle, outline_width: style.outlineWidth };
  });
  const focusContrast = contrastRatio(parseCssRgb(focusStyle?.outline_color), parseCssRgb(modalContrast.background));
  if (focusStyle?.name !== "Próxima imagem" || focusStyle.outline_style === "none"
    || Number.parseFloat(focusStyle.outline_width) < 2 || (focusContrast ?? 0) < 3)
    throw new Error(`Foco do modal sem indicador de 2px e contraste 3:1: ${JSON.stringify({ focusStyle, focusContrast })}.`);
  modalContrast.focus = { ...focusStyle, ratio_against_dialog: focusContrast };
  await page.keyboard.press("Space");
  await page.getByRole("dialog", { name: "Imagem 2 de 2" }).waitFor({ state: "visible" });
  actions.push("Espaço ativa o botão Próxima imagem");
  const previous = page.getByRole("dialog", { name: "Imagem 2 de 2" }).getByRole("button", { name: "Imagem anterior" });
  await previous.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Imagem 1 de 2" }).waitFor({ state: "visible" });
  actions.push("Enter ativa o botão Imagem anterior");

  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Imagem 1 de 2" }).waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Ampliar imagem 1: Diagrama acessível 1.png");
  actions.push("Escape fecha o modal e restaura foco ao acionador");
  return { passed: true, actions, native_disclosure: transcriptDisclosure, modal_contrast: modalContrast };
}

async function keyboardCommunityReportInteraction(page) {
  const trigger = page.getByRole("button", { name: "Denunciar", exact: true });
  if (await trigger.count() !== 1) throw new Error("O tópico comunitário sintético não renderizou um acionador único de denúncia.");
  await trigger.focus();
  await page.keyboard.press("Enter");
  if (await trigger.getAttribute("aria-expanded") !== "true")
    throw new Error("Enter não expandiu o formulário de denúncia do tópico.");
  const reason = page.getByLabel("Motivo da denúncia");
  const details = page.getByLabel("Detalhes opcionais da denúncia");
  const submit = page.getByRole("button", { name: "Enviar denúncia", exact: true });
  await reason.waitFor({ state: "visible" });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações no formulário de denúncia aberto: ${JSON.stringify(openAxe)}.`);
  await page.keyboard.press("Tab");
  if (!await reason.evaluate((element) => document.activeElement === element))
    throw new Error("Tab não moveu do acionador para o seletor de motivo da denúncia.");
  await page.keyboard.press("End");
  if (await reason.inputValue() !== "other") throw new Error("End não selecionou a última opção do seletor nativo por teclado.");
  await page.keyboard.press("Tab");
  if (!await details.evaluate((element) => document.activeElement === element))
    throw new Error("Tab não alcançou o campo de detalhes da denúncia.");
  await page.keyboard.press("Tab");
  if (!await submit.evaluate((element) => document.activeElement === element))
    throw new Error("Tab não alcançou a ação de envio sem submeter o formulário.");
  for (let step = 0; step < 3; step += 1) await page.keyboard.press("Shift+Tab");
  if (!await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("Shift+Tab não retornou do formulário de denúncia ao seu acionador.");
  await page.keyboard.press("Enter");
  if (await trigger.getAttribute("aria-expanded") !== "false" || await reason.isVisible()
    || !await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("Enter não recolheu o formulário de denúncia com foco restaurado.");
  return { passed: true, type: "community-report-disclosure", actions: [
    "Enter abre o formulário de denúncia e axe passa aberto",
    "Tab alcança o seletor e End opera suas opções nativas por teclado",
    "Tab alcança detalhes e envio sem enviar a denúncia",
    "Shift+Tab retorna ao acionador e Enter fecha restaurando foco",
  ] };
}

async function keyboardCommunityJourneyInteraction(page) {
  const actions = [];
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações na comunidade antes das ações: ${JSON.stringify(openAxe)}.`);
  const type = page.getByLabel("Tipo de tópico");
  await type.focus();
  await page.keyboard.press("End");
  if (await type.inputValue() !== "discussion") throw new Error("End não selecionou o tipo Discussão no seletor nativo.");
  const title = page.getByLabel("Título do tópico");
  await title.focus();
  await page.keyboard.type("Discussão sintética pelo teclado");
  const body = page.getByLabel("Texto da pergunta ou contribuição");
  await body.focus();
  await page.keyboard.type("Contribuição de teste isolada para revisar este conteúdo.");
  const publish = page.getByRole("button", { name: "Publicar tópico", exact: true });
  await publish.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Tópico “Discussão sintética pelo teclado” publicado." }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "Discussão sintética pelo teclado", exact: true }).waitFor({ state: "visible" });
  actions.push("End seleciona Discussão; o teclado preenche título e texto; Enter publica e anuncia o novo tópico");

  const existingThread = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: "Pergunta fictícia sobre acessibilidade", exact: true }),
  });
  const reaction = existingThread.getByRole("button", { name: /Útil ·/ });
  await reaction.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => {
    const heading = [...document.querySelectorAll("h4")].find((element) => element.textContent?.trim() === "Pergunta fictícia sobre acessibilidade");
    const item = heading?.closest("li");
    return item?.querySelector('button[aria-pressed="true"]') !== null;
  });
  actions.push("Espaço ativa a reação Útil e o estado pressionado persiste após atualizar a fixture");

  const reply = page.getByLabel("Resposta ao tópico: Pergunta fictícia sobre acessibilidade");
  await reply.focus();
  await page.keyboard.type("Obrigado pela pergunta; segue uma resposta sintética.");
  await page.keyboard.press("Tab");
  const respond = existingThread.getByRole("button", { name: "Responder", exact: true });
  if (!await respond.evaluate((element) => element === document.activeElement)) throw new Error("Tab não alcançou Responder no tópico existente.");
  await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Resposta enviada no tópico “Pergunta fictícia sobre acessibilidade”." }).waitFor({ state: "visible" });
  await existingThread.getByText("Obrigado pela pergunta; segue uma resposta sintética.", { exact: true }).waitFor({ state: "visible" });
  actions.push("Tab e Enter enviam a resposta e a atualização mostra o texto publicado");
  const postAxe = await axeViolations(page);
  if (postAxe.length) throw new Error(`Axe encontrou violações após criar, reagir e responder: ${JSON.stringify(postAxe)}.`);
  return { passed: true, type: "course-community-keyboard", actions,
    note: "Os três POSTs receberam sucesso sintético do interceptador; nenhuma alteração chegou à API." };
}

async function keyboardStudyGroupsInteraction(page) {
  const actions = [];
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações nos grupos de estudo antes das ações: ${JSON.stringify(openAxe)}.`);
  const existingGroup = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: "Grupo aberto de acessibilidade", exact: true }),
  });
  const join = existingGroup.getByRole("button", { name: "Participar", exact: true });
  await join.focus();
  await page.keyboard.press("Enter");
  await existingGroup.getByText("3/4", { exact: true }).waitFor({ state: "visible" });
  const groupLog = existingGroup.getByRole("log", { name: "Mensagens do grupo de estudo" });
  await groupLog.getByText("Vamos revisar as legendas nesta semana.", { exact: true }).waitFor({ state: "visible" });
  actions.push("Enter participa do grupo, atualiza a lotação e abre a conversa com histórico nomeado");

  const draft = existingGroup.getByLabel("Nova mensagem no grupo");
  await draft.focus();
  await page.keyboard.type("Sugiro revisar as transcrições no próximo encontro.");
  const send = existingGroup.getByRole("button", { name: "Enviar", exact: true });
  await send.focus();
  await page.keyboard.press("Enter");
  await groupLog.getByText("Sugiro revisar as transcrições no próximo encontro.", { exact: true }).waitFor({ state: "visible" });
  actions.push("O teclado escreve e envia uma mensagem; o log anuncia a mensagem adicionada");

  const capacity = page.getByLabel("Número de vagas no grupo");
  await capacity.focus();
  await page.keyboard.press("End");
  if (await capacity.inputValue() !== "30") throw new Error("End não selecionou o último limite de vagas do grupo.");
  const title = page.getByLabel("Nome do grupo");
  await title.focus();
  await page.keyboard.type("Estudo avançado de legendas");
  const description = page.getByLabel("Tema, horário ou objetivo do grupo");
  await description.focus();
  await page.keyboard.type("Revisão colaborativa de legendas e transcrições.");
  const create = page.getByRole("button", { name: "Criar grupo", exact: true });
  await create.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Estudo avançado de legendas", exact: true }).waitFor({ state: "visible" });
  actions.push("End escolhe a capacidade máxima; Enter cria o grupo e a nova conversa aparece na lista");
  const postAxe = await axeViolations(page);
  if (postAxe.length) throw new Error(`Axe encontrou violações após participar, conversar e criar grupo: ${JSON.stringify(postAxe)}.`);
  return { passed: true, type: "study-groups-keyboard", actions,
    note: "Participação, chat e criação foram atendidos por fixtures; nenhum POST chegou à API." };
}

async function keyboardLessonCompletionInteraction(page) {
  const actions = [];
  const videoLesson = page.getByRole("button", { name: /Legendas e transcrição/ });
  await videoLesson.focus();
  await page.keyboard.press("Enter");
  const completion = page.getByRole("button", { name: "Marcar como concluída", exact: true });
  await completion.waitFor({ state: "visible" });
  await completion.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Aula marcada como concluída." }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Concluída", exact: true }).waitFor({ state: "visible" });
  await page.getByText("1 de 1 aulas obrigatórias concluídas", { exact: true }).waitFor({ state: "visible" });
  const violations = await axeViolations(page);
  if (violations.length) throw new Error(`Axe encontrou violações após concluir a aula por teclado: ${JSON.stringify(violations)}.`);
  actions.push("Enter seleciona a aula e marca sua conclusão; status, botão e progresso do curso são atualizados");
  return { passed: true, type: "lesson-completion-keyboard", actions };
}

async function keyboardAssignmentResubmissionInteraction(page) {
  const actions = [];
  const assignment = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: "Reflexão sobre acessibilidade", exact: true }),
  });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações antes do reenvio da atividade: ${JSON.stringify(openAxe)}.`);
  const answer = assignment.locator("textarea");
  await answer.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Resposta revisada pelo teclado para reenvio.");
  const submit = assignment.getByRole("button", { name: "Reenviar atividade", exact: true });
  await submit.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Atividade enviada. A equipe docente poderá consultar sua resposta." }).waitFor({ state: "visible" });
  await assignment.getByText("Enviada", { exact: true }).waitFor({ state: "visible" });
  const savedAnswer = assignment.getByText("Ver resposta enviada · versão 2", { exact: true });
  await savedAnswer.focus();
  await page.keyboard.press("Enter");
  await assignment.getByText("Resposta revisada pelo teclado para reenvio.", { exact: true }).waitFor({ state: "visible" });
  const postAxe = await axeViolations(page);
  if (postAxe.length) throw new Error(`Axe encontrou violações após o reenvio da atividade: ${JSON.stringify(postAxe)}.`);
  actions.push("Tab/Enter atualiza a resposta devolvida; o status muda para enviada e o histórico abre a versão 2 pelo teclado");
  return { passed: true, type: "assignment-resubmission-keyboard", actions,
    note: "A resposta e o novo estado foram mantidos na fixture do navegador; o POST não chegou à API." };
}

async function keyboardLearningAssistantInteraction(page) {
  const actions = [];
  const question = page.getByRole("textbox", { name: "Sua dúvida", exact: true });
  const submit = page.getByRole("button", { name: "Perguntar", exact: true });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações antes da pergunta ao assistente: ${JSON.stringify(openAxe)}.`);
  await question.focus();
  await page.keyboard.type("O que devo revisar sobre acessibilidade?");
  await page.keyboard.press("Tab");
  if (!await submit.evaluate((element) => document.activeElement === element))
    throw new Error("Tab não alcançou o botão Perguntar depois da dúvida.");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Resposta", exact: true }).waitFor({ state: "visible" });
  await page.getByText("Use legendas e transcrições para tornar o conteúdo audiovisual acessível.", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("[1] Legendas e transcrição · Conteúdo acessível", { exact: true }).waitFor({ state: "visible" });
  const postAxe = await axeViolations(page);
  if (postAxe.length) throw new Error(`Axe encontrou violações após receber a resposta citada: ${JSON.stringify(postAxe)}.`);
  actions.push("Tab/Enter envia a pergunta; a resposta aparece com citação para aula e módulo e axe passa depois da atualização");
  return { passed: true, type: "learning-assistant-keyboard", actions,
    note: "A resposta e a citação vieram de uma fixture local; nenhuma pergunta chegou a um serviço de IA." };
}

async function keyboardMessagesInteraction(page) {
  const actions = [];
  const contact = page.getByLabel("Professor ou tutor");
  const log = page.getByRole("log", { name: "Conversa da matrícula" });
  const draft = page.getByLabel("Escreva sua mensagem");
  const submit = page.getByRole("button", { name: "Enviar mensagem", exact: true });
  await contact.waitFor({ state: "visible" });
  if (await contact.locator("option").count() !== 2) throw new Error("A conversa sintética não tem os dois contatos esperados.");
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações na conversa: ${JSON.stringify(openAxe)}.`);
  await contact.focus();
  await page.keyboard.press("End");
  if (await contact.inputValue() !== "synthetic-tutor-1") throw new Error("End não selecionou o último tutor da lista nativa por teclado.");
  actions.push("End seleciona o tutor na lista nativa de contatos");
  await page.keyboard.press("Tab");
  if (!await log.evaluate((element) => document.activeElement === element)) throw new Error("Tab não alcançou o histórico de conversa nomeado.");
  await page.keyboard.press("Tab");
  if (!await draft.evaluate((element) => document.activeElement === element)) throw new Error("Tab não alcançou o campo de composição da mensagem.");
  await page.keyboard.type("Mensagem sintética enviada pelo teclado.");
  await page.keyboard.press("Tab");
  if (!await submit.evaluate((element) => document.activeElement === element)) throw new Error("Tab não alcançou o botão de envio da mensagem.");
  await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Mensagem enviada." }).waitFor({ state: "visible" });
  actions.push("Tab percorre histórico, composição e envio; Enter envia ao endpoint interceptado e anuncia confirmação");
  const postAxe = await axeViolations(page);
  if (postAxe.length) throw new Error(`Axe encontrou violações após o envio sintético: ${JSON.stringify(postAxe)}.`);
  return { passed: true, type: "private-messaging-keyboard", actions,
    note: "A requisição POST foi respondida pelo interceptador do navegador; nenhum dado chegou à API." };
}

async function keyboardSurveyInteraction(page) {
  const actions = [];
  const recommend = page.getByRole("radio", { name: "0 de 10", exact: true });
  await recommend.waitFor({ state: "visible" });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações na pesquisa sintética: ${JSON.stringify(openAxe)}.`);
  await recommend.focus();
  await page.keyboard.press("ArrowRight");
  if (!await page.getByRole("radio", { name: "1 de 10", exact: true }).isChecked())
    throw new Error("A seta direita não moveu a seleção da escala NPS nativa.");
  actions.push("Seta direita navega a escala NPS nativa e atualiza a resposta selecionada");
  const singleChoice = page.getByLabel("Aulas ao vivo", { exact: true });
  await singleChoice.focus();
  await page.keyboard.press("Space");
  if (!await singleChoice.isChecked()) throw new Error("Espaço não selecionou a opção de resposta única.");
  const multipleChoice = page.getByLabel("Legendas", { exact: true });
  await multipleChoice.focus();
  await page.keyboard.press("Space");
  if (!await multipleChoice.isChecked()) throw new Error("Espaço não marcou a opção de múltipla escolha.");
  const feedback = page.getByLabel("O que podemos melhorar?");
  await feedback.focus();
  await page.keyboard.type("Mais exemplos com legendas e transcrições.");
  actions.push("Espaço opera escolha única e múltipla; o teclado preenche a resposta textual");
  const submit = page.getByRole("button", { name: "Enviar resposta", exact: true });
  await submit.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Resposta enviada: Pesquisa de experiência acessível" }).waitFor({ state: "visible" });
  const postAxe = await axeViolations(page);
  if (postAxe.length) throw new Error(`Axe encontrou violações após responder a pesquisa: ${JSON.stringify(postAxe)}.`);
  actions.push("Enter envia o formulário e move o foco para a confirmação acessível");
  return { passed: true, type: "course-survey-keyboard", actions,
    note: "O POST foi respondido pelo interceptador do navegador; a resposta sintética não chegou à API." };
}

async function keyboardAssessmentInteraction(page) {
  const actions = [];
  const start = page.getByRole("button", { name: "Iniciar avaliação", exact: true });
  await start.waitFor({ state: "visible" });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações na avaliação antes de iniciar: ${JSON.stringify(openAxe)}.`);
  await start.focus();
  await page.keyboard.press("Enter");
  const single = page.getByLabel("Questão 1: Use texto com contraste adequado.");
  await single.waitFor({ state: "visible" });
  actions.push("Enter inicia a avaliação; o estado de sessão e as questões são fornecidos pelo fixture local");
  await single.focus();
  await page.keyboard.press("Space");
  if (!await single.isChecked()) throw new Error("Espaço não selecionou a resposta única da avaliação.");
  const multiple = page.getByLabel("Questão 2: Legendas");
  await multiple.focus();
  await page.keyboard.press("Space");
  if (!await multiple.isChecked()) throw new Error("Espaço não selecionou a resposta múltipla da avaliação.");
  const shortAnswer = page.getByLabel("Questão 3: Cite uma forma de operar sem mouse.");
  await shortAnswer.focus();
  await page.keyboard.type("Tab e Enter.");
  const submit = page.getByRole("button", { name: "Enviar tentativa", exact: true });
  await submit.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Tentativa 1 enviada." }).waitFor({ state: "visible" });
  const postAxe = await axeViolations(page);
  if (postAxe.length) throw new Error(`Axe encontrou violações após enviar a avaliação: ${JSON.stringify(postAxe)}.`);
  actions.push("Espaço responde questões objetivas; o teclado preenche a questão curta e Enter envia a tentativa");
  return { passed: true, type: "course-assessment-keyboard", actions,
    note: "Sessão e nota foram sintetizadas no interceptador; os POSTs não chegaram à API." };
}

async function keyboardPluginNavigationInteraction(page, viewportName) {
  const actions = [];
  if (viewportName === "desktop") {
    const trigger = page.getByRole("button", { name: "Aprendizagem", exact: true });
    if (await trigger.count() !== 1) throw new Error("O acionador do menu de Aprendizagem não está disponível no desktop.");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const nav = page.getByRole("navigation", { name: "Aprendizagem" });
    await nav.waitFor({ state: "visible" });
    if (await trigger.getAttribute("aria-expanded") !== "true"
      || !(await page.getByRole("button", { name: "Catálogo de cursos" }).isVisible()))
      throw new Error("Enter não abriu o menu de plugins ou não expôs seu destino por teclado.");
    actions.push("Enter abre o menu Orbit de Aprendizagem e revela o catálogo");
    await page.keyboard.press("Tab");
    if (!(await page.getByRole("button", { name: "Minha aprendizagem" }).evaluate((item) => document.activeElement === item)))
      throw new Error("Tab não moveu o foco do acionador ao primeiro destino do menu de plugins.");
    actions.push("Tab percorre do acionador ao primeiro destino do menu");
    await page.keyboard.press("Escape");
    if (await nav.isVisible() || await trigger.getAttribute("aria-expanded") !== "false"
      || !(await trigger.evaluate((item) => document.activeElement === item)))
      throw new Error("Escape não fechou o menu nem restaurou foco ao acionador.");
    actions.push("Escape fecha o menu e restaura o foco ao acionador");
  } else {
    const trigger = page.getByRole("button", { name: "Abrir navegação" });
    if (await trigger.count() !== 1) throw new Error("O acionador da navegação móvel não está disponível.");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await nav.waitFor({ state: "visible" });
    const catalog = page.getByRole("button", { name: "Catálogo de cursos" });
    let reachedCatalog = false;
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press("Tab");
      if (await catalog.evaluate((item) => document.activeElement === item)) { reachedCatalog = true; break; }
    }
    if (await trigger.getAttribute("aria-expanded") !== "true" || !reachedCatalog)
      throw new Error("A navegação móvel abriu sem permitir alcançar o catálogo com Tab.");
    actions.push("Enter abre navegação móvel e Tab alcança o catálogo de cursos");
    if (await trigger.getAttribute("aria-controls") !== "orbit-mobile-navigation")
      throw new Error("O acionador móvel não identifica a região de navegação que controla.");
    await page.keyboard.press("Escape");
    if (await nav.isVisible() || await trigger.getAttribute("aria-expanded") !== "false"
      || !await trigger.evaluate((item) => document.activeElement === item))
      throw new Error("Escape não fechou a navegação móvel e restaurou o foco ao acionador.");
    actions.push("Escape fecha a navegação móvel e restaura o foco ao acionador");
  }
  return { passed: true, actions };
}

async function keyboardNativeDisclosureInteractions(page) {
  const disclosures = page.locator("details summary");
  const count = await disclosures.count();
  const checked = [];
  for (let index = 0; index < count; index += 1) {
    const summary = disclosures.nth(index);
    if (!await summary.isVisible()) continue;
    const details = summary.locator("xpath=ancestor::details[1]");
    const initiallyOpen = await details.evaluate((element) => element.open);
    await summary.focus();
    await page.keyboard.press("Enter");
    const openedByKeyboard = await details.evaluate((element) => element.open) !== initiallyOpen;
    if (!openedByKeyboard) throw new Error(`Enter não alternou o disclosure nativo ${index + 1}.`);
    if (!await summary.evaluate((element) => document.activeElement === element))
      throw new Error(`O foco saiu do acionador do disclosure nativo ${index + 1}.`);
    const visibleDisclosureText = (await details.innerText()).replace((await summary.innerText()).trim(), "").trim();
    if (!initiallyOpen && !visibleDisclosureText)
      throw new Error(`O disclosure nativo ${index + 1} abriu sem expor conteúdo textual.`);
    if (!initiallyOpen) {
      const openStateAxe = await axeViolations(page);
      if (openStateAxe.length)
        throw new Error(`Axe encontrou violações com o disclosure nativo ${index + 1} aberto: ${JSON.stringify(openStateAxe)}.`);
    }
    await page.keyboard.press("Enter");
    const restoredState = await details.evaluate((element) => element.open) === initiallyOpen;
    if (!restoredState) throw new Error(`Enter não restaurou o estado inicial do disclosure nativo ${index + 1}.`);
    if (!await summary.evaluate((element) => document.activeElement === element))
      throw new Error(`O foco não permaneceu no acionador após restaurar o disclosure ${index + 1}.`);
    checked.push({ index: index + 1, initially_open: initiallyOpen,
      label: (await summary.innerText()).replace(/\s+/g, " ").trim().slice(0, 120) });
  }
  return { passed: true, disclosure_count: checked.length, disclosures: checked };
}

async function keyboardNotificationInteraction(page) {
  const trigger = page.getByRole("button", { name: /^Notificações/ });
  if (await trigger.count() !== 1) throw new Error("O acionador do painel de notificações não está disponível.");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: "Notificações" });
  await panel.waitFor({ state: "visible" });
  if (await trigger.getAttribute("aria-expanded") !== "true")
    throw new Error("Enter não abriu o painel de notificações.");
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações no painel de notificações aberto: " + JSON.stringify(openAxe) + ".");

  const markRead = page.getByRole("button", { name: "Marcar notificação Aviso sintético como lida" });
  let reachedAction = false;
  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press("Tab");
    if (await markRead.evaluate((element) => document.activeElement === element)) { reachedAction = true; break; }
  }
  if (!reachedAction) throw new Error("Tab não alcançou a ação independente para marcar a notificação como lida.");
  const focusIndicator = await page.evaluate(() => {
    const control = document.activeElement;
    const panelElement = document.querySelector('[role="region"][aria-label="Notificações"]');
    if (!(control instanceof HTMLElement) || !(panelElement instanceof HTMLElement)) return null;
    const style = getComputedStyle(control);
    return { outline_color: style.outlineColor, outline_style: style.outlineStyle,
      outline_width: style.outlineWidth, panel_background: getComputedStyle(panelElement).backgroundColor };
  });
  const focusContrast = focusIndicator
    ? contrastRatio(parseCssRgb(focusIndicator.outline_color), parseCssRgb(focusIndicator.panel_background)) : null;
  if (!focusIndicator || focusIndicator.outline_style === "none" || Number.parseFloat(focusIndicator.outline_width) < 2
    || (focusContrast ?? 0) < 3)
    throw new Error("O botão independente de leitura não possui indicador de foco visível com contraste 3:1 sobre o painel: "
      + JSON.stringify({ focusIndicator, focusContrast }) + ".");
  await page.keyboard.press("Enter");
  await markRead.waitFor({ state: "detached" });
  const notificationRow = panel.locator("[data-notification-open]");
  if (!await notificationRow.evaluate((element) => document.activeElement === element))
    throw new Error("A ação de leitura removeu o foco em vez de restaurá-lo à notificação.");
  await page.keyboard.press("Escape");
  if (await panel.isVisible() || await trigger.getAttribute("aria-expanded") !== "false"
    || !await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("Escape não fechou notificações e restaurou foco ao acionador.");
  return { passed: true, actions: [
    "Enter abre o painel nomeado de notificações",
    "Tab alcança a ação de marcar como lida",
    "Enter marca como lida e mantém foco na notificação",
    "Escape fecha o painel e restaura foco ao acionador",
  ], focus_indicator: { ...focusIndicator, contrast_ratio: focusContrast } };
}

async function keyboardGlobalSearchInteraction(page) {
  await page.evaluate(() => {
    const stored = localStorage.getItem("orbit_user");
    if (!stored) throw new Error("A fixture do usuário de teste não está disponível.");
    const user = JSON.parse(stored);
    user.preferences = { ...user.preferences, shortcuts: false };
    localStorage.setItem("orbit_user", JSON.stringify(user));
    window.dispatchEvent(new Event("account:changed"));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(true))));
  const trigger = page.getByRole("button", { name: "Pesquisar em todos os quadros", exact: true });
  if (await trigger.count() !== 1) throw new Error("O acionador da pesquisa global não está disponível.");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("search", { name: "Pesquisar em todos os quadros" });
  await search.waitFor({ state: "visible" });
  if (await trigger.getAttribute("aria-expanded") !== "true")
    throw new Error("Enter não abriu a pesquisa global.");
  const input = search.getByRole("textbox", { name: "Pesquisar cartões e quadros" });
  await input.waitFor({ state: "visible" });
  if (!await input.evaluate((element) => document.activeElement === element))
    throw new Error("A pesquisa global abriu sem transferir o foco ao campo de consulta.");
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações na pesquisa global aberta: " + JSON.stringify(openAxe) + ".");
  await page.keyboard.press("Escape");
  await search.waitFor({ state: "hidden" });
  if (await trigger.getAttribute("aria-expanded") !== "false"
    || !await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("Escape não fechou a pesquisa e restaurou o foco ao acionador.");
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações após fechar a pesquisa: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, actions: [
    "Enter abre a região de pesquisa global",
    "O foco segue para o campo com nome acessível",
    "Escape fecha e devolve o foco ao acionador mesmo com atalhos globais desativados",
  ] };
}

async function keyboardCreateMenuInteraction(page) {
  const trigger = page.getByRole("button", { name: "Criar", exact: true });
  if (await trigger.count() !== 1) throw new Error("O acionador do menu Criar não está disponível.");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("region", { name: "Ações de criação" });
  await menu.waitFor({ state: "visible" });
  if (await trigger.getAttribute("aria-expanded") !== "true")
    throw new Error("Enter não abriu o menu de criação.");
  const createBoard = menu.getByRole("button", { name: "Criar quadro", exact: true });
  await createBoard.waitFor({ state: "visible" });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações no menu de criação aberto: " + JSON.stringify(openAxe) + ".");
  await page.keyboard.press("Tab");
  if (!await createBoard.evaluate((element) => document.activeElement === element))
    throw new Error("Tab não alcançou a primeira ação do menu de criação.");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  if (await trigger.getAttribute("aria-expanded") !== "false"
    || !await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("Escape não fechou o menu de criação e restaurou o foco ao acionador.");
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações após fechar o menu de criação: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, actions: [
    "Enter abre a região nomeada Ações de criação",
    "Tab alcança a primeira ação",
    "Escape fecha o menu e restaura o foco ao acionador",
  ] };
}

async function keyboardBoardCreationDialogInteraction(page) {
  const trigger = page.getByRole("button", { name: "Criar quadro", exact: true }).first();
  await trigger.waitFor({ state: "visible" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Criar quadro" });
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(250); // Avoid scanning the shared modal during its fade-in.
  if (await dialog.getAttribute("aria-modal") !== "true")
    throw new Error("O modal de criação do Orbit não declara aria-modal=true.");
  const title = dialog.locator("#board-title");
  await title.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const activeDialog = document.querySelector('[role="dialog"]');
    return Boolean(activeDialog && activeDialog.contains(document.activeElement));
  }, undefined, { timeout: 5000 });
  const initialFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName || null,
    id: document.activeElement instanceof HTMLElement ? document.activeElement.id || null : null }));
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações no modal Criar quadro: " + JSON.stringify(openAxe) + ".");

  const focusables = dialog.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  if (await focusables.count() < 2) throw new Error("O modal não contém controles suficientes para verificar o ciclo de foco.");
  const first = focusables.first();
  const last = focusables.last();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  const shiftTabWrapped = await last.evaluate((element) => document.activeElement === element);
  await page.keyboard.press("Tab");
  const tabWrapped = await first.evaluate((element) => document.activeElement === element);
  if (!shiftTabWrapped || !tabWrapped)
    throw new Error("Tab/Shift+Tab escapou do ciclo de foco do modal de criação.");

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const triggerHandle = await trigger.elementHandle();
  if (!triggerHandle) throw new Error("O acionador do modal foi removido antes da restauração de foco.");
  await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
  const restoredFocus = await trigger.evaluate((element) => document.activeElement === element);
  if (!restoredFocus) throw new Error("Escape fechou o modal sem devolver o foco ao acionador.");
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações depois de fechar Criar quadro: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, type: "orbit-create-board-modal-keyboard", actions: [
    "Enter abre o diálogo nomeado Criar quadro e mantém o foco dentro do modal",
    "Shift+Tab e Tab permanecem dentro do ciclo de foco do modal",
    "Escape fecha e devolve o foco ao botão que abriu o diálogo",
  ], initial_focus: initialFocus, axe_violations_open: openAxe, axe_violations_closed: closedAxe,
    note: "O fluxo não envia o formulário; nenhuma criação ou chamada de escrita é ativada." };
}

async function keyboardClosedBoardDeleteDialogInteraction(page) {
  const trigger = page.getByRole("button", { name: "Excluir", exact: true });
  await trigger.waitFor({ state: "visible" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Excluir quadro" });
  await dialog.waitFor({ state: "visible" });
  if (await dialog.getAttribute("aria-modal") !== "true")
    throw new Error("A confirmação Orbit de exclusão não declara aria-modal=true.");
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações na confirmação de exclusão aberta: " + JSON.stringify(openAxe) + ".");
  const focusables = dialog.locator('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  if (await focusables.count() < 2) throw new Error("A confirmação de exclusão não contém controles suficientes para testar o ciclo de foco.");
  const first = focusables.first();
  const last = focusables.last();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  const shiftTabWrapped = await last.evaluate((element) => document.activeElement === element);
  await page.keyboard.press("Tab");
  const tabWrapped = await first.evaluate((element) => document.activeElement === element);
  if (!shiftTabWrapped || !tabWrapped) throw new Error("Tab/Shift+Tab escapou do ciclo de foco da confirmação de exclusão.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const triggerHandle = await trigger.elementHandle();
  if (!triggerHandle) throw new Error("O acionador de exclusão foi removido antes da restauração do foco.");
  await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
  const restoredFocus = await trigger.evaluate((element) => document.activeElement === element);
  if (!restoredFocus) throw new Error("Escape fechou a confirmação sem devolver foco ao acionador.");
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações após fechar a confirmação de exclusão: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, type: "orbit-closed-board-delete-confirmation", actions: [
    "Enter abre a confirmação nomeada sem executar a exclusão",
    "Tab e Shift+Tab mantêm o foco dentro do diálogo",
    "Escape fecha e restaura foco ao acionador; o quadro permanece preservado",
  ], axe_violations_open: openAxe, axe_violations_closed: closedAxe,
    note: "A API de escrita ficou interceptada no navegador; nenhum quadro foi excluído." };
}

async function keyboardCalendarEventDialogInteraction(page) {
  const trigger = page.getByRole("button", { name: "Criar evento", exact: true });
  await trigger.waitFor({ state: "visible" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Novo evento" });
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  if (await dialog.getAttribute("aria-modal") !== "true")
    throw new Error("O diálogo Novo evento não declara aria-modal=true.");
  const containedFocus = await dialog.evaluate((element) => element.contains(document.activeElement));
  if (!containedFocus) throw new Error("O foco não entrou no diálogo Novo evento.");
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações no diálogo Novo evento: " + JSON.stringify(openAxe) + ".");
  const focusables = dialog.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  if (await focusables.count() < 2) throw new Error("O diálogo Novo evento não tem controles suficientes para testar o foco.");
  const first = focusables.first();
  const last = focusables.last();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  const shiftTabWrapped = await last.evaluate((element) => document.activeElement === element);
  await page.keyboard.press("Tab");
  const tabWrapped = await first.evaluate((element) => document.activeElement === element);
  if (!shiftTabWrapped || !tabWrapped) throw new Error("Tab/Shift+Tab escapou do ciclo de foco de Novo evento.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const triggerHandle = await trigger.elementHandle();
  if (!triggerHandle) throw new Error("O acionador Criar evento foi removido antes da restauração do foco.");
  await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações após fechar Novo evento: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, type: "orbit-calendar-event-dialog-keyboard", axe_violations_open: openAxe,
    axe_violations_closed: closedAxe, actions: ["Enter abre diálogo nomeado", "Tab/Shift+Tab mantêm o foco no diálogo",
      "Escape fecha, restaura foco e não cria evento"] };
}

async function keyboardPluginDetailsDialogInteraction(page) {
  const trigger = page.getByRole("button", { name: "Ações", exact: true }).first();
  await trigger.waitFor({ state: "visible" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Aprendizagem Suindá" });
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  if (await dialog.getAttribute("aria-modal") !== "true")
    throw new Error("O diálogo de detalhes de plugin não declara aria-modal=true.");
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações nos detalhes do plugin: " + JSON.stringify(openAxe) + ".");
  const focusables = dialog.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  if (await focusables.count() < 2) throw new Error("Os detalhes do plugin não têm controles suficientes para verificar o foco.");
  const first = focusables.first();
  const last = focusables.last();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  const shiftTabWrapped = await last.evaluate((element) => document.activeElement === element);
  await page.keyboard.press("Tab");
  const tabWrapped = await first.evaluate((element) => document.activeElement === element);
  if (!shiftTabWrapped || !tabWrapped) throw new Error("Tab/Shift+Tab escapou dos detalhes do plugin.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const triggerHandle = await trigger.elementHandle();
  if (!triggerHandle) throw new Error("O acionador dos detalhes foi removido antes da restauração do foco.");
  await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações após fechar os detalhes do plugin: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, type: "orbit-plugin-details-dialog-keyboard", axe_violations_open: openAxe,
    axe_violations_closed: closedAxe, actions: ["Enter abre diálogo nomeado", "Tab/Shift+Tab mantêm o foco no diálogo",
      "Escape fecha e restaura foco"] };
}

async function keyboardProjectDirectoryDialogInteraction(page) {
  const trigger = page.getByRole("button", { name: "Navegar pelas pastas", exact: true });
  await trigger.waitFor({ state: "visible" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Selecionar pasta do projeto" });
  await dialog.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "projeto-de-teste", exact: true }).waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  if (await dialog.getAttribute("aria-modal") !== "true")
    throw new Error("O seletor de pasta do projeto não declara aria-modal=true.");
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações no seletor de pasta: " + JSON.stringify(openAxe) + ".");
  const focusables = dialog.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  if (await focusables.count() < 2) throw new Error("O seletor de pasta não tem controles suficientes para verificar foco.");
  const first = focusables.first();
  const last = focusables.last();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  const shiftTabWrapped = await last.evaluate((element) => document.activeElement === element);
  await page.keyboard.press("Tab");
  const tabWrapped = await first.evaluate((element) => document.activeElement === element);
  if (!shiftTabWrapped || !tabWrapped) throw new Error("Tab/Shift+Tab escapou do seletor de pastas.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const triggerHandle = await trigger.elementHandle();
  if (!triggerHandle) throw new Error("O acionador Navegar pelas pastas foi removido antes da restauração do foco.");
  await page.waitForFunction((element) => document.activeElement === element, triggerHandle, { timeout: 2000 });
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações após fechar o seletor de pastas: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, type: "orbit-project-directory-dialog-keyboard", axe_violations_open: openAxe,
    axe_violations_closed: closedAxe, actions: ["Enter abre seletor nomeado", "Tab/Shift+Tab mantêm o foco no diálogo",
      "Escape fecha e restaura foco sem criar pastas"] };
}

async function keyboardAccountMenuInteraction(page) {
  const trigger = page.locator('button[title="Conta"]');
  if (await trigger.count() !== 1) throw new Error("O acionador do menu da conta não está disponível.");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("region", { name: "Menu da conta" });
  await menu.waitFor({ state: "visible" });
  if (await trigger.getAttribute("aria-expanded") !== "true")
    throw new Error("Enter não abriu o menu da conta.");
  const firstAction = menu.locator("button").first();
  await firstAction.waitFor({ state: "visible" });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações no menu da conta aberto: " + JSON.stringify(openAxe) + ".");
  await page.keyboard.press("Tab");
  if (!await firstAction.evaluate((element) => document.activeElement === element))
    throw new Error("Tab não alcançou a primeira ação do menu da conta.");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  if (await trigger.getAttribute("aria-expanded") !== "false"
    || !await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("Escape não fechou o menu da conta e restaurou o foco ao acionador.");
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações após fechar o menu da conta: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, actions: [
    "Enter abre a região nomeada Menu da conta",
    "Tab alcança a primeira ação",
    "Escape fecha o menu e restaura o foco ao acionador",
  ] };
}

async function keyboardBoardsMenuInteraction(page) {
  const candidates = page.getByRole("button", { name: "Quadros", exact: true });
  let trigger = null;
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) { trigger = candidate; break; }
  }
  if (!trigger) throw new Error("O acionador visível do menu Quadros não está disponível.");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("region", { name: "Alternar quadro" });
  await menu.waitFor({ state: "visible" });
  if (await trigger.getAttribute("aria-expanded") !== "true")
    throw new Error("Enter não abriu o menu Quadros.");
  const firstAction = menu.locator("button").first();
  await firstAction.waitFor({ state: "visible" });
  const search = menu.getByRole("textbox", { name: "Buscar quadro" });
  await search.waitFor({ state: "visible" });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error("Axe encontrou violações no menu Quadros aberto: " + JSON.stringify(openAxe) + ".");
  await page.keyboard.press("Tab");
  if (!await firstAction.evaluate((element) => document.activeElement === element))
    throw new Error("Tab não alcançou a primeira ação do menu Quadros.");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  if (await trigger.getAttribute("aria-expanded") !== "false"
    || !await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("Escape não fechou o menu Quadros e restaurou o foco ao acionador.");
  const closedAxe = await axeViolations(page);
  if (closedAxe.length) throw new Error("Axe encontrou violações após fechar o menu Quadros: " + JSON.stringify(closedAxe) + ".");
  return { passed: true, actions: [
    "Enter abre a região nomeada Alternar quadro",
    "Tab alcança a primeira ação do menu; a busca tem nome acessível",
    "Escape fecha o menu e restaura o foco ao acionador",
  ] };
}

async function keyboardTeacherMeetingInteraction(page) {
  const trigger = page.locator('button[aria-controls="meeting-room-creator-synthetic-session"]');
  if (await trigger.count() !== 1) throw new Error("O encontro sintético do painel docente não renderizou a criação de videoconferência.");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const region = page.getByRole("region", { name: "Criação de videoconferência" });
  await region.waitFor({ state: "visible" });
  if (await trigger.getAttribute("aria-expanded") !== "true")
    throw new Error("Enter não expandiu a região de criação de videoconferência.");
  const connectZoom = region.getByRole("button", { name: "conecte o Zoom", exact: true });
  await connectZoom.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "conecte o Zoom");
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações na criação de videoconferência aberta: ${JSON.stringify(openAxe)}.`);
  await page.keyboard.press("Shift+Tab");
  const calendarLink = region.getByRole("link", { name: "Google ou Outlook", exact: true });
  if (!await calendarLink.evaluate((element) => document.activeElement === element))
    throw new Error("Shift+Tab não percorreu para trás os controles da região de criação.");
  await page.keyboard.press("Shift+Tab");
  if (!await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("Shift+Tab não retornou o foco ao acionador da região de criação.");
  await page.keyboard.press("Enter");
  if (await region.isVisible() || await trigger.getAttribute("aria-expanded") !== "false"
    || !await trigger.evaluate((element) => document.activeElement === element))
    throw new Error("O acionador não recolheu a região ou não conservou o foco após o fechamento.");
  return { passed: true, type: "teacher-meeting-creator", actions: [
    "Enter expande a criação de videoconferência e move o foco para uma ação útil",
    "Axe passa com a região aberta",
    "Shift+Tab percorre o link de calendários e retorna ao acionador",
    "Enter recolhe a região e mantém foco no acionador",
  ] };
}

async function keyboardTeacherSubmissionGradingInteraction(page) {
  const submission = page.getByRole("listitem").filter({ hasText: "Reflexão sobre acessibilidade" });
  const score = submission.getByRole("spinbutton", { name: "Nota para Reflexão sobre acessibilidade", exact: true });
  const feedback = submission.getByRole("textbox", { name: "Feedback da atividade", exact: true });
  const complete = submission.getByRole("button", { name: "Concluir correção", exact: true });
  const openAxe = await axeViolations(page);
  if (openAxe.length) throw new Error(`Axe encontrou violações antes da correção docente: ${JSON.stringify(openAxe)}.`);
  await score.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("9");
  await feedback.focus();
  await page.keyboard.type("Boa resposta; a explicação está clara.");
  await complete.focus();
  await page.keyboard.press("Enter");
  await page.getByText("Nenhuma entrega aguardando correção.", { exact: true }).waitFor({ state: "visible" });
  const postAxe = await axeViolations(page);
  if (postAxe.length) throw new Error(`Axe encontrou violações depois da correção docente: ${JSON.stringify(postAxe)}.`);
  return { passed: true, type: "teacher-submission-grade-keyboard", actions: [
    "Tab/Enter preenche nota e feedback, conclui a correção e remove a entrega da fila após a atualização sintética",
  ], note: "A nota e a confirmação foram processadas pela fixture local; nenhum POST chegou à API." };
}

try {
  routeLoop: {
  for (const viewport of viewports) {
    for (const routePath of selectedRoutes) {
      let page;
      let routeContext = browser;
      let routeViewportMetrics = null;
      try {
        if (realChromeZoomAudit) {
          // A profile-scoped Chrome zoom setting is inherited by isolated contexts. Keeping
          // each route in a fresh context prevents one route's Next.js/API cache from
          // leaving later routes in a loading shell while preserving the real 200% zoom.
          routeContext = await browser.browser().newContext({ viewport: null, serviceWorkers: "block" });
          page = await routeContext.newPage();
        } else {
          page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: zoom200Audit ? 2 : 1 });
        }
        if (realChromeZoomAudit && !realZoomWindowConfigured) {
          const session = await browser.newCDPSession(page);
          const { windowId } = await session.send("Browser.getWindowForTarget");
          await session.send("Browser.setWindowBounds", { windowId,
            bounds: { left: 0, top: 0, width: 1280, height: 800, windowState: "normal" } });
          await session.detach();
          realZoomWindowConfigured = true;
        }
      } catch (error) {
        browserFatalError = error instanceof Error ? error.message : "O navegador encerrou antes de completar a varredura.";
        if (realChromeZoomAudit && routeContext !== browser) {
          try { await routeContext.close(); } catch {}
        }
        routeResults.push({ route: routePath, viewport: viewport.name, browser_error: browserFatalError });
        break routeLoop;
      }
      const pageConsoleErrors = [];
      const routeApiRequests = new Map();
      let assessmentState = structuredClone(syntheticAssessment);
      let learningState = structuredClone(syntheticLearning);
      let teachingState = structuredClone(authProfile === "learner" ? emptyLearnerTeaching : emptyTeaching);
      let communityThreads = [{ id: "synthetic-community-thread", title: "Pergunta fictícia sobre acessibilidade",
        state: "open", created_at: "2026-10-01T12:00:00.000Z", pinned: false,
        payload: { author_user_id: "synthetic-other-learner", thread_type: "question",
          body: "Tópico fictício para testar a comunidade por teclado." },
        replies: [], reactions: { like: 1 }, my_reaction: null }];
      let studyGroups = [{ id: "synthetic-study-group", title: "Grupo aberto de acessibilidade", state: "open",
        member_count: 2, is_member: false, is_owner: false,
        payload: { description: "Encontro sintético para estudar conteúdo acessível.", capacity: 4 } }];
      const studyGroupMessages = new Map([[
        "synthetic-study-group", [{ id: "synthetic-study-message", sender_name: "Participante fictícia",
          from_me: false, body: "Vamos revisar as legendas nesta semana.", sent_at: "2026-10-20T12:00:00.000Z" }],
      ]]);
      const pageErrorsBefore = pageErrors.length;
      page.on("request", (request) => {
        const parsed = new URL(request.url());
        if (parsed.pathname.startsWith("/api/")) {
          const key = `${request.method()} ${parsed.pathname}`;
          apiRequestsObserved.set(key, (apiRequestsObserved.get(key) || 0) + 1);
          routeApiRequests.set(key, (routeApiRequests.get(key) || 0) + 1);
        }
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          const entry = { route: routePath, viewport: viewport.name, message: message.text().slice(0, 240), url: message.location()?.url || null };
          pageConsoleErrors.push(entry);
          consoleErrors.push(entry);
        }
      });
      page.on("pageerror", (error) => pageErrors.push({ route: routePath, viewport: viewport.name,
        message: error.message.slice(0, 240), stack: error.stack?.split("\n").slice(0, 5).join("\n").slice(0, 700) || null }));
      await page.addInitScript(({ token, currentUser }) => {
        localStorage.setItem("orbit_token", token);
        localStorage.setItem("orbit_user", JSON.stringify(currentUser));
      }, { token: fakeToken, currentUser: user });
      await page.route("**/*", async (route) => {
        const request = route.request();
        const requestUrl = request.url();
        const parsed = new URL(requestUrl);
        if (parsed.origin !== baseOrigin) {
          blockedExternal.push({ route: routePath, url: requestUrl.slice(0, 220), method: request.method() });
          await route.abort("blockedbyclient");
          return;
        }
        if (parsed.pathname === "/socket.io/" || parsed.pathname.startsWith("/socket.io/")) {
          blockedSocketIoRequests += 1;
          await route.abort("blockedbyclient");
          return;
        }
        if (parsed.pathname.startsWith("/api/")) {
          const method = request.method();
          const key = `${method} ${parsed.pathname}`;
          apiRequests.set(key, (apiRequests.get(key) || 0) + 1);
          apiMethods.set(method, (apiMethods.get(method) || 0) + 1);
          if (!requestUrl.startsWith(baseUrl) && parsed.origin !== baseOrigin) escapedApiRequests.push({ route: routePath, url: requestUrl });
          if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
            if (routePath === `/suinda/learning/${enrollmentId}`
              && /\/suinda-learning-assistant\/enrollments\/[^/]+\/ask$/.test(parsed.pathname)) {
              await route.fulfill({ ...json({ answer: "Use legendas e transcrições para tornar o conteúdo audiovisual acessível.",
                citations: [{ ref: "1", lesson_id: "synthetic-lesson", lesson_title: "Legendas e transcrição",
                  module_title: "Conteúdo acessível" }] }), status: 200 });
              return;
            }
            if (routePath === "/suinda"
              && /\/teaching\/submissions\/[^/]+\/grade$/.test(parsed.pathname)) {
              teachingState = { ...teachingState, submissions: [],
                counts: { ...teachingState.counts, submissions_to_review: 0 } };
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}`
              && /\/assessments\/[^/]+\/submissions$/.test(parsed.pathname)) {
              const assignmentId = parsed.pathname.match(/\/assessments\/([^/]+)\/submissions$/)?.[1];
              const payload = request.postDataJSON();
              learningState = { ...learningState, assignments: learningState.assignments.map((assignment) => assignment.id === assignmentId
                ? { ...assignment, submission: { ...assignment.submission, state: "submitted", revision: assignment.submission.revision + 1,
                  answer: payload.answer, submitted_at: "2026-10-26T12:00:00.000Z", version: (assignment.submission.version || 1) + 1,
                  files: (payload.attachments || []).map((file, index) => ({ id: `synthetic-resubmission-${index + 1}`,
                    file_name: file.file_name, mime_type: file.mime_type, size_bytes: 0 })) } }
                : assignment) };
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}`
              && /\/lessons\/[^/]+\/complete$/.test(parsed.pathname)) {
              const lessonId = parsed.pathname.match(/\/lessons\/([^/]+)\/complete$/)?.[1];
              learningState = { ...learningState, progress: { required_total: 1, required_completed: 1, percent: 100 },
                modules: learningState.modules.map((module) => {
                  const lessons = module.lessons.map((lesson) => lesson.id === lessonId ? { ...lesson, completed: true } : lesson);
                  const units = module.units.map((unit) => ({ ...unit,
                    lessons: unit.lessons.map((lesson) => lesson.id === lessonId ? { ...lesson, completed: true } : lesson) }));
                  const allLessons = [...lessons, ...units.flatMap((unit) => unit.lessons)];
                  const required = allLessons.filter((lesson) => lesson.required);
                  const completed = required.filter((lesson) => lesson.completed).length;
                  return { ...module, lessons, units, completed: required.length > 0 && completed === required.length,
                    progress: { required_total: required.length, required_completed: completed,
                      percent: required.length ? Math.round(completed / required.length * 100) : 0 } };
                }) };
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}`
              && parsed.pathname.endsWith(`/enrollments/${enrollmentId}/community`)) {
              const payload = request.postDataJSON();
              communityThreads = [{ id: "synthetic-created-community-thread", title: payload.title,
                state: "open", created_at: "2026-10-25T12:00:00.000Z", pinned: false,
                payload: { author_user_id: user.id, thread_type: payload.thread_type, body: payload.body },
                replies: [], reactions: { like: 0 }, my_reaction: null }, ...communityThreads];
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}`
              && /\/community\/threads\/[^/]+\/replies$/.test(parsed.pathname)) {
              const threadId = parsed.pathname.match(/\/community\/threads\/([^/]+)\/replies$/)?.[1];
              const payload = request.postDataJSON();
              communityThreads = communityThreads.map((thread) => thread.id === threadId
                ? { ...thread, replies: [...thread.replies, { id: "synthetic-community-reply", created_at: "2026-10-25T12:01:00.000Z",
                  payload: { body: payload.body } }] } : thread);
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}`
              && /\/community\/threads\/[^/]+\/reactions$/.test(parsed.pathname)) {
              const threadId = parsed.pathname.match(/\/community\/threads\/([^/]+)\/reactions$/)?.[1];
              const payload = request.postDataJSON();
              communityThreads = communityThreads.map((thread) => thread.id === threadId
                ? { ...thread, my_reaction: payload.active ? "like" : null,
                  reactions: { ...thread.reactions, like: Math.max(0, (thread.reactions.like || 0) + (payload.active ? 1 : -1)) } }
                : thread);
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}`
              && parsed.pathname.endsWith(`/enrollments/${enrollmentId}/community/groups`)) {
              const payload = request.postDataJSON();
              const group = { id: "synthetic-created-study-group", title: payload.title, state: "open",
                member_count: 1, is_member: true, is_owner: true,
                payload: { description: payload.description, capacity: payload.capacity } };
              studyGroups = [group, ...studyGroups];
              studyGroupMessages.set(group.id, []);
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}`
              && /\/community\/groups\/[^/]+\/join$/.test(parsed.pathname)) {
              const groupId = parsed.pathname.match(/\/community\/groups\/([^/]+)\/join$/)?.[1];
              studyGroups = studyGroups.map((group) => group.id === groupId
                ? { ...group, is_member: true, member_count: Math.min(group.payload.capacity, group.member_count + 1) } : group);
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}`
              && /\/community\/groups\/[^/]+\/messages$/.test(parsed.pathname)) {
              const groupId = parsed.pathname.match(/\/community\/groups\/([^/]+)\/messages$/)?.[1];
              const payload = request.postDataJSON();
              studyGroupMessages.set(groupId, [...(studyGroupMessages.get(groupId) || []), {
                id: "synthetic-sent-study-message", sender_name: user.name, from_me: true,
                body: payload.body, sent_at: "2026-10-25T12:02:00.000Z",
              }]);
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}/assessments`
              && /\/assessments\/[^/]+\/sessions$/.test(parsed.pathname)) {
              assessmentState = { ...assessmentState, active_session: { id: "synthetic-assessment-session",
                attempt_number: 1, started_at: "2026-10-25T12:00:00.000Z", expires_at: null } };
              await route.fulfill({ ...json({ ok: true, synthetic: true }), status: 200 });
              return;
            }
            if (routePath === `/suinda/learning/${enrollmentId}/assessments`
              && /\/assessments\/[^/]+\/attempts$/.test(parsed.pathname)) {
              const submittedAt = "2026-10-25T12:05:00.000Z";
              assessmentState = { ...assessmentState, available: false, active_session: null, attempts_used: 1,
                attempts: [{ attempt_number: 1, submitted_at: submittedAt, grading_status: "completed",
                  score: 100, passed: true, feedback: "Resultado sintético da avaliação." }] };
              await route.fulfill({ ...json({ grading_status: "completed", attempt_number: 1,
                score: 100, passed: true }), status: 200 });
              return;
            }
            const response = { ...json({ ok: true, synthetic: true }), status: 200 };
            await route.fulfill(response);
            return;
          }
          if (/\/materials\/synthetic-image-[12]\/preview$/.test(parsed.pathname)) {
            await route.fulfill({ status: 200, contentType: "image/png",
              body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pV8AAAAASUVORK5CYII=", "base64") });
            return;
          }
          if (routePath === `/suinda/learning/${enrollmentId}/assessments`
            && /\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/assessments$/.test(parsed.pathname)) {
            await route.fulfill(json([assessmentState]));
            return;
          }
          if (routePath === `/suinda/learning/${enrollmentId}`
            && /\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/community$/.test(parsed.pathname)) {
            await route.fulfill(json({ moderator: false, threads: communityThreads }));
            return;
          }
          if (routePath === `/suinda/learning/${enrollmentId}`
            && /\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/learning$/.test(parsed.pathname)) {
            await route.fulfill(json(learningState));
            return;
          }
          if (routePath === "/suinda"
            && /\/extensions\/suinda-learning\/access-profiles\/workspaces$/.test(parsed.pathname)) {
            await route.fulfill(json(["root", "workspace_manager"].includes(authProfile)
              ? [{ id: "synthetic-workspace", name: "Instituição de teste" }] : []));
            return;
          }
          if (routePath === "/suinda"
            && /\/extensions\/suinda-learning\/me\/teaching$/.test(parsed.pathname)) {
            await route.fulfill(json(teachingState));
            return;
          }
          if (routePath === `/suinda/learning/${enrollmentId}`
            && /\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/community\/groups$/.test(parsed.pathname)) {
            await route.fulfill(json(studyGroups));
            return;
          }
          if (routePath === `/suinda/learning/${enrollmentId}`) {
            const groupChat = parsed.pathname.match(/\/extensions\/suinda-learning\/me\/enrollments\/[^/]+\/community\/groups\/([^/]+)\/messages$/);
            if (groupChat) {
              const groupId = groupChat[1];
              const group = studyGroups.find((item) => item.id === groupId);
              if (group) {
                await route.fulfill(json({ group: { id: group.id, title: group.title, state: group.state,
                  read_only: group.state !== "open" }, messages: studyGroupMessages.get(groupId) || [], next_cursor: null }));
                return;
              }
            }
          }
          const response = fixtureFor(requestUrl, method);
          const fixtureKey = `${method} ${parsed.pathname}`;
          if (!fixtures.some(([pattern]) => pattern.test(parsed.pathname + parsed.search))
            && !/\/(?:api\/)?(?:auth\/me|users\/me)$/.test(parsed.pathname)
            && !/\/api\/(?:extensions\/suinda-|public\/suinda\/|extensions\/suinda\/)/.test(parsed.pathname)) {
            genericFallbacks.set(fixtureKey, (genericFallbacks.get(fixtureKey) || 0) + 1);
          }
          await route.fulfill(response);
          return;
        }
        await route.continue();
      });
      // Socket.IO is intentionally unavailable in this isolated fixture run.
      if (typeof page.routeWebSocket === "function") page.routeWebSocket("**/*", (socket) => socket.close());

      let status = null;
      let navigationError = null;
      let title = "";
      let landmarks = null;
      let firstFocus = null;
      let atspiTree = null;
      let focusedStyles = null;
      let horizontalOverflow = false;
      let namedControlFailures = [];
      let axe = [];
      let bodyTextPreview = "";
      let keyboardSequence = null;
      try {
        const response = await page.goto(`${baseUrl}${routePath}`, { waitUntil: "networkidle", timeout: 30_000 });
        status = response?.status() ?? null;
        await page.waitForTimeout(realChromeZoomAudit ? 600 : 150);
        if (realChromeZoomAudit) await page.waitForFunction(
          () => document.querySelector("main,[role=main]") && document.querySelector("h1"), null, { timeout: 3000 },
        ).catch(() => null);
        let realZoomRecoveryReload = false;
        if (realChromeZoomAudit && !(await page.locator("main,[role=main]").count())
          && !(await page.locator("h1").count())) {
          // A transient Next.js dev-server navigation can leave a document shell without hydrating.
          // Retry once in the same authenticated Chrome profile before counting it as a route failure.
          realZoomRecoveryReload = true;
          await page.reload({ waitUntil: "networkidle", timeout: 30_000 }).catch(() => null);
          await page.waitForFunction(
            () => document.querySelector("main,[role=main]") && document.querySelector("h1"), null, { timeout: 5000 },
          ).catch(() => null);
        }
        // Next.js development tooling is not part of the Orbit/Suindá interface.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        const structure = await page.evaluate(() => {
          const nameOf = (element) => (element.getAttribute("aria-label")
            || element.getAttribute("aria-labelledby") && document.getElementById(element.getAttribute("aria-labelledby"))?.textContent
            || element.labels?.[0]?.textContent || element.getAttribute("title") || element.textContent || element.value || "").replace(/\s+/g, " ").trim();
          const controls = [...document.querySelectorAll("button,a[href],input:not([type=hidden]),select,textarea,[role=button]")]
            .filter((element) => !element.matches(":disabled") && !element.closest("[aria-hidden=true]")
              && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
          const unnamed = controls.filter((element) => !nameOf(element)).map((element) => `${element.localName}.${[...element.classList].slice(0, 2).join(".")}`);
          const viewportWidth = document.documentElement.clientWidth;
          const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
          const overflowingElements = documentWidth > viewportWidth + 1
            ? [...document.querySelectorAll("body *")].map((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return { tag: element.localName, class_name: String(element.className || "").slice(0, 100),
                text: (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
                left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
                scroll_width: element.scrollWidth, position: style.position };
            }).filter((element) => element.right > viewportWidth + 1 && element.left < viewportWidth
              && element.width > 1 && element.position !== "fixed").slice(0, 20)
            : [];
          return { title: document.title.trim(), mains: document.querySelectorAll("main,[role=main]").length,
            navs: document.querySelectorAll("nav,[role=navigation]").length, headings: document.querySelectorAll("h1").length,
            unnamed, firstFocusCandidate: controls.length ? controls[0].localName : null,
            viewport_width: viewportWidth, document_width: documentWidth,
            viewport_height: document.documentElement.clientHeight, device_pixel_ratio: window.devicePixelRatio,
            visual_viewport_scale: window.visualViewport?.scale ?? null,
            synthetic_token_present: Boolean(localStorage.getItem("orbit_token")),
            synthetic_user_present: Boolean(localStorage.getItem("orbit_user")),
            body_text_preview: (document.body?.innerText || "").slice(0, 600),
            horizontal_overflow: documentWidth > viewportWidth + 1,
            overflowing_elements: overflowingElements };
        });
        routeViewportMetrics = { width_css: structure.viewport_width, height_css: structure.viewport_height,
          device_pixel_ratio: structure.device_pixel_ratio, visual_viewport_scale: structure.visual_viewport_scale,
          synthetic_token_present: structure.synthetic_token_present, synthetic_user_present: structure.synthetic_user_present,
          recovery_reload_attempted: realZoomRecoveryReload };
        bodyTextPreview = structure.body_text_preview || "";
        title = structure.title;
        landmarks = { main: structure.mains, navigation: structure.navs, h1: structure.headings };
        namedControlFailures = structure.unnamed.slice(0, 10);
        horizontalOverflow = structure.horizontal_overflow;
        if (horizontalOverflow) responsiveFailures.push({ route: routePath, viewport: viewport.name,
          viewport_width: structure.viewport_width, document_width: structure.document_width,
          elements: structure.overflowing_elements,
          reason: "A página tem overflow horizontal fora de uma região rolável." });
        if (!title || structure.mains < 1 || structure.headings < 1
          || routePath === "/suinda" && structure.mains !== 1) {
          semanticFailures.push({ route: routePath, viewport: viewport.name, title_missing: !title,
            main_landmark_count: structure.mains, expected_main_landmark_count: routePath === "/suinda" ? 1 : undefined,
            h1_count: structure.headings });
        }
        if (namedControlFailures.length) semanticFailures.push({ route: routePath, viewport: viewport.name,
          unnamed_visible_controls: namedControlFailures });
        if (routePath === "/suinda" && ["root", "learner", "teacher", "workspace_manager"].includes(authProfile)) {
          await page.waitForTimeout(150);
          const managementVisible = await page.getByRole("heading", { name: "Gestão acadêmica", exact: true })
            .isVisible().catch(() => false);
          const expectedVisible = ["root", "workspace_manager"].includes(authProfile);
          if (managementVisible !== expectedVisible) roleAccessFailures.push({ route: routePath, viewport: viewport.name,
            profile: authProfile, expected_management_visible: expectedVisible, actual_management_visible: managementVisible });
        }
        await page.keyboard.press("Tab");
        firstFocus = await page.evaluate(() => {
          const element = document.activeElement;
          if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement) return null;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName.toLowerCase(), text: (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
            href: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
            selector: element.id ? `#${CSS.escape(element.id)}` : `${element.localName}.${[...element.classList].slice(0, 2).join(".")}`,
            visible: rect.width > 0 && rect.height > 0, outline_style: style.outlineStyle, outline_width: style.outlineWidth,
            outline_color: style.outlineColor,
            adjacent_background: (() => { let parent = element.parentElement;
              while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)") parent = parent.parentElement;
              return parent ? getComputedStyle(parent).backgroundColor : "rgb(255, 255, 255)"; })(),
            box_shadow: style.boxShadow };
        });
        if (!firstFocus || !firstFocus.visible) focusFailures.push({ route: routePath, viewport: viewport.name, reason: "Tab não colocou foco visível em um elemento." });
        else {
          const focusHasIndicator = firstFocus.outline_style !== "none" && Number.parseFloat(firstFocus.outline_width) > 0
            || firstFocus.box_shadow !== "none";
          focusedStyles = { has_visible_indicator: focusHasIndicator, outline_style: firstFocus.outline_style,
            outline_width: firstFocus.outline_width, outline_color: firstFocus.outline_color,
            outline_contrast: contrastRatio(parseCssRgb(firstFocus.outline_color), parseCssRgb(firstFocus.adjacent_background)) };
          if (focusHasIndicator && focusedStyles.outline_contrast !== null && focusedStyles.outline_contrast < 3) {
            focusFailures.push({ route: routePath, viewport: viewport.name,
              reason: "Indicador de foco abaixo de 3:1 contra o fundo adjacente.", focus: firstFocus });
          }
          if (!focusHasIndicator) focusFailures.push({ route: routePath, viewport: viewport.name,
            reason: "Primeiro foco não expõe outline/box-shadow calculável.", focus: firstFocus });
        }
        if (atspiAudit) {
          await page.waitForTimeout(250);
          const expectedHeading = await page.locator("main h1").first().textContent().catch(() => "") || "";
          try {
            atspiTree = JSON.parse(execFileSync(pythonPath, [atspiScript, expectedHeading.trim(), "Ir para o conteúdo principal"],
              { encoding: "utf8", timeout: 15_000 }));
            atspiTree.expected_heading = expectedHeading.trim();
            if (!atspiTree.browser_seen || !atspiTree.document_names?.length || !atspiTree.expected_heading_seen
              || !atspiTree.expected_focus_seen
              || atspiTree.focused_accessible_object?.name !== "Ir para o conteúdo principal"
              || atspiTree.unnamed_interactive_controls?.length) {
              atspiFailures.push({ route: routePath, viewport: viewport.name, report: atspiTree });
            }
          } catch (error) {
            const stdout = error?.stdout?.toString?.() || "";
            let report = null;
            try { report = JSON.parse(stdout); } catch { /* process may have failed before returning JSON */ }
            atspiTree = report || { error: error instanceof Error ? error.message : "Falha ao consultar AT-SPI." };
            atspiFailures.push({ route: routePath, viewport: viewport.name, report: atspiTree });
          }
        }
        axe = await axeViolations(page);
        for (const issue of axe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
        if (!realChromeZoomAudit && (fullKeyboardAudit || routePath === `/suinda/learning/${enrollmentId}`)) {
          keyboardSequence = await keyboardRoundTrip(page);
          if (!keyboardSequence.passed) keyboardSequenceFailures.push({ route: routePath, viewport: viewport.name, ...keyboardSequence });
        }
        if (!realChromeZoomAudit && routePath === `/suinda/learning/${enrollmentId}`) {
          try {
            const keyboardInteraction = await keyboardGalleryInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações depois da interação de teclado.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida na interação de teclado da galeria." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, passed: false });
          }
          try {
            const keyboardInteraction = await keyboardCommunityReportInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após recolher o formulário de denúncia.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida no formulário de denúncia por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "community-report-disclosure", passed: false });
          }
          try {
            const keyboardInteraction = await keyboardCommunityJourneyInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após criar, reagir e responder na comunidade.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida na comunidade por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "course-community-keyboard", passed: false });
          }
          try {
            const keyboardInteraction = await keyboardStudyGroupsInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após operar grupos de estudo.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida nos grupos de estudo por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "study-groups-keyboard", passed: false });
          }
          try {
            const keyboardInteraction = await keyboardLessonCompletionInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após concluir a aula por teclado.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida ao concluir a aula por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "lesson-completion-keyboard", passed: false });
          }
          try {
            const keyboardInteraction = await keyboardAssignmentResubmissionInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após reenviar a atividade pelo teclado.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida ao reenviar a atividade por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "assignment-resubmission-keyboard", passed: false });
          }
          try {
            const keyboardInteraction = await keyboardLearningAssistantInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após perguntar ao assistente de aprendizagem.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida ao perguntar ao assistente por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "learning-assistant-keyboard", passed: false });
          }
        }
        if (routePath === `/suinda/messages/${enrollmentId}`) {
          try {
            const keyboardInteraction = await keyboardMessagesInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após a interação de mensagens.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida no fluxo de mensagens por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "private-messaging-keyboard", passed: false });
          }
        }
        if (!realChromeZoomAudit && routePath === `/suinda/learning/${enrollmentId}/surveys`) {
          try {
            const keyboardInteraction = await keyboardSurveyInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após responder à pesquisa.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida na pesquisa por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "course-survey-keyboard", passed: false });
          }
        }
        if (!realChromeZoomAudit && routePath === `/suinda/learning/${enrollmentId}/assessments`) {
          try {
            const keyboardInteraction = await keyboardAssessmentInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após enviar a avaliação.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida na avaliação por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "course-assessment-keyboard", passed: false });
          }
        }
        if (!realChromeZoomAudit && routePath === "/suinda") {
          try {
            const keyboardInteraction = await keyboardPluginNavigationInteraction(page, viewport.name);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações depois da interação com navegação de plugins.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida na navegação de plugins por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, passed: false });
          }
          try {
            const keyboardInteraction = await keyboardNotificationInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, type: "notifications",
              ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após operar o painel de notificações.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida no painel de notificações por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "notifications", passed: false });
          }
          if (authProfile === "root") try {
            const keyboardInteraction = await keyboardCreateMenuInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, type: "create-menu",
              ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após a jornada do menu Criar por teclado.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida no menu Criar por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "create-menu", passed: false });
          }
          try {
            const keyboardInteraction = await keyboardAccountMenuInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, type: "account-menu",
              ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após a jornada do menu da conta por teclado.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida no menu da conta por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "account-menu", passed: false });
          }
          if (authProfile === "root" && viewport.name === "desktop") {
            try {
              const keyboardInteraction = await keyboardBoardsMenuInteraction(page);
              keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, type: "boards-menu",
                ...keyboardInteraction });
              const postInteractionAxe = await axeViolations(page);
              for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
              if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
                message: "Axe encontrou violações após a jornada do menu Quadros por teclado.", axe_violations: postInteractionAxe });
            } catch (error) {
              const failure = { route: routePath, viewport: viewport.name,
                message: error instanceof Error ? error.message : "Falha desconhecida no menu Quadros por teclado." };
              keyboardInteractionFailures.push(failure);
              keyboardInteractionResults.push({ ...failure, type: "boards-menu", passed: false });
            }
          }
          if (authProfile === "root") try {
            const keyboardInteraction = await keyboardGlobalSearchInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, type: "global-search",
              ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após a jornada de pesquisa global por teclado.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida na pesquisa global por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "global-search", passed: false });
          }
          if (authProfile === "root" || authProfile === "teacher") try {
            const keyboardInteraction = await keyboardTeacherMeetingInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após recolher a criação de videoconferência.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida na criação de videoconferência por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "teacher-meeting-creator", passed: false });
          }
          if (authProfile === "root" || authProfile === "teacher") try {
            const keyboardInteraction = await keyboardTeacherSubmissionGradingInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após corrigir uma entrega docente por teclado.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida ao corrigir a entrega docente por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "teacher-submission-grade-keyboard", passed: false });
          }
        }
        if (!realChromeZoomAudit && routePath === "/boards") {
          try {
            const keyboardInteraction = await keyboardBoardCreationDialogInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após fechar o modal Criar quadro.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida no modal Criar quadro por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "orbit-create-board-modal-keyboard", passed: false });
          }
          if (fullKeyboardAudit) {
            try {
              const keyboardInteraction = await keyboardClosedBoardDeleteDialogInteraction(page);
              keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
              const postInteractionAxe = await axeViolations(page);
              for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
              if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
                message: "Axe encontrou violações após fechar a confirmação de exclusão.", axe_violations: postInteractionAxe });
            } catch (error) {
              const failure = { route: routePath, viewport: viewport.name,
                message: error instanceof Error ? error.message : "Falha desconhecida na confirmação de exclusão por teclado." };
              keyboardInteractionFailures.push(failure);
              keyboardInteractionResults.push({ ...failure, type: "orbit-closed-board-delete-confirmation", passed: false });
            }
          }
        }
        if (!realChromeZoomAudit && routePath === "/calendar") {
          try {
            const keyboardInteraction = await keyboardCalendarEventDialogInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após fechar o modal Novo evento.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida no modal Novo evento por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "orbit-calendar-event-dialog-keyboard", passed: false });
          }
        }
        if (!realChromeZoomAudit && routePath === "/plugins") {
          try {
            const keyboardInteraction = await keyboardPluginDetailsDialogInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após fechar os detalhes do plugin.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida nos detalhes de plugin por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "orbit-plugin-details-dialog-keyboard", passed: false });
          }
        }
        if (!realChromeZoomAudit && routePath === "/profile?tab=projects") {
          try {
            const keyboardInteraction = await keyboardProjectDirectoryDialogInteraction(page);
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, ...keyboardInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após fechar o seletor de pastas.", axe_violations: postInteractionAxe });
          } catch (error) {
            const failure = { route: routePath, viewport: viewport.name,
              message: error instanceof Error ? error.message : "Falha desconhecida no seletor de pastas por teclado." };
            keyboardInteractionFailures.push(failure);
            keyboardInteractionResults.push({ ...failure, type: "orbit-project-directory-dialog-keyboard", passed: false });
          }
        }
        try {
          const disclosureInteraction = await keyboardNativeDisclosureInteractions(page);
          if (disclosureInteraction.disclosure_count) {
            keyboardInteractionResults.push({ route: routePath, viewport: viewport.name, type: "native-disclosures",
              ...disclosureInteraction });
            const postInteractionAxe = await axeViolations(page);
            for (const issue of postInteractionAxe) axeTotals.set(issue.id, (axeTotals.get(issue.id) || 0) + issue.count);
            if (postInteractionAxe.length) keyboardInteractionFailures.push({ route: routePath, viewport: viewport.name,
              message: "Axe encontrou violações após ativar os disclosures nativos com teclado.", axe_violations: postInteractionAxe });
          }
        } catch (error) {
          const failure = { route: routePath, viewport: viewport.name,
            message: error instanceof Error ? error.message : "Falha desconhecida em disclosure nativo por teclado." };
          keyboardInteractionFailures.push(failure);
          keyboardInteractionResults.push({ ...failure, type: "native-disclosures", passed: false });
        }
      } catch (error) {
        navigationError = error instanceof Error ? error.message : "Falha desconhecida no navegador.";
      }
      routeResults.push({ route: routePath, viewport: viewport.name, status, navigation_error: navigationError,
        title_present: Boolean(title), landmarks, first_focus: firstFocus, focused_styles: focusedStyles,
        unnamed_visible_controls: namedControlFailures, horizontal_overflow: horizontalOverflow,
        viewport_metrics: routeViewportMetrics,
        body_text_preview: bodyTextPreview,
        axe_violations: axe, atspi_tree: atspiTree, console_errors: pageConsoleErrors.length,
        page_errors: pageErrors.length - pageErrorsBefore,
        api_requests: Object.fromEntries(routeApiRequests), keyboard_sequence: keyboardSequence,
        keyboard_interaction: keyboardInteractionResults.find((item) => item.route === routePath && item.viewport === viewport.name) || null });
      try { await page.close(); } catch (error) {
        browserFatalError = error instanceof Error ? error.message : "O navegador encerrou antes de fechar a página.";
        if (realChromeZoomAudit && routeContext !== browser) {
          try { await routeContext.close(); } catch {}
        }
        break routeLoop;
      }
      if (realChromeZoomAudit && routeContext !== browser) await routeContext.close();
    }
  }
  }
} finally {
  try { await browser.close(); } catch (error) {
    browserFatalError ||= error instanceof Error ? error.message : "Falha ao encerrar o navegador.";
  }
  if (temporaryZoomProfile) rmSync(temporaryZoomProfile, { recursive: true, force: true });
}

const uniqueConsoleErrors = [...new Map(consoleErrors.map((entry) => [`${entry.route}\0${entry.viewport}\0${entry.message}`, entry])).values()];
const uniquePageErrors = [...new Map(pageErrors.map((entry) => [`${entry.route}\0${entry.viewport}\0${entry.message}`, entry])).values()];
for (const [key, count] of apiRequestsObserved) {
  if (count > (apiRequests.get(key) || 0)) escapedApiRequests.push({ endpoint: key, observed: count, intercepted: apiRequests.get(key) || 0 });
}
const summary = {
  base_url: baseUrl,
  execution: "synthetic authenticated user; all /api requests fulfilled in Playwright before network; external origins aborted",
  synthetic_profile: authProfile,
  credentials_used: false,
  token_is_synthetic: true,
  synthetic_content_scenarios: ["enrollment dashboard with course", "teacher dashboard with a synthetic assignment awaiting grading",
    "learning page with synthetic captioned video, transcript, two-image gallery, and cited assistant answer"],
  keyboard_audit: fullKeyboardAudit ? "all selected route/viewports" : "populated learning route only",
  assistive_technology_audit: atspiAudit ? "Chrome AT-SPI accessible tree" : null,
  zoom_200_equivalent_audit: zoom200Audit,
  real_chrome_zoom_200_audit: realChromeZoomAudit,
  browser_zoom_setting: actualBrowserZoom?.trim() || null,
  routes_requested: selectedRoutes.length,
  route_viewports: routeResults.length,
  browser_fatal_error: browserFatalError,
  modes: ["authenticated-synthetic"],
  api_requests_intercepted: [...apiRequests.entries()].reduce((sum, [, count]) => sum + count, 0),
  api_requests_observed: [...apiRequestsObserved.entries()].reduce((sum, [, count]) => sum + count, 0),
  api_methods_intercepted: Object.fromEntries(apiMethods),
  generic_fixture_fallback_requests: [...genericFallbacks.entries()].map(([endpoint, count]) => ({ endpoint, count })),
  external_requests_blocked: blockedExternal.length,
  socket_io_requests_blocked: blockedSocketIoRequests,
  escaped_api_requests: escapedApiRequests,
  mutation_requests: Object.fromEntries([...apiMethods].filter(([method]) => !["GET", "HEAD", "OPTIONS"].includes(method))),
  routes_with_errors: routeResults.filter((item) => item.status === null || item.status >= 400 || item.navigation_error),
  console_errors: uniqueConsoleErrors,
  runtime_errors: uniquePageErrors,
  axe_violations_by_rule: Object.fromEntries(axeTotals),
  semantic_failures: semanticFailures,
  responsive_failures: responsiveFailures,
  first_focus_failures: focusFailures,
  atspi_failures: atspiFailures,
  keyboard_sequence_failures: keyboardSequenceFailures,
  keyboard_interaction_failures: keyboardInteractionFailures,
  keyboard_interaction_results: keyboardInteractionResults,
  role_access_failures: roleAccessFailures,
  results: routeResults,
  coverage_limits: [
    "The token and identity are synthetic and accepted only by localStorage; this does not authenticate with or validate the API/session service.",
    "Most fixtures remain minimal. The student dashboard and learning route include a synthetic enrollment, gamification ranking, payment entry, submitted assignment, captioned-video lesson, transcript, and image gallery; other routes may not render populated lists, modals, or role-specific content that depends on richer endpoint payloads.",
    "The synthetic video URL is blocked; the fixture exercises the caption-track and transcript UI but does not prove media playback, caption synchronization, language quality, or provider behavior.",
    ...(zoom200Audit ? ["The 200%-zoom layout audit uses a 640×400 CSS viewport and 2× device scale to approximate the layout viewport of a 1280×800 display at 200% browser zoom; it does not change the host browser's actual zoom setting."] : []),
    ...(realChromeZoomAudit ? ["Chrome's own Page zoom control was set to 200% in a temporary browser profile; route results include the measured CSS viewport, devicePixelRatio, and visual viewport scale. The temporary profile is deleted after closing the browser."] : []),
    ...(atspiAudit
      ? ["Orca is connected to Chrome through Linux AT-SPI and reads page titles; checks verify exposed focused links, page headings, and named interactive controls. This smoke does not test all spoken output, reader commands, content states, or assistive-technology conformance."]
      : ["No screen reader was connected. Axe, accessible-name checks, landmarks, and keyboard focus are automated proxies and do not prove WCAG 2.2 AA conformance or criterion 31.2/31.9 closure."]),
    "All browser /api calls are intercepted and fulfilled locally; non-GET requests receive synthetic success responses but are never sent to the API. External origins are blocked. Socket.IO is disabled.",
  ],
};
console.log(JSON.stringify(summary, null, 2));
if (hasAuthenticatedAccessibilityFailures(summary)) process.exitCode = 1;
