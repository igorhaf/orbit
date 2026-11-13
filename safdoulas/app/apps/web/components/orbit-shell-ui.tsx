'use client';

import { Modal } from './modal';

import { RecordBoardModels, useRecordBoardScope } from '@/plugins/record-cards/RecordBoardModels';

import { PluginNavigation } from './plugin-navigation';

import { useCreationAvailability } from '@/plugins/project-boards/use-creation-availability';

import { usePluginAvailability } from '@/lib/plugin-availability';

import dynamic from 'next/dynamic';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import Image from 'next/image';

import { Bell, CalendarDays, Check, ChevronDown, FolderKanban, Home, LayoutDashboard, LogOut, Wrench, Menu, DatabaseBackup, Archive, Moon, Search, Settings, Star, Sun, Undo2, Redo2, UserRound, X, Pin, PinOff, CreditCard, CheckSquare, Inbox, NotebookPen, Vault, FolderOpen, GripVertical, MoreHorizontal, Paintbrush } from 'lucide-react';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';

import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { CSS } from '@dnd-kit/utilities';

import { api, send, AppNotification, Board, SearchResults, ToolDiagnostics, User, boardColors, cardUrl, clearSession, getProfileSimulation, getUser, initials, profileSimulationSocketAuth, setProfileSimulation, setUser } from '@/lib/api';

import { historyState, redo, remember, undo } from '@/lib/history';

import { CodexLimitsBar } from './codex-limits';
import { ProfileSimulationContextLauncher } from './profile-simulation-context';

import { io } from 'socket.io-client';

const InboxPanel = dynamic(() => import('./orbit-inbox-panel').then((module) => module.InboxPanel));

const CollectionPanel=dynamic(()=>import('@/plugins/collections/CollectionPanel').then(module=>module.CollectionPanel));

const subscribeAccountSnapshot=(callback:()=>void)=>{window.addEventListener('account:changed',callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener('account:changed',callback);window.removeEventListener('storage',callback)}};

const getAccountSnapshot=()=>typeof window==='undefined'?null:localStorage.getItem('orbit_user');

const getServerAccountSnapshot=()=>null;

const parseAccountSnapshot=(snapshot:string|null):User|null=>{try{return JSON.parse(snapshot||'null')}catch{return null}};

