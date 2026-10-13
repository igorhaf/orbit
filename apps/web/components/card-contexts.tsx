"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, Board, Card, cardUrl, send } from "@/lib/api";

type Reference = { id: string; title: string; url_token: string };
type Contexts = { selected: Reference[]; candidates: Reference[]; children?:Reference[];inherited?:Reference[] };

export function CardContexts({ card, board, onChanged }: { card: Card; board: Board; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Contexts | null>(null);
  const [rows, setRows] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchIndex, setSearchIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const path = `/cards/${card.id}/contexts`;

  useEffect(() => {
    let active = true;
    void api<Contexts>(path).then(value => {
      if (active) { setData(value); setRows(value.selected.map(item => item.id)); }
    }).catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [path, board]);

  async function save(next: string[]) {
    setBusy(true);
    setError("");
    try {
      const value = await send<Contexts>(path, "PATCH", { ids: next.filter(Boolean) });
      setData(value);
      setRows(next);
      await onChanged();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <section aria-label="Contextos" className="space-y-3">
    <h3 className="flex items-center gap-2 text-sm font-bold"><Link2 size={17} /> Contextos</h3>
    <p className="text-xs text-[#626f86]">Referências associadas e herança da hierarquia. O pai principal é organizado na Gestão estruturada.</p>
    {error && <p role="alert" className="text-sm text-[#ae2a19]">{error}</p>}
    {!data && !error && <p className="text-xs text-[#626f86]">Carregando contextos...</p>}
    {data && <>
      {Boolean(data.inherited?.length)&&<section aria-label="Contextos herdados" className="space-y-2 rounded-lg border border-[#dfe1e6] p-3"><h4 className="text-sm font-semibold">Contextos herdados ({data.inherited!.length})</h4><p className="text-xs text-[#626f86]">Recebidos automaticamente do pai principal e de seus ancestrais. Mover o cartão atualiza esta herança.</p>{data.inherited!.map(item=><Link key={item.id} href={cardUrl(board.id,item.id,item.url_token)} scroll={false} prefetch={false} className="flex min-h-11 items-center break-words text-sm text-[#0c66e4]">{item.title}</Link>)}</section>}

      <section aria-label="Contextos associados" className="space-y-2 rounded-lg border border-[#dfe1e6] p-3">
      <h4 className="text-sm font-semibold">Contextos associados ({rows.filter(Boolean).length})</h4>
      <p className="text-xs text-[#626f86]">Cartões que fornecem contexto para este cartão.</p>
      {rows.map((id, index) => {
        const reference = data.candidates.find(item => item.id === id);
        const options = data.candidates.filter(item => (item.id === id || !rows.includes(item.id)) && item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        return <div key={index} className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            {reference&&searchIndex!==index?<Link href={cardUrl(board.id,reference.id,reference.url_token)} scroll={false} prefetch={false} aria-label={`Abrir contexto associado ${reference.title}`} className="flex min-h-11 min-w-0 items-center gap-2 rounded border border-[#dfe1e6] px-3 py-2 text-sm text-[#0c66e4] hover:bg-[#e9f2ff]"><Link2 size={14} className="shrink-0"/><span className="min-w-0 break-words">{reference.title}</span></Link>:
            <input aria-label={`Buscar cartão de contexto ${index + 1}`} role="combobox" aria-expanded={searchIndex === index} aria-controls={`context-options-${index}`} aria-autocomplete="list" placeholder="Buscar cartão..." value={searchIndex === index ? query : reference?.title || ""} disabled={busy} onFocus={() => { setSearchIndex(index); setQuery(""); }} onChange={event => { setSearchIndex(index); setQuery(event.target.value); }} onKeyDown={event => {
              if (event.key === "Escape") { setSearchIndex(null); setQuery(""); }
              if (event.key === "Enter" && searchIndex === index && options[0]) { event.preventDefault(); const next = [...rows]; next[index] = options[0].id; setSearchIndex(null); setQuery(""); void save(next); }
            }} className="min-h-11 w-full rounded border border-[#8590a2] bg-white p-2 text-sm" />}
            {searchIndex === index && <div id={`context-options-${index}`} role="listbox" className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded border border-[#dfe1e6] bg-white py-1 shadow-lg">
              {options.length ? options.map(item => <button key={item.id} type="button" role="option" aria-selected={id === item.id} onMouseDown={event => event.preventDefault()} onClick={() => { const next = [...rows]; next[index] = item.id; setSearchIndex(null); setQuery(""); void save(next); }} className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]">{item.title}</button>) : <p className="px-3 py-2 text-xs text-[#626f86]">Nenhum cartão encontrado.</p>}
            </div>}
          </div>
          {reference && <button type="button" disabled={busy} onClick={()=>{setSearchIndex(index);setQuery("")}} aria-label={`Alterar contexto associado ${reference.title}`} className="flex min-h-11 min-w-11 items-center justify-center rounded text-[#44546f] hover:bg-[#f1f2f4]"><Pencil size={16} /></button>}
          <button type="button" disabled={busy} aria-label={`Remover contexto ${index + 1}`} onClick={() => void save(rows.filter((_, row) => row !== index))} className="flex min-h-11 min-w-11 items-center justify-center text-[#ae2a19]"><Trash2 size={16} /></button>
        </div>;
      })}
      {!rows.length && <p className="text-xs text-[#626f86]">Nenhum contexto associado vinculado.</p>}
      <button type="button" disabled={busy || rows.length >= 50 || rows.includes("") || rows.length >= data.candidates.length} onClick={() => { const index = rows.length; setRows([...rows, ""]); setSearchIndex(index); setQuery(""); }} className="inline-flex min-h-11 items-center gap-1 text-sm text-[#0c66e4] disabled:opacity-50"><Plus size={16} /> Adicionar contexto</button>
      </section>
      <section aria-label="Contextos filhos" className="space-y-2 rounded-lg border border-[#dfe1e6] p-3"><h4 className="text-sm font-semibold">Contextos filhos ({data.children?.length||0})</h4><p className="text-xs text-[#626f86]">Cartões que usam este cartão como contexto.</p><div className="space-y-1">{(data.children||[]).map(child=><Link key={child.id} href={cardUrl(board.id,child.id,child.url_token)} scroll={false} prefetch={false} aria-label={`Abrir contexto filho ${child.title}`} className="flex min-h-11 min-w-0 items-center gap-2 rounded border border-[#dfe1e6] px-3 py-2 text-sm text-[#0c66e4] hover:bg-[#e9f2ff]"><Link2 size={14} className="shrink-0"/><span className="min-w-0 break-words">{child.title}</span></Link>)}</div>{!data.children?.length&&<p className="text-xs text-[#626f86]">Nenhum contexto filho vinculado.</p>}</section>
    </>}
  </section>;
}
