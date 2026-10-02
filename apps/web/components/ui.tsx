'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Bell, CalendarDays, Check, ChevronDown, FolderKanban, Home, LayoutDashboard, LogOut,
  Moon, Search, Settings, Star, Sun, Undo2, Redo2, UserRound,
  X, Pin, PinOff, CreditCard, CheckSquare, Inbox, NotebookPen, Vault, Workflow, Circle, CheckCircle2, FolderOpen,
} from 'lucide-react';
import {
  api, send, AppNotification, Board, Card, List, SearchResults, User,
  boardColors, cardUrl, clearSession, getUser, initials, setUser,
} from '@/lib/api';
import { historyState, redo, undo } from '@/lib/history';
import { CardDialog } from './card-dialog';
import { CardActivityIndicator } from './card-execution';
import { io } from 'socket.io-client';

export function Avatar({ name, url, size = 'md' }: { name: string; url?: string | null; size?: 'sm'|'md'|'lg' }) {
  const dimensions = size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-16 w-16 text-xl' : 'h-8 w-8 text-xs';
  return <span title={name} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#dfe1f8] font-bold text-[#403294] ${dimensions}`}>
    {url ? <Image alt={name} src={url} width={64} height={64} unoptimized className="h-full w-full object-cover" /> : initials(name)}
  </span>;
}

const modalStack: symbol[] = [];
const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerSnapshot = () => false;

