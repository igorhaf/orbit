"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type Enrollment = {
  id: string; workspace_id: string; title: string; state: string; payload: { course_record_id?: string; course_revision?: number };
};
type Course = { id: string; title: string; kind: string; state: string; revision: number };
type CoursePair = { source_course_id: string; target_course_id: string };
type Policy = {
  version: number; enabled: boolean; eligible_course_pairs: CoursePair[]; max_hours_per_target: number | null;
  validity_days: number | null; created_by: string | null; created_at: string | null;
};
type AuditEvent = { event_type: string; actor_user_id: string; details: Record<string, unknown>; created_at: string };
type LedgerEntry = {
  practice_record_id: string; source_enrollment_id: string; source_course_revision: number; target_enrollment_id: string;
  target_course_revision: number; policy_version: number; hours_credited: number; credited_by: string; credited_at: string;
};
type CreditRequest = {
  id: string; workspace_id: string; source_enrollment_id: string; source_course_revision: number; target_enrollment_id: string;
  target_course_revision: number; requested_hours: number; policy_version: number; status: string; reviewed_by: string | null;
  reviewed_at: string | null; decision_note: string | null; created_at: string; source_title: string; target_title: string;
  learner_name?: string; hours_credited: number; ledger_entries: LedgerEntry[]; audit_events: AuditEvent[];
};
type Workspace = { id: string; name: string };

