"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, Board, Card, cardUrl, send } from "@/lib/api";

type Reference = { id: string; title: string; url_token: string };
type Contexts = { selected: Reference[]; candidates: Reference[]; children?: Reference[]; inherited?: Reference[] };

const optionId = (row: number, id: string) => `context-option-${row}-${encodeURIComponent(id)}`;

export function CardContexts({ card, board, onChanged }: { card: Card; board: Board; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Contexts | null>(null);
  const [rows, setRows] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchIndex, setSearchIndex] = useState<number | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedLinkRefs = useRef(new Map<number, HTMLAnchorElement>());
  const path = `/cards/${card.id}/contexts`;

  useEffect(() => {
    let active = true;
    void api<Contexts>(path).then(value => {
      if (active) { setData(value); setRows(value.selected.map(item => item.id)); }
    }).catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [path, board]);

  useEffect(() => {
    if (searchIndex === null || !data) return;
    const selectedId = rows[searchIndex];
    const options = data.candidates.filter(item => (item.id === selectedId || !rows.includes(item.id))
      && item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const activeOption = options[activeOptionIndex];
    if (activeOption) document.getElementById(optionId(searchIndex, activeOption.id))?.scrollIntoView({ block: "nearest" });
  }, [activeOptionIndex, data, query, rows, searchIndex]);

  useEffect(() => {
    if (searchIndex !== null) searchInputRef.current?.focus();
  }, [searchIndex]);

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

  function closeSearch() {
    setSearchIndex(null);
    setActiveOptionIndex(-1);
    setQuery("");
  }

  async function selectOption(row: number, id: string) {
    const next = [...rows];
    next[row] = id;
    closeSearch();
    await save(next);
    requestAnimationFrame(() => selectedLinkRefs.current.get(row)?.focus());
  }

  return <section aria-label="Contextos" className="space-y-3 text-[#172b4d] dark:text-[#e6edf3]">
    <h3 className="flex items-center gap-2 text-sm font-bold"><Link2 size={17} /> Contextos</h3>
    <p className="text-xs text-[#626f86] dark:text-[#aab8c5]">Referências associadas e herança da hierarquia. O pai principal é organizado na Gestão estruturada.</p>
    {error && <p role="alert" className="text-sm text-[#ae2a19] dark:text-[#ff9f8f]">{error}</p>}
    {!data && !error && <p className="text-xs text-[#626f86] dark:text-[#aab8c5]">Carregando contextos...</p>}
    {data && <>
      {Boolean(data.inherited?.length) && <section aria-label="Contextos herdados" className="space-y-2 rounded-lg border border-[#dfe1e6] p-3 dark:border-[#3b4754]">
        <h4 className="text-sm font-semibold">Contextos herdados ({data.inherited!.length})</h4>
        <p className="text-xs text-[#626f86] dark:text-[#aab8c5]">Recebidos automaticamente do pai principal e de seus ancestrais. Mover o cartão atualiza esta herança.</p>
        {data.inherited!.map(item => <Link key={item.id} href={cardUrl(board.id, item.id, item.url_token)} scroll={false} prefetch={false}
          className="flex min-h-11 items-center break-words text-sm text-[#0c66e4] dark:text-[#8bb8ff]">{item.title}</Link>)}
      </section>}

      <section aria-label="Contextos associados" className="space-y-2 rounded-lg border border-[#dfe1e6] p-3 dark:border-[#3b4754]">
        <h4 className="text-sm font-semibold">Contextos associados ({rows.filter(Boolean).length})</h4>
        <p className="text-xs text-[#626f86] dark:text-[#aab8c5]">Cartões que fornecem contexto para este cartão.</p>
        {rows.map((id, index) => {
          const reference = data.candidates.find(item => item.id === id);
          const options = data.candidates.filter(item => (item.id === id || !rows.includes(item.id))
            && item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
          const expanded = searchIndex === index;
          const activeOption = expanded ? options[activeOptionIndex] : undefined;
          return <div key={index} className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              {reference && !expanded
                ? <Link ref={element => { if (element) selectedLinkRefs.current.set(index, element); else selectedLinkRefs.current.delete(index); }}
                  href={cardUrl(board.id, reference.id, reference.url_token)} scroll={false} prefetch={false}
                  aria-label={`Abrir contexto associado ${reference.title}`}
                  className="flex min-h-11 min-w-0 items-center gap-2 rounded border border-[#dfe1e6] px-3 py-2 text-sm text-[#0c66e4] hover:bg-[#e9f2ff] dark:border-[#536273] dark:text-[#8bb8ff] dark:hover:bg-[#263445]">
                  <Link2 size={14} className="shrink-0" /><span className="min-w-0 break-words">{reference.title}</span>
                </Link>
                : <input ref={element => { if (expanded) searchInputRef.current = element; }}
                  aria-label={`Buscar cartão de contexto ${index + 1}`} role="combobox"
                  aria-expanded={expanded} aria-controls={expanded ? `context-options-${index}` : undefined}
                  aria-activedescendant={activeOption ? optionId(index, activeOption.id) : undefined}
                  aria-autocomplete="list" aria-haspopup="listbox" placeholder="Buscar cartão..."
                  value={expanded ? query : reference?.title || ""} disabled={busy}
                  onFocus={() => { setSearchIndex(index); setActiveOptionIndex(0); setQuery(""); }}
                  onClick={() => { if (!expanded) { setSearchIndex(index); setActiveOptionIndex(0); setQuery(""); } }}
                  onChange={event => { setSearchIndex(index); setActiveOptionIndex(0); setQuery(event.target.value); }}
                  onKeyDown={event => {
                    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch(); return; }
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      if (!options.length) return;
                      event.preventDefault();
                      setActiveOptionIndex(current => event.key === "ArrowDown"
                        ? current < 0 ? 0 : (current + 1) % options.length
                        : current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length);
                      return;
                    }
                    if (event.key === "Enter" && expanded && options.length) {
                      event.preventDefault();
                      const selected = options[activeOptionIndex] || options[0];
                      void selectOption(index, selected.id);
                    }
                  }}
                  className="min-h-11 w-full rounded border border-[#8590a2] bg-white p-2 text-sm text-[#172b4d] dark:border-[#536273] dark:bg-[#121a23] dark:text-[#e6edf3]" />}
              {expanded && <div id={`context-options-${index}`} role="listbox" aria-label={`Opções para contexto ${index + 1}`}
                className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded border border-[#dfe1e6] bg-white py-1 shadow-lg dark:border-[#536273] dark:bg-[#1b2632]">
                {options.length ? options.map((item, optionIndex) => {
                  const active = activeOptionIndex === optionIndex;
                  return <div key={item.id} id={optionId(index, item.id)} role="option" aria-selected={active}
                    onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveOptionIndex(optionIndex)}
                    onClick={() => void selectOption(index, item.id)}
                    className={`flex min-h-11 cursor-pointer items-center px-3 py-2 text-left text-sm ${active
                      ? "bg-[#e9f2ff] text-[#172b4d] dark:bg-[#263f59] dark:text-[#f0f6fc]"
                      : "text-[#172b4d] hover:bg-[#f1f2f4] dark:text-[#e6edf3] dark:hover:bg-[#263445]"}`}>{item.title}</div>;
                }) : <p className="px-3 py-2 text-xs text-[#626f86] dark:text-[#aab8c5]">Nenhum cartão encontrado.</p>}
              </div>}
            </div>
            {reference && <button type="button" disabled={busy} onClick={() => { setSearchIndex(index); setActiveOptionIndex(0); setQuery(""); }}
              aria-label={`Alterar contexto associado ${reference.title}`}
              className="flex min-h-11 min-w-11 items-center justify-center rounded text-[#44546f] hover:bg-[#f1f2f4] dark:text-[#cbd5e1] dark:hover:bg-[#263445]">
              <Pencil size={16} />
            </button>}
            <button type="button" disabled={busy} aria-label={`Remover contexto ${index + 1}`}
              onClick={() => { closeSearch(); void save(rows.filter((_, row) => row !== index)); }}
              className="flex min-h-11 min-w-11 items-center justify-center text-[#ae2a19] dark:text-[#ff9f8f]"><Trash2 size={16} /></button>
          </div>;
        })}
        {!rows.length && <p className="text-xs text-[#626f86] dark:text-[#aab8c5]">Nenhum contexto associado vinculado.</p>}
        <button type="button" disabled={busy || rows.length >= 50 || rows.includes("") || rows.length >= data.candidates.length}
          onClick={() => { const index = rows.length; setRows([...rows, ""]); setSearchIndex(index); setActiveOptionIndex(0); setQuery(""); }}
          className="inline-flex min-h-11 items-center gap-1 text-sm text-[#0c66e4] disabled:opacity-50 dark:text-[#8bb8ff]">
          <Plus size={16} /> Adicionar contexto
        </button>
      </section>
      <section aria-label="Contextos filhos" className="space-y-2 rounded-lg border border-[#dfe1e6] p-3 dark:border-[#3b4754]">
        <h4 className="text-sm font-semibold">Contextos filhos ({data.children?.length || 0})</h4>
        <p className="text-xs text-[#626f86] dark:text-[#aab8c5]">Cartões que usam este cartão como contexto.</p>
        <div className="space-y-1">{(data.children || []).map(child => <Link key={child.id}
          href={cardUrl(board.id, child.id, child.url_token)} scroll={false} prefetch={false}
          aria-label={`Abrir contexto filho ${child.title}`}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded border border-[#dfe1e6] px-3 py-2 text-sm text-[#0c66e4] hover:bg-[#e9f2ff] dark:border-[#536273] dark:text-[#8bb8ff] dark:hover:bg-[#263445]">
          <Link2 size={14} className="shrink-0" /><span className="min-w-0 break-words">{child.title}</span>
        </Link>)}</div>
        {!data.children?.length && <p className="text-xs text-[#626f86] dark:text-[#aab8c5]">Nenhum contexto filho vinculado.</p>}
      </section>
    </>}
  </section>;
}