export function Modal({ children, onClose, wide = false, extraWide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean; extraWide?: boolean }) {
  const mounted = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerSnapshot);
  const modalId = useRef(Symbol('modal'));
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const id = modalId.current;
    modalStack.push(id);
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' && modalStack.at(-1) === id) closeRef.current(); };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      const index = modalStack.lastIndexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, []);
  if (!mounted) return null;
  return createPortal(<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#091e42a6] p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div onMouseDown={e => e.stopPropagation()} className={`fade-in relative w-full ${extraWide ? 'max-w-[1350px]' : wide ? 'max-w-[760px]' : 'max-w-[430px]'} rounded-xl bg-white shadow-dialog`} role="dialog" aria-modal="true">
      {children}
      <button aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 rounded-md p-2 text-[#626f86] hover:bg-[#091e4214]"><X size={18}/></button>
    </div>
  </div>, document.body);
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
  const total = board.card_count || 0;
  const completed = board.completed_card_count || 0;
  const open = Math.max(0, total - completed);
  const completedPercent = total ? Math.round((completed / total) * 100) : 0;
  const openPercent = total ? 100 - completedPercent : 0;
  return <button onClick={onClick} className="group relative flex h-[112px] w-full flex-col overflow-hidden rounded-[5px] p-3 text-left text-white shadow-sm transition hover:brightness-90" style={{background:board.background_image ? `linear-gradient(#0005,#0005),url("${board.background_image}") center/cover` : boardColors[board.background] || boardColors.blue}}>
    <span className="relative z-10 flex max-w-full gap-1 pr-2 text-[10px] font-semibold"><span className="inline-flex items-center gap-1 rounded bg-black/35 px-1.5 py-1"><Circle size={11}/> {open} abertos · {openPercent}%</span><span className="inline-flex items-center gap-1 rounded bg-black/35 px-1.5 py-1"><CheckCircle2 size={11}/> {completed} concluídos · {completedPercent}%</span></span>
    <strong className="relative z-10 mt-auto max-w-[90%] truncate text-[16px] leading-5">{board.title}</strong>
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
  return <div className="absolute right-0 top-full z-40 w-[min(390px,calc(100vw-16px))] overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-dialog">
    <div className="flex items-center justify-between border-b border-[#dfe1e6] px-4 py-3"><h3 className="font-bold">Notificações</h3><button onClick={onReadAll} className="text-xs font-semibold text-[#0c66e4] hover:underline">Marcar todas como lidas</button></div>
    <div className="scrollbar-thin max-h-[440px] overflow-y-auto">
      {items.length === 0 ? <div className="p-8 text-center text-sm text-[#626f86]"><Bell className="mx-auto mb-3" size={26}/> Nenhuma notificação por enquanto.</div> : items.map(item =>
        <button key={item.id} onClick={() => onChoose(item)} className={`flex w-full gap-3 border-b border-[#f1f2f4] px-4 py-3 text-left hover:bg-[#f1f2f4] ${!item.read_at ? 'bg-[#e9f2ff]' : ''}`}>
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.read_at ? 'bg-transparent' : 'bg-[#0c66e4]'}`}/>
          <span className="min-w-0 flex-1"><span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-[#626f86]">{item.plugin_id.replaceAll('_', ' ')}</span><strong className="block text-sm">{item.title}</strong><span className="mt-0.5 block truncate text-xs text-[#44546f]">{item.body}</span><span className="mt-1 block text-[11px] text-[#626f86]">{item.board_title ? `${item.board_title} · ` : ''}{new Date(item.created_at).toLocaleString('pt-BR')}</span></span>
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
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const boardsMenuRef = useRef<HTMLDivElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const notificationsMenuRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchResponse, setSearchResponse] = useState<{query:string; data:SearchResults}>({query:'',data:{boards:[],cards:[]}});
  const results = panel === 'search' && query.trim().length >= 2 && searchResponse.query === query
    ? {...searchResponse.data,boards:searchResponse.data.boards.filter(board=>!board.is_inbox&&!board.is_collection)} : {boards:[],cards:[]};
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pinned, setPinned] = useState(true);
  const [history, setHistory] = useState(historyState());
  const [message, setMessage] = useState('');
  const [pluginNavigation, setPluginNavigation] = useState<Array<{id:string;label:string;href:string}>>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedNotifications = useRef(false);
  const knownNotifications = useRef(new Set<string>());

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
    const loadPluginNavigation = () => api<{plugins:Array<{enabled:boolean;contributions?:{navigation?:Array<{id?:unknown;label?:unknown;href?:unknown}>}}>}>('/plugins')
      .then(({plugins}) => {
        if (!active) return;
        const reserved = new Set(['/','/boards','/calendar','/plugins']);
        const seen = new Set<string>();
        setPluginNavigation(plugins.filter(plugin=>plugin.enabled).flatMap(plugin => plugin.contributions?.navigation || [])
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
    void loadPluginNavigation();
    window.addEventListener('plugins:changed', loadPluginNavigation);
    return () => { active = false; window.removeEventListener('plugins:changed', loadPluginNavigation); };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const refresh = () => {
      void api<AppNotification[]>('/notifications').then(items => {
        if (active) setNotifications(items);
      }).catch(() => undefined);
    };
    const socket = io({ path: '/socket.io', auth: { token: localStorage.getItem('orbit_token') || '' } });
    socket.on('notification:changed', refresh);
    return () => { active = false; socket.disconnect(); };
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
      if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
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
    if (item.target_url) router.push(item.target_url);
    else if (item.board_id && item.card_id) router.push(cardUrl(item.board_id,item.card_id,item.card_url_token));
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
  const boardMatches = boards.filter(board => !board.is_inbox && !board.is_collection && board.title.toLowerCase().includes(query.toLowerCase())).slice(0,8);
  useEffect(() => {
    if (panel !== 'account') return;
    const closeOutside = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [panel]);
  useEffect(() => {
    if (panel !== 'boards') return;
    const closeOutside = (event: MouseEvent) => {
      if (!boardsMenuRef.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [panel]);
  useEffect(() => {
    if (panel !== 'notifications') return;
    const closeOutside = (event: Event) => {
      if (!notificationsMenuRef.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [panel]);
  useEffect(() => {
    if (panel !== 'create') return;
    const closeOutside = (event: MouseEvent) => {
      if (!createMenuRef.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [panel]);

  return <><header className="relative z-30 flex min-h-14 shrink-0 flex-wrap items-center gap-1.5 border-b border-[#dfe1e6] bg-white px-3 py-1 sm:gap-2 sm:px-4">
    <button onClick={() => router.push('/')} className="flex items-center gap-2 rounded px-1 py-1 text-[#172b4d] hover:bg-[#f1f2f4]" title="Home">
      <span className="flex h-7 w-7 items-center justify-center rounded bg-[#0c66e4] text-white"><LayoutDashboard size={19} strokeWidth={2.8}/></span>
      <span className="hidden text-[21px] font-extrabold tracking-[-1px] sm:inline">Orbit</span>
    </button>
    <nav className="ml-1 hidden items-center gap-1 md:flex">
      <button onClick={() => router.push('/')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Home</button>
      <div ref={boardsMenuRef} className="relative" onMouseLeave={() => { if (panel === 'boards') setPanel(null); }}>
        <button onClick={() => setPanel(panel === 'boards' ? null : 'boards')} aria-expanded={panel === 'boards'} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Quadros <ChevronDown size={13} className="inline"/></button>
        {panel === 'boards' && <div className="absolute left-0 top-full z-40 w-72 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
          <div className="flex items-center justify-between px-2 py-2"><strong className="text-sm">Alternar quadro</strong><button onClick={togglePin} className="rounded p-1 text-[#626f86] hover:bg-[#f1f2f4]" title={pinned ? 'Desafixar painel lateral' : 'Fixar painel lateral'}>{pinned ? <PinOff size={16}/> : <Pin size={16}/>}</button></div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar quadro" className="mb-2 w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm"/>
          <div className="scrollbar-thin max-h-64 overflow-y-auto">{boardMatches.map(board => <button key={board.id} onClick={() => openBoard(board.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[#f1f2f4]"><span className="h-5 w-7 shrink-0 rounded" style={{background:boardColors[board.background]}}/><span className="min-w-0 flex-1 truncate">{board.title}</span>{board.starred && <Star size={13} fill="currentColor" className="text-[#e2b203]"/>}</button>)}</div>
          <button onClick={() => { setPanel(null); router.push('/boards'); }} className="mt-2 w-full border-t border-[#dfe1e6] px-2 py-2 text-left text-sm font-semibold text-[#0c66e4]">Ver todos os quadros</button>
        </div>}
      </div>
      <button onClick={() => router.push('/calendar')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><CalendarDays size={15} className="mr-1 inline"/>Calendário</button>
      {pluginNavigation.map(item => <button key={item.id} onClick={() => router.push(item.href)} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">{item.label}</button>)}
      <button onClick={() => router.push('/notebooks')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><NotebookPen size={15} className="mr-1 inline"/>Cadernos</button>
      <button onClick={() => router.push('/vault')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><Vault size={15} className="mr-1 inline"/>Cofre</button>
      <button onClick={() => router.push('/automations')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><Workflow size={15} className="mr-1 inline"/>Automações</button>
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
    <div ref={createMenuRef} className="relative ml-1">
      <button onClick={() => setPanel(panel === 'create' ? null : 'create')} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0055cc]">Criar</button>
      {panel === 'create' && <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
        <button onClick={() => { setPanel(null); if (onCreate) { onCreate(); } else { router.push('/boards?create=1'); } }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><LayoutDashboard size={16}/> Criar quadro</button>
        <button onClick={() => { setPanel(null); router.push('/profile?tab=projects'); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={16}/> Criar projeto</button>
      </div>}
    </div>
    <div className="flex-1"/>
    <button onClick={() => undo().catch(error => setMessage((error as Error).message))} disabled={!history.canUndo} aria-label="Desfazer" aria-keyshortcuts="Control+Z Meta+Z" className="rounded p-1.5 text-[#44546f] hover:bg-[#f1f2f4] disabled:cursor-not-allowed disabled:opacity-35" title={`${history.undoLabel ? `Desfazer: ${history.undoLabel}` : 'Desfazer'} (Ctrl/Cmd+Z)`}><Undo2 size={18}/></button>
    <button onClick={() => redo().catch(error => setMessage((error as Error).message))} disabled={!history.canRedo} aria-label="Refazer" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" className="rounded p-1.5 text-[#44546f] hover:bg-[#f1f2f4] disabled:cursor-not-allowed disabled:opacity-35" title={`${history.redoLabel ? `Refazer: ${history.redoLabel}` : 'Refazer'} (Ctrl/Cmd+Shift+Z ou Ctrl/Cmd+Y)`}><Redo2 size={18}/></button>
    <button onClick={() => setPanel('search')} className="flex items-center gap-2 rounded border border-transparent p-2 text-[#44546f] hover:bg-[#f1f2f4] sm:w-44 sm:border-[#8590a2] sm:px-3 sm:py-1.5" aria-label="Pesquisar em todos os quadros"><Search size={17}/><span className="hidden text-sm text-[#626f86] sm:inline">Pesquisar</span></button>
    <div ref={notificationsMenuRef} className="relative" onMouseLeave={() => { if (panel === 'notifications') setPanel(null); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPanel(null); }}>
    <button onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} aria-expanded={panel === 'notifications'} className="relative rounded-full p-2 text-[#44546f] hover:bg-[#f1f2f4]" title="Notificações"><Bell size={19}/>{unread > 0 && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-[#e5484d] px-0.5 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}</button>
    {panel === 'notifications' && <NotificationPanel items={notifications} onRead={id => markRead(id).catch(() => {})} onReadAll={() => markAll().catch(() => {})} onChoose={chooseNotification}/>}
    </div>
    <div ref={accountMenuRef} className="relative" onMouseLeave={() => { if (panel === 'account') setPanel(null); }}>
    <button onClick={() => setPanel(panel === 'account' ? null : 'account')} title="Conta" aria-expanded={panel === 'account'} className="rounded-full"><Avatar name={user?.name || 'Igor'} url={user?.avatar_url}/></button>

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
    {panel === 'account' && <div className="absolute right-0 top-full z-40 w-64 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
      <div className="border-b border-[#dfe1e6] px-3 py-2"><p className="text-[11px] font-bold uppercase tracking-wide text-[#626f86]">Conta</p><div className="mt-2 flex items-center gap-2"><Avatar name={user?.name || 'Igor'} url={user?.avatar_url}/><div className="min-w-0"><p className="truncate text-sm font-semibold">{user?.name}</p><p className="truncate text-xs text-[#626f86]">{user?.email}</p></div></div></div>
      <button onClick={() => {setPanel(null);router.push('/profile')}} className="mt-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><UserRound size={16}/> Perfil e atividade</button>
      <button onClick={() => {setPanel(null);router.push('/profile?tab=cards')}} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><CheckSquare size={16}/> Cartões atribuídos</button>
      <button onClick={() => {setPanel(null);router.push('/profile?tab=settings')}} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><Settings size={16}/> Configurações</button>
      <button onClick={toggleTheme} className="theme-preference-control flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]">{user?.preferences?.theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>} {user?.preferences?.theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</button>
      <button onClick={() => {clearSession();setPanel(null);router.push('/');router.refresh();}} className="mt-1 flex w-full items-center gap-2 border-t border-[#dfe1e6] px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><LogOut size={16}/> Sair</button>
    </div>}
    </div>
  </header>{message && <div role="alert" className="relative z-20 flex w-full shrink-0 items-center gap-2 border-b border-[#f5c2b7] bg-[#ffebe6] px-4 py-2 text-sm text-[#ae2a19] shadow-sm"><button className="shrink-0 rounded p-1 hover:bg-[#f5c2b7]" onClick={() => setMessage('')} aria-label="Fechar aviso"><X size={14}/></button><span className="min-w-0 break-words">{message}</span></div>}</>;
}

function InboxPanel({boards}:{boards:Board[]}) {
  const [inbox,setInbox]=useState<Board|null>(null);
  const [selected,setSelected]=useState<Card|null>(null);
  const [title,setTitle]=useState('');
  const [error,setError]=useState('');
  const [transfer,setTransfer]=useState<Card|null>(null);
  const inboxId=boards.find(board=>board.is_inbox)?.id;
  const load=useCallback(async()=>{if(!inboxId)return;try{const full=await api<Board>(`/boards/${inboxId}`);setInbox(full);setSelected(current=>current?full.lists?.flatMap(list=>list.cards).find(card=>card.id===current.id)||current:null);setError('')}catch(err){setError((err as Error).message)}},[inboxId]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const refresh=()=>void load();window.addEventListener('data:changed',refresh);return()=>{window.clearTimeout(timer);window.removeEventListener('data:changed',refresh)}},[load]);
  useEffect(()=>{if(!inbox?.id)return;const boardId=inbox.id;const socket=io({path:'/socket.io',auth:{token:localStorage.getItem('orbit_token')||''}});socket.on('connect',()=>socket.emit('board:join',boardId));const refresh=(event?:{boardId?:string})=>{if(!event?.boardId||event.boardId===boardId)void load()};socket.on('board:changed',refresh);socket.on('comment:changed',refresh);socket.on('prompt:progress',refresh);socket.on('notification:changed',()=>void load());return()=>{socket.emit('board:leave',boardId);socket.disconnect()}},[inbox?.id,load]);
  useEffect(()=>{const drop=async(event:DragEvent)=>{const source=event.dataTransfer?.getData('application/x-orbit-inbox-card');const target=(event.target as Element|null)?.closest('[data-orbit-list]')?.getAttribute('data-orbit-list');if(!source||!target)return;event.preventDefault();try{await send('/cards/move','POST',{card_ids:[source],list_id:target});await load();window.dispatchEvent(new Event('data:changed'))}catch(err){setError((err as Error).message)}};document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('application/x-orbit-inbox-card'))event.preventDefault()});document.addEventListener('drop',drop);return()=>document.removeEventListener('drop',drop)},[load]);
  const cards=inbox?.lists?.flatMap(list=>list.cards)||[];
  const collection=boards.find(board=>board.is_collection);
  return <><section className="pt-1"><form onSubmit={async event=>{event.preventDefault();const list=inbox?.lists?.[0];if(!title.trim()||!list)return;try{await send(`/lists/${list.id}/cards`,'POST',{title});setTitle('');await load()}catch(err){setError((err as Error).message)}}} className="mt-2 px-2"><input value={title} onChange={event=>setTitle(event.target.value)} placeholder="Adicionar um cartão" className="w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm"/></form><div className="mt-2 max-h-[calc(100vh-190px)] space-y-2 overflow-y-auto px-2">{cards.map(card=><div key={card.id} className="flex items-center gap-1 rounded bg-[#f1f2f4] px-2 py-1 shadow-sm"><button draggable onDragStart={event=>{event.dataTransfer.setData('application/x-orbit-inbox-card',card.id);event.dataTransfer.setData('application/x-orbit-inbox-title',card.title);event.dataTransfer.effectAllowed='move'}} onClick={()=>setSelected(card)} className="min-w-0 flex-1 py-1 text-left text-sm hover:bg-[#e9eaed]"><span className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{card.title}</span><CardActivityIndicator card={card}/></span></button>{collection&&<button title="Enviar para Coleções" onClick={()=>setTransfer(card)} className="rounded px-1 text-xs text-[#6554c0] hover:bg-[#e2dffc]">↗</button>}</div>)}{cards.length===0&&<p className="py-3 text-xs text-[#626f86]">Sem rascunhos.</p>}</div>{error&&<p className="px-2 pt-2 text-xs text-[#ae2a19]">{error}</p>}<p className="px-2 pt-2 text-[11px] text-[#626f86]">Arraste cartões para o Planner ou Calendário para agendá-los.</p></section>{selected&&inbox&&<CardDialog card={selected} board={inbox} onClose={()=>setSelected(null)} onChanged={async()=>{await load();const updated=await api<Board>(`/boards/${inbox.id}`);setInbox(updated);setSelected(updated.lists?.flatMap(list=>list.cards).find(card=>card.id===selected.id)||null)}} onDeleted={async()=>{setSelected(null);await load()}}/>}{transfer&&collection&&<TransferCardModal card={transfer} target={collection} label="Enviar para Coleções" onClose={()=>setTransfer(null)} onDone={async()=>{setTransfer(null);await load();window.dispatchEvent(new Event('data:changed'))}}/>}</>
}

function TransferCardModal({card,target,label,onClose,onDone}:{card:Card;target:Board;label:string;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [listId,setListId]=useState(target.lists?.[0]?.id||''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(){if(!listId)return;setBusy(true);try{await send('/cards/move','POST',{card_ids:[card.id],list_id:listId});await onDone()}catch(err){setError((err as Error).message)}finally{setBusy(false)}}
  return <Modal onClose={onClose}><div className="p-5"><h2 className="text-lg font-bold">{label}</h2><p className="mt-1 text-sm text-[#626f86]">Escolha a categoria de destino.</p><select value={listId} onChange={event=>setListId(event.target.value)} className="mt-4 w-full rounded border p-2 text-sm">{target.lists?.map(list=><option key={list.id} value={list.id}>{list.title}</option>)}</select>{error&&<p className="mt-2 text-xs text-[#ae2a19]">{error}</p>}<button disabled={busy||!listId} onClick={()=>void submit()} className="mt-4 rounded bg-[#6554c0] px-4 py-2 text-sm font-semibold text-white">{busy?'Enviando…':'Enviar cartão'}</button></div></Modal>;
}

function CollectionPanel({boards}:{boards:Board[]}) {
  const [collection,setCollection]=useState<Board|null>(null);
  const [openId,setOpenId]=useState('');
  const [selected,setSelected]=useState<Card|null>(null);
  const [categoryTitle,setCategoryTitle]=useState('');
  const [cardTitle,setCardTitle]=useState('');
  const [parentId,setParentId]=useState('');
  const [categoryModal,setCategoryModal]=useState(false);
  const [transfer,setTransfer]=useState<Card|null>(null);
  const {confirm,confirmationModal}=useConfirmModal();
  const collectionId=boards.find(board=>board.is_collection)?.id;
  const load=useCallback(async()=>{if(!collectionId)return;try{const full=await api<Board>(`/boards/${collectionId}`);setCollection(full);setSelected(current=>current?full.lists?.flatMap(list=>list.cards).find(card=>card.id===current.id)||null:null)}catch{setCollection(null)}},[collectionId]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const refresh=()=>void load();window.addEventListener('data:changed',refresh);return()=>{window.clearTimeout(timer);window.removeEventListener('data:changed',refresh)}},[load]);
  const lists=collection?.lists||[];
  const toggle=(id:string)=>setOpenId(current=>current===id?'':id);
  async function createCategory(event:React.FormEvent){event.preventDefault();if(!collection||!categoryTitle.trim())return;await send(`/boards/${collection.id}/lists`,'POST',{title:categoryTitle,parent_list_id:parentId||null});setCategoryTitle('');setParentId('');setCategoryModal(false);await load()}
  async function createCard(event:React.FormEvent){event.preventDefault();const list=lists.find(item=>item.id===openId)||lists[0];if(!list||!cardTitle.trim())return;await send(`/lists/${list.id}/cards`,'POST',{title:cardTitle});setCardTitle('');setOpenId(list.id);await load()}
  async function updateCategory(id:string,changes:{position?:number;parent_list_id?:string|null}){await send(`/lists/${id}`,'PATCH',changes);await load()}
  function removeCategory(list:List){confirm({title:'Remover categoria?',description:`A categoria “${list.title}” e seus cards serão removidos.`,confirmLabel:'Remover'},async()=>{await send(`/lists/${list.id}/archive`,'POST');await send(`/lists/${list.id}`,'DELETE');if(openId===list.id)setOpenId('');await load()})}
  const render=(list:List,depth=0):React.ReactNode=>{const siblings=lists.filter(item=>item.parent_list_id===list.parent_list_id);const index=siblings.findIndex(item=>item.id===list.id);return <div key={list.id} className="mt-1" style={{marginLeft:`${Math.min(depth,4)*10}px`}}><div className={`flex items-center gap-1 rounded px-1 hover:bg-[#f1f2f4] ${openId===list.id?'bg-[#f0edff]':''}`}><button onClick={()=>toggle(list.id)} aria-expanded={openId===list.id} className="flex min-w-0 flex-1 items-center gap-1 py-1.5 text-left text-sm"><ChevronDown size={14} className={`shrink-0 transition-transform ${openId===list.id?'':'-rotate-90'}`}/><FolderOpen size={15} className="shrink-0"/><span className="min-w-0 flex-1 truncate">{list.title}</span><span className="text-[10px] text-[#626f86]">{list.cards.length}</span></button><button title="Adicionar subcategoria" onClick={()=>{setParentId(list.id);setCategoryModal(true)}} className="px-1 text-xs text-[#6554c0]">+</button><button title="Mover categoria para cima" disabled={index===0} onClick={()=>void updateCategory(list.id,{position:index-1})} className="px-0.5 text-xs disabled:opacity-30">↑</button><button title="Mover categoria para baixo" disabled={index===siblings.length-1} onClick={()=>void updateCategory(list.id,{position:index+1})} className="px-0.5 text-xs disabled:opacity-30">↓</button><button title="Remover categoria" onClick={()=>removeCategory(list)} className="px-1 text-xs text-[#ae2a19]">×</button></div>{openId===list.id&&<div className="ml-5 space-y-1 border-l border-[#dfe1e6] pl-2">{list.cards.map(card=><div key={card.id} className="flex items-center gap-1"><button onClick={()=>setSelected(card)} className="flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1 text-left text-xs text-[#44546f] hover:bg-[#f1f2f4]"><CardActivityIndicator card={card}/><span className="min-w-0 truncate">{card.title}</span></button><button title="Enviar para Inbox" onClick={()=>setTransfer(card)} className="rounded px-1 text-xs text-[#0c66e4] hover:bg-[#e9f2ff]">↗</button><select aria-label="Mover card" value={list.id} onChange={event=>void send('/cards/move','POST',{card_ids:[card.id],list_id:event.target.value}).then(load)} className="w-4 rounded border bg-white text-[9px]"><option value={list.id}>↔</option>{lists.filter(target=>target.id!==list.id).map(target=><option key={target.id} value={target.id}>{target.title}</option>)}</select></div>)}{list.cards.length===0&&<p className="px-2 py-1 text-[11px] text-[#626f86]">Nenhum card.</p>}</div>}{lists.filter(child=>child.parent_list_id===list.id).map(child=>render(child,depth+1))}</div>};
  const inbox=boards.find(board=>board.is_inbox);
  return <section className="pt-1"><div className="flex items-center justify-between px-2"><strong className="flex items-center gap-2 text-sm"><FolderOpen size={17}/> Coleções</strong><button onClick={()=>{setParentId('');setCategoryModal(true)}} className="text-[11px] font-semibold text-[#6554c0]">+ Categoria</button></div><form onSubmit={createCard} className="mt-2 px-2"><input value={cardTitle} onChange={event=>setCardTitle(event.target.value)} placeholder="Adicionar card" className="w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm"/></form>{collection?<div className="mt-2 max-h-[calc(100vh-230px)] overflow-y-auto px-1">{lists.filter(list=>!list.parent_list_id).map(list=>render(list))}{lists.length===0&&<p className="px-2 py-3 text-xs text-[#626f86]">Crie uma categoria para começar.</p>}</div>:<p className="px-2 py-3 text-xs text-[#626f86]">Carregando coleções…</p>}{selected&&collection&&<CardDialog card={selected} board={collection} onClose={()=>setSelected(null)} onChanged={async()=>{await load();setSelected(null)}} onDeleted={async()=>{setSelected(null);await load()}}/>}{transfer&&inbox&&<TransferCardModal card={transfer} target={inbox} label="Enviar para Inbox" onClose={()=>setTransfer(null)} onDone={async()=>{setTransfer(null);await load();window.dispatchEvent(new Event('data:changed'))}}/>}{categoryModal&&<Modal onClose={()=>setCategoryModal(false)}><form onSubmit={createCategory} className="p-5"><h2 className="pr-8 text-lg font-bold">Nova categoria</h2><input autoFocus value={categoryTitle} onChange={event=>setCategoryTitle(event.target.value)} placeholder="Nome da categoria" className="mt-4 w-full rounded border px-3 py-2 text-sm"/><label className="mt-3 block text-sm font-semibold">Categoria pai<select value={parentId} onChange={event=>setParentId(event.target.value)} className="mt-1 w-full rounded border px-3 py-2 text-sm"><option value="">Nenhuma (raiz)</option>{lists.map(list=><option key={list.id} value={list.id}>{list.title}</option>)}</select></label><button disabled={!categoryTitle.trim()} className="mt-4 w-full rounded bg-[#6554c0] px-4 py-2 text-sm font-semibold text-white">Criar</button></form></Modal>}{confirmationModal}</section>;
}

export function WorkspaceSidebar({ boards }: { boards: Board[]; activeId?: string; onCreate: ()=>void; onChoose: (id:string)=>void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pinned, setPinned] = useState(true);
  const [tab, setTab] = useState<'inbox'|'collections'>(pathname === '/collections' ? 'collections' : 'inbox');
  useEffect(() => {
    const sync = () => setPinned(localStorage.getItem('orbit_sidebar_pinned') !== 'false');
    sync(); window.addEventListener('sidebar:changed', sync);
    return () => window.removeEventListener('sidebar:changed', sync);
  }, []);
  return <aside aria-label="Menu lateral" className={`scrollbar-thin shrink-0 overflow-y-auto border-r border-[#dfe1e6] bg-white py-4 transition-[width] ${pinned?'w-[64px] px-2 lg:w-[300px] lg:px-3':'w-[56px] px-2'}`}>
    <div className="mb-3 flex gap-1"><button onClick={()=>setTab('inbox')} aria-pressed={tab === 'inbox'} aria-label="Aba Inbox" className={`flex h-9 flex-1 items-center justify-center rounded-lg ${tab === 'inbox' ? 'bg-[#e9f2ff] text-[#0c66e4]' : 'text-[#44546f] hover:bg-[#f1f2f4]'}`}><Inbox size={18}/><span className="ml-2 hidden text-sm font-semibold lg:inline">Inbox</span></button><button onClick={()=>setTab('collections')} aria-pressed={tab === 'collections'} aria-label="Aba Coleções" className={`flex h-9 flex-1 items-center justify-center rounded-lg ${tab === 'collections' ? 'bg-[#f0edff] text-[#6554c0]' : 'text-[#44546f] hover:bg-[#f1f2f4]'}`}><FolderOpen size={18}/><span className="ml-2 hidden text-sm font-semibold lg:inline">Coleções</span></button></div>
    {pinned && <div className="hidden lg:block">{tab === 'collections' ? <CollectionPanel boards={boards}/> : <InboxPanel boards={boards}/>}</div>}
    <section className={`${tab === 'collections' ? 'hidden' : 'mt-4 border-t border-[#dfe1e6] pt-3'}`}>
      {pinned&&<h2 className="mb-2 hidden px-2 text-xs font-bold uppercase tracking-wide text-[#626f86] lg:block">Seus quadros</h2>}
      <nav aria-label="Seus quadros" className="space-y-1">
        {boards.filter(board=>!board.is_inbox&&!board.is_collection).map(board=><button key={board.id} onClick={()=>router.push(`/board/${board.id}`)} title={board.title} className={`flex h-9 w-full items-center gap-2 rounded-lg text-left text-sm text-[#44546f] hover:bg-[#f1f2f4] ${pinned?'justify-center lg:justify-start lg:px-2':'justify-center'}`}>
          <span className="h-5 w-6 shrink-0 rounded" style={{background:board.background_image?`url("${board.background_image}") center/cover`:boardColors[board.background]||boardColors.blue}}/>
          {pinned&&<span className="hidden min-w-0 truncate lg:block">{board.title}</span>}
        </button>)}
        {pinned&&<button onClick={()=>router.push('/boards')} className="hidden w-full rounded-lg px-2 py-2 text-left text-xs font-semibold text-[#0c66e4] hover:bg-[#f1f2f4] lg:block">Ver todos os quadros</button>}
      </nav>
    </section>
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
