"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type Consent = {
  configured: boolean;
  opted_in: boolean;
  categories: string[];
  consented_at: string | null;
  revoked_at: string | null;
  phone_masked?: string;
};

const categories = [
  ["academic_reminder", "Lembretes acadêmicos"],
  ["survey_reminder", "Lembretes de pesquisas"],
  ["attendance_risk", "Alertas de frequência"],
  ["announcement", "Comunicados da instituição"],
  ["study_group_message", "Mensagens de grupos de estudo"],
] as const;
const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50";
const pathFor = (workspaceId: string) => `/extensions/suinda-whatsapp/workspaces/${encodeURIComponent(workspaceId)}/consent`;

function unavailableError(error: unknown) {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  return status === 403 || status === 404 || status === 409 || status === 500 || status === 503;
}

function dateLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function SuindaWhatsAppConsent({ workspaceId }: { workspaceId: string }) {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [phone, setPhone] = useState("");
  const [optedIn, setOptedIn] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api<Consent>(pathFor(workspaceId)).then((result) => {
      if (cancelled) return;
      setConsent(result);
      setOptedIn(result.opted_in);
      setSelectedCategories(result.categories.filter((category) => categories.some(([value]) => value === category)));
    }).catch((cause: unknown) => {
      if (cancelled) return;
      setUnavailable(true);
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar seu consentimento.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, reloadKey]);

  function retry() {
    setLoading(true);
    setConsent(null);
    setPhone("");
    setOptedIn(false);
    setSelectedCategories([]);
    setUnavailable(false);
    setError("");
    setMessage("");
    setReloadKey((value) => value + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !workspaceId) return;
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone.trim())) {
      setError("Informe um telefone no formato internacional E.164, por exemplo +5511999999999.");
      return;
    }
    if (optedIn && selectedCategories.length === 0) {
      setError("Escolha ao menos uma categoria para autorizar as mensagens.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api<Consent>(pathFor(workspaceId), {
        method: "PUT",
        body: JSON.stringify({ phone_e164: phone.trim(), opted_in: optedIn, categories: optedIn ? selectedCategories : [] }),
      });
      setConsent(result);
      setOptedIn(result.opted_in);
      setSelectedCategories(result.categories.filter((category) => categories.some(([value]) => value === category)));
      setMessage(result.opted_in ? "Consentimento salvo para este workspace." : "Consentimento revogado neste workspace.");
    } catch (cause: unknown) {
      if (unavailableError(cause)) setUnavailable(true);
      else setError(cause instanceof Error ? cause.message : "Não foi possível salvar seu consentimento.");
    } finally { setSaving(false); }
  }

  return <section aria-labelledby={`whatsapp-consent-title-${workspaceId}`} className="mb-5 rounded-xl border border-emerald-200/15 bg-[#252b31] p-4">
    <h3 id={`whatsapp-consent-title-${workspaceId}`} className="text-sm font-semibold text-white">Consentimento para mensagens por WhatsApp</h3>
    <p className="mt-1 text-xs leading-5 text-[#b6c2cf]">Este consentimento vale somente para {"este workspace"}. Você escolhe as categorias e pode revogar a autorização quando quiser. O número é exibido de forma mascarada após o salvamento.</p>
    {loading ? <p role="status" className="mt-3 text-sm text-[#b6c2cf]">Carregando consentimento…</p> : unavailable ? <div className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/[0.04] p-3"><p className="text-sm text-amber-100">O consentimento por WhatsApp está indisponível neste momento ou o recurso está desativado. Seu perfil acadêmico continua disponível.</p>{error && <p role="alert" className="mt-2 text-xs text-[#b6c2cf]">{error}</p>}<button type="button" onClick={retry} className="mt-2 min-h-9 rounded-lg border border-white/15 px-3 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Tentar novamente</button></div> : <>
      {consent?.phone_masked && <p className="mt-3 text-xs text-[#b6c2cf]">Número registrado: <span className="font-medium text-white">{consent.phone_masked}</span></p>}
      {consent?.consented_at && <p className="mt-1 text-xs text-[#9fadbc]">Autorizado em {dateLabel(consent.consented_at)}{consent.revoked_at ? ` · revogado em ${dateLabel(consent.revoked_at)}` : ""}</p>}
      {consent && !consent.configured && <p className="mt-3 text-xs text-[#b6c2cf]">Nenhum consentimento foi salvo para este workspace.</p>}
      <form onSubmit={(event) => void save(event)} className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs font-medium text-[#b6c2cf]">Número do WhatsApp em formato internacional E.164
          <input type="tel" inputMode="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" title="Use +, o código do país e de 8 a 15 dígitos, sem espaços ou separadores." placeholder="+5511999999999" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={saving} className={inputClass} />
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-xs font-medium text-[#b6c2cf]">Categorias de mensagens</legend>
          {categories.map(([value, label]) => <label key={value} className="flex items-start gap-2 text-sm text-[#b6c2cf]"><input type="checkbox" checked={selectedCategories.includes(value)} disabled={saving || !optedIn} onChange={(event) => setSelectedCategories((current) => event.target.checked ? [...current, value] : current.filter((category) => category !== value))} className="mt-0.5 size-4 accent-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200" /><span>{label}</span></label>)}
        </fieldset>
        <label className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/10 p-3 text-sm text-white"><input type="checkbox" checked={optedIn} disabled={saving} onChange={(event) => { setOptedIn(event.target.checked); setError(""); }} className="mt-0.5 size-4 accent-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200" /><span>Autorizo receber mensagens de WhatsApp nas categorias selecionadas neste workspace.</span></label>
        {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
        {message && <p role="status" aria-live="polite" className="text-sm text-emerald-200">{message}</p>}
        <button type="submit" disabled={saving} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:opacity-50">{saving ? "Salvando…" : optedIn ? "Salvar consentimento" : consent?.opted_in ? "Revogar consentimento" : "Salvar preferência"}</button>
        {saving && <p role="status" className="sr-only">Salvando consentimento do WhatsApp…</p>}
      </form>
    </>}
  </section>;
}
