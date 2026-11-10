"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileText, Upload } from "lucide-react";
import { api, apiBlob } from "@/lib/api";

type LearnerDocument = {
  id: string; revision: number; title: string; state: string; created_at: string;
  category: string; description?: string; expires_at?: string; renews_document_id?: string;
  review_notes?: string; reviewed_at?: string;
  files: Array<{ id: string; revision: number; file_name: string; mime_type: string; size_bytes: number }>;
};
type AcademicDocument = {
  id: string; revision: number; title: string; document_type: string; audience_type: string;
  terms_version: string; terms_body: string; signing_required: boolean;
  attachments: Array<{ id: string; revision: number; file_name: string; mime_type: string; size_bytes: number }>;
};
type DocumentChecklistItem = { category: string; label: string; status: "complete" | "pending" | "expired" | "needs_update" | "missing"; document_id: string | null };
type LearnerDocumentsResponse = { documents: LearnerDocument[]; academic_documents: AcademicDocument[]; checklist: DocumentChecklistItem[]; course_revision: number; enrollment_state: string; enrollment_revision: number };

const categories = [
  ["identity", "Identificação"], ["education", "Formação acadêmica"], ["enrollment", "Matrícula"],
  ["payment", "Financeiro"], ["other", "Outro"],
] as const;
const academicDocumentTypes: Record<string, string> = { contract: "Contrato", commitment: "Termo de compromisso", regulation: "Regulamento", consent: "Termo de consentimento", other: "Documento acadêmico" };

function fileBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize)
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    return btoa(binary);
  });
}

function dateLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

function effectiveDocumentState(item: LearnerDocument) {
  const today = new Date().toISOString().slice(0, 10);
  return item.state === "approved" && item.expires_at && item.expires_at < today ? "expired" : item.state;
}

function canRequestRenewal(item: LearnerDocument) {
  const state = effectiveDocumentState(item);
  if (state === "expired" || state === "rejected") return true;
  if (state !== "approved" || !item.expires_at) return false;
  const expiration = Date.parse(`${item.expires_at}T00:00:00Z`);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return Number.isFinite(expiration) && expiration >= today.getTime() && expiration <= today.getTime() + 30 * 86400000;
}