const stateNames: Record<string, string> = { pending: "Aguardando coordenação", approved: "Aprovado", rejected: "Rejeitado" };
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const hours = (value: number) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h`;
const control = "min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50";

export function LearnerPracticeCredit({ enrollments }: { enrollments: Enrollment[] }) {
  const [requests, setRequests] = useState<CreditRequest[]>([]);
  const [policies, setPolicies] = useState<Record<string, Policy | null>>({});
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [requestedHours, setRequestedHours] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submitLock = useRef(false);
  const [operationKey, setOperationKey] = useState("");

  const loadRequests = useCallback(async () => {
    const result = await api<CreditRequest[]>("/extensions/suinda-learning/me/practice-credit-requests");
    setRequests(result);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const workspaceIds = [...new Set(enrollments.map((enrollment) => enrollment.workspace_id))];
    Promise.all([
      api<CreditRequest[]>("/extensions/suinda-learning/me/practice-credit-requests"),
      Promise.all(workspaceIds.map(async (workspaceId) => {
        try {
          const policy = await api<Policy>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/practice-credit-policy`);
          return [workspaceId, policy] as const;
        } catch { return [workspaceId, null] as const; }
      })),
    ]).then(([requestRows, policyRows]) => {
      if (!cancelled) { setRequests(requestRows); setPolicies(Object.fromEntries(policyRows)); }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível carregar suas solicitações de crédito.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enrollments, loadRequests]);

  const sources = useMemo(() => enrollments.filter((item) => item.state === "completed" && item.payload.course_record_id), [enrollments]);
  const targets = useMemo(() => enrollments.filter((item) => ["submitted", "approved", "enrolled", "active"].includes(item.state) && item.payload.course_record_id), [enrollments]);
  const source = sources.find((item) => item.id === sourceId);
  const target = targets.find((item) => item.id === targetId);
  const policy = target ? policies[target.workspace_id] : null;
  const eligible = Boolean(source && target && source.workspace_id === target.workspace_id && policy?.enabled
    && policy.eligible_course_pairs.some((pair) => pair.source_course_id === source.payload.course_record_id && pair.target_course_id === target.payload.course_record_id));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current || !source || !target || !eligible || Number(requestedHours) <= 0) return;
    submitLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const nextOperationKey = operationKey || crypto.randomUUID();
      setOperationKey(nextOperationKey);
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(target.id)}/practice-credit-requests`, {
        method: "POST", body: JSON.stringify({ operation_key: nextOperationKey, source_enrollment_id: source.id, requested_hours: Number(requestedHours) }),
      });
      setRequestedHours("");
      setOperationKey("");
      setMessage("Solicitação registrada. A coordenação revisará as horas validadas e a equivalência curricular.");
      await loadRequests();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar a solicitação."); }
    finally { submitLock.current = false; setBusy(false); }
  }

  if (!enrollments.length && requests.length === 0 && !loading) return null;
  return <section aria-labelledby="learner-practice-credit-title" className="mt-7 rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-5 sm:p-6">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Aproveitamento acadêmico</p><h2 id="learner-practice-credit-title" className="mt-1 text-lg font-semibold text-white">Crédito de horas práticas</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Peça a análise de horas de uma prática supervisionada já validada para outra matrícula. A coordenação confere a equivalência e o saldo disponível antes de aprovar; enviar o pedido não altera sua carga horária.</p></div>
    {sources.length > 0 && targets.length > 0 && <form onSubmit={submit} aria-busy={busy} className="mt-4 grid gap-3 rounded-xl border border-white/[0.08] bg-black/10 p-4 md:grid-cols-2">
      <label className="grid gap-1 text-xs font-medium text-[#b6c2cf]">Matrícula de origem<select className={control} value={sourceId} onChange={(event) => { setSourceId(event.target.value); setOperationKey(""); }} required disabled={busy}><option value="">Selecione uma formação concluída</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.title} · revisão {item.payload.course_revision || "—"}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-[#b6c2cf]">Matrícula de destino<select className={control} value={targetId} onChange={(event) => { setTargetId(event.target.value); setOperationKey(""); }} required disabled={busy}><option value="">Selecione a matrícula futura</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.title} · {stateNames[item.state] || item.state}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-[#b6c2cf]">Horas solicitadas<input className={control} type="number" min="0.01" max={policy?.max_hours_per_target || 10000} step="0.01" value={requestedHours} onChange={(event) => { setRequestedHours(event.target.value); setOperationKey(""); }} required disabled={busy || !eligible} /></label>
      <div className="flex items-end"><button type="submit" disabled={busy || !eligible || !requestedHours || Number(requestedHours) <= 0} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Enviando solicitação…" : "Solicitar análise"}</button></div>
      <p className="text-xs leading-5 text-[#9fadbc] md:col-span-2">{!source || !target ? "Escolha as matrículas para consultar a elegibilidade." : source.workspace_id !== target.workspace_id ? "As matrículas precisam pertencer ao mesmo workspace." : !policy ? "A política institucional não está disponível para consulta; não é possível enviar pedidos." : !policy.enabled ? "A política institucional está desativada. A coordenação precisa configurar equivalência, validade e limite antes de habilitar solicitações." : !eligible ? "Esta equivalência de cursos não está autorizada pela política vigente." : `Política v${policy.version} · validade de ${policy.validity_days} dias · limite de ${hours(policy.max_hours_per_target || 0)} por matrícula futura. O saldo efetivo será conferido pela coordenação.`}</p>
    </form>}
    {sources.length === 0 && <p className="mt-4 text-sm text-[#9fadbc]">Uma solicitação exige matrícula de origem concluída com prática supervisionada validada.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-emerald-200">{message}</p>}
    <div className="mt-5 border-t border-white/[0.08] pt-4"><h3 className="text-sm font-semibold text-[#dee4ea]">Meus pedidos</h3>{loading ? <p role="status" className="mt-2 text-sm text-[#9fadbc]">Carregando pedidos…</p> : requests.length ? <ul className="mt-3 grid gap-3">{requests.map((item) => <CreditRequestCard key={item.id} item={item} />)}</ul> : <p className="mt-2 text-sm text-[#9fadbc]">Você ainda não solicitou crédito de horas práticas.</p>}</div>
  </section>;
}

export function PracticeCreditManagement() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [requests, setRequests] = useState<CreditRequest[]>([]);
  const [pairs, setPairs] = useState<CoursePair[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [maxHours, setMaxHours] = useState("40");
  const [validityDays, setValidityDays] = useState("365");
  const [pairSource, setPairSource] = useState("");
  const [pairTarget, setPairTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [workingRequest, setWorkingRequest] = useState("");
  const actionLock = useRef(false);

  const load = useCallback(async (selected: string) => {
    if (!selected) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const [nextPolicy, rows, queue] = await Promise.all([
        api<Policy>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(selected)}/practice-credit-policy`),
        api<Course[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(selected)}/records`),
        api<CreditRequest[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(selected)}/practice-credit-requests`),
      ]);
      setPolicy(nextPolicy); setCourses(rows.filter((row) => row.kind === "course" && row.state !== "archived"));
      setPairs(nextPolicy.eligible_course_pairs || []); setEnabled(nextPolicy.enabled); setMaxHours(String(nextPolicy.max_hours_per_target ?? 40)); setValidityDays(String(nextPolicy.validity_days ?? 365)); setRequests(queue);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar política e pedidos do workspace."); setPolicy(null); setCourses([]); setRequests([]); }
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

  function addPair() {
    if (!pairSource || !pairTarget || pairSource === pairTarget || pairs.some((pair) => pair.source_course_id === pairSource && pair.target_course_id === pairTarget)) return;
    setPairs((current) => [...current, { source_course_id: pairSource, target_course_id: pairTarget }]);
    setPairSource(""); setPairTarget("");
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    if (busy || !workspaceId || enabled && pairs.length === 0) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await api<Policy>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/practice-credit-policy`, {
        method: "PUT", body: JSON.stringify({ enabled, eligible_course_pairs: pairs, max_hours_per_target: Number(maxHours), validity_days: Number(validityDays) }),
      });
      await load(workspaceId);
      setMessage(`Política v${saved.version} registrada. A versão anterior continua preservada para auditoria.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a política."); }
    finally { setBusy(false); }
  }

  async function decide(request: CreditRequest, decision: "approved" | "rejected") {
    if (actionLock.current || decision === "rejected" && !decisionNotes[request.id]?.trim()) return;
    actionLock.current = true;
    setWorkingRequest(request.id); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/practice-credit-requests/${encodeURIComponent(request.id)}/review`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), decision, decision_note: decisionNotes[request.id]?.trim() || undefined }),
      });
      await load(workspaceId);
      setMessage(decision === "approved" ? "Crédito registrado no histórico da matrícula futura." : "Solicitação rejeitada e decisão registrada.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a decisão."); }
    finally { actionLock.current = false; setWorkingRequest(""); }
  }

  const courseName = (courseId: string) => courses.find((course) => course.id === courseId)?.title || "Curso indisponível";
  return <section aria-labelledby="practice-credit-management-title" className="mt-4 rounded-2xl border border-violet-200/15 bg-[#2c333a] p-4 sm:p-5">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-200">Gestão acadêmica</p><h2 id="practice-credit-management-title" className="mt-1 text-lg font-semibold text-white">Crédito de práticas supervisionadas</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Defina equivalências explícitas entre cursos, validade das horas e o limite por matrícula futura. Cada salvamento cria uma nova versão; uma política desativada ou não configurada bloqueia pedidos e aprovações.</p></div>
    <label className="mt-4 inline-grid gap-1 text-xs font-medium text-[#b6c2cf]">Workspace<select aria-label="Workspace da política de crédito" className={`${control} min-w-64`} value={workspaceId} disabled={busy || loading} onChange={(event) => { setWorkspaceId(event.target.value); void load(event.target.value); }}><option value="">Selecione um workspace</option>{workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-emerald-200">{message}</p>}
    {loading ? <p role="status" className="mt-4 text-sm text-[#9fadbc]">Carregando configuração e pedidos…</p> : policy && <>
      <form onSubmit={savePolicy} aria-busy={busy} className="mt-4 grid gap-4 rounded-xl border border-white/[0.08] bg-black/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-[#dee4ea]">Política institucional</h3><p className="mt-1 text-xs text-[#9fadbc]">Versão atual: {policy.version || "ainda não configurada"}{policy.created_at ? ` · criada em ${dateTime(policy.created_at)}` : ""}</p></div><label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#3b4754] px-3 text-sm text-[#b6c2cf]"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="size-4 accent-cyan-200" />Política ativa</label></div>
        <fieldset className="grid gap-3"><legend className="text-xs font-semibold text-[#b6c2cf]">Equivalências curriculares permitidas</legend><p className="text-xs leading-5 text-[#9fadbc]">Cada linha autoriza horas de práticas validadas no curso de origem para um curso de destino. A revisão curricular de cada matrícula fica registrada no pedido e no ledger.</p><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><label className="grid gap-1 text-xs text-[#b6c2cf]">Curso de origem<select className={control} value={pairSource} onChange={(event) => setPairSource(event.target.value)} disabled={busy}><option value="">Selecione</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label className="grid gap-1 text-xs text-[#b6c2cf]">Curso de destino<select className={control} value={pairTarget} onChange={(event) => setPairTarget(event.target.value)} disabled={busy}><option value="">Selecione</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><button type="button" onClick={addPair} disabled={busy || !pairSource || !pairTarget || pairSource === pairTarget || pairs.some((pair) => pair.source_course_id === pairSource && pair.target_course_id === pairTarget)} className="min-h-10 self-end rounded-lg border border-cyan-200/20 px-3 text-xs font-medium text-cyan-100 disabled:opacity-50">Adicionar equivalência</button></div>
          {pairs.length ? <ul className="grid gap-2 sm:grid-cols-2">{pairs.map((pair) => <li key={`${pair.source_course_id}:${pair.target_course_id}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs"><span className="text-[#b6c2cf]">{courseName(pair.source_course_id)} <span aria-hidden="true" className="text-cyan-200">→</span> {courseName(pair.target_course_id)}</span><button type="button" aria-label={`Remover equivalência de ${courseName(pair.source_course_id)} para ${courseName(pair.target_course_id)}`} onClick={() => setPairs((current) => current.filter((entry) => entry !== pair))} disabled={busy} className="min-h-8 rounded border border-rose-200/15 px-2 text-rose-100 disabled:opacity-50">Remover</button></li>)}</ul> : <p className="rounded-lg border border-amber-200/10 bg-amber-200/[0.03] p-3 text-xs text-amber-100">Sem equivalências configuradas. Não será possível solicitar nem aprovar créditos.</p>}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-medium text-[#b6c2cf]">Limite de horas por matrícula futura<input className={control} type="number" min="0.01" max="10000" step="0.01" value={maxHours} onChange={(event) => setMaxHours(event.target.value)} required disabled={busy} /></label><label className="grid gap-1 text-xs font-medium text-[#b6c2cf]">Validade das horas após validação (dias)<input className={control} type="number" min="1" max="3650" step="1" value={validityDays} onChange={(event) => setValidityDays(event.target.value)} required disabled={busy} /></label></div>
        <p className="text-xs leading-5 text-[#9fadbc]">O sistema exige decisão da coordenação. Ele não define equivalência por conta própria nem permite reaproveitar a mesma hora mais de uma vez. Uma nova versão da política invalida pedidos pendentes criados sob a versão anterior para aprovação.</p>
        <button type="submit" disabled={busy || !workspaceId || enabled && pairs.length === 0 || !Number(maxHours) || !Number(validityDays)} className="min-h-10 justify-self-start rounded-lg bg-violet-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{busy ? "Salvando…" : "Salvar nova versão"}</button>
      </form>
      <div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-[#dee4ea]">Pedidos para revisão</h3><span className="text-xs text-[#9fadbc]">{requests.filter((item) => item.status === "pending").length} pendentes</span></div>{requests.length ? <ul className="mt-3 grid gap-3">{requests.map((item) => <li key={item.id}><CreditRequestCard item={item} coordinator approvalAllowed={Boolean(policy.enabled && policy.version === item.policy_version)} decisionNote={decisionNotes[item.id] || ""} onDecisionNote={(value) => setDecisionNotes((current) => ({ ...current, [item.id]: value }))} onDecision={(decision) => void decide(item, decision)} decisionBusy={workingRequest === item.id} /></li>)}</ul> : <p className="mt-2 text-sm text-[#9fadbc]">Nenhum pedido neste workspace.</p>}</div>
    </>}
  </section>;
}

function CreditRequestCard({ item, coordinator = false, approvalAllowed = false, decisionNote, onDecisionNote, onDecision, decisionBusy = false }: {
  item: CreditRequest; coordinator?: boolean; approvalAllowed?: boolean; decisionNote?: string;
  onDecisionNote?: (value: string) => void; onDecision?: (decision: "approved" | "rejected") => void; decisionBusy?: boolean;
}) {
  return <article className="rounded-xl border border-white/[0.08] bg-black/10 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-sm font-medium text-white">{coordinator ? item.learner_name || "Estudante" : `${item.source_title} → ${item.target_title}`}</h4><p className="mt-1 text-xs text-[#9fadbc]">{coordinator ? `${item.source_title} → ${item.target_title} · ` : ""}Revisões curriculares ${item.source_course_revision} → ${item.target_course_revision} · política v{item.policy_version}</p><p className="mt-1 text-xs text-[#9fadbc]">Solicitado {hours(item.requested_hours)} · {dateTime(item.created_at)}{item.reviewed_at ? ` · decidido ${dateTime(item.reviewed_at)}` : ""}</p></div><span role="status" className={`rounded-full px-3 py-1.5 text-xs ${item.status === "approved" ? "bg-emerald-200/10 text-emerald-100" : item.status === "rejected" ? "bg-rose-200/10 text-rose-100" : "bg-amber-200/10 text-amber-100"}`}>{stateNames[item.status] || item.status}</span></div>
    {item.decision_note && <p className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-xs leading-5 text-[#b6c2cf]">Nota da decisão: {item.decision_note}</p>}
    {item.ledger_entries?.length > 0 && <div className="mt-3 rounded-lg border border-emerald-200/10 bg-emerald-200/[0.03] p-3"><p className="text-xs font-semibold text-emerald-100">Ledger de crédito · {hours(item.hours_credited)}</p><ul className="mt-2 grid gap-1.5">{item.ledger_entries.map((entry) => <li key={entry.practice_record_id} className="break-all text-[11px] leading-5 text-[#b6c2cf]">Prática {entry.practice_record_id} · matrícula de origem {entry.source_enrollment_id} (rev. {entry.source_course_revision}) · destino {entry.target_enrollment_id} (rev. {entry.target_course_revision}) · {hours(entry.hours_credited)} · política v{entry.policy_version} · {dateTime(entry.credited_at)}</li>)}</ul></div>}
    {item.audit_events?.length > 0 && <details className="mt-3 rounded-lg border border-white/[0.08] p-3"><summary className="cursor-pointer text-xs font-medium text-cyan-100">Histórico auditável ({item.audit_events.length} eventos)</summary><ol className="mt-2 grid gap-2">{item.audit_events.map((event, index) => <li key={`${event.event_type}:${event.created_at}:${index}`} className="text-[11px] leading-5 text-[#9fadbc]"><span className="font-medium text-[#b6c2cf]">{event.event_type === "requested" ? "Solicitado" : event.event_type === "approved" ? "Aprovado" : "Rejeitado"}</span> · {dateTime(event.created_at)} · responsável {event.actor_user_id}{typeof event.details.hours_credited === "number" ? ` · ${hours(event.details.hours_credited)} creditadas` : ""}</li>)}</ol></details>}
    {coordinator && item.status === "pending" && <div className="mt-3 border-t border-white/[0.08] pt-3"><label className="grid gap-1 text-xs font-medium text-[#b6c2cf]">Justificativa da coordenação<textarea className={`${control} min-h-20 py-2`} maxLength={4000} value={decisionNote || ""} onChange={(event) => onDecisionNote?.(event.target.value)} placeholder="Obrigatória para rejeitar; opcional para aprovar." disabled={decisionBusy} /></label>{!approvalAllowed && <p className="mt-2 text-xs leading-5 text-amber-100">A aprovação está bloqueada: a política está desativada ou o pedido pertence a uma versão anterior. Rejeite ou solicite que o aluno envie novo pedido sob a política vigente.</p>}<div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => onDecision?.("approved")} disabled={decisionBusy || !approvalAllowed} className="min-h-9 rounded-lg bg-emerald-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">{decisionBusy ? "Registrando…" : "Aprovar horas"}</button><button type="button" onClick={() => onDecision?.("rejected")} disabled={decisionBusy || !decisionNote?.trim()} className="min-h-9 rounded-lg border border-rose-200/20 px-3 text-xs font-medium text-rose-100 disabled:opacity-50">Rejeitar com justificativa</button><p aria-live="polite" role="status" className="sr-only">{decisionBusy ? "Registrando decisão acadêmica…" : ""}</p></div></div>}
  </article>;
}
