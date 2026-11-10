"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardList, Send } from "lucide-react";
import { api } from "@/lib/api";

type Question = { id: string; type: "single_choice" | "multiple_choice" | "short_answer" | "essay"; prompt: string; points: number; max_length?: number; options: Array<{ id: string; text: string }> };
type Attempt = { attempt_number: number; submitted_at: string; grading_status?: "pending" | "completed"; score?: number; passed?: boolean; feedback?: string; answers?: Array<{ question_id: string; feedback: string }> };
type Assessment = {
  id: string; title: string; available: boolean;
  payload: { instructions?: string; opens_at?: string; due_at?: string; time_limit_minutes?: number; max_attempts?: number; passing_score?: number; questions_per_attempt?: number; question_set: Question[]; is_recovery?: boolean; recovery_eligible?: boolean; recovery_for_assessment_title?: string };
  attempts: Attempt[];
  attempts_used: number;
  active_session: { id: string; attempt_number: number; started_at: string; expires_at?: string | null } | null;
};

function dateLabel(value?: string) {
  if (!value) return "Sem prazo definido";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data inválida" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SuindaAssessmentsPage() {
  const params = useParams<{ id: string }>();
  const enrollmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const submitRef = useRef<((timedOut?: boolean) => Promise<void>) | null>(null);
  const timeoutSubmittedRef = useRef("");
  const selected = assessments.find((assessment) => assessment.id === selectedId) || assessments[0] || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<Assessment[]>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/assessments`);
      setAssessments(result);
      const requestedAssessment = new URLSearchParams(window.location.search).get("assessment");
      if (requestedAssessment && result.some((assessment) => assessment.id === requestedAssessment)) setSelectedId(requestedAssessment);
      else setSelectedId((current) => result.some((assessment) => assessment.id === current) ? current : result[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar as avaliações.");
    } finally { setLoading(false); }
  }, [enrollmentId]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "dark";
    Promise.resolve().then(load);
    return () => { if (previous) root.dataset.theme = previous; else delete root.dataset.theme; };
  }, [load]);

  const expiresAt = selected?.active_session?.expires_at || null;
  const activeSessionId = selected?.active_session?.id || "";
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0 && timeoutSubmittedRef.current !== activeSessionId) {
        timeoutSubmittedRef.current = activeSessionId;
        void submitRef.current?.(true);
      }
    };
    const first = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 1000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [activeSessionId, expiresAt]);

  function toggleAnswer(question: Question, optionId: string) {
    setAnswers((current) => {
      const selectedOptions = current[question.id] || [];
      const next = question.type === "single_choice"
        ? [optionId]
        : selectedOptions.includes(optionId) ? selectedOptions.filter((value) => value !== optionId) : [...selectedOptions, optionId];
      return { ...current, [question.id]: next };
    });
  }

  async function startAssessment() {
    if (!selected || sending) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/assessments/${encodeURIComponent(selected.id)}/sessions`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID() }),
      });
      setAnswers({});
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível iniciar a avaliação.");
    } finally { setSending(false); }
  }

  const submit = useCallback(async (timedOut = false) => {
    if (!selected || !selected.active_session || sending) return;
    if (!timedOut && selected.payload.question_set.some((question) => ["essay", "short_answer"].includes(question.type)
      ? !textAnswers[question.id]?.trim() : !answers[question.id]?.length)) {
      setError("Responda todas as questões antes de enviar.");
      return;
    }
    setSending(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ score?: number; passed?: boolean; grading_status: string; attempt_number: number }>(
        `/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/assessments/${encodeURIComponent(selected.id)}/attempts`,
        { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), session_id: selected.active_session.id, submitted_at: new Date().toISOString(), answers: selected.payload.question_set.map((question) => ["essay", "short_answer"].includes(question.type) ? ({ question_id: question.id, answer: textAnswers[question.id] || "" }) : ({ question_id: question.id, selected_option_ids: answers[question.id] || [] })) }) },
      );
      setMessage(result.grading_status === "pending"
        ? `${timedOut ? "Tempo encerrado. " : ""}Tentativa ${result.attempt_number} enviada para correção. A nota ficará disponível após a revisão docente.`
        : `${timedOut ? "Tempo encerrado. " : ""}Tentativa ${result.attempt_number} enviada. Nota: ${result.score}%. ${result.passed ? "Você atingiu a nota mínima." : "Revise o conteúdo antes de tentar novamente."}`);
      setAnswers({});
      setTextAnswers({});
      await load();
    } catch (reason) {
      if (timedOut) await load();
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar sua tentativa.");
    } finally { setSending(false); }
  }, [answers, enrollmentId, load, selected, sending, textAnswers]);
  useEffect(() => { submitRef.current = submit; }, [submit]);

  return <main className="min-h-screen bg-[#1d2125] text-[#dee4ea]"><div className="mx-auto max-w-5xl px-4 py-6 sm:px-7 lg:py-9">
    <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-[#b6c2cf] hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Voltar ao curso</Link>
    <header className="mt-6 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.12),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-5 sm:p-7"><p className="text-xs font-medium uppercase tracking-[.14em] text-cyan-200">Suindá · área do aluno</p><h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Avaliações</h1><p className="mt-2 text-sm leading-6 text-[#b6c2cf]">Suas tentativas e avaliações disponíveis para esta matrícula.</p></header>
    {loading && <p role="status" className="mt-6 text-sm text-[#9fadbc]">Carregando avaliações…</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</p>}
    {message && <p role="status" className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">{message}</p>}
    {!loading && !error && assessments.length === 0 && <section className="mt-6 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6"><ClipboardList size={22} className="text-cyan-200" aria-hidden="true" /><h2 className="mt-3 text-lg font-semibold">Nenhuma avaliação publicada</h2><p className="mt-2 text-sm text-[#9fadbc]">As avaliações da turma aparecerão aqui quando forem abertas.</p></section>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      {assessments.length > 0 && <nav aria-label="Lista de avaliações" className="h-fit rounded-2xl border border-[#3b4754] bg-[#2c333a] p-3"><h2 className="px-3 py-2 text-sm font-semibold text-white">Avaliações</h2><ul className="space-y-1">{assessments.map((assessment) => <li key={assessment.id}><button type="button" onClick={() => { setSelectedId(assessment.id); setAnswers({}); setError(""); setMessage(""); }} aria-current={(selected?.id || "") === assessment.id ? "page" : undefined} className={`w-full rounded-xl px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${(selected?.id || "") === assessment.id ? "bg-cyan-300/10 text-cyan-100" : "text-[#b6c2cf] hover:bg-white/[0.05]"}`}><span className="block text-sm font-medium">{assessment.payload.is_recovery ? "Recuperação · " : ""}{assessment.title}</span><span className="mt-1 block text-xs text-[#b6c2cf]">{assessment.attempts_used}/{assessment.payload.max_attempts || 1} tentativas · {assessment.active_session ? "Em andamento" : assessment.available ? "Disponível" : "Fechada"}</span></button></li>)}</ul></nav>}
      {selected && <section className="min-w-0 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-cyan-200">{selected.payload.is_recovery ? "Avaliação de recuperação" : "Avaliação"} · {selected.payload.question_set.some((question) => ["essay", "short_answer"].includes(question.type)) ? "correção mista ou discursiva" : "correção automática"}</p><h2 className="mt-2 text-xl font-semibold text-white">{selected.title}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${selected.available ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.06] text-[#9fadbc]"}`}>{selected.available ? "Aberta" : "Indisponível"}</span></div>
        {selected.payload.is_recovery && <p className="mt-3 text-xs text-cyan-100">Recuperação de: {selected.payload.recovery_for_assessment_title}</p>}
        {selected.payload.is_recovery && !selected.payload.recovery_eligible && <p className="mt-3 rounded-lg border border-amber-200/10 bg-amber-200/[0.04] p-3 text-xs leading-5 text-amber-100">Esta avaliação ficará disponível depois que você esgotar as tentativas da avaliação original sem atingir a nota mínima e a correção estiver concluída.</p>}
        {selected.payload.instructions && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{selected.payload.instructions}</p>}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#9fadbc]"><span>Nota mínima: {selected.payload.passing_score ?? 0}%</span><span>Prazo: {dateLabel(selected.payload.due_at)}</span>{Number(selected.payload.time_limit_minutes) > 0 && <span>Tempo previsto: {selected.payload.time_limit_minutes} min</span>}</div>
        {selected.attempts.length > 0 && <div className="mt-5 rounded-xl border border-[#3b4754] bg-white/[0.03] p-4"><h3 className="text-sm font-medium text-[#b6c2cf]">Histórico de tentativas</h3><ul className="mt-2 space-y-3">{selected.attempts.map((attempt) => <li key={attempt.attempt_number} className="text-xs text-[#9fadbc]"><div className="flex flex-wrap justify-between gap-2"><span>Tentativa {attempt.attempt_number} · {dateLabel(attempt.submitted_at)}</span><span className={attempt.grading_status === "pending" ? "text-amber-200" : attempt.passed ? "text-emerald-200" : "text-rose-200"}>{attempt.grading_status === "pending" ? "Aguardando correção" : `${attempt.score ?? 0}% · ${attempt.passed ? "Aprovada" : "Não atingiu a nota mínima"}`}</span></div>{attempt.feedback && <p className="mt-1 whitespace-pre-wrap text-[#b6c2cf]">{attempt.feedback}</p>}{attempt.answers?.map((answer) => <p key={answer.question_id} className="mt-1 whitespace-pre-wrap text-[#9fadbc]">Comentário da questão: {answer.feedback}</p>)}</li>)}</ul></div>}
        {selected.available && !selected.active_session && <div className="mt-6 rounded-xl border border-cyan-200/15 bg-cyan-200/[0.04] p-4"><p className="text-sm leading-6 text-[#b6c2cf]">Ao iniciar, {Number(selected.payload.time_limit_minutes) > 0 ? `você terá ${selected.payload.time_limit_minutes} minutos` : "a sessão ficará aberta até o prazo da avaliação"}{Number(selected.payload.questions_per_attempt) > 0 ? ` e responderá ${selected.payload.questions_per_attempt} questões sorteadas` : ""}. O relógio começa quando o servidor cria sua sessão.</p><button type="button" onClick={startAssessment} disabled={sending} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-60">{sending ? "Iniciando…" : "Iniciar avaliação"}</button></div>}
        {selected.active_session && <><div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.05] p-4"><p className="text-sm text-amber-100">Tentativa {selected.active_session.attempt_number} · iniciada em {dateLabel(selected.active_session.started_at)}</p>{expiresAt && remainingSeconds !== null && <p role="timer" aria-label={`Tempo restante: ${Math.floor(remainingSeconds / 60)} minutos e ${remainingSeconds % 60} segundos`} aria-live="off" className="font-mono text-lg font-semibold text-amber-100">{Math.floor(remainingSeconds / 60).toString().padStart(2, "0")}:{(remainingSeconds % 60).toString().padStart(2, "0")}</p>}</div><div className="mt-6 space-y-5">{selected.payload.question_set.map((question, index) => <fieldset key={question.id} className="rounded-xl border border-[#3b4754] p-4"><legend className="max-w-full px-2 text-sm font-medium text-white">Questão {index + 1} <span className="text-xs font-normal text-[#b6c2cf]">· {question.points} {question.points === 1 ? "ponto" : "pontos"}</span></legend><p className="mt-2 text-sm leading-6 text-[#b6c2cf]">{question.prompt}</p>{["essay", "short_answer"].includes(question.type) ? <label className="mt-3 block text-xs text-[#9fadbc]">{question.type === "essay" ? "Resposta discursiva" : "Resposta curta"}<textarea aria-label={`Questão ${index + 1}: ${question.prompt}`} value={textAnswers[question.id] || ""} onChange={(event) => setTextAnswers((current) => ({ ...current, [question.id]: event.target.value }))} maxLength={question.max_length || 50000} rows={question.type === "essay" ? 7 : 3} className="mt-2 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label> : <div className="mt-3 space-y-2">{question.options.map((option) => { const checked = (answers[question.id] || []).includes(option.id); return <label key={option.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm text-[#b6c2cf] hover:bg-white/[0.04]"><input aria-label={`Questão ${index + 1}: ${option.text}`} type={question.type === "multiple_choice" ? "checkbox" : "radio"} name={`question-${question.id}`} checked={checked} onChange={() => toggleAnswer(question, option.id)} className="mt-1 accent-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /><span>{option.text}</span></label>; })}</div>}</fieldset>)}</div><button type="button" aria-busy={sending} onClick={() => submit()} disabled={sending || remainingSeconds === 0} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-wait disabled:opacity-60">{sending ? "Enviando…" : "Enviar tentativa"}<Send size={15} aria-hidden="true" /></button>{sending && <p role="status" className="sr-only">Enviando sua tentativa…</p>}</>}
        {!selected.available && selected.attempts.length >= (selected.payload.max_attempts || 1) && selected.attempts.at(-1)?.passed && <p className="mt-6 flex items-center gap-2 text-sm text-emerald-200"><CheckCircle2 size={16} aria-hidden="true" /> Nota mínima alcançada.</p>}
      </section>}
    </div>
  </div></main>;
}
