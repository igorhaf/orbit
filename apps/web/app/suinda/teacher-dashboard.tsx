"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CalendarDays, ClipboardCheck, Download, FileCheck2, Flag, MessageCircle, Pin, QrCode, Users, Video } from "lucide-react";
import { api, apiBlob, getToken } from "@/lib/api";

type ScholarshipCriterion = { id: string; label: string; max_points: number; guidance?: string };
type ScholarshipCriterionScore = { criterion_id: string; score: number; feedback?: string };
type ScholarshipQueueApplication = { id: string; revision: number; title: string; state: string; learner_name: string; program_title: string;
  course_title: string; score: number; discount_percent: number; scoring_criteria_snapshot?: ScholarshipCriterion[]; criterion_scores?: ScholarshipCriterionScore[];
  decision_reason?: string | null; waitlist_position?: number | null; terms_version?: string | null; terms_signature_name?: string | null;
  terms_signature_at?: string | null; terms_signature_text_sha256?: string | null; terms_signature_evidence_sha256?: string | null;
  document_uploads: Array<{ attachment_id: string; category: string; file_name: string; mime_type: string; size_bytes: number }> };

type TeachingData = {
  courses: Array<{ id: string; title: string; state: string; modality?: string }>;
  lesson_materials?: Array<{ lesson_id: string; workspace_id: string; lesson_title: string; lesson_state: string; lesson_revision: number; course_id?: string; course_title: string; content_type?: string; accessibility_gaps?: Array<{ code: string; message: string }>; attachments: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number; scan_status?: string; alt_text?: string | null }> }>;
  cohorts: Array<{ id: string; title: string; state: string; course_record_id: string; starts_at?: string; ends_at?: string; capacity?: number; location?: string }>;
  sessions: Array<{ id: string; revision: number; title: string; state: string; cohort_record_id?: string; starts_at?: string; ends_at?: string; modality?: string; meeting_provider?: string; meeting_url?: string; zoom_meeting_id?: string; location?: string; room_name?: string; upcoming: boolean }>;
  makeup_attendees?: Array<{ session_record_id: string; enrollment_id: string; enrollment_revision: number; enrollment_title: string; enrollment_state: string; learner_user_id: string; learner_name: string; request_id: string; request_revision: number; source_cohort_title: string; original_session_title: string }>;
  attendance: Array<{ id: string; session_record_id: string; enrollment_record_id: string; learner_user_id: string; status: string; minutes_attended?: number; notes?: string | null }>;
  roster: Array<{ id: string; revision: number; title: string; state: string; learner_user_id: string; learner_name: string; course_record_id: string; cohort_record_id?: string; attendance_percent?: number; grade?: number }>;
  announcement_receipts: Array<{ id: string; title: string; sent_at?: string; cohort_record_id: string; learners: Array<{ enrollment_id: string; learner_name: string; read_at: string | null }> }>;
  attendance_alerts: Array<{ enrollment_id: string; learner_user_id: string; learner_name: string; course_title: string; cohort_title: string; percent: number; minimum_percent: number; attended_minutes: number; scheduled_minutes: number }>;
  submissions: Array<{ id: string; revision: number; title: string; state: string; assessment_title: string; learner_user_id: string; group_member_names?: string[]; submitted_at?: string; late?: boolean; score?: number; feedback?: string | null; answer?: string; version?: number; rubric?: Array<{ id: string; criterion: string; description?: string; points: number }>; criterion_scores?: Array<{ criterion_id: string; score: number; feedback?: string }>; files?: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number }> }>;
  assessment_attempts: Array<{ id: string; revision: number; title: string; state: string; assessment_title: string; learner_name: string; submitted_at?: string; passing_score?: number; feedback?: string; answers: Array<{ question_id: string; prompt: string; points: number; answer: string; score?: number; feedback?: string }> }>;
  pending_practices: Array<{ id: string; revision: number; title: string; state: string; learner_name: string; course_title: string; scheduled_at?: string; activity_description: string; completion_notes?: string; hours_claimed?: number; location?: string }>;
  pending_documents: Array<{ id: string; revision: number; title: string; state: string; learner_name: string; course_title: string; category: string; description?: string; expires_at?: string; files: Array<{ id: string; revision: number; file_name: string; mime_type: string; size_bytes: number }> }>;
  pending_justifications: Array<{ id: string; revision: number; title: string; state: string; learner_name: string; course_title: string; session_title: string; reason: string; files: Array<{ id: string; revision: number; file_name: string; mime_type: string; size_bytes: number }> }>;
  pending_makeup_fees: Array<{ id: string; revision: number; title: string; state: string; learner_name: string; course_title: string; session_title: string; amount_due: number; currency: string }>;
  counts: { courses: number; cohorts: number; upcoming_sessions: number; active_learners: number; submissions_to_review: number; assessment_attempts_to_review: number; practices_to_review: number; documents_to_review: number; attendance_justifications_to_review: number; attendance_alerts: number };
  admin_summary?: {
    counts: { workspaces: number; admissions_to_review: number; payment_followups: number; upcoming_sessions: number; upcoming_assessments: number; attendance_risks: number; assessment_risks: number; grading_items: number; documents_to_review: number; documents_expiring: number; near_capacity_cohorts: number };
    recent_enrollments: Array<{ id: string; title: string; state: string; learner_name: string; course_title: string; submitted_at?: string }>;
    near_capacity_cohorts: Array<{ id: string; title: string; state: string; occupied: number; capacity: number; course_record_id?: string }>;
    near_capacity_cohorts_next_cursor?: string | null;
    upcoming_sessions: Array<{ id: string; title: string; starts_at?: string; location?: string; modality?: string }>;
    upcoming_assessments: Array<{ id: string; title: string; course_title?: string; due_at?: string }>;
    upcoming_assessments_next_cursor?: string | null;
    assessment_risks: Array<{ enrollment_id: string; assessment_id: string; learner_name: string; course_title: string; assessment_title: string; score: number; passing_score: number; attempt_number: number; max_attempts: number }>;
    assessment_risks_next_cursor?: string | null;
    pending_payments: Array<{ id: string; revision: number; title: string; learner_name: string; course_title: string; course_price: number; amount_covered: number; amount_remaining: number; currency: string; payment_status: string; overdue_installment_count: number; overdue_balance: number; oldest_overdue_at: string | null }>;
    pending_payments_next_cursor?: string | null;
    refund_candidates: Array<{ enrollment_id: string; enrollment_revision: number; enrollment_title: string; learner_name: string; course_title: string; payment_entry_id: string; payment_amount: number; amount_refunded: number; amount_refundable: number; currency: string }>;
    refund_candidates_next_cursor?: string | null;
    financial_cancellation_candidates?: Array<{ enrollment_id: string; enrollment_revision: number; enrollment_title: string; learner_name: string; course_title: string; amount_remaining: number; amount_covered: number; course_price: number; currency: string }>;
    financial_cancellation_candidates_next_cursor?: string | null;
    pending_scholarship_applications: ScholarshipQueueApplication[];
    pending_scholarship_applications_next_cursor?: string | null;
    scholarship_counterparties: Array<{ id: string; revision: number; state: string; learner_name: string; program_title: string; course_title: string; enrollment_title: string; requirement_text: string; evidence_text?: string | null; submitted_at?: string | null; review_feedback?: string | null; evidence_files: Array<{ attachment_id: string; file_name: string; mime_type: string; size_bytes: number }> }>;
    scholarship_counterparties_next_cursor?: string | null;
    documents_expiring: Array<{ id: string; title: string; learner_name: string; course_title: string; expires_at: string; category: string }>;
    documents_expiring_next_cursor?: string | null;
  };
  unit_financial_queues?: {
    payments: { items: Array<{ id: string; revision: number; title: string; learner_name: string; course_title: string; course_price: number; amount_covered: number; amount_remaining: number; currency: string; payment_status: string; overdue_installment_count: number; overdue_balance: number; oldest_overdue_at: string | null }>; next_cursor: string | null; limit: number };
    refunds: { items: Array<{ enrollment_id: string; enrollment_revision: number; enrollment_title: string; learner_name: string; course_title: string; payment_entry_id: string; payment_amount: number; amount_refunded: number; amount_refundable: number; currency: string }>; next_cursor: string | null; limit: number };
    cancellations: { items: Array<{ enrollment_id: string; enrollment_revision: number; enrollment_title: string; learner_name: string; course_title: string; amount_remaining: number; amount_covered: number; course_price: number; currency: string }>; next_cursor: string | null; limit: number };
  };
  unit_scholarship_queues?: {
    applications: { items: ScholarshipQueueApplication[]; next_cursor: string | null; limit: number };
    counterparties: { items: Array<{ id: string; revision: number; state: string; learner_name: string; program_title: string; course_title: string; enrollment_title: string; requirement_text: string; evidence_text?: string | null; submitted_at?: string | null; review_feedback?: string | null; evidence_files: Array<{ attachment_id: string; file_name: string; mime_type: string; size_bytes: number }> }>; next_cursor: string | null; limit: number };
  };
  unit_operations_summary?: {
    counts: { upcoming_assessments: number; documents_expiring: number; assessment_risks: number; near_capacity_cohorts: number };
    upcoming_assessments: Array<{ id: string; title: string; course_title: string; due_at?: string }>;
    upcoming_assessments_next_cursor?: string | null;
    documents_expiring: Array<{ id: string; title: string; learner_name: string; course_title: string; expires_at: string; category?: string }>;
    documents_expiring_next_cursor?: string | null;
    assessment_risks: Array<{ enrollment_id: string; assessment_id: string; learner_name: string; course_title: string; assessment_title: string; score: number; passing_score: number; attempt_number: number; max_attempts: number }>;
    assessment_risks_next_cursor?: string | null;
    near_capacity_cohorts: Array<{ id: string; title: string; state: string; occupied: number; capacity: number; course_record_id?: string }>;
    near_capacity_cohorts_next_cursor?: string | null;
  };
};
type SurveyResults = {
  response_count: number | null; anonymous: boolean; suppressed: boolean;
  results: Array<{ question_id: string; label: string; type: string; responses: number; average?: number | null; nps?: number | null; distribution?: Record<string, number> }>;
  suggestions?: Array<{ question_id: string; label: string; text: string }>;
};
type TeachingSurvey = { id: string; title: string; state: string; anonymous: boolean; target_type: string; closes_at: string | null; results: SurveyResults };
type AccessibilityAuditScope = { id: string; title: string };
type AccessibilityAuditLesson = { lesson_id: string; workspace_id: string; lesson_title: string; course_id: string; course_title: string; lesson_revision: number; accessibility_gaps: Array<{ code: string; message: string }>; attachments: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number; scan_status?: string; alt_text?: string | null }> };
type AccessibilityAuditScopeProgress = AccessibilityAuditScope & { items: AccessibilityAuditLesson[]; nextCursor: string | null; complete: boolean };
type EnrollmentCsvPreview = {
  cohort: { id: string; title: string; capacity: number; seats_occupied: number; seats_remaining: number | null; payment_required: boolean; course_price: number; currency: string };
  rows: Array<{ line: number; email: string; name?: string; invitation_required?: boolean; status: "ready" | "error"; message: string }>;
  ready_count: number;
  error_count: number;
};
type EnrollmentCsvResult = {
  cohort_id: string;
  created_count: number;
  invited_count: number;
  invitation_sent_count: number;
  error_count: number;
  rows: Array<{ line: number; email: string; status: "created" | "invited" | "error"; message: string; email_sent?: boolean }>;
};

