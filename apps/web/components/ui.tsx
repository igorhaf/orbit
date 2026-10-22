'use client';
import {RecordBoardContext} from '@/plugins/record-cards/RecordBoardContext';
import {RecordBoardModels,useRecordBoardScope} from '@/plugins/record-cards/RecordBoardModels';
import {PluginNavigation} from './plugin-navigation';
import {useCreationAvailability} from '@/plugins/project-boards/use-creation-availability';
import { usePluginAvailability } from '@/lib/plugin-availability';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Eye, EyeClosed, Bell, CalendarDays, Check, ChevronDown, FolderKanban, Home, LayoutDashboard, LogOut, Wrench, Menu, DatabaseBackup, Archive,
  Moon, Search, Settings, Star, Sun, Undo2, Redo2, UserRound,
  X, Pin, PinOff, CreditCard, CheckSquare, Inbox, NotebookPen, Vault, FolderOpen, GripVertical, MoreHorizontal, Paintbrush,
} from 'lucide-react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  api, send, AppNotification, Board, Card, SearchResults, ToolDiagnostics, User,
  boardColors, cardUrl, clearSession, getUser, initials, setUser,
} from '@/lib/api';
import { historyState, redo, remember, undo } from '@/lib/history';
import { CodexLimitsBar } from './codex-limits';
import { CardDialog } from './card-dialog';
import { CardActivityIndicator } from './card-execution';
import { io } from 'socket.io-client';

const CollectionPanel=dynamic(()=>import('@/plugins/collections/CollectionPanel').then(module=>module.CollectionPanel));

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
const subscribeFavoriteIds = (callback: () => void) => {
  window.addEventListener('storage', callback);
  window.addEventListener('sidebar:favorite-order-changed', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('sidebar:favorite-order-changed', callback);
  };
};
const getFavoriteIdsSnapshot = (): string => {
  return localStorage.getItem('orbit_sidebar_favorite_ids') || '';
};
const getFavoriteIdsServerSnapshot = (): string => '';

