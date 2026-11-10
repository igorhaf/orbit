"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, QrCode } from "lucide-react";
import { AuthScreen } from "@/components/auth-screen";
import { api, getToken } from "@/lib/api";

function CheckinContent() {
  const params = useSearchParams();
  const sessionId = params.get("session") || "";
  const token = params.get("token") || "";
  const [authenticated, setAuthenticated] = useState(() => Boolean(getToken()));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ already_checked_in: boolean; status: string; geolocation_verified?: boolean } | null>(null);
  const [error, setError] = useState("");

  async function confirm() {
    if (!sessionId || !token || busy || result) return;
    setBusy(true); setError("");
    try {
      let coordinates: { latitude: number; longitude: number; accuracy_meters: number } | undefined;
      if (token.split(".")[2] === "1") {
        if (!navigator.geolocation || !window.isSecureContext) throw new Error("Este encontro exige localização. Abra o Suindá em uma conexão HTTPS ou no próprio dispositivo e permita o acesso à localização.");
        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve,
          (reason) => reject(new Error(reason.code === 1 ? "Permita o acesso à localização para confirmar presença nesta sala." : "Não foi possível obter uma posição precisa. Tente novamente em um local aberto.")),
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }));
        coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_meters: position.coords.accuracy };
      }
      setResult(await api("/extensions/suinda-learning/me/checkin", {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), session_id: sessionId, token, ...coordinates }),
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível confirmar sua presença."); }
    finally { setBusy(false); }
  }

  if (!sessionId || !token) return <main className="mx-auto max-w-xl p-6"><section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6"><h1 className="text-lg font-semibold text-white">QR Code inválido</h1><p className="mt-2 text-sm text-[#9fadbc]">Peça ao docente para gerar um novo código para este encontro.</p></section></main>;
  if (!authenticated) return <AuthScreen onDone={() => setAuthenticated(Boolean(getToken()))} />;

  return <main className="mx-auto max-w-xl p-6 sm:p-10"><section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-200/10 text-cyan-100"><QrCode size={21} aria-hidden="true" /></div><h1 className="mt-5 text-xl font-semibold text-white">Confirmar presença</h1><p className="mt-2 text-sm leading-6 text-[#9fadbc]">Confirme que você está participando deste encontro. O código tem validade curta.</p>
    {result && <p id="checkin-result" role="status" aria-live="polite" className="mt-6 flex items-center gap-2 rounded-xl border border-emerald-200/15 bg-emerald-200/[0.04] p-4 text-sm text-emerald-100"><CheckCircle2 size={18} aria-hidden="true" />{result.already_checked_in ? "Sua presença já estava registrada." : `Presença confirmada${result.status === "late" ? " com atraso" : ""}${result.geolocation_verified ? " e localização validada" : ""}.`}</p>}
    <button type="button" onClick={() => void confirm()} aria-disabled={busy || Boolean(result)} aria-describedby={busy ? "checkin-progress" : result ? "checkin-result" : undefined} className={`mt-6 min-h-11 w-full rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 ${busy || result ? "cursor-not-allowed opacity-60" : ""}`}>{busy ? "Confirmando…" : result ? "Presença registrada" : "Confirmar presença"}</button>
    {busy && <p id="checkin-progress" role="status" aria-live="polite" className="sr-only">Confirmando sua presença. Aguarde.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
  </section></main>;
}

export default function CheckinPage() {
  return <Suspense fallback={<main className="p-8 text-center text-sm text-[#9fadbc]">Carregando QR Code…</main>}><CheckinContent /></Suspense>;
}
