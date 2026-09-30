'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Bell, CalendarDays, Check, ChevronDown, FolderKanban, Home, LayoutDashboard, LogOut,
  Moon, Plus, Search, Settings, Star, Sun, Undo2, Redo2, UserRound,
  X, Pin, PinOff, CreditCard, CheckSquare, Inbox, NotebookPen, Vault, Rocket,
} from 'lucide-react';
import {
  api, send, AppNotification, Board, SearchResults, User,
  boardColors, cardUrl, clearSession, getUser, initials, setUser,
} from '@/lib/api';
import { historyState, redo, undo } from '@/lib/history';

export function Avatar({ name, url, size = 'md' }: { name: string; url?: string | null; size?: 'sm'|'md'|'lg' }) {
  const dimensions = size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-16 w-16 text-xl' : 'h-8 w-8 text-xs';
  return <span title={name} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#dfe1f8] font-bold text-[#403294] ${dimensions}`}>
    {url ? <Image alt={name} src={url} width={64} height={64} unoptimized className="h-full w-full object-cover" /> : initials(name)}
  </span>;
}

export function Modal({ children, onClose, wide = false, extraWide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean; extraWide?: boolean }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#091e42a6] p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`fade-in relative w-full ${extraWide ? 'max-w-[1350px]' : wide ? 'max-w-[760px]' : 'max-w-[430px]'} rounded-xl bg-white shadow-dialog`} role="dialog" aria-modal="true">
      {children}
      <button aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 rounded-md p-2 text-[#626f86] hover:bg-[#091e4214]"><X size={18}/></button>
    </div>
  </div>;
}

export function useConfirmModal() {
  type Options={title:string;description:string;confirmLabel?:string;destructive?:boolean};
  const [request,setRequest]=useState<{options:Options;action:()=>Promise<void>}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const confirm=useCallback((options:Options,action:()=>Promise<void>)=>{setError('');setRequest({options,action})},[]);
  const close=useCallback(()=>{if(!busy)setRequest(null)},[busy]);
  const run=useCallback(async()=>{if(!request)return;setBusy(true);setError('');try{await request.action();setRequest(null)}catch(value){setError((value as Error).message)}finally{setBusy(false)}},[request]);
  const confirmationModal=request?<Modal onClose={close}><div className="p-6"><h2 className="pr-8 text-lg font-bold">{request.options.title}</h2><p className="mt-3 whitespace-pre-wrap text-sm text-[#44546f]">{request.options.description}</p>{error&&<p role="alert" className="mt-3 text-sm text-[#ae2a19]">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button disabled={busy} onClick={close} className="rounded bg-[#e9eaed] px-4 py-2 text-sm font-semibold disabled:opacity-50">Cancelar</button><button disabled={busy} onClick={()=>void run()} className={`rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${request.options.destructive===false?'bg-[#0c66e4]':'bg-[#c9372c]'}`}>{busy?'Aguarde…':request.options.confirmLabel||'Confirmar'}</button></div></div></Modal>:null;
  return {confirm,confirmationModal};
}

export function BoardTile({ board, onClick }: { board: Board; onClick: () => void }) {
  return <button onClick={onClick} className="group relative flex h-[112px] w-full flex-col overflow-hidden rounded-[5px] p-3 text-left text-white shadow-sm transition hover:brightness-90" style={{background:board.background_image ? `linear-gradient(#0005,#0005),url("${board.background_image}") center/cover` : boardColors[board.background] || boardColors.blue}}>
    <strong className="relative z-10 max-w-[90%] text-[16px] leading-5">{board.title}</strong>
    <span className="absolute -bottom-6 -right-6 h-28 w-28 rounded-full bg-white/10"/>
    <span className="absolute -top-10 right-8 h-28 w-28 rounded-full bg-white/5"/>
    {board.starred && <Star size={15} fill="currentColor" className="absolute bottom-3 right-3"/>}
  </button>;
}

function NotificationPanel({ items, onRead, onReadAll, onChoose }: {
  items: AppNotification[];
  onRead: (id: string) => void;
  onReadAll: () => void;
  onChoose: (item: AppNotification) => void;
}) {
  return <div className="absolute right-2 top-12 z-40 w-[min(390px,calc(100vw-16px))] overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-dialog">
    <div className="flex items-center justify-between border-b border-[#dfe1e6] px-4 py-3"><h3 className="font-bold">Notificações</h3><button onClick={onReadAll} className="text-xs font-semibold text-[#0c66e4] hover:underline">Marcar todas como lidas</button></div>
    <div className="scrollbar-thin max-h-[440px] overflow-y-auto">
      {items.length === 0 ? <div className="p-8 text-center text-sm text-[#626f86]"><Bell className="mx-auto mb-3" size={26}/> Nenhuma notificação por enquanto.</div> : items.map(item =>
        <button key={item.id} onClick={() => onChoose(item)} className={`flex w-full gap-3 border-b border-[#f1f2f4] px-4 py-3 text-left hover:bg-[#f1f2f4] ${!item.read_at ? 'bg-[#e9f2ff]' : ''}`}>
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.read_at ? 'bg-transparent' : 'bg-[#0c66e4]'}`}/>
          <span className="min-w-0 flex-1"><strong className="block text-sm">{item.title}</strong><span className="mt-0.5 block truncate text-xs text-[#44546f]">{item.body}</span><span className="mt-1 block text-[11px] text-[#626f86]">{item.board_title ? `${item.board_title} · ` : ''}{new Date(item.created_at).toLocaleString('pt-BR')}</span></span>
          {!item.read_at && <span onClick={e => { e.stopPropagation(); onRead(item.id); }} title="Marcar como lida" className="self-start rounded p-1 hover:bg-[#dfe1e6]"><Check size={15}/></span>}
        </button>)}
    </div>
  </div>;
}

export function AppHeader({ user: initialUser, boards = [], onCreate }: { user: User | null; boards?: Board[]; onCreate?: () => void; onSearch?: (s:string)=>void }) {
  const router = useRouter();
  const [user, updateUser] = useState<User | null>(initialUser);
  const [previousUser, setPreviousUser] = useState(initialUser);
  if (initialUser !== previousUser) {
    setPreviousUser(initialUser);
    updateUser(initialUser);
  }
  const [panel, setPanel] = useState<'search'|'boards'|'create'|'notifications'|'account'|null>(null);
  const [query, setQuery] = useState('');
  const [searchResponse, setSearchResponse] = useState<{query:string; data:SearchResults}>({query:'',data:{boards:[],cards:[]}});
  const results = panel === 'search' && query.trim().length >= 2 && searchResponse.query === query
    ? {...searchResponse.data,boards:searchResponse.data.boards.filter(board=>!board.is_inbox)} : {boards:[],cards:[]};
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pinned, setPinned] = useState(true);
  const [history, setHistory] = useState(historyState());
  const [message, setMessage] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [pluginNavigation, setPluginNavigation] = useState<Array<{id:string;label:string;href:string}>>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedNotifications = useRef(false);
  const knownNotifications = useRef(new Set<string>());

  async function deploy() {
    setDeploying(true);setMessage('Publicando o desenvolvimento e atualizando o Orbit…');
    try {
      await send('/deploy','POST');
      const expires=Date.now()+10*60_000;
      let offline=false;
      const check=async()=>{
        try { if((await fetch('/api/health',{cache:'no-store'})).ok&&offline){window.location.reload();return;} } catch { offline=true; }
        if(Date.now()<expires)window.setTimeout(()=>void check(),1500);else {setDeploying(false);setMessage('O Deploy não voltou a responder. Confira o terminal do Orbit.');}
      };
      window.setTimeout(()=>void check(),1500);
    } catch(error) { setDeploying(false);setMessage((error as Error).message); }
  }

  useEffect(() => {
    const accountChanged = () => updateUser(getUser());
    const historyChanged = () => setHistory(historyState());
    const pinChanged = () => setPinned(localStorage.getItem('orbit_sidebar_pinned') !== 'false');
    window.addEventListener('account:changed', accountChanged);
    window.addEventListener('history:changed', historyChanged);
    window.addEventListener('sidebar:changed', pinChanged);
    pinChanged();
    return () => {
      window.removeEventListener('account:changed', accountChanged);
      window.removeEventListener('history:changed', historyChanged);
      window.removeEventListener('sidebar:changed', pinChanged);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api<{plugins:Array<{contributions?:{navigation?:Array<{id?:unknown;label?:unknown;href?:unknown}>}}>}>('/plugins')
      .then(({plugins}) => {
        if (!active) return;
        const reserved = new Set(['/','/boards','/calendar','/plugins']);
        const seen = new Set<string>();
        setPluginNavigation(plugins.flatMap(plugin => plugin.contributions?.navigation || [])
          .filter((item): item is {id:string;label:string;href:string} =>
            typeof item.id === 'string' && typeof item.label === 'string' &&
            typeof item.href === 'string' && /^\/[a-z0-9/-]+$/.test(item.href))
          .filter(item => {
            if (reserved.has(item.href) || seen.has(item.href)) return false;
            seen.add(item.href);
            return true;
          }));
      })
      .catch(() => { if (active) setPluginNavigation([]); });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (panel !== 'search' || query.trim().length < 2) return;
    const timer = window.setTimeout(() => api<SearchResults>(`/search?q=${encodeURIComponent(query)}`)
      .then(data => setSearchResponse({query,data}))
      .catch(() => setSearchResponse({query,data:{boards:[],cards:[]}})), 220);
    return () => window.clearTimeout(timer);
  }, [query, panel]);
  useEffect(() => { if (panel === 'search') searchRef.current?.focus(); }, [panel]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const poll = async () => {
      try {
        const items = await api<AppNotification[]>('/notifications');
        if (!active) return;
        setNotifications(items);
        const canNotify = initializedNotifications.current && user.preferences?.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted';
        if (canNotify) items.filter(item => !item.read_at && !knownNotifications.current.has(item.id)).forEach(item => new Notification(item.title, { body: item.body || item.board_title || '' }));
        items.forEach(item => knownNotifications.current.add(item.id));
        initializedNotifications.current = true;
      } catch { /* The page stays usable if notifications cannot load. */ }
    };
    poll();
    const timer = window.setInterval(poll, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (user?.preferences?.shortcuts === false) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        (event.shiftKey ? redo() : undo()).catch(error => setMessage((error as Error).message));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo().catch(error => setMessage((error as Error).message));
      } else if (event.key === '/') {
        event.preventDefault(); setPanel('search');
      } else if (event.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [user?.preferences?.shortcuts]);

  async function markRead(id: string) {
    await send(`/notifications/${id}/read`, 'PATCH');
    setNotifications(old => old.map(item => item.id === id ? {...item,read_at:new Date().toISOString()} : item));
  }
  async function markAll() {
    await send('/notifications/read-all', 'PATCH');
    setNotifications(old => old.map(item => ({...item,read_at:item.read_at || new Date().toISOString()})));
  }
  function chooseNotification(item: AppNotification) {
    if (!item.read_at) markRead(item.id).catch(() => {});
    setPanel(null);
    if (item.board_id) router.push(cardUrl(item.board_id,item.card_id,item.card_url_token));
  }
  async function toggleTheme() {
    const theme = user?.preferences?.theme === 'dark' ? 'light' : 'dark';
    try {
      const account = await send<User>('/account/preferences','PATCH',{theme});
      setUser(account); updateUser(account);
    } catch (error) { setMessage((error as Error).message); }
    setPanel(null);
  }
  function togglePin() {
    localStorage.setItem('orbit_sidebar_pinned', String(!pinned));
    window.dispatchEvent(new Event('sidebar:changed'));
  }
  function openBoard(id: string) { setPanel(null); router.push(`/board/${id}`); }
  const unread = notifications.filter(item => !item.read_at).length;
  const boardMatches = boards.filter(board => !board.is_inbox && board.title.toLowerCase().includes(query.toLowerCase())).slice(0,8);

  return <><header className="relative z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-[#dfe1e6] bg-white px-3 sm:gap-2 sm:px-4">
    <button onClick={() => router.push('/')} className="flex items-center gap-2 rounded px-1 py-1 text-[#172b4d] hover:bg-[#f1f2f4]" title="Home">
      <span className="flex h-7 w-7 items-center justify-center rounded bg-[#0c66e4] text-white"><LayoutDashboard size={19} strokeWidth={2.8}/></span>
      <span className="hidden text-[21px] font-extrabold tracking-[-1px] sm:inline">Orbit</span>
    </button>
    <nav className="ml-1 hidden items-center gap-1 md:flex">
      <button onClick={() => router.push('/')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Home</button>
      <button onClick={() => setPanel(panel === 'boards' ? null : 'boards')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Quadros <ChevronDown size={13} className="inline"/></button>
      <button onClick={() => router.push('/calendar')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><CalendarDays size={15} className="mr-1 inline"/>Calendário</button>
      {pluginNavigation.map(item => <button key={item.id} onClick={() => router.push(item.href)} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">{item.label}</button>)}
      <button onClick={() => router.push('/notebooks')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><NotebookPen size={15} className="mr-1 inline"/>Cadernos</button>
      <button onClick={() => router.push('/vault')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><Vault size={15} className="mr-1 inline"/>Cofre</button>
      <button onClick={() => router.push('/plugins')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Plugins</button>
    </nav>
<button
  onClick={() => router.push('/boards')}
  className="rounded p-2 text-[#44546f] hover:bg-[#f1f2f4] md:hidden"
  title="Quadros"
>
  <LayoutDashboard size={19}/>
</button>
    <button onClick={() => router.push('/')} className="rounded p-2 text-[#44546f] hover:bg-[#f1f2f4] md:hidden" title="Home"><Home size={19}/></button>
    <button onClick={() => setPanel(panel === 'create' ? null : 'create')} className="ml-1 rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0055cc]">Criar</button>
    <button disabled={deploying} onClick={() => void deploy()} className="flex items-center gap-1 rounded border border-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-[#0c66e4] hover:bg-[#e9f2ff] disabled:opacity-50" title="Compilar e reiniciar o Orbit"><Rocket size={15}/>{deploying?'Deploy…':'Deploy'}</button>
    <div className="flex-1"/>
    <button onClick={() => undo().catch(error => setMessage((error as Error).message))} disabled={!history.canUndo} className="hidden rounded p-1.5 text-[#44546f] hover:bg-[#f1f2f4] lg:block" title={history.undoLabel ? `Desfazer: ${history.undoLabel}` : 'Desfazer'}><Undo2 size={18}/></button>
    <button onClick={() => redo().catch(error => setMessage((error as Error).message))} disabled={!history.canRedo} className="hidden rounded p-1.5 text-[#44546f] hover:bg-[#f1f2f4] lg:block" title={history.redoLabel ? `Refazer: ${history.redoLabel}` : 'Refazer'}><Redo2 size={18}/></button>
    <button onClick={() => setPanel('search')} className="flex items-center gap-2 rounded border border-transparent p-2 text-[#44546f] hover:bg-[#f1f2f4] sm:w-44 sm:border-[#8590a2] sm:px-3 sm:py-1.5" aria-label="Pesquisar em todos os quadros"><Search size={17}/><span className="hidden text-sm text-[#626f86] sm:inline">Pesquisar</span></button>
    <button onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} className="relative rounded-full p-2 text-[#44546f] hover:bg-[#f1f2f4]" title="Notificações"><Bell size={19}/>{unread > 0 && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-[#e5484d] px-0.5 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}</button>
    <button onClick={() => setPanel(panel === 'account' ? null : 'account')} title="Conta" className="rounded-full"><Avatar name={user?.name || 'Igor'} url={user?.avatar_url}/></button>

    {panel === 'search' && <div className="absolute left-2 right-2 top-12 z-40 overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-dialog sm:left-auto sm:right-28 sm:w-[430px]">
      <div className="flex items-center gap-2 border-b border-[#dfe1e6] px-3 py-2"><Search size={17} className="text-[#626f86]"/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar cartões e quadros..." className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none"/><button onClick={() => setPanel(null)}><X size={17}/></button></div>
      <div className="scrollbar-thin max-h-[380px] overflow-y-auto p-2">{query.trim().length < 2 ? <p className="p-4 text-center text-xs text-[#626f86]">Digite pelo menos 2 caracteres para buscar em todos os quadros.</p> : <>
        {results.boards.length > 0 && <p className="px-2 py-1 text-[11px] font-bold uppercase text-[#626f86]">Quadros</p>}
        {results.boards.map(board => <button key={board.id} onClick={() => openBoard(board.id)} className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-[#f1f2f4]"><span className="h-6 w-8 rounded" style={{background:boardColors[board.background]}}/><span className="flex-1 truncate">{board.title}</span></button>)}
        {results.cards.length > 0 && <p className="mt-2 px-2 py-1 text-[11px] font-bold uppercase text-[#626f86]">Cartões</p>}
        {results.cards.map(card => <button key={card.id} onClick={() => { setPanel(null); router.push(cardUrl(card.board_id,card.id,card.url_token)); }} className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-[#f1f2f4]"><CreditCard size={16}/><span className="min-w-0 flex-1 truncate">{card.title}</span>{card.completed&&<span className="rounded bg-[#baf3db] px-1.5 py-0.5 text-[10px] text-[#216e4e]">Concluído</span>}<span className="max-w-24 truncate text-xs text-[#626f86]">{card.board_title}</span></button>)}
        {!results.boards.length && !results.cards.length && <p className="p-4 text-center text-xs text-[#626f86]">Nenhum resultado encontrado.</p>}
        <button onClick={() => { setPanel(null); router.push(`/search?q=${encodeURIComponent(query)}`); }} className="mt-2 w-full border-t border-[#dfe1e6] px-3 py-2 text-left text-xs font-semibold text-[#0c66e4]">Abrir busca avançada</button>
      </>}</div>
    </div>}
    {panel === 'boards' && <div className="absolute left-32 top-12 z-40 w-72 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
      <div className="flex items-center justify-between px-2 py-2"><strong className="text-sm">Alternar quadro</strong><button onClick={togglePin} className="rounded p-1 text-[#626f86] hover:bg-[#f1f2f4]" title={pinned ? 'Desafixar painel lateral' : 'Fixar painel lateral'}>{pinned ? <PinOff size={16}/> : <Pin size={16}/>}</button></div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar quadro" className="mb-2 w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm"/>
      <div className="scrollbar-thin max-h-64 overflow-y-auto">{boardMatches.map(board => <button key={board.id} onClick={() => openBoard(board.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[#f1f2f4]"><span className="h-5 w-7 shrink-0 rounded" style={{background:boardColors[board.background]}}/><span className="min-w-0 flex-1 truncate">{board.title}</span>{board.starred && <Star size={13} fill="currentColor" className="text-[#e2b203]"/>}</button>)}</div>
      <button onClick={() => { setPanel(null); router.push('/boards'); }} className="mt-2 w-full border-t border-[#dfe1e6] px-2 py-2 text-left text-sm font-semibold text-[#0c66e4]">Ver todos os quadros</button>
    </div>}
    {panel === 'create' && <div className="absolute left-20 top-12 z-40 w-56 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog sm:left-96">
      <button onClick={() => { setPanel(null); if (onCreate) { onCreate(); } else { router.push('/boards?create=1'); } }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><LayoutDashboard size={16}/> Criar quadro</button>
      <button onClick={() => { setPanel(null); router.push('/profile?tab=projects'); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={16}/> Criar projeto</button>
    </div>}
    {panel === 'notifications' && <NotificationPanel items={notifications} onRead={id => markRead(id).catch(() => {})} onReadAll={() => markAll().catch(() => {})} onChoose={chooseNotification}/>}
    {panel === 'account' && <div className="absolute right-3 top-12 z-40 w-64 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
      <div className="border-b border-[#dfe1e6] px-3 py-2"><p className="text-[11px] font-bold uppercase tracking-wide text-[#626f86]">Conta</p><div className="mt-2 flex items-center gap-2"><Avatar name={user?.name || 'Igor'} url={user?.avatar_url}/><div className="min-w-0"><p className="truncate text-sm font-semibold">{user?.name}</p><p className="truncate text-xs text-[#626f86]">{user?.email}</p></div></div></div>
      <button onClick={() => {setPanel(null);router.push('/profile')}} className="mt-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><UserRound size={16}/> Perfil e atividade</button>
      <button onClick={() => {setPanel(null);router.push('/profile?tab=cards')}} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><CheckSquare size={16}/> Cartões atribuídos</button>
      <button onClick={() => {setPanel(null);router.push('/profile?tab=settings')}} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><Settings size={16}/> Configurações</button>
      <button onClick={toggleTheme} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]">{user?.preferences?.theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>} {user?.preferences?.theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</button>
      <button onClick={() => {clearSession();setPanel(null);router.push('/');router.refresh();}} className="mt-1 flex w-full items-center gap-2 border-t border-[#dfe1e6] px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><LogOut size={16}/> Sair</button>
    </div>}
    {message && <div role="alert" className="absolute right-3 top-14 rounded bg-[#ffebe6] px-3 py-2 text-xs text-[#ae2a19] shadow"><button className="mr-2" onClick={() => setMessage('')}><X size={14}/></button>{message}</div>}
  </header>{deploying&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#091e42]/75 p-6 text-center text-white"><div><Rocket className="mx-auto mb-4 animate-pulse" size={42}/><h2 className="text-xl font-bold">Deploy em andamento</h2><p className="mt-2 max-w-md text-sm text-white/85">Salvando o desenvolvimento, atualizando o main e reiniciando o Orbit. Aguarde a tela recarregar.</p></div></div>}</>;
}

function InboxPanel({boards,onOpen}:{boards:Board[];onOpen:()=>void}) {
  const router=useRouter();
  const [inbox,setInbox]=useState<Board|null>(null);
  const [title,setTitle]=useState('');
  const [error,setError]=useState('');
  const box=boards.find(board=>board.is_inbox);
  const load=useCallback(async()=>{if(!box)return;try{setInbox(await api<Board>(`/boards/${box.id}`));setError('')}catch(err){setError((err as Error).message)}},[box]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const refresh=()=>void load();window.addEventListener('data:changed',refresh);return()=>{window.clearTimeout(timer);window.removeEventListener('data:changed',refresh)}},[load]);
  useEffect(()=>{const drop=async(event:DragEvent)=>{const source=event.dataTransfer?.getData('application/x-orbit-inbox-card');const target=(event.target as Element|null)?.closest('[data-orbit-list]')?.getAttribute('data-orbit-list');if(!source||!target)return;event.preventDefault();try{await send('/cards/move','POST',{card_ids:[source],list_id:target});await load();window.dispatchEvent(new Event('data:changed'))}catch(err){setError((err as Error).message)}};document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('application/x-orbit-inbox-card'))event.preventDefault()});document.addEventListener('drop',drop);return()=>document.removeEventListener('drop',drop)},[load]);
  const cards=inbox?.lists?.flatMap(list=>list.cards)||[];
  return <section className="mt-3 border-t border-[#dfe1e6] pt-3"><div className="flex items-center justify-between px-2"><strong className="flex items-center gap-2 text-sm"><Inbox size={17}/> Inbox</strong><button onClick={onOpen} className="text-xs text-[#0c66e4]">Abrir</button></div><form onSubmit={async event=>{event.preventDefault();const list=inbox?.lists?.[0];if(!title.trim()||!list)return;try{await send(`/lists/${list.id}/cards`,'POST',{title});setTitle('');await load()}catch(err){setError((err as Error).message)}}} className="mt-2 px-2"><input value={title} onChange={event=>setTitle(event.target.value)} placeholder="Adicionar um cartão" className="w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm"/></form><div className="mt-2 max-h-[42vh] space-y-2 overflow-y-auto px-2">{cards.map(card=><button key={card.id} draggable onDragStart={event=>{event.dataTransfer.setData('application/x-orbit-inbox-card',card.id);event.dataTransfer.effectAllowed='move'}} onClick={()=>router.push(`/inbox?card=${encodeURIComponent(card.id)}`)} className="w-full rounded bg-[#f1f2f4] px-2 py-2 text-left text-sm shadow-sm hover:bg-[#e9eaed]">{card.title}</button>)}{cards.length===0&&<p className="py-3 text-xs text-[#626f86]">Sem rascunhos.</p>}</div>{error&&<p className="px-2 pt-2 text-xs text-[#ae2a19]">{error}</p>}<p className="px-2 pt-2 text-[11px] text-[#626f86]">Arraste um cartão para qualquer lista deste quadro.</p></section>
}

export function WorkspaceSidebar({ boards, activeId, onCreate, onChoose }: { boards: Board[]; activeId?: string; onCreate: ()=>void; onChoose: (id:string)=>void }) {
  const router = useRouter();
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    const sync = () => setPinned(localStorage.getItem('orbit_sidebar_pinned') !== 'false');
    sync(); window.addEventListener('sidebar:changed', sync);
    return () => window.removeEventListener('sidebar:changed', sync);
  }, []);
  if (!pinned) return null;
  return <aside className="scrollbar-thin hidden w-[245px] shrink-0 overflow-y-auto border-r border-[#dfe1e6] bg-white px-3 py-5 lg:block">
    <button onClick={() => router.push('/')} className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm font-semibold hover:bg-[#f1f2f4]"><Home size={17}/> Home</button>
    <button onClick={() => router.push('/boards')} className={`flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm font-semibold ${!activeId && typeof window !== 'undefined' && window.location.pathname === '/boards' ? 'bg-[#e9f2ff] text-[#0c66e4]' : 'hover:bg-[#f1f2f4]'}`}><LayoutDashboard size={17}/> Quadros</button>
    <button onClick={() => router.push('/#your-items')} className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm font-semibold hover:bg-[#f1f2f4]"><CheckSquare size={17}/> Seus itens</button>
    <button onClick={() => router.push('/calendar')} className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm font-semibold hover:bg-[#f1f2f4]"><CalendarDays size={17}/> Calendário</button>
    <button onClick={() => router.push('/notebooks')} className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm font-semibold hover:bg-[#f1f2f4]"><NotebookPen size={17}/> Cadernos</button>
    <button onClick={() => router.push('/vault')} className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm font-semibold hover:bg-[#f1f2f4]"><Vault size={17}/> Cofre</button>
    <InboxPanel boards={boards} onOpen={()=>router.push('/inbox')}/>
    <div className="mt-6 flex items-center justify-between px-2 text-[11px] font-bold uppercase tracking-wide text-[#626f86]"><span>Seus quadros</span><button onClick={onCreate} aria-label="Criar quadro" className="rounded p-1 hover:bg-[#f1f2f4]"><Plus size={16}/></button></div>
    {boards.filter(board => !board.is_inbox).length === 0 && <p className="px-2 py-3 text-xs text-[#626f86]">Crie seu primeiro quadro.</p>}
    <div className="mt-3">{boards.filter(board => !board.is_inbox).map(board =>
      <button key={board.id} onClick={() => onChoose(board.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${activeId === board.id ? 'bg-[#e9f2ff] font-semibold text-[#0c66e4]' : 'hover:bg-[#f1f2f4]'}`}><span className="h-5 w-7 shrink-0 rounded-[2px]" style={{background:board.background_image ? `linear-gradient(#0005,#0005),url("${board.background_image}") center/cover` : boardColors[board.background] || boardColors.blue}}/><span className="min-w-0 flex-1 truncate">{board.title}</span>{board.starred && <Star size={13} fill="currentColor" className="text-[#e2b203]"/>}</button>)}
    </div>
  </aside>;
}

