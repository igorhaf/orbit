"use client";

import { useEffect } from "react";

export default function SuindaDriveCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const returnTo = sessionStorage.getItem("suinda.google-drive.return-to");
    sessionStorage.removeItem("suinda.google-drive.return-to");
    sessionStorage.setItem("suinda.google-drive.message", error ? "Não foi possível conectar a conta Google." : "Conta Google conectada.");
    let destination = new URL("/extensions/suinda-learning", window.location.origin);
    if (returnTo) {
      try {
        const candidate = new URL(returnTo, window.location.origin);
        if (candidate.origin === window.location.origin && (candidate.pathname.startsWith("/extensions/suinda-learning") || candidate.pathname.startsWith("/suinda/"))) destination = candidate;
      } catch { /* Keep the default same-origin destination. */ }
    }
    if (error) destination.searchParams.set("drive_error", "Conexão Google Drive indisponível. Tente novamente ou confira as configurações da instituição.");
    else destination.searchParams.set("drive_connected", "1");
    window.location.replace(`${destination.pathname}${destination.search}${destination.hash}`);
  }, []);

  return <main className="grid min-h-screen place-items-center bg-[#1d2125] px-5 text-[#dee4ea]"><p role="status" className="text-sm text-[#b6c2cf]">Conexão concluída. Voltando aos materiais da aula…</p></main>;
}
