"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, send } from "@/lib/api";
import ExtensionPage, { type ExtensionSummaryCard } from "../records/ExtensionPage";
import SurveyReminderSettings from "./SurveyReminderSettings";
import { PracticeCreditManagement } from "./PracticeCredit";
import { StaffProfessionalManagement } from "./StaffProfessional";
import InstitutionalEmailTemplates from "./InstitutionalEmailTemplates";
import AccessProfiles from "./AccessProfiles";
import { FinancialNegotiationManagement } from "./FinancialNegotiation";
import { SuindaWhatsAppSettings } from "./SuindaWhatsAppSettings";

const areas: Array<[string, string]> = [
  ["Configuração institucional", "institution_settings"],
  ["Perfis de acesso", "access_profiles"],
  ["Modelos de e-mail", "email_templates"],
  ["Cursos", "course"], ["Turmas", "cohort"], ["Matrículas", "enrollment"], ["Trilhas", "learning_path"],
  ["Desafios de aprendizagem", "learning_challenge"], ["Temporadas", "learning_season"],
  ["Avisos de privacidade", "privacy_notice"], ["Solicitações de titular", "learner_privacy_request"],
  ["Termos e documentos acadêmicos", "academic_term"], ["Assinaturas acadêmicas", "academic_signature"],
  ["Módulos", "module"], ["Unidades de aprendizagem", "learning_unit"], ["Aulas e materiais", "lesson"], ["Encontros", "session"], ["Calendário acadêmico", "academic_calendar_event"], ["Solicitações de reposição", "makeup_request"], ["Frequência", "attendance"],
  ["Banco de questões", "question_bank"], ["Avaliações", "assessment"], ["Entregas", "submission"], ["Práticas", "practice"], ["Certificados", "certificate"],
  ["Crédito de práticas", "practice_credit"],
  ["Negociação financeira", "financial_negotiation"],
  ["Programas de bolsas", "scholarship"], ["Candidaturas", "scholarship_application"], ["Comunicados", "announcement"], ["Pesquisas", "survey"],
  ["Equipe profissional", "staff_professional"],
  ["WhatsApp", "whatsapp"],
];

const summaryCards: ExtensionSummaryCard[] = [
  { kind: "course", label: "Cursos", audience: "staff" },
  { kind: "cohort", label: "Turmas em andamento", states: ["active", "enrolling"], audience: "staff" },
  { kind: "enrollment", label: "Inscrições para analisar", states: ["submitted", "waitlisted"], audience: "staff" },
  { kind: "submission", label: "Entregas para corrigir", states: ["submitted", "late", "grading", "resubmitted"], audience: "staff" },
  { kind: "enrollment", label: "Minhas matrículas ativas", states: ["enrolled", "active", "paused"], audience: "member" },
  { kind: "enrollment", label: "Inscrições aguardando", states: ["submitted", "waitlisted", "approved"], audience: "member" },
  { kind: "submission", label: "Entregas pendentes", states: ["draft", "returned"], audience: "member" },
  { kind: "certificate", label: "Certificados emitidos", states: ["issued"], audience: "member" },
];

