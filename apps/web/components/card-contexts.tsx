"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Link2, Plus, Trash2 } from "lucide-react";
import { api, Board, Card, cardUrl, send } from "@/lib/api";

type Reference = { id: string; title: string; url_token: string };
type Contexts = { selected: Reference[]; candidates: Reference[] };

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
  }, [path]);

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
    <p className="text-xs text-[#626f86]">Vincule cartões deste quadro para incluir suas descrições como referências nos prompts.</p>
    {error && <p role="alert" className="text-sm text-[#ae2a19]">{error}</p>}
    {!data && !error && <p className="text-xs text-[#626f86]">Carregando contextos...</p>}
    {data && <>
      {rows.map((id, index) => {
        const reference = data.candidates.find(item => item.id === id);
        const options = data.candidates.filter(item => (item.id === id || !rows.includes(item.id)) && item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        return <div key={index} className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input aria-label={`Buscar cartão de contexto ${index + 1}`} role="combobox" aria-expanded={searchIndex === index} aria-controls={`context-options-${index}`} aria-autocomplete="list" placeholder="Buscar cartão..." value={searchIndex === index ? query : reference?.title || ""} disabled={busy} onFocus={() => { setSearchIndex(index); setQuery(""); }} onChange={event => { setSearchIndex(index); setQuery(event.target.value); }} onKeyDown={event => {
              if (event.key === "Escape") { setSearchIndex(null); setQuery(""); }
              if (event.key === "Enter" && searchIndex === index && options[0]) { event.preventDefault(); const next = [...rows]; next[index] = options[0].id; setSearchIndex(null); setQuery(""); void save(next); }
            }} className="w-full rounded border border-[#8590a2] bg-white p-2 text-sm" />
            {searchIndex === index && <div id={`context-options-${index}`} role="listbox" className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded border border-[#dfe1e6] bg-white py-1 shadow-lg">
              {options.length ? options.map(item => <button key={item.id} type="button" role="option" aria-selected={id === item.id} onMouseDown={event => event.preventDefault()} onClick={() => { const next = [...rows]; next[index] = item.id; setSearchIndex(null); setQuery(""); void save(next); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]">{item.title}</button>) : <p className="px-3 py-2 text-xs text-[#626f86]">Nenhum cartão encontrado.</p>}
            </div>}
          </div>
          {reference && <a href={cardUrl(board.id, reference.id, reference.url_token)} target="_blank" rel="noreferrer" aria-label={`Abrir ${reference.title}`} title="Abrir cartão de contexto"><ExternalLink size={16} /></a>}
          <button type="button" disabled={busy} aria-label={`Remover contexto ${index + 1}`} onClick={() => void save(rows.filter((_, row) => row !== index))} className="text-[#ae2a19]"><Trash2 size={16} /></button>
        </div>;
      })}
      {!rows.length && <p className="text-xs text-[#626f86]">Nenhum cartão vinculado.</p>}
      <button type="button" disabled={busy || rows.length >= 50 || rows.includes("") || rows.length >= data.candidates.length} onClick={() => { const index = rows.length; setRows([...rows, ""]); setSearchIndex(index); setQuery(""); }} className="inline-flex items-center gap-1 text-sm text-[#0c66e4] disabled:opacity-50"><Plus size={16} /> Adicionar contexto</button>
    </>}
  </section>;
}
