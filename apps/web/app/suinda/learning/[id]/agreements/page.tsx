"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileSignature } from "lucide-react";
import { api } from "@/lib/api";

type Agreement = {
  id: string; revision: number; title: string; document_type: string; audience_type: string;
  terms_version: string; terms_body: string; signing_required: boolean; signed: boolean;
  signature: { signer_name: string; signed_at: string; terms_sha256: string; signature_evidence_sha256: string } | null;
};
type AgreementResponse = { signer_name: string; terms: Agreement[]; history: Array<{ id: string; term_title_snapshot: string; terms_version: string; signer_name: string; signed_at: string; terms_sha256: string; signature_evidence_sha256: string }> };

const typeLabel: Record<string, string> = { contract: "Contrato", commitment: "Compromisso", regulation: "Regulamento", consent: "Consentimento", other: "Documento acadêmico" };

export default function SuindaAcademicAgreementsPage() {
  const params = useParams<{ id: string }>();
  const enrollmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [terms, setTerms] = useState<Agreement[]>([]);
  const [history, setHistory] = useState<AgreementResponse["history"]>([]);
  const [signer, setSigner] = useState("");
  const [confirm, setConfirm] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await api<AgreementResponse>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/signatures`); setTerms(result.terms); setHistory(result.history); setSigner((current) => current || result.signer_name); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os documentos acadêmicos."); }
    finally { setLoading(false); }
  }, [enrollmentId]);
  useEffect(() => {
    const root = document.documentElement; const previous = root.dataset.theme; root.dataset.theme = "dark";
    Promise.resolve().then(load);
    return () => { if (previous) root.dataset.theme = previous; else delete root.dataset.theme; };
  }, [load]);
  async function sign(term: Agreement) {
    if (busy || !confirm[term.id] || !signer.trim()) return;
    setBusy(term.id); setError(""); setMessage("");
    try {
      const result = await api<{ already_signed: boolean }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/signatures/${encodeURIComponent(term.id)}`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), signer_name: signer.trim(), confirm_terms: true }),
      });
      setMessage(result.already_signed ? "Este documento já estava assinado." : "Assinatura registrada com a revisão publicada do documento.");
      setConfirm((current) => ({ ...current, [term.id]: false })); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a assinatura."); }
    finally { setBusy(""); }
  }
  return <main className="min-h-screen bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-7"><div className="mx-auto max-w-3xl">
    <Link href={`/suinda/learning/${encodeURIComponent(enrollmentId)}`} className="inline-flex min-h-10 items-center gap-2 text-sm text-[#b6c2cf] hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Voltar ao curso</Link>
    <header className="mt-5 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.12),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-6"><p className="text-xs font-medium uppercase tracking-[0.14em] text-cyan-200">Documentos e aceite</p><h1 className="mt-2 text-2xl font-semibold">Biblioteca de documentos acadêmicos</h1><p className="mt-2 text-sm text-[#b6c2cf]">Consulte os documentos publicados para esta matrícula. Quando a assinatura for exigida, ela ficará vinculada ao conteúdo e à matrícula mostrados.</p></header>
    {error && <p role="alert" className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p>}{message && <p role="status" className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm text-emerald-100">{message}</p>}
    {loading ? <p role="status" className="mt-6 text-sm text-[#9fadbc]">Carregando documentos…</p> : !terms.length ? <section className="mt-6 rounded-xl border border-[#3b4754] bg-white/[0.03] p-5 text-sm text-[#b6c2cf]">Não há documentos acadêmicos publicados para esta matrícula.</section> : <div className="mt-6 grid gap-5">{terms.map((term) => <article key={`${term.id}:${term.revision}`} aria-labelledby={`term-title-${term.id}`} className="rounded-2xl border border-[#3b4754] bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-cyan-200">{typeLabel[term.document_type] || typeLabel.other} · {term.terms_version} · revisão {term.revision}</p><h2 id={`term-title-${term.id}`} className="mt-1 text-lg font-semibold">{term.title}</h2></div><div className="flex flex-wrap gap-2">{!term.signing_required && <span className="rounded-full bg-sky-300/10 px-3 py-1.5 text-xs text-sky-100">Consulta</span>}{term.signed && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100"><CheckCircle2 size={14} aria-hidden="true" /> Assinado</span>}</div></div>
      <div role="region" aria-label={`Texto completo: ${term.title}`} tabIndex={0} className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-[#3b4754] bg-black/20 p-4 text-sm leading-6 text-[#b6c2cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">{term.terms_body}</div>
      {term.signed ? <p className="mt-3 text-xs text-[#9fadbc]">Assinado por {term.signature?.signer_name} em {term.signature?.signed_at ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(term.signature.signed_at)) : "—"}. Evidência SHA-256: <span className="break-all font-mono">{term.signature?.signature_evidence_sha256}</span></p> : !term.signing_required ? <p className="mt-4 text-sm text-[#9fadbc]">Documento publicado para consulta; não exige assinatura.</p> : <div className="mt-4 grid gap-3">
        <label className="flex items-start gap-2 text-sm text-[#b6c2cf]"><input type="checkbox" checked={Boolean(confirm[term.id])} onChange={(event) => setConfirm((current) => ({ ...current, [term.id]: event.target.checked }))} className="mt-1 accent-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /><span>Li o documento completo acima e concordo com esta revisão.</span></label>
        <label className="grid gap-1 text-sm text-[#b6c2cf]">Digite seu nome exatamente como aparece no perfil<input value={signer} onChange={(event) => setSigner(event.target.value)} maxLength={240} autoComplete="name" className="min-h-11 rounded-xl border border-[#3b4754] bg-black/20 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label>
        <button type="button" aria-busy={busy === term.id} disabled={busy === term.id || !confirm[term.id] || !signer.trim()} onClick={() => void sign(term)} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50"><FileSignature size={15} aria-hidden="true" />{busy === term.id ? "Registrando…" : "Assinar documento"}</button>
      </div>}
    </article>)}</div>}
    {history.length > 0 && <section className="mt-8"><h2 className="text-lg font-semibold">Histórico de assinaturas</h2><div className="mt-3 grid gap-2">{history.map((item) => <article key={item.id} className="rounded-xl border border-[#3b4754] bg-white/[0.03] p-4"><p className="text-sm font-medium">{item.term_title_snapshot} · {item.terms_version}</p><p className="mt-1 text-xs text-[#9fadbc]">{item.signer_name} · {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.signed_at))}</p><p className="mt-2 break-all font-mono text-[10px] text-[#9fadbc]">Documento {item.terms_sha256} · Evidência {item.signature_evidence_sha256}</p></article>)}</div></section>}
  </div></main>;
}
