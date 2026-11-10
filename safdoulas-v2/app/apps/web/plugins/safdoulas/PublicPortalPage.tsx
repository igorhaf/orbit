"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type PortalContent = { id: string; section: string; title: string; summary: string; body: string; url: string; source_reference: string; order: number };
type Portal = {
  available: boolean;
  settings: null | { organization_name: string; description: string; contact_email: string; contact_url: string; help_url: string; application_url: string };
  contents: PortalContent[];
};
type Verification = { verification_code?: string; provider_name?: string; course_name?: string; modality?: string; description?: string; valid_from?: string; valid_until?: string; status?: string; seal_downloads?: { print: string; digital: string } | null };

const sectionLabels: Record<string, string> = {
  current_call: "Editais vigentes",
  rule: "Regras e documentos normativos",
  guidance: "Orientações",
  document: "Documentos públicos",
  help: "Central de ajuda",
};
const accreditationStatus: Record<string, string> = {
  valid: "Vigente",
  not_yet_valid: "Ainda não vigente",
  expired: "Expirada",
  suspended: "Suspensa",
  cancelled: "Cancelada",
  inactive: "Inativa",
};

export default function SafdoulasPublicPortalPage() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifyError, setVerifyError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let active = true;
    api<Portal>("/public/safdoulas/portal")
      .then((data) => { if (active) setPortal(data); })
      .catch((reason) => { if (active) setError((reason as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{12,64}$/.test(normalized)) {
      setVerification(null);
      setVerifyError("Digite o código de verificação informado no documento.");
      return;
    }
    setVerifying(true);
    setVerification(null);
    setVerifyError("");
    try {
      setVerification(await api<Verification>(`/public/safdoulas/accreditations/${encodeURIComponent(normalized)}`));
    } catch {
      setVerifyError("Não encontramos uma acreditação publicada com esse código.");
    } finally {
      setVerifying(false);
    }
  }

  const sections = [...new Set((portal?.contents || []).map((item) => item.section))];
  return (
    <main className="min-h-screen bg-[#fbf7f1] text-[#34231e]">
      <header className="border-b border-[#e7d5c3] bg-white px-4 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <a href="/safdoulas" className="text-xl font-bold text-[#6f241e]">{portal?.settings?.organization_name || "SAFDOULAS"}</a>
          {portal?.settings?.application_url && <a href={portal.settings.application_url} className="rounded-lg bg-[#8e3022] px-4 py-2.5 font-semibold text-white hover:bg-[#72251b]">Iniciar solicitação</a>}
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-8 sm:py-12">
        {loading && <p role="status" className="rounded-xl border border-[#e7d5c3] bg-white p-5">Carregando informações públicas…</p>}
        {error && <p role="alert" className="rounded-xl border border-[#d99a8e] bg-white p-5 text-[#8e3022]">Não foi possível carregar o portal. Tente novamente mais tarde.</p>}
        {!loading && !error && !portal?.available && <section className="rounded-2xl border border-[#e7d5c3] bg-white p-6 sm:p-8"><h1 className="text-2xl font-bold">Portal em preparação</h1><p className="mt-2 max-w-2xl text-[#66554e]">As informações aparecerão aqui após publicação e autorização institucional.</p></section>}
        {portal?.available && portal.settings && <>
          <section className="rounded-2xl bg-[#6f241e] p-6 text-white sm:p-10">
            <p className="text-sm font-semibold uppercase tracking-wide text-[#f2d5bd]">Acreditação e formação</p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{portal.settings.organization_name}</h1>
            <p className="mt-4 max-w-3xl whitespace-pre-line text-base leading-relaxed text-[#fff3e8]">{portal.settings.description}</p>
            {portal.settings.application_url && <a href={portal.settings.application_url} className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-white px-5 font-semibold text-[#6f241e]">Iniciar solicitação</a>}
          </section>
          <section className="rounded-2xl border border-[#e7d5c3] bg-white p-5 sm:p-7" aria-labelledby="verify-heading">
            <h2 id="verify-heading" className="text-xl font-bold">Consultar uma acreditação</h2>
            <p className="mt-1 text-sm text-[#66554e]">Informe o código de verificação apresentado no documento de concessão.</p>
            <form onSubmit={verify} className="mt-4 flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="accreditation-code">Código de verificação</label>
              <input id="accreditation-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={64} autoCapitalize="characters" className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#c9b6a7] bg-white px-3 text-base" placeholder="Ex.: SAF-ACRED-2026-001" />
              <button type="submit" disabled={verifying} className="min-h-11 rounded-lg bg-[#8e3022] px-5 font-semibold text-white disabled:opacity-60">{verifying ? "Consultando…" : "Consultar"}</button>
            </form>
            {verifyError && <p role="alert" className="mt-3 text-sm text-[#8e3022]">{verifyError}</p>}
            {verification && <dl className="mt-4 grid gap-3 rounded-xl bg-[#fbf7f1] p-4 sm:grid-cols-2">
              <div><dt className="text-sm text-[#66554e]">Instituição</dt><dd className="font-semibold">{verification.provider_name}</dd></div>
              <div><dt className="text-sm text-[#66554e]">Curso</dt><dd className="font-semibold">{verification.course_name}</dd></div>
              <div><dt className="text-sm text-[#66554e]">Modalidade</dt><dd>{verification.modality || "Não informada"}</dd></div>
              <div><dt className="text-sm text-[#66554e]">Situação</dt><dd className="font-semibold">{accreditationStatus[verification.status || ""] || "Não disponível"}</dd></div>
              <div><dt className="text-sm text-[#66554e]">Validade</dt><dd>{verification.valid_from || "—"} a {verification.valid_until || "—"}</dd></div>
              {verification.description && <div className="sm:col-span-2"><dt className="text-sm text-[#66554e]">Escopo</dt><dd>{verification.description}</dd></div>}
              {verification.seal_downloads && <div className="sm:col-span-2"><dt className="text-sm text-[#66554e]">Selo oficial autorizado</dt><dd className="mt-1 flex flex-wrap gap-4"><a className="font-semibold text-[#8e3022] underline" href={verification.seal_downloads.print}>Baixar arquivo para impressão</a><a className="font-semibold text-[#8e3022] underline" href={verification.seal_downloads.digital}>Baixar arquivo digital</a></dd></div>}
            </dl>}
          </section>
          {sections.map((section) => <section key={section} aria-labelledby={`section-${section}`}>
            <h2 id={`section-${section}`} className="mb-3 text-2xl font-bold text-[#6f241e]">{sectionLabels[section] || "Informações"}</h2>
            <ul className="grid gap-4 md:grid-cols-2">
              {portal.contents.filter((item) => item.section === section).map((item) => <li key={item.id} className="min-w-0 rounded-2xl border border-[#e7d5c3] bg-white p-5">
                <h3 className="break-words text-lg font-bold">{item.title}</h3>
                {item.summary && <p className="mt-2 whitespace-pre-line text-sm font-medium text-[#66554e]">{item.summary}</p>}
                {item.body && <p className="mt-3 whitespace-pre-line leading-relaxed">{item.body}</p>}
                {item.source_reference && <p className="mt-3 text-xs text-[#66554e]">Fonte: {item.source_reference}</p>}
                {item.url && <a href={item.url} target={item.url.startsWith("https://") ? "_blank" : undefined} rel={item.url.startsWith("https://") ? "noreferrer" : undefined} className="mt-4 inline-flex min-h-11 items-center font-semibold text-[#8e3022] underline">Abrir conteúdo</a>}
              </li>)}
            </ul>
          </section>)}
          {(portal.settings.contact_email || portal.settings.contact_url || portal.settings.help_url) && <footer className="border-t border-[#e7d5c3] pt-5 text-sm text-[#66554e]">
            <h2 className="font-semibold text-[#34231e]">Contato e ajuda</h2>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {portal.settings.contact_email && <a className="underline" href={`mailto:${portal.settings.contact_email}`}>{portal.settings.contact_email}</a>}
              {portal.settings.contact_url && <a className="underline" href={portal.settings.contact_url}>Contato</a>}
              {portal.settings.help_url && <a className="underline" href={portal.settings.help_url}>Central de ajuda</a>}
            </div>
          </footer>}
        </>}
      </div>
    </main>
  );
}
