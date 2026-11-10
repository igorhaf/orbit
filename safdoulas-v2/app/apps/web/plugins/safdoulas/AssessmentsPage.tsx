"use client";

import { useEffect, useState } from "react";
import { AccessShell, accessButton, accessInput, accessPanel } from "@/components/access-shell";
import { api, authenticatedBlob, User, Workspace } from "@/lib/api";

type RecordRow = { id: string; kind: string; state: string; title: string; revision: number; payload: Record<string, unknown> };
type SuggestedEvaluator = { user_id: string; name: string; profile_record_id: string; profile_revision: number; region_code: string; active_assignments: number; max_parallel_assignments: number; total_assignments: number; matched_expertise: string[] };
type Recommendation = { process: { id: string; revision: number; protocol_number: string }; matrix: { id: string; revision: number }; blinded_projection_refs: Array<{ record_id: string; revision: number }>; eligible_count: number; pairs: Array<{ reasons: string[]; evaluators: SuggestedEvaluator[] }> };
type AssessmentTask = {
  assignment: { id: string; revision: number; kind: string; role: "first" | "second" | "third" };
  process: { protocol_number: string };
  matrix: { id: string; revision: number; dimensions: Array<{ code: string; title?: string; name?: string; criteria: Array<{ code: string; title?: string; name?: string; label?: string; evidence_required?: boolean; justification_required?: boolean }> }> };
  blinded_documents: Array<{ record_id: string; revision: number; label: string; mime_type?: string }>;
  evaluation: RecordRow | null;
};
type Answer = { criterion_code: string; outcome: string; justification: string; observation: string; evidence: Array<{ record_id: string; revision: number }> };
type EvaluationDraft = {
  answers: Answer[];
  dimension_summaries: Array<{ dimension_code: string; summary: string }>;
  strengths: string[];
  fragilities: string[];
  inconsistencies: string[];
  diligence_items: Array<{ request: string; rationale: string; evidence_reference?: string }>;
  preliminary_opinion: string;
};
type EvaluationSnapshot = { id: string; revision: number; payload: Record<string, unknown> };
type Divergence = { criterion_code: string; first_outcome: string; second_outcome: string; substantial: boolean; rationale: string };
type ConsolidationPayload = {
  process_record_id: string; process_revision: number; matrix_record_id: string; matrix_revision: number;
  first_evaluation_record_id: string; first_evaluation_revision: number; second_evaluation_record_id: string; second_evaluation_revision: number;
  divergences: Divergence[]; third_evaluation_record_id: string | null; third_evaluation_revision: number | null;
  synthesis: string; strengths: string[]; fragilities: string[];
  diligence_items: Array<{ request: string; rationale: string; evidence_reference: string }>;
  conclusion: string; final_opinion_template_record_id: string | null; final_opinion_template_revision: number | null;
  signature_reference: string; signed_at: string | null;
};
type ReadyConsolidation = {
  assignment: { id: string; revision: number; state: string }; assignment_payload: Record<string, unknown>;
  process: { protocol_number: string }; matrix: { id: string; revision: number; dimensions: AssessmentTask["matrix"]["dimensions"] };
  first: EvaluationSnapshot; second: EvaluationSnapshot; divergences: Divergence[];
  consolidation: (RecordRow & { payload: ConsolidationPayload }) | null;
};
type ThirdCandidate = { user_id: string; name: string; profile_record_id: string; profile_revision: number; region_code: string; active_assignments: number; total_assignments: number; max_parallel_assignments: number };
type ThirdCandidateResult = { candidates: ThirdCandidate[]; assignment: { id: string; revision: number; state: string; evaluator_name: string } | null };
type ThirdReviewResult = { evaluation: RecordRow; assignment: { id: string; revision: number; state: string } };
type ConsolidationWork = { ready: ReadyConsolidation; record: RecordRow | null; payload: ConsolidationPayload };
const plugin = "safdoulas-assessments";
const operationKey = () => crypto.randomUUID();
const emptyDraft = (): EvaluationDraft => ({ answers: [], dimension_summaries: [], strengths: [], fragilities: [], inconsistencies: [], diligence_items: [], preliminary_opinion: "" });
const stringLines = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
function draftFromRecord(record: RecordRow | null): EvaluationDraft {
  if (!record) return emptyDraft();
  const payload = record.payload;
  return {
    answers: Array.isArray(payload.answers) ? payload.answers as Answer[] : [],
    dimension_summaries: Array.isArray(payload.dimension_summaries) ? payload.dimension_summaries as EvaluationDraft["dimension_summaries"] : [],
    strengths: stringLines(payload.strengths), fragilities: stringLines(payload.fragilities), inconsistencies: stringLines(payload.inconsistencies),
    diligence_items: Array.isArray(payload.diligence_items) ? payload.diligence_items as EvaluationDraft["diligence_items"] : [],
    preliminary_opinion: typeof payload.preliminary_opinion === "string" ? payload.preliminary_opinion : "",
  };
}

