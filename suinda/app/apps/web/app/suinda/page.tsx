"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import type { ComponentType } from "react";
import { api } from "@/lib/api";

const loadStudentDashboard = () => import("./student-dashboard");
const loadTeacherDashboard = () => import("./teacher-dashboard");
const loadManagement = () => import("@/plugins/suinda/SuindaManagement");

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
    <DeferredPanel load={loadStudentDashboard} label="painel do aluno" eager />
    <DeferredPanel load={loadTeacherDashboard} label="painel docente" />
    {sessionReady && canManage && <section aria-labelledby="academic-management-heading" className="border-t border-[#3b4754] bg-[#1d2125] px-4 py-10 sm:px-8">
      <div id="academic-management" className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3"><h2 id="academic-management-heading" className="mb-0 text-sm font-medium text-cyan-200">Gestão acadêmica</h2><div className="flex flex-wrap gap-2"><Link href="/suinda/integrations/crm" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-cyan-300/50 hover:text-cyan-100">Configurar sincronização CRM</Link><Link href="/suinda/integrations/open-badges" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-cyan-300/50 hover:text-cyan-100">Configurar certificados portáteis</Link><Link href="/suinda/integrations/certificate-signing" className="inline-flex min-h-9 items-center rounded-lg border border-[#46515c] px-3 text-xs font-medium text-[#d4dee7] transition hover:border-cyan-300/50 hover:text-cyan-100">Assinar certificados PDF</Link></div></div>
      <DeferredPanel load={loadManagement} label="gestão acadêmica" />
    </section>}
  </>;
}

function DeferredPanel({ load, label, eager = false }: {
  load: () => Promise<{ default: ComponentType }>;
  label: string;
  eager?: boolean;
}) {
  const [Panel, setPanel] = useState<ComponentType | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container || Panel) return;
    let active = true;
    let requested = false;
    const loadPanel = () => {
      if (requested) return;
      requested = true;
      setNearViewport(true);
      setError(false);
      void load().then((module) => {
        if (active) setPanel(() => module.default);
      }).catch(() => {
        if (active) setError(true);
      });
    };

    if (eager || !("IntersectionObserver" in window)) {
      loadPanel();
      return () => { active = false; };
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadPanel();
      }
    }, { rootMargin: "400px 0px" });
    observer.observe(container);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [attempt, container, eager, load, Panel]);

  return <div ref={setContainer}>
    {Panel ? <Suspense fallback={<p className="mx-auto max-w-7xl px-5 py-3 text-sm text-[#b6c2cf]" role="status">Carregando {label}…</p>}><Panel /></Suspense> : eager
      ? <main className="min-h-full bg-[#1d2125] text-[#dee4ea]" aria-label="Área de aprendizagem" aria-busy={!error}>
          <div className="mx-auto max-w-6xl px-5 py-9 sm:px-8 lg:py-12">
            <h1 className="sr-only">Área de aprendizagem</h1>
            {error
              ? <p className="text-sm text-rose-200" role="alert">Não foi possível carregar {label}. <button type="button" className="underline underline-offset-2" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button></p>
              : <p className="text-sm text-[#b6c2cf]" role="status">Carregando {label}…</p>}
          </div>
        </main>
      : nearViewport ? error
        ? <div className="mx-auto max-w-7xl px-5 py-3 text-sm text-rose-200" role="alert">Não foi possível carregar {label}. <button type="button" className="underline underline-offset-2" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button></div>
        : <p className="mx-auto max-w-7xl px-5 py-3 text-sm text-[#b6c2cf]" role="status">Carregando {label}…</p>
        : <div aria-hidden="true" className="min-h-4" />}
  </div>;
}
