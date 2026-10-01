'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, FolderOpen, MoreHorizontal, MoveRight, Plus, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, Board, Card, getToken, List, send, User } from '@/lib/api';
import { AppHeader, Modal, WorkspaceSidebar, useConfirmModal } from '@/components/ui';
import { CardDialog } from '@/components/card-dialog';
import { CardActivityIndicator } from '@/components/card-execution';
import { io } from 'socket.io-client';

const OPEN_CATEGORY_KEY = 'orbit_collections_open_category';

export default function CollectionsPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [collection, setCollection] = useState<Board | null>(null);
  const [openId, setOpenId] = useState('');
  const [title, setTitle] = useState('');
  const [categoryTitle, setCategoryTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Card | null>(null);
  const [error, setError] = useState('');
  const [categoryModal, setCategoryModal] = useState(false);
  const { confirm, confirmationModal } = useConfirmModal();

  const load = useCallback(async () => {
    try {
      const [all, account] = await Promise.all([api<Board[]>('/boards'), api<User>('/auth/me')]);
      const entry = all.find(board => board.is_collection);
      if (!entry) throw new Error('Coleções indisponíveis.');
      const full = await api<Board>(`/boards/${entry.id}`);
      setBoards(all); setUser(account); setCollection(full); setError('');
      setSelected(current => current ? full.lists?.flatMap(list => list.cards).find(card => card.id === current.id) || current : null);
      const stored = sessionStorage.getItem(OPEN_CATEGORY_KEY);
      setOpenId(stored && full.lists?.some(list => list.id === stored) ? stored : '');
    } catch (value) { setError((value as Error).message); }
  }, []);

  useEffect(() => {
    if (!getToken()) { router.push('/'); return; }
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, router]);

  useEffect(() => {
    if (!collection?.id) return;
    const boardId = collection.id;
    const socket = io({ path: '/socket.io', auth: { token: getToken() } });
    socket.on('connect', () => socket.emit('board:join', boardId));
    const refresh = (event?: { boardId?: string }) => { if (!event?.boardId || event.boardId === boardId) void load(); };
    socket.on('board:changed', refresh); socket.on('comment:changed', refresh); socket.on('prompt:progress', refresh);
    return () => { socket.emit('board:leave', boardId); socket.disconnect(); };
  }, [collection?.id, load]);

  const lists = useMemo(() => collection?.lists || [], [collection?.lists]);
  const children = useMemo(() => new Map(lists.map(list => [list.id, lists.filter(child => child.parent_list_id === list.id)])), [lists]);
  const visibleCards = (list: List) => list.cards.filter(card => `${card.title} ${card.description}`.toLowerCase().includes(query.toLowerCase()));

  function toggleCategory(id: string) {
    const next = openId === id ? '' : id;
    setOpenId(next);
    if (next) sessionStorage.setItem(OPEN_CATEGORY_KEY, next); else sessionStorage.removeItem(OPEN_CATEGORY_KEY);
  }

  async function createCard(event: FormEvent) {
    event.preventDefault();
    const list = lists.find(item => item.id === openId) || lists.find(item => !item.parent_list_id) || lists[0];
    if (!title.trim() || !list) return;
    try { await send(`/lists/${list.id}/cards`, 'POST', { title }); setTitle(''); await load(); setOpenId(list.id); }
    catch (value) { setError((value as Error).message); }
  }

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryTitle.trim() || !collection) return;
    try {
      const created = await send<{ id: string }>(`/boards/${collection.id}/lists`, 'POST', { title: categoryTitle, parent_list_id: parentId || null });
      setCategoryTitle(''); setParentId(''); setCategoryModal(false); setOpenId(created.id); sessionStorage.setItem(OPEN_CATEGORY_KEY, created.id); await load();
    } catch (value) { setError((value as Error).message); }
  }

  async function updateCategory(id: string, changes: { parent_list_id?: string | null; position?: number }) {
    try { await send(`/lists/${id}`, 'PATCH', changes); await load(); }
    catch (value) { setError((value as Error).message); }
  }

  function removeCategory(list: List) {
    confirm({ title: 'Remover categoria?', description: `A categoria “${list.title}” e seus cards serão removidos.`, confirmLabel: 'Remover' }, async () => {
      await send(`/lists/${list.id}/archive`, 'POST'); await send(`/lists/${list.id}`, 'DELETE');
      if (openId === list.id) setOpenId(''); await load();
    });
  }

  async function moveCard(card: Card, listId: string) {
    try { await send('/cards/move', 'POST', { card_ids: [card.id], list_id: listId }); await load(); }
    catch (value) { setError((value as Error).message); }
  }

  const renderCategory = (list: List, depth = 0): React.ReactNode => {
    const nested = children.get(list.id) || [];
    const siblings = lists.filter(item => item.parent_list_id === list.parent_list_id);
    const index = siblings.findIndex(item => item.id === list.id);
    return <section key={list.id} className="overflow-hidden rounded-xl border bg-white shadow-sm" style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}>
      <div className="flex items-center gap-2 px-4 py-3 hover:bg-[#f7f8fa]">
        <button onClick={() => toggleCategory(list.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={openId === list.id}>
          <ChevronDown size={18} className={`shrink-0 transition-transform ${openId === list.id ? '' : '-rotate-90'}`} />
          <span className="truncate font-semibold">{list.title}</span><span className="rounded-full bg-[#e9eaed] px-2 py-0.5 text-xs text-[#626f86]">{list.cards.length}</span>
        </button>
        <button aria-label="Adicionar subcategoria" title="Adicionar subcategoria" onClick={() => { setParentId(list.id); setCategoryModal(true); }} className="rounded p-1.5 text-[#626f86] hover:bg-[#e9eaed]"><Plus size={16} /></button>
        <button aria-label="Remover categoria" title="Remover categoria" onClick={() => removeCategory(list)} className="rounded p-1.5 text-[#ae2a19] hover:bg-[#ffebe6]"><Trash2 size={16} /></button>
        <div className="flex items-center" aria-label="Reordenar categoria"><button disabled={index <= 0} onClick={() => void updateCategory(list.id, { position: index - 1 })} className="rounded p-1 text-[#626f86] disabled:opacity-30"><span className="sr-only">Mover para cima</span>↑</button><button disabled={index === siblings.length - 1} onClick={() => void updateCategory(list.id, { position: index + 1 })} className="rounded p-1 text-[#626f86] disabled:opacity-30"><span className="sr-only">Mover para baixo</span>↓</button></div>
        <MoreHorizontal size={16} className="text-[#626f86]" />
      </div>
      {openId === list.id && <div className="border-t bg-[#f7f8fa] p-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleCards(list).map(card => <article key={card.id} className="rounded-lg border bg-white p-3 shadow-sm"><button onClick={() => setSelected(card)} className="w-full text-left"><span className="flex items-center justify-between gap-2"><span className={`min-w-0 truncate font-semibold ${card.completed ? 'line-through text-[#626f86]' : ''}`}>{card.title}</span><CardActivityIndicator card={card} /></span>{card.description && <p className="mt-2 line-clamp-3 text-sm text-[#626f86]">{card.description}</p>}</button><label className="mt-3 flex items-center gap-1 text-xs text-[#626f86]"><MoveRight size={14} /><span className="sr-only">Mover para categoria</span><select aria-label="Mover para categoria" value={list.id} onChange={event => void moveCard(card, event.target.value)} className="min-w-0 flex-1 rounded border px-1.5 py-1 text-xs text-[#44546f]">{lists.map(target => <option key={target.id} value={target.id}>{target.parent_list_id ? '— ' : ''}{target.title}</option>)}</select></label></article>)}</div>{visibleCards(list).length === 0 && <p className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-[#626f86]">Nenhum card nesta categoria.</p>}</div>}
      {nested.map(child => renderCategory(child, depth + 1))}
    </section>;
  };

  const roots = lists.filter(list => !list.parent_list_id);
  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]"><AppHeader user={user} boards={boards} /><div className="flex min-h-0 flex-1"><WorkspaceSidebar boards={boards} onCreate={() => router.push('/boards?create=1')} onChoose={id => router.push(id ? `/board/${id}` : '/boards')} /><main className="min-w-0 flex-1 p-4 sm:p-6"><div className="mx-auto max-w-5xl">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><FolderOpen className="text-[#6554c0]" /> Coleções</h1><p className="mt-1 text-sm text-[#626f86]">Uma árvore de categorias para guardar prompts de uso comum.</p></div><button onClick={() => { setParentId(''); setCategoryModal(true); }} className="rounded bg-[#6554c0] px-3 py-2 text-sm font-semibold text-white"><Plus size={16} className="mr-1 inline" />Nova categoria</button></div>
    <form onSubmit={createCard} className="flex gap-2 rounded-xl border bg-white p-3 shadow-sm"><input value={title} onChange={event => setTitle(event.target.value)} placeholder="Adicionar um card prático..." className="min-w-0 flex-1 px-2 text-sm outline-none" /><button disabled={!title.trim() || !lists.length} className="rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white"><Plus size={16} className="mr-1 inline" />Adicionar</button></form>
    <div className="mt-4 flex items-center gap-2 rounded-lg border bg-white px-3 py-2 shadow-sm"><Search size={16} className="text-[#626f86]" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filtrar cards" className="w-full text-sm outline-none" /></div>
    {error && <p role="alert" className="mt-3 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
    <div className="mt-4 space-y-3">{roots.map(list => renderCategory(list))}</div>{!lists.length && <div className="mt-4 rounded-xl border border-dashed bg-white p-10 text-center text-sm text-[#626f86]">Crie uma categoria para começar sua coleção.</div>}
  </div></main></div>{selected && collection && <CardDialog card={selected} board={collection} onClose={() => setSelected(null)} onChanged={async () => { await load(); setSelected(null); }} onDeleted={async () => { setSelected(null); await load(); }} />}{categoryModal && <Modal onClose={() => setCategoryModal(false)}><form onSubmit={createCategory} className="p-6"><h2 className="pr-8 text-lg font-bold">Nova categoria</h2><p className="mt-1 text-sm text-[#626f86]">Crie uma categoria principal ou uma subcategoria.</p><input autoFocus value={categoryTitle} onChange={event => setCategoryTitle(event.target.value)} placeholder="Ex.: Operação" className="mt-4 w-full rounded border px-3 py-2 text-sm" /><label className="mt-3 block text-sm font-semibold">Categoria pai<select value={parentId} onChange={event => setParentId(event.target.value)} className="mt-1 w-full rounded border px-3 py-2 text-sm"><option value="">Nenhuma (raiz)</option>{lists.filter(list => list.id !== openId).map(list => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label><button disabled={!categoryTitle.trim()} className="mt-4 w-full rounded bg-[#6554c0] px-4 py-2 text-sm font-semibold text-white">Criar categoria</button></form></Modal>}{confirmationModal}</div>;
}
