"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, send } from "@/lib/api";

type Challenge = { action: "enable" | "disable"; challenge_id: string; email_hint: string };

export function MfaSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void api<{ enabled: boolean }>("/account/mfa").then((status) => {
      if (active) { setEnabled(status.enabled); setLoaded(true); }
    }).catch((cause) => {
      if (active) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a segurança da conta."); setLoaded(true); }
    });
    return () => { active = false; };
  }, []);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await send<Challenge>("/account/mfa/challenge", "POST", {
        action: enabled ? "disable" : "enable",
        current_password: password,
      });
      setChallenge(result); setPassword(""); setNotice(`Enviamos um código para ${result.email_hint}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível solicitar o código."); }
    finally { setBusy(false); }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || busy) return;
    setBusy(true); setError("");
    try {
      const result = await send<{ enabled: boolean }>("/account/mfa/confirm", "POST", { challenge_id: challenge.challenge_id, code });
      setEnabled(result.enabled); setChallenge(null); setCode(""); setNotice(result.enabled ? "Verificação em duas etapas ativada." : "Verificação em duas etapas desativada.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Código inválido ou expirado."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
    <h2 className="mb-1 text-lg font-bold">Verificação em duas etapas</h2>
    <p className="mb-4 text-sm text-[#626f86]">Proteja sua conta com um código enviado ao e-mail verificado sempre que entrar.</p>
    {!loaded ? <p role="status" className="text-sm text-[#626f86]">Carregando…</p> : challenge ? <form onSubmit={confirm} className="grid gap-3">
      <p className="text-sm text-[#626f86]">Digite o código de seis dígitos enviado para {challenge.email_hint}.</p>
      <label className="grid gap-1 text-sm font-semibold">Código de acesso<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="min-h-11 rounded border border-[#8590a2] px-3 tracking-[.3em]" /></label>
      <div className="flex flex-wrap gap-2"><button disabled={busy || code.length !== 6} className="min-h-10 rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Confirmando…" : "Confirmar"}</button><button type="button" disabled={busy} onClick={() => { setChallenge(null); setCode(""); setNotice(""); }} className="min-h-10 rounded border border-[#dfe1e6] px-4 text-sm">Cancelar</button></div>
    </form> : <form onSubmit={request} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="grid gap-1 text-sm font-semibold">Senha atual<input required type="password" autoComplete="current-password" maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-11 rounded border border-[#8590a2] px-3" /></label>
      <button disabled={busy} className="min-h-11 rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Enviando…" : enabled ? "Desativar" : "Ativar"}</button>
    </form>}
    {notice && <p role="status" className="mt-3 rounded bg-[#dcfff1] px-3 py-2 text-sm text-[#164b35]">{notice}</p>}
    {error && <p role="alert" className="mt-3 rounded bg-[#ffebe6] px-3 py-2 text-sm text-[#ae2a19]">{error}</p>}
    <p className="mt-3 text-xs text-[#626f86]">Status: {loaded ? enabled ? "ativa" : "desativada" : "—"}</p>
  </section>;
}
