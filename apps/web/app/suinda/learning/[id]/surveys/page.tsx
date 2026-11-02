"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { api } from "@/lib/api";

type Question = { id: string; type: "rating" | "nps" | "single_choice" | "multiple_choice" | "text"; label: string; required: boolean; options: string[]; max_length: number };
type Survey = { id: string; title: string; anonymous: boolean; closes_at: string | null; questions: Question[] };

export default function SuindaSurveysPage() {
  const params = useParams<{ id: string }>();
  const enrollmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const messageRef = useRef<HTMLParagraphElement>(null);
  const load = useCallback(async (options: { preserveContent?: boolean } = {}) => {
    if (!options.preserveContent) setLoading(true);
    setError("");
    try { const result = await api<{ surveys: Survey[] }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/surveys`); setSurveys(result.surveys); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar as pesquisas."); }
    finally { setLoading(false); }
  }, [enrollmentId]);
  useEffect(() => {
    if (!message) return;
    messageRef.current?.focus();
  }, [message]);
  useEffect(() => {
    const root = document.documentElement; const previous = root.dataset.theme; root.dataset.theme = "dark";
    Promise.resolve().then(() => load());
    return () => { if (previous) root.dataset.theme = previous; else delete root.dataset.theme; };
  }, [load]);
  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const surveyId = new URLSearchParams(window.location.search).get("survey");
    if (!surveyId) return;
    const form = document.getElementById(`survey-${surveyId}`);
    if (!form) return;
    form.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    form.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [loading, surveys]);
  function update(surveyId: string, questionId: string, value: unknown) {
    setAnswers((current) => ({ ...current, [surveyId]: { ...(current[surveyId] || {}), [questionId]: value } }));
  }
  async function submit(event: FormEvent<HTMLFormElement>, survey: Survey) {
    event.preventDefault(); if (busy) return;
    setBusy(survey.id); setError(""); setMessage("");
    try {
      const values = answers[survey.id] || {};
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/surveys/${encodeURIComponent(survey.id)}/responses`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), answers: Object.entries(values).map(([question_id, value]) => ({ question_id, value })) }),
      });
      setMessage(`Resposta enviada: ${survey.title}`); setAnswers((current) => { const next = { ...current }; delete next[survey.id]; return next; }); await load({ preserveContent: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar sua resposta."); }
    finally { setBusy(""); }
  }
  return <main className="min-h-screen bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-7"><div className="mx-auto max-w-3xl">
    <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}`} className="inline-flex min-h-10 items-center gap-2 text-sm text-[#b6c2cf] hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Voltar ao curso</Link>
    <header className="mt-5 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.12),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-6"><p className="text-xs font-medium uppercase tracking-[0.14em] text-cyan-200">Sua opinião importa</p><h1 className="mt-2 text-2xl font-semibold">Pesquisas do curso</h1><p className="mt-2 text-sm text-[#b6c2cf]">As respostas anônimas não exibem sua identidade à equipe acadêmica.</p></header>
    {error && <p role="alert" className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p>}{message && <p ref={messageRef} tabIndex={-1} role="status" className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{message}</p>}
    {loading ? <p role="status" className="mt-6 text-sm text-[#9fadbc]">Carregando pesquisas…</p> : !surveys.length ? <section className="mt-6 rounded-xl border border-[#3b4754] bg-white/[0.03] p-5 text-sm text-[#b6c2cf]">Não há pesquisas abertas para esta matrícula.</section> : <div className="mt-6 grid gap-5">{surveys.map((survey) => <form id={`survey-${survey.id}`} key={survey.id} onSubmit={(event) => void submit(event, survey)} aria-busy={busy === survey.id} className="rounded-2xl border border-[#3b4754] bg-white/[0.03] p-5"><div className="flex flex-wrap items-start justify-between gap-2"><h2 tabIndex={-1} className="text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{survey.title}</h2><span className="rounded-full bg-cyan-200/10 px-3 py-1 text-xs text-cyan-100">{survey.anonymous ? "Anônima" : "Identificada"}</span></div>{survey.closes_at && <p className="mt-1 text-xs text-[#9fadbc]">Encerra em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(survey.closes_at))}</p>}
      <div className="mt-5 grid gap-5">{survey.questions.map((question) => <fieldset key={question.id}><legend className="text-sm font-medium text-[#dee4ea]">{question.label}{question.required && <span className="ml-1 text-cyan-200" aria-label="obrigatória">*</span>}</legend>
        {(question.type === "rating" || question.type === "nps") && <><div className="mt-2 flex flex-wrap gap-2">{Array.from({ length: question.type === "nps" ? 11 : 5 }, (_, index) => index + (question.type === "nps" ? 0 : 1)).map((score) => <label key={score} className="cursor-pointer"><input className="peer sr-only" type="radio" name={`${survey.id}-${question.id}`} value={score} aria-label={`${score}${question.type === "nps" ? " de 10" : " de 5"}`} required={question.required} checked={answers[survey.id]?.[question.id] === score} onChange={() => update(survey.id, question.id, score)} /><span aria-hidden="true" className="inline-flex h-10 min-w-10 items-center justify-center rounded-lg border border-[#3b4754] bg-black/20 px-3 text-sm text-[#b6c2cf] peer-checked:border-cyan-200/50 peer-checked:bg-cyan-200/15 peer-checked:text-cyan-100 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-cyan-300">{score}</span></label>)}</div><p className="mt-2 text-xs text-[#9fadbc]">{question.type === "nps" ? "0 = pouco provável · 10 = muito provável" : "Escala de 1 a 5"}</p></>}
        {question.type === "single_choice" && <div className="mt-2 grid gap-2">{question.options.map((option) => <label key={option} className="flex items-center gap-2 text-sm text-[#b6c2cf]"><input type="radio" name={`${survey.id}-${question.id}`} required={question.required} checked={answers[survey.id]?.[question.id] === option} onChange={() => update(survey.id, question.id, option)} />{option}</label>)}</div>}
        {question.type === "multiple_choice" && <div className="mt-2 grid gap-2">{question.options.map((option) => { const selected = (answers[survey.id]?.[question.id] as string[] || []).includes(option); return <label key={option} className="flex items-center gap-2 text-sm text-[#b6c2cf]"><input type="checkbox" checked={selected} onChange={() => update(survey.id, question.id, selected ? (answers[survey.id]?.[question.id] as string[]).filter((value) => value !== option) : [...(answers[survey.id]?.[question.id] as string[] || []), option])} />{option}</label>; })}</div>}
        {question.type === "text" && <textarea aria-label={question.label} className="mt-2 min-h-24 w-full rounded-xl border border-[#3b4754] bg-black/20 p-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" maxLength={question.max_length} required={question.required} value={String(answers[survey.id]?.[question.id] || "")} onChange={(event) => update(survey.id, question.id, event.target.value)} />}
      </fieldset>)}</div><button aria-disabled={busy === survey.id} className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 aria-disabled:cursor-wait aria-disabled:opacity-50"><Send size={15} aria-hidden="true" />{busy === survey.id ? "Enviando…" : "Enviar resposta"}</button></form>)}</div>}
  </div></main>;
}
