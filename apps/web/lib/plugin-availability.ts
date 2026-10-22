'use client';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, type User } from './api';
import {pluginNavigation,type NavigationCatalogPlugin} from './plugin-navigation';

type BoardLink = { id: string; name: string; href: string; permission: string };
type Plugin = { id: string; enabled: boolean; contributions?: { processBoards?: BoardLink[];boardCreators?: BoardLink[];navigation?:unknown[];recordCards?:unknown[] } };

export function usePluginAvailability() {
  const [state, setState] = useState<{ ready: boolean; plugins: Plugin[]; user: User | null }>({ ready: false, plugins: [], user: null });
  useEffect(() => {
    let active = true, generation = 0;
    const socket=io({path:'/socket.io',autoConnect:false});
    let socketToken: string|null=null;
    const refresh = async () => {
      const current = ++generation;
      const token=getToken();
      if (!token) { socket.disconnect();socketToken=null;setState({ ready: true, plugins: [], user: null }); return; }
      if(token!==socketToken){socket.disconnect();socket.auth={token};socketToken=token;socket.connect();}
      try {
        const [catalog, user] = await Promise.all([api<{ plugins: Plugin[] }>('/plugins'), api<User>('/auth/me')]);
        if (active && current === generation) setState({ ready: true, plugins: catalog.plugins, user });
      } catch { if (active && current === generation) setState({ ready: true, plugins: [], user: null }); }
    };
    socket.on('plugins:changed',refresh);
    socket.on('connect',refresh);
    void refresh();
    window.addEventListener('plugins:changed', refresh); window.addEventListener('account:changed', refresh);
    return () => { active = false; generation++; socket.disconnect(); window.removeEventListener('plugins:changed', refresh); window.removeEventListener('account:changed', refresh); };
  }, []);
  const permitted = (permission: string) => Boolean(state.user?.is_root || state.user?.permissions?.includes(permission));
  const enabled = (id: string, permission = `plugin.${id}.read`) => state.plugins.some(plugin => plugin.id === id && plugin.enabled) && permitted(permission);
  const processBoards = state.plugins.filter(plugin => plugin.enabled).flatMap(plugin => plugin.contributions?.processBoards || [])
    .filter(board => enabled('process-board') && permitted('views.structured.use') && typeof board.id === 'string' && typeof board.name === 'string' && /^\/[a-z0-9/-]+$/.test(board.href) && permitted(board.permission));
  const boardCreators=state.plugins.filter(plugin=>plugin.enabled).flatMap(plugin=>plugin.contributions?.boardCreators||[]).filter(item=>typeof item.name==='string'&&/^\/[a-z0-9/-]+$/.test(item.href)&&permitted(item.permission));
  const navigation=pluginNavigation(state.plugins as NavigationCatalogPlugin[],permitted);
  return { ready: state.ready, enabled, processBoards, boardCreators, navigation,hasRecordCards:state.plugins.some(plugin=>plugin.enabled&&Boolean(plugin.contributions?.recordCards?.length)) };
}
