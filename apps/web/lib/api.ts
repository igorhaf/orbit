export type Preferences = {
  theme: 'light' | 'dark';
  notifications: boolean;
  browserNotifications: boolean;
  shortcuts: boolean;
  compactCards: boolean;
};
export type User = {
  id: string;
  name: string;
  email: string;
  avatar_url?: string | null;
  preferences?: Preferences;
  created_at?: string;
  role?: string;
};
export type Label = { id: string; name: string; color: string };
export type Card = {
  id: string;
  list_id: string;
  title: string;
  description: string;
  position: number;
  due_date: string | null;
  overdue?: boolean;
  cover_color: string | null;
  completed: boolean;
  assigned_to_me?: boolean;
  labels: Label[];
  comment_count: number;
  checklist_total: number;
  checklist_done: number;
};
export type List = { id: string; board_id: string; title: string; position: number; cards: Card[] };
export type Board = {
  id: string;
  title: string;
  background: string;
  background_image?: string | null;
  description?: string;
  closed_at?: string | null;
  starred: boolean;
  owner_id: string;
  workspace_id?: string;
  workspace_name?: string;
  favorite_position?: number | null;
  visited_at?: string | null;
  member_count?: number;
  lists?: List[];
  labels?: Label[];
  members?: User[];
};
export type Workspace = { id: string; name: string; board_count: number };
export type Comment = { id: string; body: string; created_at: string; author_id: string; author_name: string };
export type ChecklistItem = { id: string; text: string; completed: boolean; position: number; assignee_id: string | null; due_date: string | null };
export type CardDetails = { comments: Comment[]; checklist: ChecklistItem[] };
export type Activity = { id: string; kind: string; body: string; created_at: string; card_id: string | null; card_title: string | null; board_id: string | null; board_title: string | null; actor_name: string };
export type HomeCard = { id: string; title: string; description: string; due_date: string | null; overdue?: boolean; completed: boolean; board_id: string; board_title: string; list_title: string; assigned_to_me: boolean; background: string };
export type HomeItem = { id: string; text: string; completed: boolean; due_date: string | null; overdue?: boolean; card_id: string; card_title: string; board_id: string; board_title: string };
export type RecentConversation = { id: string; body: string; created_at: string; card_id: string; card_title: string; board_id: string; board_title: string; author_name: string };
export type HomeData = { upNext: HomeCard[]; highlights: Activity[]; yourItems: HomeItem[]; recentBoards: Board[]; favorites: Board[]; recentConversations: RecentConversation[] };
export type SearchResults = { boards: Board[]; cards: (HomeCard & { description: string })[] };
export type AppNotification = { id: string; kind: string; title: string; body: string; created_at: string; read_at: string | null; board_id: string | null; board_title: string | null; card_id: string | null };

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const getToken = () => typeof window === 'undefined' ? null : localStorage.getItem('orbit_token');
export const setSession = (token: string, user: User) => {
  localStorage.setItem('orbit_token', token);
  localStorage.setItem('orbit_user', JSON.stringify(user));
  applyTheme(user.preferences?.theme || 'light');
  document.documentElement.dataset.compactCards = String(Boolean(user.preferences?.compactCards));
  window.dispatchEvent(new Event('account:changed'));
};
export const clearSession = () => {
  localStorage.removeItem('orbit_token');
  localStorage.removeItem('orbit_user');
  applyTheme('light');
  document.documentElement.dataset.compactCards = 'false';
  window.dispatchEvent(new Event('account:changed'));
};
export const getUser = (): User | null => {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('orbit_user') || 'null'); }
  catch { return null; }
};
export const setUser = (user: User) => {
  localStorage.setItem('orbit_user', JSON.stringify(user));
  applyTheme(user.preferences?.theme || 'light');
  document.documentElement.dataset.compactCards = String(Boolean(user.preferences?.compactCards));
  window.dispatchEvent(new Event('account:changed'));
};
export const applyTheme = (theme: 'light' | 'dark') => {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
};
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...options.headers,
      },
      cache: 'no-store',
    });
  } catch { throw new Error('Não foi possível conectar à API. Verifique se o servidor está rodando.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Ocorreu um erro. Tente novamente.');
  return data as T;
}
export const send = <T = unknown>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0,2).map(n => n[0].toUpperCase()).join('');
export const cardUrl = (boardId: string, cardId?: string | null) => `/board/${boardId}${cardId ? `?card=${cardId}` : ''}`;
export const dateLabel = (date: string) => new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
export const boardColors: Record<string,string> = {
  blue: 'linear-gradient(135deg,#126aaf,#074b88)',
  teal: 'linear-gradient(135deg,#16969b,#075e73)',
  purple: 'linear-gradient(135deg,#8e68cb,#534292)',
  pink: 'linear-gradient(135deg,#c96c9b,#935377)',
  orange: 'linear-gradient(135deg,#df8751,#a45343)',
  green: 'linear-gradient(135deg,#6b9b6d,#376e63)',
  sunset: 'linear-gradient(135deg,#d27977 0%,#a3568c 50%,#575ca0 100%)',
  ocean: 'linear-gradient(135deg,#4c94b0 0%,#31748d 50%,#1a4e73 100%)',
};
export const labelColors: Record<string,string> = {
  green:'#4bce97', yellow:'#f5cd47', orange:'#fea362', red:'#f87168',
  purple:'#9f8fef', blue:'#579dff', pink:'#e774bb', teal:'#60c6d2',
};
