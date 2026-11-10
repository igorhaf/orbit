"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type PaymentProviderStatus = {
  provider: "mercado_pago";
  configured: boolean;
  account_label: string | null;
  updated_at: string | null;
};

const fieldClass = "min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-[#dee4ea] placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50";
const pathFor = (workspaceId: string) => `/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/payment-provider`;

export function PaymentProviderSettings({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<PaymentProviderStatus | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setLoading(false);
        setError("Selecione um workspace para configurar os pagamentos.");
      });
      return () => { cancelled = true; };
    }

    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true); setError(""); setMessage(""); setStatus(null); setAccessToken(""); setWebhookSecret("");
    });
    void api<PaymentProviderStatus>(pathFor(workspaceId)).then((result) => {
      if (!cancelled) setStatus(result);
    }).catch((cause: unknown) => {
      if (!cancelled && cause && typeof cause === "object" && "status" in cause && cause.status === 403) setForbidden(true);
      else if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível carregar a configuração do Mercado Pago.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [workspaceId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !workspaceId || !accessToken.trim() || !webhookSecret.trim()) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ configured: true; provider: "mercado_pago" }>(pathFor(workspaceId), {
        method: "PUT",
        body: JSON.stringify({ access_token: accessToken, webhook_secret: webhookSecret }),
      });
      setStatus((current) => ({
        provider: result.provider,
        configured: result.configured,
        account_label: current?.account_label ?? null,
        updated_at: new Date().toISOString(),
      }));
      setAccessToken("");
      setWebhookSecret("");
      setMessage("Credenciais do Mercado Pago salvas com segurança no servidor.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar as credenciais do Mercado Pago.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving || !workspaceId;
  if (forbidden) return null;

  return (
    <section aria-labelledby="suinda-payment-provider-title" className="rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-4 sm:p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Pagamentos</p>
        <h2 id="suinda-payment-provider-title" className="mt-1 text-base font-semibold text-white">Mercado Pago</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">
          Informe as credenciais de servidor da conta Mercado Pago: o Access Token e o Webhook Secret. Elas são enviadas à API e armazenadas no servidor; nunca são exibidas depois de salvas.
        </p>
      </div>

      <div className="mt-3" aria-live="polite" aria-atomic="true">
        {loading ? <p role="status" className="text-xs text-[#9fadbc]">Carregando configuração…</p> : status?.configured ? (
          <p className="inline-flex min-h-8 items-center rounded-full border border-emerald-200/20 bg-emerald-200/10 px-3 text-xs font-medium text-emerald-100">
            Mercado Pago configurado{status.updated_at ? ` · atualizado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(status.updated_at))}` : ""}
          </p>
        ) : !error ? (
          <p className="inline-flex min-h-8 items-center rounded-full border border-amber-200/20 bg-amber-200/10 px-3 text-xs font-medium text-amber-100">Credenciais ainda não configuradas</p>
        ) : null}
      </div>

      <form onSubmit={save} aria-busy={saving} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-medium text-[#b6c2cf]">
          Access Token
          <input
            className={fieldClass}
            type="password"
            name="suinda-mercado-pago-access-token"
            autoComplete="new-password"
            spellCheck={false}
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            required
            disabled={disabled}
            aria-describedby="suinda-payment-access-help"
            placeholder="Cole o Access Token do servidor"
          />
          <span id="suinda-payment-access-help" className="font-normal leading-5 text-[#9fadbc]">Token privado da conta Mercado Pago, usado somente pela API do Suindá.</span>
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-[#b6c2cf]">
          Webhook Secret
          <input
            className={fieldClass}
            type="password"
            name="suinda-mercado-pago-webhook-secret"
            autoComplete="new-password"
            spellCheck={false}
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
            required
            disabled={disabled}
            aria-describedby="suinda-payment-webhook-help"
            placeholder="Cole o segredo de assinatura do webhook"
          />
          <span id="suinda-payment-webhook-help" className="font-normal leading-5 text-[#9fadbc]">Segredo configurado para validar notificações recebidas pelo servidor.</span>
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={disabled || !accessToken.trim() || !webhookSecret.trim()} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Salvando credenciais…" : status?.configured ? "Substituir credenciais" : "Salvar credenciais"}
          </button>
        </div>
      </form>

      <div className="mt-3 min-h-5" aria-live="polite" aria-atomic="true">
        {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
        {message && <p role="status" className="text-xs text-emerald-200">{message}</p>}
      </div>
    </section>
  );
}
