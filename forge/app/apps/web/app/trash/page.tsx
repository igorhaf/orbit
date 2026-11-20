'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { api, Board, getToken, send, User } from '@/lib/api';
import { AppHeader, WorkspaceSidebar } from '@/components/ui';

type ArchivedList = { id:string;title:string;card_count:number;board_id:string;board_title:string;archived_at?:string };
type ArchivedCard = { id:string;title:string;archived_at:string;list_id:string;list_title:string;board_id:string;board_title:string };

export default function TrashPage(){
  const router=useRouter();
  const [user,setUser]=useState<User|null>(null);
  const [boards,setBoards]=useState<Board[]>([]);
  const [closed,setClosed]=useState<Board[]>([]);
  const [lists,setLists]=useState<ArchivedList[]>([]);
  const [cards,setCards]=useState<ArchivedCard[]>([]);
  const [boardFilter,setBoardFilter]=useState('');
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    try{
      const [account,activeBoards,closedBoards]=await Promise.all([api<User>('/auth/me'),api<Board[]>('/boards'),api<Board[]>('/boards?status=closed')]);
      const visible=activeBoards.filter(board=>!board.is_inbox);
      setUser(account);setBoards(activeBoards);setClosed(closedBoards.filter(board=>!board.is_inbox));
      const details=await Promise.all(visible.map(async board=>{
        const full=await api<Board>(`/boards/${board.id}`);
        const archivedLists=await api<Array<{id:string;title:string;card_count:number;archived_at?:string}>>(`/boards/${board.id}/lists/archived`);
        const archivedCards=await Promise.all((full.lists||[]).map(async list=>({list,items:await api<Array<{id:string;title:string;archived_at:string}>>(`/lists/${list.id}/cards/archived`)})));
        return {board,archivedLists,archivedCards};
      }));
      setLists(details.flatMap(({board,archivedLists})=>archivedLists.map(list=>({...list,board_id:board.id,board_title:board.title}))));
      setCards(details.flatMap(({board,archivedCards})=>archivedCards.flatMap(({list,items})=>items.map(card=>({...card,list_id:list.id,list_title:list.title,board_id:board.id,board_title:board.title})))));
      setError('');
    }catch(reason){setError((reason as Error).message)}
  },[]);
  useEffect(()=>{if(!getToken()){router.replace('/');return}const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load,router]);
  async function restore(path:string){try{await send(path,'POST');await load()}catch(reason){setError((reason as Error).message)}}
  async function reopen(board:Board){try{await send(`/boards/${board.id}/reopen`,'PATCH');await load()}catch(reason){setError((reason as Error).message)}}
  const availableBoards=Array.from(new Map([...boards,...closed].map(board=>[board.id,board])).values()).sort((a,b)=>a.title.localeCompare(b.title));
  const filteredClosed=closed.filter(board=>!boardFilter||board.id===boardFilter);
  const filteredLists=lists.filter(list=>!boardFilter||list.board_id===boardFilter);
  const filteredCards=cards.filter(card=>!boardFilter||card.board_id===boardFilter);
  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]"><AppHeader user={user} boards={boards}/><div className="flex min-h-0 flex-1"><WorkspaceSidebar boards={boards} onCreate={()=>router.push('/boards?create=1')} onChoose={id=>router.push(id?`/board/${id}`:'/boards')}/><main className="mx-auto w-full max-w-[1100px] flex-1 p-5 sm:p-8"><button onClick={()=>router.push('/')} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#44546f] hover:text-[#0c66e4]"><ArrowLeft size={16}/> Início</button><div className="mb-7 flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#ffebe6] text-[#ae2a19]"><Trash2 size={22}/></span><div><h1 className="text-2xl font-bold">Lixeira</h1><p className="text-sm text-[#626f86]">Restaure quadros, listas e cartões arquivados.</p></div></div>{error&&<p role="alert" className="mb-5 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
      <label className="mb-5 block max-w-sm text-sm font-semibold text-[#172b4d]">Filtrar por quadro<select value={boardFilter} onChange={event=>setBoardFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-[#dfe1e6] bg-white px-3 py-2 font-normal"><option value="">Todos os quadros</option>{availableBoards.map(board=><option key={board.id} value={board.id}>{board.title}</option>)}</select></label>
      <div className="space-y-5">
        <section className="rounded-xl border border-[#dfe1e6] bg-white p-5"><h2 className="mb-3 flex items-center gap-2 font-bold"><Archive size={17}/> Quadros fechados ({filteredClosed.length})</h2>{filteredClosed.length?filteredClosed.map(board=><div key={board.id} className="flex items-center gap-3 border-t border-[#f1f2f4] py-3"><span className="min-w-0 flex-1 truncate text-sm font-semibold">{board.title}</span><button onClick={()=>void reopen(board)} className="inline-flex items-center gap-1 rounded bg-[#e9f2ff] px-2.5 py-1.5 text-xs font-semibold text-[#0c66e4]"><RotateCcw size={14}/> Restaurar</button></div>):<p className="text-sm text-[#626f86]">Nenhum quadro fechado.</p>}</section>
        <section className="rounded-xl border border-[#dfe1e6] bg-white p-5"><h2 className="mb-3 flex items-center gap-2 font-bold"><Archive size={17}/> Listas arquivadas ({filteredLists.length})</h2>{filteredLists.length?filteredLists.map(list=><div key={list.id} className="flex items-center gap-3 border-t border-[#f1f2f4] py-3"><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{list.title}</strong><span className="text-xs text-[#626f86]">{list.board_title} · {list.card_count} cartões</span></span><button onClick={()=>void restore(`/lists/${list.id}/restore`)} className="inline-flex items-center gap-1 rounded bg-[#e9f2ff] px-2.5 py-1.5 text-xs font-semibold text-[#0c66e4]"><RotateCcw size={14}/> Restaurar</button></div>):<p className="text-sm text-[#626f86]">Nenhuma lista arquivada.</p>}</section>
        <section className="rounded-xl border border-[#dfe1e6] bg-white p-5"><h2 className="mb-3 flex items-center gap-2 font-bold"><Archive size={17}/> Cartões arquivados ({filteredCards.length})</h2>{filteredCards.length?filteredCards.map(card=><div key={card.id} className="flex items-center gap-3 border-t border-[#f1f2f4] py-3"><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{card.title}</strong><span className="text-xs text-[#626f86]">{card.board_title} · {card.list_title}</span></span><button onClick={()=>void restore(`/cards/${card.id}/restore`)} className="inline-flex items-center gap-1 rounded bg-[#e9f2ff] px-2.5 py-1.5 text-xs font-semibold text-[#0c66e4]"><RotateCcw size={14}/> Restaurar</button></div>):<p className="text-sm text-[#626f86]">Nenhum cartão arquivado.</p>}</section>
      </div></main></div></div>;
}
