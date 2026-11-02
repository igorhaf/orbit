"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Award, BellRing, BookOpen, BriefcaseBusiness, CalendarClock, Clock3, Download, FileText, Flame, Link2, ListTodo, RefreshCw, Target, Trophy, UserRound } from "lucide-react";
import { api, apiBlob, getToken } from "@/lib/api";
import { LearnerPracticeCredit } from "@/plugins/suinda/PracticeCredit";
import { PaymentCheckout } from "@/plugins/suinda/PaymentCheckout";
import { FinancialNegotiationForEnrollment } from "@/plugins/suinda/FinancialNegotiation";

type Enrollment = {
  id: string;
  workspace_id: string;
  title: string;
  state: string;
  revision: number;
  updated_at?: string;
  payload: {
    submitted_at?: string;
    payment_status?: string;
    coupon_code_snapshot?: string | null;
    discount_context_snapshot?: "promotion" | "institutional_agreement" | "member_discount" | null;
    discount_partner_snapshot?: string | null;
    discount_amount?: number;
    amount_due?: number;
    amount_due_currency?: string;
    effective_by?: string;
    course_record_id?: string;
    course_revision?: number;
  };
  dashboard: {
    next_sessions: Array<{ id: string; title: string; starts_at?: string; modality?: string; location?: string; room_name?: string; meeting_url?: string | null }>;
    pending_assignments: Array<{ id: string; title: string; due_at?: string }>;
    payment_entries: Array<{ id: string; amount: number; currency: string; payment_method: string; payment_reference?: string | null; notes?: string | null; paid_at?: string }>;
    payment_schedule: Array<{ number: number; amount: number; covered_amount: number; currency: string; due_at: string; status: "upcoming" | "overdue" | "partial" | "paid" }>;
    scholarship_applications: Array<{ id: string; state: string; program_title: string; discount_percent: number; score: number; decision_reason?: string | null; waitlist_position?: number | null; updated_at?: string }>;
    gamification: null | { points: number; level: number; next_level_points: number; lessons_completed: number; assessments_completed: number; study_streak_days: number; weekly_goal: { metric: "study_days" | "lessons" | "attendance" | "practice_hours"; active_days: number; target_days: number; current_value: number; target_value: number; unit: string; percent: number }; ranking_position: number | null; badges: Array<{ id: string; label: string; description: string }>; challenges: Array<{ id: string; title: string; description: string; metric: string; progress: number; target: number; completed: boolean; expired: boolean; closes_at: string; state: string }>; leaderboard: Array<{ name: string; points: number; rank: number }> };
    certificate: null | { id: string; state: string; certificate_code?: string; certificate_kind?: "completion" | "participation" | "milestone"; participation_scope?: string; milestone_title?: string; milestone_lesson_titles?: string[]; completed_at?: string; issued_at?: string; workload_hours?: number; public_validation_enabled?: boolean };
    certificates?: Array<{ id: string; state: string; certificate_code?: string; certificate_kind?: "completion" | "participation" | "milestone"; participation_scope?: string; milestone_title?: string; milestone_lesson_titles?: string[]; completed_at?: string; issued_at?: string; workload_hours?: number; public_validation_enabled?: boolean }>;
    announcements: Array<{ id: string; title: string; body?: string; sent_at?: string; requires_read_confirmation?: boolean; read_at?: string | null }>;
  };
};

type TranscriptEntry = {
  id: string;
  enrollment_id: string;
  course_id: string;
  course_title: string;
  assessment_id: string;
  assessment_title: string;
  assessment_type: string;
  score: number;
  maximum_score: number;
  graded_at: string | null;
  feedback: string | null;
  result_type: "assessment_attempt" | "submission";
  attempt_number: number | null;
  submitted_at: string | null;
};

type LearningSeason = {
  id: string; title: string; description?: string; opens_at: string; closes_at: string; my_points: number | null; my_rank: number | null;
  leaderboard: Array<{ name: string; score: number; rank: number }>;
  course_standings: Array<{ course: string; participants: number; score: number; rank: number }>;
};

type LearningPath = {
  id: string; title: string; description?: string; progress_percent: number;
  completed_courses: number; course_count: number; recommendation_reason: string; required: boolean;
  target_competencies: string[];
  courses: Array<{ id: string; title: string; enrollment_id: string | null; progress_percent: number; href: string }>;
};

type CertificateSignatureStatus = { configured: boolean; usable: boolean; reason?: string; valid_until?: string | null; sub_filter?: string | null };

const stateLabels: Record<string, string> = {
  application_draft: "Inscrição incompleta",
  submitted: "Em análise",
  waitlisted: "Lista de espera",
  approved: "Aprovada",
  enrolled: "Matriculada",
  active: "Em andamento",
  paused: "Pausada",
  completed: "Concluída",
  failed: "Reprovada",
  rejected: "Recusada",
  withdrawn: "Cancelada",
  expired: "Prazo expirado",
};

function dateLabel(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(parsed);
}

