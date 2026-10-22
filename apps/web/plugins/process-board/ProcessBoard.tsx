'use client';
import Link from 'next/link';
import { useState } from 'react';

export type ProcessBoardRecord = { id: string; title: string; status: string; href: string };
export type ProcessBoardStage = { id: string; name: string; description: string; current: boolean; optional?: boolean; records: ProcessBoardRecord[] };
export type ProcessBoardGroup = { id: string; title: string; status: string; reference?: string; revision: number };
type Loaded = { revision: number; stages?: ProcessBoardStage[]; loading?: boolean; error?: string };

export function ProcessBoard({ groups, loadStages, onSelect,selectLabel='Abrir detalhes do processo' }: { selectLabel?:string;groups: ProcessBoardGroup[]; loadStages: (id: string) => Promise<ProcessBoardStage[]>; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const visible = groups.filter(group => (!status || group.status === status) && `${group.title} ${group.reference || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  async function open(group: ProcessBoardGroup, force = false) {
    if (!force && loaded[group.id]?.revision === group.revision && (loaded[group.id].stages || loaded[group.id].loading)) return;
    setLoaded(current => ({ ...current, [group.id]: { revision: group.revision, loading: true } }));
    try {
      const stages = await loadStages(group.id);
      setLoaded(current => current[group.id]?.revision !== group.revision ? current : ({ ...current, [group.id]: { revision: group.revision, stages } }));
    } catch (error) { setLoaded(current => current[group.id]?.revision !== group.revision ? current : ({ ...current, [group.id]: { revision: group.revision, error: (error as Error).message } })); }
  }
  return <section aria-label="Quadro em gestão estruturada" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <label className="min-w-0 flex-1 text-sm font-semibold">Pesquisar grupo<input className="mt-1 min-h-11 w-full rounded border bg-transparent px-3 font-normal" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome ou protocolo" /></label>
      <label className="min-w-0 text-sm font-semibold">Fase atual<select className="mt-1 block min-h-11 max-w-full rounded border bg-transparent px-3 font-normal" value={status} onChange={event => setStatus(event.target.value)}><option value="">Todas as fases</option>{[...new Set(groups.map(group => group.status))].map(value => <option key={value}>{value}</option>)}</select></label>
      <span className="pb-3 text-sm">{visible.length} de {groups.length} grupos</span>
    </div>
    {visible.map(group => <details key={`${group.id}:${group.revision}`} className="min-w-0 rounded-xl border" onToggle={event => { if (event.currentTarget.open) void open(group); }}>
      <summary className="min-h-12 cursor-pointer px-4 py-3"><span className="ml-1 inline-flex max-w-[90%] flex-wrap items-center gap-x-3 gap-y-1 align-middle"><strong className="break-words">{group.title}</strong><span className="rounded-full border px-2 py-1 text-xs">{group.status}</span>{group.reference && <span className="text-sm">{group.reference}</span>}</span></summary>
      <div className="min-w-0 space-y-3 border-t p-3 sm:p-4">
        <button type="button" className="min-h-11 rounded border px-3 text-sm font-semibold" onClick={() => onSelect(group.id)}>{selectLabel}</button>
        {loaded[group.id]?.loading && <p role="status">Carregando fases e registros autorizados…</p>}
        {loaded[group.id]?.error && <div role="alert"><p>{loaded[group.id].error}</p><button className="min-h-11 underline" onClick={() => void open(group, true)}>Tentar novamente</button></div>}
        <ol className="space-y-2">{loaded[group.id]?.stages?.map(stage => <li key={stage.id}>
          <details className={`rounded-lg border ${stage.current ? 'border-current' : ''}`} open={stage.current || undefined}>
            <summary className="min-h-11 cursor-pointer px-3 py-2"><span className="ml-1 font-semibold">{stage.name}</span><span className="ml-2 text-xs">{stage.current ? 'Fase atual · ' : ''}{stage.records.length} registro(s){stage.optional ? ' · quando aplicável' : ''}</span></summary>
            <div className="min-w-0 space-y-2 border-t p-3"><p className="mb-3 text-sm">{stage.description}</p>{stage.records.map(record => <Link key={record.id} href={record.href} className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"><span className="min-w-0 break-words">{record.title}</span><span className="text-xs">{record.status}</span></Link>)}{!stage.records.length && <p className="text-sm">Nenhum registro acessível nesta fase.</p>}</div>
          </details>
        </li>)}</ol>
      </div>
    </details>)}
    {!visible.length && <p className="rounded-xl border border-dashed p-5">Nenhum grupo encontrado para estes filtros.</p>}
  </section>;
}
