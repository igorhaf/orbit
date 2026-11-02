"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Send } from "lucide-react";
import { api } from "@/lib/api";

type Workspace = { workspace_id: string; workspace_name: string };
type RequestRecord = { id: string; workspace_id?: string; title: string; state: string; updated_at?: string; privacy_execution?: { state: string; created_at: string; completed_at?: string | null; result?: { reason?: string; redacted_records?: number; redacted_attachments?: number; anonymized_account_fields?: number } } | null; payload: { request_type: string; request_scope: string; request_description: string; requested_categories?: string[]; response_summary?: string } };
type PrivacyNotice = { id: string; workspace_id: string; title: string; revision: number; payload: { purpose_code: string; version: number; purpose: string; data_categories: string[]; subject_categories: string[]; legal_basis: string; legal_basis_detail: string; retention_description: string; retention_period_days: number; retention_record_kinds: string[]; consent_required: boolean; notice_text: string } };
type ConsentReceipt = { id: string; revision: number; state: string; payload: { notice_record_id: string; notice_revision: number; consent_status: "consented" | "acknowledged"; responded_at: string } };
const stateLabels: Record<string, string> = { received: "Recebida", identity_verification: "Verificação de identidade", triage: "Triagem", in_review: "Em análise", response_ready: "Resposta preparada", completed: "Concluída", blocked: "Aguardando informação" };
const typeLabels: Record<string, string> = { access: "Acesso", correction: "Correção", elimination: "Eliminação", portability: "Portabilidade", revocation: "Revogação de consentimento", objection: "Oposição", other: "Outro direito" };
const basisLabels: Record<string, string> = { consent: "Consentimento", contract: "Execução de contrato", legal_obligation: "Obrigação legal", legitimate_interest: "Legítimo interesse", public_policy: "Política pública", other: "Outra base declarada" };
function latestPublishedNotices(notices: PrivacyNotice[], workspaceId: string) {
  const latest = new Map<string, PrivacyNotice>();
  for (const notice of notices.filter((item) => item.workspace_id === workspaceId)) {
    const current = latest.get(notice.payload.purpose_code);
    if (!current || notice.payload.version > current.payload.version
      || notice.payload.version === current.payload.version && notice.revision > current.revision
      || notice.payload.version === current.payload.version && notice.revision === current.revision && notice.id > current.id)
      latest.set(notice.payload.purpose_code, notice);
  }
  return [...latest.values()];
}