export function CreateBoardModal({ onClose, onCreate }: { onClose:()=>void; onCreate:(title:string,background:string,workspaceId?:string)=>Promise<void> }) {
  const [title,setTitle]=useState('');
  const [background,setBackground]=useState('blue');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (!title.trim()) return;
    setBusy(true); setError('');
    try { await onCreate(title,background); onClose(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal onClose={onClose}><form onSubmit={create} className="p-6"><h2 className="mb-5 text-center text-sm font-bold">Criar quadro</h2>
    <div className="mx-auto mb-5 flex h-28 max-w-[240px] items-center justify-center rounded text-xl font-bold text-white shadow" style={{background:boardColors[background]}}>▦</div>
    <p className="mb-2 text-xs font-bold">Plano de fundo</p><div className="mb-5 grid grid-cols-8 gap-1.5">{Object.entries(boardColors).map(([key,color]) => <button type="button" key={key} onClick={() => setBackground(key)} aria-label={key} className={`h-8 rounded ${background===key?'ring-2 ring-[#0c66e4] ring-offset-2':''}`} style={{background:color}}/>)}</div>
    <label className="mb-2 block text-xs font-bold" htmlFor="board-title">Título do quadro <span className="text-red-500">*</span></label><input id="board-title" autoFocus maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} className="mb-4 w-full rounded border border-[#8590a2] px-3 py-2 text-sm" placeholder="Ex.: Projeto de lançamento"/>
    {error && <p role="alert" className="mb-3 rounded bg-[#ffebe6] p-2 text-xs text-[#ae2a19]">{error}</p>}
    <button disabled={busy || !title.trim()} className="w-full rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0055cc]">{busy ? 'Criando...' : 'Criar quadro'}</button>
  </form></Modal>;
}

export function EmptyHint({children}:{children:React.ReactNode}) { return <div className="rounded-lg border border-dashed border-[#c1c7d0] bg-white p-8 text-center text-sm text-[#626f86]">{children}</div>; }
