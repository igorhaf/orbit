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
export type CustomField = { id:string;board_id?:string;name:string;type:'text'|'number'|'date'|'dropdown'|'checkbox';options:string[];position:number;show_on_card:boolean };
export type CustomValue = { field_id:string;name?:string;type?:CustomField['type'];value:string|number|boolean };
export type ChecklistGroup = { id:string;card_id:string;title:string;position:number;items:ChecklistItem[] };
export type Attachment = { id:string;card_id:string;kind:'file'|'url'|'card'|'board';name:string;url:string|null;target_id:string|null;mime_type:string|null;size_bytes:number|null;position:number;created_at:string };
export type CardExtensions = { checklists:ChecklistGroup[];values:CustomValue[];attachments:Attachment[] };
export type Card = {
  id: string;
  kind?: 'normal'|'template'|'board'|'separator'|'link'|'mirror';
  target_board_id?: string|null;
  target_board_title?: string|null;
  link_url?: string|null;
  source_card_id?: string|null;
  source_board_id?: string|null;
  source_board_title?: string|null;
  mirror_expanded?: boolean;
  list_id: string;
  title: string;
  description: string;
  position: number;
  start_date: string | null;
  due_date: string | null;
  reminder_minutes: number | null;
  recurrence: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  overdue?: boolean;
  cover_color: string | null;
  cover_attachment_id?: string | null;
  cover_image?: string | null;
  cover_size?: 'normal' | 'full';
  completed: boolean;
  assigned_to_me?: boolean;
  assignees?: User[];
  labels: Label[];
  comment_count: number;
  attachment_count?: number;
  checklist_total: number;
  checklist_done: number;
  custom_values?: CustomValue[];
};
export type List = { id: string; board_id: string; title: string; position: number; color: string | null; collapsed: boolean; archived_at?: string | null; card_count?: number; cards: Card[] };
export type Board = {
  id: string;
  is_inbox?: boolean;
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
  custom_fields?: CustomField[];
};
export type Workspace = { id: string; name: string; board_count: number };
export type CommentAttachment = {id:string;kind:'file'|'card'|'board';name:string;url:string|null;target_id:string|null;mime_type:string|null;size_bytes:number|null};
export type Comment = { id: string; body: string; created_at: string; edited_at?:string|null; author_id: string; author_name: string; attachments?:CommentAttachment[] };
export type ChecklistItem = { id: string; card_id?:string; checklist_id?:string; text: string; completed: boolean; position: number; assignee_id: string | null; assignee_name?:string|null; due_date: string | null };
export type CardDetails = { comments: Comment[]; checklist: ChecklistItem[] };
export type WatchState = {card:boolean;list:boolean;board:boolean};
export type Activity = { id: string; kind: string; body: string; created_at: string; card_id: string | null; card_title: string | null; board_id: string | null; board_title: string | null; actor_name: string };
export type HomeCard = { id: string; title: string; description: string; due_date: string | null; overdue?: boolean; completed: boolean; board_id: string; board_title: string; list_title: string; assigned_to_me: boolean; background: string };
export type HomeItem = { id: string; text: string; completed: boolean; due_date: string | null; overdue?: boolean; card_id: string; card_title: string; board_id: string; board_title: string };
export type RecentConversation = { id: string; body: string; created_at: string; card_id: string; card_title: string; board_id: string; board_title: string; author_name: string };
export type HomeData = { upNext: HomeCard[]; highlights: Activity[]; yourItems: HomeItem[]; recentBoards: Board[]; favorites: Board[]; recentConversations: RecentConversation[] };
export type SearchResults = { boards: Board[]; cards: (HomeCard & { description: string })[] };
export type AppNotification = { id: string; kind: string; title: string; body: string; created_at: string; read_at: string | null; board_id: string | null; board_title: string | null; card_id: string | null };

// Keep API calls on the same origin by default. Next.js proxies /api to Nest,
// which also makes the app work from another device on the local network.
const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
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
export async function attachmentBlob(id:string):Promise<Blob>{
  const response=await fetch(`${BASE}/attachments/${id}/content`,{headers:{Authorization:`Bearer ${getToken()||''}`}});
  if(!response.ok)throw new Error('Não foi possível abrir o anexo.');
  return response.blob();
}
export async function commentAttachmentBlob(id:string):Promise<Blob>{
  const response=await fetch(`${BASE}/comment-attachments/${id}/content`,{headers:{Authorization:`Bearer ${getToken()||''}`}});
  if(!response.ok)throw new Error('Não foi possível abrir o anexo.');
  return response.blob();
}
export async function uploadCardFiles(cardId:string,files:FileList|File[]):Promise<void>{
  for(const file of Array.from(files)){
    if(file.size>10_000_000)throw new Error('O arquivo deve ter até 10 MB.');
    if(file.type.startsWith('image/')&&file.size>2_000_000)throw new Error('A imagem deve ter até 2 MB.');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(file)});
    await send('/cards/'+cardId+'/attachments','POST',{kind:'file',name:file.name,mime_type:file.type||'application/octet-stream',data});
  }
}
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
  green:'#4bce97', green_light:'#baf3db', green_dark:'#216e4e',
  yellow:'#f5cd47', yellow_light:'#f8e6a0', yellow_dark:'#7f5f01',
  orange:'#fea362', orange_light:'#ffdcc0', orange_dark:'#974f0c',
  red:'#f87168', red_light:'#ffd5d2', red_dark:'#ae2a19',
  purple:'#9f8fef', purple_light:'#dfd8fd', purple_dark:'#5e4db2',
  blue:'#579dff', blue_light:'#cce0ff', blue_dark:'#0c66e4',
  pink:'#e774bb', pink_light:'#fdd0ec', pink_dark:'#a63586',
  teal:'#60c6d2', teal_light:'#c6edfb', teal_dark:'#206a83',
  lime:'#94c748', lime_light:'#d3f1a7', lime_dark:'#4c6b1f',
  gray:'#8590a2', gray_light:'#dfe1e6', gray_dark:'#44546f',
  none:'#e9eaed',
};
export const labelTextColor = (color:string) => /_dark$/.test(color) ? '#fff' : '#172b4d';
