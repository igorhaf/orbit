"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { send, setSession, type User } from "@/lib/api";
import { BrandName } from "@/components/branding";

export default function SocialLoginCallbackPage() {
  const router = useRouter();
  const isSuinda = process.env.NEXT_PUBLIC_ORBIT_PRODUCT === "suinda";
  const [challenge, setChallenge] = useState("");
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
      const token = params.get("token");
      const rawUser = params.get("user");
      if (token && rawUser) {
        try {
          const user = JSON.parse(rawUser) as User;
          if (!user.id || !user.email) throw new Error("invalid user");
          setSession(token, user); router.replace("/"); return;
        } catch { setError("Não foi possível concluir o login social. Tente novamente."); setLoading(false); return; }
      }
      const mfaChallenge = params.get("challenge_id");
      const mfaEmail = params.get("email");
      if (params.get("mfa_required") === "true" && mfaChallenge && mfaEmail) {
        setChallenge(mfaChallenge); setEmail(mfaEmail); setEmailHint(params.get("email_hint") || mfaEmail); setLoading(false); return;
      }
      setError(params.get("error") ? "O login social não foi concluído. Confira a conta e tente novamente." : "Resposta de autenticação inválida.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await send<{ user?: User; token?: string; mfa_required?: boolean }>("/auth/login", "POST", { email, mfa_challenge_id: challenge, mfa_code: code });
      if (!result.token || !result.user) throw new Error("A confirmação não retornou uma sessão.");
      setSession(result.token, result.user); router.replace("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Código inválido ou expirado."); }
    finally { setBusy(false); }
  }

  return <main className={`flex min-h-screen items-center justify-center px-4 py-10 ${isSuinda ? "bg-[#080b12] text-white" : "bg-[#f8f9fb] text-[#172b4d]"}`}>
    <section className={`w-full max-w-md rounded-2xl p-7 shadow-xl ${isSuinda ? "border border-white/10 bg-[#101621] shadow-black/30" : "border border-[#dfe1e6] bg-white"}`}>
      <p className={`text-center text-2xl font-bold ${isSuinda ? "text-white" : "text-[#172b4d]"}`}><BrandName /></p>
      {loading ? <p role="status" className="mt-6 text-center text-sm opacity-70">Validando sua conta…</p> : challenge ? <>
        <div className="mt-6 flex items-center justify-center gap-2"><ShieldCheck size={18} /><h1 className="text-lg font-semibold">Confirmação em duas etapas</h1></div>
        <p className="mt-2 text-center text-sm opacity-70">Enviamos um código para {emailHint}. Ele é necessário para concluir o login social.</p>
        <form onSubmit={confirmMfa} className="mt-5 grid gap-4"><label className="grid gap-1 text-sm">Código de seis dígitos<input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className={`min-h-11 rounded-lg border px-3 text-sm tracking-[.3em] outline-none ${isSuinda ? "border-white/15 bg-[#090e18] text-white focus:border-cyan-200/50" : "border-[#8590a2] focus:border-[#0c66e4]"}`} /></label><button disabled={busy || code.length !== 6} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${isSuinda ? "bg-cyan-200 text-slate-950" : "bg-[#0c66e4] text-white"}`}>{busy ? "Validando…" : "Confirmar e entrar"}<ArrowRight size={15} /></button></form>
      </> : <><p role={error ? "alert" : "status"} className="mt-5 rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-700">{error}</p><Link href="/" className={`mt-4 inline-flex min-h-10 items-center text-sm font-semibold underline ${isSuinda ? "text-cyan-200" : "text-[#0c66e4]"}`}>Voltar ao login</Link></>}
      {error && challenge && <p role="alert" className="mt-4 rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-700">{error}</p>}
    </section>
  </main>;
}
