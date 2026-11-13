'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';

export type ProfileSimulationContextData = {
  mode: 'read_only_demo';
  product: string;
  role: { id: string; name: string; permissions: string[] };
  persona: { id: string; name: string; email: string };
  workspace: { id: string; name: string };
  records: Array<{ id: string; title: string; type: string; state: string; description: string; is_demo: boolean }>;
  flows: Array<{ id: string; label: string; available: boolean; permission: string }>;
  message: string;
};

/** A read-only window into the synthetic context for the active simulated role. */
export function ProfileSimulationContextLauncher({ active }: { active: boolean }) {
  const [context, setContext] = useState<ProfileSimulationContextData | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    if (!active) {
      setContext(null);
      setOpen(false);
      setError('');
      return () => { current = false; };
    }
    setOpen(true);
    setContext(null);
    setError('');
    void api<ProfileSimulationContextData>('/access/profile-simulation/context')
      .then(value => { if (current) setContext(value); })
      .catch(reason => { if (current) setError((reason as Error).message || 'Contexto demonstrativo indisponível.'); });
    return () => { current = false; };
  }, [active]);

  if (!active) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Abrir contexto de demonstração" title="Abrir contexto de demonstração" className="flex min-h-10 shrink-0 items-center gap-1 rounded bg-[#e9f2ff] px-1.5 text-[11px] font-semibold text-[#0c66e4] hover:bg-[#dbeafe] sm:px-2 sm:text-xs">
      <span aria-hidden="true">◉</span><span>Demo</span>
    </button>
    {open && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-2 sm:items-center sm:p-5" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="profile-demo-title" className="max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#dfe1e6] bg-white text-[#172b4d] shadow-2xl">
        <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-[#dfe1e6] bg-white p-4 sm:p-6">
          <div><p className="text-xs font-bold uppercase tracking-wide text-[#6554c0]">{context?.product || 'Orbit'} · somente leitura</p><h2 id="profile-demo-title" className="mt-1 text-xl font-bold">Contexto do perfil simulado</h2><p className="mt-1 text-sm text-[#626f86]">Dados fictícios isolados para validar a experiência deste papel.</p></div>
          <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Fechar contexto demonstrativo" className="rounded p-2 hover:bg-[#f1f2f4]"><X size={18}/></button>
        </header>
        {error ? <p role="alert" className="m-5 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p> : !context ? <p role="status" className="p-6 text-sm text-[#626f86]">Carregando contexto demonstrativo…</p> : <div className="space-y-5 p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-[#dfe1e6] p-3"><p className="text-xs font-semibold uppercase text-[#626f86]">Perfil e persona</p><p className="mt-1 font-semibold">{context.role.name}</p><p className="text-sm">{context.persona.name}</p><p className="text-xs text-[#626f86]">{context.persona.email}</p></div><div className="rounded-lg border border-[#dfe1e6] p-3"><p className="text-xs font-semibold uppercase text-[#626f86]">Workspace fictício</p><p className="mt-1 font-semibold">{context.workspace.name}</p><p className="text-xs text-[#626f86]">Identificador de demonstração: {context.workspace.id}</p></div></div>
          <section><h3 className="mb-2 font-semibold">Fluxos deste perfil</h3>{context.flows.length ? <ul className="grid gap-2 sm:grid-cols-2">{context.flows.map(flow => <li key={flow.id} className={`rounded-lg border p-3 ${flow.available ? 'border-[#b3dfc8] bg-[#f3fbf6]' : 'border-[#dfe1e6] bg-[#f7f8fa]'}`}><p className="font-medium">{flow.label}</p><p className="mt-1 text-xs text-[#626f86]">{flow.available ? 'Disponível para este perfil' : 'Fora das permissões deste perfil'}</p></li>)}</ul> : <p className="rounded border border-dashed p-3 text-sm text-[#626f86]">Nenhum fluxo de domínio foi configurado para este perfil.</p>}</section>
          <section><h3 className="mb-2 font-semibold">Exemplos fictícios</h3>{context.records.length ? <ul className="space-y-2">{context.records.map(record => <li key={record.id} className="rounded-lg border border-[#dfe1e6] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{record.title}</p><span className="rounded bg-[#f1f2f4] px-2 py-1 text-xs text-[#44546f]">{record.state}</span></div><p className="mt-1 text-sm text-[#626f86]">{record.description}</p></li>)}</ul> : <p className="rounded border border-dashed p-3 text-sm text-[#626f86]">Este perfil não tem exemplos de domínio cadastrados.</p>}</section>
          <p className="rounded-lg bg-[#e9f2ff] p-3 text-sm text-[#44546f]">{context.message}</p>
        </div>}
      </section>
    </div>}
  </>;
}