export default function SafdoulasAssessmentsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [processes, setProcesses] = useState<RecordRow[]>([]);
  const [processId, setProcessId] = useState("");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [assignments, setAssignments] = useState<AssessmentTask[]>([]);
  const [activeTask, setActiveTask] = useState<AssessmentTask | null>(null);
  const [draft, setDraft] = useState<EvaluationDraft>(emptyDraft);
  const [readyConsolidations, setReadyConsolidations] = useState<ReadyConsolidation[]>([]);
  const [consolidationWork, setConsolidationWork] = useState<ConsolidationWork | null>(null);
  const [thirdCandidates, setThirdCandidates] = useState<ThirdCandidate[]>([]);
  const [thirdAssignment, setThirdAssignment] = useState<ThirdCandidateResult["assignment"]>(null);
  const [thirdCandidateId, setThirdCandidateId] = useState("");
  const [selectedPair, setSelectedPair] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([api<User>("/auth/me"), api<Workspace[]>("/workspaces")])
      .then(([account, spaces]) => {
        if (!active) return;
        setUser(account);
        setWorkspaces(spaces);
        setWorkspaceId((current) => current || spaces[0]?.id || "");
        setLoading(false);
      })
      .catch((reason) => { if (active) { setError((reason as Error).message); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workspaceId || !user) return;
    let active = true;
    const canManage = Boolean(user.is_root || user.permissions?.includes("plugin.safdoulas-assessments.manage"));
    const canReview = Boolean(user.is_root || user.permissions?.includes("plugin.safdoulas-assessments.read"));
    const requests: Promise<unknown>[] = [];
    if (canManage) requests.push(api<RecordRow[]>(`/extensions/safdoulas-processes/workspaces/${workspaceId}/records`).then((rows) => {
      if (!active) return;
      const review = rows.filter((record) => record.kind === "accreditation_process" && record.state === "review");
      setProcesses(review);
      setProcessId((current) => review.some((item) => item.id === current) ? current : review[0]?.id || "");
    }));
    if (canManage) requests.push(api<ReadyConsolidation[]>(`/safdoulas/assessments/workspaces/${workspaceId}/ready-to-consolidate`).then((rows) => { if (active) setReadyConsolidations(rows); }));
    else requests.push(Promise.resolve().then(() => { if (active) { setProcesses([]); setProcessId(""); } }));
    if (canReview) requests.push(api<AssessmentTask[]>(`/safdoulas/assessments/workspaces/${workspaceId}/my-assignments`).then((rows) => { if (active) setAssignments(rows); }));
    else requests.push(Promise.resolve().then(() => { if (active) { setAssignments([]); setActiveTask(null); setReadyConsolidations([]); } }));
    Promise.all(requests).catch((reason) => { if (active) setError((reason as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, user]);

  async function refreshAssignments() {
    if (!workspaceId) return;
    const rows = await api<AssessmentTask[]>(`/safdoulas/assessments/workspaces/${workspaceId}/my-assignments`);
    setAssignments(rows);
  }

  async function completeEvaluatorPair(ready: ReadyConsolidation) {
    setWorking(true); setError(""); setNotice("");
    try {
      await api<RecordRow>(`/extensions/${plugin}/records/${ready.assignment.id}/transitions`, { method: "POST", body: JSON.stringify({ state: "completed", expected_revision: ready.assignment.revision, reason: "As duas avaliações independentes foram submetidas e conferidas pela administração.", operation_key: operationKey() }) });
      setNotice("Distribuição concluída; o acesso ao material cegado foi revogado automaticamente.");
      setReadyConsolidations(await api<ReadyConsolidation[]>(`/safdoulas/assessments/workspaces/${workspaceId}/ready-to-consolidate`));
    } catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }

  async function startEvaluation(task: AssessmentTask) {
    if (!workspaceId) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const started = await api<AssessmentTask>(`/safdoulas/assessments/workspaces/${workspaceId}/assignments/${task.assignment.id}/start`, { method: "POST", body: JSON.stringify({ operation_key: operationKey() }) });
      setActiveTask(started); setDraft(draftFromRecord(started.evaluation));
    } catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }

  function updateAnswer(code: string, update: Partial<Answer>) {
    setDraft((current) => {
      const existing = current.answers.find((answer) => answer.criterion_code === code);
      if (!existing && !update.outcome) return current;
      const next: Answer = existing ? { ...existing, ...update } : { criterion_code: code, outcome: update.outcome || "A", justification: "", observation: "", evidence: [], ...update };
      return { ...current, answers: [...current.answers.filter((answer) => answer.criterion_code !== code), next] };
    });
  }

  function evaluationPayload() {
    if (!activeTask?.evaluation) return null;
    return {
      ...activeTask.evaluation.payload,
      answers: draft.answers,
      dimension_summaries: draft.dimension_summaries.filter((item) => item.summary.trim()),
      strengths: draft.strengths.filter((item) => item.trim()), fragilities: draft.fragilities.filter((item) => item.trim()),
      inconsistencies: draft.inconsistencies.filter((item) => item.trim()), diligence_items: draft.diligence_items.filter((item) => item.request.trim() && item.rationale.trim()),
      preliminary_opinion: draft.preliminary_opinion,
    };
  }

  async function saveEvaluation(submit: boolean) {
    if (!activeTask?.evaluation || !workspaceId) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const current = activeTask.evaluation;
      const saved = await api<RecordRow>(`/extensions/${plugin}/records/${current.id}/versions`, {
        method: "POST",
        body: JSON.stringify({ title: current.title, payload: evaluationPayload(), expected_revision: current.revision, reason: submit ? "Preparação da avaliação individual para submissão." : "Salvamento do rascunho da avaliação individual.", operation_key: operationKey() }),
      });
      if (submit) {
        const completed = await api<RecordRow>(`/extensions/${plugin}/records/${saved.id}/transitions`, {
          method: "POST",
          body: JSON.stringify({ state: "submitted", expected_revision: saved.revision, reason: "Avaliação individual submetida pela acreditadora designada.", operation_key: operationKey() }),
        });
        setActiveTask({ ...activeTask, evaluation: completed }); setDraft(draftFromRecord(completed));
        setNotice("Avaliação enviada. A versão submetida fica preservada no histórico.");
      } else {
        setActiveTask({ ...activeTask, evaluation: saved }); setDraft(draftFromRecord(saved));
        setNotice("Rascunho salvo.");
      }
      await refreshAssignments();
    } catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }

  function initialConsolidation(ready: ReadyConsolidation): ConsolidationPayload {
    const first = ready.first.payload;
    return {
      process_record_id: String(first.process_record_id), process_revision: Number(first.process_revision),
      matrix_record_id: String(first.matrix_record_id), matrix_revision: Number(first.matrix_revision),
      first_evaluation_record_id: ready.first.id, first_evaluation_revision: ready.first.revision,
      second_evaluation_record_id: ready.second.id, second_evaluation_revision: ready.second.revision,
      divergences: ready.divergences.map((item) => ({ ...item })),
      third_evaluation_record_id: null, third_evaluation_revision: null,
      synthesis: "", strengths: [], fragilities: [], diligence_items: [], conclusion: "",
      final_opinion_template_record_id: null, final_opinion_template_revision: null, signature_reference: "", signed_at: null,
    };
  }

  async function openConsolidation(ready: ReadyConsolidation) {
    const row = ready.consolidation;
    const record = row ? { id: row.id, kind: "evaluation_consolidation", state: row.state, revision: row.revision, title: `Consolidação · ${ready.process.protocol_number}`, payload: row.payload } : null;
    setConsolidationWork({ ready, record, payload: row?.payload || initialConsolidation(ready) });
    setThirdCandidates([]); setThirdCandidateId(""); setThirdAssignment(null);
    if (row && row.state === "draft" && row.payload.divergences.some((item) => item.substantial)) {
      try {
        const result = await api<ThirdCandidateResult>(`/safdoulas/assessments/workspaces/${workspaceId}/consolidations/${row.id}/third-candidates`);
        setThirdCandidates(result.candidates); setThirdCandidateId(result.candidates[0]?.user_id || ""); setThirdAssignment(result.assignment);
      } catch (reason) { setError((reason as Error).message); }
    }
  }

  async function saveConsolidation() {
    if (!consolidationWork || !workspaceId) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const { ready, record, payload } = consolidationWork;
      const saved = record
        ? await api<RecordRow>(`/extensions/${plugin}/records/${record.id}/versions`, { method: "POST", body: JSON.stringify({ title: record.title, payload, expected_revision: record.revision, reason: "Consolidação comparativa das avaliações independentes.", operation_key: operationKey() }) })
        : await api<RecordRow>(`/extensions/${plugin}/workspaces/${workspaceId}/records`, { method: "POST", body: JSON.stringify({ kind: "evaluation_consolidation", title: `Consolidação · ${ready.process.protocol_number || ready.assignment.id.slice(0, 8)}`, payload, operation_key: operationKey() }) });
      const updated = { ...consolidationWork, record: saved };
      setConsolidationWork(updated);
      if (!payload.divergences.some((item) => item.substantial)) {
        const completed = await api<RecordRow>(`/extensions/${plugin}/records/${saved.id}/transitions`, { method: "POST", body: JSON.stringify({ state: "completed", expected_revision: saved.revision, reason: "Consolidação sem divergência substancial, revisada pela administração.", operation_key: operationKey() }) });
        setNotice("Consolidação concluída e preservada no histórico."); setConsolidationWork(null);
        const rows = await api<ReadyConsolidation[]>(`/safdoulas/assessments/workspaces/${workspaceId}/ready-to-consolidate`); setReadyConsolidations(rows);
        void completed;
      } else {
        const result = await api<ThirdCandidateResult>(`/safdoulas/assessments/workspaces/${workspaceId}/consolidations/${saved.id}/third-candidates`);
        setThirdCandidates(result.candidates); setThirdCandidateId(result.candidates[0]?.user_id || ""); setThirdAssignment(result.assignment);
        setNotice(result.assignment ? `Terceira avaliação atribuída a ${result.assignment.evaluator_name}.` : result.candidates.length ? "Rascunho salvo. Selecione uma terceira acreditadora elegível para a divergência substancial." : "Rascunho salvo. Não há terceira acreditadora elegível no momento.");
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }

  async function assignThirdReviewer() {
    if (!consolidationWork?.record || !thirdCandidateId || !workspaceId) return;
    const candidate = thirdCandidates.find((item) => item.user_id === thirdCandidateId);
    if (!candidate) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const { ready, record } = consolidationWork;
      const created = await api<RecordRow>(`/extensions/${plugin}/workspaces/${workspaceId}/records`, { method: "POST", body: JSON.stringify({
        kind: "third_review_assignment", title: `Terceira avaliação · ${ready.process.protocol_number || ready.assignment.id.slice(0, 8)}`, operation_key: operationKey(),
        payload: {
          process_record_id: consolidationWork.payload.process_record_id, process_revision: consolidationWork.payload.process_revision,
          matrix_record_id: consolidationWork.payload.matrix_record_id, matrix_revision: consolidationWork.payload.matrix_revision,
          consolidation_record_id: record.id, consolidation_revision: record.revision,
          evaluator_profile_ref: { user_id: candidate.user_id, record_id: candidate.profile_record_id, revision: candidate.profile_revision },
          blinded_projection_refs: ready.assignment_payload.blinded_projection_refs,
          evaluator_user_id: candidate.user_id, assigned_at: new Date().toISOString(),
          assignment_note: "Terceira avaliação atribuída após divergência substancial registrada na consolidação.",
        },
      }) });
      const assigned = await api<RecordRow>(`/extensions/${plugin}/records/${created.id}/transitions`, { method: "POST", body: JSON.stringify({ state: "assigned", expected_revision: created.revision, reason: "Atribuição confirmada pela administração após conferir elegibilidade e conflitos.", operation_key: operationKey() }) });
      setNotice(`Terceira avaliação atribuída a ${candidate.name}. A consolidação poderá ser concluída após o envio do parecer individual.`);
      setThirdCandidates([]);
      setThirdAssignment({ id: assigned.id, revision: assigned.revision, state: assigned.state, evaluator_name: candidate.name });
    } catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }

  async function completeAfterThirdReview() {
    if (!consolidationWork?.record || !workspaceId) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const { record, payload } = consolidationWork;
      const result = await api<ThirdReviewResult | null>(`/safdoulas/assessments/workspaces/${workspaceId}/consolidations/${record.id}/third-result`);
      if (!result) { setNotice("A terceira avaliação ainda não foi submetida."); return; }
      if (result.assignment.state === "assigned") await api<RecordRow>(`/extensions/${plugin}/records/${result.assignment.id}/transitions`, { method: "POST", body: JSON.stringify({ state: "completed", expected_revision: result.assignment.revision, reason: "A terceira avaliação foi submetida e conferida pela administração.", operation_key: operationKey() }) });
      const withThird = { ...payload, third_evaluation_record_id: result.evaluation.id, third_evaluation_revision: result.evaluation.revision };
      const saved = await api<RecordRow>(`/extensions/${plugin}/records/${record.id}/versions`, { method: "POST", body: JSON.stringify({ title: record.title, payload: withThird, expected_revision: record.revision, reason: "Vínculo da terceira avaliação independente submetida.", operation_key: operationKey() }) });
      await api<RecordRow>(`/extensions/${plugin}/records/${saved.id}/transitions`, { method: "POST", body: JSON.stringify({ state: "completed", expected_revision: saved.revision, reason: "Consolidação concluída após análise independente da divergência substancial.", operation_key: operationKey() }) });
      setConsolidationWork(null); setNotice("Consolidação concluída com a terceira avaliação vinculada.");
      setReadyConsolidations(await api<ReadyConsolidation[]>(`/safdoulas/assessments/workspaces/${workspaceId}/ready-to-consolidate`));
    } catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }

  async function openBlindedDocument(document: AssessmentTask["blinded_documents"][number], index: number) {
    try {
      const blob = await authenticatedBlob(`/extensions/documents/records/${document.record_id}/files/${document.revision}`);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url; link.download = `Documento-cegado-${index + 1}`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError((reason as Error).message); }
  }

  function updateDiligence(index: number, update: Partial<EvaluationDraft["diligence_items"][number]>) {
    setDraft((current) => ({ ...current, diligence_items: current.diligence_items.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item) }));
  }

  async function suggest() {
    if (!workspaceId || !processId) return;
    setWorking(true); setError(""); setNotice(""); setRecommendation(null);
    try {
      const result = await api<Recommendation>(`/safdoulas/assessments/workspaces/${workspaceId}/processes/${processId}/recommendations`, { method: "POST", body: "{}" });
      setRecommendation(result); setSelectedPair(0);
      if (!result.pairs.length) setNotice("Nenhum par atende aos requisitos de habilitação, conflito, especialidade e capacidade deste processo.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }

  async function assign() {
    if (!recommendation || !workspaceId || !recommendation.pairs[selectedPair]) return;
    const pair = recommendation.pairs[selectedPair];
    setWorking(true); setError(""); setNotice("");
    let createdId = "";
    try {
      const created = await api<RecordRow>(`/extensions/${plugin}/workspaces/${workspaceId}/records`, {
        method: "POST",
        body: JSON.stringify({
          kind: "evaluation_assignment",
          title: `Avaliação ${recommendation.process.protocol_number || processId.slice(0, 8)}`,
          operation_key: operationKey(),
          payload: {
            process_record_id: recommendation.process.id, process_revision: recommendation.process.revision,
            matrix_record_id: recommendation.matrix.id, matrix_revision: recommendation.matrix.revision,
            blinded_projection_refs: recommendation.blinded_projection_refs,
            evaluator_user_ids: pair.evaluators.map((evaluator) => evaluator.user_id),
            evaluator_profile_refs: pair.evaluators.map((evaluator) => ({ user_id: evaluator.user_id, record_id: evaluator.profile_record_id, revision: evaluator.profile_revision })),
            assigned_at: new Date().toISOString(),
            assignment_note: `Par recomendado pelo sistema e confirmado pela administração: ${pair.evaluators.map((evaluator) => evaluator.name).join(" e ")}.`,
          },
        }),
      });
      createdId = created.id;
      await api<RecordRow>(`/extensions/${plugin}/records/${created.id}/transitions`, {
        method: "POST",
        body: JSON.stringify({ state: "assigned", expected_revision: created.revision, reason: "Distribuição confirmada pela administração após revisão das recomendações.", operation_key: operationKey() }),
      });
      setNotice(`Distribuição criada e ativada para ${pair.evaluators.map((evaluator) => evaluator.name).join(" e ")}.`);
      setRecommendation(null);
    } catch (reason) {
      const detail = (reason as Error).message;
      setError(createdId ? `O registro ${createdId} foi criado como rascunho, mas não foi ativado: ${detail}` : detail);
    } finally { setWorking(false); }
  }

  const selectedProcess = processes.find((record) => record.id === processId);
  const canManage = Boolean(user?.is_root || user?.permissions?.includes("plugin.safdoulas-assessments.manage"));
  const canReview = Boolean(user?.is_root || user?.permissions?.includes("plugin.safdoulas-assessments.read"));
  const submitted = activeTask?.evaluation?.state === "submitted";
  return <AccessShell user={user} title="Distribuição de avaliações">
    <p className="max-w-3xl text-sm text-[#44546f]">Veja pares recomendados com base em habilitação vigente, conflitos declarados, experiência, regionalidade e carga. A decisão de distribuição continua com a administração.</p>
    {!canManage && <p role="alert" className="rounded-lg border border-[#f5c2c7] bg-[#fff1f0] p-3 text-sm text-[#ae2a19]">Seu perfil não tem permissão para distribuir avaliações.</p>}
    <section className={`${accessPanel} grid min-w-0 gap-3 sm:grid-cols-2`} aria-label="Selecionar processo">
      <label className="min-w-0 space-y-1 text-sm font-semibold">Workspace
        <select value={workspaceId} onChange={(event) => { setLoading(true); setError(""); setProcesses([]); setRecommendation(null); setWorkspaceId(event.target.value); }} className={accessInput}><option value="">Selecione</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select>
      </label>
      <label className="min-w-0 space-y-1 text-sm font-semibold">Processo em análise
        <select value={processId} onChange={(event) => { setProcessId(event.target.value); setRecommendation(null); setError(""); }} className={accessInput}><option value="">Selecione</option>{processes.map((process) => <option key={process.id} value={process.id}>{String(process.payload.protocol_number || process.title)} · {process.title}</option>)}</select>
      </label>
      <div className="sm:col-span-2"><button type="button" onClick={() => void suggest()} disabled={!canManage || !processId || working || loading} className={accessButton}>{working ? "Processando…" : "Calcular recomendações"}</button></div>
    </section>
    {error && <p role="alert" className="break-words rounded-lg border border-[#f5c2c7] bg-[#fff1f0] p-3 text-sm text-[#ae2a19]">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-[#abf5d1] bg-[#e3fcef] p-3 text-sm text-[#216e4e]">{notice}</p>}
    {loading && <p role="status" className={accessPanel}>Carregando workspaces e processos…</p>}
    {canManage && <section className={`${accessPanel} min-w-0`} aria-labelledby="consolidations-title">
      <h2 id="consolidations-title" className="text-lg font-semibold">Consolidação de avaliações</h2>
      <p className="mt-1 text-sm text-[#626f86]">Compare os pareceres independentes por critério. O sistema destaca diferenças de resultado; a administração registra a síntese e classifica divergências substanciais.</p>
      {!readyConsolidations.length && <p className="mt-3 text-sm text-[#626f86]">Não há pares de avaliações submetidas aguardando consolidação.</p>}
      <div className="mt-3 grid gap-2">{readyConsolidations.map((ready) => <article key={ready.assignment.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dfe1e6] p-3">
        <div className="min-w-0"><strong className="block break-words">{ready.process.protocol_number || `Processo ${ready.assignment.id.slice(0, 8)}`}</strong><span className="text-sm text-[#626f86]">{ready.divergences.length} critério(s) divergente(s) · {ready.consolidation ? "Consolidação em rascunho" : "Pronto para comparar"}</span></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void openConsolidation(ready)} className={accessButton}>{ready.consolidation ? "Continuar consolidação" : "Comparar avaliações"}</button>{ready.assignment.state === "assigned" && <button type="button" onClick={() => void completeEvaluatorPair(ready)} disabled={working} className="rounded-lg border border-[#8590a2] px-3 py-2 text-sm">Concluir dupla e revogar acesso</button>}</div>
      </article>)}</div>
    </section>}
    {consolidationWork && <section className={`${accessPanel} min-w-0 space-y-4`} aria-labelledby="consolidation-work-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="consolidation-work-title" className="text-lg font-semibold">Consolidação · {consolidationWork.ready.process.protocol_number || "Processo"}</h2><p className="text-sm text-[#626f86]">Pareceres {String(consolidationWork.ready.first.payload.evaluation_role || "1")} e {String(consolidationWork.ready.second.payload.evaluation_role || "2")} · matriz v{consolidationWork.ready.matrix.revision}</p></div><button type="button" onClick={() => setConsolidationWork(null)} className="rounded-lg border border-[#dfe1e6] px-3 py-2 text-sm">Fechar</button></div>
      <div className="grid min-w-0 gap-2">{consolidationWork.ready.matrix.dimensions.flatMap((dimension) => dimension.criteria.map((criterion) => {
        const firstAnswer = (consolidationWork.ready.first.payload.answers as Answer[] || []).find((answer) => answer.criterion_code === criterion.code);
        const secondAnswer = (consolidationWork.ready.second.payload.answers as Answer[] || []).find((answer) => answer.criterion_code === criterion.code);
        const isDivergent = firstAnswer?.outcome !== secondAnswer?.outcome;
        const divergence = consolidationWork.payload.divergences.find((item) => item.criterion_code === criterion.code);
        return <div key={criterion.code} className={`grid min-w-0 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center ${isDivergent ? "border-[#ff991f] bg-[#fff7e6]" : "border-[#dfe1e6]"}`}>
          <strong className="break-words">{criterion.title || criterion.label || criterion.name || criterion.code}</strong><span className="text-sm">1ª: {firstAnswer?.outcome || "—"}</span><span className="text-sm">2ª: {secondAnswer?.outcome || "—"}</span>
          {isDivergent && divergence && <div className="grid min-w-0 gap-2 sm:col-span-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={divergence.substantial} onChange={(event) => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, divergences: current.payload.divergences.map((item) => item.criterion_code === criterion.code ? { ...item, substantial: event.target.checked } : item) } }))} className="h-4 w-4"/>Divergência substancial</label>{divergence.substantial && <input aria-label={`Fundamento da divergência ${criterion.code}`} value={divergence.rationale} onChange={(event) => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, divergences: current.payload.divergences.map((item) => item.criterion_code === criterion.code ? { ...item, rationale: event.target.value } : item) } }))} placeholder="Fundamente a classificação" className={accessInput}/>}</div>}
        </div>;
      }))}</div>
      <label className="grid min-w-0 gap-1 text-sm font-semibold">Síntese comparativa<textarea value={consolidationWork.payload.synthesis} onChange={(event) => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, synthesis: event.target.value } }))} rows={4} className={accessInput}/></label>
      {([ ["strengths", "Pontos fortes"], ["fragilities", "Fragilidades"] ] as const).map(([key, label]) => <label key={key} className="grid min-w-0 gap-1 text-sm font-semibold">{label}<textarea value={consolidationWork.payload[key].join("\n")} onChange={(event) => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, [key]: event.target.value.split("\n") } }))} rows={3} placeholder="Um item por linha" className={accessInput}/></label>)}
      <div className="grid min-w-0 gap-2"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Diligências propostas</h3><button type="button" onClick={() => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, diligence_items: [...current.payload.diligence_items, { request: "", rationale: "", evidence_reference: "" }] } }))} className="rounded-lg border border-[#8590a2] px-3 py-2 text-sm">Adicionar item</button></div>
        {consolidationWork.payload.diligence_items.map((item, index) => <div key={index} className="grid min-w-0 gap-2 rounded-lg border border-[#dfe1e6] p-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Solicitação<textarea value={item.request} onChange={(event) => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, diligence_items: current.payload.diligence_items.map((entry, itemIndex) => itemIndex === index ? { ...entry, request: event.target.value } : entry) } }))} rows={2} className={accessInput}/></label><label className="grid gap-1 text-sm">Fundamento<textarea value={item.rationale} onChange={(event) => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, diligence_items: current.payload.diligence_items.map((entry, itemIndex) => itemIndex === index ? { ...entry, rationale: event.target.value } : entry) } }))} rows={2} className={accessInput}/></label><button type="button" onClick={() => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, diligence_items: current.payload.diligence_items.filter((_, itemIndex) => itemIndex !== index) } }))} className="justify-self-start rounded-lg border border-[#8590a2] px-3 py-2 text-sm">Remover</button></div>)}
      </div>
      <label className="grid min-w-0 gap-1 text-sm font-semibold">Conclusão técnica<textarea value={consolidationWork.payload.conclusion} onChange={(event) => setConsolidationWork((current) => current && ({ ...current, payload: { ...current.payload, conclusion: event.target.value } }))} rows={4} className={accessInput}/></label>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveConsolidation()} disabled={working} className={accessButton}>{working ? "Salvando…" : "Salvar consolidação"}</button>{thirdAssignment && <button type="button" onClick={() => void completeAfterThirdReview()} disabled={working} className="rounded-lg bg-[#0c66e4] px-4 py-2 font-semibold text-white disabled:opacity-50">{working ? "Verificando…" : "Verificar terceira avaliação e concluir"}</button>}</div>
      {thirdAssignment && <p role="status" className="rounded-lg bg-[#f4f5f7] p-3 text-sm">Terceira análise atribuída a <strong>{thirdAssignment.evaluator_name}</strong> · {thirdAssignment.state}.</p>}
      {thirdCandidates.length > 0 && <div className="grid min-w-0 gap-2 rounded-lg border border-[#dfe1e6] p-3 sm:grid-cols-[minmax(0,1fr)_auto]"><label className="grid min-w-0 gap-1 text-sm font-semibold">Terceira acreditadora elegível<select value={thirdCandidateId} onChange={(event) => setThirdCandidateId(event.target.value)} className={accessInput}>{thirdCandidates.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{candidate.name} · {candidate.region_code || "região não informada"} · carga {candidate.active_assignments}/{candidate.max_parallel_assignments}</option>)}</select></label><button type="button" onClick={() => void assignThirdReviewer()} disabled={working || !consolidationWork.record} className={`${accessButton} self-end`}>{working ? "Atribuindo…" : "Atribuir terceira análise"}</button></div>}
      {consolidationWork.payload.divergences.some((item) => item.substantial) && !thirdAssignment && !thirdCandidates.length && <p className="text-sm text-[#626f86]">Salve a classificação substancial para carregar acreditadoras elegíveis.</p>}
    </section>}
    {canReview && <section className={`${accessPanel} min-w-0`} aria-labelledby="my-assessments-title">
      <h2 id="my-assessments-title" className="text-lg font-semibold">Minhas avaliações</h2>
      {!assignments.length && <p className="mt-2 text-sm text-[#626f86]">Não há avaliações atribuídas à sua conta neste workspace.</p>}
      <div className="mt-3 grid gap-2">{assignments.map((task) => <div key={task.assignment.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dfe1e6] p-3">
        <div className="min-w-0"><strong className="block break-words">{task.process.protocol_number || `Processo ${task.assignment.id.slice(0, 8)}`}</strong><span className="text-sm text-[#626f86]">{task.assignment.role === "third" ? "Terceira avaliação" : task.assignment.role === "first" ? "Primeira avaliação" : "Segunda avaliação"} · {task.evaluation?.state === "submitted" ? "Submetida" : task.evaluation ? "Rascunho iniciado" : "Ainda não iniciada"}</span></div>
        <button type="button" onClick={() => void startEvaluation(task)} disabled={working} className={accessButton}>{working ? "Abrindo…" : task.evaluation ? "Continuar avaliação" : "Iniciar avaliação"}</button>
      </div>)}</div>
    </section>}
    {activeTask && <section className={`${accessPanel} min-w-0 space-y-5`} aria-labelledby="individual-evaluation-title">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div><h2 id="individual-evaluation-title" className="text-lg font-semibold">Avaliação individual · {activeTask.process.protocol_number || activeTask.assignment.role}</h2><p className="text-sm text-[#626f86]">Matriz publicada v{activeTask.matrix.revision}. A análise usa somente os documentos cegados fixados na distribuição.</p></div><button type="button" className="rounded-lg border border-[#dfe1e6] px-3 py-2 text-sm" onClick={() => setActiveTask(null)}>Fechar</button></div>
      <div className="grid gap-2 sm:grid-cols-2">{activeTask.blinded_documents.map((document, index) => <div key={`${document.record_id}:${document.revision}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f4f5f7] p-3 text-sm"><div className="min-w-0"><strong>{document.label}</strong><div className="break-all text-xs text-[#626f86]">Documento cegado {index + 1} · v{document.revision}{document.mime_type ? ` · ${document.mime_type}` : ""}</div></div><button type="button" onClick={() => void openBlindedDocument(document, index)} className="rounded-lg border border-[#8590a2] px-3 py-2 text-sm">Baixar cópia cegada</button></div>)}</div>
      {activeTask.matrix.dimensions.map((dimension) => <fieldset key={dimension.code} className="min-w-0 space-y-3 rounded-lg border border-[#dfe1e6] p-3 sm:p-4">
        <legend className="px-1 font-semibold">{dimension.title || dimension.name || dimension.code}</legend>
        {dimension.criteria.map((criterion) => {
          const answer = draft.answers.find((item) => item.criterion_code === criterion.code);
          return <div key={criterion.code} className="grid min-w-0 gap-2 rounded-lg bg-[#f8f8f8] p-3">
            <strong className="break-words">{criterion.title || criterion.label || criterion.name || criterion.code}</strong>
            <label className="grid min-w-0 gap-1 text-sm">Resultado
              <select value={answer?.outcome || ""} disabled={submitted} onChange={(event) => updateAnswer(criterion.code, { outcome: event.target.value, evidence: answer?.evidence || [] })} className={accessInput}>
                <option value="">Selecione</option>{[["A", "Atende"], ["AP", "Atende parcialmente"], ["NA", "Não atende"], ["NSA", "Não se aplica"], ["D", "Divergência"]].map(([value, label]) => <option key={value} value={value}>{value} · {label}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-sm">Justificativa{criterion.justification_required ? " · obrigatória" : ""}<textarea value={answer?.justification || ""} disabled={submitted || !answer?.outcome} onChange={(event) => updateAnswer(criterion.code, { justification: event.target.value })} rows={2} className={accessInput}/></label>
            <label className="grid min-w-0 gap-1 text-sm">Observação<textarea value={answer?.observation || ""} disabled={submitted || !answer?.outcome} onChange={(event) => updateAnswer(criterion.code, { observation: event.target.value })} rows={2} className={accessInput}/></label>
            <div className="grid min-w-0 gap-1 text-sm"><span>Evidências{criterion.evidence_required ? " · obrigatórias" : ""}</span>{activeTask.blinded_documents.map((document) => {
              const checked = Boolean(answer?.evidence.some((item) => item.record_id === document.record_id && item.revision === document.revision));
              return <label key={document.record_id} className="flex min-w-0 items-start gap-2"><input type="checkbox" disabled={submitted || !answer?.outcome} checked={checked} onChange={(event) => {
                const evidence = answer?.evidence || [];
                updateAnswer(criterion.code, { evidence: event.target.checked ? [...evidence, { record_id: document.record_id, revision: document.revision }] : evidence.filter((item) => item.record_id !== document.record_id) });
              }} className="mt-1 h-4 w-4 shrink-0"/><span className="break-words">{document.label}</span></label>;
            })}</div>
          </div>;
        })}
        <label className="grid min-w-0 gap-1 text-sm">Síntese da dimensão<textarea value={draft.dimension_summaries.find((item) => item.dimension_code === dimension.code)?.summary || ""} disabled={submitted} onChange={(event) => setDraft((current) => ({ ...current, dimension_summaries: [...current.dimension_summaries.filter((item) => item.dimension_code !== dimension.code), ...(event.target.value ? [{ dimension_code: dimension.code, summary: event.target.value }] : [])] }))} rows={2} className={accessInput}/></label>
      </fieldset>)}
      {([ ["strengths", "Pontos fortes"], ["fragilities", "Fragilidades"], ["inconsistencies", "Inconsistências"] ] as const).map(([key, label]) => <label key={key} className="grid min-w-0 gap-1 text-sm font-semibold">{label}<textarea disabled={submitted} value={draft[key].join("\n")} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value.split("\n") }))} rows={3} placeholder="Um item por linha" className={accessInput}/></label>)}
      <div className="grid min-w-0 gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Itens para diligência</h3>{!submitted && <button type="button" onClick={() => setDraft((current) => ({ ...current, diligence_items: [...current.diligence_items, { request: "", rationale: "", evidence_reference: "" }] }))} className="rounded-lg border border-[#8590a2] px-3 py-2 text-sm">Adicionar item</button>}</div>
        {draft.diligence_items.map((item, index) => <div key={index} className="grid min-w-0 gap-2 rounded-lg border border-[#dfe1e6] p-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm">Solicitação<textarea disabled={submitted} value={item.request} onChange={(event) => updateDiligence(index, { request: event.target.value })} rows={2} className={accessInput}/></label>
          <label className="grid min-w-0 gap-1 text-sm">Fundamento<textarea disabled={submitted} value={item.rationale} onChange={(event) => updateDiligence(index, { rationale: event.target.value })} rows={2} className={accessInput}/></label>
          <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">Referência de evidência<input disabled={submitted} value={item.evidence_reference || ""} onChange={(event) => updateDiligence(index, { evidence_reference: event.target.value })} className={accessInput}/></label>
          {!submitted && <button type="button" onClick={() => setDraft((current) => ({ ...current, diligence_items: current.diligence_items.filter((_, itemIndex) => itemIndex !== index) }))} className="justify-self-start rounded-lg border border-[#8590a2] px-3 py-2 text-sm">Remover item</button>}
        </div>)}
      </div>
      <label className="grid min-w-0 gap-1 text-sm font-semibold">Parecer preliminar<textarea disabled={submitted} value={draft.preliminary_opinion} onChange={(event) => setDraft((current) => ({ ...current, preliminary_opinion: event.target.value }))} rows={5} className={accessInput}/></label>
      <div className="flex flex-wrap gap-2">{!submitted && <><button type="button" disabled={working} onClick={() => void saveEvaluation(false)} className={accessButton}>{working ? "Salvando…" : "Salvar rascunho"}</button><button type="button" disabled={working} onClick={() => void saveEvaluation(true)} className="rounded-lg bg-[#0c66e4] px-4 py-2 font-semibold text-white disabled:opacity-50">{working ? "Enviando…" : "Submeter avaliação"}</button></>}{submitted && <span className="rounded-lg bg-[#e3fcef] px-3 py-2 text-sm font-semibold text-[#216e4e]">Avaliação submetida e somente leitura</span>}</div>
    </section>}
    {!loading && workspaceId && processes.length === 0 && <p className={accessPanel}>Não há processos em análise neste workspace.</p>}
    {selectedProcess && <p className="text-sm text-[#626f86]">Processo selecionado: <strong>{String(selectedProcess.payload.protocol_number || selectedProcess.title)}</strong>. As recomendações usam a matriz e os documentos cegados vinculados à versão do processo.</p>}
    {recommendation && <section className={`${accessPanel} min-w-0`} aria-labelledby="recommendations-title">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id="recommendations-title" className="text-lg font-semibold">Pares recomendados</h2><p className="text-sm text-[#626f86]">{recommendation.eligible_count} acreditadora(s) elegível(is) · até cinco combinações classificadas</p></div><span className="rounded-full bg-[#e9f2ff] px-3 py-1 text-sm">Matriz v{recommendation.matrix.revision}</span></div>
      <fieldset className="mt-4 grid min-w-0 gap-3">
        <legend className="sr-only">Escolha um par recomendado</legend>
        {recommendation.pairs.map((pair, index) => <label key={pair.evaluators.map((evaluator) => evaluator.user_id).join(":")} className={`block min-w-0 cursor-pointer rounded-xl border p-4 ${selectedPair === index ? "border-[#0c66e4] bg-[#f0f6ff]" : "border-[#dfe1e6]"}`}>
          <span className="flex min-w-0 items-start gap-3"><input type="radio" name="recommended-pair" checked={selectedPair === index} onChange={() => setSelectedPair(index)} className="mt-1 h-5 w-5 shrink-0"/><span className="min-w-0 flex-1"><span className="grid min-w-0 gap-3 md:grid-cols-2">{pair.evaluators.map((evaluator) => <span key={evaluator.user_id} className="min-w-0 rounded-lg bg-white p-3"><strong className="block break-words">{evaluator.name}</strong><span className="mt-1 block text-sm text-[#44546f]">{evaluator.region_code || "Região não informada"} · carga {evaluator.active_assignments}/{evaluator.max_parallel_assignments}</span><span className="block text-xs text-[#626f86]">{evaluator.total_assignments} distribuição(ões) histórica(s){evaluator.matched_expertise.length ? ` · experiência: ${evaluator.matched_expertise.join(", ")}` : ""}</span></span>)}</span><span className="mt-3 block space-y-1 text-sm text-[#44546f]">{pair.reasons.map((reason) => <span key={reason} className="block">• {reason}</span>)}</span></span></span>
        </label>)}
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void assign()} disabled={!canManage || !recommendation.pairs.length || working} className={accessButton}>{working ? "Ativando distribuição…" : "Confirmar e distribuir par selecionado"}</button><span className="text-xs text-[#626f86]">A confirmação registra a atribuição e libera somente material cegado verificado.</span></div>
    </section>}
  </AccessShell>;
}