function dateLabel(value?: string) {
  if (!value) return "Data a confirmar";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data inválida" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

type MeetingCalendarSource = { id: string; provider_id: string; name: string; capabilities?: Record<string, boolean> };

function SessionMeetingRoom({ session, onSaved }: { session: TeachingData["sessions"][number]; onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [sources, setSources] = useState<MeetingCalendarSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [joinUrl, setJoinUrl] = useState(session.meeting_url || "");
  const [meetingProvider, setMeetingProvider] = useState(session.meeting_provider || "google_meet");
  const [operationKey, setOperationKey] = useState("");
  const [pendingZoom, setPendingZoom] = useState(false);
  const [zoomMeetingId, setZoomMeetingId] = useState("");
  const [syncResult, setSyncResult] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const creatorFirstFieldRef = useRef<HTMLElement | null>(null);
  const creatorFallbackActionRef = useRef<HTMLButtonElement>(null);
  const meetingLinkRef = useRef<HTMLAnchorElement>(null);
  const focusPendingRef = useRef(false);
  const focusMeetingLinkRef = useRef(false);
  const creatorRegionId = `meeting-room-creator-${session.id}`;
  const storageKey = `suinda.zoom.meeting.${session.id}`;

  useEffect(() => {
    if (!expanded || loading || !focusPendingRef.current) return;
    focusPendingRef.current = false;
    if (document.activeElement === triggerRef.current) {
      (creatorFirstFieldRef.current || creatorFallbackActionRef.current)?.focus();
    }
  }, [expanded, loading, sources.length, pendingZoom]);

  useEffect(() => {
    if (!focusMeetingLinkRef.current || !joinUrl) return;
    focusMeetingLinkRef.current = false;
    meetingLinkRef.current?.focus();
  }, [joinUrl]);

  function closeCreator() {
    focusPendingRef.current = false;
    setExpanded(false);
    setError("");
    triggerRef.current?.focus();
  }

  async function openCreator() {
    focusPendingRef.current = true;
    setExpanded(true);
    setError("");
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const pending = JSON.parse(saved) as { operationKey?: unknown; sourceId?: unknown; pending?: unknown };
        if (typeof pending.operationKey === "string" && typeof pending.sourceId === "string") {
          setOperationKey(pending.operationKey);
          setSourceId(pending.sourceId);
          setPendingZoom(pending.pending === true);
        }
      }
    } catch { sessionStorage.removeItem(storageKey); }
    if (sources.length || loading) return;
    setLoading(true);
    try {
      const [calendarSources, zoomStatus] = await Promise.all([
        api<MeetingCalendarSource[]>("/calendar/sources"),
        api<{ configured: boolean; connections: Array<{ id: string; display_name: string; enabled: boolean; status: string }> }>("/zoom/status"),
      ]);
      const available = calendarSources
        .filter((source) => ["google_calendar", "outlook_calendar"].includes(source.provider_id) && source.capabilities?.create === true);
      available.push(...zoomStatus.connections
        .filter((connection) => connection.enabled && connection.status === "connected")
        .map((connection) => ({ id: connection.id, provider_id: "zoom", name: connection.display_name })));
      setSources(available);
      setSourceId((current) => available.some((source) => source.id === current) ? current : available[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível consultar calendários.");
    } finally { setLoading(false); }
  }

  async function create() {
    if (!sourceId || saving) return;
    const key = operationKey || crypto.randomUUID();
    setOperationKey(key);
    if (sources.find((source) => source.id === sourceId)?.provider_id === "zoom") {
      sessionStorage.setItem(storageKey, JSON.stringify({ operationKey: key, sourceId, pending: false }));
    }
    setSaving(true);
    setError("");
    try {
      const result = await api<{ meeting_url: string; meeting_provider: string }>(`/extensions/suinda-learning/me/teaching/sessions/${encodeURIComponent(session.id)}/meeting-room`, {
        method: "POST",
        body: JSON.stringify({ operation_key: key, source_id: sourceId, expected_revision: session.revision }),
      });
      focusMeetingLinkRef.current = true;
      setJoinUrl(result.meeting_url);
      setMeetingProvider(result.meeting_provider);
      sessionStorage.removeItem(storageKey);
      setPendingZoom(false);
      setExpanded(false);
      onSaved();
    } catch (reason) {
      const code = reason && typeof reason === "object" && "code" in reason ? (reason as { code?: unknown }).code : undefined;
      if (code === "ZOOM_MEETING_PENDING" && sources.find((source) => source.id === sourceId)?.provider_id === "zoom") {
        sessionStorage.setItem(storageKey, JSON.stringify({ operationKey: key, sourceId, pending: true }));
        setPendingZoom(true);
      }
      setError(reason instanceof Error ? reason.message : "Não foi possível criar a sala de reunião.");
    } finally { setSaving(false); }
  }

  async function reconcileZoom() {
    if (!operationKey || !sourceId || !zoomMeetingId.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ meeting_url: string; meeting_provider: string }>(`/extensions/suinda-learning/me/teaching/sessions/${encodeURIComponent(session.id)}/meeting-room/reconcile`, {
        method: "POST",
        body: JSON.stringify({ operation_key: operationKey, source_id: sourceId, expected_revision: session.revision, meeting_id: zoomMeetingId.trim() }),
      });
      focusMeetingLinkRef.current = true;
      setJoinUrl(result.meeting_url);
      setMeetingProvider(result.meeting_provider);
      sessionStorage.removeItem(storageKey);
      setPendingZoom(false);
      setExpanded(false);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a reunião no Zoom.");
    } finally { setSaving(false); }
  }

  async function connectZoom() {
    try {
      const result = await api<{ url: string }>("/zoom/oauth/start");
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível conectar o Zoom.");
    }
  }

  async function syncZoomAttendance() {
    if (saving) return;
    setSaving(true); setError(""); setSyncResult("");
    try {
      const result = await api<{ recorded: number; preserved: number; review_required: number }>(`/extensions/suinda-learning/me/teaching/sessions/${encodeURIComponent(session.id)}/attendance/zoom-sync`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: session.revision }),
      });
      setSyncResult(`${result.recorded} presença(s) importada(s), ${result.preserved} registro(s) preexistente(s) preservado(s)${result.review_required ? ` e ${result.review_required} participante(s) pendente(s) de revisão` : ""}.`);
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível sincronizar a presença do Zoom."); }
    finally { setSaving(false); }
  }

  async function syncProviderAttendance() {
    if (saving || (meetingProvider !== "google_meet" && meetingProvider !== "teams")) return;
    setSaving(true); setError(""); setSyncResult("");
    const pathProvider = meetingProvider === "google_meet" ? "google-meet" : "teams";
    try {
      const result = await api<{ recorded: number; preserved: number; review_required: number }>(`/extensions/suinda-learning/me/teaching/sessions/${encodeURIComponent(session.id)}/attendance/${pathProvider}-sync`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: session.revision }),
      });
      setSyncResult(`${result.recorded} presença(s) importada(s), ${result.preserved} registro(s) preexistente(s) preservado(s)${result.review_required ? ` e ${result.review_required} participante(s) pendente(s) de revisão` : ""}. Nenhuma ausência foi inferida.`);
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível sincronizar a presença do provedor."); }
    finally { setSaving(false); }
  }

  async function reconnectAttendanceProvider() {
    const endpoint = meetingProvider === "google_meet"
      ? "/calendar/google/oauth/start?capability=meet_attendance"
      : "/calendar/microsoft/oauth/start?capability=teams";
    try {
      const result = await api<{ url: string }>(endpoint);
      window.location.assign(result.url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível solicitar as permissões do provedor."); }
  }

  if (joinUrl) return <div className="mt-3 flex flex-wrap items-center gap-2"><a ref={meetingLinkRef} href={joinUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-cyan-200/20 px-3 text-xs font-medium text-cyan-100 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><Video size={14} aria-hidden="true" /> Abrir {meetingProvider === "teams" ? "Microsoft Teams" : meetingProvider === "zoom" ? "Zoom" : "Google Meet"} <ArrowRight size={13} aria-hidden="true" /></a>{session.state === "completed" && meetingProvider === "zoom" && <button type="button" onClick={() => void syncZoomAttendance()} disabled={saving} className="min-h-9 rounded-lg border border-violet-200/20 px-3 text-xs font-medium text-violet-100 hover:bg-white/[0.04] disabled:opacity-50">{saving ? "Sincronizando…" : "Sincronizar presença Zoom"}</button>}{session.state === "completed" && (meetingProvider === "google_meet" || meetingProvider === "teams") && <><button type="button" onClick={() => void syncProviderAttendance()} disabled={saving} className="min-h-9 rounded-lg border border-violet-200/20 px-3 text-xs font-medium text-violet-100 hover:bg-white/[0.04] disabled:opacity-50">{saving ? "Sincronizando…" : `Sincronizar presença ${meetingProvider === "teams" ? "Teams" : "Google Meet"}`}</button><button type="button" onClick={() => void reconnectAttendanceProvider()} disabled={saving} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf] hover:bg-white/[0.04] disabled:opacity-50">Conceder permissão de presença</button></>}{syncResult && <p role="status" className="w-full text-xs text-[#b6c2cf]">{syncResult}</p>}{error && <p role="alert" className="w-full text-xs text-rose-200">{error}</p>}</div>;
  if (!session.upcoming || session.state !== "scheduled" || !["online", "hybrid"].includes(String(session.modality))) return null;

  return <div className="mt-3">
    <button ref={triggerRef} type="button" aria-expanded={expanded} aria-controls={creatorRegionId} onClick={() => expanded ? closeCreator() : void openCreator()} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-cyan-200/20 px-3 text-xs font-medium text-cyan-100 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">{expanded ? "Recolher criação de videoconferência" : <><Video size={14} aria-hidden="true" /> Criar videoconferência</>}</button>
    <div id={creatorRegionId} role="region" aria-label="Criação de videoconferência" className={`${expanded ? "grid" : "hidden"} mt-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]`}>
      {loading ? <p role="status" aria-live="polite" className="text-xs text-[#9fadbc] sm:col-span-2">Buscando integrações…</p> : sources.length ? <><label className="grid gap-1 text-xs text-[#9fadbc]">{pendingZoom ? "Conta Zoom usada na tentativa" : "Criar reunião com"}<select ref={(node) => { creatorFirstFieldRef.current = node; }} value={sourceId} onChange={(event) => { setSourceId(event.target.value); setOperationKey(""); }} disabled={saving || pendingZoom} className="min-h-9 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#dee4ea]">{sources.map((source) => <option key={source.id} value={source.id}>{source.provider_id === "outlook_calendar" ? "Microsoft Teams · " : source.provider_id === "zoom" ? "Zoom · " : "Google Meet · "}{source.name}</option>)}</select></label><button type="button" ref={creatorFallbackActionRef} onClick={() => void connectZoom()} className="self-end rounded-lg px-2 py-2 text-xs text-cyan-100 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Conectar outra conta Zoom</button></> : <p className="text-xs leading-5 text-[#9fadbc] sm:col-span-2">Nenhuma conta conectada para criar reuniões. Conecte <Link href="/calendar" className="text-cyan-100 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Google ou Outlook</Link> ou <button ref={creatorFallbackActionRef} type="button" onClick={() => void connectZoom()} className="text-cyan-100 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">conecte o Zoom</button>.</p>}
      {pendingZoom && <div className="grid gap-2 rounded-lg border border-amber-200/20 bg-amber-200/[0.04] p-3 sm:col-span-2"><p className="text-xs leading-5 text-amber-100">A resposta da tentativa ficou incerta. Localize a reunião na conta Zoom selecionada e informe o ID; o Orbit vai confirmar os dados sem criar outra reunião.</p><label className="grid gap-1 text-xs text-[#9fadbc]">ID da reunião Zoom<input ref={(node) => { creatorFirstFieldRef.current = node; }} inputMode="numeric" autoComplete="off" value={zoomMeetingId} onChange={(event) => setZoomMeetingId(event.target.value)} disabled={saving} className="min-h-9 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#dee4ea]" /></label><button type="button" onClick={() => void reconcileZoom()} disabled={saving || !zoomMeetingId.trim()} className="min-h-9 justify-self-start rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{saving ? "Verificando no Zoom…" : "Confirmar reunião existente"}</button></div>}
      <div className="flex items-end gap-2 sm:col-span-2"><button type="button" onClick={() => void create()} disabled={loading || saving || !sourceId} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{saving ? "Criando sala…" : "Criar sala"}</button><button type="button" onClick={closeCreator} disabled={saving} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf] disabled:opacity-50">Cancelar</button></div>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}
  </div>;
}

function surveyCsvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  const numeric = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text);
  if (!numeric && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportSurveyCsv(survey: TeachingSurvey) {
  const rows: unknown[][] = [
    ["Pesquisa", survey.title], ["Público", survey.target_type], ["Anônima", survey.anonymous ? "Sim" : "Não"],
    ["Respostas", survey.results.suppressed ? "Menos de 5" : survey.results.response_count], ["Resultados suprimidos", survey.results.suppressed ? "Sim" : "Não"], [],
    ["Pergunta", "Tipo", "Respostas", "Média", "NPS", "Distribuição"],
  ];
  if (!survey.results.suppressed) {
    for (const result of survey.results.results) rows.push([result.label, result.type, result.responses, result.average ?? "", result.nps ?? "",
      result.distribution ? Object.entries(result.distribution).map(([value, count]) => `${value}: ${count}`).join(" | ") : ""]);
    if (!survey.anonymous && survey.results.suggestions?.length) {
      rows.push([], ["Pergunta", "Comentário"]);
      for (const suggestion of survey.results.suggestions) rows.push([suggestion.label, suggestion.text]);
    }
  }
  const csv = rows.map((row) => row.map(surveyCsvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `suinda-pesquisa-${survey.id}.csv`;
  anchor.click(); URL.revokeObjectURL(url);
}

export default function SuindaTeacherDashboard() {
  const [data, setData] = useState<TeachingData | null>(null);
  const [dashboardRevision, setDashboardRevision] = useState(0);
  const [surveys, setSurveys] = useState<TeachingSurvey[]>([]);
  const [surveyCursor, setSurveyCursor] = useState<string | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [surveyError, setSurveyError] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const [auditScopes, setAuditScopes] = useState<AccessibilityAuditScopeProgress[]>([]);
  const [auditScopeCursor, setAuditScopeCursor] = useState<string | null>(null);
  const [auditScopesComplete, setAuditScopesComplete] = useState(false);
  const [auditStarted, setAuditStarted] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState("");

  const load = useCallback(() => {
    if (!getToken()) return;
    setError("");
    setSurveyCursor(null); setSurveyError("");
    Promise.resolve().then(async () => {
      const [teaching, surveyData] = await Promise.all([
        api<TeachingData>("/extensions/suinda-learning/me/teaching"),
        api<{ surveys: TeachingSurvey[]; next_cursor: string | null }>("/extensions/suinda-learning/me/teaching/surveys?limit=50"),
      ]);
      setData(teaching); setSurveys(surveyData.surveys); setSurveyCursor(surveyData.next_cursor); setDashboardRevision((revision) => revision + 1);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o painel docente."));
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function loadMoreSurveys() {
    if (!surveyCursor || surveyLoading) return;
    setSurveyLoading(true); setSurveyError("");
    try {
      const query = new URLSearchParams({ cursor: surveyCursor, limit: "50" });
      const page = await api<{ surveys: TeachingSurvey[]; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/surveys?${query}`);
      setSurveys((current) => {
        const known = new Set(current.map((survey) => survey.id));
        return [...current, ...page.surveys.filter((survey) => !known.has(survey.id))];
      });
      setSurveyCursor(page.next_cursor);
    } catch (reason) {
      setSurveyError(reason instanceof Error ? reason.message : "Não foi possível carregar as próximas pesquisas.");
    } finally { setSurveyLoading(false); }
  }

  if (!data || !(data.admin_summary || data.unit_financial_queues || data.unit_scholarship_queues || data.unit_operations_summary || data.counts.courses || data.counts.cohorts || data.sessions.length || data.pending_documents.length || data.pending_justifications.length || data.pending_makeup_fees.length || data.assessment_attempts.length || data.pending_practices.length || data.lesson_materials?.length || surveys.length)) return error ? <p role="alert" className="mx-auto max-w-7xl px-5 py-3 text-sm text-rose-200">{error}</p> : null;
  const courseNames = new Map(data.courses.map((course) => [course.id, course.title]));
  const cohortNames = new Map(data.cohorts.map((cohort) => [cohort.id, cohort.title]));
  const studentNames = new Map(data.roster.map((learner) => [learner.learner_user_id, learner.learner_name]));
  const accessibilityPendingLessons = data.lesson_materials?.filter((lesson) => lesson.accessibility_gaps?.length) || [];
  const accessibilityGapCount = accessibilityPendingLessons.reduce((total, lesson) => total + (lesson.accessibility_gaps?.length || 0), 0);
  const accessibilityAuditComplete = auditStarted && auditScopesComplete && auditScopes.every((scope) => scope.complete);
  const accessibilityAuditLessonCount = auditScopes.reduce((total, scope) => total + scope.items.length, 0);
  async function loadNextAccessibilityAuditPage() {
    if (auditBusy || accessibilityAuditComplete) return;
    setAuditBusy(true); setAuditError("");
    try {
      let scopes = auditScopes;
      let scopeCursor = auditScopeCursor;
      let scopesComplete = auditScopesComplete;
      if (!auditStarted) {
        const page = await api<{ items: AccessibilityAuditScope[]; next_cursor: string | null; complete: boolean }>("/extensions/suinda-learning/me/teaching/accessibility-audit/courses?limit=100");
        scopes = page.items.map((scope) => ({ ...scope, items: [], nextCursor: null, complete: false }));
        scopeCursor = page.next_cursor;
        scopesComplete = page.complete;
        setAuditStarted(true); setAuditScopes(scopes); setAuditScopeCursor(scopeCursor); setAuditScopesComplete(scopesComplete);
      }
      let index = scopes.findIndex((scope) => !scope.complete);
      if (index < 0 && !scopesComplete) {
        const query = new URLSearchParams({ limit: "100" });
        if (scopeCursor) query.set("cursor", scopeCursor);
        const page = await api<{ items: AccessibilityAuditScope[]; next_cursor: string | null; complete: boolean }>(`/extensions/suinda-learning/me/teaching/accessibility-audit/courses?${query.toString()}`);
        const newScopes = page.items.map((scope) => ({ ...scope, items: [], nextCursor: null, complete: false }));
        scopes = [...scopes, ...newScopes]; scopeCursor = page.next_cursor; scopesComplete = page.complete;
        setAuditScopes(scopes); setAuditScopeCursor(scopeCursor); setAuditScopesComplete(scopesComplete);
        index = scopes.findIndex((scope) => !scope.complete);
      }
      if (index < 0) {
        setAuditScopesComplete(scopesComplete);
        return;
      }
      const scope = scopes[index];
      const query = new URLSearchParams({ limit: "100" });
      if (scope.nextCursor) query.set("cursor", scope.nextCursor);
      const page = await api<{ items: AccessibilityAuditLesson[]; next_cursor: string | null; complete: boolean }>(`/extensions/suinda-learning/me/teaching/accessibility-audit/courses/${encodeURIComponent(scope.id)}/lessons?${query.toString()}`);
      const updated = [...scopes];
      updated[index] = { ...scope, items: [...scope.items, ...page.items], nextCursor: page.next_cursor, complete: page.complete };
      setAuditScopes(updated); setAuditScopeCursor(scopeCursor); setAuditScopesComplete(scopesComplete);
    } catch (reason) {
      setAuditError(reason instanceof Error ? reason.message : "Não foi possível continuar a auditoria de materiais de aula.");
    } finally { setAuditBusy(false); }
  }
  async function downloadAttachment(submission: TeachingData["submissions"][number], file: NonNullable<TeachingData["submissions"][number]["files"]>[number]) {
    setDownloading(file.id); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/records/${encodeURIComponent(submission.id)}/attachments/${submission.revision}/${encodeURIComponent(file.id)}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível baixar o anexo."); }
    finally { setDownloading(""); }
  }
  async function downloadLessonMaterial(lesson: NonNullable<TeachingData["lesson_materials"]>[number], file: NonNullable<TeachingData["lesson_materials"]>[number]["attachments"][number]) {
    setDownloading(file.id); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/records/${encodeURIComponent(lesson.lesson_id)}/attachments/${lesson.lesson_revision}/${encodeURIComponent(file.id)}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível baixar o material da aula."); }
    finally { setDownloading(""); }
  }

  return <section className="border-t border-[#3b4754] bg-[#1d2125] px-4 py-10 sm:px-8" aria-labelledby="teacher-dashboard-title"><div className="mx-auto max-w-7xl">
    <header className="rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.1),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-5 sm:p-7"><p className="text-xs font-medium uppercase tracking-[.14em] text-cyan-200">Suindá · equipe acadêmica</p><h2 id="teacher-dashboard-title" className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Painel docente</h2><p className="mt-2 text-sm leading-6 text-[#b6c2cf]">Suas turmas, próximos encontros, estudantes e entregas atribuídas.</p><div className="mt-5 flex flex-wrap gap-3"><Stat label="Cursos" value={data.counts.courses} /><Stat label="Turmas" value={data.counts.cohorts} /><Stat label="Próximos encontros" value={data.counts.upcoming_sessions} /><Stat label="Alunos ativos" value={data.counts.active_learners} /><Stat label="Entregas pendentes" value={data.counts.submissions_to_review} />{data.lesson_materials?.length ? <><Stat label="Aulas com pendências de acessibilidade" value={accessibilityPendingLessons.length} /><Stat label="Lacunas de acessibilidade" value={accessibilityGapCount} /></> : null}{data.counts.assessment_attempts_to_review > 0 && <Stat label="Discursivas para corrigir" value={data.counts.assessment_attempts_to_review} />}{data.counts.practices_to_review > 0 && <Stat label="Práticas para validar" value={data.counts.practices_to_review} />}{data.counts.documents_to_review > 0 && <Stat label="Documentos para revisar" value={data.counts.documents_to_review} />}{data.counts.attendance_justifications_to_review > 0 && <Stat label="Justificativas" value={data.counts.attendance_justifications_to_review} />}{data.counts.attendance_alerts > 0 && <Stat label="Alertas de frequência" value={data.counts.attendance_alerts} />}</div></header>
    <CommunityModerationPanel />
    <CommunityPinningPanel courses={data.courses} />
    {data.admin_summary && <AdminOverview key={dashboardRevision} summary={data.admin_summary} onSaved={load} />}
    {data.unit_financial_queues && <UnitFinancialQueues key={dashboardRevision} queues={data.unit_financial_queues} onSaved={load} />}
    {data.unit_scholarship_queues && <UnitScholarshipQueues key={dashboardRevision} queues={data.unit_scholarship_queues} onSaved={load} />}
    {data.unit_operations_summary && <UnitOperationsSummary key={dashboardRevision} summary={data.unit_operations_summary} />}
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="teacher-accessibility-audit-title">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><FileCheck2 size={17} className="text-cyan-200" aria-hidden="true" /><h3 id="teacher-accessibility-audit-title" className="font-semibold text-white">Auditoria de acessibilidade dos materiais de aula</h3></div><p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Examina alternativas de imagens, transcrições e legendas das aulas publicadas nas revisões curriculares atuais dos cursos que você pode administrar ou nos quais está atribuído. A varredura percorre páginas de até 100 aulas e cursos; ela não substitui uma auditoria WCAG da interface nem testes com tecnologia assistiva.</p></div><button type="button" onClick={() => void loadNextAccessibilityAuditPage()} disabled={auditBusy || accessibilityAuditComplete} className="inline-flex min-h-10 items-center rounded-lg border border-cyan-100/20 px-3 text-xs font-medium text-cyan-100 hover:bg-cyan-100/5 disabled:opacity-50">{auditBusy ? "Verificando…" : !auditStarted ? "Iniciar verificação" : accessibilityAuditComplete ? "Verificação concluída" : "Continuar verificação"}</button></div>
        {auditStarted && <p className="mt-3 text-xs text-[#b6c2cf]" aria-live="polite">{accessibilityAuditComplete ? `Verificação de materiais concluída: ${accessibilityAuditLessonCount} aulas publicadas examinadas em ${auditScopes.length} cursos.` : `${accessibilityAuditLessonCount} aulas publicadas examinadas em ${auditScopes.filter((scope) => scope.complete).length} de ${auditScopes.length} cursos carregados${auditScopesComplete ? "" : "; ainda há cursos a carregar"}.`}</p>}
        {auditError && <p role="alert" className="mt-3 text-xs text-rose-200">{auditError}</p>}
        {auditStarted && auditScopesComplete && auditScopes.length === 0 && <p className="mt-3 text-sm text-[#9fadbc]">Nenhum curso atribuído ou administrado está disponível para auditoria.</p>}
        {auditScopes.some((scope) => scope.items.some((lesson) => lesson.accessibility_gaps.length > 0)) && <ul className="mt-4 grid gap-3 md:grid-cols-2">{auditScopes.flatMap((scope) => scope.items.filter((lesson) => lesson.accessibility_gaps.length > 0).map((lesson) => <li key={`${lesson.lesson_id}:${lesson.lesson_revision}`} className="rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-4"><p className="text-sm font-medium text-[#dee4ea]">{lesson.lesson_title}</p><p className="mt-1 text-xs text-[#9fadbc]">{lesson.course_title} · revisão {lesson.lesson_revision}</p><ul className="mt-2 list-disc pl-5 text-xs leading-5 text-[#f1d9a5]">{lesson.accessibility_gaps.map((gap) => <li key={gap.code}>{gap.message}</li>)}</ul><Link href={`/suinda?kind=lesson&workspace=${encodeURIComponent(lesson.workspace_id)}&record=${encodeURIComponent(lesson.lesson_id)}#academic-management`} aria-label={`Abrir ${lesson.lesson_title} para revisar acessibilidade`} className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-amber-100/20 px-3 text-xs font-medium text-amber-100 hover:bg-amber-100/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">Abrir aula para revisar</Link></li>))}</ul>}
      </section>
      {!!data.lesson_materials?.length && <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="teacher-lesson-materials-title"><div className="flex items-center gap-2"><FileCheck2 size={17} className="text-cyan-200" aria-hidden="true" /><h3 id="teacher-lesson-materials-title" className="font-semibold text-white">Materiais das aulas atribuídas</h3></div><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Arquivos da revisão atual das aulas dos seus cursos e turmas. O acesso respeita a atribuição docente e o estado do conteúdo.</p><ul className="mt-4 grid gap-3 md:grid-cols-2">{data.lesson_materials.map((lesson) => <li key={`${lesson.lesson_id}:${lesson.lesson_revision}`} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><p className="text-sm font-medium text-[#dee4ea]">{lesson.lesson_title}</p><p className="mt-1 text-xs text-[#9fadbc]">{lesson.course_title} · {lesson.lesson_state} · revisão {lesson.lesson_revision}</p>{!!lesson.accessibility_gaps?.length && <div className="mt-3 rounded-lg border border-amber-200/20 bg-amber-200/[0.05] p-3"><p className="text-xs font-semibold text-amber-100">Acessibilidade a revisar nesta aula publicada</p><ul className="mt-1 list-disc pl-5 text-xs leading-5 text-[#f1d9a5]">{lesson.accessibility_gaps.map((gap) => <li key={gap.code}>{gap.message}</li>)}</ul><Link href={`/suinda?kind=lesson&workspace=${encodeURIComponent(lesson.workspace_id)}&record=${encodeURIComponent(lesson.lesson_id)}#academic-management`} aria-label={`Abrir ${lesson.lesson_title} para revisar acessibilidade`} className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-amber-100/20 px-3 text-xs font-medium text-amber-100 hover:bg-amber-100/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">Abrir aula para revisar</Link></div>}{lesson.attachments.length ? <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Materiais de ${lesson.lesson_title}`}>{lesson.attachments.map((file) => <li key={file.id}><button type="button" onClick={() => void downloadLessonMaterial(lesson, file)} disabled={Boolean(downloading)} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/5 disabled:opacity-50">{downloading === file.id ? "Baixando…" : `Baixar ${file.file_name}`}</button><p className="mt-1 text-[10px] text-[#9fadbc]">{(file.size_bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB · {file.scan_status === "clean" ? "verificado" : "scanner não configurado"}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum arquivo anexado nesta revisão.</p>}</li>)}</ul></section>}
      {data.attendance_alerts.length > 0 && <section className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.04] p-5 xl:col-span-2" aria-labelledby="attendance-alerts-title"><div className="flex items-center gap-2"><ClipboardCheck size={17} className="text-amber-200" aria-hidden="true" /><h3 id="attendance-alerts-title" className="font-semibold text-amber-100">Alunos abaixo da frequência mínima</h3></div><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Sinal operacional calculado pelos minutos registrados em encontros concluídos da revisão curricular da matrícula, comparados aos minutos previstos e ao mínimo definido no curso. Não estima probabilidade de evasão.</p><ul className="mt-4 grid gap-2 md:grid-cols-2">{data.attendance_alerts.map((alert) => <li key={alert.enrollment_id} className="rounded-xl border border-white/[0.08] bg-black/10 p-3"><p className="text-sm font-medium text-[#dee4ea]">{alert.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{alert.course_title} · {alert.cohort_title}</p><p className="mt-2 text-xs text-amber-100">{alert.percent}% · mínimo {alert.minimum_percent}% · {(alert.attended_minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} de {(alert.scheduled_minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} horas</p></li>)}</ul></section>}
      {surveys.length > 0 && <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="survey-results-title"><h3 id="survey-results-title" className="font-semibold text-white">Pesquisas e satisfação</h3><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Resultados consolidados das pesquisas que você pode consultar. Respostas individuais não são expostas.</p><div className="mt-4 grid gap-3 lg:grid-cols-2">{surveys.map((survey) => <article key={survey.id} className="rounded-xl border border-white/[0.08] bg-black/10 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-medium text-[#dee4ea]">{survey.title}</h4><p className="mt-1 text-xs text-[#9fadbc]">{survey.target_type} · {survey.state === "open" ? "Aberta" : survey.state === "closed" ? "Encerrada" : survey.state}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-cyan-200/10 px-2.5 py-1 text-[11px] text-cyan-100">{survey.anonymous ? "Anônima" : "Identificada"}</span><button type="button" aria-label={`Exportar resultados da pesquisa ${survey.title} em CSV`} onClick={() => exportSurveyCsv(survey)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#3b4754] px-2.5 text-[11px] text-[#b6c2cf] hover:border-cyan-200/30 hover:text-cyan-100"><Download size={13} aria-hidden="true" /> CSV</button></div></div><p className="mt-3 text-xs text-[#b6c2cf]">{survey.results.suppressed ? "Menos de 5 respostas" : `${survey.results.response_count} respostas`}{survey.closes_at ? ` · encerra ${dateLabel(survey.closes_at)}` : ""}</p>{survey.results.suppressed ? <p className="mt-2 text-xs text-amber-100">Resultados ocultos até alcançar cinco respostas para preservar o anonimato.</p> : <><ul className="mt-3 grid gap-2">{survey.results.results.map((result) => <li key={result.question_id} className="rounded-lg bg-white/[0.03] p-3"><p className="text-xs font-medium text-[#b6c2cf]">{result.label}</p><p className="mt-1 text-[11px] text-[#9fadbc]">{result.responses} respostas{result.average !== undefined && result.average !== null ? ` · média ${result.average}` : ""}{result.nps !== undefined && result.nps !== null ? ` · NPS ${result.nps}` : ""}</p>{result.distribution && <p className="mt-1 break-words text-[11px] text-[#9fadbc]">{Object.entries(result.distribution).map(([value, count]) => `${value}: ${count}`).join(" · ")}</p>}</li>)}</ul>{!survey.anonymous && Boolean(survey.results.suggestions?.length) && <details className="mt-3 rounded-lg border border-white/[0.07] p-3"><summary className="cursor-pointer text-xs font-medium text-cyan-100">Sugestões e comentários ({survey.results.suggestions!.length})</summary><ul className="mt-3 grid gap-2">{survey.results.suggestions!.map((suggestion, index) => <li key={`${suggestion.question_id}-${index}`} className="whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 text-xs leading-5 text-[#b6c2cf]">{suggestion.text}</li>)}</ul></details>}</>}</article>)}</div></section>}
      {(surveyCursor || surveyError) && <div className="xl:col-span-2 -mt-3">{surveyError && <p role="alert" className="mb-2 text-xs text-rose-200">{surveyError}</p>}{surveyCursor && <button type="button" onClick={() => void loadMoreSurveys()} disabled={surveyLoading} className="min-h-10 rounded-lg border border-cyan-200/20 px-4 text-xs text-cyan-100 disabled:opacity-50">{surveyLoading ? "Carregando pesquisas…" : "Carregar mais pesquisas"}</button>}</div>}
      <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5" aria-labelledby="teacher-schedule-title"><div className="flex items-center gap-2"><CalendarDays size={17} className="text-cyan-200" aria-hidden="true" /><h3 id="teacher-schedule-title" className="font-semibold text-white">Agenda de encontros</h3></div>{data.sessions.length ? <ul className="mt-4 divide-y divide-white/[0.07]">{data.sessions.map((session) => { const makeupAttendees = (data.makeup_attendees || []).filter((attendee) => attendee.session_record_id === session.id);
        const regularRoster = data.roster.filter((learner) => learner.cohort_record_id === session.cohort_record_id);
        const makeupRoster = makeupAttendees.map((attendee) => ({ id: attendee.enrollment_id, revision: attendee.enrollment_revision, title: attendee.enrollment_title, state: attendee.enrollment_state, learner_user_id: attendee.learner_user_id, learner_name: attendee.learner_name, course_record_id: "", cohort_record_id: undefined, makeup_origin: { source_cohort_title: attendee.source_cohort_title, original_session_title: attendee.original_session_title } }));
        const sessionRoster = [...regularRoster, ...makeupRoster.filter((attendee) => !regularRoster.some((learner) => learner.id === attendee.id))];
        const sessionAttendance = data.attendance.filter((record) => record.session_record_id === session.id);
        return <li key={session.id} className="py-3 first:pt-0 last:pb-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-[#dee4ea]">{session.title}</p><p className="mt-1 text-xs text-[#9fadbc]">{cohortNames.get(session.cohort_record_id || "") || "Encontro atribuído"} · {dateLabel(session.starts_at)}</p><p className="mt-1 text-xs text-[#9fadbc]">{session.room_name ? `Sala ${session.room_name}${session.location ? ` · ${session.location}` : ""}` : session.location || session.modality || "Local/modalidade a confirmar"}</p></div>{session.upcoming && <span className="rounded-full bg-cyan-200/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100">Próximo</span>}</div><SessionMeetingRoom session={session} onSaved={() => void load()} />{session.state === "live" && <SessionCheckinCode session={session} />}{makeupAttendees.length > 0 && <div className="mt-3 rounded-xl border border-violet-200/15 bg-violet-200/[0.04] p-3"><p className="text-xs font-medium text-violet-100">Reposições agendadas nesta turma</p><ul className="mt-2 grid gap-2 sm:grid-cols-2">{makeupAttendees.map((attendee) => <li key={attendee.request_id} className="rounded-lg border border-white/[0.07] bg-black/10 p-3"><p className="text-xs font-medium text-[#dee4ea]">{attendee.learner_name}</p><p className="mt-1 text-[11px] leading-5 text-[#9fadbc]">Reposição de “{attendee.original_session_title}” · turma de origem {attendee.source_cohort_title}</p></li>)}</ul></div>}{["live", "completed"].includes(session.state) && <AttendanceForm session={session} learners={sessionRoster} entries={sessionAttendance} />}</li>; })}</ul> : <p className="mt-3 text-sm text-[#9fadbc]">Nenhum encontro atribuído.</p>}</section>
      <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5" aria-labelledby="teacher-roster-title"><div className="flex items-center gap-2"><Users size={17} className="text-cyan-200" aria-hidden="true" /><h3 id="teacher-roster-title" className="font-semibold text-white">Lista de estudantes</h3></div>{data.roster.length ? <ul className="mt-4 divide-y divide-white/[0.07]">{data.roster.map((learner) => <li key={learner.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><p className="text-sm font-medium text-[#dee4ea]">{learner.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{courseNames.get(learner.course_record_id) || "Curso"} · {cohortNames.get(learner.cohort_record_id || "") || "Turma aberta"}</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-[#3b4754] px-2.5 py-1 text-[11px] text-[#b6c2cf]">{learner.state}</span><Link href={`/suinda/messages/${encodeURIComponent(learner.id)}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/[0.04]"><MessageCircle size={14} aria-hidden="true" /> Mensagem</Link>{learner.cohort_record_id && data.cohorts.some((cohort) => cohort.course_record_id === learner.course_record_id && cohort.id !== learner.cohort_record_id && ["enrolling", "active"].includes(cohort.state)) && <EnrollmentTransferForm learner={learner} cohorts={data.cohorts.filter((cohort) => cohort.course_record_id === learner.course_record_id && cohort.id !== learner.cohort_record_id && ["enrolling", "active"].includes(cohort.state))} onSaved={load} />}</div></li>)}</ul> : <p className="mt-3 text-sm text-[#9fadbc]">Nenhum estudante matriculado nas suas turmas.</p>}</section>
      <EnrollmentCsvImport cohorts={data.cohorts.filter((cohort) => cohort.state === "enrolling")} onSaved={load} />
      <AnnouncementComposer cohorts={data.cohorts.filter((cohort) => ["enrolling", "active"].includes(cohort.state))} />
      {data.announcement_receipts.length > 0 && <AnnouncementReceiptReport announcements={data.announcement_receipts} cohorts={data.cohorts} />}
      <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="teacher-submissions-title"><div className="flex items-center gap-2"><ClipboardCheck size={17} className="text-cyan-200" aria-hidden="true" /><h3 id="teacher-submissions-title" className="font-semibold text-white">Entregas para corrigir</h3></div>{data.submissions.length ? <ul className="mt-4 grid gap-3 md:grid-cols-2">{data.submissions.map((submission) => <li key={`${submission.id}:${submission.revision}`} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-[#dee4ea]">{submission.assessment_title}</p><p className="mt-1 text-xs text-[#9fadbc]">{studentNames.get(submission.learner_user_id) || "Estudante"} · versão {submission.version || 1}</p>{!!submission.group_member_names?.length && <p className="mt-1 text-[11px] text-cyan-100">Entrega em grupo · {submission.group_member_names.join(", ")}</p>}</div><span className="rounded-full bg-amber-200/10 px-2.5 py-1 text-[11px] text-amber-100">{submission.late ? "Atrasada" : submission.state}</span></div>{submission.answer && <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[#9fadbc]">{submission.answer}</p>}{!!submission.files?.length && <ul aria-label="Anexos da entrega" className="mt-3 flex flex-wrap gap-2">{submission.files.map((file) => <li key={file.id}><button type="button" onClick={() => downloadAttachment(submission, file)} disabled={Boolean(downloading)} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/5 disabled:opacity-50">{downloading === file.id ? "Baixando…" : `Baixar ${file.file_name}`}</button></li>)}</ul>}<SubmissionGradeForm submission={submission} onSaved={load} /></li>)}</ul> : <p className="mt-3 text-sm text-[#9fadbc]">Nenhuma entrega aguardando correção.</p>}</section>
      {data.assessment_attempts.length > 0 && <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="assessment-attempts-title"><div className="flex items-center gap-2"><ClipboardCheck size={17} className="text-cyan-200" aria-hidden="true" /><h3 id="assessment-attempts-title" className="font-semibold text-white">Questões discursivas para corrigir</h3></div><ul className="mt-4 grid gap-3 md:grid-cols-2">{data.assessment_attempts.map((attempt) => <li key={attempt.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><p className="text-sm font-medium text-[#dee4ea]">{attempt.assessment_title}</p><p className="mt-1 text-xs text-[#9fadbc]">{attempt.learner_name} · enviada em {dateLabel(attempt.submitted_at)}</p>{attempt.answers.map((answer) => <div key={answer.question_id} className="mt-4 border-t border-white/[0.08] pt-3"><p className="text-xs font-medium text-cyan-100">{answer.prompt} · máximo {answer.points} {answer.points === 1 ? "ponto" : "pontos"}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{answer.answer}</p></div>)}<AssessmentAttemptGradeForm attempt={attempt} onSaved={load} /></li>)}</ul></section>}
      {data.pending_practices.length > 0 && <PendingPracticesReview records={data.pending_practices} onSaved={load} />}
      {data.pending_documents.length > 0 && <PendingDocumentsReview documents={data.pending_documents} onSaved={load} />}
      {data.pending_justifications.length > 0 && <PendingAttendanceJustifications records={data.pending_justifications} onSaved={load} />}
      {data.pending_makeup_fees.length > 0 && <PendingMakeupFees records={data.pending_makeup_fees} onSaved={load} />}
    </div>
    <div className="mt-4 flex flex-wrap gap-3"><Link href="/extensions/suinda-learning?kind=session" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#3b4754] px-4 text-xs font-medium text-[#b6c2cf] transition hover:border-cyan-200/30 hover:text-cyan-100">Gerenciar encontros <ArrowRight size={13} aria-hidden="true" /></Link><Link href="/extensions/suinda-learning?kind=attendance" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#3b4754] px-4 text-xs font-medium text-[#b6c2cf] transition hover:border-cyan-200/30 hover:text-cyan-100">Gerenciar frequência <ArrowRight size={13} aria-hidden="true" /></Link><Link href="/extensions/suinda-learning?kind=submission" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#3b4754] px-4 text-xs font-medium text-[#b6c2cf] transition hover:border-cyan-200/30 hover:text-cyan-100">Gerenciar entregas <ArrowRight size={13} aria-hidden="true" /></Link></div>
  </div></section>;
}

type CommunityReport = { id: string; revision: number; state: string; course_title: string; target_id: string; target_kind: string; target_title: string; target_state: string; target_body: string; reporter_name: string; reason: string; details: string | null; created_at: string };
function CommunityModerationPanel() {
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    api<CommunityReport[]>("/extensions/suinda-learning/me/teaching/community-reports")
      .then(setReports).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar as denúncias."));
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function decide(report: CommunityReport, action: "dismiss" | "remove") {
    setBusy(report.id); setError("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/community-reports/${encodeURIComponent(report.id)}/${action}`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: report.revision,
          reason: action === "remove" ? "Conteúdo removido após análise docente" : "Denúncia analisada e descartada" }),
      });
      load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível aplicar a decisão."); }
    finally { setBusy(""); }
  }
  return <section className="mt-5 rounded-2xl border border-amber-200/15 bg-[#2c333a] p-5 sm:p-6" aria-labelledby="community-moderation-title">
    <div className="flex items-center gap-2"><Flag size={17} className="text-amber-100" aria-hidden="true" /><h3 id="community-moderation-title" className="font-semibold text-white">Moderação da comunidade</h3></div>
    <p className="mt-1 text-xs text-[#9fadbc]">Denúncias dos cursos e turmas atribuídos a você.</p>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    {!error && reports.length === 0 ? <p className="mt-3 text-sm text-[#9fadbc]">Nenhuma denúncia pendente.</p> : <ul className="mt-3 divide-y divide-white/[0.07]">{reports.map((report) => <li key={report.id} className="py-3 first:pt-0 last:pb-0"><p className="text-xs font-medium text-amber-100">{report.course_title} · {report.target_kind === "discussion_reply" ? "Resposta" : "Tópico"} · {report.reason}</p><p className="mt-1 text-[11px] text-[#9fadbc]">Denunciado por {report.reporter_name} · {dateLabel(report.created_at)}</p><p className="mt-2 text-sm font-medium text-[#b6c2cf]">{report.target_title}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{report.target_body}</p>{report.details && <p className="mt-2 rounded-lg bg-white/[0.03] p-2 text-xs text-[#9fadbc]">Detalhes: {report.details}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy === report.id} onClick={() => void decide(report, "dismiss")} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf] disabled:opacity-50">Descartar denúncia</button><button type="button" disabled={busy === report.id} onClick={() => void decide(report, "remove")} className="min-h-9 rounded-lg border border-rose-200/20 px-3 text-xs text-rose-100 disabled:opacity-50">Ocultar conteúdo</button></div></li>)}</ul>}
  </section>;
}

type PinningThread = { id: string; revision: number; title: string; state: string; created_at: string; pinned: boolean; course_revision: number; thread_type: string; body: string };
function CommunityPinningPanel({ courses }: { courses: TeachingData["courses"] }) {
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const courseId = courses.some((course) => course.id === selectedCourseId) ? selectedCourseId : courses[0]?.id || "";
  const [threads, setThreads] = useState<PinningThread[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    if (!courseId) return;
    api<PinningThread[]>(`/extensions/suinda-learning/me/teaching/courses/${encodeURIComponent(courseId)}/community`)
      .then(setThreads).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar os tópicos."));
  }, [courseId]);
  useEffect(() => { void load(); }, [load]);
  async function toggle(thread: PinningThread) {
    setBusy(thread.id); setError("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/community/threads/${encodeURIComponent(thread.id)}/${thread.pinned ? "unpin" : "pin"}`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      });
      load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a pinagem."); }
    finally { setBusy(""); }
  }
  return <section className="mt-5 rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-5 sm:p-6" aria-labelledby="community-pinning-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><Pin size={17} className="text-cyan-100" aria-hidden="true" /><h3 id="community-pinning-title" className="font-semibold text-white">Tópicos fixados</h3></div><p className="mt-1 text-xs text-[#9fadbc]">Destaque tópicos para todos os participantes do curso.</p></div><label className="text-xs text-[#9fadbc]">Curso<select value={courseId} onChange={(event) => setSelectedCourseId(event.target.value)} className="ml-2 min-h-9 max-w-64 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-[#b6c2cf]">{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label></div>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    {!error && threads.length === 0 ? <p className="mt-3 text-sm text-[#9fadbc]">Este curso ainda não tem tópicos abertos.</p> : <ul className="mt-3 divide-y divide-white/[0.07]">{threads.map((thread) => <li key={thread.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-[#dee4ea]">{thread.title} {thread.pinned && <span className="ml-1 text-[10px] font-semibold uppercase text-cyan-100">Fixado</span>}</p><p className="mt-1 text-xs text-[#9fadbc]">Edição {thread.course_revision} · {thread.thread_type === "question" ? "Pergunta" : "Discussão"} · {dateLabel(thread.created_at)}</p><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{thread.body}</p></div><button type="button" disabled={busy === thread.id} onClick={() => void toggle(thread)} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 disabled:opacity-50">{busy === thread.id ? "Salvando…" : thread.pinned ? "Desafixar" : "Fixar"}</button></li>)}</ul>}
  </section>;
}

function EnrollmentTransferForm({ learner, cohorts, onSaved }: {
  learner: TeachingData["roster"][number];
  cohorts: TeachingData["cohorts"];
  onSaved: () => void;
}) {
  const [target, setTarget] = useState(cohorts[0]?.id || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!["approved", "enrolled", "active", "paused"].includes(learner.state)) return null;
  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !target || !reason.trim()) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/enrollments/${encodeURIComponent(learner.id)}/transfer`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: learner.revision, target_cohort_id: target, reason: reason.trim() }),
      });
      setMessage("Transferência registrada no histórico da matrícula.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível transferir a matrícula."); }
    finally { setSaving(false); }
  }
  return <details className="w-full basis-full rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><summary className="cursor-pointer text-xs font-medium text-cyan-100">Transferir para outra turma</summary><form onSubmit={transfer} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><label className="sr-only" htmlFor={`transfer-target-${learner.id}`}>Turma de destino</label><select id={`transfer-target-${learner.id}`} value={target} onChange={(event) => setTarget(event.target.value)} className="min-h-9 rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 text-xs text-[#dee4ea]">{cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.title}</option>)}</select><label className="sr-only" htmlFor={`transfer-reason-${learner.id}`}>Motivo da transferência</label><input id={`transfer-reason-${learner.id}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} required placeholder="Motivo da transferência" className="min-h-9 rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 text-xs text-[#dee4ea] placeholder:text-[#9fadbc]" /><button type="submit" disabled={saving || !target || !reason.trim()} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{saving ? "Salvando…" : "Confirmar"}</button></form>{message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</details>;
}

function EnrollmentCsvImport({ cohorts, onSaved }: { cohorts: TeachingData["cohorts"]; onSaved: () => void }) {
  const [cohortId, setCohortId] = useState(cohorts[0]?.id || "");
  const [fileData, setFileData] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<EnrollmentCsvPreview | null>(null);
  const [result, setResult] = useState<EnrollmentCsvResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!cohorts.length) return null;
  async function selectFile(file?: File) {
    setError(""); setPreview(null); setResult(null);
    if (!file) { setFileData(""); setFileName(""); return; }
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    if ((!isCsv && !file.name.toLowerCase().endsWith(".xlsx")) || file.size > (isCsv ? 1_000_000 : 2_000_000)) {
      setError(isCsv ? "O CSV não pode exceder 1 MB." : "Selecione um CSV de até 1 MB ou XLSX de até 2 MB."); setFileData(""); setFileName(""); return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      setFileData(btoa(binary)); setFileName(file.name);
    } catch { setError("Não foi possível ler o arquivo selecionado."); setFileData(""); }
  }
  async function prepare() {
    if (!cohortId || !fileData || busy) return;
    setBusy(true); setError(""); setPreview(null); setResult(null);
    try { setPreview(await api<EnrollmentCsvPreview>(`/extensions/suinda-learning/me/teaching/cohorts/${encodeURIComponent(cohortId)}/import/preview`, { method: "POST", body: JSON.stringify({ file_name: fileName, data_base64: fileData }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível validar a lista."); }
    finally { setBusy(false); }
  }
  async function importRows() {
    if (!preview || preview.ready_count === 0 || busy) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const imported = await api<EnrollmentCsvResult>(`/extensions/suinda-learning/me/teaching/cohorts/${encodeURIComponent(cohortId)}/import`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), file_name: fileName, data_base64: fileData }),
      });
      setResult(imported); setPreview(null); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível importar as matrículas."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="csv-import-title"><h3 id="csv-import-title" className="font-semibold text-white">Importar alunos por planilha</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Use `email` e, para contas novas, `name` ou `nome` com o nome do aluno. CSV até 1 MB ou XLSX até 2 MB; o Suindá confere duplicidade e vagas antes de confirmar. Alunos convidados definem a senha, confirmam o e-mail e aceitam os termos antes de entrar.</p><div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><label className="block text-xs text-[#b6c2cf]">Turma<select value={cohortId} onChange={(event) => { setCohortId(event.target.value); setPreview(null); setResult(null); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]">{cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.title}</option>)}</select></label><label className="block text-xs text-[#b6c2cf]">Arquivo CSV ou XLSX<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectFile(event.target.files?.[0])} className="mt-1 block min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 py-2 text-xs text-[#b6c2cf] file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white" />{fileName && <span className="mt-1 block text-[11px] text-[#9fadbc]">{fileName}</span>}</label><button type="button" onClick={prepare} disabled={busy || !fileData || !cohortId} className="min-h-10 self-end rounded-lg border border-cyan-200/25 px-4 text-xs font-semibold text-cyan-100 disabled:opacity-50">{busy ? "Validando…" : "Conferir arquivo"}</button></div>
    {preview && <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium text-white">Prévia para {preview.cohort.title}</p><p className="text-xs text-[#9fadbc]">{preview.ready_count} aptos · {preview.error_count} com erro{preview.cohort.seats_remaining !== null ? ` · ${preview.cohort.seats_remaining} vagas agora` : ""}</p></div>{preview.cohort.payment_required && <p className="mt-2 rounded-lg border border-amber-200/15 bg-amber-200/[0.04] p-3 text-xs leading-5 text-amber-100">Curso pago: o saldo da turma será reservado, mas cada matrícula ficará com pagamento pendente e sem acesso às aulas até a coordenação registrar as baixas. Valor do curso: {money(preview.cohort.course_price, preview.cohort.currency)}.</p>}<ul tabIndex={0} aria-label="Linhas da prévia de importação" className="mt-3 max-h-52 divide-y divide-white/[0.06] overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">{preview.rows.map((row) => <li key={`${row.line}-${row.email}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-xs"><span className="text-[#b6c2cf]">Linha {row.line} · {row.name ? `${row.name} · ` : ""}{row.email || "e-mail vazio"}</span><span className={row.status === "ready" ? "text-emerald-200" : "text-rose-200"}>{row.message}</span></li>)}</ul><button type="button" onClick={importRows} disabled={busy || preview.ready_count === 0} className="mt-3 min-h-10 rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy ? "Importando…" : `Matricular/convidar ${preview.ready_count} aluno(s)`}</button></div>}
    {result && <div className="mt-4 rounded-xl border border-emerald-200/10 bg-emerald-200/[0.04] p-3"><p role="status" className="text-sm font-medium text-emerald-100">{result.created_count} matrícula(s) direta(s), {result.invited_count} convite(s) e {result.invitation_sent_count} e-mail(s) enviados; {result.error_count} linha(s) com erro.</p><ul tabIndex={0} aria-label="Resultados da importação" className="mt-2 max-h-44 divide-y divide-white/[0.06] overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">{result.rows.map((row) => <li key={`${row.line}-${row.email}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-xs"><span className="text-[#b6c2cf]">Linha {row.line} · {row.email || "e-mail vazio"}</span><span className={row.status === "created" ? "text-emerald-200" : row.status === "invited" ? row.email_sent === false ? "text-amber-200" : "text-cyan-100" : "text-rose-200"}>{row.message}</span></li>)}</ul></div>}
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
  </section>;
}

function AnnouncementComposer({ cohorts }: { cohorts: TeachingData["cohorts"] }) {
  const [cohortId, setCohortId] = useState(cohorts[0]?.id || "");
  const [templates, setTemplates] = useState<Array<{ id: string; revision: number; name: string; title: string; body: string }>>([]);
  const [templateId, setTemplateId] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<"internal" | "email" | "whatsapp">("internal");
  const [scheduledAt, setScheduledAt] = useState("");
  const [requiresReadConfirmation, setRequiresReadConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!cohortId) return () => { active = false; };
    api<{ templates: Array<{ id: string; revision: number; name: string; title: string; body: string }> }>(
      `/extensions/suinda-learning/me/teaching/cohorts/${encodeURIComponent(cohortId)}/announcement-templates`,
    ).then((result) => { if (active) setTemplates(result.templates); })
      .catch((cause: unknown) => { if (active) setTemplatesError(cause instanceof Error ? cause.message : "Não foi possível carregar os modelos."); })
      .finally(() => { if (active) setTemplatesLoading(false); });
    return () => { active = false; };
  }, [cohortId]);
  if (!cohorts.length) return null;
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !cohortId || (!templateId && (!title.trim() || !body.trim()))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ delivery?: { recipient_count: number; sent_count: number; failed_count: number; unavailable?: boolean } }>(`/extensions/suinda-learning/me/teaching/cohorts/${encodeURIComponent(cohortId)}/announcements`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), channel,
          ...(templateId ? { template_record_id: templateId } : { title: title.trim(), body: body.trim() }),
          requires_read_confirmation: channel === "internal" && requiresReadConfirmation,
          ...(scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}) }),
      });
      setTitle(""); setBody(""); setTemplateId(""); setRequiresReadConfirmation(false);
      setMessage(channel === "email"
        ? scheduledAt
          ? `Envio por e-mail agendado para ${new Date(scheduledAt).toLocaleString("pt-BR")}. A entrega depende de cada aluno ter e-mail confirmado e notificações por e-mail ativadas no Orbit.`
          : "Envio por e-mail solicitado. A entrega depende de cada aluno ter e-mail confirmado e notificações por e-mail ativadas no Orbit."
        : channel === "whatsapp"
          ? scheduledAt
            ? `Comunicado WhatsApp agendado para ${new Date(scheduledAt).toLocaleString("pt-BR")}. Só será entregue a alunos com consentimento ativo para comunicados e notificações ativadas.`
            : result.delivery?.unavailable
              ? "O plugin WhatsApp deixou de estar disponível; consulte a gestão antes de reenviar."
              : result.delivery
                ? `WhatsApp: ${result.delivery.sent_count} de ${result.delivery.recipient_count} mensagens aceitas pelo provedor${result.delivery.failed_count ? `; ${result.delivery.failed_count} falharam` : ""}. Só são selecionados alunos com consentimento ativo para comunicados e notificações ativadas.`
                : "Comunicado enviado; consulte o registro de entregas do WhatsApp."
        : scheduledAt
          ? `Comunicado agendado para ${new Date(scheduledAt).toLocaleString("pt-BR")}.`
          : "Comunicado enviado. Os alunos verão o aviso no painel Suindá.");
      setScheduledAt("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar o comunicado."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="announcement-composer-title">
    <h3 id="announcement-composer-title" className="font-semibold text-white">Comunicado para a turma</h3>
    <p className="mt-1 text-xs leading-5 text-[#9fadbc]">Escolha como o comunicado será enviado. O envio ou agendamento fica registrado no histórico e na auditoria.</p>
    <form onSubmit={send} className="mt-4 grid gap-3">
      <label className="block text-xs text-[#b6c2cf]">Turma<select value={cohortId} onChange={(event) => { setCohortId(event.target.value); setTemplateId(""); setTemplates([]); setTemplatesError(""); setTemplatesLoading(true); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]">{cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.title}</option>)}</select></label>
      <label className="block text-xs text-[#b6c2cf]">Modelo reutilizável<select value={templateId} disabled={templatesLoading || busy} onChange={(event) => {
        const selected = templates.find((template) => template.id === event.target.value);
        setTemplateId(selected?.id || ""); setTitle(selected?.title || ""); setBody(selected?.body || "");
      }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]"><option value="">Escrever comunicado do zero</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · rev. {template.revision}</option>)}</select>
        <span className="mt-1 block text-[11px] text-[#9fadbc]">{templatesLoading ? "Carregando modelos publicados…" : templateId ? "O conteúdo será enviado conforme a revisão publicada do modelo." : "Modelos publicados no workspace podem ser reaproveitados nesta turma."}</span>
      </label>
      {templatesError && <p role="status" className="text-xs text-amber-200">{templatesError} Você ainda pode escrever o comunicado manualmente.</p>}
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-1 text-xs text-[#b6c2cf]">Canal de envio</legend>
        <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${channel === "internal" ? "border-cyan-200/40 bg-cyan-200/[0.06] text-[#dee4ea]" : "border-[#3b4754] text-[#b6c2cf]"}`}>
          <input type="radio" name="announcement-channel" value="internal" checked={channel === "internal"} onChange={() => setChannel("internal")} className="mt-0.5 accent-cyan-200" />
          <span><span className="block font-medium">Aviso no Suindá</span><span className="mt-1 block leading-5 text-[#9fadbc]">Aparece no painel dos alunos matriculados.</span></span>
        </label>
        <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${channel === "email" ? "border-cyan-200/40 bg-cyan-200/[0.06] text-[#dee4ea]" : "border-[#3b4754] text-[#b6c2cf]"}`}>
          <input type="radio" name="announcement-channel" value="email" checked={channel === "email"} onChange={() => setChannel("email")} className="mt-0.5 accent-cyan-200" />
          <span><span className="block font-medium">E-mail</span><span className="mt-1 block leading-5 text-[#9fadbc]">A entrega requer e-mail confirmado e notificações por e-mail ativadas no Orbit pelo aluno.</span></span>
        </label>
        <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${channel === "whatsapp" ? "border-cyan-200/40 bg-cyan-200/[0.06] text-[#dee4ea]" : "border-[#3b4754] text-[#b6c2cf]"}`}>
          <input type="radio" name="announcement-channel" value="whatsapp" checked={channel === "whatsapp"} onChange={() => setChannel("whatsapp")} className="mt-0.5 accent-cyan-200" />
          <span><span className="block font-medium">WhatsApp</span><span className="mt-1 block leading-5 text-[#9fadbc]">Requer plugin ativado, template aprovado e consentimento ativo para comunicados.</span></span>
        </label>
      </fieldset>
      <label className="block text-xs text-[#b6c2cf]">Título<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} required={!templateId} disabled={Boolean(templateId)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] disabled:opacity-70" /></label>
      <label className="block text-xs text-[#b6c2cf]">Mensagem<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={12000} required={!templateId} rows={4} disabled={Boolean(templateId)} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-[#dee4ea] disabled:opacity-70" /></label>
      <label className="block text-xs text-[#b6c2cf]">Agendar envio (opcional)<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]" /><span className="mt-1 block text-[11px] text-[#9fadbc]">O comunicado será publicado automaticamente nesse horário, se a turma ainda estiver aberta.</span></label>
      {channel === "internal" && <label className="flex items-center gap-2 text-xs text-[#b6c2cf]"><input type="checkbox" checked={requiresReadConfirmation} onChange={(event) => setRequiresReadConfirmation(event.target.checked)} className="size-4 accent-cyan-200" />Solicitar confirmação de leitura</label>}
      <button type="submit" disabled={busy || (!templateId && (!title.trim() || !body.trim()))} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy ? "Salvando…" : scheduledAt ? "Agendar comunicado" : channel === "email" ? "Enviar por e-mail" : channel === "whatsapp" ? "Enviar por WhatsApp" : "Enviar comunicado"}</button>
    </form>
    {message && <p role="status" className="mt-3 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
  </section>;
}

function AnnouncementReceiptReport({ announcements, cohorts }: { announcements: TeachingData["announcement_receipts"]; cohorts: TeachingData["cohorts"] }) {
  const cohortNames = new Map(cohorts.map((cohort) => [cohort.id, cohort.title]));
  return <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="announcement-receipts-title"><h3 id="announcement-receipts-title" className="font-semibold text-white">Confirmações de leitura</h3><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Acompanhe os recibos dos comunicados enviados às suas turmas.</p><ul className="mt-4 grid gap-3 md:grid-cols-2">{announcements.map((announcement) => { const confirmed = announcement.learners.filter((learner) => learner.read_at).length; return <li key={announcement.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium text-[#dee4ea]">{announcement.title}</p><p className="mt-1 text-xs text-[#9fadbc]">{cohortNames.get(announcement.cohort_record_id) || "Turma"} · enviado {dateLabel(announcement.sent_at)}</p></div><span className="rounded-full bg-cyan-200/10 px-2.5 py-1 text-[11px] text-cyan-100">{confirmed}/{announcement.learners.length} lidos</span></div><ul tabIndex={0} aria-label={`Confirmações de leitura de ${announcement.title}`} className="mt-3 max-h-44 divide-y divide-white/[0.06] overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">{announcement.learners.map((learner) => <li key={learner.enrollment_id} className="flex justify-between gap-3 py-2 text-xs"><span className="text-[#b6c2cf]">{learner.learner_name}</span><span className={learner.read_at ? "text-emerald-200" : "text-amber-200"}>{learner.read_at ? `Lido ${dateLabel(learner.read_at) || ""}` : "Pendente"}</span></li>)}</ul></li>; })}</ul></section>;
}

function PendingDocumentsReview({ documents, onSaved }: { documents: TeachingData["pending_documents"]; onSaved: () => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function download(record: TeachingData["pending_documents"][number], file: TeachingData["pending_documents"][number]["files"][number]) {
    setBusy(file.id); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/records/${encodeURIComponent(record.id)}/attachments/${file.revision}/${encodeURIComponent(file.id)}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o documento."); }
    finally { setBusy(""); }
  }
  async function review(record: TeachingData["pending_documents"][number], decision: "approved" | "rejected") {
    const reviewNotes = notes[record.id]?.trim() || "";
    if (decision === "rejected" && !reviewNotes) { setError("Descreva o que o aluno precisa atualizar antes de devolver o documento."); return; }
    setBusy(record.id); setError("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/documents/${encodeURIComponent(record.id)}/review`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: record.revision, decision, review_notes: reviewNotes || undefined }),
      });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível revisar o documento."); }
    finally { setBusy(""); }
  }
  return <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="pending-documents-title"><h3 id="pending-documents-title" className="font-semibold text-white">Documentos acadêmicos para revisar</h3><p className="mt-1 text-xs text-[#9fadbc]">A lista aparece somente para a coordenação com permissão de gestão acadêmica.</p><ul className="mt-4 grid gap-3 md:grid-cols-2">{documents.map((record) => <li key={record.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><p className="text-sm font-medium text-[#dee4ea]">{record.title}</p><p className="mt-1 text-xs text-[#9fadbc]">{record.learner_name} · {record.course_title} · {record.category}{record.expires_at ? ` · validade ${dateLabel(record.expires_at)}` : ""}</p>{record.description && <p className="mt-2 text-xs leading-5 text-[#9fadbc]">{record.description}</p>}<ul className="mt-3 flex flex-wrap gap-2">{record.files.map((file) => <li key={file.id}><button type="button" onClick={() => void download(record, file)} disabled={Boolean(busy)} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/5 disabled:opacity-50">{busy === file.id ? "Baixando…" : `Baixar ${file.file_name}`}</button></li>)}</ul><label className="mt-3 block text-xs text-[#b6c2cf]">Orientação ao aluno<textarea value={notes[record.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-[#dee4ea]" /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void review(record, "approved")} disabled={Boolean(busy)} className="min-h-9 rounded-lg bg-emerald-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">Aprovar</button><button type="button" onClick={() => void review(record, "rejected")} disabled={Boolean(busy) || !(notes[record.id] || "").trim()} className="min-h-9 rounded-lg border border-rose-200/20 px-3 text-xs font-semibold text-rose-100 disabled:opacity-50">Solicitar atualização</button></div></li>)}</ul>{error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}</section>;
}

function PendingMakeupFees({ records, onSaved }: { records: TeachingData["pending_makeup_fees"]; onSaved: () => void }) {
  const [mode, setMode] = useState<Record<string, "payment" | "waiver">>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  async function submit(record: TeachingData["pending_makeup_fees"][number]) {
    const entryType = mode[record.id] || "payment";
    setBusy(record.id); setError("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/makeup-requests/${encodeURIComponent(record.id)}/fee`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: record.revision,
          entry_type: entryType, ...(entryType === "payment" ? { amount: Number(amounts[record.id] || record.amount_due), payment_method: methods[record.id] || "pix" } : {}),
          notes: notes[record.id] || null }),
      });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível registrar a taxa."); }
    finally { setBusy(""); }
  }
  return <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="makeup-fees-title">
    <h3 id="makeup-fees-title" className="font-semibold text-white">Taxas de reposição pendentes</h3>
    <p className="mt-1 text-xs text-[#9fadbc]">Registre pagamentos recebidos ou uma isenção administrativa com justificativa. Cada baixa fica no histórico financeiro.</p>
    <ul className="mt-4 grid gap-3 md:grid-cols-2">{records.map((record) => { const entryType = mode[record.id] || "payment"; return <li key={record.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <p className="text-sm font-medium text-[#dee4ea]">{record.learner_name} · {record.session_title}</p><p className="mt-1 text-xs text-[#9fadbc]">{record.course_title} · saldo {money(record.amount_due, record.currency)}</p>
      <label className="mt-3 block text-xs text-[#b6c2cf]">Operação<select value={entryType} onChange={(event) => setMode((current) => ({ ...current, [record.id]: event.target.value as "payment" | "waiver" }))} className="mt-1 min-h-9 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]"><option value="payment">Registrar pagamento</option><option value="waiver">Conceder isenção</option></select></label>
      {entryType === "payment" && <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs text-[#b6c2cf]">Valor<input type="number" min="0.01" max={record.amount_due} step="0.01" value={amounts[record.id] ?? String(record.amount_due)} onChange={(event) => setAmounts((current) => ({ ...current, [record.id]: event.target.value }))} className="mt-1 min-h-9 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]" /></label><label className="text-xs text-[#b6c2cf]">Forma<select value={methods[record.id] || "pix"} onChange={(event) => setMethods((current) => ({ ...current, [record.id]: event.target.value }))} className="mt-1 min-h-9 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 text-sm text-[#dee4ea]"><option value="pix">Pix</option><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="card_external">Cartão externo</option><option value="boleto">Boleto</option><option value="other">Outro</option></select></label></div>}
      <label className="mt-2 block text-xs text-[#b6c2cf]">{entryType === "waiver" ? "Motivo obrigatório da isenção" : "Referência ou observação"}<textarea value={notes[record.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-[#dee4ea]" /></label>
      <button type="button" onClick={() => void submit(record)} disabled={Boolean(busy) || entryType === "waiver" && !(notes[record.id] || "").trim()} className="mt-3 min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy === record.id ? "Registrando…" : entryType === "waiver" ? "Registrar isenção" : "Registrar pagamento"}</button>
    </li>; })}</ul>{error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
  </section>;
}

function PendingAttendanceJustifications({ records, onSaved }: { records: TeachingData["pending_justifications"]; onSaved: () => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function download(record: TeachingData["pending_justifications"][number], file: TeachingData["pending_justifications"][number]["files"][number]) {
    setBusy(file.id); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/records/${encodeURIComponent(record.id)}/attachments/${file.revision}/${encodeURIComponent(file.id)}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o comprovante."); }
    finally { setBusy(""); }
  }
  async function review(record: TeachingData["pending_justifications"][number], decision: "approved" | "rejected") {
    const reviewNotes = notes[record.id]?.trim() || "";
    if (decision === "rejected" && !reviewNotes) { setError("Informe ao aluno o que deve ser corrigido."); return; }
    setBusy(record.id); setError("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/attendance-justifications/${encodeURIComponent(record.id)}/review`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: record.revision, decision, review_notes: reviewNotes || undefined }),
      });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível revisar a justificativa."); }
    finally { setBusy(""); }
  }
  return <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="attendance-justifications-title"><h3 id="attendance-justifications-title" className="flex items-center gap-2 font-semibold text-white"><FileCheck2 size={17} className="text-cyan-200" aria-hidden="true" /> Justificativas de falta para analisar</h3><p className="mt-1 text-xs text-[#9fadbc]">A aprovação registra a falta justificada na chamada e associa o comprovante ao histórico.</p><ul className="mt-4 grid gap-3 md:grid-cols-2">{records.map((record) => <li key={record.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><p className="text-sm font-medium text-[#dee4ea]">{record.learner_name} · {record.session_title}</p><p className="mt-1 text-xs text-[#9fadbc]">{record.course_title}</p><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{record.reason}</p><ul className="mt-3 flex flex-wrap gap-2">{record.files.map((file) => <li key={file.id}><button type="button" onClick={() => void download(record, file)} disabled={Boolean(busy)} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/5 disabled:opacity-50">{busy === file.id ? "Baixando…" : `Baixar ${file.file_name}`}</button></li>)}</ul><label className="mt-3 block text-xs text-[#b6c2cf]">Observação ao aluno<textarea value={notes[record.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-[#dee4ea]" /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void review(record, "approved")} disabled={Boolean(busy)} className="min-h-9 rounded-lg bg-emerald-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">Aprovar e justificar falta</button><button type="button" onClick={() => void review(record, "rejected")} disabled={Boolean(busy) || !(notes[record.id] || "").trim()} className="min-h-9 rounded-lg border border-rose-200/20 px-3 text-xs font-semibold text-rose-100 disabled:opacity-50">Devolver ao aluno</button></div></li>)}</ul>{error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}</section>;
}

function PendingPracticesReview({ records, onSaved }: { records: TeachingData["pending_practices"]; onSaved: () => void }) {
  const [hours, setHours] = useState<Record<string, string>>(() => Object.fromEntries(records.map((record) => [record.id, String(record.hours_claimed || 0)])));
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function review(record: TeachingData["pending_practices"][number], decision: "approved" | "rejected") {
    if (busy) return;
    setBusy(record.id); setError("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/practices/${encodeURIComponent(record.id)}/review`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: record.revision, decision,
          hours_validated: decision === "approved" ? Number(hours[record.id]) : 0, feedback: feedback[record.id]?.trim() || undefined }),
      });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível revisar a prática."); }
    finally { setBusy(""); }
  }
  return <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 xl:col-span-2" aria-labelledby="pending-practices-title"><h3 id="pending-practices-title" className="flex items-center gap-2 font-semibold text-white"><ClipboardCheck size={17} className="text-cyan-200" aria-hidden="true" /> Práticas supervisionadas para validar</h3><ul className="mt-4 grid gap-3 md:grid-cols-2">{records.map((record) => <li key={record.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><p className="text-sm font-medium text-[#dee4ea]">{record.learner_name} · {record.title}</p><p className="mt-1 text-xs text-[#9fadbc]">{record.course_title}{record.scheduled_at ? ` · ${dateLabel(record.scheduled_at)}` : ""}{record.location ? ` · ${record.location}` : ""}</p><p className="mt-3 text-xs font-medium text-cyan-100">Atividade prevista</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{record.activity_description}</p>{record.completion_notes && <><p className="mt-3 text-xs font-medium text-cyan-100">Relato do aluno · {record.hours_claimed} h declaradas</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{record.completion_notes}</p></>}<div className="mt-3 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]"><label className="flex items-center gap-2 rounded-lg border border-[#3b4754] px-2 text-[11px] text-[#9fadbc]">Validar horas<input type="number" min={0} max={record.hours_claimed || 10000} step="0.25" value={hours[record.id] || "0"} onChange={(event) => setHours((current) => ({ ...current, [record.id]: event.target.value }))} className="w-full bg-transparent text-sm text-[#dee4ea] outline-none" /></label><textarea value={feedback[record.id] || ""} onChange={(event) => setFeedback((current) => ({ ...current, [record.id]: event.target.value }))} maxLength={4000} placeholder="Observação ou orientação ao aluno" aria-label="Observação do supervisor" className="min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-xs text-[#dee4ea] placeholder:text-[#9fadbc]" /></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void review(record, "approved")} disabled={Boolean(busy) || hours[record.id] === undefined} className="min-h-9 rounded-lg bg-emerald-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy === record.id ? "Salvando…" : "Validar horas"}</button><button type="button" onClick={() => void review(record, "rejected")} disabled={Boolean(busy) || !(feedback[record.id] || "").trim()} className="min-h-9 rounded-lg border border-rose-200/20 px-3 text-xs font-semibold text-rose-100 disabled:opacity-50">Devolver para correção</button></div></li>)}</ul>{error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}</section>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="min-w-28 rounded-xl border border-[#3b4754] bg-white/[0.03] px-3 py-2"><p className="text-lg font-semibold text-white">{value}</p><p className="text-[11px] text-[#9fadbc]">{label}</p></div>;
}

function AdminOverview({ summary, onSaved }: { summary: NonNullable<TeachingData["admin_summary"]>; onSaved: () => void }) {
  const [upcomingAssessments, setUpcomingAssessments] = useState(summary.upcoming_assessments);
  const [upcomingAssessmentCursor, setUpcomingAssessmentCursor] = useState(summary.upcoming_assessments_next_cursor || null);
  const [expiringDocuments, setExpiringDocuments] = useState(summary.documents_expiring);
  const [expiringDocumentCursor, setExpiringDocumentCursor] = useState(summary.documents_expiring_next_cursor || null);
  const [adminOperationLoading, setAdminOperationLoading] = useState<"assessment" | "document" | null>(null);
  const [adminOperationError, setAdminOperationError] = useState("");
  const [assessmentRiskItems, setAssessmentRiskItems] = useState(summary.assessment_risks);
  const [assessmentRiskCursor, setAssessmentRiskCursor] = useState(summary.assessment_risks_next_cursor || null);
  const [assessmentRiskLoading, setAssessmentRiskLoading] = useState(false);
  const [assessmentRiskError, setAssessmentRiskError] = useState("");
  const [counterpartyItems, setCounterpartyItems] = useState(summary.scholarship_counterparties);
  const [counterpartyCursor, setCounterpartyCursor] = useState(summary.scholarship_counterparties_next_cursor || null);
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);
  const [counterpartyError, setCounterpartyError] = useState("");
  const [refundItems, setRefundItems] = useState(summary.refund_candidates);
  const [refundCursor, setRefundCursor] = useState(summary.refund_candidates_next_cursor || null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [cancellationItems, setCancellationItems] = useState(summary.financial_cancellation_candidates || []);
  const [cancellationCursor, setCancellationCursor] = useState(summary.financial_cancellation_candidates_next_cursor || null);
  const [cancellationLoading, setCancellationLoading] = useState(false);
  const [cancellationError, setCancellationError] = useState("");
  const [pendingPaymentItems, setPendingPaymentItems] = useState(summary.pending_payments);
  const [pendingPaymentCursor, setPendingPaymentCursor] = useState(summary.pending_payments_next_cursor || null);
  const [pendingPaymentLoading, setPendingPaymentLoading] = useState(false);
  const [pendingPaymentError, setPendingPaymentError] = useState("");
  const [capacityItems, setCapacityItems] = useState(summary.near_capacity_cohorts);
  const [capacityCursor, setCapacityCursor] = useState(summary.near_capacity_cohorts_next_cursor || null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacityError, setCapacityError] = useState("");
  async function loadMoreCapacity() {
    if (!capacityCursor || capacityLoading) return;
    setCapacityLoading(true); setCapacityError("");
    try {
      const page = await api<{ items: typeof capacityItems; next_cursor: string | null }>(
        `/extensions/suinda-learning/me/teaching/unit-operations/capacity?cursor=${encodeURIComponent(capacityCursor)}&limit=50`);
      setCapacityItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !existing.has(item.id))];
      });
      setCapacityCursor(page.next_cursor);
    } catch (cause) { setCapacityError(cause instanceof Error ? cause.message : "Não foi possível carregar mais turmas."); }
    finally { setCapacityLoading(false); }
  }
  async function loadMoreAdminOperations(queue: "assessment" | "document") {
    const cursor = queue === "assessment" ? upcomingAssessmentCursor : expiringDocumentCursor;
    if (!cursor || adminOperationLoading) return;
    setAdminOperationLoading(queue); setAdminOperationError("");
    try {
      const query = new URLSearchParams({ queue, cursor, limit: queue === "assessment" ? "50" : "100" });
      const page = await api<{ items: typeof upcomingAssessments | typeof expiringDocuments; next_cursor: string | null }>(
        `/extensions/suinda-learning/me/teaching/admin/operations?${query}`);
      if (queue === "assessment") {
        setUpcomingAssessments((current) => [...current, ...(page.items as typeof upcomingAssessments).filter((item) => !current.some((existing) => existing.id === item.id))]);
        setUpcomingAssessmentCursor(page.next_cursor);
      } else {
        setExpiringDocuments((current) => [...current, ...(page.items as typeof expiringDocuments).filter((item) => !current.some((existing) => existing.id === item.id))]);
        setExpiringDocumentCursor(page.next_cursor);
      }
    } catch (cause) { setAdminOperationError(cause instanceof Error ? cause.message : "Não foi possível carregar mais prazos e documentos."); }
    finally { setAdminOperationLoading(null); }
  }
  const [scholarshipApplications, setScholarshipApplications] = useState(summary.pending_scholarship_applications);
  const [scholarshipApplicationCursor, setScholarshipApplicationCursor] = useState(summary.pending_scholarship_applications_next_cursor || null);
  const [scholarshipApplicationLoading, setScholarshipApplicationLoading] = useState(false);
  const [scholarshipApplicationError, setScholarshipApplicationError] = useState("");
  async function loadMoreAdminAssessmentRisks() {
    if (!assessmentRiskCursor || assessmentRiskLoading) return;
    setAssessmentRiskLoading(true); setAssessmentRiskError("");
    try {
      const query = new URLSearchParams({ cursor: assessmentRiskCursor, limit: "50" });
      const page = await api<{ items: typeof assessmentRiskItems; next_cursor: string | null }>(
        `/extensions/suinda-learning/me/teaching/admin/assessment-risks?${query.toString()}`);
      setAssessmentRiskItems((current) => {
        const existing = new Set(current.map((risk) => `${risk.enrollment_id}:${risk.assessment_id}`));
        return [...current, ...page.items.filter((risk) => !existing.has(`${risk.enrollment_id}:${risk.assessment_id}`))];
      });
      setAssessmentRiskCursor(page.next_cursor);
    } catch (cause) { setAssessmentRiskError(cause instanceof Error ? cause.message : "Não foi possível carregar mais casos."); }
    finally { setAssessmentRiskLoading(false); }
  }
  async function loadMoreScholarshipApplications() {
    if (!scholarshipApplicationCursor || scholarshipApplicationLoading) return;
    setScholarshipApplicationLoading(true); setScholarshipApplicationError("");
    try {
      const query = new URLSearchParams({ cursor: scholarshipApplicationCursor, limit: "50" });
      const page = await api<{ items: typeof scholarshipApplications; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/scholarship-applications?${query}`);
      setScholarshipApplications((current) => { const existing = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !existing.has(item.id))]; });
      setScholarshipApplicationCursor(page.next_cursor);
    } catch (cause) { setScholarshipApplicationError(cause instanceof Error ? cause.message : "Não foi possível carregar mais candidaturas."); }
    finally { setScholarshipApplicationLoading(false); }
  }
  async function loadMoreCounterparties() {
    if (!counterpartyCursor || counterpartyLoading) return;
    setCounterpartyLoading(true);
    setCounterpartyError("");
    try {
      const query = new URLSearchParams({ cursor: counterpartyCursor, limit: "50" });
      const page = await api<{ items: typeof counterpartyItems; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/scholarship-counterparties?${query}`);
      setCounterpartyItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !existing.has(item.id))];
      });
      setCounterpartyCursor(page.next_cursor);
    } catch (cause) {
      setCounterpartyError(cause instanceof Error ? cause.message : "Não foi possível carregar mais contrapartidas.");
    } finally { setCounterpartyLoading(false); }
  }
  async function loadMoreRefunds() {
    if (!refundCursor || refundLoading) return;
    setRefundLoading(true); setRefundError("");
    try {
      const query = new URLSearchParams({ queue: "refund", cursor: refundCursor, limit: "50" });
      const page = await api<{ items: typeof refundItems; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/financial-action-queue?${query}`);
      setRefundItems((current) => { const existing = new Set(current.map((item) => item.payment_entry_id)); return [...current, ...page.items.filter((item) => !existing.has(item.payment_entry_id))]; });
      setRefundCursor(page.next_cursor);
    } catch (cause) { setRefundError(cause instanceof Error ? cause.message : "Não foi possível carregar mais reembolsos."); }
    finally { setRefundLoading(false); }
  }
  async function loadMoreCancellations() {
    if (!cancellationCursor || cancellationLoading) return;
    setCancellationLoading(true); setCancellationError("");
    try {
      const query = new URLSearchParams({ queue: "cancellation", cursor: cancellationCursor, limit: "50" });
      const page = await api<{ items: NonNullable<typeof summary.financial_cancellation_candidates>; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/financial-action-queue?${query}`);
      setCancellationItems((current) => { const existing = new Set(current.map((item) => item.enrollment_id)); return [...current, ...page.items.filter((item) => !existing.has(item.enrollment_id))]; });
      setCancellationCursor(page.next_cursor);
    } catch (cause) { setCancellationError(cause instanceof Error ? cause.message : "Não foi possível carregar mais cancelamentos."); }
    finally { setCancellationLoading(false); }
  }
  async function loadMorePendingPayments() {
    if (!pendingPaymentCursor || pendingPaymentLoading) return;
    setPendingPaymentLoading(true); setPendingPaymentError("");
    try {
      const query = new URLSearchParams({ queue: "payment", cursor: pendingPaymentCursor, limit: "50" });
      const page = await api<{ items: typeof pendingPaymentItems; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/financial-action-queue?${query}`);
      setPendingPaymentItems((current) => { const existing = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !existing.has(item.id))]; });
      setPendingPaymentCursor(page.next_cursor);
    } catch (cause) { setPendingPaymentError(cause instanceof Error ? cause.message : "Não foi possível carregar mais pagamentos pendentes."); }
    finally { setPendingPaymentLoading(false); }
  }
  return <section className="mt-5 rounded-2xl border border-violet-300/20 bg-[#2c333a] p-5 sm:p-6" aria-labelledby="academic-admin-overview-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-violet-200">Coordenação</p><h3 id="academic-admin-overview-title" className="mt-1 text-xl font-semibold text-white">Painel administrativo</h3><p className="mt-1 text-xs text-[#9fadbc]">Visão agregada dos {summary.counts.workspaces} workspaces que você administra.</p></div><div className="flex flex-wrap items-center gap-4"><Link href="/suinda/privacy-management" className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-violet-100 underline underline-offset-4">Solicitações de privacidade <ArrowRight size={13} aria-hidden="true" /></Link><Link href="/suinda/reports" className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-violet-100 underline underline-offset-4">Relatórios acadêmicos <ArrowRight size={13} aria-hidden="true" /></Link><Link href="/suinda?kind=enrollment" className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-violet-100 underline underline-offset-4">Abrir gestão acadêmica <ArrowRight size={13} aria-hidden="true" /></Link></div></div>
    <div className="mt-4 flex flex-wrap gap-2"><Stat label="Inscrições para analisar" value={summary.counts.admissions_to_review} /><Stat label="Matrículas com pagamento pendente" value={summary.counts.payment_followups} /><Stat label="Próximos encontros" value={summary.counts.upcoming_sessions} /><Stat label="Prazos de avaliação" value={summary.counts.upcoming_assessments} /><Stat label="Abaixo do mínimo de frequência" value={summary.counts.attendance_risks} /><Stat label="Reprovações sem tentativas restantes" value={summary.counts.assessment_risks} /><Stat label="Itens para corrigir" value={summary.counts.grading_items} /><Stat label="Documentos pendentes" value={summary.counts.documents_to_review} /><Stat label="Documentos vencendo em 30 dias" value={summary.counts.documents_expiring} /><Stat label="Turmas com 80%+ de ocupação" value={summary.counts.near_capacity_cohorts} /></div>
    <p className="mt-3 rounded-lg border border-violet-200/10 bg-violet-200/[0.03] px-3 py-2 text-xs leading-5 text-[#b6c2cf]">Os indicadores acadêmicos são regras observáveis para apoiar acompanhamento: frequência abaixo do mínimo do curso e reprovação na última tentativa corrigida após esgotar as tentativas. Eles não são uma pontuação nem uma previsão de evasão, e não devem ser usados isoladamente para decisões sobre estudantes. Um modelo preditivo permanece desativado até validação acadêmica e institucional.</p>
    <div className="mt-5 grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-amber-300/15 bg-black/10 p-4 xl:col-span-2" aria-labelledby="admin-assessment-risks-title"><h4 id="admin-assessment-risks-title" className="text-sm font-semibold text-white">Avaliações reprovadas sem tentativas restantes</h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Regra verificável: matrícula ativa, última tentativa corrigida abaixo da nota mínima e limite de tentativas atingido. Tentativas pendentes de correção não entram neste sinal. Ele não representa risco calculado de evasão.</p>{summary.counts.assessment_risks > assessmentRiskItems.length && <p className="mt-2 text-xs text-amber-100" aria-live="polite">Exibindo {assessmentRiskItems.length} de {summary.counts.assessment_risks} casos identificados.</p>}{assessmentRiskItems.length ? <ul className="mt-3 grid gap-2 md:grid-cols-2">{assessmentRiskItems.map((risk) => <li key={`${risk.enrollment_id}:${risk.assessment_id}`} className="rounded-lg border border-amber-200/10 bg-amber-200/[0.03] px-3 py-2"><p className="text-sm font-medium text-[#dee4ea]">{risk.learner_name}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{risk.course_title} · {risk.assessment_title}</p><p className="mt-1 text-xs text-amber-100/80">Nota {risk.score}% · mínimo {risk.passing_score}% · tentativa {risk.attempt_number} de {risk.max_attempts}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma matrícula atende a esses critérios.</p>}{assessmentRiskCursor && <button type="button" onClick={() => void loadMoreAdminAssessmentRisks()} disabled={assessmentRiskLoading} aria-busy={assessmentRiskLoading} className="mt-3 min-h-9 rounded-lg border border-amber-200/20 px-3 text-xs text-amber-100 disabled:opacity-50">{assessmentRiskLoading ? "Carregando…" : `Carregar mais casos (${assessmentRiskItems.length} de ${summary.counts.assessment_risks})`}</button>}{assessmentRiskError && <p role="alert" className="mt-2 text-xs text-rose-200">{assessmentRiskError}</p>}</section>
      <section className="rounded-xl border border-cyan-200/15 bg-black/10 p-4 xl:col-span-2" aria-labelledby="admin-expiring-documents-title"><h4 id="admin-expiring-documents-title" className="text-sm font-semibold text-white">Documentos acadêmicos vencendo <span className="text-[#9fadbc]">({summary.counts.documents_expiring})</span></h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Documentos aprovados de matrículas ativas com vencimento nos próximos 30 dias. A equipe pode orientar a renovação antes de a validade terminar.</p>{expiringDocuments.length ? <ul className="mt-3 grid gap-2 md:grid-cols-2">{expiringDocuments.map((item) => <li key={item.id} className="rounded-lg border border-cyan-200/10 bg-cyan-200/[0.03] px-3 py-2"><p className="text-sm font-medium text-[#dee4ea]">{item.learner_name}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{item.course_title} · {item.title}</p><p className="mt-1 text-xs text-cyan-100/80">Vence em {dateLabel(item.expires_at) || item.expires_at} · {item.category}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum documento aprovado vence nos próximos 30 dias.</p>}{expiringDocumentCursor && <button type="button" onClick={() => void loadMoreAdminOperations("document")} disabled={Boolean(adminOperationLoading)} className="mt-3 min-h-9 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 disabled:opacity-50">{adminOperationLoading === "document" ? "Carregando…" : `Carregar mais documentos (${expiringDocuments.length} de ${summary.counts.documents_expiring})`}</button>}</section>
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4 xl:col-span-2" aria-labelledby="admin-scholarship-applications-title"><h4 id="admin-scholarship-applications-title" className="text-sm font-semibold text-white">Candidaturas a bolsas</h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Confira a documentação, registre a pontuação e decida pela aprovação, lista de espera ou recusa. A aprovação lança o desconto no saldo do curso.</p>{scholarshipApplications.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{scholarshipApplications.map((application) => <li key={application.id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{application.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{application.program_title} · {application.course_title} · bolsa de {application.discount_percent}% · {application.state === "waitlisted" ? `lista de espera ${application.waitlist_position || ""}` : application.state === "under_review" ? "em análise" : "nova"}</p>{application.terms_signature_at && <details className="mt-2 rounded-lg border border-violet-200/10 bg-violet-200/[0.03] p-2"><summary className="cursor-pointer text-xs font-medium text-violet-100">Assinatura eletrônica · {application.terms_signature_name} · {dateLabel(application.terms_signature_at)}</summary><div className="mt-2 space-y-1 break-all font-mono text-[10px] text-[#9fadbc]"><p>Termos {application.terms_version} · SHA-256 do texto: {application.terms_signature_text_sha256}</p><p>SHA-256 da evidência: {application.terms_signature_evidence_sha256}</p></div></details>}{application.document_uploads.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{application.document_uploads.map((file) => <li key={file.attachment_id}><ScholarshipDocumentDownload application={application} file={file} /></li>)}</ul>}<ScholarshipReviewForm application={application} onSaved={onSaved} /></li>)}</ul>{scholarshipApplicationCursor && <button type="button" onClick={() => void loadMoreScholarshipApplications()} disabled={scholarshipApplicationLoading} aria-busy={scholarshipApplicationLoading} className="mt-3 min-h-10 rounded-lg border border-violet-200/20 px-4 text-xs font-medium text-violet-100 disabled:opacity-50">{scholarshipApplicationLoading ? "Carregando…" : "Carregar mais candidaturas"}</button>}{scholarshipApplicationError && <p role="alert" className="mt-2 text-xs text-rose-200">{scholarshipApplicationError}</p>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma candidatura aguardando decisão.</p>}</section>
      <section className="rounded-xl border border-violet-200/15 bg-black/10 p-4 xl:col-span-2" aria-labelledby="admin-counterparties-title"><h4 id="admin-counterparties-title" className="text-sm font-semibold text-white">Contrapartidas de bolsas</h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Revise os relatos e comprovantes vinculados às exigências aceitas pelo estudante no programa.</p>{counterpartyItems.length ? <ul className="mt-3 grid gap-3 lg:grid-cols-2">{counterpartyItems.map((item) => <li key={item.id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{item.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{item.program_title} · {item.course_title} · {item.state === "submitted" ? "aguardando revisão" : item.state === "accepted" ? "aceita" : item.state === "revision_requested" ? "complemento solicitado" : "aguardando envio do estudante"}</p><p className="mt-3 whitespace-pre-wrap rounded-lg border border-violet-200/10 bg-violet-200/[0.03] p-3 text-xs leading-5 text-violet-50">{item.requirement_text}</p>{item.evidence_text && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">Relato: {item.evidence_text}</p>}{item.evidence_files.map((file) => <ScholarshipCounterpartyDownload key={file.attachment_id} item={item} file={file} />)}{item.review_feedback && <p className="mt-2 text-xs text-amber-100">Orientação anterior: {item.review_feedback}</p>}{item.state === "submitted" && <ScholarshipCounterpartyReview item={item} onSaved={onSaved} />}</li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma contrapartida encontrada nas candidaturas aprovadas dos seus workspaces.</p>}
        <p className="mt-3 text-xs text-[#9fadbc]" aria-live="polite">{counterpartyItems.length} contrapartida(s) carregada(s)</p>
        {counterpartyError && <p role="alert" className="mt-2 text-xs text-rose-200">{counterpartyError}</p>}
        {counterpartyCursor && <button type="button" onClick={() => void loadMoreCounterparties()} disabled={counterpartyLoading} className="mt-3 min-h-10 rounded-lg border border-violet-200/20 px-3 text-xs font-medium text-violet-100 hover:bg-violet-200/[0.06] disabled:opacity-50">{counterpartyLoading ? "Carregando contrapartidas…" : "Carregar mais contrapartidas"}</button>}
      </section>
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4 xl:col-span-2" aria-labelledby="admin-payments-title"><h4 id="admin-payments-title" className="text-sm font-semibold text-white">Acompanhamento de pagamentos e inadimplência</h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">A projeção identifica parcelas vencidas pelo calendário e pelos valores já lançados. Registre aqui pagamentos recebidos fora da plataforma; não são geradas cobranças automáticas.</p>{pendingPaymentItems.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{pendingPaymentItems.map((payment) => <li key={payment.id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{payment.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{payment.course_title} · pago + bolsa {money(payment.amount_covered, payment.currency)} de {money(payment.course_price, payment.currency)} · saldo {money(payment.amount_remaining, payment.currency)}</p>{payment.overdue_balance > 0 && <p className="mt-2 rounded-md border border-rose-200/15 bg-rose-200/[0.04] px-2 py-1.5 text-xs text-rose-100">Em atraso: {payment.overdue_installment_count} parcela(s) · {money(payment.overdue_balance, payment.currency)}{payment.oldest_overdue_at ? ` · vencimento mais antigo ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(payment.oldest_overdue_at))}` : ""}</p>}<PaymentSettlementForm payment={payment} onSaved={onSaved} /></li>)}</ul>{pendingPaymentCursor && <button type="button" onClick={() => void loadMorePendingPayments()} disabled={pendingPaymentLoading} aria-busy={pendingPaymentLoading} className="mt-3 min-h-10 rounded-lg border border-cyan-200/20 px-4 text-xs font-medium text-cyan-100 disabled:opacity-50">{pendingPaymentLoading ? "Carregando…" : "Carregar mais pagamentos"}</button>}{pendingPaymentError && <p role="alert" className="mt-2 text-xs text-rose-200">{pendingPaymentError}</p>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma matrícula com saldo pendente.</p>}</section>
      <section className="rounded-xl border border-rose-200/15 bg-black/10 p-4 xl:col-span-2" aria-labelledby="admin-refunds-title"><h4 id="admin-refunds-title" className="text-sm font-semibold text-white">Reembolsos de matrículas canceladas</h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Depois de devolver o valor fora da plataforma, registre o reembolso ligado ao pagamento recebido de qualquer matrícula cancelada ou desistente. O sistema limita o total ao saldo daquele pagamento e mantém o histórico imutável.</p>{refundItems.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{refundItems.map((refund) => <li key={refund.payment_entry_id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{refund.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{refund.course_title} · recebido {money(refund.payment_amount, refund.currency)} · devolvido {money(refund.amount_refunded, refund.currency)} · disponível {money(refund.amount_refundable, refund.currency)}</p><RefundForm refund={refund} onSaved={onSaved} /></li>)}</ul>{refundCursor && <button type="button" onClick={() => void loadMoreRefunds()} disabled={refundLoading} className="mt-3 min-h-10 rounded-lg border border-rose-200/20 px-4 text-xs font-medium text-rose-100 disabled:opacity-50">{refundLoading ? "Carregando…" : "Carregar mais reembolsos"}</button>}{refundError && <p role="alert" className="mt-2 text-xs text-rose-200">{refundError}</p>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum reembolso pendente para matrículas canceladas.</p>}</section>
      <section className="rounded-xl border border-amber-200/15 bg-black/10 p-4 xl:col-span-2" aria-labelledby="admin-financial-cancellations-title"><h4 id="admin-financial-cancellations-title" className="text-sm font-semibold text-white">Cancelamento de saldo financeiro</h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Esta ação cancela somente o saldo ainda devido de uma matrícula que já foi cancelada ou teve desistência registrada. Não é um reembolso e não registra dinheiro recebido. Informe a justificativa para manter o histórico financeiro.</p>{cancellationItems.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{cancellationItems.map((candidate) => <li key={candidate.enrollment_id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{candidate.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{candidate.course_title} · recebido/compensado {money(candidate.amount_covered, candidate.currency)} de {money(candidate.course_price, candidate.currency)} · saldo a cancelar {money(candidate.amount_remaining, candidate.currency)}</p><FinancialCancellationForm candidate={candidate} onSaved={onSaved} /></li>)}</ul>{cancellationCursor && <button type="button" onClick={() => void loadMoreCancellations()} disabled={cancellationLoading} className="mt-3 min-h-10 rounded-lg border border-amber-200/20 px-4 text-xs font-medium text-amber-100 disabled:opacity-50">{cancellationLoading ? "Carregando…" : "Carregar mais saldos"}</button>}{cancellationError && <p role="alert" className="mt-2 text-xs text-rose-200">{cancellationError}</p>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum saldo pendente em matrículas canceladas.</p>}</section>
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4" aria-labelledby="admin-admissions-title"><h4 id="admin-admissions-title" className="text-sm font-semibold text-white">Inscrições recentes para acompanhar</h4>{summary.recent_enrollments.length ? <ul className="mt-3 divide-y divide-white/[0.07]">{summary.recent_enrollments.map((item) => <li key={item.id} className="py-2 first:pt-0 last:pb-0"><p className="text-sm text-[#dee4ea]">{item.learner_name}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{item.course_title} · {item.state === "submitted" ? "Em análise" : item.state === "waitlisted" ? "Lista de espera" : "Aprovada"}{item.submitted_at ? ` · ${dateLabel(item.submitted_at) || ""}` : ""}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma inscrição aguardando análise.</p>}</section>
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4" aria-labelledby="admin-capacity-title">
        <h4 id="admin-capacity-title" className="text-sm font-semibold text-white">Turmas próximas da lotação</h4>
        {capacityItems.length ? <ul className="mt-3 divide-y divide-white/[0.07]">{capacityItems.map((cohort) => <li key={cohort.id} className="py-2 first:pt-0 last:pb-0"><p className="text-sm text-[#dee4ea]">{cohort.title}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{cohort.occupied} de {cohort.capacity} vagas ocupadas · {Math.round(cohort.occupied / Math.max(1, cohort.capacity) * 100)}%</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma turma ativa atingiu 80% da capacidade.</p>}
        {capacityCursor && <button type="button" onClick={() => void loadMoreCapacity()} disabled={capacityLoading} className="mt-3 min-h-9 rounded-lg border border-amber-200/20 px-3 text-xs text-amber-100 disabled:opacity-50">{capacityLoading ? "Carregando…" : `Carregar mais turmas (${capacityItems.length} de ${summary.counts.near_capacity_cohorts})`}</button>}
        {capacityError && <p role="alert" className="mt-2 text-xs text-rose-200">{capacityError}</p>}
      </section>
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4" aria-labelledby="admin-upcoming-sessions-title"><h4 id="admin-upcoming-sessions-title" className="text-sm font-semibold text-white">Próximos encontros</h4>{summary.upcoming_sessions.length ? <ul className="mt-3 divide-y divide-white/[0.07]">{summary.upcoming_sessions.map((session) => <li key={session.id} className="py-2 first:pt-0 last:pb-0"><p className="text-sm text-[#dee4ea]">{session.title}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{dateLabel(session.starts_at) || "Data a confirmar"}{session.location ? ` · ${session.location}` : session.modality ? ` · ${session.modality}` : ""}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum encontro agendado.</p>}</section>
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4" aria-labelledby="admin-upcoming-assessments-title"><h4 id="admin-upcoming-assessments-title" className="text-sm font-semibold text-white">Próximos prazos de avaliação <span className="text-[#9fadbc]">({summary.counts.upcoming_assessments})</span></h4>{upcomingAssessments.length ? <ul className="mt-3 divide-y divide-white/[0.07]">{upcomingAssessments.map((assessment) => <li key={assessment.id} className="py-2 first:pt-0 last:pb-0"><p className="text-sm text-[#dee4ea]">{assessment.title}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{assessment.course_title || "Curso"} · {dateLabel(assessment.due_at) || "Prazo a confirmar"}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum prazo futuro publicado.</p>}{upcomingAssessmentCursor && <button type="button" onClick={() => void loadMoreAdminOperations("assessment")} disabled={Boolean(adminOperationLoading)} className="mt-3 min-h-9 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 disabled:opacity-50">{adminOperationLoading === "assessment" ? "Carregando…" : `Carregar mais prazos (${upcomingAssessments.length} de ${summary.counts.upcoming_assessments})`}</button>}</section>
    </div>
    {adminOperationError && <p role="alert" className="mt-3 text-xs text-rose-200">{adminOperationError}</p>}
  </section>;
}

function UnitScholarshipQueues({ queues, onSaved }: { queues: NonNullable<TeachingData["unit_scholarship_queues"]>; onSaved: () => void }) {
  const [applications, setApplications] = useState(queues.applications.items);
  const [applicationCursor, setApplicationCursor] = useState(queues.applications.next_cursor);
  const [counterparties, setCounterparties] = useState(queues.counterparties.items);
  const [counterpartyCursor, setCounterpartyCursor] = useState(queues.counterparties.next_cursor);
  const [loading, setLoading] = useState(""); const [error, setError] = useState("");
  async function loadMore(queue: "applications" | "counterparties") {
    const cursor = queue === "applications" ? applicationCursor : counterpartyCursor;
    if (!cursor || loading) return;
    setLoading(queue); setError("");
    try {
      const query = new URLSearchParams({ cursor, limit: "50" });
      if (queue === "applications") {
        const page = await api<{ items: typeof applications; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/scholarship-applications?${query}`);
        setApplications((current) => { const existing = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !existing.has(item.id))]; });
        setApplicationCursor(page.next_cursor);
      } else {
        const page = await api<{ items: typeof counterparties; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/scholarship-counterparties?${query}`);
        setCounterparties((current) => { const existing = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !existing.has(item.id))]; });
        setCounterpartyCursor(page.next_cursor);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar mais itens da unidade."); }
    finally { setLoading(""); }
  }
  return <section className="mt-5 rounded-2xl border border-violet-300/20 bg-[#2c333a] p-5 sm:p-6" aria-labelledby="unit-scholarship-queues-title">
    <p className="text-xs font-semibold uppercase tracking-[.14em] text-violet-200">Gestão por unidade</p><h3 id="unit-scholarship-queues-title" className="mt-1 text-xl font-semibold text-white">Bolsas das unidades que você administra</h3>
    <p className="mt-1 text-xs leading-5 text-[#9fadbc]">Candidaturas e contrapartidas seguem o mesmo escopo de unidade das ações de revisão; o grant é revalidado em cada página e decisão.</p>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4 xl:col-span-2" aria-label="Candidaturas a bolsas da unidade"><h4 className="text-sm font-semibold text-white">Candidaturas a bolsas</h4>{applications.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{applications.map((application) => <li key={application.id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{application.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{application.program_title} · {application.course_title} · {application.discount_percent}% · pontuação {application.score}</p>{application.document_uploads.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{application.document_uploads.map((file) => <li key={file.attachment_id}><ScholarshipDocumentDownload application={application} file={file} /></li>)}</ul>}<ScholarshipReviewForm application={application} onSaved={onSaved} /></li>)}</ul>{applicationCursor && <button type="button" onClick={() => void loadMore("applications")} disabled={Boolean(loading)} className="mt-3 min-h-10 rounded-lg border border-violet-200/20 px-4 text-xs text-violet-100 disabled:opacity-50">{loading === "applications" ? "Carregando…" : "Carregar mais candidaturas"}</button>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma candidatura para revisar nestas unidades.</p>}</section>
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4 xl:col-span-2" aria-label="Contrapartidas de bolsas da unidade"><h4 className="text-sm font-semibold text-white">Contrapartidas de bolsas</h4>{counterparties.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{counterparties.map((item) => <li key={item.id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{item.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{item.program_title} · {item.course_title} · {item.enrollment_title}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#b6c2cf]">{item.requirement_text}</p>{item.evidence_text && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-black/10 p-2 text-xs text-[#b6c2cf]">Evidência enviada: {item.evidence_text}</p>}{item.evidence_files.map((file) => <ScholarshipCounterpartyDownload key={file.attachment_id} item={item} file={file} />)}<ScholarshipCounterpartyReview item={item} onSaved={onSaved} /></li>)}</ul>{counterpartyCursor && <button type="button" onClick={() => void loadMore("counterparties")} disabled={Boolean(loading)} className="mt-3 min-h-10 rounded-lg border border-violet-200/20 px-4 text-xs text-violet-100 disabled:opacity-50">{loading === "counterparties" ? "Carregando…" : "Carregar mais contrapartidas"}</button>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma contrapartida para revisar nestas unidades.</p>}</section>
    </div>{error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
  </section>;
}

function UnitFinancialQueues({ queues, onSaved }: { queues: NonNullable<TeachingData["unit_financial_queues"]>; onSaved: () => void }) {
  const [payments, setPayments] = useState(queues.payments.items);
  const [paymentCursor, setPaymentCursor] = useState(queues.payments.next_cursor);
  const [refunds, setRefunds] = useState(queues.refunds.items);
  const [refundCursor, setRefundCursor] = useState(queues.refunds.next_cursor);
  const [cancellations, setCancellations] = useState(queues.cancellations.items);
  const [cancellationCursor, setCancellationCursor] = useState(queues.cancellations.next_cursor);
  const [loading, setLoading] = useState(""); const [error, setError] = useState("");
  async function loadMore(queue: "payment" | "refund" | "cancellation") {
    const cursor = queue === "payment" ? paymentCursor : queue === "refund" ? refundCursor : cancellationCursor;
    if (!cursor || loading) return;
    setLoading(queue); setError("");
    try {
      const query = new URLSearchParams({ queue, cursor, limit: "50" });
      const page = await api<{ items: Array<unknown>; next_cursor: string | null }>(`/extensions/suinda-learning/me/teaching/financial-action-queue?${query}`);
      if (queue === "payment") {
        const items = page.items as typeof payments;
        setPayments((current) => { const existing = new Set(current.map((item) => item.id)); return [...current, ...items.filter((item) => !existing.has(item.id))]; });
        setPaymentCursor(page.next_cursor);
      } else if (queue === "refund") {
        const items = page.items as typeof refunds;
        setRefunds((current) => { const existing = new Set(current.map((item) => item.payment_entry_id)); return [...current, ...items.filter((item) => !existing.has(item.payment_entry_id))]; });
        setRefundCursor(page.next_cursor);
      } else {
        const items = page.items as typeof cancellations;
        setCancellations((current) => { const existing = new Set(current.map((item) => item.enrollment_id)); return [...current, ...items.filter((item) => !existing.has(item.enrollment_id))]; });
        setCancellationCursor(page.next_cursor);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a fila financeira."); }
    finally { setLoading(""); }
  }
  return <section className="mt-5 rounded-2xl border border-cyan-300/20 bg-[#2c333a] p-5 sm:p-6" aria-labelledby="unit-financial-queues-title">
    <p className="text-xs font-semibold uppercase tracking-[.14em] text-cyan-200">Gestão por unidade</p><h3 id="unit-financial-queues-title" className="mt-1 text-xl font-semibold text-white">Ações financeiras da sua unidade</h3>
    <p className="mt-1 text-xs leading-5 text-[#9fadbc]">As listas incluem apenas matrículas das unidades que você administra. O acesso é conferido novamente ao carregar cada página e ao registrar uma ação.</p>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4 xl:col-span-2" aria-label="Pagamentos pendentes da unidade"><h4 className="text-sm font-semibold text-white">Pagamentos e inadimplência</h4>{payments.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{payments.map((payment) => <li key={payment.id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{payment.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{payment.course_title} · recebido/bolsa {money(payment.amount_covered, payment.currency)} de {money(payment.course_price, payment.currency)} · saldo {money(payment.amount_remaining, payment.currency)}</p>{payment.overdue_balance > 0 && <p className="mt-2 text-xs text-rose-100">Em atraso: {payment.overdue_installment_count} parcela(s) · {money(payment.overdue_balance, payment.currency)}</p>}<PaymentSettlementForm payment={payment} onSaved={onSaved} /></li>)}</ul>{paymentCursor && <button type="button" onClick={() => void loadMore("payment")} disabled={Boolean(loading)} className="mt-3 min-h-10 rounded-lg border border-cyan-200/20 px-4 text-xs text-cyan-100 disabled:opacity-50">{loading === "payment" ? "Carregando…" : "Carregar mais pagamentos"}</button>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum pagamento pendente nas unidades que você administra.</p>}</section>
      <section className="rounded-xl border border-rose-200/15 bg-black/10 p-4 xl:col-span-2" aria-label="Reembolsos da unidade"><h4 className="text-sm font-semibold text-white">Reembolsos pendentes</h4>{refunds.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{refunds.map((refund) => <li key={refund.payment_entry_id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{refund.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{refund.course_title} · disponível {money(refund.amount_refundable, refund.currency)}</p><RefundForm refund={refund} onSaved={onSaved} /></li>)}</ul>{refundCursor && <button type="button" onClick={() => void loadMore("refund")} disabled={Boolean(loading)} className="mt-3 min-h-10 rounded-lg border border-rose-200/20 px-4 text-xs text-rose-100 disabled:opacity-50">{loading === "refund" ? "Carregando…" : "Carregar mais reembolsos"}</button>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum reembolso pendente nas unidades que você administra.</p>}</section>
      <section className="rounded-xl border border-amber-200/15 bg-black/10 p-4 xl:col-span-2" aria-label="Saldos canceláveis da unidade"><h4 className="text-sm font-semibold text-white">Cancelamento de saldo financeiro</h4>{cancellations.length ? <><ul className="mt-3 grid gap-3 lg:grid-cols-2">{cancellations.map((candidate) => <li key={candidate.enrollment_id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"><p className="text-sm font-medium text-[#dee4ea]">{candidate.learner_name}</p><p className="mt-1 text-xs text-[#9fadbc]">{candidate.course_title} · saldo a cancelar {money(candidate.amount_remaining, candidate.currency)}</p><FinancialCancellationForm candidate={candidate} onSaved={onSaved} /></li>)}</ul>{cancellationCursor && <button type="button" onClick={() => void loadMore("cancellation")} disabled={Boolean(loading)} className="mt-3 min-h-10 rounded-lg border border-amber-200/20 px-4 text-xs text-amber-100 disabled:opacity-50">{loading === "cancellation" ? "Carregando…" : "Carregar mais saldos"}</button>}</> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum saldo cancelável nas unidades que você administra.</p>}</section>
    </div>{error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
  </section>;
}

function UnitOperationsSummary({ summary }: { summary: NonNullable<TeachingData["unit_operations_summary"]> }) {
  const [assessments, setAssessments] = useState(summary.upcoming_assessments);
  const [documents, setDocuments] = useState(summary.documents_expiring);
  const [risks, setRisks] = useState(summary.assessment_risks);
  const [nearCapacityCohorts, setNearCapacityCohorts] = useState(summary.near_capacity_cohorts);
  const [assessmentCursor, setAssessmentCursor] = useState(summary.upcoming_assessments_next_cursor || null);
  const [documentCursor, setDocumentCursor] = useState(summary.documents_expiring_next_cursor || null);
  const [riskCursor, setRiskCursor] = useState(summary.assessment_risks_next_cursor || null);
  const [nearCapacityCursor, setNearCapacityCursor] = useState(summary.near_capacity_cohorts_next_cursor || null);
  const [nearCapacityLoading, setNearCapacityLoading] = useState(false);
  const [nearCapacityError, setNearCapacityError] = useState("");
  const [loading, setLoading] = useState<"assessment" | "document" | "risk" | null>(null);
  const [error, setError] = useState("");
  async function loadMoreNearCapacity() {
    if (!nearCapacityCursor || nearCapacityLoading) return;
    setNearCapacityLoading(true); setNearCapacityError("");
    try {
      const page = await api<{ items: typeof nearCapacityCohorts; next_cursor: string | null }>(
        `/extensions/suinda-learning/me/teaching/unit-operations/capacity?cursor=${encodeURIComponent(nearCapacityCursor)}&limit=50`);
      setNearCapacityCohorts((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !existing.has(item.id))];
      });
      setNearCapacityCursor(page.next_cursor);
    } catch (cause) { setNearCapacityError(cause instanceof Error ? cause.message : "Não foi possível carregar mais turmas."); }
    finally { setNearCapacityLoading(false); }
  }
  async function loadMore(queue: "assessment" | "document" | "risk") {
    if (loading) return;
    const cursor = queue === "assessment" ? assessmentCursor : queue === "document" ? documentCursor : riskCursor;
    if (!cursor) return;
    setLoading(queue); setError("");
    try {
      const page = await api<{ items: typeof assessments | typeof documents | typeof risks; next_cursor: string | null }>(
        `/extensions/suinda-learning/me/teaching/unit-operations/${queue}?cursor=${encodeURIComponent(cursor)}&limit=50`);
      if (queue === "assessment") {
        setAssessments((current) => [...current, ...(page.items as typeof assessments).filter((item) => !current.some((existing) => existing.id === item.id))]);
        setAssessmentCursor(page.next_cursor);
      } else if (queue === "document") {
        setDocuments((current) => [...current, ...(page.items as typeof documents).filter((item) => !current.some((existing) => existing.id === item.id))]);
        setDocumentCursor(page.next_cursor);
      } else {
        setRisks((current) => [...current, ...(page.items as typeof risks).filter((item) => !current.some((existing) => existing.enrollment_id === item.enrollment_id && existing.assessment_id === item.assessment_id))]);
        setRiskCursor(page.next_cursor);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar mais registros."); }
    finally { setLoading(null); }
  }
  return <section className="mt-5 rounded-2xl border border-violet-200/20 bg-[#2c333a] p-5 sm:p-6" aria-labelledby="unit-operations-summary-title">
    <p className="text-xs font-semibold uppercase tracking-[.14em] text-violet-200">Gestão por unidade</p>
    <h3 id="unit-operations-summary-title" className="mt-1 text-xl font-semibold text-white">Prazos e documentos das suas unidades</h3>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4" aria-label="Próximos prazos de avaliação nas unidades">
        <h4 className="text-sm font-semibold text-white">Próximos prazos de avaliação <span className="text-[#9fadbc]">({summary.counts.upcoming_assessments})</span></h4>
        {assessments.length ? <ul className="mt-3 divide-y divide-white/[0.07]">{assessments.map((item) => <li key={item.id} className="py-2 first:pt-0 last:pb-0"><p className="text-sm text-[#dee4ea]">{item.title}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{item.course_title} · {dateLabel(item.due_at) || "Prazo a confirmar"}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum prazo futuro publicado nas unidades que você administra.</p>}
        {assessmentCursor && <button type="button" onClick={() => void loadMore("assessment")} disabled={Boolean(loading)} className="mt-3 min-h-9 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 disabled:opacity-50">{loading === "assessment" ? "Carregando…" : `Carregar mais prazos (${assessments.length} de ${summary.counts.upcoming_assessments})`}</button>}
      </section>
      <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4" aria-label="Documentos acadêmicos vencendo nas unidades">
        <h4 className="text-sm font-semibold text-white">Documentos vencendo em 30 dias <span className="text-[#9fadbc]">({summary.counts.documents_expiring})</span></h4>
        {documents.length ? <ul className="mt-3 grid gap-2">{documents.map((item) => <li key={item.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2"><p className="text-sm font-medium text-[#dee4ea]">{item.learner_name}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{item.course_title} · {item.title}</p><p className="mt-1 text-xs text-violet-100/80">Vence em {dateLabel(item.expires_at) || item.expires_at} · {item.category || "Documento"}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum documento aprovado vence nas unidades que você administra.</p>}
        {documentCursor && <button type="button" onClick={() => void loadMore("document")} disabled={Boolean(loading)} className="mt-3 min-h-9 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 disabled:opacity-50">{loading === "document" ? "Carregando…" : `Carregar mais documentos (${documents.length} de ${summary.counts.documents_expiring})`}</button>}
      </section>
      <section className="rounded-xl border border-rose-200/15 bg-black/10 p-4 xl:col-span-2" aria-label="Alunos em risco por notas nas unidades">
        <h4 className="text-sm font-semibold text-white">Alunos em risco por notas <span className="text-[#9fadbc]">({summary.counts.assessment_risks})</span></h4>
        {risks.length ? <ul className="mt-3 grid gap-2 md:grid-cols-2">{risks.map((risk) => <li key={`${risk.enrollment_id}:${risk.assessment_id}`} className="rounded-lg border border-rose-200/10 bg-white/[0.02] px-3 py-2"><p className="text-sm font-medium text-[#dee4ea]">{risk.learner_name}</p><p className="mt-0.5 text-xs text-[#9fadbc]">{risk.course_title} · {risk.assessment_title}</p><p className="mt-1 text-xs text-rose-100">Nota {risk.score} de {risk.passing_score} · tentativa {risk.attempt_number} de {risk.max_attempts}</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhum aluno atingiu o limite de tentativas sem nota de aprovação nas unidades que você administra.</p>}
        {riskCursor && <button type="button" onClick={() => void loadMore("risk")} disabled={Boolean(loading)} className="mt-3 min-h-9 rounded-lg border border-rose-200/20 px-3 text-xs text-rose-100 disabled:opacity-50">{loading === "risk" ? "Carregando…" : `Carregar mais alunos (${risks.length} de ${summary.counts.assessment_risks})`}</button>}
      </section>
      <section className="rounded-xl border border-amber-200/15 bg-black/10 p-4 xl:col-span-2" aria-label="Turmas próximas da lotação nas unidades">
        <h4 className="text-sm font-semibold text-white">Turmas próximas da lotação <span className="text-[#9fadbc]">({summary.counts.near_capacity_cohorts})</span></h4>
        {nearCapacityCohorts.length ? <ul className="mt-3 grid gap-2 md:grid-cols-2">{nearCapacityCohorts.map((cohort) => <li key={cohort.id} className="rounded-lg border border-amber-200/10 bg-white/[0.02] px-3 py-2"><p className="text-sm font-medium text-[#dee4ea]">{cohort.title}</p><p className="mt-1 text-xs text-amber-100">{cohort.occupied} de {cohort.capacity} vagas ocupadas · {Math.round(cohort.occupied / Math.max(1, cohort.capacity) * 100)}%</p></li>)}</ul> : <p className="mt-3 text-xs text-[#9fadbc]">Nenhuma turma das unidades administradas atingiu 80% da capacidade.</p>}
        {nearCapacityCursor && <button type="button" onClick={() => void loadMoreNearCapacity()} disabled={nearCapacityLoading} className="mt-3 min-h-9 rounded-lg border border-amber-200/20 px-3 text-xs text-amber-100 disabled:opacity-50">{nearCapacityLoading ? "Carregando…" : `Carregar mais turmas (${nearCapacityCohorts.length} de ${summary.counts.near_capacity_cohorts})`}</button>}
        {nearCapacityError && <p role="alert" className="mt-2 text-xs text-rose-200">{nearCapacityError}</p>}
      </section>
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
  </section>;
}

function ScholarshipCounterpartyReview({ item, onSaved }: {
  item: NonNullable<TeachingData["admin_summary"]>["scholarship_counterparties"][number]; onSaved: () => void;
}) {
  const [feedback, setFeedback] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function review(action: "accept" | "request_revision") {
    if (busy || (action === "request_revision" && !feedback.trim())) return;
    setBusy(true); setError("");
    try { await api(`/extensions/suinda-learning/me/teaching/scholarship-counterparties/${encodeURIComponent(item.id)}/review`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: item.revision, action, feedback: feedback.trim() || undefined }) }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível revisar as evidências."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 grid gap-2"><label className="text-[11px] text-[#9fadbc]">Orientação (obrigatória ao solicitar complemento)<textarea maxLength={2000} rows={2} value={feedback} onChange={(event) => setFeedback(event.target.value)} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-white" /></label><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void review("accept")} className="min-h-9 rounded-lg bg-emerald-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{busy ? "Salvando parecer…" : "Aceitar evidências"}</button><button type="button" disabled={busy || !feedback.trim()} onClick={() => void review("request_revision")} className="min-h-9 rounded-lg border border-amber-200/20 px-3 text-xs text-amber-100 disabled:opacity-50">{busy ? "Salvando parecer…" : "Solicitar complemento"}</button></div>{error && <p role="alert" className="text-xs text-rose-200">{error}</p>}</div>;
}

function ScholarshipCounterpartyDownload({ item, file }: { item: NonNullable<TeachingData["admin_summary"]>["scholarship_counterparties"][number]; file: NonNullable<TeachingData["admin_summary"]>["scholarship_counterparties"][number]["evidence_files"][number] }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function download() {
    if (busy) return; setBusy(true); setError("");
    try { const blob = await apiBlob(`/extensions/suinda-learning/scholarship-counterparties/${encodeURIComponent(item.id)}/files/${encodeURIComponent(file.attachment_id)}?revision=${item.revision}`); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar este comprovante."); }
    finally { setBusy(false); }
  }
  return <span className="mt-2 block"><button type="button" onClick={() => void download()} disabled={busy} className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-[#3b4754] px-2 text-xs text-cyan-100 disabled:opacity-50"><Download size={13} aria-hidden="true" />{busy ? "Baixando…" : file.file_name}</button>{error && <span role="alert" className="mt-1 block text-[11px] text-rose-200">{error}</span>}</span>;
}

function ScholarshipReviewForm({ application, onSaved }: {
  application: NonNullable<TeachingData["admin_summary"]>["pending_scholarship_applications"][number];
  onSaved: () => void;
}) {
  const [score, setScore] = useState(String(application.score || 0));
  const rubric = application.scoring_criteria_snapshot || [];
  const [criterionScores, setCriterionScores] = useState<Record<string, string>>(() => Object.fromEntries(
    (application.criterion_scores || []).map((entry) => [entry.criterion_id, String(entry.score)]),
  ));
  const [reason, setReason] = useState(application.decision_reason || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const completeRubric = rubric.length > 0 && rubric.every((criterion) => {
    const raw = criterionScores[criterion.id];
    const value = Number(criterionScores[criterion.id]);
    return raw !== undefined && raw.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= criterion.max_points;
  });
  const calculatedScore = rubric.reduce((sum, criterion) => sum + (Number(criterionScores[criterion.id]) || 0), 0);
  async function decide(action: "review" | "approve" | "waitlist" | "reject") {
    if (saving || (rubric.length ? !completeRubric : !Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 1000)) return;
    setSaving(true); setMessage(""); setError("");
    try {
      const result = await api<{ state: string; waitlist_position?: number | null }>(`/extensions/suinda-learning/me/teaching/scholarship-applications/${encodeURIComponent(application.id)}/review`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), action,
          ...(rubric.length ? { criterion_scores: rubric.map((criterion) => ({ criterion_id: criterion.id, score: Number(criterionScores[criterion.id]) })) }
            : { score: Number(score) }), reason: reason.trim() || undefined }),
      });
      setMessage(result.state === "approved" ? "Bolsa aprovada e aplicada à inscrição." : result.state === "waitlisted" ? `Candidatura na lista de espera${result.waitlist_position ? ` · posição ${result.waitlist_position}` : ""}.` : result.state === "rejected" ? "Candidatura recusada." : "Candidatura encaminhada para análise.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a decisão."); }
    finally { setSaving(false); }
  }
  return <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
    {rubric.length ? <fieldset className="space-y-2 sm:col-span-2"><legend className="text-[11px] font-semibold text-violet-100">Rubrica do programa · total calculado pelo servidor</legend>
      <div className="grid gap-2 md:grid-cols-2">{rubric.map((criterion) => <label key={criterion.id} className="rounded-lg border border-violet-200/10 bg-violet-200/[0.03] p-2 text-[11px] text-[#c9d0d8]">
        <span className="flex items-center justify-between gap-3"><span className="font-medium">{criterion.label}</span><span>0–{criterion.max_points} pontos</span></span>
        {criterion.guidance && <span className="mt-1 block text-[#9fadbc]">{criterion.guidance}</span>}
        <input type="number" min="0" max={criterion.max_points} step="1" value={criterionScores[criterion.id] ?? ""}
          aria-label={`${criterion.label}, máximo ${criterion.max_points} pontos`}
          onChange={(event) => setCriterionScores((current) => ({ ...current, [criterion.id]: event.target.value }))}
          className="mt-2 min-h-9 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" />
      </label>)}</div>
      <p className="text-xs text-violet-100" aria-live="polite">Pontuação atual: {calculatedScore} / 1000{!completeRubric && " · preencha todos os critérios para decidir"}</p>
    </fieldset> : <label className="text-[11px] text-[#9fadbc]">Pontuação manual (programa legado)<input type="number" min="0" max="1000" step="0.1" value={score} onChange={(event) => setScore(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" /></label>}
    <label className="text-[11px] text-[#9fadbc]">Análise ou motivo da decisão<textarea maxLength={4000} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} aria-describedby="scholarship-review-reason-help" className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-white" /><span id="scholarship-review-reason-help" className="mt-1 block text-[10px] text-[#9fadbc]">Obrigatório para aprovar, recusar ou colocar na lista de espera.</span></label>
    <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="button" disabled={saving || (rubric.length > 0 && !completeRubric)} onClick={() => void decide("review")} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf] disabled:opacity-50">Analisar</button><button type="button" disabled={saving || !reason.trim() || (rubric.length > 0 && !completeRubric)} onClick={() => void decide("approve")} className="min-h-9 rounded-lg bg-emerald-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">Aprovar</button><button type="button" disabled={saving || !reason.trim() || (rubric.length > 0 && !completeRubric)} onClick={() => void decide("waitlist")} className="min-h-9 rounded-lg border border-amber-200/20 px-3 text-xs text-amber-100 disabled:opacity-50">Lista de espera</button><button type="button" disabled={saving || !reason.trim() || (rubric.length > 0 && !completeRubric)} onClick={() => void decide("reject")} className="min-h-9 rounded-lg border border-rose-200/20 px-3 text-xs text-rose-100 disabled:opacity-50">Recusar</button></div>
    {message && <p role="status" className="text-xs text-emerald-200 sm:col-span-2">{message}</p>}{error && <p role="alert" className="text-xs text-rose-200 sm:col-span-2">{error}</p>}</div>;
}


function ScholarshipDocumentDownload({ application, file }: {
  application: NonNullable<TeachingData["admin_summary"]>["pending_scholarship_applications"][number];
  file: NonNullable<TeachingData["admin_summary"]>["pending_scholarship_applications"][number]["document_uploads"][number];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/records/${encodeURIComponent(application.id)}/attachments/${application.revision}/${encodeURIComponent(file.attachment_id)}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o documento."); }
    finally { setBusy(false); }
  }
  return <><button type="button" onClick={() => void download()} disabled={busy} className="inline-flex min-h-8 items-center rounded-lg border border-[#3b4754] px-2 text-[11px] text-cyan-100 underline underline-offset-2 disabled:opacity-50">{busy ? "Baixando…" : `${file.category}: ${file.file_name}`}</button>{error && <span role="alert" className="block text-[11px] text-rose-200">{error}</span>}</>;
}

function PaymentSettlementForm({ payment, onSaved }: {
  payment: NonNullable<TeachingData["admin_summary"]>["pending_payments"][number];
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(payment.amount_remaining.toFixed(2));
  const [method, setMethod] = useState("pix");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const operationKey = useRef("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    if (saving || !Number.isFinite(value) || value <= 0 || value > payment.amount_remaining) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await api<{ amount_remaining: number; payment_status: string }>(`/extensions/suinda-learning/me/teaching/enrollments/${encodeURIComponent(payment.id)}/payments`, {
        method: "POST", body: JSON.stringify({ operation_key: operationKey.current || (operationKey.current = crypto.randomUUID()), amount: value,
          payment_method: method, payment_reference: reference.trim() || undefined, notes: notes.trim() || undefined }),
      });
      operationKey.current = "";
      setMessage(result.payment_status === "paid" ? "Pagamento integral confirmado." : `Pagamento parcial registrado. Saldo: ${money(result.amount_remaining, payment.currency)}.`);
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível registrar o pagamento."); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
    <label className="text-[11px] text-[#9fadbc]">Valor recebido
      <input aria-label={`Valor recebido de ${payment.learner_name}`} type="number" min="0.01" max={payment.amount_remaining} step="0.01" required value={amount} onChange={(event) => { operationKey.current = ""; setAmount(event.target.value); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" />
    </label>
    <label className="text-[11px] text-[#9fadbc]">Forma de pagamento
      <select value={method} onChange={(event) => { operationKey.current = ""; setMethod(event.target.value); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white">
        <option value="pix">PIX</option><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="card_external">Cartão externo</option><option value="boleto">Boleto</option><option value="other">Outra</option>
      </select>
    </label>
    <label className="text-[11px] text-[#9fadbc]">Comprovante ou referência (opcional)
      <input maxLength={200} value={reference} onChange={(event) => { operationKey.current = ""; setReference(event.target.value); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" />
    </label>
    <label className="text-[11px] text-[#9fadbc]">Observações (opcional)
      <input maxLength={2000} value={notes} onChange={(event) => { operationKey.current = ""; setNotes(event.target.value); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" />
    </label>
    <div className="sm:col-span-2"><button type="submit" disabled={saving || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > payment.amount_remaining} className="min-h-10 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{saving ? "Registrando…" : "Registrar pagamento"}</button>
      {message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</div>
  </form>;
}

function RefundForm({ refund, onSaved }: {
  refund: NonNullable<TeachingData["admin_summary"]>["refund_candidates"][number];
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(refund.amount_refundable.toFixed(2));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const operationKey = useRef("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    if (saving || !Number.isFinite(value) || value <= 0 || value > refund.amount_refundable) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await api<{ amount_refundable: number; payment_status: string }>(`/extensions/suinda-learning/me/teaching/enrollments/${encodeURIComponent(refund.enrollment_id)}/refunds`, {
        method: "POST", body: JSON.stringify({ operation_key: operationKey.current || (operationKey.current = crypto.randomUUID()),
          payment_entry_id: refund.payment_entry_id, amount: value, payment_reference: reference.trim() || undefined, notes: notes.trim() || undefined }),
      });
      operationKey.current = "";
      setMessage(result.payment_status === "refunded" ? "Reembolso integral registrado." : `Reembolso parcial registrado. Restam ${money(result.amount_refundable, refund.currency)} neste pagamento.`);
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível registrar o reembolso."); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
    <label className="text-[11px] text-[#9fadbc]">Valor devolvido
      <input aria-label={`Valor devolvido para ${refund.learner_name}`} type="number" min="0.01" max={refund.amount_refundable} step="0.01" required value={amount} onChange={(event) => { operationKey.current = ""; setAmount(event.target.value); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" />
    </label>
    <label className="text-[11px] text-[#9fadbc]">Comprovante ou referência (opcional)
      <input maxLength={200} value={reference} onChange={(event) => { operationKey.current = ""; setReference(event.target.value); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" />
    </label>
    <label className="text-[11px] text-[#9fadbc] sm:col-span-2">Observações (opcional)
      <input maxLength={2000} value={notes} onChange={(event) => { operationKey.current = ""; setNotes(event.target.value); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" />
    </label>
    <div className="sm:col-span-2"><button type="submit" disabled={saving || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > refund.amount_refundable} className="min-h-10 rounded-lg border border-rose-200/20 px-3 text-xs font-semibold text-rose-100 disabled:opacity-50">{saving ? "Registrando…" : "Registrar reembolso realizado"}</button>
      {message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</div>
  </form>;
}

function FinancialCancellationForm({ candidate, onSaved }: {
  candidate: NonNullable<NonNullable<TeachingData["admin_summary"]>["financial_cancellation_candidates"]>[number];
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState("");
  const operationKey = useRef("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = notes.trim();
    if (saving || !reason) { if (!reason) setError("Informe uma justificativa para cancelar o saldo."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/enrollments/${encodeURIComponent(candidate.enrollment_id)}/financial-cancellations`, {
        method: "POST", body: JSON.stringify({ operation_key: operationKey.current || (operationKey.current = crypto.randomUUID()), notes: reason }),
      });
      operationKey.current = "";
      setNotes("");
      setMessage(`Saldo de ${money(candidate.amount_remaining, candidate.currency)} cancelado. Esta operação não é um reembolso.`);
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível cancelar o saldo financeiro."); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="mt-3 grid gap-2">
    <label className="text-[11px] text-[#9fadbc]">Justificativa obrigatória
      <textarea aria-label={`Justificativa para cancelar o saldo de ${candidate.learner_name}`} maxLength={2000} required rows={3} value={notes} onChange={(event) => { operationKey.current = ""; setNotes(event.target.value); setError(""); }} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-white" />
    </label>
    <div><button type="submit" disabled={saving || !notes.trim()} className="min-h-10 rounded-lg border border-amber-200/20 px-3 text-xs font-semibold text-amber-100 disabled:opacity-50">{saving ? "Cancelando saldo…" : "Cancelar saldo restante"}</button>
      {message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</div>
  </form>;
}

function SubmissionGradeForm({ submission, onSaved }: { submission: TeachingData["submissions"][number]; onSaved: () => void }) {
  const rubric = submission.rubric || [];
  const [score, setScore] = useState(submission.score === undefined ? "" : String(submission.score));
  const [criterionScores, setCriterionScores] = useState<Record<string, string>>(() => Object.fromEntries((submission.criterion_scores || []).map((entry) => [entry.criterion_id, String(entry.score)])));
  const [criterionFeedback, setCriterionFeedback] = useState<Record<string, string>>(() => Object.fromEntries((submission.criterion_scores || []).map((entry) => [entry.criterion_id, entry.feedback || ""])));
  const [feedback, setFeedback] = useState(submission.feedback || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const earned = rubric.reduce((sum, criterion) => sum + (Number(criterionScores[criterion.id]) || 0), 0);
  const maximum = rubric.reduce((sum, criterion) => sum + Number(criterion.points || 0), 0);
  const rubricComplete = rubric.length > 0 && rubric.every((criterion) => criterionScores[criterion.id] !== undefined && criterionScores[criterion.id] !== "");
  const finalScore = rubric.length ? maximum ? Math.round(earned / maximum * 10000) / 100 : 0 : Number(score);

  async function grade(finalState: "returned" | "completed") {
    if (saving || (rubric.length ? !rubricComplete : score === "")) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/submissions/${encodeURIComponent(submission.id)}/grade`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: submission.revision,
          score: finalScore, ...(rubric.length ? { criterion_scores: rubric.map((criterion) => ({ criterion_id: criterion.id, score: Number(criterionScores[criterion.id]), feedback: criterionFeedback[criterion.id]?.trim() || undefined })) } : {}),
          feedback: feedback.trim() || undefined, final_state: finalState }),
      });
      setMessage(finalState === "returned" ? "Atividade devolvida para revisão." : "Correção concluída."); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a correção."); }
    finally { setSaving(false); }
  }

  return <div className="mt-4 border-t border-white/[0.08] pt-3">
    {rubric.length > 0 && <fieldset className="space-y-2"><legend className="mb-2 text-xs font-semibold text-cyan-100">Avaliação por critérios</legend>{rubric.map((criterion) => <div key={criterion.id} className="grid gap-2 rounded-lg border border-[#3b4754] p-3 sm:grid-cols-[minmax(0,1fr)_120px]"><label><span className="block text-xs font-medium text-[#b6c2cf]">{criterion.criterion} · máximo {criterion.points}</span>{criterion.description && <span className="mt-1 block text-xs text-[#9fadbc]">{criterion.description}</span>}<textarea value={criterionFeedback[criterion.id] || ""} onChange={(event) => setCriterionFeedback((current) => ({ ...current, [criterion.id]: event.target.value }))} maxLength={4000} aria-label={`Feedback do critério ${criterion.criterion}`} placeholder="Comentário do critério (opcional)" className="mt-2 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-xs text-[#dee4ea] placeholder:text-[#9fadbc]" /></label><label className="text-xs text-[#9fadbc]">Pontuação<input type="number" min={0} max={criterion.points} step="0.01" value={criterionScores[criterion.id] || ""} onChange={(event) => setCriterionScores((current) => ({ ...current, [criterion.id]: event.target.value }))} aria-label={`Nota do critério ${criterion.criterion}`} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea]" /></label></div>)}<p className="text-right text-xs text-cyan-100">Nota calculada: {rubricComplete ? `${finalScore}%` : "preencha todos os critérios"}</p></fieldset>}
    <div className="mt-3 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">{!rubric.length && <label className="flex items-center gap-2 rounded-lg border border-[#3b4754] px-2 text-[11px] text-[#9fadbc]">Nota<input type="number" min={0} max={100} step="0.01" value={score} onChange={(event) => setScore(event.target.value)} aria-label={`Nota para ${submission.assessment_title}`} className="min-h-8 min-w-0 w-full rounded-md border border-[#80909d] bg-[#1d2125] px-2 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300" /></label>}<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={12000} aria-label="Feedback da atividade" placeholder="Feedback para o aluno" className="min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-xs text-[#dee4ea] placeholder:text-[#9fadbc]" /></div>
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={saving || (rubric.length ? !rubricComplete : score === "") || !feedback.trim()} onClick={() => grade("returned")} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs font-medium text-[#b6c2cf] disabled:opacity-50">Devolver para revisão</button><button type="button" disabled={saving || (rubric.length ? !rubricComplete : score === "")} onClick={() => grade("completed")} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{saving ? "Salvando…" : "Concluir correção"}</button></div>{message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</div>;
}

function AssessmentAttemptGradeForm({ attempt, onSaved }: { attempt: TeachingData["assessment_attempts"][number]; onSaved: () => void }) {
  const [grades, setGrades] = useState<Record<string, { score: string; feedback: string }>>(() => Object.fromEntries(attempt.answers.map((answer) => [answer.question_id, { score: answer.score === undefined ? "" : String(answer.score), feedback: answer.feedback || "" }])));
  const [feedback, setFeedback] = useState(attempt.feedback || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function grade() {
    if (saving || attempt.answers.some((answer) => grades[answer.question_id]?.score === "")) return;
    setSaving(true); setError("");
    try {
      await api(`/extensions/suinda-learning/me/teaching/assessment-attempts/${encodeURIComponent(attempt.id)}/grade`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: attempt.revision,
          question_grades: attempt.answers.map((answer) => ({ question_id: answer.question_id, score: Number(grades[answer.question_id]?.score), feedback: grades[answer.question_id]?.feedback.trim() || undefined })),
          feedback: feedback.trim() || undefined }),
      });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a correção."); }
    finally { setSaving(false); }
  }
  return <div className="mt-4 border-t border-white/[0.08] pt-3"><div className="space-y-2">{attempt.answers.map((answer) => <div key={answer.question_id} className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)]"><label className="flex items-center gap-2 rounded-lg border border-[#3b4754] px-2 text-[11px] text-[#9fadbc]">Nota<input type="number" min={0} max={answer.points} step="0.01" value={grades[answer.question_id]?.score || ""} onChange={(event) => setGrades((current) => ({ ...current, [answer.question_id]: { ...current[answer.question_id], score: event.target.value } }))} aria-label={`Nota da questão “${answer.prompt}” de ${attempt.learner_name}`} className="w-full bg-transparent text-sm text-[#dee4ea] outline-none" /><span>/ {answer.points}</span></label><textarea value={grades[answer.question_id]?.feedback || ""} onChange={(event) => setGrades((current) => ({ ...current, [answer.question_id]: { ...current[answer.question_id], feedback: event.target.value } }))} maxLength={4000} aria-label={`Feedback da questão “${answer.prompt}” de ${attempt.learner_name}`} placeholder="Comentário para esta resposta (opcional)" className="min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-xs text-[#dee4ea] placeholder:text-[#9fadbc]" /></div>)}</div><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={12000} aria-label={`Feedback geral da avaliação ${attempt.assessment_title} de ${attempt.learner_name}`} placeholder="Feedback geral da avaliação (opcional)" className="mt-2 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-xs text-[#dee4ea] placeholder:text-[#9fadbc]" /><button type="button" disabled={saving || attempt.answers.some((answer) => grades[answer.question_id]?.score === "")} onClick={() => void grade()} className="mt-2 min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{saving ? "Salvando…" : "Concluir correção"}</button>{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</div>;
}

function SessionCheckinCode({ session }: { session: TeachingData["sessions"][number] }) {
  const [code, setCode] = useState<{ expires_at: string; qr_data_url: string; geolocation_required: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setLoading(true); setError("");
    try { setCode(await api(`/extensions/suinda-learning/me/teaching/sessions/${encodeURIComponent(session.id)}/checkin-code`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível gerar o QR Code."); }
    finally { setLoading(false); }
  }
  return <div className="mt-3 rounded-xl border border-cyan-200/10 bg-cyan-200/[0.03] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="flex items-center gap-2 text-xs font-medium text-[#b6c2cf]"><QrCode size={14} className="text-cyan-200" aria-hidden="true" /> Check-in {session.modality === "online" ? "online" : "presencial"}</p><p className="mt-1 text-[11px] text-[#9fadbc]">O código expira em até 90 segundos. Atualize para a próxima pessoa.</p></div><button type="button" onClick={() => void generate()} disabled={loading} className="min-h-9 rounded-lg border border-cyan-100/20 px-3 text-xs font-medium text-cyan-100 hover:bg-cyan-100/5 disabled:opacity-50">{loading ? "Gerando…" : code ? "Atualizar QR Code" : "Gerar QR Code"}</button></div>{code && <div className="mt-3 flex flex-wrap items-center gap-3"><Image src={code.qr_data_url} alt={`QR Code para check-in no encontro ${session.title}`} width={144} height={144} unoptimized className="h-36 w-36 rounded-lg bg-white p-2" /><p className="text-xs text-[#9fadbc]">Válido até {dateLabel(code.expires_at)}. O estudante precisa entrar na conta e confirmar a presença.{code.geolocation_required ? " Este encontro também exige validação de localização." : ""}</p></div>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</div>;
}

function AttendanceForm({ session, learners, entries }: {
  session: TeachingData["sessions"][number];
  learners: Array<TeachingData["roster"][number] & { makeup_origin?: { source_cohort_title: string; original_session_title: string } }>;
  entries: TeachingData["attendance"];
}) {
  const firstEnrollmentId = learners[0]?.id || "";
  const firstPrior = entries.find((entry) => entry.enrollment_record_id === firstEnrollmentId);
  const [enrollmentId, setEnrollmentId] = useState(firstEnrollmentId);
  const [status, setStatus] = useState(firstPrior?.status || "present");
  const [minutes, setMinutes] = useState(() => {
    const duration = (Date.parse(session.ends_at || "") - Date.parse(session.starts_at || "")) / 60_000;
    return String(firstPrior?.minutes_attended ?? (Number.isFinite(duration) ? Math.max(0, Math.floor(duration)) : 0));
  });
  const [notes, setNotes] = useState(firstPrior?.notes || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const prior = entries.find((entry) => entry.enrollment_record_id === enrollmentId);

  async function saveAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollmentId || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ corrected: boolean }>(`/extensions/suinda-learning/me/teaching/sessions/${encodeURIComponent(session.id)}/attendance`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), enrollment_id: enrollmentId, status,
          minutes_attended: Number(minutes), notes: notes.trim() || undefined }),
      });
      setMessage(result.corrected ? "Frequência corrigida." : "Presença registrada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível registrar a frequência.");
    } finally { setSaving(false); }
  }

  if (!learners.length) return <p className="mt-3 text-xs text-[#9fadbc]">Não há matrículas ativas nesta turma.</p>;
  return <form onSubmit={saveAttendance} className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-[#b6c2cf]">Lista de chamada</p>{prior && <span className="text-[11px] text-[#9fadbc]">Anterior: {prior.status} · {prior.minutes_attended || 0} min</span>}</div><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(120px,.8fr)_100px]"><label className="sr-only" htmlFor={`learner-${session.id}`}>Estudante</label><select id={`learner-${session.id}`} value={enrollmentId} onChange={(event) => { const nextId = event.target.value; const existing = entries.find((entry) => entry.enrollment_record_id === nextId); setEnrollmentId(nextId); setStatus(existing?.status || "present"); setMinutes(String(existing?.minutes_attended ?? 0)); setNotes(existing?.notes || ""); setMessage(""); setError(""); }} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-xs text-[#dee4ea]">{learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.learner_name}{learner.makeup_origin ? ` · Reposição de ${learner.makeup_origin.original_session_title} (${learner.makeup_origin.source_cohort_title})` : ""}</option>)}</select><label className="sr-only" htmlFor={`attendance-${session.id}`}>Situação da presença</label><select id={`attendance-${session.id}`} value={status} onChange={(event) => { setStatus(event.target.value); if (["absent", "justified"].includes(event.target.value)) setMinutes("0"); }} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-xs text-[#dee4ea]"><option value="present">Presente</option><option value="late">Atrasado</option><option value="early_departure">Saída antecipada</option><option value="absent">Ausente</option><option value="justified">Falta justificada</option></select><label className="flex items-center gap-2 rounded-lg border border-[#3b4754] px-2 text-[11px] text-[#9fadbc]"><span>Min.</span><input type="number" min={0} value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label="Minutos frequentados" className="w-full bg-transparent text-xs text-[#dee4ea] outline-none" /></label></div><div className="mt-2 flex flex-wrap items-center gap-2"><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} aria-label="Observação da frequência" placeholder="Observação opcional" className="min-h-9 min-w-48 flex-1 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-xs text-[#dee4ea] placeholder:text-[#9fadbc]" /><button type="submit" disabled={saving} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-60">{saving ? "Salvando…" : prior ? "Corrigir frequência" : "Registrar frequência"}</button></div>{message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}</form>;
}
