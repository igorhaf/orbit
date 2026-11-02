"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LayoutDashboard, ShieldCheck } from "lucide-react";
import { send, setSession, type User } from "@/lib/api";

export default function SocialLoginCallbackPage() {
  const router = useRouter();
  const [challengeId, setChallengeId] = useState("");
  const [email, setEmail] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const params = new URLSearchParams(window.location.hash.slice(1));
      window.history.replaceState(null, "", window.location.pathname);
      const token = params.get("token"), rawUser = params.get("user");
      if (token && rawUser) {
        try { const user = JSON.parse(rawUser) as User; if (!user.id || !user.email) throw new Error("invalid user"); setSession(token, user); router.replace("/"); return; }
        catch { setError("Não foi possível concluir o login social. Tente novamente."); setLoading(false); return; }
      }
      const challenge = params.get("challenge_id"), address = params.get("email");
      if (params.get("mfa_required") === "true" && challenge && address) { setChallengeId(challenge); setEmail(address); setEmailHint(params.get("email_hint") || address); setLoading(false); return; }
      setError(params.has("error") ? "O login social não foi concluído. Confira a conta e tente novamente." : "Resposta de autenticação inválida."); setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await send<{ user?: User; token?: string }>("/auth/login", "POST", { email, mfa_challenge_id: challengeId, mfa_code: code });
      if (!result.user || !result.token) throw new Error("A confirmação não retornou uma sessão.");
      setSession(result.token, result.user); router.replace("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Código inválido ou expirado."); }
    finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#f8f9fb] px-4 py-10 text-[#172b4d]">
    <section className="w-full max-w-md rounded-2xl border border-[#dfe1e6] bg-white p-7 shadow-xl">
      <p className="flex items-center justify-center gap-2 text-2xl font-bold"><span className="flex h-8 w-8 items-center justify-center rounded bg-[#0c66e4] text-white"><LayoutDashboard size={20}/></span>Orbit</p>
      {loading ? <p role="status" className="mt-6 text-center text-sm text-[#626f86]">Validando sua conta…</p> : challengeId ? <>
        <div className="mt-6 flex items-center justify-center gap-2"><ShieldCheck size={18}/><h1 className="text-lg font-semibold">Confirmação em duas etapas</h1></div>
        <p className="mt-2 text-center text-sm text-[#626f86]">Enviamos um código para {emailHint}. Ele é necessário para concluir o login social.</p>
        <form onSubmit={confirmMfa} className="mt-5 grid gap-4"><label className="grid gap-1 text-sm">Código de seis dígitos<input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="min-h-11 rounded-lg border border-[#8590a2] px-3 text-sm tracking-[.3em] outline-none focus:border-[#0c66e4]"/></label><button disabled={busy || code.length !== 6} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Validando…" : "Confirmar e entrar"}<ArrowRight size={15}/></button></form>
      </> : <><p role="alert" className="mt-5 rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p><Link href="/" className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-[#0c66e4] underline">Voltar ao login</Link></>}
      {error && challengeId && <p role="alert" className="mt-4 rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
    </section>
  </main>;
}
