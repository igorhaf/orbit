"use client";

import { useEffect, useMemo, useState } from "react";
import { api, apiBlob } from "@/lib/api";
import { ErpDeliveryPanel } from "./ErpDeliveryPanel";

type WorkspaceOption = { workspace_id: string; workspace_name: string };
type UnitOption = { workspace_id: string; unit_record_id: string | null; unit_name: string };
type ImportResult = {
  import_id: string; created_at: string; row_count: number; matched_count: number; ambiguous_count: number; unmatched_count: number; recorded_count: number;
  rows: Array<{ line: number; nature: "payment" | "fee" | "refund" | "chargeback" | "net_settlement"; match_status: "matched" | "ambiguous" | "unmatched" | "recorded"; candidate_count: number; payment_entry_id: string | null;
    candidate_payment_entry_ids: string[]; candidate_options: Array<{ id: string; amount: string; currency: string; method: string; recorded_at: string; course_title: string; cohort_title: string | null }>;
    decision: { selected_payment_entry_id: string; reason_code: string; decided_at: string; decided_by: string } | null }>;
};
type ImportSummary = Omit<ImportResult, "rows"> & { unit_record_id: string | null };
type MercadoPagoReportTask = { task_id: string; status: string; format?: string | null; file_name?: string | null };
type FinancialNature = "cash_receipt" | "cash_refund" | "scholarship_credit" | "waiver_credit" | "provider_fee" | "provider_chargeback";
type AccountPair = { debit_account: string; credit_account: string };
type AccountMappings = Record<FinancialNature, AccountPair>;
type CatalogAccount = { account_code: string; account_name: string; account_type: string; parent_code: string | null };
const financialNatures: Array<[FinancialNature, string]> = [
  ["cash_receipt", "Recebimentos"], ["cash_refund", "Reembolsos"],
  ["scholarship_credit", "Créditos de bolsa"], ["waiver_credit", "Isenções"],
  ["provider_fee", "Tarifas de provedores"], ["provider_chargeback", "Contestação/chargeback"],
];
const emptyAccountMappings: AccountMappings = {
  cash_receipt: { debit_account: "", credit_account: "" }, cash_refund: { debit_account: "", credit_account: "" },
  scholarship_credit: { debit_account: "", credit_account: "" }, waiver_credit: { debit_account: "", credit_account: "" },
  provider_fee: { debit_account: "", credit_account: "" }, provider_chargeback: { debit_account: "", credit_account: "" },
};

const inputClass = "min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white";

