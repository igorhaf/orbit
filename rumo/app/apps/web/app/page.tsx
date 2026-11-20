'use client';
import {usePluginAvailability} from '@/lib/plugin-availability';
import {useCreationAvailability} from '@/plugins/project-boards/use-creation-availability';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Clock3, LayoutDashboard, Plus, Search, Star } from 'lucide-react';
import { api, send, Board, HomeData, SearchResults, User, clearSession, getToken, getUser, setUser, cardUrl } from '@/lib/api';
import { AppHeader, BoardTile, CreateBoardModal, WorkspaceSidebar } from '@/components/ui';
import { AuthScreen } from '@/components/auth-screen';
import { useHydrated } from '@/lib/use-hydrated';
import { remember } from '@/lib/history';

type BoardSection='favorites'|'recent';
const blank: HomeData = { upNext:[], highlights:[], yourItems:[], recentBoards:[], favorites:[], recentConversations:[] };
const blankSearch:SearchResults={boards:[],cards:[]};

export default function Home() {
  const {canCreateBoard}=useCreationAvailability();
  const {processBoards}=usePluginAvailability();
  const router=useRouter();
  const [user,setCurrentUser]=useState<User|null>(null);
  const ready=useHydrated();
  const [boards,setBoards]=useState<Board[]>([]);
  const [data,setData]=useState<HomeData>(blank);
  const [query,setQuery]=useState('');
  const [searchResults,setSearchResults]=useState<SearchResults>(blankSearch);
  const [searchResultsTerm,setSearchResultsTerm]=useState('');
  const [searchLoading,setSearchLoading]=useState(false);
  const [boardSection,setBoardSection]=useState<BoardSection>('favorites');
  const [create,setCreate]=useState(false); const [createFocusTarget,setCreateFocusTarget]=useState<HTMLElement|null>(null);
  const [error,setError]=useState('');
  const load = useCallback(async () => {
    try {
      const [home,all]=await Promise.all([
        api<HomeData>('/home'),
        api<Board[]>('/boards'),
      ]);
      setData(home);setBoards(all);
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
  if (!ready) return <div className="min-h-screen bg-[var(--orbit-product-surface)]"/>;
  if (!user) return <AuthScreen onDone={account => {setCurrentUser(account);load();}}/>;
  const visibleBoards=boards.filter(board=>!board.is_inbox);
  const activeBoards=boardSection==='favorites'?data.favorites:data.recentBoards;
  const boardTiles=activeBoards.slice(0,8);
  const totalCards=visibleBoards.reduce((sum,board)=>sum+(board.card_count||0),0);
  const boardStats=(board:Board)=>({...board,...visibleBoards.find(item=>item.id===board.id)});
  return <div className="flex min-h-screen flex-col bg-[var(--orbit-product-surface)]">
    <AppHeader user={user} boards={boards} onCreate={()=>{setCreateFocusTarget(document.activeElement instanceof HTMLElement ? document.activeElement : null);setCreate(true)}}/>
    <div className="flex min-h-0 flex-1">
      <WorkspaceSidebar boards={boards} onCreate={()=>{setCreateFocusTarget(document.activeElement instanceof HTMLElement ? document.activeElement : null);setCreate(true)}} onChoose={id=>router.push(id?`/board/${id}`:'/boards')}/>
      <main className="mx-auto flex w-full max-w-[1400px] flex-col px-4 py-7 sm:px-7 lg:px-9">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[.12em] text-[#626f86]">RUMO · PROJETOS</p>
            <h1 className="text-[27px] font-bold tracking-tight sm:text-[31px]">Seus quadros</h1>
            <p className="mt-1 text-sm text-[#626f86]">Organize o trabalho em listas, cartões e próximos passos.</p>
          </div>
          {canCreateBoard&&<button onClick={(event)=>{setCreateFocusTarget(event.currentTarget);setCreate(true)}} className="flex items-center gap-2 rounded bg-[var(--orbit-brand)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--orbit-brand-strong)]"><Plus size={16}/> Criar quadro</button>}
        </header>
        {error&&<p role="alert" className="mb-5 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}

        <section aria-label="Quadros de projetos" className="rounded-xl border border-[#dfe1e6] bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold"><LayoutDashboard size={19} className="text-[var(--orbit-brand)]"/> Quadros de trabalho</h2>
              <p className="mt-1 text-xs text-[#626f86]">{visibleBoards.length+processBoards.length} quadros{totalCards>0?` · ${totalCards} cartões`:''}</p>
            </div>
            <div role="group" aria-label="Filtrar quadros" className="flex rounded-lg bg-[#f1f2f4] p-1">
              <button aria-pressed={boardSection==='favorites'} onClick={()=>setBoardSection('favorites')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${boardSection==='favorites'?'bg-white text-[var(--orbit-brand-strong)] shadow-sm':'text-[#626f86]'}`}><Star size={13} className="mr-1 inline"/>Favoritos</button>
              <button aria-pressed={boardSection==='recent'} onClick={()=>setBoardSection('recent')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${boardSection==='recent'?'bg-white text-[var(--orbit-brand-strong)] shadow-sm':'text-[#626f86]'}`}><Clock3 size={13} className="mr-1 inline"/>Recentes</button>
            </div>
          </div>
          {boardTiles.length||processBoards.length
            ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {processBoards.map(board=><button key={board.id} onClick={()=>router.push(board.href)} className="min-h-28 min-w-0 rounded-xl border border-[#dfe1e6] bg-[#e0f3ee] p-4 text-left hover:border-[var(--orbit-brand)]"><strong className="block break-words">{board.name}</strong><span className="mt-2 block text-xs text-[#626f86]">Gestão de processos</span></button>)}
                {boardTiles.slice(0,8).map(board=><BoardTile key={board.id} board={boardStats(board)} onClick={()=>router.push(`/board/${board.id}`)}/>)}
              </div>
            : <div className="rounded-lg border border-dashed border-[#c1c7d0] p-8 text-center">
                <LayoutDashboard className="mx-auto mb-3 text-[var(--orbit-brand)]" size={28}/>
                <p className="font-semibold">{boardSection==='favorites'?'Nenhum favorito por enquanto':'Seus quadros recentes aparecerão aqui'}</p>
                <p className="mt-1 text-sm text-[#626f86]">Crie um quadro ou escolha um projeto no menu lateral para começar.</p>
                {canCreateBoard&&<button onClick={(event)=>{setCreateFocusTarget(event.currentTarget);setCreate(true)}} className="mt-4 inline-flex items-center gap-2 rounded bg-[var(--orbit-brand)] px-3 py-2 text-sm font-semibold text-white"><Plus size={16}/> Criar quadro</button>}
              </div>}
          <button onClick={()=>router.push('/boards')} className="mt-4 inline-flex items-center text-xs font-semibold text-[var(--orbit-brand-strong)] hover:underline">Ver todos os quadros <ArrowRight size={13} className="ml-1"/></button>
        </section>

        <section aria-label="Busca global" className="mt-5 rounded-xl border border-[#dfe1e6] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e0f3ee] text-[var(--orbit-brand-strong)]"><Search size={20}/></span><div><h2 className="font-bold">Encontrar trabalho</h2><p className="text-xs text-[#626f86]">Busque cartões e quadros em todos os seus projetos.</p></div></div>
          <div className="relative mt-4"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#626f86]"/><input aria-label="Buscar cartões e quadros" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar cartões e quadros" className="w-full rounded-lg border border-[#8590a2] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--orbit-brand)] focus:ring-2 focus:ring-[var(--orbit-focus)]"/></div>
          {query.trim().length>=2&&<div aria-live="polite" className="mt-3">{searchLoading||searchResultsTerm!==query.trim()?<p className="py-3 text-sm text-[#626f86]">Pesquisando…</p>:searchResults.boards.length+searchResults.cards.length===0?<p className="py-3 text-sm text-[#626f86]">Nenhum resultado para “{query}”.</p>:<div className="grid gap-2 md:grid-cols-2">{searchResults.boards.slice(0,3).map(board=><button key={`b:${board.id}`} onClick={()=>router.push(`/board/${board.id}`)} className="flex items-center gap-3 rounded-lg bg-[#f3f7f5] p-3 text-left hover:bg-[#e0f3ee]"><span className="h-8 w-2 shrink-0 rounded" style={{background:board.background}}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{board.title}</strong><span className="text-xs text-[#626f86]">Quadro</span></span><ArrowRight size={15}/></button>)}{searchResults.cards.slice(0,5).map(card=><button key={`c:${card.id}`} onClick={()=>router.push(cardUrl(card.board_id,card.id,card.url_token))} className="flex items-center gap-3 rounded-lg bg-[#f3f7f5] p-3 text-left hover:bg-[#e0f3ee]"><span className="h-8 w-2 shrink-0 rounded" style={{background:card.background}}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{card.title}</strong><span className="block truncate text-xs text-[#626f86]">{card.board_title} · {card.list_title}</span></span><ArrowRight size={15}/></button>)}</div>}</div>}
        </section>
      </main>
    </div>
    {create&&canCreateBoard&&<CreateBoardModal onClose={()=>setCreate(false)} onCreate={createBoard} restoreFocusTo={createFocusTarget}/>}
  </div>;
}