export function Avatar({ name, url, size = 'md' }: { name: string; url?: string | null; size?: 'sm'|'md'|'lg' }) {
  const dimensions = size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-16 w-16 text-xl' : 'h-8 w-8 text-xs';
  return <span title={name} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#dfe1f8] font-bold text-[#403294] ${dimensions}`}>
    {url ? <Image alt={name} src={url} width={64} height={64} unoptimized className="h-full w-full object-cover" /> : initials(name)}
  </span>;
}

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
  const [aiAvailable,setAiAvailable]=useState(false);
  const [developmentAiAvailable,setDevelopmentAiAvailable]=useState(false);
  const {enabled:pluginEnabled,processBoards:pluginBoards,navigation} = usePluginAvailability();
  const collectionsAvailable=pluginEnabled('collections');
  const {canCreateBoard,canCreateProject,boardCreators}=useCreationAvailability();
  const router = useRouter();
  const pathname = usePathname();
  const accountSnapshot=useSyncExternalStore(subscribeAccountSnapshot,getAccountSnapshot,getServerAccountSnapshot);
  const [userState, updateUser] = useState<User | null>(initialUser);
  const user=useMemo(()=>userState??parseAccountSnapshot(accountSnapshot),[accountSnapshot,userState]);
  const footerHomeHref = '/';
  const showSystemFooter = Boolean(user?.is_root_actor || user?.is_root) && pathname.replace(/\/$/, '') === footerHomeHref.replace(/\/$/, '');
  const userId=user?.id;
  const [previousUser, setPreviousUser] = useState(initialUser);
  if (initialUser !== previousUser) {
    setPreviousUser(initialUser);
    updateUser(initialUser);
  }
  const [panel, setPanel] = useState<'search'|'boards'|'create'|'notifications'|'account'|'mobile'|null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const boardsMenuRef = useRef<HTMLDivElement>(null);
  const boardsTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const notificationsMenuRef = useRef<HTMLDivElement>(null);
  const notificationsTriggerRef = useRef<HTMLButtonElement>(null);
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
  const [simulationRoles,setSimulationRoles]=useState<Array<{id:string;name:string}>>([]);
  const [simulationSelection,setSimulationSelection]=useState('');
  const [simulationActive,setSimulationActive]=useState<string|null>(null);
  const [simulationBusy,setSimulationBusy]=useState(false);
  useEffect(()=>{
    if(!(user?.is_root_actor||user?.is_root))return;
    let active=true;
    const syncSelection=()=>{const stored=getProfileSimulation();setSimulationActive(stored);setSimulationSelection(stored||'')};
    window.addEventListener('profile-simulation:changed',syncSelection);
    void api<Array<{id:string;name:string}>>('/access/profile-simulation-roles').then(roles=>{if(active){setSimulationRoles(roles);syncSelection()}}).catch(()=>{if(active)syncSelection()});
    return()=>{active=false;window.removeEventListener('profile-simulation:changed',syncSelection)};
  },[user?.id,user?.is_root_actor,user?.is_root]);
  const enterProfileSimulation=async()=>{
    if(!simulationSelection||simulationBusy)return;
    const previous=getProfileSimulation();setSimulationBusy(true);setProfileSimulation(simulationSelection);setSimulationActive(simulationSelection);
    try{await api<User>('/access/me');window.location.reload()}
    catch(error){setProfileSimulation(previous);setSimulationActive(previous);setMessage((error as Error).message)}
    finally{setSimulationBusy(false)}
  };
  const returnToRootProfile=async()=>{
    if(simulationBusy)return;
    const previous=getProfileSimulation();setSimulationBusy(true);setProfileSimulation(null);setSimulationActive(null);setSimulationSelection('');
    try{await api<User>('/access/me');window.location.reload()}
    catch(error){setProfileSimulation(previous);setSimulationActive(previous);setMessage((error as Error).message)}
    finally{setSimulationBusy(false)}
  };
  const [toolStatus,setToolStatus]=useState<{userId:string;status:ToolDiagnostics['status']}|null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
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
    const refresh=()=>void api<{plugins:Array<{id:string;enabled:boolean}>}>('/plugins').then(({plugins})=>{if(active){const ai=plugins.some(plugin=>plugin.id==='ai'&&plugin.enabled);setAiAvailable(ai);setDevelopmentAiAvailable(ai&&plugins.some(plugin=>plugin.id==='software-development'&&plugin.enabled))}}).catch(()=>{if(active){setAiAvailable(false);setDevelopmentAiAvailable(false)}});
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
    if(!user||!developmentAiAvailable)return;
    let active=true;
    const refresh=()=>void api<ToolDiagnostics>('/tools/diagnostics').then(result=>{if(active)setToolStatus({userId:user.id,status:result.status})}).catch(()=>undefined);
    refresh();
    const timer=window.setInterval(refresh,15_000);
    return()=>{active=false;window.clearInterval(timer)};
  },[user,developmentAiAvailable]);
  const currentToolStatus=developmentAiAvailable&&toolStatus&&toolStatus.userId===user?.id?toolStatus.status:null;
  useEffect(() => {
    if (!user) return;
    let active = true;
    const refresh = () => {
      void api<AppNotification[]>('/notifications').then(items => {
        if (active) syncNotifications(items);
      }).catch(() => undefined);
    };
    const socket = io({ path: '/socket.io', auth: profileSimulationSocketAuth() });
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
      if (event.key === 'Escape') {
        if (panel === 'notifications') notificationsTriggerRef.current?.focus();
        if (panel === 'account') accountTriggerRef.current?.focus();
        if (panel === 'boards') boardsTriggerRef.current?.focus();
        if (panel === 'create') createTriggerRef.current?.focus();
        if (panel === 'search') searchReturnFocusRef.current?.focus();
        if (panel === 'mobile') mobileNavigationTriggerRef.current?.focus();
        setPanel(null);
        return;
      }
      if (user?.preferences?.shortcuts === false) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        (event.shiftKey ? redo() : undo()).catch(error => setMessage((error as Error).message));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo().catch(error => setMessage((error as Error).message));
      } else if (event.key === '/') {
        event.preventDefault();
        const activeElement = document.activeElement;
        searchReturnFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null;
        setPanel('search');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [panel, user?.preferences?.shortcuts]);

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
  const rootActor=Boolean(user?.is_root_actor||user?.is_root);
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

  useEffect(() => {
    const previousPadding = document.body.style.paddingBottom;
    const footer = document.getElementById('orbit-system-footer');
    if (!footer) return;
    const shell = footer.parentElement;
    const previousShellHeight = shell?.style.height;
    const syncLayout = () => {
      const height = Math.ceil(footer.getBoundingClientRect().height);
      document.body.style.paddingBottom = `${height}px`;
      if (shell?.classList.contains('h-screen')) shell.style.height = `calc(100dvh - ${height}px)`;
    };
    syncLayout();
    const observer = new ResizeObserver(syncLayout);
    observer.observe(footer);
    window.addEventListener('resize', syncLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncLayout);
      document.body.style.paddingBottom = previousPadding;
      if (shell) shell.style.height = previousShellHeight || '';
    };
  }, [showSystemFooter]);

  return <>{notificationToast && <div role="status" aria-live="polite" className={`fixed right-4 top-4 z-[60] w-[min(360px,calc(100vw-32px))] rounded-lg border border-[#dfe1e6] bg-white p-3 shadow-dialog transition-all duration-500 ${toastFading ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'}`}><div className="flex items-start gap-2"><Bell size={17} className="mt-0.5 shrink-0 text-[#0c66e4]"/><span className="min-w-0"><strong className="block truncate text-sm">{notificationToast.title}</strong>{notificationToast.body && <span className="mt-0.5 block truncate text-xs text-[#626f86]">{notificationToast.body}</span>}</span></div></div>}<header className="relative z-30 flex min-h-14 shrink-0 flex-wrap items-center gap-1.5 border-b border-[#dfe1e6] bg-white px-3 py-1 sm:gap-2 sm:px-4">
    <button onClick={() => router.push('/')} className="flex items-center gap-2 rounded px-1 py-1 text-[#172b4d] hover:bg-[#f1f2f4]" title="Home">
      <span className="flex h-7 w-7 items-center justify-center rounded bg-[#0c66e4] text-white"><LayoutDashboard size={19} strokeWidth={2.8}/></span>
      <span className="hidden text-[21px] font-extrabold tracking-[-1px] sm:inline">Orbit</span>
    </button>
    <nav className="ml-1 hidden items-center gap-1 lg:flex">
      <button onClick={() => router.push('/')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Home</button>
      <div ref={boardsMenuRef} className="relative" onMouseLeave={() => { if (panel === 'boards') setPanel(null); }}>
        <button ref={boardsTriggerRef} onClick={() => setPanel(panel === 'boards' ? null : 'boards')} aria-expanded={panel === 'boards'} aria-controls="orbit-boards-menu" className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">Quadros <ChevronDown size={13} className="inline"/></button>
        {panel === 'boards' && <div id="orbit-boards-menu" role="region" aria-label="Alternar quadro" className="absolute left-0 top-full z-40 w-72 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
          <div className="flex items-center justify-between px-2 py-2"><strong className="text-sm">Alternar quadro</strong><button onClick={togglePin} className="rounded p-1 text-[#626f86] hover:bg-[#f1f2f4]" title={pinned ? 'Desafixar painel lateral' : 'Fixar painel lateral'}>{pinned ? <PinOff size={16}/> : <Pin size={16}/>}</button></div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar quadro" aria-label="Buscar quadro" className="mb-2 w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm"/>
          <div className="scrollbar-thin max-h-64 overflow-y-auto">{pluginBoards.filter(board=>board.name.toLowerCase().includes(query.toLowerCase())).map(board=><button key={board.id} onClick={()=>{setPanel(null);router.push(board.href)}} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={18} className="shrink-0"/><span className="truncate">{board.name}</span></button>)}{boardMatches.map(board => <button key={board.id} onClick={() => openBoard(board.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[#f1f2f4]"><span className="h-5 w-7 shrink-0 rounded" style={{background:boardColors[board.background]}}/><span className="min-w-0 flex-1 truncate">{board.title}</span>{board.starred && <Star size={13} fill="currentColor" className="text-[#e2b203]"/>}</button>)}</div>
          <button onClick={() => { setPanel(null); router.push('/boards'); }} className="mt-2 w-full border-t border-[#dfe1e6] px-2 py-2 text-left text-sm font-semibold text-[#0c66e4]">Ver todos os quadros</button>
        </div>}
      </div>
      {canUse('calendar.read')&&<button onClick={() => router.push('/calendar')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><CalendarDays size={15} className="mr-1 inline"/>Calendário</button>}
      <PluginNavigation menus={navigation.menus} standalone={navigation.standalone}/>
      {canUse('notebooks.read')&&<button onClick={() => router.push('/notebooks')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><NotebookPen size={15} className="mr-1 inline"/>Cadernos</button>}
      {pluginEnabled('vault','vault.read')&&<button onClick={() => router.push('/vault')} className="rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]"><Vault size={15} className="mr-1 inline"/>Cofre</button>}

    </nav>
<button
  onClick={() => router.push('/boards')}
  className="min-h-11 min-w-11 rounded p-2 text-[#44546f] hover:bg-[#f1f2f4] lg:hidden"
  title="Quadros"
>
  <LayoutDashboard size={19}/>
</button>
<button onClick={() => router.push('/')} className="min-h-11 min-w-11 rounded p-2 text-[#44546f] hover:bg-[#f1f2f4] lg:hidden" title="Home"><Home size={19}/></button>
<div className="relative lg:hidden"><button ref={mobileNavigationTriggerRef} onClick={() => setPanel(panel==='mobile'?null:'mobile')} aria-label="Abrir navegação" aria-expanded={panel==='mobile'} aria-controls="orbit-mobile-navigation" className="min-h-11 min-w-11 rounded p-2 text-[#44546f] hover:bg-[#f1f2f4]"><Menu size={19}/></button>{panel==='mobile'&&<nav id="orbit-mobile-navigation" aria-label="Navegação principal" className="fixed left-2 right-2 top-[calc(3.5rem+env(safe-area-inset-top))] z-[60] grid max-h-[min(70dvh,560px)] w-auto translate-x-0 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-[#dfe1e6] bg-white p-2 shadow-dialog sm:grid-cols-3">{mobileLinks.map(item=><button key={`${item.href}:${item.label}`} onClick={()=>{setPanel(null);router.push(item.href)}} className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold hover:bg-[#f1f2f4]"><item.icon size={17} className="shrink-0 text-[#6554c0]"/><span className="min-w-0 break-words">{item.label}</span></button>)}<PluginNavigation menus={navigation.menus} standalone={navigation.standalone} mobile onNavigate={()=>setPanel(null)}/></nav>}</div>
    {(canCreateBoard||canCreateProject||boardCreators.length>0)&&<div ref={createMenuRef} className="relative ml-1">
      <button ref={createTriggerRef} onClick={() => setPanel(panel === 'create' ? null : 'create')} aria-expanded={panel === 'create'} aria-controls="orbit-create-menu" className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0055cc]">Criar</button>
      {panel === 'create' && <div id="orbit-create-menu" role="region" aria-label="Ações de criação" className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
        {boardCreators.map(item=><button key={item.id} onClick={()=>{setPanel(null);router.push(item.href)}} className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={16}/>{item.name}</button>)}
        {canCreateBoard&&<button onClick={() => { setPanel(null); if (onCreate) { onCreate(); } else { router.push('/boards?create=1'); } }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><LayoutDashboard size={16}/> Criar quadro</button>}
        {canCreateProject&&<button onClick={() => { setPanel(null); router.push('/profile?tab=projects'); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f2f4]"><FolderKanban size={16}/> Criar projeto</button>}
      </div>}
    </div>}


    <div className="flex-1"/>
    <button onClick={() => undo().catch(error => setMessage((error as Error).message))} disabled={!history.canUndo} aria-label="Desfazer" aria-keyshortcuts="Control+Z Meta+Z" className="rounded p-1.5 text-[#44546f] hover:bg-[#f1f2f4] disabled:cursor-not-allowed disabled:opacity-35" title={`${history.undoLabel ? `Desfazer: ${history.undoLabel}` : 'Desfazer'} (Ctrl/Cmd+Z)`}><Undo2 size={18}/></button>
    <button onClick={() => redo().catch(error => setMessage((error as Error).message))} disabled={!history.canRedo} aria-label="Refazer" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" className="rounded p-1.5 text-[#44546f] hover:bg-[#f1f2f4] disabled:cursor-not-allowed disabled:opacity-35" title={`${history.redoLabel ? `Refazer: ${history.redoLabel}` : 'Refazer'} (Ctrl/Cmd+Shift+Z ou Ctrl/Cmd+Y)`}><Redo2 size={18}/></button>
    <button onClick={event => { searchReturnFocusRef.current = event.currentTarget; setPanel('search'); }} className="flex items-center gap-2 rounded border border-transparent p-2 text-[#44546f] hover:bg-[#f1f2f4] sm:w-44 sm:border-[#8590a2] sm:px-3 sm:py-1.5" aria-label="Pesquisar em todos os quadros" aria-expanded={panel === 'search'} aria-controls="global-search-panel"><Search size={17}/><span className="hidden text-sm text-[#626f86] sm:inline">Pesquisar</span></button>
    <div ref={notificationsMenuRef} className="relative" onMouseLeave={() => { if (panel === 'notifications') setPanel(null); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPanel(null); }}>
    <button ref={notificationsTriggerRef} onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} aria-expanded={panel === 'notifications'} className="relative rounded-full p-2 text-[#44546f] hover:bg-[#f1f2f4]" title="Notificações"><Bell size={19}/>{unread > 0 && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-[#e5484d] px-0.5 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}</button>
    {panel === 'notifications' && <NotificationPanel items={notifications} onRead={id => markRead(id).catch(() => {})} onReadAll={() => markAll().catch(() => {})} onClearAll={() => clearAllNotifications().catch(() => {})} onChoose={chooseNotification}/>}
    </div>
    <div ref={accountMenuRef} className="relative" onMouseLeave={() => { if (panel === 'account') setPanel(null); }}>
    <button ref={accountTriggerRef} onClick={() => setPanel(panel === 'account' ? null : 'account')} title="Conta" aria-label="Conta" aria-expanded={panel === 'account'} aria-controls="orbit-account-menu" className="rounded-full"><Avatar name={user?.name || 'Igor'} url={user?.avatar_url}/></button>

    {panel === 'search' && <div id="global-search-panel" role="search" aria-label="Pesquisar em todos os quadros" className="fixed left-2 right-2 top-14 z-40 overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-dialog sm:left-auto sm:right-28 sm:top-16 sm:w-[430px]">
      <div className="flex items-center gap-2 border-b border-[#dfe1e6] px-3 py-2"><Search size={17} className="text-[#626f86]"/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar cartões e quadros..." aria-label="Pesquisar cartões e quadros" className="orbit-control-boundary min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-[#6554c0]"/><button onClick={() => setPanel(null)} aria-label="Fechar pesquisa"><X size={17}/></button></div>
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
    {panel === 'account' && <div id="orbit-account-menu" role="region" aria-label="Menu da conta" className="absolute right-0 top-full z-40 w-64 rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-dialog">
      <div className="border-b border-[#dfe1e6] px-3 py-2"><p className="text-[11px] font-bold uppercase tracking-wide text-[#626f86]">Conta</p><div className="mt-2 flex items-center gap-2"><Avatar name={user?.name || 'Igor'} url={user?.avatar_url}/><div className="min-w-0"><p className="truncate text-sm font-semibold">{user?.name}</p><p className="truncate text-xs text-[#626f86]">{user?.email}</p></div></div></div>
      {(user?.is_root||user?.permissions?.includes('access.manage'))&&<button onClick={()=>{setPanel(null);router.push('/access')}} className="min-h-11 w-full rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]">Acessos e perfis {user?.is_root?'· ROOT':''}</button>}
      <button onClick={() => {setPanel(null);router.push('/profile')}} className="mt-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><UserRound size={16}/> Perfil e atividade</button>
      <button onClick={() => {setPanel(null);router.push('/profile?tab=cards')}} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><CheckSquare size={16}/> Cartões atribuídos</button>
      <button onClick={() => {setPanel(null);router.push('/profile?tab=settings')}} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><Settings size={16}/> Configurações</button>
      <button onClick={toggleTheme} className="theme-preference-control flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]">{user?.preferences?.theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>} {user?.preferences?.theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</button>
      <button onClick={() => {clearSession();setPanel(null);router.push('/');router.refresh();}} className="mt-1 flex w-full items-center gap-2 border-t border-[#dfe1e6] px-3 py-2 text-left text-sm hover:bg-[#f1f2f4]"><LogOut size={16}/> Sair</button>
    </div>}
    </div>
  </header>{showSystemFooter&&<footer id="orbit-system-footer" aria-label="Controles do sistema" className="fixed inset-x-0 bottom-0 z-[70] max-h-[55dvh] overflow-x-hidden overflow-y-auto border-t border-[#dfe1e6] bg-white/95 px-3 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(9,30,66,0.12)] backdrop-blur sm:px-4"><div className="mx-auto flex min-h-12 w-full min-w-0 max-w-[1800px] flex-nowrap items-center gap-1 overflow-visible whitespace-nowrap">{rootActor&&<div className="flex min-w-0 flex-[1_1_9rem] max-w-[40rem] items-center gap-1.5 rounded-lg border border-[#c3b6f7] bg-[#f0edff] px-2 py-1"><label htmlFor="orbit-profile-simulation" className="sr-only">Simular perfil do sistema</label><select id="orbit-profile-simulation" aria-label="Perfil a simular" value={simulationSelection} onChange={event=>setSimulationSelection(event.target.value)} disabled={simulationBusy} className="min-w-0 w-0 max-w-full flex-[1_1_0%] rounded border border-[#c3b6f7] bg-white px-2 py-1.5 text-xs text-[#172b4d]"><option value="">{simulationActive?'Escolha outro perfil…':'Simular perfil…'}</option>{simulationRoles.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select>{simulationActive?<><span className="hidden max-w-32 truncate text-[11px] font-semibold text-[#403294] lg:inline" role="status" aria-live="polite">Simulando: {simulationRoles.find(role=>role.id===simulationActive)?.name||simulationActive}</span><button onClick={()=>void enterProfileSimulation()} disabled={!simulationSelection||simulationSelection===simulationActive||simulationBusy} className="shrink-0 whitespace-nowrap rounded bg-[#6554c0] px-1.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><span className="hidden lg:inline">Trocar</span><span className="lg:hidden">OK</span></button><button onClick={()=>void returnToRootProfile()} disabled={simulationBusy} className="shrink-0 whitespace-nowrap rounded border border-[#6554c0] px-1.5 py-1.5 text-xs font-semibold text-[#403294] disabled:opacity-50"><span className="hidden lg:inline">Voltar a ROOT</span><span className="lg:hidden">ROOT</span></button></>:<button onClick={()=>void enterProfileSimulation()} disabled={!simulationSelection||simulationBusy} className="whitespace-nowrap rounded bg-[#6554c0] px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><span className="hidden lg:inline">Entrar</span><span className="lg:hidden">Ir</span></button>}</div>}{Boolean(simulationActive)&&<ProfileSimulationContextLauncher active={Boolean(simulationActive)}/>}{developmentAiAvailable&&<button onClick={() => router.push('/tools')} title={currentToolStatus==='error'?'O último prompt falhou por causa de uma ferramenta.':currentToolStatus==='running'?'Aguardando o fim do prompt para verificar as ferramentas.':'Ferramentas sem falha detectada no último prompt.'} className="flex min-h-10 shrink-0 items-center gap-1 rounded px-1 text-xs font-semibold hover:bg-[#f1f2f4]"><Wrench size={15}/><span className="hidden lg:inline">Ferramentas</span><span aria-hidden="true" className={`h-2 w-2 rounded-full ${currentToolStatus==='error'?'bg-[#de350b]':currentToolStatus==='success'?'bg-[#22a06b]':currentToolStatus==='running'?'animate-pulse bg-[#579dff]':'bg-[#8590a2]'}`}/></button>}{canUse('plugins.read')&&<button onClick={()=>router.push('/plugins')} className="flex min-h-10 shrink-0 items-center gap-1 rounded px-1 text-xs font-semibold hover:bg-[#f1f2f4]"><FolderKanban size={15}/><span className="hidden lg:inline">Plugins</span></button>}{aiAvailable&&<CodexLimitsBar isRoot={user?.is_root===true}/>}</div></footer>}{message && <div role="alert" className="relative z-20 flex w-full shrink-0 items-center gap-2 border-b border-[#f5c2b7] bg-[#ffebe6] px-4 py-2 text-sm text-[#ae2a19] shadow-sm"><button className="shrink-0 rounded p-1 hover:bg-[#f5c2b7]" onClick={() => setMessage('')} aria-label="Fechar aviso"><X size={14}/></button><span className="min-w-0 break-words">{message}</span></div>}</>;
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

export const boardColorLabels: Record<string, string> = {
  blue: "Azul", teal: "Turquesa", purple: "Roxo", pink: "Rosa", orange: "Laranja",
  green: "Verde", sunset: "Pôr do sol", ocean: "Oceano",
};

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
  return <Modal onClose={onClose}><div className="w-[min(92vw,400px)] p-6"><h2 className="mb-1 pr-8 text-lg font-bold">Plano de fundo</h2><p className="mb-4 text-sm text-[#626f86]">Escolha uma cor para “{board.title}”.</p>{error&&<p role="alert" className="mb-3 rounded bg-[#ffebe6] p-2 text-sm text-[#ae2a19]">{error}</p>}<div className="grid grid-cols-4 gap-2">{Object.entries(boardColors).map(([name,color])=>{const selected=board.background===name&&!board.background_image;return <button key={name} type="button" title={boardColorLabels[name]||name} aria-label={`Cor ${boardColorLabels[name]||name}`} aria-pressed={selected} disabled={busy} onClick={()=>void choose(name)} className={`h-14 rounded disabled:opacity-60 ${selected?'ring-2 ring-[#0c66e4] ring-offset-2':''}`} style={{background:color}}/>})}</div></div></Modal>;
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