export default function SuindaLearnerDocumentsPage() {
  const params = useParams<{ id: string }>();
  const enrollmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [documents, setDocuments] = useState<LearnerDocument[]>([]);
  const [academicDocuments, setAcademicDocuments] = useState<AcademicDocument[]>([]);
  const [checklist, setChecklist] = useState<DocumentChecklistItem[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("education");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [renewsDocumentId, setRenewsDocumentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [enrollmentState, setEnrollmentState] = useState("");
  const [enrollmentRevision, setEnrollmentRevision] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await api<LearnerDocumentsResponse>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/documents`);
      setDocuments(response.documents);
      setAcademicDocuments(response.academic_documents || []);
      setChecklist(response.checklist);
      setEnrollmentState(response.enrollment_state);
      setEnrollmentRevision(response.enrollment_revision);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar seus documentos."); }
    finally { setLoading(false); }
  }, [enrollmentId]);

  async function submitApplication() {
    if (busy || enrollmentState !== "application_draft" || checklist.some((item) => !["complete", "pending"].includes(item.status))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/submit`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: enrollmentRevision }),
      });
      setMessage("Inscrição enviada. A equipe acadêmica analisará sua solicitação.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar a inscrição."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    root.dataset.theme = "dark";
    Promise.resolve().then(load);
    return () => { if (previousTheme) root.dataset.theme = previousTheme; else delete root.dataset.theme; };
  }, [load]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/documents`, {
        method: "POST",
        body: JSON.stringify({ operation_key: crypto.randomUUID(), title: title.trim(), category, description: description.trim() || undefined, expires_at: expiresAt || undefined, renews_document_id: renewsDocumentId || undefined, file_name: file.name, mime_type: file.type, data_base64: await fileBase64(file) }),
      });
      setTitle(""); setCategory("education"); setDescription(""); setExpiresAt(""); setRenewsDocumentId(""); setFile(null);
      setMessage(renewsDocumentId ? "Documento de renovação enviado. O arquivo anterior permanece no histórico da matrícula." : "Documento enviado e registrado no histórico da matrícula.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar o documento."); }
    finally { setBusy(false); }
  }

  async function download(documentRecord: LearnerDocument, attachment: LearnerDocument["files"][number]) {
    setDownloading(attachment.id); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/records/${encodeURIComponent(documentRecord.id)}/attachments/${attachment.revision}/${encodeURIComponent(attachment.id)}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = attachment.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o documento."); }
    finally { setDownloading(""); }
  }

  async function downloadAcademicDocument(documentRecord: AcademicDocument, attachment: AcademicDocument["attachments"][number]) {
    setDownloading(attachment.id); setError("");
    try {
      const blob = await apiBlob(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/academic-documents/${encodeURIComponent(documentRecord.id)}/attachments/${attachment.revision}/${encodeURIComponent(attachment.id)}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = attachment.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o documento acadêmico."); }
    finally { setDownloading(""); }
  }

  return <main className="min-h-screen bg-[#1d2125] px-4 py-6 text-[#dee4ea] sm:px-7 lg:py-9"><div className="mx-auto max-w-5xl">
    <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-[#b6c2cf] hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Voltar ao curso</Link>
    <header className="mt-6 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.12),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-5 sm:p-7"><p className="text-xs font-medium uppercase tracking-[.14em] text-cyan-200">Suindá · área do aluno</p><h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{enrollmentState === "application_draft" ? "Documentos da inscrição" : "Meus documentos acadêmicos"}</h1><p className="mt-2 text-sm leading-6 text-[#b6c2cf]">{enrollmentState === "application_draft" ? "Envie os documentos obrigatórios e conclua sua inscrição. Você pode salvar e voltar a este rascunho depois." : "Envie, consulte e baixe os documentos associados a esta matrícula."}</p></header>
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</p>}
    {message && <p role="status" className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">{message}</p>}
    {checklist.length > 0 && <section className="mt-5 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7" aria-labelledby="required-documents-title"><h2 id="required-documents-title" className="text-lg font-semibold text-white">Checklist da matrícula</h2><p className="mt-1 text-xs text-[#9fadbc]">Requisitos definidos para a revisão curricular desta matrícula. Um documento só conta após aprovação e enquanto estiver válido.</p><ul className="mt-4 grid gap-3 sm:grid-cols-2">{checklist.map((item) => <li key={item.category} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3"><span className="text-sm text-[#b6c2cf]">{item.label}</span><span className={`rounded-full px-2.5 py-1 text-[11px] ${item.status === "complete" ? "bg-emerald-300/10 text-emerald-200" : item.status === "pending" ? "bg-amber-300/10 text-amber-100" : "bg-rose-300/10 text-rose-100"}`}>{({ complete: "Aprovado", pending: "Em análise", expired: "Vencido", needs_update: "Atualização solicitada", missing: "Pendente" })[item.status]}</span></li>)}</ul></section>}
    <section className="mt-5 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7" aria-labelledby="academic-library-title"><h2 id="academic-library-title" className="flex items-center gap-2 text-lg font-semibold text-white"><FileText size={18} className="text-cyan-200" aria-hidden="true" /> Biblioteca acadêmica</h2><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Documentos publicados para sua instituição, curso e turma, conforme a revisão curricular desta matrícula.</p>{loading ? <p role="status" className="mt-4 text-sm text-[#9fadbc]">Carregando documentos publicados…</p> : academicDocuments.length ? <div className="mt-4 grid gap-3">{academicDocuments.map((item) => <article key={`${item.id}:${item.revision}`} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-cyan-200">{academicDocumentTypes[item.document_type] || academicDocumentTypes.other} · versão {item.terms_version} · revisão {item.revision}</p><h3 className="mt-1 text-sm font-semibold text-white">{item.title}</h3><p className="mt-1 text-xs text-[#9fadbc]">{item.audience_type === "workspace" ? "Institucional" : item.audience_type === "course" ? "Deste curso" : "Desta turma"} · {item.signing_required ? "Aceite solicitado" : "Documento para consulta"}</p></div>{item.signing_required && <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}/agreements`} className="inline-flex min-h-9 items-center rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 hover:bg-cyan-200/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Ver aceite</Link>}</div><div role="region" aria-label={`Documento completo: ${item.title}`} tabIndex={0} className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[#3b4754] bg-black/20 p-3 text-sm leading-6 text-[#b6c2cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{item.terms_body}</div>{item.attachments.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Anexos de ${item.title}`}>{item.attachments.map((attachment) => <li key={attachment.id}><button type="button" aria-label={`Baixar ${attachment.file_name} de ${item.title}`} onClick={() => void downloadAcademicDocument(item, attachment)} disabled={Boolean(downloading)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50"><Download size={13} aria-hidden="true" />{downloading === attachment.id ? "Baixando…" : attachment.file_name}</button></li>)}</ul>}</article>)}</div> : <p className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm text-[#9fadbc]">Nenhum documento acadêmico publicado se aplica a esta matrícula.</p>}</section>
    {enrollmentState === "application_draft" && <section className="mt-5 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.04] p-5 sm:p-7"><h2 className="text-lg font-semibold text-white">Concluir inscrição</h2><p className="mt-1 text-sm leading-6 text-[#b6c2cf]">Os documentos podem seguir para análise assim que enviados; a aprovação deles será feita pela equipe acadêmica.</p><button type="button" onClick={() => void submitApplication()} disabled={busy || loading || checklist.some((item) => !["complete", "pending"].includes(item.status))} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Enviando inscrição…" : "Enviar inscrição"}</button></section>}
    <section className="mt-5 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7" aria-labelledby="upload-document-title"><h2 id="upload-document-title" className="flex items-center gap-2 text-lg font-semibold text-white"><Upload size={18} className="text-cyan-200" aria-hidden="true" /> Enviar documento</h2><p className="mt-2 text-xs leading-5 text-[#9fadbc]">PDF, PNG, JPEG, texto, DOCX ou XLSX; máximo de 8 MB. O arquivo é verificado e fica privado para você e a equipe acadêmica autorizada.</p>
      {renewsDocumentId && <p role="status" className="mt-3 rounded-lg border border-cyan-200/15 bg-cyan-200/[0.04] p-3 text-xs text-cyan-100">Renovação de “{documents.find((item) => item.id === renewsDocumentId)?.title}”. O envio ficará vinculado ao documento anterior, que continuará preservado no histórico. <button type="button" onClick={() => setRenewsDocumentId("")} className="ml-2 underline">Cancelar renovação</button></p>}
      <form id="document-upload-form" onSubmit={upload} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-xs text-[#b6c2cf]">Título<input required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label>
        <label className="block text-xs text-[#b6c2cf]">Categoria<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-xs text-[#b6c2cf]">Descrição (opcional)<textarea maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label>
        <label className="block text-xs text-[#b6c2cf]">Validade (opcional)<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label>
        <label className="block text-xs text-[#b6c2cf] sm:col-span-2">Arquivo<input required type="file" accept="application/pdf,image/png,image/jpeg,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const selected = event.target.files?.[0] || null; setFile(selected); if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, "")); }} className="mt-1 block min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-2 py-2 text-xs text-[#b6c2cf] file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label>
        <button type="submit" aria-busy={busy} disabled={busy || !file || !title.trim()} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50">{busy ? "Enviando…" : "Enviar para esta matrícula"}</button>
      </form>
    </section>
    <section className="mt-5 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7" aria-labelledby="documents-list-title"><h2 id="documents-list-title" className="flex items-center gap-2 text-lg font-semibold text-white"><FileText size={18} className="text-cyan-200" aria-hidden="true" /> Documentos da matrícula</h2>
      {loading ? <p role="status" className="mt-4 text-sm text-[#9fadbc]">Carregando documentos…</p> : documents.length ? <ul className="mt-4 divide-y divide-white/[0.07]">{documents.map((item) => { const state = effectiveDocumentState(item); const acceptedRenewal = documents.find((candidate) => candidate.renews_document_id === item.id && ["submitted", "approved"].includes(candidate.state)); return <li key={item.id} className="py-4 first:pt-0 last:pb-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-[#9fadbc]">{categories.find(([value]) => value === item.category)?.[1] || "Documento"} · enviado em {dateLabel(item.created_at)}{item.expires_at ? ` · válido até ${dateLabel(item.expires_at)}` : ""}</p>{item.description && <p className="mt-1 text-xs leading-5 text-[#9fadbc]">{item.description}</p>}<span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] ${state === "approved" ? "bg-emerald-300/10 text-emerald-200" : state === "rejected" || state === "expired" ? "bg-rose-300/10 text-rose-200" : "bg-amber-300/10 text-amber-100"}`}>{state === "approved" ? "Aprovado" : state === "rejected" ? "Precisa de atualização" : state === "expired" ? "Expirado" : "Em análise"}</span>{item.renews_document_id && <p className="mt-1 text-xs text-cyan-200">Renovação vinculada ao documento anterior.</p>}{acceptedRenewal && <p role="status" className="mt-1 text-xs text-amber-100">{acceptedRenewal.state === "approved" ? "Atualização aprovada." : "Atualização enviada e aguardando análise."}</p>}{item.review_notes && <p className="mt-2 text-xs text-[#9fadbc]">Retorno da equipe: {item.review_notes}</p>}{canRequestRenewal(item) && !acceptedRenewal && <button type="button" onClick={() => { setRenewsDocumentId(item.id); setTitle(item.title); setCategory(item.category); setDescription(item.description || ""); document.getElementById("document-upload-form")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }} className="mt-2 min-h-9 rounded-lg border border-cyan-200/20 px-3 text-xs text-cyan-100 hover:bg-cyan-200/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{state === "approved" ? "Enviar atualização antecipada" : "Enviar renovação"}</button>}</div><div className="flex flex-wrap gap-2">{item.files.map((attachment) => <button key={attachment.id} type="button" aria-label={`Baixar ${attachment.file_name} do documento ${item.title}`} onClick={() => void download(item, attachment)} disabled={Boolean(downloading)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#3b4754] px-3 text-xs text-cyan-100 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50"><Download size={13} aria-hidden="true" />{downloading === attachment.id ? "Baixando…" : attachment.file_name}</button>)}</div></div></li>; })}</ul> : <p className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm text-[#9fadbc]">Nenhum documento foi enviado para esta matrícula.</p>}
    </section>
  </div></main>;
}