export default function SuindaManagement() {
  const searchParams = useSearchParams();
  const selected = searchParams.get("kind") || "";

  return <>
    <nav aria-label="Áreas acadêmicas" className="flex flex-wrap gap-2">
      {areas.map(([label, kind]) => <Link key={kind} href={`/suinda?kind=${kind}`} aria-current={selected === kind ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-full border px-3 text-sm ${selected === kind ? "border-violet-400 bg-violet-950 text-violet-100" : "border-white/15 hover:bg-white/5"}`}>{label}</Link>)}
    </nav>
    {(selected === "module" || selected === "learning_unit" || selected === "lesson") && <CurriculumOrderEditor itemKind={selected} />}
    {selected === "survey" && <SurveyReminderSettings />}
    {selected === "email_templates" && <InstitutionalEmailTemplates />}
    {selected === "access_profiles" && <AccessProfiles />}
    {selected === "practice_credit" && <PracticeCreditManagement />}
    {selected === "financial_negotiation" && <FinancialNegotiationWorkspaceQueue />}
    {selected === "staff_professional" && <StaffProfessionalManagement />}
    {selected === "privacy_notice" && <RetentionReviewQueue />}
    {selected === "whatsapp" && <WhatsAppSettingsWorkspace />}
    <ExtensionPage pluginId="suinda-learning" summaryCards={summaryCards} embedded />
  </>;
}

function WhatsAppSettingsWorkspace() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<Workspace[]>("/workspaces").then((rows) => {
      if (!active) return;
      setWorkspaces(rows);
      setWorkspaceId(rows[0]?.id || "");
      if (!rows.length) setError("Nenhum workspace disponível para sua conta.");
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os workspaces."); });
    return () => { active = false; };
  }, []);
  return <section className="mt-4 rounded-2xl border border-white/10 bg-[#24292e] p-4 sm:p-5">
    <label className="grid max-w-md gap-1 text-xs text-[#9fadbc]">Workspace
      <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-[#dee4ea]">
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    {!error && workspaceId && <SuindaWhatsAppSettings key={workspaceId} workspaceId={workspaceId} />}
    {!workspaces.length && !error && <p className="mt-3 text-xs text-[#9fadbc]">Carregando workspaces…</p>}
  </section>;
}

type CurriculumRecord = { id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> };
type Workspace = { id: string; name: string };

function FinancialNegotiationWorkspaceQueue() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void api<Workspace[]>("/workspaces").then((spaces) => {
      if (!active) return;
      setWorkspaces(spaces);
      setWorkspaceId(spaces[0]?.id || "");
      if (!spaces.length) setError("Nenhum workspace disponível para sua conta.");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os workspaces.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <section className="mt-4 rounded-2xl border border-violet-200/15 bg-[#2c333a] p-4 sm:p-5" aria-label="Workspace para negociação financeira">
    <label className="grid max-w-md gap-1 text-xs text-[#9fadbc]">Workspace
      <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={loading || workspaces.length === 0} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white">
        {workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
      </select>
    </label>
    {loading && <p className="mt-3 text-xs text-[#9fadbc]">Carregando workspaces…</p>}
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    {!loading && !error && workspaceId && <FinancialNegotiationManagement key={workspaceId} workspaceId={workspaceId} />}
  </section>;
}

type RetentionCandidate = { id: string; kind: string; title: string; state: string; created_at: string; due_at: string; purpose_code: string; data_categories: string[]; retention_description: string };

function RetentionReviewQueue() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [candidates, setCandidates] = useState<RetentionCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (selected: string, cursor?: string) => {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const result = await api<{ candidates: RetentionCandidate[]; total_count: number; next_cursor: string | null }>(
        `/extensions/suinda-learning/workspaces/${encodeURIComponent(selected)}/privacy-retention-candidates${query}`,
      );
      setCandidates((current) => {
        if (!cursor) return result.candidates;
        const known = new Set(current.map((item) => item.id));
        return [...current, ...result.candidates.filter((item) => !known.has(item.id))];
      });
      setTotal(result.total_count); setNextCursor(result.next_cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a fila de revisão."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void api<Workspace[]>("/workspaces").then((spaces) => {
      setWorkspaces(spaces);
      const initial = spaces[0]?.id || "";
      setWorkspaceId(initial);
      if (initial) void load(initial);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar os workspaces."));
  }, [load]);

  return <section className="mt-4 rounded-2xl border border-amber-200/15 bg-[#2c333a] p-4 sm:p-5" aria-labelledby="retention-review-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="retention-review-title" className="text-sm font-semibold text-white">Revisão de retenção</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Registros que ultrapassaram o prazo declarado por uma política publicada aparecem aqui para análise institucional. A fila não elimina nem altera históricos automaticamente; confira obrigações acadêmicas e legais antes de decidir.</p></div><span className="rounded-full bg-amber-100/10 px-2.5 py-1 text-xs text-amber-100">{total} para revisar</span></div>
    <label className="mt-3 inline-grid gap-1 text-[11px] text-[#9fadbc]">Workspace<select value={workspaceId} onChange={(event) => { const selected = event.target.value; setWorkspaceId(selected); setCandidates([]); setTotal(0); setNextCursor(null); void load(selected); }} disabled={loading} className="min-h-9 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#dee4ea]">{workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    {loading && !candidates.length && <p className="mt-3 text-xs text-[#9fadbc]" role="status">Carregando…</p>}
    {candidates.length ? <ul className="mt-3 grid gap-2">{candidates.map((item) => <li key={item.id} className="rounded-lg border border-[#3b4754] bg-white/[0.025] p-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium text-[#dee4ea]">{item.title}</span><time dateTime={item.due_at} className="text-xs text-amber-100">Prazo: {new Date(item.due_at).toLocaleDateString("pt-BR")}</time></div><p className="mt-1 text-xs text-[#9fadbc]">{item.kind} · finalidade {item.purpose_code} · categorias: {item.data_categories.join(" · ") || "não informadas"}</p><p className="mt-1 text-xs text-[#9fadbc]">{item.retention_description}</p></li>)}</ul> : !loading && !error && <p className="mt-3 text-xs text-[#9fadbc]">Nenhum registro vencido pela política publicada selecionada.</p>}
    {total > 0 && <p className="mt-2 text-xs text-[#9fadbc]" aria-live="polite">Exibindo {candidates.length} de {total} registros.</p>}
    {nextCursor && <button type="button" onClick={() => void load(workspaceId, nextCursor)} disabled={loading} className="mt-3 min-h-10 rounded-lg border border-[#566372] bg-[#363f48] px-3 text-xs font-medium text-[#dee4ea] hover:bg-[#414c57] disabled:cursor-wait disabled:opacity-60">{loading ? "Carregando…" : "Carregar mais"}</button>}
  </section>;
}

function CurriculumOrderEditor({ itemKind }: { itemKind: "module" | "learning_unit" | "lesson" }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [records, setRecords] = useState<CurriculumRecord[]>([]);
  const [courseId, setCourseId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [draftOrder, setDraftOrder] = useState<CurriculumRecord[]>([]);
  const [draggedId, setDraggedId] = useState("");
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (selectedWorkspace = workspaceId) => {
    if (!selectedWorkspace) return;
    const rows = await api<CurriculumRecord[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(selectedWorkspace)}/records`);
    setRecords(rows);
  }, [workspaceId]);

  useEffect(() => {
    void api<Workspace[]>("/workspaces").then((spaces) => {
      setWorkspaces(spaces);
      const initial = spaces[0]?.id || "";
      setWorkspaceId(initial);
      if (initial) void api<CurriculumRecord[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(initial)}/records`).then(setRecords).catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o currículo."));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os workspaces."));
  }, []);

  const courses = useMemo(() => records.filter((record) => record.kind === "course" && record.state !== "archived"), [records]);
  const selectedCourse = courses.find((course) => course.id === courseId);
  const modules = useMemo(() => records.filter((record) => record.kind === "module" && record.state !== "archived"
    && record.payload.course_record_id === courseId
    && (!selectedCourse || (record.payload.course_revision === undefined || Number(record.payload.course_revision) === selectedCourse.revision)
      && (record.payload.course_version === undefined || Number(record.payload.course_version) === Number(selectedCourse.payload.version || 1))))
    .sort((a, b) => Number(a.payload.position || 0) - Number(b.payload.position || 0) || a.id.localeCompare(b.id)), [records, courseId, selectedCourse]);
  const selectedModule = modules.find((module) => module.id === moduleId);
  const items = useMemo(() => itemKind === "module" ? modules : records.filter((record) => record.kind === (itemKind === "learning_unit" ? "learning_unit" : "lesson") && record.state !== "archived" && record.payload.module_record_id === moduleId)
    .sort((a, b) => Number(a.payload.position || 0) - Number(b.payload.position || 0) || a.id.localeCompare(b.id)), [itemKind, modules, records, moduleId]);
  const order = draftOrder.length ? draftOrder : items;

  async function changeWorkspace(next: string) {
    setWorkspaceId(next); setCourseId(""); setModuleId(""); setDraftOrder([]); setError(""); setMessage("");
    try { await load(next); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar o currículo."); }
  }

  function move(from: number, to: number) {
    if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return;
    setReorderAnnouncement(`${order[from].title} movido para a posição ${to + 1} de ${order.length}.`);
    setDraftOrder((current) => { const next = [...(current.length ? current : items)]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  }

  async function saveOrder() {
    if (busy || order.length < 2) return;
    const parentKind = itemKind === "module" ? "course" : "module";
    const parentId = itemKind === "module" ? courseId : moduleId;
    if (!parentId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await send(`/extensions/suinda-learning/curriculum/${parentKind}/${encodeURIComponent(parentId)}/reorder`, "POST", {
        operation_key: crypto.randomUUID(),
        ...(itemKind === "learning_unit" ? { child_kind: "learning_unit" } : {}),
        items: order.map((item) => ({ id: item.id, expected_revision: item.revision })),
      });
      setDraftOrder([]);
      await load();
      setMessage("Nova sequência pedagógica salva.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a sequência."); }
    finally { setBusy(false); }
  }

  return <section className="mt-4 rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-4 sm:p-5" aria-labelledby="curriculum-order-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="curriculum-order-title" className="text-sm font-semibold text-white">Sequência pedagógica · {itemKind === "module" ? "módulos" : itemKind === "learning_unit" ? "unidades" : "aulas"}</h2><p className="mt-1 text-xs text-[#9fadbc]">Arraste para reorganizar ou use os botões de posição. Cada item mantém seu histórico de versões.</p></div><button type="button" disabled={busy || order.length < 2 || !order.some((item, index) => item.id !== items[index]?.id)} onClick={() => void saveOrder()} className="min-h-9 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:opacity-50">{busy ? "Salvando…" : "Salvar sequência"}</button></div>
    <div className="mt-3 flex flex-wrap gap-2"><label className="grid gap-1 text-[11px] text-[#9fadbc]">Workspace<select value={workspaceId} onChange={(event) => void changeWorkspace(event.target.value)} className="min-h-9 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#dee4ea]">{workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label><label className="grid gap-1 text-[11px] text-[#9fadbc]">Curso<select value={courseId} onChange={(event) => { setCourseId(event.target.value); setModuleId(""); setDraftOrder([]); }} className="min-h-9 min-w-48 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#dee4ea]"><option value="">Selecione um curso</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>{itemKind !== "module" && <label className="grid gap-1 text-[11px] text-[#9fadbc]">Módulo<select value={moduleId} onChange={(event) => { setModuleId(event.target.value); setDraftOrder([]); }} className="min-h-9 min-w-48 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#dee4ea]"><option value="">Selecione um módulo</option>{modules.map((module) => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>}</div>
    {(itemKind === "module" ? courseId : moduleId) && <ol className="mt-3 grid gap-2" aria-label={itemKind === "module" ? "Ordem dos módulos" : itemKind === "learning_unit" ? "Ordem das unidades de aprendizagem" : "Ordem das aulas"}>{order.map((item, index) => <li key={item.id} draggable onDragStart={() => setDraggedId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = order.findIndex((row) => row.id === draggedId); move(from, index); setDraggedId(""); }} onDragEnd={() => setDraggedId("")} className={`flex min-h-12 items-center gap-2 rounded-lg border border-[#3b4754] bg-white/[0.025] px-3 ${draggedId === item.id ? "opacity-50" : ""}`}><span aria-hidden="true" className="cursor-grab text-[#9fadbc]">⠿</span><span className="min-w-0 flex-1 truncate text-sm text-[#b6c2cf]">{item.title}</span><span className="text-[10px] text-[#9fadbc]">{item.state === "published" ? "Publicado" : item.state === "scheduled" ? "Agendado" : "Rascunho"} · posição {index + 1} de {order.length}</span><button type="button" aria-label={`Mover ${item.title} para cima`} disabled={index === 0} onClick={() => move(index, index - 1)} className="min-h-8 rounded border border-[#3b4754] px-2 text-xs text-[#b6c2cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:opacity-40">↑</button><button type="button" aria-label={`Mover ${item.title} para baixo`} disabled={index === order.length - 1} onClick={() => move(index, index + 1)} className="min-h-8 rounded border border-[#3b4754] px-2 text-xs text-[#b6c2cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:opacity-40">↓</button></li>)}</ol>}
    {(itemKind === "module" ? courseId : moduleId) && <p className="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</p>}
    {!order.length && <p className="mt-3 text-xs text-[#9fadbc]">{itemKind === "module" ? "Selecione um curso para ordenar seus módulos." : selectedCourse && !selectedModule ? "Selecione um módulo para continuar." : selectedModule ? `Este módulo ainda não tem ${itemKind === "learning_unit" ? "unidades de aprendizagem" : "aulas"} ativas.` : "Selecione um curso e módulo para continuar."}</p>}
    {message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}
  </section>;
}