function dateTimeLabel(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function safeMeetingUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

function hasNegotiableBalance(enrollment: Enrollment) {
  if (!["submitted", "approved", "enrolled", "active", "paused"].includes(enrollment.state)) return false;
  if (["waived", "not_required"].includes(String(enrollment.payload.payment_status))) return false;
  const scheduledBalance = (enrollment.dashboard?.payment_schedule || []).reduce((total, installment) => {
    return total + Math.max(0, Number(installment.amount || 0) - Number(installment.covered_amount || 0));
  }, 0);
  const recordedBalance = Number(enrollment.payload.amount_due || 0) - (enrollment.dashboard?.payment_entries || []).reduce((total, payment) => {
    return total + (payment.payment_method === "refund" ? -1 : 1) * Number(payment.amount || 0);
  }, 0);
  const balance = Math.max(scheduledBalance, recordedBalance);
  return Number.isFinite(balance) && balance > 0.005;
}

type DocumentChecklistItem = { category: string; label: string; status: "complete" | "pending" | "expired" | "needs_update" | "missing" };
type PendingAction = { key: string; kind: "assignment" | "announcement" | "session" | "document"; title: string; detail: string; href: string; timestamp: number };

function pendingActionsFor(enrollments: Enrollment[], documentsByEnrollment: Record<string, DocumentChecklistItem[]>): PendingAction[] {
  return enrollments.flatMap((enrollment): PendingAction[] => {
    const root = `/suinda/learning/${encodeURIComponent(enrollment.id)}`;
    const assignments = enrollment.dashboard.pending_assignments.map((item) => ({
      key: `assignment:${enrollment.id}:${item.id}`, kind: "assignment" as const, title: item.title,
      detail: `${enrollment.title} · ${item.due_at ? `prazo ${dateTimeLabel(item.due_at) || "a confirmar"}` : "entrega pendente"}`,
      href: root, timestamp: item.due_at ? Date.parse(item.due_at) : Number.MAX_SAFE_INTEGER,
    }));
    const notices = enrollment.dashboard.announcements.filter((notice) => notice.requires_read_confirmation && !notice.read_at).map((notice) => ({
      key: `announcement:${enrollment.id}:${notice.id}`, kind: "announcement" as const, title: notice.title,
      detail: `${enrollment.title} · confirme a leitura`, href: `#enrollment-${enrollment.id}-notice-${notice.id}`,
      timestamp: notice.sent_at ? Date.parse(notice.sent_at) : Number.MAX_SAFE_INTEGER,
    }));
    const sessions = enrollment.dashboard.next_sessions.map((session) => ({
      key: `session:${enrollment.id}:${session.id}`, kind: "session" as const, title: session.title,
      detail: `${enrollment.title} · ${dateTimeLabel(session.starts_at) || "horário a confirmar"}`,
      href: root, timestamp: session.starts_at ? Date.parse(session.starts_at) : Number.MAX_SAFE_INTEGER,
    }));
    const documents = (documentsByEnrollment[enrollment.id] || []).filter((item) => item.status !== "complete").map((item) => ({
      key: `document:${enrollment.id}:${item.category}`, kind: "document" as const, title: item.label,
      detail: `${enrollment.title} · ${{ complete: "em dia", missing: "documento necessário", pending: "em análise", expired: "documento vencido", needs_update: "atualização solicitada" }[item.status]}`,
      href: `${root}/documents`, timestamp: Number.MAX_SAFE_INTEGER - 1,
    }));
    return [...assignments, ...notices, ...sessions, ...documents];
  }).sort((a, b) => a.timestamp - b.timestamp || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
}

export default function SuindaStudentDashboard() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [documentsByEnrollment, setDocumentsByEnrollment] = useState<Record<string, DocumentChecklistItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(true);
  const [transcriptError, setTranscriptError] = useState("");
  const [transcriptVisibleCount, setTranscriptVisibleCount] = useState(8);
  const [seasons, setSeasons] = useState<LearningSeason[]>([]);
  const [learningPaths, setLearningPaths] = useState<LearningPath[]>([]);
  const [profileSelectionRequired, setProfileSelectionRequired] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarSubscriptionBusy, setCalendarSubscriptionBusy] = useState(false);
  const [calendarSubscriptionActive, setCalendarSubscriptionActive] = useState(false);
  const [calendarSubscriptionUrl, setCalendarSubscriptionUrl] = useState("");
  const [calendarCopied, setCalendarCopied] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const pendingActions = pendingActionsFor(enrollments, documentsByEnrollment);

  useEffect(() => {
    Promise.resolve().then(() => setSignedIn(Boolean(getToken())));
    if (!getToken()) {
      Promise.resolve().then(() => setLoading(false));
      return;
    }
    api<Enrollment[]>("/extensions/suinda-learning/me/dashboard")
      .then(async (items) => {
        setEnrollments(items);
        const summaries = await Promise.allSettled(items.map(async (enrollment) => {
          const result = await api<{ checklist: DocumentChecklistItem[] }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollment.id)}/documents`);
          return [enrollment.id, result.checklist] as const;
        }));
        setDocumentsByEnrollment(Object.fromEntries(summaries.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar suas inscrições."))
      .finally(() => setLoading(false));
    api<{ entries: TranscriptEntry[] }>("/extensions/suinda-learning/me/transcript")
      .then((result) => setTranscript(result.entries))
      .catch((reason: unknown) => setTranscriptError(reason instanceof Error ? reason.message : "Não foi possível carregar seu histórico de notas."))
      .finally(() => setTranscriptLoading(false));
    api<{ seasons: LearningSeason[] }>("/extensions/suinda-learning/me/seasons")
      .then((result) => setSeasons(result.seasons))
      .catch(() => undefined);
    api<{ paths: LearningPath[]; profile_selection_required?: boolean }>("/extensions/suinda-learning/me/learning-paths")
      .then((result) => { setLearningPaths(result.paths); setProfileSelectionRequired(result.profile_selection_required === true); })
      .catch(() => undefined);
    api<{ active: boolean }>("/extensions/suinda-learning/me/calendar-subscription")
      .then((result) => setCalendarSubscriptionActive(result.active))
      .catch(() => undefined);
  }, []);

  async function exportCalendar() {
    setCalendarBusy(true);
    setCalendarError("");
    try {
      const blob = await apiBlob("/extensions/suinda-learning/me/calendar.ics");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "suinda-minhas-aulas.ics";
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setCalendarError(reason instanceof Error ? reason.message : "Não foi possível exportar o calendário.");
    } finally { setCalendarBusy(false); }
  }

  async function createCalendarSubscription() {
    setCalendarSubscriptionBusy(true);
    setCalendarError("");
    setCalendarCopied(false);
    try {
      const result = await api<{ subscription_url: string }>("/extensions/suinda-learning/me/calendar-subscription", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      setCalendarSubscriptionUrl(result.subscription_url);
      setCalendarSubscriptionActive(true);
    } catch (reason) {
      setCalendarError(reason instanceof Error ? reason.message : "Não foi possível criar a assinatura do calendário.");
    } finally { setCalendarSubscriptionBusy(false); }
  }

  async function revokeCalendarSubscription() {
    if (!window.confirm("Revogar a assinatura? Aplicativos de calendário deixarão de receber atualizações por este link.")) return;
    setCalendarSubscriptionBusy(true);
    setCalendarError("");
    try {
      await api<{ revoked: boolean }>("/extensions/suinda-learning/me/calendar-subscription", { method: "DELETE" });
      setCalendarSubscriptionUrl("");
      setCalendarSubscriptionActive(false);
      setCalendarCopied(false);
    } catch (reason) {
      setCalendarError(reason instanceof Error ? reason.message : "Não foi possível revogar a assinatura do calendário.");
    } finally { setCalendarSubscriptionBusy(false); }
  }

  async function copyCalendarSubscription() {
    try {
      await navigator.clipboard.writeText(calendarSubscriptionUrl);
      setCalendarCopied(true);
    } catch {
      setCalendarError("Não foi possível copiar automaticamente. Selecione e copie o endereço exibido.");
    }
  }

  return (
    <main className="min-h-full bg-[#1d2125] text-[#dee4ea]">
      <div className="mx-auto max-w-6xl px-5 py-9 sm:px-8 lg:py-12">
        <section className="rounded-[2rem] border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.12),_transparent_42%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-7 sm:p-10">
          <p className="text-sm font-medium text-cyan-200">Seu espaço de aprendizagem</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Olá, estudante</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b6c2cf]">Acompanhe as inscrições dos seus cursos e descubra novas oportunidades de aprendizagem.</p>
          <div className="mt-5 flex flex-wrap gap-3"><Link href="/suinda/profile" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm font-medium text-cyan-100 hover:bg-white/[0.08]"><UserRound size={15} aria-hidden="true" /> Perfil acadêmico</Link><Link href="/suinda/portfolio" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm font-medium text-cyan-100 hover:bg-white/[0.08]"><BriefcaseBusiness size={15} aria-hidden="true" /> Portfólio de entregas</Link><Link href="/suinda/alumni" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm font-medium text-cyan-100 hover:bg-white/[0.08]">Comunidade de ex-alunos</Link></div>
        </section>

        {signedIn && <ScholarshipCounterpartiesPanel />}
        {(learningPaths.length > 0 || profileSelectionRequired) && <section className="mt-7" aria-labelledby="learning-paths-heading"><div className="mb-4"><p className="text-sm text-cyan-200">Percursos formativos</p><h2 id="learning-paths-heading" className="mt-1 text-xl font-semibold text-white">Trilhas formativas</h2><p className="mt-1 text-sm text-[#9fadbc]">Acompanhe seu avanço em percursos publicados pela instituição e veja como se relacionam às competências que já desenvolveu.</p></div>{profileSelectionRequired && <div className="mb-4 rounded-xl border border-amber-200/20 bg-amber-200/[0.05] p-4 text-sm text-[#d8dee6]"><p>Há trilhas obrigatórias por perfil profissional nesta instituição. Escolha seu perfil em <Link href="/suinda/profile" className="font-medium text-cyan-100 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Perfil acadêmico</Link> para identificar quais se aplicam a você.</p><p className="mt-1 text-xs text-[#9fadbc]">Se não houver a opção “Perfil profissional”, a instituição ainda precisa configurar esse campo.</p></div>}<div className="grid gap-4 lg:grid-cols-2">{learningPaths.map((path) => <article key={path.id} className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-white">{path.title}</h3>{path.required && <span className="rounded-full border border-amber-200/20 bg-amber-200/[0.06] px-2 py-1 text-[11px] font-medium text-amber-100">Obrigatória</span>}</div>{path.description && <p className="mt-2 text-sm leading-5 text-[#b6c2cf]">{path.description}</p>}</div><span className="rounded-full border border-cyan-200/15 px-2.5 py-1 text-xs text-cyan-100">{path.progress_percent}%</span></div><p className="mt-3 text-xs text-[#9fadbc]">{path.recommendation_reason} · {path.completed_courses} de {path.course_count} cursos concluídos</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`Progresso na trilha ${path.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={path.progress_percent}><div className="h-full rounded-full bg-cyan-200 transition-[width] motion-reduce:transition-none" style={{ width: `${path.progress_percent}%` }} /></div>{!!path.target_competencies.length && <div className="mt-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-[#9fadbc]">Competências-alvo</p><ul className="mt-2 flex flex-wrap gap-2">{path.target_competencies.map((competency) => <li key={competency} className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.05] px-2.5 py-1 text-xs text-cyan-100">{competency}</li>)}</ul></div>}<ol className="mt-4 space-y-2 border-t border-white/[0.08] pt-3">{path.courses.map((course) => <li key={course.id}><Link href={course.href} className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2 text-sm text-[#b6c2cf] hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><span>{course.title}</span><span className="shrink-0 text-xs text-[#9fadbc]">{course.progress_percent}%</span></Link></li>)}</ol></article>)}</div></section>}
        {!!seasons.length && <section className="mt-7 grid gap-4 lg:grid-cols-2" aria-label="Temporadas de aprendizagem">{seasons.map((season) => <article key={season.id} className="rounded-2xl border border-amber-200/15 bg-gradient-to-br from-amber-200/[0.07] to-white/[0.02] p-5"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Trophy size={16} aria-hidden="true" />{season.title}</p><p className="mt-1 text-xs text-[#9fadbc]">{dateLabel(season.opens_at)} – {dateLabel(season.closes_at)}</p></div><span className="rounded-full border border-amber-100/15 px-2.5 py-1 text-xs text-amber-100">{season.my_points === null ? "Sem desafios disponíveis" : `${season.my_points} pontos`}</span></div>{season.description && <p className="mt-3 text-sm leading-5 text-[#b6c2cf]">{season.description}</p>}{season.my_rank !== null && <p className="mt-2 text-xs text-amber-100">Sua posição entre participantes visíveis: {season.my_rank}º</p>}{!!season.course_standings.length && <div className="mt-4 border-t border-white/[0.08] pt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-[#9fadbc]">Classificação agregada por curso · mínimo de 5 participantes</p><ol className="mt-2 space-y-1.5">{season.course_standings.map((course) => <li key={course.course} className="flex items-center justify-between gap-3 text-xs"><span className="text-[#b6c2cf]">{course.rank}. {course.course}</span><span className="shrink-0 text-[#9fadbc]">{course.score} pts médios · {course.participants} participantes</span></li>)}</ol></div>}{!!season.leaderboard.length && <details className="mt-3 border-t border-white/[0.08] pt-3"><summary className="cursor-pointer text-xs font-medium text-cyan-100">Ver participantes que autorizaram o ranking ({season.leaderboard.length})</summary><ol className="mt-2 space-y-1.5">{season.leaderboard.slice(0, 10).map((person) => <li key={`${person.rank}:${person.name}`} className="flex justify-between gap-3 text-xs text-[#b6c2cf]"><span>{person.rank}. {person.name}</span><span>{person.score} pts</span></li>)}</ol></details>}<p className="mt-3 text-[10px] leading-4 text-[#9fadbc]">O placar individual inclui somente pessoas que ativaram a participação no ranking. Pontos pessoais permanecem privados para quem não ativou.</p></article>)}</section>}

        <section className="mt-9" aria-labelledby="enrollments-heading">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-cyan-200">Minha jornada</p><h2 id="enrollments-heading" className="mt-1 text-2xl font-semibold text-white">Minhas inscrições</h2></div><div className="flex flex-wrap items-center gap-3">{!loading && signedIn && enrollments.length > 0 && <button type="button" onClick={() => void exportCalendar()} disabled={calendarBusy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#3b4754] px-3 text-sm font-medium text-[#b6c2cf] hover:border-cyan-200/40 disabled:opacity-60"><Download size={15} aria-hidden="true" />{calendarBusy ? "Preparando…" : "Exportar .ics"}</button>}{!loading && signedIn && enrollments.length > 0 && <button type="button" onClick={() => void createCalendarSubscription()} disabled={calendarSubscriptionBusy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-200/20 px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-200/[0.06] disabled:opacity-60"><RefreshCw size={15} aria-hidden="true" />{calendarSubscriptionBusy ? "Gerando…" : "Assinar calendário"}</button>}{!loading && signedIn && <p className="text-sm text-[#9fadbc]" aria-live="polite">{enrollments.length} {enrollments.length === 1 ? "inscrição" : "inscrições"}</p>}</div></div>
          {calendarSubscriptionActive && <section aria-label="Assinatura atualizável do calendário" className="mb-4 rounded-xl border border-cyan-200/15 bg-cyan-200/[0.04] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="flex items-center gap-2 text-sm font-medium text-cyan-100"><Link2 size={15} aria-hidden="true" /> Assinatura iCalendar ativa</p>{calendarSubscriptionUrl ? <p className="mt-2 break-all rounded-lg border border-white/[0.08] bg-black/20 p-3 font-mono text-xs text-[#b6c2cf]">{calendarSubscriptionUrl}</p> : <p className="mt-2 text-xs text-[#b6c2cf]">O endereço foi exibido quando a assinatura foi criada e não fica armazenado em formato recuperável. Gere outro endereço para rotacionar o anterior.</p>}<p className="mt-2 text-xs leading-5 text-[#9fadbc]">Adicione o endereço como calendário por assinatura no Google, Apple ou Outlook. No Google Calendar pela web, use <strong>Outros calendários → + → Do URL</strong>. A atualização depende da frequência de consulta de cada serviço. O link dá acesso à sua agenda; revogue-o se deixar de usá-lo.</p></div><div className="flex shrink-0 gap-2">{calendarSubscriptionUrl && <button type="button" aria-label="Copiar endereço da assinatura do calendário" onClick={() => void copyCalendarSubscription()} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 hover:bg-cyan-100">{calendarCopied ? "Copiado" : "Copiar link"}</button>}<button type="button" onClick={() => void revokeCalendarSubscription()} disabled={calendarSubscriptionBusy} className="min-h-9 rounded-lg border border-rose-200/20 px-3 text-xs font-medium text-rose-100 hover:bg-rose-200/[0.06] disabled:opacity-60">Revogar</button></div><span className="sr-only" role="status" aria-live="polite">{calendarCopied ? "Endereço da assinatura copiado para a área de transferência." : ""}</span></div></section>}
          {calendarError && <p role="alert" className="mb-4 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{calendarError}</p>}
          {!signedIn && !loading && <div className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6"><p className="text-sm text-[#b6c2cf]">Entre na sua conta para acompanhar inscrições e matrículas.</p><Link href="/" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100">Entrar <ArrowRight size={15} aria-hidden="true" /></Link></div>}
          {loading && <p role="status" className="text-sm text-[#9fadbc]">Carregando suas inscrições…</p>}
          {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div>}
          {!loading && !error && signedIn && enrollments.length === 0 && <div className="rounded-2xl border border-dashed border-white/15 px-5 py-12 text-center"><BookOpen className="mx-auto text-[#9fadbc]" size={28} aria-hidden="true" /><h3 className="mt-4 font-semibold text-white">Sua jornada começa aqui</h3><p className="mt-2 text-sm text-[#9fadbc]">Quando você se inscrever em um curso, ele aparecerá nesta lista.</p><Link href="/suinda/catalog" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950">Ver catálogo <ArrowRight size={15} aria-hidden="true" /></Link></div>}
          {!loading && !error && signedIn && enrollments.length > 0 && <PendingActionsPanel actions={pendingActions} />}
          {signedIn && <TranscriptPanel entries={transcript} loading={transcriptLoading} error={transcriptError} visibleCount={transcriptVisibleCount} onShowMore={() => setTranscriptVisibleCount((count) => count + 8)} />}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{enrollments.map((enrollment) => <article id={`enrollment-${enrollment.id}`} key={enrollment.id} className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5"><div className="flex items-start justify-between gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200"><BookOpen size={18} aria-hidden="true" /></div><span className="rounded-full border border-[#3b4754] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-[#b6c2cf]">{stateLabels[enrollment.state] || enrollment.state}</span></div><h3 className="mt-4 font-semibold leading-6 text-white">{enrollment.title}</h3><p className="mt-3 flex items-center gap-2 text-xs text-[#9fadbc]"><Clock3 size={14} aria-hidden="true" />{dateLabel(enrollment.payload.submitted_at) ? `Enviada em ${dateLabel(enrollment.payload.submitted_at)}` : "Data da inscrição não informada"}</p>
            {enrollment.payload.payment_status && <p className="mt-2 text-xs text-[#9fadbc]">Pagamento: <span className="text-[#b6c2cf]">{{ not_required: "Não se aplica", pending: "Pendente", paid: "Pago", overdue: "Em atraso", refunded: "Reembolsado", waived: "Isento" }[enrollment.payload.payment_status] || enrollment.payload.payment_status}</span>{enrollment.payload.payment_status === "pending" && <span className="mt-1 block text-[#9fadbc]">A coordenação informará como pagar e atualizará esta situação depois de confirmar o recebimento.</span>}</p>}
            {Number(enrollment.payload.discount_amount || 0) > 0 && <p className="mt-2 text-xs text-emerald-200">{enrollment.payload.discount_context_snapshot === "institutional_agreement" ? "Convênio institucional" : enrollment.payload.discount_context_snapshot === "member_discount" ? "Desconto para associado" : "Cupom"}{enrollment.payload.discount_partner_snapshot ? ` · ${enrollment.payload.discount_partner_snapshot}` : ` ${enrollment.payload.coupon_code_snapshot}`}: desconto de {new Intl.NumberFormat("pt-BR", { style: "currency", currency: enrollment.payload.amount_due_currency || "BRL" }).format(Number(enrollment.payload.discount_amount))} · saldo da inscrição {new Intl.NumberFormat("pt-BR", { style: "currency", currency: enrollment.payload.amount_due_currency || "BRL" }).format(Number(enrollment.payload.amount_due || 0))}</p>}
            {enrollment.payload.payment_status !== "waived" && enrollment.dashboard?.payment_schedule.length > 1 && <section className="mt-3 rounded-lg border border-amber-200/10 bg-amber-200/[0.03] p-3" aria-label="Parcelas do curso"><p className="text-xs font-semibold text-amber-100">Parcelas previstas</p><ul className="mt-2 divide-y divide-white/[0.07]">{enrollment.dashboard.payment_schedule.map((installment) => <li key={installment.number} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span className="text-[#b6c2cf]">Parcela {installment.number} · vence {dateLabel(installment.due_at) || "data a confirmar"}</span><span className={installment.status === "overdue" ? "text-rose-200" : installment.status === "paid" ? "text-emerald-200" : "text-[#b6c2cf]"}>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: installment.currency }).format(installment.amount)}{installment.status === "paid" ? " · paga" : installment.status === "overdue" ? " · em atraso" : installment.status === "partial" ? ` · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: installment.currency }).format(installment.covered_amount)} cobertos` : " · prevista"}</span></li>)}</ul><p className="mt-2 text-[11px] leading-5 text-[#9fadbc]">O calendário é informativo; a coordenação confirma as instruções e a baixa dos pagamentos.</p></section>}
            {!!enrollment.dashboard?.payment_entries.length && <details className="mt-3 rounded-lg border border-white/[0.07] p-3"><summary className="cursor-pointer text-xs font-medium text-cyan-100">Movimentações financeiras ({enrollment.dashboard.payment_entries.length})</summary><ul className="mt-2 divide-y divide-white/[0.07]">{enrollment.dashboard.payment_entries.map((payment) => <li key={payment.id} className="py-2 text-xs text-[#b6c2cf]">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: payment.currency }).format(payment.amount)} · {{ pix: "PIX recebido", bank_transfer: "Transferência recebida", cash: "Dinheiro recebido", card_external: "Cartão externo recebido", boleto: "Boleto recebido", scholarship: "Crédito de bolsa", refund: "Reembolso realizado", waiver: "Saldo financeiro cancelado", other: "Outra forma recebida" }[payment.payment_method] || payment.payment_method}{payment.paid_at ? ` · ${dateTimeLabel(payment.paid_at) || ""}` : ""}{payment.payment_reference ? <span className="block text-[#9fadbc]">Referência: {payment.payment_reference}</span> : null}{payment.payment_method === "waiver" && payment.notes ? <span className="block text-[#9fadbc]">Motivo: {payment.notes}</span> : null}</li>)}</ul></details>}
            {["pending", "overdue"].includes(String(enrollment.payload.payment_status)) && Number(enrollment.payload.amount_due || 0) > 0 && <div className="mt-4"><PaymentCheckout enrollmentId={enrollment.id} amount={Number(enrollment.payload.amount_due)} currency={enrollment.payload.amount_due_currency || "BRL"} /></div>}
            {hasNegotiableBalance(enrollment) && <FinancialNegotiationForEnrollment enrollmentId={enrollment.id} />}
            {!!enrollment.dashboard?.scholarship_applications.length && <section className="mt-3 rounded-lg border border-violet-200/15 bg-violet-200/[0.03] p-3" aria-label="Candidaturas a bolsas"><p className="text-xs font-semibold text-violet-100">Candidaturas a bolsas</p><ul className="mt-2 divide-y divide-white/[0.07]">{enrollment.dashboard.scholarship_applications.map((application) => <li key={application.id} className="py-2 text-xs text-[#b6c2cf]"><p>{application.program_title} · {application.discount_percent}% · {{ draft: "Rascunho", submitted: "Enviada", under_review: "Em análise", waitlisted: `Lista de espera${application.waitlist_position ? ` · posição ${application.waitlist_position}` : ""}`, approved: "Aprovada", rejected: "Recusada", withdrawn: "Cancelada" }[application.state] || application.state}</p>{application.decision_reason && <p className="mt-1 text-[#9fadbc]">{application.decision_reason}</p>}</li>)}</ul></section>}
            {enrollment.state === "approved" && enrollment.payload.effective_by && <p className="mt-2 text-xs text-amber-100">Confirme sua vaga até {dateTimeLabel(enrollment.payload.effective_by)}.</p>}
            {!!enrollment.dashboard?.next_sessions.length && <div className="mt-4 rounded-xl border border-cyan-200/10 bg-cyan-200/[0.04] p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-100">Próxima aula</p>{enrollment.dashboard.next_sessions.slice(0, 1).map((session) => <div key={session.id} className="mt-2"><p className="text-sm font-medium text-white">{session.title}</p><p className="mt-1 text-xs text-[#b6c2cf]">{dateTimeLabel(session.starts_at) || "Horário a confirmar"}{session.room_name ? ` · Sala ${session.room_name}` : ""}{session.location ? ` · ${session.location}` : ""}</p>{safeMeetingUrl(session.meeting_url) && <a href={safeMeetingUrl(session.meeting_url)!} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-8 items-center text-xs font-medium text-cyan-100 underline underline-offset-4">Abrir sala online</a>}</div>)}</div>}
            {!!enrollment.dashboard?.pending_assignments.length && <div className="mt-3"><p className="text-xs font-semibold text-amber-100">{enrollment.dashboard.pending_assignments.length} atividade(s) pendente(s)</p><ul className="mt-1 list-inside list-disc text-xs leading-5 text-[#9fadbc]">{enrollment.dashboard.pending_assignments.slice(0, 2).map((item) => <li key={item.id}>{item.title}{item.due_at ? ` · prazo ${dateTimeLabel(item.due_at) || "a confirmar"}` : ""}</li>)}</ul></div>}
            {enrollment.dashboard?.gamification && <GamificationCard data={enrollment.dashboard.gamification} />}
            {(enrollment.dashboard?.certificates?.length ? enrollment.dashboard.certificates : enrollment.dashboard?.certificate ? [enrollment.dashboard.certificate] : []).map((certificate) => <CertificateCard key={certificate.id} certificate={certificate} enrollmentId={enrollment.id} />)}
            {!!enrollment.dashboard?.announcements.length && <div className="mt-3 space-y-3 border-t border-white/[0.07] pt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-[#9fadbc]">Comunicados</p>{enrollment.dashboard.announcements.map((notice) => <AnnouncementCard key={notice.id} enrollmentId={enrollment.id} notice={notice} />)}</div>}
            {enrollment.state === "application_draft" && <Link href={`/suinda/learning/${encodeURIComponent(enrollment.id)}/documents`} className="mt-5 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-cyan-200/20 px-4 text-sm font-medium text-cyan-100 hover:bg-cyan-200/[0.06]">Continuar inscrição</Link>}
            {["application_draft", "submitted", "waitlisted", "approved", "enrolled", "active", "paused"].includes(enrollment.state) && <EnrollmentActions enrollment={enrollment} onUpdated={(revision, state) => setEnrollments((current) => current.map((item) => item.id === enrollment.id ? { ...item, revision, state } : item))} />}
            {["enrolled", "active", "completed"].includes(enrollment.state) && <Link href={`/suinda/learning/${encodeURIComponent(enrollment.id)}`} className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100">{enrollment.state === "completed" ? "Revisar conteúdo" : "Continuar aprendendo"} <ArrowRight size={15} aria-hidden="true" /></Link>}</article>)}</div>
        </section>
        {signedIn && <LearnerPracticeCredit enrollments={enrollments} />}
      </div>
    </main>
  );
}

type ScholarshipCounterparty = { id: string; revision: number; enrollment_id: string; enrollment_title: string; program_title: string; requirement_text: string; state: string; evidence_text?: string | null; submitted_at?: string | null; review_feedback?: string | null; files: Array<{ attachment_id: string; revision: number; file_name: string; mime_type: string; size_bytes: number }> };

function ScholarshipCounterpartiesPanel() {
  const [items, setItems] = useState<ScholarshipCounterparty[]>([]); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; api<ScholarshipCounterparty[]>("/extensions/suinda-learning/me/scholarship-counterparties").then((result) => { if (active) { setItems(result); setError(""); } }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar as contrapartidas."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  return <section className="mt-7 rounded-2xl border border-violet-200/15 bg-[#2c333a] p-5 sm:p-6" aria-labelledby="scholarship-counterparties-title"><p className="text-xs font-semibold uppercase tracking-wide text-violet-200">Acompanhamento de bolsas</p><h2 id="scholarship-counterparties-title" className="mt-1 text-xl font-semibold text-white">Contrapartidas</h2><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Acompanhe as exigências registradas no programa, envie evidências e veja as orientações da coordenação.</p>{success && <p role="status" aria-live="polite" aria-atomic="true" className="mt-3 rounded-lg border border-emerald-200/15 bg-emerald-200/[0.04] p-3 text-xs text-emerald-100">{success}</p>}{loading && <p role="status" className="mt-4 text-sm text-[#9fadbc]">Carregando suas contrapartidas…</p>}{error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}{!loading && !error && !items.length && <p className="mt-4 rounded-xl border border-dashed border-[#3b4754] bg-white/[0.02] p-4 text-sm text-[#9fadbc]">Nenhuma contrapartida foi registrada para suas bolsas aprovadas.</p>}<ul className="mt-4 grid gap-3 lg:grid-cols-2">{items.map((item) => <li key={item.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><p className="text-xs text-violet-100">{item.program_title} · {item.enrollment_title}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#dee4ea]">{item.requirement_text}</p><p className="mt-2 text-xs text-[#9fadbc]">{item.state === "pending" ? "Pendente" : item.state === "submitted" ? "Enviada para revisão" : item.state === "accepted" ? "Evidência aceita" : item.state === "revision_requested" ? "Complemento solicitado" : item.state}</p>{item.submitted_at && <p className="mt-1 text-[11px] text-[#9fadbc]">Enviada em {dateTimeLabel(item.submitted_at) || item.submitted_at}</p>}{item.evidence_text && <p className="mt-2 whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-black/10 p-3 text-xs leading-5 text-[#b6c2cf]">Seu relato: {item.evidence_text}</p>}{item.review_feedback && <p className="mt-2 whitespace-pre-wrap rounded-lg border border-amber-200/10 bg-amber-200/[0.03] p-3 text-xs leading-5 text-amber-100">Orientação da coordenação: {item.review_feedback}</p>}{item.files.map((file) => <CounterpartyFileDownload key={file.attachment_id} item={item} file={file} />)}{["pending", "revision_requested"].includes(item.state) && <CounterpartySubmission item={item} onSubmitting={() => setSuccess("")} onSaved={(updated) => { setItems((current) => current.map((entry) => entry.id === updated.id ? { ...entry, ...updated } : entry)); setSuccess(`Evidências de ${item.program_title} enviadas para revisão.`); }} />}</li>)}</ul></section>;
}

function CounterpartySubmission({ item, onSubmitting, onSaved }: { item: ScholarshipCounterparty; onSubmitting: () => void; onSaved: (updated: Pick<ScholarshipCounterparty, "id" | "revision" | "state" | "submitted_at" | "evidence_text" | "review_feedback" | "files">) => void }) {
  const [evidence, setEvidence] = useState(item.evidence_text || ""); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() {
    if (busy || (!evidence.trim() && !files.length)) return;
    setBusy(true); setError(""); onSubmitting();
    try {
      const combinedSize = item.files.reduce((total, file) => total + file.size_bytes, 0) + files.reduce((total, file) => total + file.size, 0);
      if (item.files.length + files.length > 10) throw new Error("O conjunto de evidências pode ter até 10 comprovantes; os anteriores são preservados.");
      if (combinedSize > 8 * 1024 * 1024) throw new Error("O conjunto de evidências pode ter até 8 MB, incluindo os comprovantes anteriores.");
      const encoded = await Promise.all(files.map(async (file) => ({ file_name: file.name, mime_type: file.type, data_base64: await fileToBase64(file) })));
      const updated = await api<{ id: string; revision: number; state: string; submitted_at: string; evidence_text: string | null; review_feedback: string | null; files: ScholarshipCounterparty["files"] }>(`/extensions/suinda-learning/me/scholarship-counterparties/${encodeURIComponent(item.id)}/submission`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: item.revision, evidence_text: evidence, files: encoded }) });
      setFiles([]); onSaved(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar as evidências."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 grid gap-2"><label className="text-[11px] text-[#9fadbc]">Relato da evidência<textarea maxLength={4000} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm text-white" /></label><label className="text-[11px] text-[#9fadbc]">Novos comprovantes (PDF, PNG ou JPEG; até {Math.max(0, 10 - item.files.length)} adicionais; limite total 10 arquivos e 8 MB. Os anteriores serão mantidos.)<input type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(event) => setFiles(Array.from(event.target.files || []))} className="mt-1 block w-full text-xs text-[#b6c2cf] file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:text-xs file:text-white" /></label><button type="button" disabled={busy || (!evidence.trim() && !files.length)} onClick={() => void submit()} className="min-h-10 rounded-lg bg-violet-200 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy ? "Enviando…" : item.state === "revision_requested" ? "Enviar complemento" : "Enviar evidências"}</button>{error && <p role="alert" className="text-xs text-rose-200">{error}</p>}</div>;
}

function fileToBase64(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Não foi possível ler o arquivo.")); reader.onload = () => { const result = String(reader.result || ""); resolve(result.slice(result.indexOf(",") + 1)); }; reader.readAsDataURL(file); }); }

function CounterpartyFileDownload({ item, file }: { item: ScholarshipCounterparty; file: ScholarshipCounterparty["files"][number] }) {
  const [busy, setBusy] = useState(false);
  async function download() { if (busy) return; setBusy(true); try { const blob = await apiBlob(`/extensions/suinda-learning/scholarship-counterparties/${encodeURIComponent(item.id)}/files/${encodeURIComponent(file.attachment_id)}?revision=${file.revision}`); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url); } finally { setBusy(false); } }
  return <button type="button" onClick={() => void download()} disabled={busy} className="mt-2 inline-flex min-h-8 items-center gap-2 rounded-lg border border-[#3b4754] px-2 text-xs text-cyan-100 disabled:opacity-50"><Download size={13} aria-hidden="true" />{busy ? "Baixando…" : file.file_name}</button>;
}

function TranscriptPanel({ entries, loading, error, visibleCount, onShowMore }: {
  entries: TranscriptEntry[]; loading: boolean; error: string; visibleCount: number; onShowMore: () => void;
}) {
  const sorted = [...entries].sort((left, right) => Date.parse(right.graded_at || right.submitted_at || "") - Date.parse(left.graded_at || left.submitted_at || ""));
  const visible = sorted.slice(0, visibleCount);
  return <section className="mb-6 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-6" aria-labelledby="transcript-title">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Desempenho acadêmico</p><h2 id="transcript-title" className="mt-1 text-xl font-semibold text-white">Histórico de notas</h2><p className="mt-1 text-xs text-[#9fadbc]">Resultados com correção concluída nas suas matrículas.</p></div>{!loading && !error && <p className="text-xs text-[#9fadbc]" aria-live="polite">{entries.length} {entries.length === 1 ? "resultado" : "resultados"}</p>}</div>
    {loading && <p role="status" className="mt-4 text-sm text-[#9fadbc]">Carregando seu histórico…</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-rose-300/20 bg-rose-300/[0.06] p-3 text-sm text-rose-100">{error}</p>}
    {!loading && !error && entries.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-[#3b4754] bg-white/[0.02] p-4 text-sm text-[#9fadbc]">Suas avaliações corrigidas aparecerão aqui.</p>}
    {!!visible.length && <ul className="mt-4 grid gap-3 sm:grid-cols-2">{visible.map((entry) => <li key={`${entry.enrollment_id}:${entry.id}`} className="min-w-0 rounded-xl border border-white/[0.08] bg-[#1d2125]/70 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-cyan-200">{entry.course_title}</p><h3 className="mt-1 break-words text-sm font-semibold text-white">{entry.assessment_title}</h3><p className="mt-1 text-[11px] text-[#9fadbc]">{entry.result_type === "submission" ? "Atividade corrigida" : `Avaliação · tentativa ${entry.attempt_number ?? "—"}`}</p></div><span className="shrink-0 rounded-lg bg-emerald-200/10 px-2.5 py-1.5 text-sm font-semibold tabular-nums text-emerald-100">{entry.score} <span className="text-xs font-medium text-emerald-100/70">/ {entry.maximum_score}</span></span></div><p className="mt-3 text-[11px] text-[#9fadbc]">{entry.graded_at ? "Corrigida" : "Enviada"} · {dateTimeLabel(entry.graded_at || entry.submitted_at || undefined) || "Data não informada"}</p>{entry.feedback && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-violet-200/10 bg-violet-200/[0.03] p-3 text-xs leading-5 text-[#b6c2cf]"><span className="font-medium text-violet-100">Feedback: </span>{entry.feedback}</p>}</li>)}</ul>}
    {entries.length > visible.length && <button type="button" onClick={onShowMore} className="mt-4 min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs font-medium text-cyan-100 transition hover:border-cyan-200/30 hover:bg-white/[0.03]">Mostrar mais resultados</button>}
  </section>;
}

function GamificationCard({ data }: { data: NonNullable<Enrollment["dashboard"]["gamification"]> }) {
  const levelFloor = (data.level - 1) * 100;
  const levelProgress = Math.max(0, Math.min(100, Math.round((data.points - levelFloor) / 100 * 100)));
  const metricLabels: Record<string, string> = { lessons: "aulas", assessments: "avaliações", attendance: "presenças", practice_hours: "horas práticas", study_days: "dias ativos" };
  return <section className="mt-4 rounded-xl border border-violet-200/15 bg-[linear-gradient(125deg,rgba(167,139,250,0.08),rgba(10,15,24,0.7)_65%)] p-3" aria-label="Progresso e conquistas">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-xs font-semibold text-violet-100"><Award size={15} aria-hidden="true" />Nível {data.level} · {data.points} pontos</p><p className="text-[11px] text-[#9fadbc]">{data.ranking_position ? `Posição ${data.ranking_position} entre participantes optantes` : "Ranking opcional"}</p></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Progresso até o próximo nível" aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelProgress}><div className="h-full rounded-full bg-violet-300 transition-[width]" style={{ width: `${levelProgress}%` }} /></div>
    <p className="mt-1 text-[10px] text-[#9fadbc]">{data.next_level_points - data.points} pontos para o próximo nível</p>
    <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[#b6c2cf]"><span className="inline-flex items-center gap-1"><Flame size={13} className="text-orange-200" aria-hidden="true" />{data.study_streak_days} dias seguidos</span><span className="inline-flex items-center gap-1"><Target size={13} className="text-cyan-200" aria-hidden="true" />Meta semanal: {data.weekly_goal.current_value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/{data.weekly_goal.target_value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} {data.weekly_goal.unit}</span></div>
    {data.badges.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Emblemas conquistados">{data.badges.map((badge) => <li key={badge.id} title={badge.description} className="rounded-full border border-amber-200/15 bg-amber-200/[0.05] px-2 py-1 text-[10px] text-amber-100">{badge.label}</li>)}</ul>}
    {data.challenges.length > 0 && <div className="mt-3 border-t border-white/[0.08] pt-2"><p className="text-[11px] font-medium text-[#b6c2cf]">Desafios</p><ul className="mt-2 grid gap-2">{data.challenges.map((challenge) => <li key={challenge.id} className="rounded-lg bg-white/[0.03] px-2.5 py-2"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-[#b6c2cf]">{challenge.title}</span><span className={challenge.completed ? "text-[10px] text-emerald-200" : "text-[10px] text-[#9fadbc]"}>{challenge.completed ? "Concluído" : challenge.expired ? "Encerrado" : `${challenge.progress.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/${challenge.target.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${metricLabels[challenge.metric] || "etapas"}`}</span></div><p className="mt-1 text-[10px] text-[#9fadbc]">{challenge.description} · até {dateTimeLabel(challenge.closes_at) || "data não informada"}</p></li>)}</ul></div>}
    {data.leaderboard.length > 0 && <details className="mt-3 border-t border-white/[0.08] pt-2"><summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-[#9fadbc]"><Trophy size={13} aria-hidden="true" />Ver ranking optativo da edição</summary><ol className="mt-2 grid gap-1">{data.leaderboard.map((entry) => <li key={`${entry.rank}:${entry.name}`} className="flex items-center justify-between text-[11px] text-[#b6c2cf]"><span>{entry.rank}. {entry.name}</span><span>{entry.points} pts</span></li>)}</ol></details>}
  </section>;
}

function PendingActionsPanel({ actions }: { actions: PendingAction[] }) {
  const visible = actions.slice(0, 8);
  return <section aria-labelledby="pending-actions-title" className="mb-5 rounded-2xl border border-cyan-200/15 bg-[linear-gradient(120deg,rgba(34,211,238,0.07),rgba(16,22,33,0.94)_48%)] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Acompanhe sua jornada</p><h3 id="pending-actions-title" className="mt-1 text-lg font-semibold text-white">Próximos passos</h3></div><p className="text-xs text-[#9fadbc]" aria-live="polite">{actions.length} {actions.length === 1 ? "item" : "itens"}</p></div>
    {visible.length ? <ul className="mt-4 grid gap-2 md:grid-cols-2">{visible.map((action) => {
      const Icon = action.kind === "assignment" ? ListTodo : action.kind === "announcement" ? BellRing : action.kind === "document" ? FileText : CalendarClock;
      const label = action.kind === "assignment" ? "Atividade pendente" : action.kind === "announcement" ? "Leitura a confirmar" : action.kind === "document" ? "Documento acadêmico" : "Próximo encontro";
      return <li key={action.key}><Link href={action.href} className="flex min-h-16 items-center gap-3 rounded-xl border border-white/[0.08] bg-[#1d2125]/70 px-3 py-3 transition hover:border-cyan-200/25 hover:bg-white/[0.04]"><Icon className="shrink-0 text-cyan-200" size={17} aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-[10px] font-medium uppercase tracking-wide text-[#9fadbc]">{label}</span><span className="mt-0.5 block truncate text-sm font-medium text-[#dee4ea]">{action.title}</span><span className="mt-0.5 block truncate text-xs text-[#9fadbc]">{action.detail}</span></span><ArrowRight className="shrink-0 text-[#9fadbc]" size={15} aria-hidden="true" /></Link></li>;
    })}</ul> : <p className="mt-4 rounded-xl border border-emerald-200/10 bg-emerald-200/[0.04] px-3 py-4 text-sm text-emerald-100">Tudo em dia por aqui. Seus próximos encontros continuam listados em cada matrícula.</p>}
    {actions.length > visible.length && <p className="mt-3 text-xs text-[#9fadbc]">Exibindo os próximos {visible.length} de {actions.length} itens.</p>}
  </section>;
}

function EnrollmentActions({ enrollment, onUpdated }: { enrollment: Enrollment; onUpdated: (revision: number, state: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(action: "confirm" | "pause" | "resume" | "withdraw") {
    if (busy || action === "withdraw" && !window.confirm("Deseja cancelar esta inscrição? Se houve pagamento em uma matrícula importada, a coordenação poderá registrar o reembolso depois de realizá-lo.")) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ revision: number; state: string }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollment.id)}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: enrollment.revision, action }),
      });
      onUpdated(result.revision, result.state);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a matrícula."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 border-t border-white/[0.07] pt-3"><p className="text-xs font-medium text-[#b6c2cf]">Gerenciar matrícula</p><div className="mt-2 flex flex-wrap gap-2">{enrollment.state === "approved" && enrollment.payload.payment_status === "pending" && <p className="w-full text-xs leading-5 text-amber-100">A vaga foi aprovada. Aguarde as instruções de pagamento da coordenação; a confirmação da matrícula será liberada após a baixa.</p>}{enrollment.state === "approved" && enrollment.payload.payment_status !== "pending" && <button type="button" onClick={() => void act("confirm")} disabled={busy} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 hover:bg-cyan-100 disabled:opacity-60">{busy ? "Salvando…" : "Confirmar matrícula"}</button>}{["enrolled", "active"].includes(enrollment.state) && <button type="button" onClick={() => void act("pause")} disabled={busy} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf] hover:bg-white/[0.05] disabled:opacity-60">Pausar</button>}{enrollment.state === "paused" && <button type="button" onClick={() => void act("resume")} disabled={busy} className="min-h-9 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 hover:bg-cyan-200/10 disabled:opacity-60">Retomar</button>}<button type="button" onClick={() => void act("withdraw")} disabled={busy} className="min-h-9 rounded-lg border border-rose-200/15 px-3 text-xs text-rose-200 hover:bg-rose-200/[0.06] disabled:opacity-60">Cancelar inscrição</button></div>{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</div>;
}

function AnnouncementCard({ enrollmentId, notice }: { enrollmentId: string; notice: Enrollment["dashboard"]["announcements"][number] }) {
  const [readAt, setReadAt] = useState(notice.read_at || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirmRead() {
    if (busy || readAt) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ read_at: string }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/announcements/${encodeURIComponent(notice.id)}/read`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      });
      setReadAt(result.read_at);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a leitura."); }
    finally { setBusy(false); }
  }
  return <article id={`enrollment-${enrollmentId}-notice-${notice.id}`} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3"><p className="text-xs font-medium text-[#b6c2cf]">{notice.title}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-[#9fadbc]">{notice.body}</p>{notice.requires_read_confirmation && <div className="mt-2">{readAt ? <p className="text-[11px] text-emerald-200">Leitura confirmada · {dateTimeLabel(readAt)}</p> : <button type="button" onClick={() => void confirmRead()} disabled={busy} className="min-h-8 rounded-lg border border-cyan-200/20 px-3 text-xs font-medium text-cyan-100 hover:bg-cyan-200/10 disabled:opacity-60">{busy ? "Salvando…" : "Confirmar leitura"}</button>}{error && <p role="alert" className="mt-1 text-[11px] text-rose-200">{error}</p>}</div>}</article>;
}

function CertificateCard({ certificate, enrollmentId }: { certificate: NonNullable<Enrollment["dashboard"]["certificate"]>; enrollmentId: string }) {
  const [busy, setBusy] = useState(false);
  const [badgeBusy, setBadgeBusy] = useState(false);
  const [error, setError] = useState("");
  const [signatureStatus, setSignatureStatus] = useState<CertificateSignatureStatus | null>(null);
  const [downloadMessage, setDownloadMessage] = useState("");
  useEffect(() => {
    let active = true;
    void api<CertificateSignatureStatus>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/certificate-signature`)
      .then((status) => { if (active) setSignatureStatus(status); })
      .catch(() => { if (active) setSignatureStatus({ configured: false, usable: false, reason: "status_unavailable" }); });
    return () => { active = false; };
  }, [enrollmentId]);
  async function download() {
    if (busy || certificate.state !== "issued") return;
    setBusy(true); setError("");
    try {
      const currentStatus = await api<CertificateSignatureStatus>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/certificate-signature`);
      setSignatureStatus(currentStatus);
      const blob = await apiBlob(`/extensions/suinda-learning/me/certificates/${encodeURIComponent(certificate.id)}/pdf`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `certificado-${certificate.certificate_code || "suinda"}.pdf`; anchor.click(); URL.revokeObjectURL(url);
      setDownloadMessage(currentStatus.usable
        ? `PDF assinado com certificado institucional (${currentStatus.sub_filter || "ETSI.CAdES.detached"}). A conformidade deve ser validada pela instituição.`
        : "PDF baixado sem assinatura digital; a instituição ainda não tem uma credencial válida configurada.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível baixar o certificado."); }
    finally { setBusy(false); }
  }
  async function downloadOpenBadge() {
    if (badgeBusy || certificate.state !== "issued") return;
    setBadgeBusy(true); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-open-badges/me/certificates/${encodeURIComponent(certificate.id)}.jwt`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `suinda-${certificate.certificate_code || "credential"}.jwt`; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível exportar a credencial Open Badges."); }
    finally { setBadgeBusy(false); }
  }
  const kindLabel = certificate.certificate_kind === "participation" ? "Certificado de participação"
    : certificate.certificate_kind === "milestone" ? "Certificado intermediário" : "Certificado de conclusão";
  return <div className="mt-3 rounded-lg border border-emerald-200/10 bg-emerald-200/[0.04] px-3 py-3 text-xs text-emerald-100"><p>{kindLabel}{certificate.milestone_title ? ` · ${certificate.milestone_title}` : ""} {certificate.state === "issued" ? "emitido" : "revogado"} · {certificate.certificate_code}</p>{certificate.certificate_kind === "milestone" && certificate.milestone_lesson_titles?.length ? <p className="mt-1 text-[#b6c2cf]">Aulas do marco: {certificate.milestone_lesson_titles.join(", ")}</p> : certificate.certificate_kind === "participation" && certificate.participation_scope && <p className="mt-1 text-[#b6c2cf]">Escopo: {certificate.participation_scope}</p>}{signatureStatus && <p className={`mt-2 ${signatureStatus.usable ? "text-emerald-100" : "text-amber-100"}`}>{signatureStatus.usable ? `O próximo PDF será assinado com certificado institucional${signatureStatus.valid_until ? ` válido até ${dateLabel(signatureStatus.valid_until) || ""}` : ""}.` : signatureStatus.reason === "status_unavailable" ? "Não foi possível confirmar a configuração institucional da assinatura." : "O próximo PDF será entregue sem assinatura digital; não há certificado institucional válido configurado."}</p>}<div className="mt-2 flex flex-wrap gap-3">{certificate.state === "issued" && <button type="button" onClick={download} disabled={busy} className="min-h-8 rounded-lg bg-emerald-100 px-3 font-semibold text-slate-950 disabled:opacity-60">{busy ? "Gerando PDF…" : "Baixar PDF"}</button>}{certificate.state === "issued" && <button type="button" onClick={() => void downloadOpenBadge()} disabled={badgeBusy} className="min-h-8 rounded-lg border border-emerald-100/30 px-3 font-semibold text-emerald-100 disabled:opacity-60">{badgeBusy ? "Preparando credencial…" : "Exportar Open Badge 3.0"}</button>}{certificate.public_validation_enabled && certificate.certificate_code && <Link href={`/suinda/certificates/${encodeURIComponent(certificate.certificate_code)}`} className="inline-flex min-h-8 items-center underline underline-offset-4">Validar autenticidade</Link>}</div>{downloadMessage && <p role="status" className="mt-2 text-cyan-100">{downloadMessage}</p>}{error && <p role="alert" className="mt-2 text-rose-200">{error}</p>}</div>;
}
