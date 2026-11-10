"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import SuindaManagement from "@/plugins/suinda/SuindaManagement";
import SuindaStudentDashboard from "./student-dashboard";
import SuindaTeacherDashboard from "./teacher-dashboard";

export default function SuindaPage() {
  const [canManage, setCanManage] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    root.dataset.theme = "dark";
    let active = true;
    void (async () => {
      try {
        const user = JSON.parse(localStorage.getItem("orbit_user") || "null") as { is_root?: unknown } | null;
        const workspaces = user?.is_root === true
          ? [{}]
          : await api<Array<{ id: string }>>("/extensions/suinda-learning/access-profiles/workspaces");
        if (active) setCanManage(workspaces.length > 0);
      } catch {
        if (active) setCanManage(false);
      } finally {
        if (active) setSessionReady(true);
      }
    })();
    return () => {
      active = false;
      if (previousTheme) root.dataset.theme = previousTheme;
      else delete root.dataset.theme;
    };
  }, []);

  return <>
    <SuindaStudentDashboard />
    <SuindaTeacherDashboard />
    {sessionReady && canManage && <section aria-labelledby="academic-management-heading" className="border-t border-[#3b4754] bg-[#1d2125] px-4 py-10 sm:px-8">
      <div id="academic-management" className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3"><h2 id="academic-management-heading" className="mb-0 text-sm font-medium text-cyan-200">Gestão acadêmica</h2><div className="flex flex-wrap gap-2"><Link href="/suinda/integrations/crm" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-cyan-300/50 hover:text-cyan-100">Configurar sincronização CRM</Link><Link href="/suinda/integrations/open-badges" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-cyan-300/50 hover:text-cyan-100">Configurar certificados portáteis</Link><Link href="/suinda/integrations/certificate-signing" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-cyan-300/50 hover:text-cyan-100">Assinar certificados PDF</Link></div></div>
      <Suspense fallback={<div className="mx-auto max-w-7xl p-6 text-sm text-[#b6c2cf]">Carregando gestão acadêmica…</div>}><SuindaManagement /></Suspense>
    </section>}
  </>;
}
