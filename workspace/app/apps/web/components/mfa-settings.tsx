"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, send } from "@/lib/api";

export function MfaSettings() {
  const [enabled, setEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { let active = true; void api<{ enabled: boolean }>("/account/mfa").then((result) => { if (active) setEnabled(result.enabled); }).catch((cause) => { if (active) setError((cause as Error).message); }); return () => { active = false; }; }, []);

  async function requestChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await send<{ challenge_id: string; email_hint: string }>("/account/mfa/challenge", "POST", { action: enabled ? "disable" : "enable", current_password: password });
      setChallengeId(result.challenge_id); setEmailHint(result.email_hint); setPassword("");
      setMessage(`Enviamos um código de confirmação para ${result.email_hint}.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await send<{ enabled: boolean }>("/account/mfa/confirm", "POST", { challenge_id: challengeId, code });
      setEnabled(result.enabled); setChallengeId(""); setCode("");
      setMessage(result.enabled ? "A verificação em duas etapas foi ativada." : "A verificação em duas etapas foi desativada.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
    <h2 className="text-lg font-bold">Verificação em duas etapas</h2>
    <p className="mt-1 text-sm text-[#626f86]">{enabled ? "No login, será solicitado um código de uso único enviado ao e-mail verificado da conta." : "Adicione uma confirmação por e-mail depois da senha. É necessário confirmar seu endereço de e-mail."}</p>
    {message && <p role="status" className="mt-3 text-sm text-[#216e4e]">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-[#ae2a19]">{error}</p>}
    {challengeId ? <form onSubmit={confirmChange} className="mt-4 grid max-w-lg gap-3">
      <p className="text-sm text-[#626f86]">Código enviado para {emailHint}.</p>
      <label className="text-xs font-bold">Código de seis dígitos<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-1 min-h-10 w-full rounded border border-[#8590a2] px-3 text-sm font-normal tracking-[.3em]" /></label>
      <div className="flex flex-wrap gap-2"><button disabled={busy || code.length !== 6} className="min-h-10 rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Validando…" : "Confirmar código"}</button><button type="button" disabled={busy} onClick={() => { setChallengeId(""); setCode(""); setMessage(""); }} className="min-h-10 rounded border border-[#dfe1e6] px-4 text-sm">Cancelar</button></div>
    </form> : <form onSubmit={requestChange} className="mt-4 grid max-w-lg gap-3">
      <label className="text-xs font-bold">Senha atual<input required type="password" maxLength={200} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 min-h-10 w-full rounded border border-[#8590a2] px-3 text-sm font-normal" /></label>
      <button disabled={busy || !password} className="min-h-10 justify-self-start rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Enviando…" : enabled ? "Desativar verificação em duas etapas" : "Ativar verificação em duas etapas"}</button>
    </form>}
  </section>;
}