export default function SuindaPrivacyPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [notices, setNotices] = useState<PrivacyNotice[]>([]);
  const [consents, setConsents] = useState<ConsentReceipt[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [requestType, setRequestType] = useState("access");
  const [requestedCategories, setRequestedCategories] = useState<string[]>([]);
  const [scope, setScope] = useState("academic_record");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verifyRequestId, setVerifyRequestId] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const currentNotices = latestPublishedNotices(notices, workspace);
  const availableCategories = [...new Set(currentNotices.flatMap((item) => item.payload.data_categories))];

  async function load() {
    const [profiles, requests, currentNotices, receipts] = await Promise.all([
      api<Workspace[]>("/extensions/suinda-learning/me/profiles"),
      api<RequestRecord[]>("/extensions/suinda-learning/me/privacy-requests"),
      api<PrivacyNotice[]>("/extensions/suinda-learning/me/privacy-notices"),
      api<ConsentReceipt[]>("/extensions/suinda-learning/me/privacy-consents"),
    ]);
    setWorkspaces(profiles);
    setWorkspace((current) => current || profiles[0]?.workspace_id || "");
    setRecords(requests);
    setNotices(currentNotices);
    setConsents(receipts);
  }
  useEffect(() => { Promise.resolve().then(load).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar suas solicitações.")); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || description.trim().length < 20 || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspace)}/me/privacy-requests`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), request_type: requestType, request_scope: scope, request_description: description.trim(), ...(requestType === "elimination" ? { requested_categories: requestedCategories } : {}) }),
      });
      setDescription(""); setRequestedCategories([]); setNotice("Solicitação registrada. Antes de uma eventual execução, confirme sua identidade por senha e código enviado ao e-mail verificado."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a solicitação."); }
    finally { setBusy(false); }
  }

  async function startIdentityVerification(request: RequestRecord) {
    if (!workspace || !verifyPassword) return;
    setError(""); setNotice("");
    try {
      const result = await api<{ challenge_id: string; email_hint: string }>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspace)}/me/privacy-requests/${encodeURIComponent(request.id)}/identity-challenge`, {
        method: "POST", body: JSON.stringify({ password: verifyPassword }),
      });
      setVerifyRequestId(request.id); setChallengeId(result.challenge_id); setVerificationCode(""); setVerifyPassword("");
      setNotice(`Código enviado para ${result.email_hint}. Ele expira em 10 minutos.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a verificação."); }
  }

  async function confirmIdentityVerification() {
    if (!workspace || !verifyRequestId || !challengeId || !/^\d{6}$/.test(verificationCode)) return;
    setError(""); setNotice("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspace)}/me/privacy-requests/${encodeURIComponent(verifyRequestId)}/identity-challenge/verify`, {
        method: "POST", body: JSON.stringify({ challenge_id: challengeId, code: verificationCode }),
      });
      setVerifyRequestId(""); setChallengeId(""); setVerificationCode("");
      setNotice("Identidade confirmada. A confirmação vale por 30 minutos para esta solicitação.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o código."); }
  }

  async function respondToNotice(notice: PrivacyNotice) {
    setError(""); setNotice("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(notice.workspace_id)}/me/privacy-notices/${encodeURIComponent(notice.id)}/response`, {
        method: "POST", body: JSON.stringify({ consent_response: notice.payload.consent_required ? "consented" : "acknowledged", operation_key: crypto.randomUUID() }),
      });
      setNotice(notice.payload.consent_required ? "Seu consentimento foi registrado para esta versão e finalidade." : "Sua ciência desta versão foi registrada."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar sua resposta."); }
  }
  async function withdrawConsent(receipt: ConsentReceipt) {
    if (!window.confirm("Retirar o consentimento registrado para esta finalidade?")) return;
    setError(""); setNotice("");
    try {
      await api(`/extensions/suinda-learning/me/privacy-consents/${encodeURIComponent(receipt.id)}/withdraw`, {
        method: "POST", body: JSON.stringify({ expected_revision: receipt.revision, operation_key: crypto.randomUUID() }),
      });
      setNotice("A retirada do consentimento foi registrada."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível retirar o consentimento."); }
  }

  return <main className="min-h-screen bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-8 sm:py-10"><div className="mx-auto max-w-3xl">
    <Link href="/suinda/profile" className="inline-flex min-h-10 items-center gap-2 text-sm text-[#b6c2cf] hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Perfil acadêmico</Link>
    <header className="mt-5 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-[.14em] text-cyan-200">Suindá · Privacidade</p><h1 className="mt-2 text-2xl font-semibold text-white">Seus dados e solicitações</h1><p className="mt-2 text-sm leading-6 text-[#b6c2cf]">Registre uma solicitação relacionada aos seus dados acadêmicos. A coordenação analisará a identidade, o escopo e as obrigações de retenção aplicáveis antes de responder. Um pedido de eliminação não apaga automaticamente históricos acadêmicos.</p></header>
    <form onSubmit={(event) => void submit(event)} className="mt-6 grid gap-4 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7">
      <h2 className="text-lg font-semibold text-white">Nova solicitação</h2>
      <label className="text-sm font-medium text-[#b6c2cf]">Instituição<select required value={workspace} onChange={(event) => setWorkspace(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-white">{workspaces.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{item.workspace_name}</option>)}</select></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-[#b6c2cf]">Direito<select value={requestType} onChange={(event) => setRequestType(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-white">{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm font-medium text-[#b6c2cf]">Escopo<select value={scope} onChange={(event) => setScope(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-white"><option value="account_profile">Perfil acadêmico</option><option value="academic_record">Matrícula e histórico</option><option value="consent">Consentimentos</option><option value="communications">Comunicações</option><option value="other">Outro</option></select></label></div>
      {requestType === "elimination" && <fieldset className="rounded-xl border border-[#3b4754] p-4"><legend className="px-1 text-sm font-medium text-[#b6c2cf]">Categorias solicitadas</legend><p className="mb-3 text-xs text-[#9fadbc]">A instituição decide cada categoria separadamente. Prazo de retenção vencido não executa uma eliminação.</p>{availableCategories.length ? availableCategories.map((category) => <label key={category} className="flex min-h-9 items-center gap-2 text-sm text-[#b6c2cf]"><input type="checkbox" checked={requestedCategories.includes(category)} onChange={(event) => setRequestedCategories((current) => event.target.checked ? [...current, category] : current.filter((item) => item !== category))} />{category}</label>) : <p className="text-sm text-amber-100">A instituição ainda não publicou categorias de dados; não é possível enviar pedido de eliminação.</p>}</fieldset>}
      <label className="text-sm font-medium text-[#b6c2cf]">Descreva sua solicitação<textarea required minLength={20} maxLength={3000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 min-h-32 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-white" /></label>
      {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
      <button type="submit" disabled={!workspace || description.trim().length < 20 || busy || requestType === "elimination" && requestedCategories.length === 0} aria-describedby={busy ? "privacy-request-progress" : undefined} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50"><Send size={15} aria-hidden="true" />{busy ? "Enviando…" : "Registrar solicitação"}</button>
      {busy && <p id="privacy-request-progress" role="status" className="sr-only">Registrando sua solicitação de privacidade. Aguarde.</p>}
    </form>
    {currentNotices.length > 0 && <section className="mt-6 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7"><h2 className="text-lg font-semibold text-white">Finalidades e avisos da instituição</h2><p className="mt-1 text-sm leading-6 text-[#9fadbc]">Cada aviso apresenta a finalidade, os dados envolvidos, a base legal declarada pela instituição e seu critério de retenção. Aceites ficam presos à revisão publicada.</p><div className="mt-4 grid gap-4">{currentNotices.map((item) => { const latestReceipt = consents.find((candidate) => candidate.payload.notice_record_id === item.id && candidate.payload.notice_revision === item.revision); const receipt = latestReceipt?.state === "accepted" ? latestReceipt : null; return <article key={item.id} className="rounded-xl border border-white/[0.08] bg-black/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium text-white">{item.title} · v{item.payload.version}</h3><p className="mt-1 text-sm leading-5 text-[#b6c2cf]">{item.payload.purpose}</p></div>{receipt && <span className="rounded-full bg-emerald-200/10 px-2.5 py-1 text-xs text-emerald-100">{receipt.payload.consent_status === "consented" ? "Consentido" : "Ciência registrada"}</span>}{latestReceipt?.state === "consent_withdrawn" && <span className="rounded-full bg-amber-200/10 px-2.5 py-1 text-xs text-amber-100">Consentimento retirado</span>}</div><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-[#b6c2cf]">Base legal declarada</dt><dd className="mt-0.5 text-[#b6c2cf]">{basisLabels[item.payload.legal_basis] || item.payload.legal_basis} · {item.payload.legal_basis_detail}</dd></div><div><dt className="text-[#b6c2cf]">Retenção</dt><dd className="mt-0.5 text-[#b6c2cf]">{item.payload.retention_description}{item.payload.retention_period_days > 0 ? ` · ${item.payload.retention_period_days} dias para ${item.payload.retention_record_kinds.join(", ")}` : " · revisão manual, sem prazo automático"}</dd></div><div><dt className="text-[#b6c2cf]">Categorias</dt><dd className="mt-0.5 text-[#b6c2cf]">{item.payload.data_categories.join(" · ")}</dd></div><div><dt className="text-[#b6c2cf]">Público</dt><dd className="mt-0.5 text-[#b6c2cf]">{item.payload.subject_categories.join(" · ")}</dd></div></dl><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{item.payload.notice_text}</p><div className="mt-4 flex flex-wrap gap-3">{!receipt && <button type="button" onClick={() => void respondToNotice(item)} className="min-h-10 rounded-lg bg-cyan-200 px-3.5 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">{item.payload.consent_required ? "Li e concordo com esta finalidade" : "Confirmo que li o aviso"}</button>}{receipt?.payload.consent_status === "consented" && <button type="button" onClick={() => void withdrawConsent(receipt)} className="min-h-10 rounded-lg border border-white/15 px-3.5 text-sm text-[#b6c2cf] hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Retirar consentimento</button>}</div></article>; })}</div></section>}
    <section className="mt-6 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7"><h2 className="text-lg font-semibold text-white">Acompanhamento</h2>{records.length ? <ul className="mt-4 divide-y divide-white/[0.08]">{records.map((record) => <li key={record.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"><div className="flex gap-3"><FileText size={17} className="mt-0.5 text-cyan-200" aria-hidden="true"/><div><p className="text-sm font-medium text-[#dee4ea]">{typeLabels[record.payload.request_type] || "Solicitação"} · {record.payload.request_scope}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#9fadbc]">{record.payload.request_description}</p>{record.payload.requested_categories?.length ? <p className="mt-1 text-xs text-[#9fadbc]">Categorias: {record.payload.requested_categories.join(" · ")}</p> : null}{record.payload.response_summary && <p className="mt-2 text-xs leading-5 text-emerald-100">Resposta: {record.payload.response_summary}</p>}{record.payload.request_type === "elimination" && <p role="status" className={`mt-2 text-xs ${record.privacy_execution?.state === "completed" ? "text-emerald-200" : "text-amber-100"}`}>{record.privacy_execution?.state === "completed" ? `Execução concluída · ${record.privacy_execution.result?.redacted_records || 0} registros e ${record.privacy_execution.result?.redacted_attachments || 0} anexos redigidos.` : record.privacy_execution?.state === "blocked" ? `Execução bloqueada: ${String(record.privacy_execution.result?.reason || "a coordenação precisa revisar o mapeamento")}` : "Execução pendente de decisão institucional e revisão dos mapeamentos por categoria."}</p>}{record.payload.request_type === "elimination" && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs text-[#9fadbc]">Confirme sua senha atual<input type="password" autoComplete="current-password" value={verifyRequestId === record.id ? verifyPassword : ""} onChange={(event) => { setVerifyRequestId(record.id); setVerifyPassword(event.target.value); }} className="mt-1 block min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" /></label><button type="button" onClick={() => void startIdentityVerification(record)} disabled={verifyRequestId !== record.id || !verifyPassword} className="min-h-10 rounded-lg border border-white/15 px-3 text-xs text-[#dee4ea] disabled:opacity-50">Enviar código ao e-mail verificado</button>{verifyRequestId === record.id && challengeId && <><label className="text-xs text-[#9fadbc]">Código de 6 dígitos<input inputMode="numeric" maxLength={6} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))} className="mt-1 block min-h-10 w-32 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" /></label><button type="button" onClick={() => void confirmIdentityVerification()} disabled={verificationCode.length !== 6} className="min-h-10 rounded-lg bg-cyan-200 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">Confirmar identidade</button></>}</div>}</div></div><span className="rounded-full bg-cyan-200/10 px-2.5 py-1 text-xs text-cyan-100">{stateLabels[record.state] || record.state}</span></li>)}</ul> : <p className="mt-3 text-sm text-[#9fadbc]">Você ainda não registrou solicitações.</p>}</section>
  </div></main>;
}
