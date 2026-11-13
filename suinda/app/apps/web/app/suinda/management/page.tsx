"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import SuindaManagement from "@/plugins/suinda/SuindaManagement";

export default function SuindaManagementPage() {
  const [canManage, setCanManage] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const workspaces = await api<Array<{ id: string }>>("/extensions/suinda-learning/access-profiles/workspaces");
        if (active) setCanManage(workspaces.length > 0);
      } catch {
        if (active) setCanManage(false);
      } finally {
        if (active) setSessionReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  return <main className="min-h-full bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-8 sm:py-10">
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 border-b border-[#3b4754] pb-5">
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-violet-200">Suindá · gestão acadêmica</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Administre a operação educacional</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#9fadbc]">Cursos, matrículas, currículo e serviços institucionais usam os workspaces e registros versionados do Orbit.</p>
      </header>
      {sessionReady && canManage && <nav aria-label="Integrações acadêmicas" className="mb-6 flex flex-wrap gap-2">
        <Link href="/suinda/integrations/crm" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-violet-300/50 hover:text-violet-100">Sincronização CRM</Link>
        <Link href="/suinda/integrations/open-badges" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-violet-300/50 hover:text-violet-100">Certificados portáteis</Link>
        <Link href="/suinda/integrations/certificate-signing" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-violet-300/50 hover:text-violet-100">Assinatura de certificados</Link>
      </nav>}
      {!sessionReady && <p role="status" className="text-sm text-[#9fadbc]">Verificando acesso à gestão…</p>}
      {sessionReady && !canManage && <p role="alert" className="rounded-xl border border-rose-200/20 bg-rose-200/[0.04] p-4 text-sm text-rose-100">Seu perfil não tem acesso à gestão acadêmica neste workspace.</p>}
      {sessionReady && canManage && <Suspense fallback={<p role="status" className="py-4 text-sm text-[#9fadbc]">Carregando áreas acadêmicas…</p>}><SuindaManagement /></Suspense>}
    </div>
  </main>;
}
