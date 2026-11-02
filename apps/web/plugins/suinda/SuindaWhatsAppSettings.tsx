"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type WhatsAppConfig = { configured: boolean; waba_id: string | null; phone_number_id: string | null; access_token_configured: boolean; announcement_template_name: string | null; announcement_template_language: string | null; updated_at: string | null };
const inputClass = "min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-[#dee4ea] placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50";
const pathFor = (workspaceId: string) => `/extensions/suinda-whatsapp/workspaces/${encodeURIComponent(workspaceId)}/configuration`;

export function SuindaWhatsAppSettings({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<WhatsAppConfig | null>(null);
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [announcementTemplateName, setAnnouncementTemplateName] = useState("");
  const [announcementTemplateLanguage, setAnnouncementTemplateLanguage] = useState("pt_BR");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setStatus(null); setWabaId(""); setPhoneNumberId(""); setAccessToken(""); setError(""); setMessage(""); setLoading(true);
      if (!workspaceId) { setLoading(false); setError("Selecione um workspace para configurar o WhatsApp."); }
    });
    if (!workspaceId) return () => { cancelled = true; };
    void api<WhatsAppConfig>(pathFor(workspaceId)).then((result) => {
      if (cancelled) return;
      setStatus(result); setWabaId(result.waba_id || ""); setPhoneNumberId(result.phone_number_id || "");
      setAnnouncementTemplateName(result.announcement_template_name || ""); setAnnouncementTemplateLanguage(result.announcement_template_language || "pt_BR");
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível carregar a configuração do WhatsApp.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !workspaceId) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await api<WhatsAppConfig>(pathFor(workspaceId), { method: "PUT", body: JSON.stringify({
        waba_id: wabaId.trim(), phone_number_id: phoneNumberId.trim(), ...(accessToken ? { access_token: accessToken } : {}),
        ...(announcementTemplateName.trim() ? { announcement_template_name: announcementTemplateName.trim(), announcement_template_language: announcementTemplateLanguage.trim() } : {}),
      }) });
      setStatus(result); setAccessToken(""); setAnnouncementTemplateName(result.announcement_template_name || ""); setAnnouncementTemplateLanguage(result.announcement_template_language || "pt_BR"); setMessage("Configuração salva. O token não é exibido novamente.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a configuração do WhatsApp.");
    } finally { setSaving(false); }
  }

  const disabled = loading || saving || !workspaceId;
  return <section aria-labelledby="suinda-whatsapp-settings-title" className="mt-4 rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-4 sm:p-5">
    <h2 id="suinda-whatsapp-settings-title" className="text-sm font-semibold text-white">WhatsApp Cloud API</h2>
    <p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Canal opcional por workspace. O sistema só envia mensagens usando templates que a Meta informa como aprovados e após consentimento explícito do aluno para a categoria correspondente. O token fica cifrado no servidor e nunca aparece na leitura.</p>
    <form onSubmit={(event) => void save(event)} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs text-[#9fadbc]">WhatsApp Business Account ID<input required inputMode="numeric" pattern="[0-9]{5,30}" maxLength={30} value={wabaId} disabled={disabled} onChange={(event) => setWabaId(event.target.value)} className={inputClass}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc]">Phone Number ID<input required inputMode="numeric" pattern="[0-9]{5,30}" maxLength={30} value={phoneNumberId} disabled={disabled} onChange={(event) => setPhoneNumberId(event.target.value)} className={inputClass}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc] sm:col-span-2">Token de acesso<input type="password" autoComplete="new-password" minLength={30} maxLength={4096} required={!status?.access_token_configured} value={accessToken} disabled={disabled} onChange={(event) => setAccessToken(event.target.value)} placeholder={status?.access_token_configured ? "Configurado; deixe vazio para manter o token atual" : "Cole o token da Cloud API"} className={inputClass}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc]">Template de comunicado aprovado<input required={Boolean(announcementTemplateLanguage)} pattern="[a-z0-9_]{1,128}" maxLength={128} value={announcementTemplateName} disabled={disabled} onChange={(event) => setAnnouncementTemplateName(event.target.value)} placeholder="ex.: aviso_turma" className={inputClass}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc]">Idioma do template<input required={Boolean(announcementTemplateName)} pattern="[a-z]{2,3}(_[A-Z]{2})?" maxLength={8} value={announcementTemplateLanguage} disabled={disabled} onChange={(event) => setAnnouncementTemplateLanguage(event.target.value)} className={inputClass}/></label>
      <p className="text-xs leading-5 text-[#9fadbc] sm:col-span-2">O template de comunicado deve ter dois parâmetros de corpo na ordem: título e mensagem. Cada parâmetro aceita até 500 caracteres.</p>
      <p className="text-xs text-[#9fadbc] sm:col-span-2">Estado: {loading ? "carregando…" : status?.configured ? "configurado neste workspace" : "não configurado"}</p>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="submit" disabled={disabled} className="min-h-10 rounded-lg border border-cyan-200/20 bg-cyan-200/10 px-4 text-sm font-medium text-cyan-100 hover:bg-cyan-200/15 disabled:opacity-50">Salvar configuração</button>{saving && <span role="status" className="text-xs text-[#9fadbc]">Salvando…</span>}</div>
    </form>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}{message && <p role="status" className="mt-3 text-xs text-emerald-200">{message}</p>}
  </section>;
}