export function Modal({ children, onClose, wide = false, extraWide = false, sidePanel = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean; extraWide?: boolean; sidePanel?: boolean }) {
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
  return createPortal(<div className={sidePanel?"fixed inset-0 z-50 overflow-hidden bg-[#091e4240]":"fixed inset-0 z-50 flex min-h-full items-center justify-center overflow-y-auto bg-[#091e42b8] p-2 backdrop-blur-[3px] sm:p-6"} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div onMouseDown={e => e.stopPropagation()} data-side-panel={sidePanel||undefined} className={sidePanel?'side-panel-in fixed inset-y-0 right-0 flex h-dvh w-full min-w-0 max-w-[900px] flex-col overflow-hidden border-l border-[#dfe1e6] bg-white shadow-dialog':`fade-in relative max-h-[calc(100dvh-1rem)] w-full overflow-y-auto ${extraWide ? 'max-w-[1350px]' : wide ? 'max-w-[820px]' : 'max-w-[560px]'} rounded-xl border border-[#dfe1e6] bg-white shadow-dialog sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl`} role="dialog" aria-modal="true">
      {sidePanel?<div data-side-panel-content className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">{children}</div>:children}
      <button aria-label="Fechar" onClick={onClose} className={`absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#626f86] transition-colors hover:bg-[#f1f2f4] hover:text-[#172b4d] ${sidePanel?'z-10 border border-[#dfe1e6] bg-white shadow-sm':''}`}><X size={20}/></button>
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
  return <button onClick={onClick} className="group relative flex h-[112px] w-full flex-col overflow-hidden rounded-[5px] p-3 text-left text-white shadow-sm transition hover:brightness-90" style={{background:board.background_image ? `linear-gradient(#0005,#0005),url("${board.background_image}") center/cover` : boardColors[board.background] || boardColors.blue}}>
    <span className="relative z-10 rounded bg-black/35 px-1.5 py-1 text-[10px] font-semibold">{total} cartões</span>
    <strong className="relative z-10 mt-auto max-w-[90%] truncate text-[16px] leading-5">{board.title}</strong>
    <span className="absolute -bottom-6 -right-6 h-28 w-28 rounded-full bg-white/10"/>
    <span className="absolute -top-10 right-8 h-28 w-28 rounded-full bg-white/5"/>
    {board.starred && <Star size={15} fill="currentColor" className="absolute bottom-3 right-3"/>}
  </button>;
}

function NotificationPanel({ items, onRead, onReadAll, onClearAll, onChoose }: {
  items: AppNotification[];
  onRead: (id: string) => void;
  onReadAll: () => void;
  onClearAll: () => void;
  onChoose: (item: AppNotification) => void;
}) {
  return <div className="absolute right-0 top-full z-40 w-[min(390px,calc(100vw-16px))] overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-dialog">
    <div className="flex items-center justify-between gap-2 border-b border-[#dfe1e6] px-4 py-3"><h3 className="font-bold">Notificações</h3><div className="flex items-center gap-3"><button onClick={onReadAll} disabled={!items.some(item => !item.read_at)} className="text-xs font-semibold text-[#0c66e4] hover:underline disabled:cursor-default disabled:opacity-50">Marcar todas como lidas</button><button onClick={onClearAll} disabled={items.length === 0} className="text-xs font-semibold text-[#c9372c] hover:underline disabled:cursor-default disabled:opacity-50">Limpar todas</button></div></div>
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
  const [limitsVisible,setLimitsVisible]=useState(false);
  const [aiAvailable,setAiAvailable]=useState(false);
  const {enabled:pluginEnabled,processBoards:pluginBoards,navigation} = usePluginAvailability();
  const collectionsAvailable=pluginEnabled('collections');
  const {canCreateBoard,canCreateProject,boardCreators}=useCreationAvailability();
  const router = useRouter();
  const [user, updateUser] = useState<User | null>(initialUser);
  const userId=user?.id;
  const [previousUser, setPreviousUser] = useState(initialUser);
  if (initialUser !== previousUser) {
    setPreviousUser(initialUser);
    updateUser(initialUser);
  }
  const [panel, setPanel] = useState<'search'|'boards'|'create'|'notifications'|'account'|'mobile'|null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const boardsMenuRef = useRef<HTMLDivElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const notificationsMenuRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchResponse, setSearchResponse] = useState<{query:string; data:SearchResults}>({query:'',data:{boards:[],lists:[],cards:[]}});
  const results = panel === 'search' && query.trim().length >= 2 && searchResponse.query === query
    ? {...searchResponse.data,boards:searchResponse.data.boards.filter(board=>!board.is_inbox&&!board.is_collection)} : {boards:[],lists:[],cards:[]};
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationToast, setNotificationToast] = useState<{title:string;body:string}|null>(null);
  const [toastFading, setToastFading] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pinned, setPinned] = useState(true);
  const [history, setHistory] = useState(historyState());
  const [message, setMessage] = useState('');
  const [toolStatus,setToolStatus]=useState<{userId:string;status:ToolDiagnostics['status']}|null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedNotifications = useRef(false);
  const knownNotifications = useRef(new Set<string>());
  const syncNotifications = useCallback((items: AppNotification[]) => {
    if (initializedNotifications.current) {
      const fresh = items.filter(item => !item.read_at && !knownNotifications.current.has(item.id));
      if (fresh.length) {
        const item = fresh[0];
        setNotificationToast({title:item.title,body:item.body || item.board_title || ''});
        setToastFading(false);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        if (toastDismissTimer.current) clearTimeout(toastDismissTimer.current);
        toastTimer.current = setTimeout(() => setToastFading(true), 2200);
        toastDismissTimer.current = setTimeout(() => setNotificationToast(null), 3000);
      }
    }
    items.forEach(item => knownNotifications.current.add(item.id));
    initializedNotifications.current = true;
    setNotifications(items);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (toastDismissTimer.current) clearTimeout(toastDismissTimer.current);
  }, []);

  useEffect(()=>{
    if(!userId)return;
    let active=true;
    const refresh=()=>void api<{plugins:Array<{id:string;enabled:boolean}>}>('/plugins').then(({plugins})=>{if(active)setAiAvailable(plugins.some(plugin=>plugin.id==='ai'&&plugin.enabled))}).catch(()=>{if(active)setAiAvailable(false)});
    refresh();window.addEventListener('plugins:changed',refresh);
    return()=>{active=false;window.removeEventListener('plugins:changed',refresh)};
  },[userId]);


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

  useEffect(()=>{
    if(!user||!aiAvailable)return;
    let active=true;
    const refresh=()=>void api<ToolDiagnostics>('/tools/diagnostics').then(result=>{if(active)setToolStatus({userId:user.id,status:result.status})}).catch(()=>undefined);
    refresh();
    const timer=window.setInterval(refresh,15_000);
    return()=>{active=false;window.clearInterval(timer)};
  },[user,aiAvailable]);
  const currentToolStatus=aiAvailable&&toolStatus&&toolStatus.userId===user?.id?toolStatus.status:null;
  useEffect(() => {
    if (!user) return;
    let active = true;
    const refresh = () => {
      void api<AppNotification[]>('/notifications').then(items => {
        if (active) syncNotifications(items);
      }).catch(() => undefined);
    };
    const socket = io({ path: '/socket.io', auth: { token: localStorage.getItem('orbit_token') || '' } });
    socket.on('notification:changed', refresh);
    const pluginsChanged=()=>window.dispatchEvent(new Event('plugins:changed'));
    socket.on('plugins:changed',pluginsChanged);
    socket.on('connect',pluginsChanged);
    return () => { active = false; socket.disconnect(); };
  }, [user, syncNotifications]);
  useEffect(() => {
    if (panel !== 'search' || query.trim().length < 2) return;
    const timer = window.setTimeout(() => api<SearchResults>(`/search?q=${encodeURIComponent(query)}`)
      .then(data => setSearchResponse({query,data}))
      .catch(() => setSearchResponse({query,data:{boards:[],lists:[],cards:[]}})), 220);
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
        const newItems = initializedNotifications.current ? items.filter(item => !item.read_at && !knownNotifications.current.has(item.id)) : [];
        syncNotifications(items);
        const canNotify = initializedNotifications.current && user.preferences?.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted';
        if (canNotify) newItems.forEach(item => new Notification(item.title, { body: item.body || item.board_title || '' }));
      } catch { /* The page stays usable if notifications cannot load. */ }
    };
    poll();
    const timer = window.setInterval(poll, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user, syncNotifications]);
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
  async function clearAllNotifications() {
    await send('/notifications', 'DELETE');
    setNotifications([]);
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
  function openBoard(id: string) { setPanel(null); if(window.location.pathname!==`/board/${id}`)router.push(`/board/${id}`); }
  function openList(boardId:string,listId:string) { setPanel(null); router.push(`/board/${boardId}?list=${encodeURIComponent(listId)}`); }
  const unread = notifications.filter(item => !item.read_at).length;
  const canUse=(permission:string)=>Boolean(user?.is_root||user?.permissions?.includes(permission));
  const mobileLinks = [
    {label:'Home',href:'/',icon:Home},
    {label:'Quadros',href:'/boards',icon:LayoutDashboard},
    ...(canUse('calendar.read')?[{label:'Calendário',href:'/calendar',icon:CalendarDays}]:[]),
    ...(pluginEnabled('planner')?[{label:'Planner',href:'/planner',icon:CalendarDays}]:[]),
    {label:'Inbox',href:'/inbox',icon:Inbox},
    ...(collectionsAvailable?[{label:'Coleções',href:'/collections',icon:FolderOpen}]:[]),
    ...(canUse('notebooks.read')?[{label:'Cadernos',href:'/notebooks',icon:NotebookPen}]:[]),
    ...(pluginEnabled('vault','vault.read')?[{label:'Cofre',href:'/vault',icon:Vault}]:[]),
    ...(canUse('backups.read')?[{label:'Backups',href:'/backups',icon:DatabaseBackup}]:[]),
    ...(aiAvailable?[{label:'Ferramentas',href:'/tools',icon:Wrench}]:[]),
    ...(canUse('plugins.read')?[{label:'Plugins',href:'/plugins',icon:FolderKanban}]:[]),
    ...(user?.is_root||user?.permissions?.includes('access.manage')?[{label:'Acessos · RBAC',href:'/access',icon:Settings}]:[]),
    {label:'Perfil e configurações',href:'/profile',icon:Settings},
    {label:'Lixeira',href:'/trash',icon:Archive},
  ];
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

  return <>{notificationToast && <div role="status" aria-live="polite" className={`fixed right-4 top-4 z-[60] w-[min(360px,calc(100vw-32px))] rounded-lg border border-[#dfe1e6] bg-white p-3 shadow-dialog transition-all duration-500 ${toastFading ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'}`}><div className="flex items-start gap-2"><Bell size={17} className="mt-0.5 shrink-0 text-[#0c66e4]"/><span className="min-w-0"><strong className="block truncate text-sm">{notificationToast.title}</strong>{notificationToast.body && <span className="mt-0.5 block truncate text-xs text-[#626f86]">{notificationToast.body}</span>}</span></div></div>}<header className="relative z-30 flex min-h-14 shrink-0 flex-wrap items-center gap-1.5 border-b border-[#dfe1e6] bg-white px-3 py-1 sm:gap-2 sm:px-4">
    <button onClick={() => router.push('/')} className="flex items-center gap-2 rounded px-1 py-1 text-[#172b4d] hover:bg-[#f1f2f4]" title="Home">
      <span className="flex h-7 w-7 items-center justify-center rounded bg-[#0c66e4] text-white"><LayoutDashboard size={19} strokeWidth={2.8}/></span>
      <span className="hidden text-[21px] font-extrabold tracking-[-1px] sm:inline">Orbit</span>
    </button>
    <nav className="ml-1 hidden items-center gap-1 lg:flex">
      <button onClick={() => router.push('/')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Home</button>
      <div ref={boardsMenuRef} className="relative" onMouseLeave={() => { if (panel === 'boards') setPanel(null); }}>
        <button onClick={() => setPanel(panel === 'boards' ? null : 'boards')} aria-expanded={panel === 'boards'} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Quadros <ChevronDown size={13} className="inline"/></button>
        {panel === 'boards' && <div className="absolute left-0 top-full z-40 w-72 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
          <div className="flex items-center justify-between px-2 py-2"><strong className="text-sm">Alternar quadro</strong><button onClick={togglePin} className="rounded p-1 text-[#626f86] hover:bg-[#f1f2f4]" title={pinned ? 'Desafixar painel lateral' : 'Fixar painel lateral'}>{pinned ? <PinOff size={16}/> : <Pin size={16}/>}</button></div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar quadro" className="mb-2 w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm"/>
          <div className="scrollbar-thin max-h-64 overflow-y-auto">{pluginBoards.filter(board=>board.name.toLowerCase().includes(query.toLowerCase())).map(board=><button key={board.id} onClick={()=>{setPanel(null);router.push(board.href)}} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={18} className="shrink-0"/><span className="truncate">{board.name}</span></button>)}{boardMatches.map(board => <button key={board.id} onClick={() => openBoard(board.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[#f1f2f4]"><span className="h-5 w-7 shrink-0 rounded" style={{background:boardColors[board.background]}}/><span className="min-w-0 flex-1 truncate">{board.title}</span>{board.starred && <Star size={13} fill="currentColor" className="text-[#e2b203]"/>}</button>)}</div>
          <button onClick={() => { setPanel(null); router.push('/boards'); }} className="mt-2 w-full border-t border-[#dfe1e6] px-2 py-2 text-left text-sm font-semibold text-[#0c66e4]">Ver todos os quadros</button>
        </div>}
      </div>
      {canUse('calendar.read')&&<button onClick={() => router.push('/calendar')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><CalendarDays size={15} className="mr-1 inline"/>Calendário</button>}
      {aiAvailable&&<button onClick={() => router.push('/tools')} title={currentToolStatus==='error'?'O último prompt falhou por causa de uma ferramenta.':currentToolStatus==='running'?'Aguardando o fim do prompt para verificar as ferramentas.':'Ferramentas sem falha detectada no último prompt.'} className="flex items-center gap-1.5 rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><Wrench size={15}/>Ferramentas<span aria-hidden="true" className={`h-2 w-2 rounded-full ${currentToolStatus==='error'?'bg-[#de350b]':currentToolStatus==='success'?'bg-[#22a06b]':currentToolStatus==='running'?'animate-pulse bg-[#579dff]':'bg-[#8590a2]'}`}/></button>}
      <PluginNavigation menus={navigation.menus} standalone={navigation.standalone}/>
      {canUse('notebooks.read')&&<button onClick={() => router.push('/notebooks')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><NotebookPen size={15} className="mr-1 inline"/>Cadernos</button>}
      {pluginEnabled('vault','vault.read')&&<button onClick={() => router.push('/vault')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><Vault size={15} className="mr-1 inline"/>Cofre</button>}
      {(user?.is_root||user?.permissions?.includes('access.manage'))&&<button onClick={()=>router.push('/access')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Acessos {user?.is_root&&<span className="text-xs text-[#0c66e4]">ROOT</span>}</button>}
      {canUse('plugins.read')&&<button onClick={() => router.push('/plugins')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Plugins</button>}
    </nav>
<button
  onClick={() => router.push('/boards')}
  className="min-h-11 min-w-11 rounded p-2 text-[#44546f] hover:bg-[#f1f2f4] lg:hidden"
  title="Quadros"
>
  <LayoutDashboard size={19}/>
</button>
<button onClick={() => router.push('/')} className="min-h-11 min-w-11 rounded p-2 text-[#44546f] hover:bg-[#f1f2f4] lg:hidden" title="Home"><Home size={19}/></button>
{aiAvailable&&<button onClick={() => router.push('/tools')} className="relative min-h-11 min-w-11 rounded p-2 text-[#44546f] hover:bg-[#f1f2f4] lg:hidden" title="Ferramentas" aria-label="Ferramentas"><Wrench size={19}/><span aria-hidden="true" className={`absolute right-1 top-1 h-2 w-2 rounded-full ${currentToolStatus==='error'?'bg-[#de350b]':currentToolStatus==='success'?'bg-[#22a06b]':currentToolStatus==='running'?'animate-pulse bg-[#579dff]':'bg-[#8590a2]'}`}/></button>}
<div className="relative lg:hidden"><button onClick={() => setPanel(panel==='mobile'?null:'mobile')} aria-label="Abrir navegação" aria-expanded={panel==='mobile'} className="min-h-11 min-w-11 rounded p-2 text-[#44546f] hover:bg-[#f1f2f4]"><Menu size={19}/></button>{panel==='mobile'&&<nav aria-label="Navegação principal" className="fixed left-2 right-2 top-[calc(3.5rem+env(safe-area-inset-top))] z-[60] grid max-h-[min(70dvh,560px)] w-auto translate-x-0 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-[#dfe1e6] bg-white p-2 shadow-dialog sm:grid-cols-3">{mobileLinks.map(item=><button key={`${item.href}:${item.label}`} onClick={()=>{setPanel(null);router.push(item.href)}} className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold hover:bg-[#f1f2f4]"><item.icon size={17} className="shrink-0 text-[#6554c0]"/><span className="min-w-0 break-words">{item.label}</span></button>)}<PluginNavigation menus={navigation.menus} standalone={navigation.standalone} mobile onNavigate={()=>setPanel(null)}/></nav>}</div>
    {(canCreateBoard||canCreateProject||boardCreators.length>0)&&<div ref={createMenuRef} className="relative ml-1">
      <button onClick={() => setPanel(panel === 'create' ? null : 'create')} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0055cc]">Criar</button>
      {panel === 'create' && <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
        {boardCreators.map(item=><button key={item.id} onClick={()=>{setPanel(null);router.push(item.href)}} className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={16}/>{item.name}</button>)}
        {canCreateBoard&&<button onClick={() => { setPanel(null); if (onCreate) { onCreate(); } else { router.push('/boards?create=1'); } }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><LayoutDashboard size={16}/> Criar quadro</button>}
        {canCreateProject&&<button onClick={() => { setPanel(null); router.push('/profile?tab=projects'); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={16}/> Criar projeto</button>}
      </div>}
    </div>}
    {aiAvailable&&<button onClick={()=>setLimitsVisible(value=>!value)} aria-label={limitsVisible?'Recolher barra da fila':'Mostrar barra da fila'} aria-expanded={limitsVisible} aria-controls="codex-limits-bar" className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold hover:bg-[#f1f2f4]">{limitsVisible?<Eye size={17}/>:<EyeClosed size={17}/>}{user?.is_root?'Limites':'Fila'}</button>}
    <div className="flex-1"/>
    <button onClick={() => undo().catch(error => setMessage((error as Error).message))} disabled={!history.canUndo} aria-label="Desfazer" aria-keyshortcuts="Control+Z Meta+Z" className="rounded p-1.5 text-[#44546f] hover:bg-[#f1f2f4] disabled:cursor-not-allowed disabled:opacity-35" title={`${history.undoLabel ? `Desfazer: ${history.undoLabel}` : 'Desfazer'} (Ctrl/Cmd+Z)`}><Undo2 size={18}/></button>
    <button onClick={() => redo().catch(error => setMessage((error as Error).message))} disabled={!history.canRedo} aria-label="Refazer" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" className="rounded p-1.5 text-[#44546f] hover:bg-[#f1f2f4] disabled:cursor-not-allowed disabled:opacity-35" title={`${history.redoLabel ? `Refazer: ${history.redoLabel}` : 'Refazer'} (Ctrl/Cmd+Shift+Z ou Ctrl/Cmd+Y)`}><Redo2 size={18}/></button>
    <button onClick={() => setPanel('search')} className="flex items-center gap-2 rounded border border-transparent p-2 text-[#44546f] hover:bg-[#f1f2f4] sm:w-44 sm:border-[#8590a2] sm:px-3 sm:py-1.5" aria-label="Pesquisar em todos os quadros"><Search size={17}/><span className="hidden text-sm text-[#626f86] sm:inline">Pesquisar</span></button>
    <div ref={notificationsMenuRef} className="relative" onMouseLeave={() => { if (panel === 'notifications') setPanel(null); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPanel(null); }}>
    <button onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} aria-expanded={panel === 'notifications'} className="relative rounded-full p-2 text-[#44546f] hover:bg-[#f1f2f4]" title="Notificações"><Bell size={19}/>{unread > 0 && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-[#e5484d] px-0.5 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}</button>
    {panel === 'notifications' && <NotificationPanel items={notifications} onRead={id => markRead(id).catch(() => {})} onReadAll={() => markAll().catch(() => {})} onClearAll={() => clearAllNotifications().catch(() => {})} onChoose={chooseNotification}/>}
    </div>
    <div ref={accountMenuRef} className="relative" onMouseLeave={() => { if (panel === 'account') setPanel(null); }}>
    <button onClick={() => setPanel(panel === 'account' ? null : 'account')} title="Conta" aria-expanded={panel === 'account'} className="rounded-full"><Avatar name={user?.name || 'Igor'} url={user?.avatar_url}/></button>

    {panel === 'search' && <div className="absolute left-2 right-2 top-12 z-40 overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-dialog sm:left-auto sm:right-28 sm:w-[430px]">
      <div className="flex items-center gap-2 border-b border-[#dfe1e6] px-3 py-2"><Search size={17} className="text-[#626f86]"/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar cartões e quadros..." className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none"/><button onClick={() => setPanel(null)}><X size={17}/></button></div>
      <div className="scrollbar-thin max-h-[380px] overflow-y-auto p-2">{query.trim().length < 2 ? <p className="p-4 text-center text-xs text-[#626f86]">Digite pelo menos 2 caracteres para buscar em todos os quadros.</p> : <>
        {results.boards.length > 0 && <p className="px-2 py-1 text-[11px] font-bold uppercase text-[#626f86]">Quadros</p>}
        {results.boards.map(board => <button key={board.id} aria-label={`Abrir quadro ${board.title}`} onClick={() => openBoard(board.id)} className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-[#f1f2f4]"><span className="h-6 w-8 rounded" style={{background:boardColors[board.background]}}/><span className="flex-1 truncate">{board.title}</span></button>)}
        {(results.lists||[]).length > 0 && <p className="mt-2 px-2 py-1 text-[11px] font-bold uppercase text-[#626f86]">Listas</p>}
        {(results.lists||[]).map(list => <button key={list.id} aria-label={`Abrir lista ${list.title} no quadro ${list.board_title}`} onClick={() => openList(list.board_id,list.id)} className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-[#f1f2f4]"><span className="h-6 w-8 rounded" style={{background:boardColors[list.background]}}/><span className="min-w-0 flex-1 truncate">{list.title}</span><span className="max-w-24 truncate text-xs text-[#626f86]">{list.board_title}</span></button>)}
        {results.cards.length > 0 && <p className="mt-2 px-2 py-1 text-[11px] font-bold uppercase text-[#626f86]">Cartões</p>}
        {results.cards.map(card => <button key={card.id} aria-label={`Abrir cartão ${card.title} no quadro ${card.board_title}`} onClick={() => { setPanel(null); const params=new URLSearchParams({card:card.id}); if(card.url_token)params.set('token',card.url_token); if(card.list_id)params.set('list',card.list_id); router.push(`/board/${card.board_id}?${params}`); }} className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-[#f1f2f4]"><CreditCard size={16}/><span className="min-w-0 flex-1 truncate">{card.title}</span><span className="max-w-24 truncate text-xs text-[#626f86]">{card.board_title}</span></button>)}
        {!results.boards.length && !(results.lists||[]).length && !results.cards.length && <p className="p-4 text-center text-xs text-[#626f86]">Nenhum resultado encontrado.</p>}
        <button onClick={() => { setPanel(null); router.push(`/search?q=${encodeURIComponent(query)}`); }} className="mt-2 w-full border-t border-[#dfe1e6] px-3 py-2 text-left text-xs font-semibold text-[#0c66e4]">Abrir busca avançada</button>
      </>}</div>
    </div>}
    {panel === 'account' && <div className="absolute right-0 top-full z-40 w-64 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
      <div className="border-b border-[#dfe1e6] px-3 py-2"><p className="text-[11px] font-bold uppercase tracking-wide text-[#626f86]">Conta</p><div className="mt-2 flex items-center gap-2"><Avatar name={user?.name || 'Igor'} url={user?.avatar_url}/><div className="min-w-0"><p className="truncate text-sm font-semibold">{user?.name}</p><p className="truncate text-xs text-[#626f86]">{user?.email}</p></div></div></div>
      {(user?.is_root||user?.permissions?.includes('access.manage'))&&<button onClick={()=>{setPanel(null);router.push('/access')}} className="min-h-11 w-full rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]">Acessos e perfis {user?.is_root?'· ROOT':''}</button>}
      <button onClick={() => {setPanel(null);router.push('/profile')}} className="mt-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><UserRound size={16}/> Perfil e atividade</button>
      <button onClick={() => {setPanel(null);router.push('/profile?tab=cards')}} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><CheckSquare size={16}/> Cartões atribuídos</button>
      <button onClick={() => {setPanel(null);router.push('/profile?tab=settings')}} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><Settings size={16}/> Configurações</button>
      <button onClick={toggleTheme} className="theme-preference-control flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]">{user?.preferences?.theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>} {user?.preferences?.theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</button>
      <button onClick={() => {clearSession();setPanel(null);router.push('/');router.refresh();}} className="mt-1 flex w-full items-center gap-2 border-t border-[#dfe1e6] px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><LogOut size={16}/> Sair</button>
    </div>}
    </div>
  </header>{aiAvailable&&<CodexLimitsBar visible={limitsVisible} isRoot={user?.is_root===true}/>}{message && <div role="alert" className="relative z-20 flex w-full shrink-0 items-center gap-2 border-b border-[#f5c2b7] bg-[#ffebe6] px-4 py-2 text-sm text-[#ae2a19] shadow-sm"><button className="shrink-0 rounded p-1 hover:bg-[#f5c2b7]" onClick={() => setMessage('')} aria-label="Fechar aviso"><X size={14}/></button><span className="min-w-0 break-words">{message}</span></div>}</>;
}

type AssignedInboxCard={id:string;title:string;board_id:string;board_title:string};
function InboxPanel({boards,dropId='inbox:panel'}:{boards:Board[];dropId?:string}) {
  const [inbox,setInbox]=useState<Board|null>(null),[assigned,setAssigned]=useState<AssignedInboxCard[]>([]);
  const [selected,setSelected]=useState<{card:Card;board:Board}|null>(null);
  const [title,setTitle]=useState(''),[error,setError]=useState(''),[transfer,setTransfer]=useState<Card|null>(null);
  const inboxId=boards.find(board=>board.is_inbox)?.id;
  const {setNodeRef:setInboxDropRef,isOver:isInboxOver}=useDroppable({id:dropId,data:{type:'inbox'}});
  const load=useCallback(async()=>{try{const [full,assigned]=await Promise.all([inboxId?api<Board>(`/boards/${inboxId}`):Promise.resolve(null),api<AssignedInboxCard[]>('/inbox/cards')]);setInbox(full);setAssigned(assigned);setError('')}catch(err){setError((err as Error).message)}},[inboxId]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const refresh=()=>void load();window.addEventListener('data:changed',refresh);return()=>{window.clearTimeout(timer);window.removeEventListener('data:changed',refresh)}},[load]);
  useEffect(()=>{const socket=io({path:'/socket.io',auth:{token:localStorage.getItem('orbit_token')||''}});socket.on('connect',()=>{if(inboxId)socket.emit('board:join',inboxId)});const refresh=()=>void load();socket.on('board:changed',refresh);socket.on('comment:changed',refresh);socket.on('prompt:progress',refresh);socket.on('notification:changed',refresh);socket.on('plugins:changed',refresh);socket.on('connect',refresh);return()=>{socket.disconnect()}},[inboxId,load]);
  useEffect(()=>{
    const over=(event:DragEvent)=>{if(event.dataTransfer?.types.includes('application/x-orbit-inbox-card')&&event.dataTransfer?.types.includes('application/x-orbit-inbox-owned'))event.preventDefault()};
    const drop=async(event:DragEvent)=>{const source=event.dataTransfer?.getData('application/x-orbit-inbox-card'),owned=event.dataTransfer?.getData('application/x-orbit-inbox-owned');const target=(event.target as Element|null)?.closest('[data-orbit-list]')?.getAttribute('data-orbit-list');if(!source||owned!=='1'||!target)return;event.preventDefault();try{await send('/cards/move','POST',{card_ids:[source],list_id:target});await load();window.dispatchEvent(new Event('data:changed'))}catch(err){setError((err as Error).message)}};
    document.addEventListener('dragover',over);document.addEventListener('drop',drop);return()=>{document.removeEventListener('dragover',over);document.removeEventListener('drop',drop)};
  },[load]);
  async function open(entry:AssignedInboxCard){try{const board=await api<Board>(`/boards/${entry.board_id}`);const card=board.lists?.flatMap(list=>list.cards).find(card=>card.id===entry.id);if(!card)throw new Error('Cartão não encontrado no quadro de origem.');setSelected({board,card});setError('')}catch(error){setError((error as Error).message)}}
  async function refreshSelected(){await load();if(selected)await open({id:selected.card.id,title:selected.card.title,board_id:selected.board.id,board_title:selected.board.title})}
  const ownCards=inbox?.lists?.flatMap(list=>list.cards)||[],ownedIds=new Set(ownCards.map(card=>card.id));
  const entries=[...ownCards.map(card=>({id:card.id,title:card.title,board_id:inbox!.id,board_title:'Inbox',card})),...assigned.filter(card=>!ownedIds.has(card.id)).map(card=>({...card,card:undefined}))];
  const collection=boards.find(board=>board.is_collection);
  return <><section ref={setInboxDropRef} data-orbit-inbox-drop className={`rounded-lg pt-1 ${isInboxOver?'bg-[#e9f2ff] ring-2 ring-[#0c66e4]':''}`}><p className="px-2 text-xs text-[#626f86]">Solte um cartão aqui para atribuir a você e acompanhá-lo no Inbox.</p><form onSubmit={async event=>{event.preventDefault();const list=inbox?.lists?.[0];if(!title.trim()||!list)return;try{await send(`/lists/${list.id}/cards`,'POST',{title});setTitle('');await load()}catch(err){setError((err as Error).message)}}} className="mt-2 px-2"><input disabled={!inbox?.lists?.[0]} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Adicionar um cartão" className="w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm disabled:opacity-50"/></form><div className="mt-2 max-h-[calc(100vh-190px)] space-y-2 overflow-y-auto px-2">{entries.map(entry=><div key={entry.id} className="flex items-center gap-1 rounded bg-[#f1f2f4] px-2 py-1 shadow-sm"><button draggable onDragStart={event=>{event.dataTransfer.setData('application/x-orbit-inbox-card',entry.id);event.dataTransfer.setData('application/x-orbit-inbox-title',entry.title);if(entry.card)event.dataTransfer.setData('application/x-orbit-inbox-owned','1');event.dataTransfer.effectAllowed=entry.card?'move':'copyMove'}} onClick={()=>void open(entry)} className="min-h-11 min-w-0 flex-1 py-1 text-left text-sm hover:bg-[#e9eaed]"><span className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{entry.title}</span>{entry.card&&<CardActivityIndicator card={entry.card}/>}</span>{!entry.card&&<span className="block truncate text-[11px] text-[#626f86]">{entry.board_title} · atribuído a você</span>}</button>{collection&&entry.card&&<button title="Enviar para Coleções" onClick={()=>setTransfer(entry.card!)} className="rounded px-1 text-xs text-[#6554c0] hover:bg-[#e2dffc]">↗</button>}</div>)}{!entries.length&&<p className="py-3 text-xs text-[#626f86]">Sem itens</p>}</div>{error&&<p role="alert" className="px-2 pt-2 text-xs text-[#ae2a19]">{error}</p>}<p className="px-2 pt-2 text-[11px] text-[#626f86]">Os cartões atribuídos permanecem no seu quadro de origem.</p></section>{selected&&<CardDialog key={selected.card.id} card={selected.card} board={selected.board} recordContent={selected.board.record_scope&&selected.card.id===selected.board.record_scope.primary_card_id?<RecordBoardContext scope={selected.board.record_scope} onChanged={refreshSelected}/>:undefined} onClose={()=>setSelected(null)} onChanged={refreshSelected} onDeleted={async()=>{setSelected(null);await load()}}/>}{transfer&&collection&&<TransferCardModal card={transfer} target={collection} label="Enviar para Coleções" onClose={()=>setTransfer(null)} onDone={async()=>{setTransfer(null);await load();window.dispatchEvent(new Event('data:changed'))}}/>}</>;
}

export function TransferCardModal({card,target,label,onClose,onDone}:{card:Card;target:Board;label:string;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [listId,setListId]=useState(target.lists?.[0]?.id||''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(){if(!listId)return;setBusy(true);try{await send('/cards/move','POST',{card_ids:[card.id],list_id:listId});await onDone()}catch(err){setError((err as Error).message)}finally{setBusy(false)}}
  return <Modal onClose={onClose}><div className="p-5"><h2 className="text-lg font-bold">{label}</h2><p className="mt-1 text-sm text-[#626f86]">Escolha a categoria de destino.</p><select value={listId} onChange={event=>setListId(event.target.value)} className="mt-4 w-full rounded border p-2 text-sm">{target.lists?.map(list=><option key={list.id} value={list.id}>{list.title}</option>)}</select>{error&&<p className="mt-2 text-xs text-[#ae2a19]">{error}</p>}<button disabled={busy||!listId} onClick={()=>void submit()} className="mt-4 rounded bg-[#6554c0] px-4 py-2 text-sm font-semibold text-white">{busy?'Enviando…':'Enviar cartão'}</button></div></Modal>;
}

function SortableFavoriteBoard({ board, pinned, onChoose, onBackground, onToggleStar }: { board: Board; pinned: boolean; onChoose: (id: string) => void; onBackground: (id: string) => void; onToggleStar: (board: Board) => void }) {
  const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging} = useSortable({id:board.id});
  const [menu,setMenu] = useState(false);
  return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} className={`group relative flex h-9 items-center gap-1 rounded-lg text-sm text-[#44546f] hover:bg-[#f1f2f4] ${pinned?'lg:px-2':''} ${isDragging?'z-10 bg-white shadow-md':''}`}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Reordenar ${board.title}`} title="Arraste para reordenar" className="flex w-3 shrink-0 cursor-grab items-center justify-center text-[#8590a2] active:cursor-grabbing"><GripVertical size={14}/></button>
    <button onClick={() => onChoose(board.id)} title={board.title} aria-label={`${board.title}, favorito`} className={`flex h-full min-w-0 flex-1 items-center gap-2 text-left ${pinned?'justify-center lg:justify-start':''}`}>
      <span className="relative h-5 w-6 shrink-0 rounded" style={{background:board.background_image?`url("${board.background_image}") center/cover`:boardColors[board.background]||boardColors.blue}}/>
      {pinned&&<><span className="hidden min-w-0 flex-1 truncate lg:block">{board.title}</span><Star size={14} fill="currentColor" className="hidden shrink-0 text-[#e2b203] lg:block"/></>}
    </button>
    <button hidden={Boolean(board.record_scope)} type="button" title={`Menu de ${board.title}`} aria-label={`Menu de ${board.title}`} aria-expanded={menu} onClick={event=>{event.stopPropagation();setMenu(!menu)}} className="pointer-events-none absolute right-1 grid h-7 w-7 place-items-center rounded bg-white/90 opacity-0 hover:bg-[#dfe1e6] focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto"><MoreHorizontal size={17}/></button>
    {menu&&<div className="absolute right-1 top-8 z-40 w-52 rounded-lg border border-[#dfe1e6] bg-white p-1.5 text-sm text-[#172b4d] shadow-dialog"><button type="button" onClick={()=>{setMenu(false);onToggleStar(board)}} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#f1f2f4]"><Star size={16} fill="currentColor" className="text-[#e2b203]"/> Remover estrela</button><button type="button" onClick={()=>{setMenu(false);onBackground(board.id)}} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#f1f2f4]"><Paintbrush size={16}/> Trocar cor de fundo</button></div>}
  </div>;
}

function BoardBackgroundPopup({ board, onClose, onChanged }: { board: Board; onClose: () => void; onChanged: (background: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(background: string) {
    setBusy(true);
    setError('');
    try {
      await send(`/boards/${board.id}`, 'PATCH', { background });
      if (board.background_image) await send(`/boards/${board.id}/background`, 'DELETE');
      onChanged(background);
      onClose();
      window.dispatchEvent(new Event('data:changed'));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <Modal onClose={onClose}><div className="w-[min(92vw,400px)] p-6"><h2 className="mb-1 pr-8 text-lg font-bold">Plano de fundo</h2><p className="mb-4 text-sm text-[#626f86]">Escolha uma cor para “{board.title}”.</p>{error&&<p role="alert" className="mb-3 rounded bg-[#ffebe6] p-2 text-sm text-[#ae2a19]">{error}</p>}<div className="grid grid-cols-4 gap-2">{Object.entries(boardColors).map(([name,color])=><button key={name} type="button" title={name} aria-label={`Cor ${name}`} disabled={busy} onClick={()=>void choose(name)} className={`h-14 rounded disabled:opacity-60 ${board.background===name&&!board.background_image?'ring-2 ring-[#0c66e4] ring-offset-2':''}`} style={{background:color}}/>)}</div></div></Modal>;
}

export function WorkspaceSidebar({ boards,activeId }: { boards: Board[]; activeId?: string; onCreate: ()=>void; onChoose: (id:string)=>void }) {
  const router = useRouter();
  const pathname = usePathname();
  const {setNodeRef: setInboxTabDropRef,isOver: isInboxTabOver}=useDroppable({id:'inbox:tab',data:{type:'inbox'}});
  const [mobileInbox,setMobileInbox]=useState(false);
  const [pinned, setPinned] = useState(true);
  const favoriteIdsJson = useSyncExternalStore(subscribeFavoriteIds, getFavoriteIdsSnapshot, getFavoriteIdsServerSnapshot);
  const [favoriteOrderError,setFavoriteOrderError] = useState('');
  const [sidebarActionError,setSidebarActionError] = useState('');
  const [contextBoardId, setContextBoardId] = useState('');
  const [backgroundBoardId, setBackgroundBoardId] = useState('');
  const [backgroundOverrides, setBackgroundOverrides] = useState<Record<string,string>>({});
  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const scope=useRecordBoardScope(activeId||pathname.match(/^\/board\/([a-f0-9-]{36})/)?.[1]);
  const [tab, setTab] = useState<'inbox'|'collections'|'models'>(pathname === '/collections' ? 'collections' : pathname.startsWith('/board/')?'models':'inbox');
  const {enabled:pluginEnabled,processBoards} = usePluginAvailability();
  useEffect(()=>{const show=()=>{setTab('inbox');if(window.innerWidth<1024)setMobileInbox(true)};const open=()=>setMobileInbox(true);window.addEventListener('inbox:show',show);window.addEventListener('inbox:open',open);return()=>{window.removeEventListener('inbox:show',show);window.removeEventListener('inbox:open',open)}},[]);
  const collectionsAvailable=pluginEnabled('collections');
  const effectiveTab=scope?(tab==='inbox'?'inbox':'models'):(collectionsAvailable&&tab==='collections'?'collections':'inbox');
  useEffect(() => {
    const sync = () => setPinned(localStorage.getItem('orbit_sidebar_pinned') !== 'false');
    sync(); window.addEventListener('sidebar:changed', sync);
    return () => window.removeEventListener('sidebar:changed', sync);
  }, []);
  const regularBoards = boards.filter(board => !board.is_inbox && !board.is_collection);
  const createdFavorites = regularBoards.filter(board => board.starred).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id));
  let savedFavoriteIds: string[] = [];
  try { const parsed: unknown = JSON.parse(favoriteIdsJson); if (Array.isArray(parsed)) savedFavoriteIds = parsed.filter((id): id is string => typeof id === 'string'); } catch { /* An invalid local order falls back to creation order. */ }
  const favoriteRanks = new Map(savedFavoriteIds.map((id,index)=>[id,index]));
  const favorites = savedFavoriteIds.length ? [...createdFavorites].sort((a,b)=>(favoriteRanks.get(a.id)??savedFavoriteIds.length)-(favoriteRanks.get(b.id)??savedFavoriteIds.length)) : createdFavorites;
  const otherBoards = regularBoards.filter(board => !board.starred);
  const renderBoard = (board: Board) => <div key={board.id} className={`group relative flex h-9 w-full items-center rounded-lg text-sm text-[#44546f] hover:bg-[#f1f2f4] ${pinned?'justify-center lg:justify-start lg:px-2':'justify-center'}`}>
    <button onClick={() => router.push(`/board/${board.id}`)} title={board.title} aria-label={`${board.title}${board.starred ? ', favorito' : ''}`} className={`flex h-full min-w-0 flex-1 items-center gap-2 text-left ${pinned?'justify-center lg:justify-start':'justify-center'}`}>
      <span className="relative h-5 w-6 shrink-0 rounded" style={{background:board.background_image&&!backgroundOverrides[board.id]?`url("${board.background_image}") center/cover`:boardColors[backgroundOverrides[board.id]||board.background]||boardColors.blue}}/>
      {pinned&&<><span className="hidden min-w-0 flex-1 truncate lg:block">{board.title}</span>{board.starred&&<Star size={14} fill="currentColor" className="hidden shrink-0 text-[#e2b203] lg:block"/>}</>}
    </button>
    <button hidden={Boolean(board.record_scope)} type="button" title={`Menu de ${board.title}`} aria-label={`Menu de ${board.title}`} aria-expanded={contextBoardId===board.id} onClick={event=>{event.stopPropagation();setContextBoardId(current=>current===board.id?'':board.id)}} className="pointer-events-none absolute right-1 grid h-7 w-7 place-items-center rounded opacity-0 hover:bg-[#dfe1e6] focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto"><MoreHorizontal size={17}/></button>
    {contextBoardId===board.id&&!board.record_scope&&<div className="absolute right-1 top-8 z-40 w-52 rounded-lg border border-[#dfe1e6] bg-white p-1.5 text-sm shadow-dialog"><button type="button" onClick={()=>{setContextBoardId('');void toggleBoardStar(board)}} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#f1f2f4]"><Star size={16}/> Adicionar estrela</button><button type="button" onClick={()=>{setContextBoardId('');setBackgroundBoardId(board.id)}} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#f1f2f4]"><Paintbrush size={16}/> Trocar cor de fundo</button></div>}
  </div>;
  async function toggleBoardStar(board: Board) {
    setSidebarActionError('');
    try {
      await send(`/boards/${board.id}`, 'PATCH', { starred: !board.starred });
      remember({
        label: board.starred ? 'remover favorito' : 'favoritar quadro',
        undo: [{ path: `/boards/${board.id}`, method: 'PATCH', body: { starred: board.starred } }],
        redo: [{ path: `/boards/${board.id}`, method: 'PATCH', body: { starred: !board.starred } }],
      });
      window.dispatchEvent(new Event('data:changed'));
    } catch (error) {
      setSidebarActionError((error as Error).message);
    }
  }
  async function reorderFavorites(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = favorites.findIndex(board => board.id === event.active.id);
    const to = favorites.findIndex(board => board.id === event.over?.id);
    if (from < 0 || to < 0) return;
    const next = [...favorites];
    const [moved] = next.splice(from,1);
    next.splice(to,0,moved);
    localStorage.setItem('orbit_sidebar_favorite_ids',JSON.stringify(next.map(board=>board.id)));
    window.dispatchEvent(new Event('sidebar:favorite-order-changed'));
    setFavoriteOrderError('');
    try { await Promise.all(next.map((board,index)=>send(`/boards/${board.id}`,'PATCH',{favorite_position:index}))); }
    catch { setFavoriteOrderError('Não foi possível salvar a ordem dos favoritos.'); }
  }
  return <><aside aria-label="Menu lateral" className={`scrollbar-thin hidden shrink-0 overflow-y-auto border-r border-[#dfe1e6] bg-white py-4 transition-[width] lg:block ${pinned?'w-[64px] px-2 lg:w-[300px] lg:px-3':'w-[56px] px-2'}`}>
    <div className="mb-3 flex gap-1"><button ref={setInboxTabDropRef} data-orbit-inbox-tab-drop onClick={()=>setTab('inbox')} aria-pressed={effectiveTab === 'inbox'} aria-label="Aba Inbox" className={`flex h-9 flex-1 items-center justify-center rounded-lg ${isInboxTabOver?'ring-2 ring-[#0c66e4]':''} ${effectiveTab === 'inbox' ? 'bg-[#e9f2ff] text-[#0c66e4]' : 'text-[#44546f] hover:bg-[#f1f2f4]'}`}><Inbox size={18}/><span className="ml-2 hidden text-sm font-semibold lg:inline">Inbox</span></button>{scope?<button onClick={()=>setTab('models')} aria-pressed={effectiveTab==='models'} className="min-h-11 flex-1 rounded-lg px-2 text-sm font-semibold hover:bg-[#f0edff]">Modelos</button>:collectionsAvailable&&<button onClick={()=>setTab('collections')} aria-pressed={effectiveTab === 'collections'} aria-label="Aba Coleções" className={`flex h-9 flex-1 items-center justify-center rounded-lg ${effectiveTab === 'collections' ? 'bg-[#f0edff] text-[#6554c0]' : 'text-[#44546f] hover:bg-[#f1f2f4]'}`}><FolderOpen size={18}/><span className="ml-2 hidden text-sm font-semibold lg:inline">Coleções</span></button>}</div>
    {pinned && <div className="hidden lg:block">{effectiveTab==='models'&&scope?<RecordBoardModels scope={scope}/>:effectiveTab === 'collections' ? <CollectionPanel boards={boards}/> : <InboxPanel boards={collectionsAvailable?boards:boards.filter(board=>!board.is_collection)}/>}</div>}
    <section className={`${effectiveTab === 'collections' ? 'hidden' : 'mt-4 border-t border-[#dfe1e6] pt-3'}`}>
      {favorites.length > 0 && <div className="mb-3">
        {pinned&&<h2 className="mb-1 hidden px-2 text-xs font-bold uppercase tracking-wide text-[#626f86] lg:block">Favoritos <span className="font-normal normal-case tracking-normal">· arraste para ordenar</span></h2>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={event=>void reorderFavorites(event)}><SortableContext items={favorites.map(board=>board.id)} strategy={verticalListSortingStrategy}><nav aria-label="Favoritos" className="space-y-1">{favorites.map(board=><SortableFavoriteBoard key={board.id} board={board} pinned={pinned} onChoose={id=>router.push(`/board/${id}`)} onBackground={id=>setBackgroundBoardId(id)} onToggleStar={toggleBoardStar}/>)}</nav></SortableContext></DndContext>
      {favoriteOrderError&&<p role="alert" className="px-2 pt-1 text-[11px] text-[#ae2a19]">{favoriteOrderError}</p>}
      </div>}
      {sidebarActionError&&<p role="alert" className="px-2 pb-2 text-[11px] text-[#ae2a19]">{sidebarActionError}</p>}
      {pinned&&<h2 className="mb-2 hidden px-2 text-xs font-bold uppercase tracking-wide text-[#626f86] lg:block">Seus quadros</h2>}
      <nav aria-label="Seus quadros" className="space-y-1">
  {processBoards.map(board=><button key={board.id} onClick={()=>router.push(board.href)} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={18} className="shrink-0"/>{pinned&&<span className="truncate">{board.name}</span>}</button>)}
      {otherBoards.map(renderBoard)}
        {pinned&&<button onClick={()=>router.push('/boards')} className="hidden w-full rounded-lg px-2 py-2 text-left text-xs font-semibold text-[#0c66e4] hover:bg-[#f1f2f4] lg:block">Ver todos os quadros</button>}
      </nav>
    </section>
    {backgroundBoardId&&(()=>{const board=regularBoards.find(item=>item.id===backgroundBoardId);return board?<BoardBackgroundPopup board={board} onClose={()=>setBackgroundBoardId('')} onChanged={background=>setBackgroundOverrides(current=>({...current,[board.id]:background}))}/>:null})()}
  </aside>{mobileInbox&&<Modal onClose={()=>setMobileInbox(false)}><div className="max-h-[80dvh] w-[min(92vw,420px)] overflow-y-auto p-4"><h2 className="mb-4 pr-10 text-xl font-bold">Meu Inbox</h2><InboxPanel boards={collectionsAvailable?boards:boards.filter(board=>!board.is_collection)} dropId="inbox:mobile-panel"/></div></Modal>}</>;
}

export const CreateBoardModal=dynamic(()=>import('@/plugins/project-boards/CreateBoardModal').then(module=>module.CreateBoardModal));

export function EmptyHint({children}:{children:React.ReactNode}) { return <div className="rounded-lg border border-dashed border-[#c1c7d0] bg-white p-8 text-center text-sm text-[#626f86]">{children}</div>; }
