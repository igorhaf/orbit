"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileCheck2, Upload } from "lucide-react";
import { api } from "@/lib/api";

type AttendanceSession = {
  id: string; title: string; starts_at?: string; ends_at?: string; request_deadline_at?: string | null; attendance_status: string | null; can_request: boolean;
  request: null | { id: string; revision: number; state: string; reason: string; review_notes?: string | null; file_name: string };
  can_request_makeup: boolean;
  makeup_request: null | { id: string; revision: number; state: string; reason: string; preferred_at?: string | null; review_notes?: string | null; replacement_session_record_id?: string | null; replacement_cohort_title?: string | null; replacement_cohort_code?: string | null; fee_amount?: number; fee_currency?: string; fee_status?: string };
  makeup_slots?: Array<{ id: string; title: string; starts_at: string; ends_at: string; remaining_seats: number; cohort_title?: string; cohort_code?: string }>;
};

function dateLabel(value?: string) {
  if (!value) return "Data a confirmar";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data inválida" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function deadlineLabel(value?: string | null) {
  return value ? dateLabel(value) : null;
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export default function SuindaAttendancePage() {
  const params = useParams<{ id: string }>();
  const enrollmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const focusSession = useRef<{ id: string; kind: "makeup" | "justification" } | null>(null);

  const load = useCallback(async (options: { preserveContent?: boolean } = {}) => {
    if (!options.preserveContent) setLoading(true);
    setError("");
    try {
      const result = await api<{ sessions: AttendanceSession[] }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/attendance-justifications`);
      setSessions(result.sessions);
    } catch (cause) { focusSession.current = null; setError(cause instanceof Error ? cause.message : "Não foi possível carregar os encontros."); }
    finally { setLoading(false); }
  }, [enrollmentId]);

  const refreshAfterSubmission = useCallback(async (sessionId: string, kind: "makeup" | "justification") => {
    focusSession.current = { id: sessionId, kind };
    await load({ preserveContent: true });
  }, [load]);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    root.dataset.theme = "dark";
    Promise.resolve().then(() => load());
    return () => { if (previousTheme) root.dataset.theme = previousTheme; else delete root.dataset.theme; };
  }, [load]);

  useEffect(() => {
    if (loading || !focusSession.current) return;
    const { id, kind } = focusSession.current;
    const sessionCard = document.getElementById(`attendance-session-${id}`)?.closest("li");
    focusSession.current = null;
    const target = sessionCard?.querySelector<HTMLElement>(`#attendance-${kind}-${id}`)
      || sessionCard?.querySelector<HTMLElement>("h2");
    target?.focus();
  }, [loading, sessions]);

  return <main className="min-h-screen bg-[#1d2125] px-4 py-6 text-[#dee4ea] sm:px-7 lg:py-9"><div className="mx-auto max-w-5xl">
    <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-[#b6c2cf] hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Voltar ao curso</Link>
    <header className="mt-6 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.12),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-5 sm:p-7"><p className="text-xs font-medium uppercase tracking-[.14em] text-cyan-200">Suindá · área do aluno</p><h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Faltas e reposições</h1><p className="mt-2 text-sm leading-6 text-[#b6c2cf]">Escolha um encontro concluído para justificar uma falta com comprovante ou pedir reposição. A equipe acadêmica analisa cada solicitação; a chamada só muda após aprovação da justificativa.</p></header>
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</p>}
    {loading ? <p role="status" className="mt-5 text-sm text-[#9fadbc]">Carregando encontros…</p> : sessions.length ? <ul className="mt-5 grid gap-4">{sessions.map((session) => <li key={session.id} className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-6"><div className="flex items-start gap-3"><FileCheck2 className="mt-0.5 shrink-0 text-cyan-200" size={18} aria-hidden="true" /><div className="min-w-0 flex-1"><h2 id={`attendance-session-${session.id}`} tabIndex={-1} className="font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{session.title}</h2><p className="mt-1 text-xs text-[#9fadbc]">{dateLabel(session.starts_at)} · {session.attendance_status === "absent" ? "Falta registrada" : session.attendance_status === "justified" ? "Falta justificada" : session.attendance_status ? `Chamada: ${session.attendance_status}` : "Chamada ainda não registrada"}</p>{session.request_deadline_at && <p className={`mt-1 text-xs ${session.can_request ? "text-amber-200" : "text-[#9fadbc]"}`}>{session.can_request ? "Prazo para justificar:" : "Prazo encerrado:"} {deadlineLabel(session.request_deadline_at)}</p>}
      {session.request?.state === "submitted" && <p id={`attendance-justification-${session.id}`} tabIndex={-1} role="status" className="mt-4 rounded-xl border border-amber-200/15 bg-amber-200/[0.05] p-3 text-sm text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Justificativa em análise · {session.request.file_name}</p>}
      {session.request?.state === "approved" && <p id={`attendance-justification-${session.id}`} tabIndex={-1} role="status" className="mt-4 rounded-xl border border-emerald-200/15 bg-emerald-200/[0.05] p-3 text-sm text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Justificativa aprovada. A chamada foi atualizada para falta justificada.</p>}
      {session.request?.state === "rejected" && <div className="mt-4 rounded-xl border border-rose-200/15 bg-rose-200/[0.04] p-3 text-sm text-rose-100"><p>A equipe solicitou uma atualização.</p>{session.request.review_notes && <p className="mt-1 text-xs leading-5 text-rose-100/80">{session.request.review_notes}</p>}</div>}
      {session.can_request && <JustificationForm enrollmentId={enrollmentId} session={session} onSaved={refreshAfterSubmission} />}
      {!session.can_request && !session.request && <p className="mt-4 text-xs text-[#9fadbc]">Não há uma falta pendente que possa receber justificativa.</p>}
      {session.makeup_request && <div id={`attendance-makeup-${session.id}`} role="status" tabIndex={-1} className={`mt-4 rounded-xl border p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${session.makeup_request.state === "rejected" ? "border-rose-200/15 bg-rose-200/[0.04] text-rose-100" : session.makeup_request.state === "scheduled" ? "border-emerald-200/15 bg-emerald-200/[0.04] text-emerald-100" : "border-cyan-200/15 bg-cyan-200/[0.04] text-cyan-100"}`}><p>{session.makeup_request.state === "submitted" ? "Pedido de reposição enviado para análise." : session.makeup_request.state === "approved" ? "Reposição aprovada; a coordenação vai publicar o encontro." : session.makeup_request.state === "scheduled" ? "Reposição agendada. Consulte o encontro na sua agenda." : session.makeup_request.state === "completed" ? "Reposição concluída." : session.makeup_request.state === "rejected" ? "Pedido de reposição não aprovado." : "Pedido de reposição cancelado."}</p>{session.makeup_request.preferred_at && <p className="mt-1 text-xs">Data preferida: {dateLabel(session.makeup_request.preferred_at)}</p>}{session.makeup_request.replacement_cohort_title && <p className="mt-1 text-xs">Agendada em {session.makeup_request.replacement_cohort_title}{session.makeup_request.replacement_cohort_code ? ` · ${session.makeup_request.replacement_cohort_code}` : ""}</p>}{session.makeup_request.review_notes && <p className="mt-1 text-xs leading-5">{session.makeup_request.review_notes}</p>}</div>}
      {session.makeup_request && Number(session.makeup_request.fee_amount || 0) > 0 && <p className="mt-2 text-xs text-cyan-100">Taxa: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: session.makeup_request.fee_currency || "BRL" }).format(session.makeup_request.fee_amount || 0)} · {session.makeup_request.fee_status === "paid" ? "Pagamento confirmado" : session.makeup_request.fee_status === "waived" ? "Taxa isenta pela coordenação" : session.makeup_request.fee_status === "pending" ? "Aguardando confirmação do pagamento ou isenção" : "Sem cobrança pendente"}</p>}
      {session.can_request_makeup && <MakeupRequestForm enrollmentId={enrollmentId} session={session} onSaved={refreshAfterSubmission} />}
      </div></div></li>)}</ul> : <p className="mt-5 rounded-2xl border border-dashed border-white/15 p-6 text-sm text-[#9fadbc]">Não há encontros concluídos disponíveis para justificativa nesta matrícula.</p>}
  </div></main>;
}

function MakeupRequestForm({ enrollmentId, session, onSaved }: { enrollmentId: string; session: AttendanceSession; onSaved: (sessionId: string, kind: "makeup" | "justification") => void | Promise<void> }) {
  const [reason, setReason] = useState("");
  const [replacementSessionId, setReplacementSessionId] = useState("");
  const [preferredAt, setPreferredAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/sessions/${encodeURIComponent(session.id)}/makeup-requests`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), reason: reason.trim(),
          preferred_at: !replacementSessionId && preferredAt ? new Date(preferredAt).toISOString() : null,
          ...(replacementSessionId ? { replacement_session_id: replacementSessionId } : {}) }),
      });
      await onSaved(session.id, "makeup");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar o pedido."); }
    finally { setBusy(false); }
  }
  const slots = session.makeup_slots || [];
  return <form onSubmit={submit} aria-busy={busy} className="mt-4 grid gap-3 rounded-xl border border-cyan-200/10 bg-cyan-200/[0.025] p-4"><div><h3 className="text-sm font-medium text-cyan-100">Solicitar reposição</h3><p className="mt-1 text-xs leading-5 text-[#9fadbc]">A coordenação analisa o pedido. Escolha uma vaga publicada em outra edição do mesmo curso e da mesma revisão curricular, ou sugira outra data.</p></div>{slots.length > 0 && <label className="block text-xs text-[#b6c2cf]">Turmas e horários futuros com vagas<select value={replacementSessionId} onChange={(event) => { setReplacementSessionId(event.target.value); setPreferredAt(""); }} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><option value="">Sugerir outra data</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.cohort_title || "Turma"}{slot.cohort_code ? ` · ${slot.cohort_code}` : ""} — {slot.title} · {dateLabel(slot.starts_at)}–{dateLabel(slot.ends_at)} · {slot.remaining_seats} {slot.remaining_seats === 1 ? "vaga" : "vagas"}</option>)}</select></label>}<label className="block text-xs text-[#b6c2cf]">Motivo<textarea required maxLength={2000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label>{!replacementSessionId && <label className="block text-xs text-[#b6c2cf]">Data preferida (opcional)<input type="datetime-local" value={preferredAt} onChange={(event) => setPreferredAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 sm:max-w-sm" /></label>}<button type="submit" disabled={!reason.trim()} aria-disabled={busy || !reason.trim()} className="min-h-10 w-fit rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 aria-disabled:cursor-wait aria-disabled:opacity-50">{busy ? "Enviando…" : "Enviar pedido de reposição"}</button>{busy && <p role="status" className="sr-only">Enviando pedido de reposição…</p>}{error && <p role="alert" className="text-xs text-rose-200">{error}</p>}</form>;
}

function JustificationForm({ enrollmentId, session, onSaved }: { enrollmentId: string; session: AttendanceSession; onSaved: (sessionId: string, kind: "makeup" | "justification") => void | Promise<void> }) {
  const [reason, setReason] = useState(session.request?.reason || "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/sessions/${encodeURIComponent(session.id)}/attendance-justifications`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), reason: reason.trim(), file_name: file.name,
          mime_type: file.type, data_base64: await fileBase64(file) }),
      });
      setFile(null);
      await onSaved(session.id, "justification");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar a justificativa."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} aria-busy={busy} className="mt-4 grid gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><label className="block text-xs text-[#b6c2cf]">Motivo da ausência<textarea required maxLength={2000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label><label className="block text-xs text-[#b6c2cf]">Comprovante (PDF, PNG ou JPEG; até 8 MB)<input required type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] || null)} className="mt-1 block min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 py-2 text-xs text-[#b6c2cf] file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label><button type="submit" disabled={!file || !reason.trim()} aria-disabled={busy || !file || !reason.trim()} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 aria-disabled:cursor-wait aria-disabled:opacity-50"><Upload size={14} aria-hidden="true" />{busy ? "Enviando…" : session.request?.state === "rejected" ? "Reenviar justificativa" : "Enviar para análise"}</button>{busy && <p role="status" className="sr-only">Enviando justificativa e comprovante…</p>}{error && <p role="alert" className="text-xs text-rose-200">{error}</p>}</form>;
}
