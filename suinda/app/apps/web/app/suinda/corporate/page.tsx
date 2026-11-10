"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Workspace = { id: string; name: string };
type CorporateRow = {
  cohort_link_id: string;
  company_name: string; course_title: string; cohort_title: string; currency: string; agreed_price_amount: number;
  enrollments: number; active: number; completed: number; withdrawn: number; distinct_learners: number;
};
type BatchResult = { created_count: number; payment_required: boolean; rows: Array<{ line: number; status: string; message: string }> };

function mergeReportRows(current: CorporateRow[], incoming: CorporateRow[]) {
  const rows = new Map(current.map((row) => [row.cohort_link_id, row]));
  for (const row of incoming) rows.set(row.cohort_link_id, row);
  return [...rows.values()];
}

async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export default function SuindaCorporatePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [report, setReport] = useState<CorporateRow[]>([]);
  const [reportTotal, setReportTotal] = useState(0);
  const [reportCursor, setReportCursor] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const reportRequestId = useRef(0);
  const reportWorkspaceId = useRef(workspaceId);
  const [cohortLinkId, setCohortLinkId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [operationKey, setOperationKey] = useState("");

  useEffect(() => {
    let active = true;
    void api<Workspace[]>("/workspaces").then((items) => {
      if (!active) return;
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id || "");
      if (!items.length) setError("Nenhum workspace disponível para sua conta.");
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar workspaces."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const loadReport = useCallback(async (cursor: string | null = null, replace = cursor === null) => {
    if (!workspaceId) {
      setReport([]); setReportTotal(0); setReportCursor(null); setReportError(""); setReportBusy(false);
      return;
    }
    const requestId = ++reportRequestId.current;
    const requestedWorkspaceId = workspaceId;
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    setReportBusy(true);
    setReportError("");
    try {
      const data = await api<{ cohorts: CorporateRow[]; total_cohorts: number; next_cursor: string | null; limit: number }>(
        `/extensions/suinda-corporate/workspaces/${encodeURIComponent(requestedWorkspaceId)}/report?${query.toString()}`,
      );
      if (requestId !== reportRequestId.current || requestedWorkspaceId !== reportWorkspaceId.current) return;
      setReport((current) => replace ? mergeReportRows([], data.cohorts) : mergeReportRows(current, data.cohorts));
      setReportTotal(data.total_cohorts);
      setReportCursor(data.next_cursor);
    } catch (cause) {
      if (requestId === reportRequestId.current && requestedWorkspaceId === reportWorkspaceId.current)
        setReportError(cause instanceof Error ? cause.message : "Não foi possível carregar o relatório corporativo.");
    } finally {
      if (requestId === reportRequestId.current && requestedWorkspaceId === reportWorkspaceId.current) setReportBusy(false);
    }
  }, [workspaceId]);
  useEffect(() => { reportWorkspaceId.current = workspaceId; }, [workspaceId]);
  useEffect(() => { void Promise.resolve().then(() => loadReport(null, true)); }, [loadReport]);

  async function importBatch() {
    if (!file || !workspaceId || !cohortLinkId) return;
    setBusy(true); setError(""); setResult(null);
    const stableOperationKey = operationKey || crypto.randomUUID();
    setOperationKey(stableOperationKey);
    try {
      const data = await api<BatchResult>(`/extensions/suinda-corporate/workspaces/${encodeURIComponent(workspaceId)}/cohorts/${encodeURIComponent(cohortLinkId)}/import`, {
        method: "POST", body: JSON.stringify({ operation_key: stableOperationKey, file_name: file.name, data_base64: await base64(file) }),
      });
      setResult(data); setOperationKey(""); setFile(null); setConfirmed(false); await loadReport(null, true);
    } catch (cause) {
      // Keep the same operation key after a network error so the caller can safely retry.
      setError(cause instanceof Error ? cause.message : "O lote não foi concluído.");
    } finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-[#e8edf2] sm:px-6 lg:px-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Suindá · contratos B2B</p>
      <h1 className="text-2xl font-semibold text-white sm:text-3xl">Formação corporativa</h1>
      <p className="max-w-3xl text-sm leading-6 text-[#aeb9c4]">Contratos, turmas fechadas para empresas, indicadores agregados e matrícula em lote. Os relatórios exibem apenas totais por empresa, curso e turma.</p>
    </header>

    <section className="rounded-2xl border border-white/10 bg-[#2c333a] p-4 sm:p-5">
      <label className="grid max-w-xl gap-1 text-xs text-[#aeb9c4]">Workspace institucional
        <select value={workspaceId} onChange={(event) => {
          const nextWorkspaceId = event.target.value;
          reportRequestId.current += 1;
          reportWorkspaceId.current = nextWorkspaceId;
          setWorkspaceId(nextWorkspaceId); setReport([]); setReportTotal(0); setReportCursor(null); setReportError(""); setReportBusy(false);
          setOperationKey(""); setResult(null); setError("");
        }} disabled={loading || busy || !workspaces.length}
          className="min-h-11 rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white focus:border-cyan-300 focus:outline-none">
          {workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
        </select>
      </label>
      {loading && <p className="mt-3 text-sm text-[#9fadbc]">Carregando workspaces…</p>}
      <div role="region" aria-label="Relatório de matrículas corporativas" tabIndex={0}
        className="mt-5 overflow-x-auto rounded-xl border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-[#1d2125] text-xs uppercase tracking-wide text-[#9fadbc]"><tr>
            <th className="px-4 py-3">Empresa</th><th className="px-4 py-3">Curso / turma</th><th className="px-4 py-3">Preço do contrato</th><th className="px-4 py-3">Matrículas</th><th className="px-4 py-3">Ativos</th><th className="px-4 py-3">Concluídos</th><th className="px-4 py-3">Alunos distintos</th>
          </tr></thead>
          <tbody>{report.map((row) => <tr key={row.cohort_link_id} className="border-t border-white/10 text-[#e8edf2]">
            <td className="px-4 py-3 font-medium">{row.company_name}</td><td className="px-4 py-3">{row.course_title}<span className="block text-xs text-[#9fadbc]">{row.cohort_title}</span></td>
            <td className="px-4 py-3">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: row.currency }).format(row.agreed_price_amount)}</td>
            <td className="px-4 py-3">{row.enrollments}</td><td className="px-4 py-3">{row.active}</td><td className="px-4 py-3">{row.completed}</td><td className="px-4 py-3">{row.distinct_learners}</td>
          </tr>)}</tbody>
        </table>
        {!report.length && !loading && !reportBusy && !reportError && <p className="px-4 py-5 text-sm text-[#9fadbc]">Nenhum contrato corporativo ativo foi encontrado neste workspace.</p>}
      </div>
      {workspaceId && <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#9fadbc]" aria-live="polite">{reportBusy && !report.length ? "Carregando relatório corporativo…" : `Exibindo ${report.length} de ${reportTotal} turmas corporativas.`}</p>
        {reportCursor && <button type="button" onClick={() => void loadReport(reportCursor, false)} disabled={reportBusy}
          className="min-h-10 rounded-lg border border-cyan-200/20 px-4 text-sm font-medium text-cyan-100 hover:bg-cyan-100/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:cursor-wait disabled:opacity-50">
          {reportBusy ? "Carregando…" : "Carregar mais"}
        </button>}
      </div>}
      {reportError && <p role="alert" className="mt-2 text-sm text-rose-200">{reportError}</p>}
      <p className="mt-3 text-xs text-[#9fadbc]">Desistências nas turmas carregadas: {report.reduce((total, row) => total + row.withdrawn, 0)} · Relatório agregado, sem nomes ou identificadores de alunos.</p>
    </section>

    <section className="rounded-2xl border border-cyan-300/20 bg-[#2c333a] p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-white">Matrícula corporativa em lote</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-[#aeb9c4]">O processo aceita apenas contas existentes, ativas e com e-mail confirmado. Valida a lista inteira antes de gravar; qualquer conflito cancela o lote completo. Alunos convidados ou contas novas não recebem acesso por este fluxo.</p>
      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-xs text-[#aeb9bc]">ID do vínculo de turma corporativa
          <input value={cohortLinkId} onChange={(event) => { setCohortLinkId(event.target.value.trim()); setOperationKey(""); setResult(null); }} placeholder="UUID do registro de turma corporativa"
            className="min-h-11 w-full min-w-0 rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus:border-cyan-300 focus:outline-none" />
        </label>
        <label className="grid min-w-0 gap-1 text-xs text-[#aeb9bc]">Lista de alunos (CSV ou XLSX, até 1.000 linhas)
          <input type="file" accept=".csv,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] || null); setOperationKey(""); setResult(null); }}
            className="min-h-11 w-full min-w-0 max-w-full rounded-lg border border-[#46515c] bg-[#1d2125] px-3 py-2 text-sm text-white file:mr-3 file:rounded-md file:border-0 file:bg-[#394650] file:px-3 file:py-1.5 file:text-white" />
        </label>
      </div>
      <label className="mt-4 flex items-start gap-3 text-sm text-[#c5cdd5]">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4 accent-cyan-300" />
        <span>Confirmo que a empresa autorizou as matrículas desta lista e que o contrato, a turma, o preço e a moeda foram conferidos.</span>
      </label>
      <button type="button" onClick={() => void importBatch()} disabled={!file || !workspaceId || !cohortLinkId || !confirmed || busy}
        className="mt-4 min-h-11 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#12222b] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45">
        {busy ? "Validando e processando lote…" : "Validar e matricular lote"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
      {result && <div role="status" className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
        <p className="font-medium text-emerald-100">{result.created_count} matrículas concluídas. {result.payment_required ? "O acesso segue condicionado ao pagamento individual." : "O curso não exige pagamento."}</p>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{result.rows.map((row) => <li key={row.line} className="rounded-lg bg-black/15 px-3 py-2"><span className="font-medium">Linha {row.line}:</span> {row.message}</li>)}</ul>
      </div>}
    </section>
    {error && !result && <p role="alert" className="sr-only">{error}</p>}
  </main>;
}
