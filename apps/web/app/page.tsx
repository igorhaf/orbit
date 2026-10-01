'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArrowRight, Clock3, DatabaseBackup, FileArchive, LayoutDashboard, LoaderCircle, Plus, Search, Star } from 'lucide-react';
import { api, send, Board, HomeData, SearchResults, User, clearSession, getToken, getUser, setUser, cardUrl } from '@/lib/api';
import { AppHeader, BoardTile, CreateBoardModal, WorkspaceSidebar } from '@/components/ui';
import { AuthScreen } from '@/components/auth-screen';
import { useHydrated } from '@/lib/use-hydrated';
import { remember } from '@/lib/history';

type BackupSummary={archive:string;created_at?:string;archive_bytes?:number;reason?:string};
type ArchivedBoard=Board;
type ArchivedList={id:string;title:string;card_count:number;board_id:string;board_title:string;archived_at?:string};
type ArchivedCard={id:string;title:string;archived_at:string;list_id:string;list_title:string;board_id:string;board_title:string};
type BoardSection='favorites'|'recent';
const blank: HomeData = { upNext:[], highlights:[], yourItems:[], recentBoards:[], favorites:[], recentConversations:[] };
const blankSearch:SearchResults={boards:[],cards:[]};

export default function Home() {
  const router=useRouter();
  const [user,setCurrentUser]=useState<User|null>(null);
  const ready=useHydrated();
  const [boards,setBoards]=useState<Board[]>([]);
  const [data,setData]=useState<HomeData>(blank);
  const [backups,setBackups]=useState<BackupSummary[]>([]);
  const [archivedBoards,setArchivedBoards]=useState<ArchivedBoard[]>([]);
  const [archivedLists,setArchivedLists]=useState<ArchivedList[]>([]);
  const [archivedCards,setArchivedCards]=useState<ArchivedCard[]>([]);
  const [query,setQuery]=useState('');
  const [searchResults,setSearchResults]=useState<SearchResults>(blankSearch);
  const [searchResultsTerm,setSearchResultsTerm]=useState('');
  const [searchLoading,setSearchLoading]=useState(false);
  const [boardSection,setBoardSection]=useState<BoardSection>('favorites');
  const [create,setCreate]=useState(false);
  const [backupBusy,setBackupBusy]=useState(false);
  const [error,setError]=useState('');
  const load = useCallback(async () => {
    try {
      const [home,all,backupRows,closed]=await Promise.all([
        api<HomeData>('/home'),
        api<Board[]>('/boards'),
        api<BackupSummary[]>('/backups').catch(()=>[]),
        api<Board[]>('/boards?status=closed').catch(()=>[]),
      ]);
      const active=all.filter(board=>!board.is_inbox&&!board.is_collection);
      const archiveDetails=await Promise.all(active.map(async board=>{
        const full=await api<Board>(`/boards/${board.id}`);
        const lists=await api<Array<{id:string;title:string;card_count:number;archived_at?:string}>>(`/boards/${board.id}/lists/archived`);
        const cards=await Promise.all((full.lists||[]).map(async list=>({list,cards:await api<Array<{id:string;title:string;archived_at:string}>>(`/lists/${list.id}/cards/archived`)})));
        return {board,lists,cards};
      }));
      setData(home);setBoards(all);setBackups(backupRows);setArchivedBoards(closed.filter(board=>!board.is_inbox&&!board.is_collection));
      setArchivedLists(archiveDetails.flatMap(({board,lists})=>lists.map(list=>({...list,board_id:board.id,board_title:board.title}))).sort((a,b)=>new Date(b.archived_at||0).getTime()-new Date(a.archived_at||0).getTime()));
      setArchivedCards(archiveDetails.flatMap(({board,cards})=>cards.flatMap(({list,cards:items})=>items.map(card=>({...card,list_id:list.id,list_title:list.title,board_id:board.id,board_title:board.title})))).sort((a,b)=>new Date(b.archived_at).getTime()-new Date(a.archived_at).getTime()));
      setError('');
    } catch (err) { setError((err as Error).message); }
  }, []);
  useEffect(() => {
    const cached=getUser();
    if (getToken() && cached) {
      api<User>('/auth/me').then(account => {setCurrentUser(account);setUser(account);load();}).catch(() => {clearSession();setCurrentUser(null);});
    }
    const onChange=()=>load();
    const onAccount=()=>{if(!getToken())setCurrentUser(null)};
    window.addEventListener('data:changed',onChange);
    window.addEventListener('account:changed',onAccount);
    return()=>{window.removeEventListener('data:changed',onChange);window.removeEventListener('account:changed',onAccount)};
  },[load]);
  useEffect(()=>{
    const term=query.trim();
    if(term.length<2)return;
    let active=true;
    const timer=window.setTimeout(()=>{setSearchLoading(true);api<SearchResults>(`/search?q=${encodeURIComponent(term)}`).then(result=>{if(active){setSearchResults(result);setSearchResultsTerm(term)}}).catch(()=>{if(active){setSearchResults(blankSearch);setSearchResultsTerm(term)}}).finally(()=>{if(active)setSearchLoading(false)});},220);
    return()=>{active=false;window.clearTimeout(timer)};
  },[query]);
  async function createBoard(title:string,background:string,workspaceId?:string) {
    const board=await send<Board>('/boards','POST',{title,background,workspace_id:workspaceId});
    remember({label:'criar quadro',undo:[{path:`/boards/${board.id}/close`,method:'PATCH'}],redo:[{path:`/boards/${board.id}/reopen`,method:'PATCH'}]});
    router.push(`/board/${board.id}`);
  }
  async function createBackup(){setBackupBusy(true);setError('');try{await send<BackupSummary>('/backups','POST');const rows=await api<BackupSummary[]>('/backups');setBackups(rows)}catch(err){setError((err as Error).message)}finally{setBackupBusy(false)}}
  if (!ready) return <div className="min-h-screen bg-[#f7f8fa]"/>;
  if (!user) return <AuthScreen onDone={account => {setCurrentUser(account);load();}}/>;
  const visibleBoards=boards.filter(board=>!board.is_inbox);
  const activeBoards=boardSection==='favorites'?data.favorites:data.recentBoards;
  const boardTiles=activeBoards.length?activeBoards:visibleBoards.slice(0,8);
  const totalCards=visibleBoards.reduce((sum,board)=>sum+(board.card_count||0),0);
  const completedCards=visibleBoards.reduce((sum,board)=>sum+(board.completed_card_count||0),0);
  const openCards=Math.max(0,totalCards-completedCards);
  const boardStats=(board:Board)=>({...board,...visibleBoards.find(item=>item.id===board.id)});
  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]"><AppHeader user={user} boards={boards} onCreate={()=>setCreate(true)}/><div className="flex min-h-0 flex-1"><WorkspaceSidebar boards={boards} onCreate={()=>setCreate(true)} onChoose={id=>router.push(id?`/board/${id}`:'/boards')}/><main className="mx-auto w-full max-w-[1400px] px-4 py-7 sm:px-7 lg:px-9">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-[.12em] text-[#626f86]">PAINEL DE CONTROLE</p><h1 className="text-[27px] font-bold tracking-tight sm:text-[31px]">Visão geral</h1><p className="mt-1 text-sm text-[#626f86]">Acompanhe seus quadros e recursos em um só lugar.</p></div><button onClick={()=>setCreate(true)} className="flex items-center gap-2 rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0055cc]"><Plus size={16}/> Criar quadro</button></div>
    {error&&<p role="alert" className="mb-5 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}

    <section aria-label="Busca global" className="mb-6 rounded-xl border border-[#dfe1e6] bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e9f2ff] text-[#0c66e4]"><Search size={20}/></span><div><h2 className="font-bold">Busca global</h2><p className="text-xs text-[#626f86]">Pesquise cartões e quadros sem sair do painel.</p></div></div><div className="relative mt-4"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#626f86]"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar cartões e quadros" className="w-full rounded-lg border border-[#8590a2] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#0c66e4]"/></div>{query.trim().length>=2&&<div className="mt-3">{searchLoading||searchResultsTerm!==query.trim()?<p className="py-3 text-sm text-[#626f86]">Pesquisando…</p>:searchResults.boards.length+searchResults.cards.length===0?<p className="py-3 text-sm text-[#626f86]">Nenhum resultado para “{query}”.</p>:<div className="grid gap-2 md:grid-cols-2">{searchResults.boards.slice(0,3).map(board=><button key={`b:${board.id}`} onClick={()=>router.push(`/board/${board.id}`)} className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] p-3 text-left hover:bg-[#f1f2f4]"><span className="h-8 w-2 shrink-0 rounded" style={{background:board.background}}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{board.title}</strong><span className="text-xs text-[#626f86]">Quadro</span></span><ArrowRight size={15}/></button>)}{searchResults.cards.slice(0,5).map(card=><button key={`c:${card.id}`} onClick={()=>router.push(cardUrl(card.board_id,card.id,card.url_token))} className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] p-3 text-left hover:bg-[#f1f2f4]"><span className="h-8 w-2 shrink-0 rounded" style={{background:card.background}}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{card.title}</strong><span className="block truncate text-xs text-[#626f86]">{card.board_title} · {card.list_title}</span></span><ArrowRight size={15}/></button>)}</div>}</div>}</section>

    <div className="grid gap-5 xl:grid-cols-2">
      <section aria-label="Backups recentes" className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-[#f1f2f4] px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#eeedfd] text-[#403294]"><DatabaseBackup size={18}/></span><div className="min-w-0 flex-1"><h2 className="font-bold">Backups</h2><p className="text-xs text-[#626f86]">{backups.length} cópias salvas</p></div><button disabled={backupBusy} onClick={()=>void createBackup()} className="inline-flex items-center gap-1 rounded bg-[#403294] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{backupBusy?<LoaderCircle size={14} className="animate-spin"/>:<Plus size={14}/>} Criar</button></div>
        <div className="divide-y divide-[#f1f2f4]">{backups.slice(0,5).map(backup=><div key={backup.archive} className="flex items-center gap-3 px-5 py-3"><DatabaseBackup size={15} className="shrink-0 text-[#626f86]"/><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{backup.archive}</strong><span className="text-xs text-[#626f86]">{backup.created_at?new Date(backup.created_at).toLocaleString('pt-BR'):'Data indisponível'}{backup.archive_bytes?` · ${(backup.archive_bytes/1024/1024).toFixed(1)} MB`:''}</span></div></div>)}{backups.length===0&&<p className="px-5 py-6 text-sm text-[#626f86]">Ainda não há backups. Crie o primeiro por aqui.</p>}</div>
        <div className="border-t border-[#f1f2f4] px-5 py-3"><button onClick={()=>router.push('/backups')} className="text-xs font-semibold text-[#0c66e4] hover:underline">Gerenciar todos os backups <ArrowRight size={13} className="ml-1 inline"/></button></div>
      </section>

      <section aria-label="Cartões arquivados recentes" className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-[#f1f2f4] px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#fff1b8] text-[#7f5f01]"><Archive size={18}/></span><div><h2 className="font-bold">Cartões arquivados</h2><p className="text-xs text-[#626f86]">{archivedCards.length} cartões na lixeira</p></div></div>
        <div className="divide-y divide-[#f1f2f4]">{archivedCards.slice(0,5).map(card=><div key={card.id} className="flex items-center gap-3 px-5 py-3"><Archive size={15} className="shrink-0 text-[#626f86]"/><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{card.title}</strong><span className="block truncate text-xs text-[#626f86]">{card.board_title} · {card.list_title}</span></div><span className="shrink-0 text-[11px] text-[#626f86]">{new Date(card.archived_at).toLocaleDateString('pt-BR')}</span></div>)}{archivedCards.length===0&&<p className="px-5 py-6 text-sm text-[#626f86]">Nenhum cartão arquivado.</p>}</div>
        <div className="border-t border-[#f1f2f4] px-5 py-3"><button onClick={()=>router.push('/trash')} className="text-xs font-semibold text-[#0c66e4] hover:underline">Gerenciar todos os cartões <ArrowRight size={13} className="ml-1 inline"/></button></div>
      </section>
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <section aria-label="Quadros arquivados recentes" className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-[#f1f2f4] px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#e9f2ff] text-[#0c66e4]"><LayoutDashboard size={18}/></span><div><h2 className="font-bold">Quadros arquivados</h2><p className="text-xs text-[#626f86]">{archivedBoards.length} quadros fechados</p></div></div>
        <div className="divide-y divide-[#f1f2f4]">{archivedBoards.slice(0,5).map(board=><div key={board.id} className="flex items-center gap-3 px-5 py-3"><span className="h-7 w-1.5 shrink-0 rounded" style={{background:board.background}}/><strong className="min-w-0 flex-1 truncate text-sm">{board.title}</strong><span className="text-[11px] text-[#626f86]">{board.card_count||0} cartões</span></div>)}{archivedBoards.length===0&&<p className="px-5 py-6 text-sm text-[#626f86]">Nenhum quadro arquivado.</p>}</div>
        <div className="border-t border-[#f1f2f4] px-5 py-3"><button onClick={()=>router.push('/trash')} className="text-xs font-semibold text-[#0c66e4] hover:underline">Gerenciar todos os quadros <ArrowRight size={13} className="ml-1 inline"/></button></div>
      </section>

      <section aria-label="Listas arquivadas recentes" className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-[#f1f2f4] px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#eeedfd] text-[#6554c0]"><FileArchive size={18}/></span><div><h2 className="font-bold">Listas arquivadas</h2><p className="text-xs text-[#626f86]">{archivedLists.length} listas na lixeira</p></div></div>
        <div className="divide-y divide-[#f1f2f4]">{archivedLists.slice(0,5).map(list=><div key={list.id} className="flex items-center gap-3 px-5 py-3"><FileArchive size={15} className="shrink-0 text-[#626f86]"/><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{list.title}</strong><span className="block truncate text-xs text-[#626f86]">{list.board_title}</span></div><span className="shrink-0 text-[11px] text-[#626f86]">{list.card_count} cartões</span></div>)}{archivedLists.length===0&&<p className="px-5 py-6 text-sm text-[#626f86]">Nenhuma lista arquivada.</p>}</div>
        <div className="border-t border-[#f1f2f4] px-5 py-3"><button onClick={()=>router.push('/trash')} className="text-xs font-semibold text-[#0c66e4] hover:underline">Gerenciar todas as listas <ArrowRight size={13} className="ml-1 inline"/></button></div>
      </section>
    </div>

    <section aria-label="Painel de quadros" className="mt-7 rounded-xl border border-[#dfe1e6] bg-white p-5 shadow-sm"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><LayoutDashboard size={19} className="text-[#0c66e4]"/> Seus quadros</h2><p className="mt-1 text-xs text-[#626f86]">{visibleBoards.length} quadros · {openCards} cartões abertos · {completedCards} concluídos</p></div><div className="flex rounded-lg bg-[#f1f2f4] p-1"><button onClick={()=>setBoardSection('favorites')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${boardSection==='favorites'?'bg-white text-[#0c66e4] shadow-sm':'text-[#626f86]'}`}><Star size={13} className="mr-1 inline"/>Favoritos</button><button onClick={()=>setBoardSection('recent')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${boardSection==='recent'?'bg-white text-[#0c66e4] shadow-sm':'text-[#626f86]'}`}><Clock3 size={13} className="mr-1 inline"/>Recentes</button></div></div>{boardTiles.length?<div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{boardTiles.slice(0,8).map(board=><BoardTile key={board.id} board={boardStats(board)} onClick={()=>router.push(`/board/${board.id}`)}/>)}</div>:<div className="rounded-lg border border-dashed border-[#c1c7d0] p-7 text-center text-sm text-[#626f86]">{boardSection==='favorites'?'Marque quadros como favoritos para acompanhá-los aqui.':'Os quadros que você abrir aparecerão aqui.'}</div>}<button onClick={()=>router.push('/boards')} className="mt-4 text-xs font-semibold text-[#0c66e4] hover:underline">Ver todos os quadros <ArrowRight size={13} className="ml-1 inline"/></button></section>
  </main></div>{create&&<CreateBoardModal onClose={()=>setCreate(false)} onCreate={createBoard}/>}</div>;
}