export function SuindaFinancialReconciliation({ workspaces, units, initialWorkspaceId, initialUnitId, requireUnit = false, periodFrom, periodTo }: {
  workspaces: WorkspaceOption[]; units: UnitOption[]; initialWorkspaceId?: string; initialUnitId?: string; requireUnit?: boolean;
  periodFrom?: string; periodTo?: string;
}) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId || workspaces[0]?.workspace_id || "");
  const [unitId, setUnitId] = useState(initialUnitId || "");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<ImportSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [resolvingLine, setResolvingLine] = useState<number | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<Record<number, string>>({});
  const [reasonCode, setReasonCode] = useState("institutional_review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accountMappings, setAccountMappings] = useState<AccountMappings>(emptyAccountMappings);
  const [mappingWorkspaceId, setMappingWorkspaceId] = useState("");
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mappingError, setMappingError] = useState("");
  const [accountCatalog, setAccountCatalog] = useState<CatalogAccount[]>([]);
  const [catalogWorkspaceId, setCatalogWorkspaceId] = useState("");
  const [catalogErrorWorkspaceId, setCatalogErrorWorkspaceId] = useState("");
  const [catalogMessageWorkspaceId, setCatalogMessageWorkspaceId] = useState("");
  const [catalogFile, setCatalogFile] = useState<File | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [journalBusy, setJournalBusy] = useState(false);
  const [providerFrom, setProviderFrom] = useState(periodFrom || new Date().toISOString().slice(0, 10));
  const [providerTo, setProviderTo] = useState(periodTo || new Date().toISOString().slice(0, 10));
  const [providerTask, setProviderTask] = useState<MercadoPagoReportTask | null>(null);
  const [providerTaskId, setProviderTaskId] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);
  const workspaceUnits = useMemo(() => units.filter((unit) => unit.workspace_id === workspaceId && unit.unit_record_id), [units, workspaceId]);
  const workspaceAccountCatalog = catalogWorkspaceId === workspaceId ? accountCatalog : [];

  useEffect(() => {
    if (!workspaceId || requireUnit) return;
    let active = true;
    void api<{ mappings: AccountMappings | null }>(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/account-mappings`)
      .then((response) => { if (active) { setAccountMappings({ ...emptyAccountMappings, ...(response.mappings || {}) }); setMappingWorkspaceId(workspaceId); setMappingError(""); } })
      .catch((cause) => { if (active) { setMappingWorkspaceId(""); setMappingError(cause instanceof Error ? cause.message : "Não foi possível carregar as contas contábeis."); } });
    void api<{ accounts: CatalogAccount[] }>(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/accounts`)
      .then((response) => { if (active) { setAccountCatalog(response.accounts); setCatalogWorkspaceId(workspaceId); setCatalogError(""); setCatalogErrorWorkspaceId(""); } })
      .catch((cause) => { if (active) { setCatalogError(cause instanceof Error ? cause.message : "Não foi possível carregar o plano de contas importado."); setCatalogErrorWorkspaceId(workspaceId); } });
    return () => { active = false; };
  }, [workspaceId, requireUnit]);

  async function importAccountCatalog() {
    if (!catalogFile || !workspaceId || catalogBusy) return;
    setCatalogBusy(true); setCatalogError(""); setCatalogMessage("");
    try {
      if (catalogFile.size > 2_000_000) throw new Error("O CSV pode ter no máximo 2 MB.");
      const csv = await catalogFile.text();
      const imported = await api<{ row_count: number; idempotent_replay: boolean; accounts: CatalogAccount[] }>(
        `/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/accounts/import`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }),
        });
      setAccountCatalog(imported.accounts);
      setCatalogWorkspaceId(workspaceId); setCatalogMessageWorkspaceId(workspaceId);
      setCatalogMessage(`${imported.row_count} contas importadas${imported.idempotent_replay ? "; arquivo já processado anteriormente" : ""}. O CSV não foi armazenado.`);
    } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : "Não foi possível importar o plano de contas."); setCatalogErrorWorkspaceId(workspaceId); }
    finally { setCatalogBusy(false); }
  }

  async function saveAccountMappings() {
    if (!workspaceId || mappingBusy || mappingWorkspaceId !== workspaceId) return;
    setMappingBusy(true); setMappingError(""); setMessage("");
    try {
      const feeConfigured = Boolean(accountMappings.provider_fee.debit_account || accountMappings.provider_fee.credit_account);
      const chargebackConfigured = Boolean(accountMappings.provider_chargeback.debit_account || accountMappings.provider_chargeback.credit_account);
      if (feeConfigured !== chargebackConfigured) throw new Error("Configure as duas naturezas de liquidação ou deixe ambas em branco.");
      const mappings = {
        cash_receipt: accountMappings.cash_receipt, cash_refund: accountMappings.cash_refund,
        scholarship_credit: accountMappings.scholarship_credit, waiver_credit: accountMappings.waiver_credit,
        ...(feeConfigured ? { provider_fee: accountMappings.provider_fee, provider_chargeback: accountMappings.provider_chargeback } : {}),
      };
      const saved = await api<{ mappings: AccountMappings }>(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/account-mappings`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mappings }),
      });
      setAccountMappings({ ...emptyAccountMappings, ...saved.mappings }); setMessage("Mapeamento contábil salvo para este workspace.");
    } catch (cause) { setMappingError(cause instanceof Error ? cause.message : "Não foi possível salvar o mapeamento."); }
    finally { setMappingBusy(false); }
  }

  async function exportJournal() {
    if (!workspaceId || journalBusy || requireUnit && !unitId) return;
    setJournalBusy(true); setError(""); setMessage("");
    try {
      const query = new URLSearchParams();
      if (periodFrom) query.set("from", periodFrom);
      if (periodTo) query.set("to", periodTo);
      if (unitId) query.set("unit_record_id", unitId);
      const blob = await apiBlob(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/journal.csv?${query}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `suinda-diario-${workspaceId.slice(0, 8)}.csv`;
      document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Diário contábil exportado. O arquivo contém somente lançamentos e códigos de conta configurados.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível exportar o diário contábil."); }
    finally { setJournalBusy(false); }
  }

  async function loadHistory() {
    if (!workspaceId || historyBusy) return;
    setHistoryBusy(true); setError("");
    try {
      const query = unitId ? `?unit_record_id=${encodeURIComponent(unitId)}` : "";
      const items = await api<ImportSummary[]>(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/imports${query}`);
      setHistory(items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível consultar o histórico."); }
    finally { setHistoryBusy(false); }
  }

  async function openImport(importId: string) {
    setBusy(true); setError("");
    try {
      const imported = await api<ImportResult>(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/imports/${encodeURIComponent(importId)}`);
      setResult(imported); setSelectedCandidates({});
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível abrir esta importação."); }
    finally { setBusy(false); }
  }

  async function resolveRow(row: ImportResult["rows"][number]) {
    const paymentEntryId = selectedCandidates[row.line];
    if (!result || !paymentEntryId || resolvingLine !== null) return;
    setResolvingLine(row.line); setError("");
    try {
      const updated = await api<ImportResult>(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/imports/${encodeURIComponent(result.import_id)}/rows/${row.line}/resolutions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation_key: crypto.randomUUID(), payment_entry_id: paymentEntryId, reason_code: reasonCode }),
      });
      setResult(updated); setMessage("A revisão foi registrada no histórico imutável. Nenhum pagamento ou saldo foi alterado.");
      await loadHistory();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a decisão."); }
    finally { setResolvingLine(null); }
  }

  async function importStatement() {
    if (!file || !workspaceId || busy || requireUnit && !unitId) return;
    setBusy(true); setError(""); setMessage(""); setResult(null);
    try {
      if (file.size > 1_000_000) throw new Error("O CSV pode ter no máximo 1 MB.");
      const csv = await file.text();
      const imported = await api<ImportResult>(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/imports`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation_key: crypto.randomUUID(), csv, ...(unitId ? { unit_record_id: unitId } : {}) }),
      });
      setResult(imported); setHistory((current) => [{ ...imported, unit_record_id: unitId || null }, ...current.filter((item) => item.import_id !== imported.import_id)]);
      setMessage("Extrato analisado. Nenhum pagamento foi criado ou alterado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível analisar o extrato.");
    } finally { setBusy(false); }
  }

  async function requestProviderReport() {
    if (!workspaceId || providerBusy || !providerFrom || !providerTo || providerFrom > providerTo) return;
    setProviderBusy(true); setError(""); setMessage(""); setProviderTask(null);
    try {
      const task = await api<MercadoPagoReportTask>(`/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/mercado-pago/reports`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: providerFrom, to: providerTo }),
      });
      setProviderTask(task); setProviderTaskId(task.task_id);
      setMessage(`Relatório solicitado ao Mercado Pago. Tarefa ${task.task_id}; aguarde o estado processado e consulte novamente.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível solicitar o relatório ao Mercado Pago."); }
    finally { setProviderBusy(false); }
  }

  async function importProviderReport() {
    if (!workspaceId || !providerTask || providerBusy) return;
    setProviderBusy(true); setError(""); setMessage("");
    try {
      const response = await api<ImportResult & { imported: boolean; status?: string; task_id?: string; skipped_provider_rows?: number }>(
        `/extensions/suinda-accounting/workspaces/${encodeURIComponent(workspaceId)}/mercado-pago/reports/${encodeURIComponent(providerTask.task_id)}`);
      if (!response.imported) {
        setProviderTask({ ...providerTask, status: response.status || providerTask.status });
        setMessage(`O relatório ainda está ${response.status || "em processamento"}. Consulte novamente em instantes.`);
      } else {
        setResult(response); setProviderTask(null);
        setHistory((current) => [{ ...response, unit_record_id: null }, ...current.filter((item) => item.import_id !== response.import_id)]);
        setMessage(`Relatório Mercado Pago importado. ${response.skipped_provider_rows || 0} movimentos de saldo não relacionados a checkout foram ignorados; nenhum pagamento ou saldo foi alterado.`);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível consultar ou importar o relatório Mercado Pago."); }
    finally { setProviderBusy(false); }
  }

  function trackProviderReport() {
    if (!/^\d{1,30}$/.test(providerTaskId)) { setError("Informe o identificador numérico da tarefa Mercado Pago."); return; }
    setProviderTask({ task_id: providerTaskId, status: "desconhecido" }); setError(""); setMessage("");
  }

  if (!workspaces.length) return null;
  return <section className="mt-5 space-y-4 rounded-2xl border border-emerald-200/15 bg-[#2c333a] p-4 sm:p-5" aria-labelledby="financial-reconciliation-title">
    <div><h2 id="financial-reconciliation-title" className="text-lg font-semibold text-white">Conciliação por extrato</h2>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Importe CSV com referência, valor, moeda e data (rótulos em português ou inglês; ordem livre). O formato pode incluir natureza e referência de liquidação para pagamentos, tarifas, reembolsos, chargebacks e total líquido; cada grupo precisa fechar exatamente no valor líquido. Use valores assinados. Linhas ambíguas ou sem correspondência ficam destacadas para revisão. O arquivo e referências originais não são guardados; somente hash e metadados mínimos permanecem no histórico.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-xs text-[#b6c2cf]">Workspace<select className={inputClass} value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setUnitId(""); setResult(null); setHistory([]); setProviderTask(null); setProviderTaskId(""); }}>
        {workspaces.map((workspace) => <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.workspace_name}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs text-[#b6c2cf]">Unidade{requireUnit ? " (obrigatória no seu escopo)" : " (opcional para gestão do workspace)"}<select className={inputClass} value={unitId} onChange={(event) => { setUnitId(event.target.value); setResult(null); setHistory([]); }}>
        {!requireUnit && <option value="">Todas as unidades autorizadas</option>}{workspaceUnits.map((unit) => <option key={unit.unit_record_id} value={unit.unit_record_id!}>{unit.unit_name}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs text-[#b6c2cf] sm:col-span-2">Arquivo CSV · até 1 MB<input className={`${inputClass} py-2 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white`} type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setResult(null); setError(""); }} /></label>
    </div>
    {!requireUnit && <div className="space-y-3 rounded-xl border border-white/[0.08] bg-black/10 p-3" aria-labelledby="account-mapping-title">
      <div className="space-y-3 rounded-lg border border-emerald-200/15 bg-emerald-200/[0.03] p-3" aria-labelledby="mercado-pago-report-title">
        <div><h3 id="mercado-pago-report-title" className="text-sm font-semibold text-white">Importar relatório do Mercado Pago</h3>
          <p className="mt-1 text-xs leading-5 text-[#9fadbc]">Solicite o relatório Dinheiro em conta para um intervalo e consulte a tarefa até o Mercado Pago concluir a geração. Importamos somente liquidações, reembolsos e chargebacks em BRL; transferências e outros movimentos de saldo são ignorados e contabilizados. A API e a conversão preservam referências apenas durante a análise; o histórico salva hashes e valores mínimos. Exige gestão do workspace.</p></div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="grid gap-1 text-xs text-[#b6c2cf]">Data inicial<input className={inputClass} type="date" value={providerFrom} onChange={(event) => setProviderFrom(event.target.value)} /></label>
          <label className="grid gap-1 text-xs text-[#b6c2cf]">Data final<input className={inputClass} type="date" value={providerTo} onChange={(event) => setProviderTo(event.target.value)} /></label>
          <button type="button" onClick={() => void requestProviderReport()} disabled={providerBusy || !providerFrom || !providerTo || providerFrom > providerTo} className="min-h-10 rounded-lg border border-emerald-200/25 px-3 text-xs font-medium text-emerald-100 disabled:opacity-50">{providerBusy ? "Solicitando…" : "Solicitar relatório"}</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"><label className="grid gap-1 text-xs text-[#b6c2cf]">ID de uma tarefa existente<input className={inputClass} inputMode="numeric" maxLength={30} value={providerTaskId} onChange={(event) => setProviderTaskId(event.target.value.replace(/\D/g, ""))} aria-describedby="mercado-pago-report-task-help" /></label><button type="button" onClick={trackProviderReport} disabled={!providerTaskId || providerBusy} className="min-h-10 rounded-lg border border-[#3b4754] px-3 text-xs text-[#dee4ea] disabled:opacity-50">Acompanhar tarefa</button><p id="mercado-pago-report-task-help" className="text-[11px] text-[#9fadbc] sm:col-span-2">Guarde este ID para retomar a consulta depois de sair desta tela.</p></div>
        {providerTask && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-black/20 p-3 text-xs text-[#b6c2cf]"><span>Tarefa <code className="text-white">{providerTask.task_id}</code> · estado <strong className="text-white">{providerTask.status}</strong>{providerTask.format ? ` · ${providerTask.format}` : ""}</span><button type="button" onClick={() => void importProviderReport()} disabled={providerBusy} className="min-h-9 rounded-lg border border-cyan-200/25 px-3 text-cyan-100 disabled:opacity-50">{providerBusy ? "Consultando…" : providerTask.status === "processed" ? "Importar relatório" : "Consultar estado"}</button></div>}
      </div>
      <div><h3 id="account-mapping-title" className="text-sm font-semibold text-white">Plano de contas do workspace</h3>
        <p className="mt-1 text-xs leading-5 text-[#9fadbc]">Informe os códigos de débito e crédito usados pela sua instituição. Para tarifas e chargebacks, o débito/crédito configurado corresponde à dedução normal (valor negativo no extrato); valores positivos invertem as contas no diário como reversão. As naturezas são opcionais, mas necessárias para exportar esses componentes. O mapa não altera pagamentos ou saldos acadêmicos.</p></div>
      <div className="grid gap-3 rounded-lg border border-white/[0.07] p-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="grid gap-1 text-[11px] text-[#9fadbc]">Importar plano de contas CSV · até 2 MB · máximo 5.000 contas
          <input className={`${inputClass} py-2 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white`} type="file" accept=".csv,text/csv" onChange={(event) => { setCatalogFile(event.target.files?.[0] || null); setCatalogError(""); setCatalogMessage(""); }} />
        </label>
        <button type="button" onClick={() => void importAccountCatalog()} disabled={!catalogFile || catalogBusy} className="min-h-10 rounded-lg border border-cyan-100/25 px-3 text-xs font-medium text-cyan-100 disabled:opacity-50">{catalogBusy ? "Importando…" : "Importar catálogo"}</button>
        <p className="text-[11px] leading-5 text-[#9fadbc] sm:col-span-2">Use <code>codigo;nome;tipo;codigo_pai</code>; código e nome são obrigatórios. Aceita cabeçalhos em português ou inglês e tipos ativo, passivo, patrimônio, receita, despesa ou outro. O arquivo completo deve incluir todas as contas-pai. O catálogo é versionado por importação e aplicado às escolhas contábeis; contas ausentes numa nova versão são desativadas, sem apagar o histórico.</p>
        {workspaceAccountCatalog.length > 0 && <p className="text-xs text-[#b6c2cf] sm:col-span-2">Catálogo atual: {workspaceAccountCatalog.length} contas. Os códigos mapeados precisam existir nele.</p>}
        {catalogErrorWorkspaceId === workspaceId && catalogError && <p role="alert" className="text-xs text-rose-200 sm:col-span-2">{catalogError}</p>}
        {catalogMessageWorkspaceId === workspaceId && catalogMessage && <p role="status" className="text-xs text-emerald-200 sm:col-span-2">{catalogMessage}</p>}
      </div>
      <div className="grid gap-2 md:grid-cols-2">{financialNatures.map(([nature, label]) => <fieldset key={nature} className="grid gap-2 rounded-lg border border-white/[0.07] p-3">
        <legend className="px-1 text-xs font-medium text-[#c7d0da]">{label}</legend>
        <label className="grid gap-1 text-[11px] text-[#9fadbc]">Conta de débito<input className={inputClass} list={`suinda-account-catalog-${workspaceId}`} maxLength={50} autoComplete="off" disabled={mappingWorkspaceId !== workspaceId || mappingBusy} value={mappingWorkspaceId === workspaceId ? accountMappings[nature].debit_account : ""} onChange={(event) => setAccountMappings((current) => ({ ...current, [nature]: { ...current[nature], debit_account: event.target.value } }))} /></label>
        <label className="grid gap-1 text-[11px] text-[#9fadbc]">Conta de crédito<input className={inputClass} list={`suinda-account-catalog-${workspaceId}`} maxLength={50} autoComplete="off" disabled={mappingWorkspaceId !== workspaceId || mappingBusy} value={mappingWorkspaceId === workspaceId ? accountMappings[nature].credit_account : ""} onChange={(event) => setAccountMappings((current) => ({ ...current, [nature]: { ...current[nature], credit_account: event.target.value } }))} /></label>
      </fieldset>)}</div>
      {workspaceAccountCatalog.length > 0 && <datalist id={`suinda-account-catalog-${workspaceId}`}>{workspaceAccountCatalog.map((account) => <option key={account.account_code} value={account.account_code}>{account.account_name}</option>)}</datalist>}
      {mappingWorkspaceId !== workspaceId && !mappingError && <p role="status" className="text-xs text-[#9fadbc]">Carregando contas do workspace…</p>}
      {mappingError && <p role="alert" className="text-sm text-rose-200">{mappingError}</p>}
      <button type="button" onClick={() => void saveAccountMappings()} disabled={mappingBusy || !workspaceId || mappingWorkspaceId !== workspaceId} className="min-h-9 rounded-lg border border-emerald-200/30 px-3 text-xs font-medium text-emerald-100 disabled:opacity-50">{mappingBusy ? "Salvando contas…" : "Salvar plano de contas"}</button>
    </div>}
    {requireUnit && !unitId && <p className="text-xs text-amber-100" role="status">Selecione uma unidade que você administra para continuar.</p>}
    <button type="button" onClick={() => void exportJournal()} disabled={journalBusy || requireUnit && !unitId || !workspaceId} className="min-h-10 rounded-lg border border-cyan-200/25 px-4 text-sm text-cyan-100 disabled:opacity-50">{journalBusy ? "Gerando diário…" : "Exportar diário contábil CSV"}</button>
    <button type="button" onClick={() => void importStatement()} disabled={!file || busy || requireUnit && !unitId} className="min-h-10 rounded-lg bg-emerald-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{busy ? "Analisando extrato…" : "Importar e comparar"}</button>
    <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => void loadHistory()} disabled={historyBusy || busy || requireUnit && !unitId} className="min-h-10 rounded-lg border border-[#3b4754] px-4 text-sm text-[#dee4ea] disabled:opacity-50">{historyBusy ? "Carregando histórico…" : "Carregar histórico (últimos 100 lotes)"}</button><span className="text-xs text-[#9fadbc]">A revisão registra somente o lançamento escolhido, fundamento, responsável e horário; os pagamentos não são modificados.</span></div>
    {history.length > 0 && <div role="region" aria-label="Histórico de conciliações, tabela horizontal" tabIndex={0} className="overflow-x-auto rounded-xl border border-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[720px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr><th scope="col" className="px-3 py-2">Importado em</th><th scope="col" className="px-3 py-2">Linhas</th><th scope="col" className="px-3 py-2">Conciliadas / ambíguas / sem correspondência</th><th scope="col" className="px-3 py-2">Lote</th><th scope="col" className="px-3 py-2">Ação</th></tr></thead><tbody className="divide-y divide-white/[0.07]">{history.map((item) => <tr key={item.import_id} className="text-[#b6c2cf]"><td className="px-3 py-2">{new Date(item.created_at).toLocaleString("pt-BR")}</td><td className="px-3 py-2">{item.row_count}</td><td className="px-3 py-2">{item.matched_count} / {item.ambiguous_count} / {item.unmatched_count}</td><td className="px-3 py-2 font-mono">{item.import_id}</td><td className="px-3 py-2"><button type="button" onClick={() => void openImport(item.import_id)} className="min-h-8 rounded border border-[#3b4754] px-2 text-cyan-100 hover:bg-white/[0.05]">Abrir revisão</button></td></tr>)}</tbody></table></div>}
    {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}{message && <p role="status" className="text-sm text-emerald-200">{message}</p>}
    {result && <div className="space-y-3" aria-live="polite">
      <p className="text-xs text-[#b6c2cf]">{result.row_count} linhas · {result.matched_count} conciliadas · {result.ambiguous_count} ambíguas · {result.unmatched_count} sem correspondência · {result.recorded_count} componentes registrados · lote {result.import_id}</p>
      <div role="region" aria-label="Linhas da revisão de conciliação, tabela horizontal" tabIndex={0} className="overflow-x-auto rounded-xl border border-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[720px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr><th scope="col" className="px-3 py-2">Linha no CSV</th><th scope="col" className="px-3 py-2">Resultado</th><th scope="col" className="px-3 py-2">Correspondências</th><th scope="col" className="px-3 py-2">Lançamento Orbit / decisão</th><th scope="col" className="px-3 py-2">Revisão</th></tr></thead>
        <tbody className="divide-y divide-white/[0.07]">{result.rows.map((row) => <tr key={row.line} className="text-[#b6c2cf]"><th scope="row" className="px-3 py-2 font-medium text-white">{row.line}</th><td className="px-3 py-2">{row.match_status === "matched" ? "Conciliada" : row.decision ? "Revisada manualmente" : row.match_status === "ambiguous" ? "Ambígua · revisar" : row.match_status === "recorded" ? row.nature === "net_settlement" ? "Total líquido · conferido" : row.nature === "fee" ? "Tarifa · registrada" : "Chargeback · registrado" : "Sem correspondência"}</td><td className="px-3 py-2">{row.candidate_count}</td><td className="px-3 py-2 font-mono">{row.decision?.selected_payment_entry_id || row.payment_entry_id || "—"}{row.decision && <span className="block font-sans text-[11px] text-[#9fadbc]">{row.decision.reason_code} · {row.decision.decided_by} · {new Date(row.decision.decided_at).toLocaleString("pt-BR")}</span>}</td><td className="px-3 py-2">{row.match_status === "ambiguous" && <div className="flex min-w-72 flex-wrap gap-2"><select aria-label={`Lançamento para linha ${row.line}`} className={inputClass} value={selectedCandidates[row.line] || row.decision?.selected_payment_entry_id || ""} onChange={(event) => setSelectedCandidates((current) => ({ ...current, [row.line]: event.target.value }))}><option value="">Selecione um candidato</option>{row.candidate_options.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.course_title}{candidate.cohort_title ? ` · ${candidate.cohort_title}` : ""} · {candidate.amount} {candidate.currency} · {candidate.method} · {new Date(candidate.recorded_at).toLocaleDateString("pt-BR")} · {candidate.id.slice(0, 8)}</option>)}</select><select aria-label={`Fundamento da revisão da linha ${row.line}`} className={inputClass} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="reference_confirmed">Referência confirmada</option><option value="provider_receipt_reviewed">Comprovante do provedor revisado</option><option value="institutional_review">Revisão institucional</option></select><button type="button" onClick={() => void resolveRow(row)} disabled={!selectedCandidates[row.line] && !row.decision || resolvingLine !== null} className="min-h-9 rounded-lg border border-emerald-200/30 px-3 text-emerald-100 disabled:opacity-50">{resolvingLine === row.line ? "Registrando…" : row.decision ? "Registrar correção" : "Registrar revisão"}</button></div>}</td></tr>)}</tbody>
      </table></div>
    </div>}
    {!requireUnit && workspaceId && <ErpDeliveryPanel workspaceId={workspaceId} units={workspaceUnits.filter((unit): unit is UnitOption & { unit_record_id: string } => Boolean(unit.unit_record_id)).map((unit) => ({ unit_record_id: unit.unit_record_id, unit_name: unit.unit_name }))} />}
  </section>;
}
