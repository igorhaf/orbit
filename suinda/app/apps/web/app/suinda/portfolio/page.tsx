"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness, Download, FileText } from "lucide-react";
import { api, getToken } from "@/lib/api";

type PortfolioItem = {
  id: string; workspace_id: string; workspace_name: string; record_revision: number; enrollment_id: string | null;
  assessment_title: string; course_title: string; course_id: string | null; state: string;
  submission_version: number; submitted_at: string; due_at: string | null; late: boolean;
  score: number | null; feedback: string | null; answer: string | null; file_count: number; is_group_submission: boolean;
};
const stateLabels: Record<string, string> = { submitted: "Enviada", late: "Enviada com atraso", grading: "Em correção", returned: "Devolvida para ajuste", resubmitted: "Reenviada", completed: "Corrigida" };
function dateLabel(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/[\r\n]+/g, " ");
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function SuindaPortfolioPage() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  useEffect(() => {
    Promise.resolve().then(() => setSignedIn(Boolean(getToken())));
    if (!getToken()) { Promise.resolve().then(() => setLoading(false)); return; }
    api<PortfolioItem[]>("/extensions/suinda-learning/me/portfolio")
      .then(setItems)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar seu portfólio."))
      .finally(() => setLoading(false));
  }, []);
  const filtered = useMemo(() => items.filter((item) => (!stateFilter || item.state === stateFilter)
    && (!query || `${item.course_title} ${item.assessment_title}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")))), [items, query, stateFilter]);
  function exportCsv() {
    const heading = ["Instituição", "Curso", "Atividade", "Situação", "Versão da entrega", "Enviada em", "Prazo", "Nota", "Atrasada", "Entrega em grupo", "Arquivos", "Resposta", "Devolutiva"];
    const data = filtered.map((item) => [item.workspace_name, item.course_title, item.assessment_title, stateLabels[item.state] || item.state,
      item.submission_version, item.submitted_at, item.due_at || "", item.score ?? "", item.late ? "Sim" : "Não",
      item.is_group_submission ? "Sim" : "Não", item.file_count, item.answer || "", item.feedback || ""]);
    const blob = new Blob(["\uFEFF", [heading, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "suinda-portfolio-entregas.csv"; anchor.click(); URL.revokeObjectURL(url);
  }
  return <main className="min-h-full bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl">
    <Link href="/suinda" className="inline-flex min-h-10 items-center gap-2 text-sm text-[#b6c2cf] hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Minha jornada</Link>
    <header className="mt-5 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.11),_transparent_45%),#101621] p-6 sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-cyan-200/10 text-cyan-100"><BriefcaseBusiness size={23} aria-hidden="true" /></span><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-cyan-200">Suindá</p><h1 className="mt-1 text-2xl font-semibold text-white">Portfólio de entregas</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#b6c2cf]">Consulte suas entregas individuais e em grupo, incluindo versões anteriores, correções e devolutivas.</p></div></div>{items.length > 0 && <button type="button" onClick={exportCsv} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#3b4754] px-3 text-sm text-cyan-100 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"><Download size={15} aria-hidden="true" /> Exportar CSV</button>}</div></header>
    <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px]"><label className="text-xs font-medium text-[#b6c2cf]">Buscar curso ou atividade<input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label><label className="text-xs font-medium text-[#b6c2cf]">Situação<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><option value="">Todas</option>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {loading && <p role="status" className="mt-7 text-sm text-[#9fadbc]">Carregando entregas…</p>}
    {error && <p role="alert" className="mt-6 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</p>}
    {!loading && !error && !signedIn && <section className="mt-6 rounded-xl border border-[#3b4754] bg-[#2c333a] p-5"><p className="text-sm text-[#b6c2cf]">Entre na sua conta para consultar seu portfólio.</p><Link href="/" className="mt-3 inline-flex min-h-9 items-center text-sm text-cyan-100 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Entrar</Link></section>}
    {!loading && !error && signedIn && items.length === 0 && <section className="mt-6 rounded-xl border border-dashed border-white/15 bg-[#2c333a] p-8 text-center"><FileText className="mx-auto text-[#9fadbc]" size={26} aria-hidden="true" /><h2 className="mt-3 font-semibold text-white">Ainda não há entregas enviadas</h2><p className="mt-2 text-sm text-[#9fadbc]">As atividades enviadas aparecerão aqui com seu histórico de versões e correções.</p></section>}
    {!loading && !error && filtered.length > 0 && <><p className="mt-5 text-sm text-[#b6c2cf]" role="status">{filtered.length} {filtered.length === 1 ? "versão de entrega" : "versões de entrega"}</p><div className="mt-3 grid gap-3">{filtered.map((item) => <article key={`${item.id}:${item.record_revision}`} className="rounded-xl border border-[#3b4754] bg-[#2c333a] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-cyan-200">{item.workspace_name} · {item.course_title}</p><h2 className="mt-1 font-semibold text-white">{item.assessment_title}</h2><p className="mt-1 text-xs text-[#9fadbc]">Versão de entrega {item.submission_version} · {dateLabel(item.submitted_at)}{item.is_group_submission ? " · entrega em grupo" : ""}{item.file_count ? ` · ${item.file_count} arquivo(s)` : ""}</p></div><span className={`rounded-full px-3 py-1.5 text-xs ${item.state === "completed" ? "bg-emerald-200/10 text-emerald-100" : item.state === "returned" ? "bg-amber-200/10 text-amber-100" : "bg-white/[0.05] text-[#b6c2cf]"}`}>{stateLabels[item.state] || item.state}</span></div>{item.due_at && <p className="mt-3 text-sm text-[#b6c2cf]">Prazo: {dateLabel(item.due_at)}{item.late ? " · enviada após o prazo" : ""}</p>}{item.score !== null && <p className="mt-3 text-sm font-medium text-emerald-100">Nota: {item.score}%</p>}{item.answer && <details className="mt-3 rounded-lg border border-white/[0.08] p-3"><summary className="cursor-pointer text-xs font-medium text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Ver resposta enviada</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{item.answer}</p></details>}{item.feedback && <div className="mt-3 rounded-lg border border-violet-200/10 bg-violet-200/[0.03] p-3"><p className="text-sm font-semibold text-violet-100">Devolutiva docente</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{item.feedback}</p></div>}{item.enrollment_id && <Link href={`/suinda/learning/${encodeURIComponent(item.enrollment_id)}`} className="mt-3 inline-flex min-h-9 items-center text-sm font-medium text-cyan-100 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Abrir jornada do curso</Link>}</article>)}</div></>}
    {!loading && !error && items.length > 0 && filtered.length === 0 && <p role="status" className="mt-8 text-center text-sm text-[#b6c2cf]">Nenhuma entrega corresponde aos filtros.</p>}
  </div></main>;
}
