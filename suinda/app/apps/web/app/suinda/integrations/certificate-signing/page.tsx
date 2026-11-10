"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Workspace = { id: string; name: string };
type SigningSettings = {
  configured: boolean; usable: boolean; subject: string | null; serial: string | null;
  fingerprint_sha256: string | null; valid_from: string | null; valid_until: string | null;
  updated_at: string | null; sub_filter: string | null;
};

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function dateLabel(value: string | null) {
  if (!value) return "Não informada";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "America/Recife" }).format(date) : "Data inválida";
}

export default function CertificateSigningSettingsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [settings, setSettings] = useState<SigningSettings | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void api<Workspace[]>("/workspaces").then((items) => {
      if (!active) return;
      setWorkspaces(items);
      const requested = new URLSearchParams(window.location.search).get("workspaceId") || "";
      setWorkspaceId(requested && items.some((item) => item.id === requested) ? requested : items[0]?.id || "");
      if (!items.length) setError("Nenhuma instituição administrável foi encontrada.");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar as instituições.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void api<SigningSettings>(`/extensions/suinda-certificate-signing/workspaces/${encodeURIComponent(workspaceId)}/config`).then((value) => {
      if (active) { setSettings(value); setError(""); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível consultar o certificado institucional.");
    });
    return () => { active = false; };
  }, [workspaceId]);

  async function save() {
    if (!workspaceId || !file || !passphrase || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await api<SigningSettings>(`/extensions/suinda-certificate-signing/workspaces/${encodeURIComponent(workspaceId)}/config`, {
        method: "PUT", body: JSON.stringify({ p12_base64: await fileToBase64(file), passphrase }),
      });
      setSettings(result); setFile(null); setPassphrase(""); setMessage("Certificado institucional salvo. Novos downloads usarão a assinatura PDF configurada.");
      const input = document.getElementById("certificate-p12") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o certificado institucional."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!workspaceId || saving || !window.confirm("Remover a credencial institucional deste workspace? Novos downloads continuarão como PDFs sem assinatura digital.")) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-certificate-signing/workspaces/${encodeURIComponent(workspaceId)}/config`, { method: "DELETE" });
      setSettings({ configured: false, usable: false, subject: null, serial: null, fingerprint_sha256: null, valid_from: null, valid_until: null, updated_at: null, sub_filter: null });
      setMessage("Credencial removida. Os próximos PDFs serão entregues sem assinatura digital.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível remover a credencial."); }
    finally { setSaving(false); }
  }

  return <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 text-[#e8edf2] sm:px-6 lg:px-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Suindá · integrações</p>
      <h1 className="text-2xl font-semibold text-white sm:text-3xl">Assinatura de certificados PDF</h1>
      <p className="max-w-3xl text-sm leading-6 text-[#aeb9c4]">Configure o arquivo PKCS#12/PFX de assinatura fornecido pela instituição. Sem uma credencial configurada e válida, o download continua disponível, mas o PDF será explicitamente entregue sem assinatura digital.</p>
      <p className="max-w-3xl rounded-lg border border-amber-200/20 bg-amber-200/[0.05] p-3 text-xs leading-5 text-amber-100">Envie somente uma credencial institucional autorizada. O arquivo e a senha ficam cifrados pelo cofre SecretVault do Orbit e nunca são devolvidos pela API. A assinatura usa o subfiltro ETSI.CAdES.detached; este recurso não declara conformidade ICP-Brasil nem substitui validação institucional/ITI.</p>
    </header>
    {workspaces.length > 1 && <label className="grid max-w-xl gap-1 text-xs text-[#aeb9c4]">Instituição
      <select value={workspaceId} onChange={(event) => { setSettings(null); setFile(null); setPassphrase(""); setMessage(""); setWorkspaceId(event.target.value); }} className="min-h-11 rounded-lg border border-[#46515c] bg-[#1d2125] px-3 text-sm text-white focus:border-cyan-300 focus:outline-none">
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
    </label>}
    {loading && <p role="status" className="text-sm text-[#9fadbc]">Carregando instituições…</p>}
    {workspaceId && <section className="max-w-3xl space-y-5 rounded-xl border border-[#3b4754] bg-[#1d2125] p-5">
      {settings?.configured ? <div className={`rounded-lg border p-4 ${settings.usable ? "border-emerald-200/20 bg-emerald-200/[0.04]" : "border-amber-200/20 bg-amber-200/[0.04]"}`}>
        <h2 className={`font-semibold ${settings.usable ? "text-emerald-100" : "text-amber-100"}`}>{settings.usable ? "Certificado configurado e dentro da validade" : "Certificado configurado, mas fora da validade"}</h2>
        <dl className="mt-3 grid gap-2 text-xs text-[#b6c2cf] sm:grid-cols-2">
          <div><dt className="text-[#9fadbc]">Titular</dt><dd>{settings.subject}</dd></div>
          <div><dt className="text-[#9fadbc]">Validade final</dt><dd>{dateLabel(settings.valid_until)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-[#9fadbc]">Impressão digital SHA-256</dt><dd className="break-all font-mono">{settings.fingerprint_sha256}</dd></div>
          <div><dt className="text-[#9fadbc]">Subfiltro PDF</dt><dd>{settings.sub_filter}</dd></div>
          <div><dt className="text-[#9fadbc]">Número de série</dt><dd className="font-mono">{settings.serial}</dd></div>
        </dl>
      </div> : <p className="rounded-lg border border-amber-200/20 bg-amber-200/[0.04] p-4 text-sm text-amber-100">Nenhuma credencial configurada. Os PDFs serão gerados sem assinatura digital.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-[#aeb9c4] sm:col-span-2">Arquivo institucional `.p12` ou `.pfx` (máximo 4 MB)
          <input id="certificate-p12" type="file" accept=".p12,.pfx,application/x-pkcs12,application/pkcs12" onChange={(event) => setFile(event.target.files?.[0] || null)} className="min-h-11 rounded-lg border border-[#46515c] bg-[#171a1d] p-2 text-xs text-white file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300" />
        </label>
        <label className="grid gap-1 text-xs text-[#aeb9c4] sm:col-span-2">Senha do arquivo PKCS#12
          <input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} maxLength={1024} className="min-h-11 rounded-lg border border-[#46515c] bg-[#171a1d] px-3 text-sm text-white focus:border-cyan-300 focus:outline-none" />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void save()} disabled={saving || !file || !passphrase} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{saving ? "Validando e salvando…" : "Salvar certificado institucional"}</button>
        {settings?.configured && <button type="button" onClick={() => void remove()} disabled={saving} className="min-h-10 rounded-lg border border-rose-200/30 px-4 text-sm font-medium text-rose-100 disabled:opacity-50">Remover credencial</button>}
      </div>
      {file && <p className="text-xs text-[#9fadbc]">Arquivo selecionado: {file.name} · {(file.size / 1024).toFixed(0)} KB. O arquivo não será mantido no navegador após salvar.</p>}
    </section>}
    {message && <p role="status" className="max-w-3xl rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">{message}</p>}
    {error && <p role="alert" className="max-w-3xl rounded-lg border border-rose-300/20 bg-rose-300/5 px-4 py-3 text-sm text-rose-100">{error}</p>}
    <Link href="/suinda" className="inline-flex min-h-10 items-center text-sm text-cyan-200 underline underline-offset-4">Voltar à área Suindá</Link>
  </main>;
}
