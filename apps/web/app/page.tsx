'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowRight, Check, CheckSquare, Clock3, LayoutDashboard, MessageSquare, Plus, Sparkles, Star } from 'lucide-react';
import { api, send, Board, HomeData, HomeCard, User, cardUrl, clearSession, dateLabel, getToken, getUser, setUser } from '@/lib/api';
import { remember } from '@/lib/history';
import { AppHeader, BoardTile, CreateBoardModal, WorkspaceSidebar } from '@/components/ui';
import { AuthScreen } from '@/components/auth-screen';
import { useHydrated } from '@/lib/use-hydrated';

const blank: HomeData = { upNext:[], highlights:[], yourItems:[], recentBoards:[], favorites:[], recentConversations:[] };
function dueText(date: string | null, now: number) {
  if (!date) return 'Sem prazo';
  const diff = new Date(date).getTime() - now;
  return diff < 0 ? 'Vencido' : diff < 86400000 ? 'Vence hoje' : `Até ${dateLabel(date)}`;
}
function dueStyle(date: string | null, now: number) {
  if (!date) return 'bg-[#e9f2ff] text-[#0c66e4]';
  return new Date(date).getTime() < now ? 'bg-[#ffebe6] text-[#ae2a19]' : 'bg-[#fff1b8] text-[#7f5f01]';
}

export default function Home() {
  const router=useRouter();
  const [user,setCurrentUser]=useState<User|null>(null);
  const ready=useHydrated();
  const [now]=useState(() => Date.now());
  const [boards,setBoards]=useState<Board[]>([]);
  const [data,setData]=useState<HomeData>(blank);
  const [create,setCreate]=useState(false);
  const [filter,setFilter]=useState<'all'|'overdue'|'upcoming'>('all');
  const [replyId,setReplyId]=useState<string|null>(null);
  const [reply,setReply]=useState('');
  const [error,setError]=useState('');
  const load = useCallback(async () => {
    try {
      const [home,all]=await Promise.all([api<HomeData>('/home'),api<Board[]>('/boards')]);
      setData(home); setBoards(all); setError('');
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
  async function createBoard(title:string,background:string,workspaceId?:string) {
    const board=await send<Board>('/boards','POST',{title,background,workspace_id:workspaceId});
    router.push(`/board/${board.id}`);
  }
  async function complete(card:HomeCard) {
    try {
      await send(`/cards/${card.id}`,'PATCH',{completed:true});
      remember({label:'concluir cartão',undo:[{path:`/cards/${card.id}`,method:'PATCH',body:{completed:false}}],redo:[{path:`/cards/${card.id}`,method:'PATCH',body:{completed:true}}]});
      await load();
    } catch (err) { setError((err as Error).message); }
  }
  async function submitReply(card:HomeCard) {
    if (!reply.trim()) return;
    try { await send(`/cards/${card.id}/comments`,'POST',{body:reply});setReply('');setReplyId(null);await load(); }
    catch (err) { setError((err as Error).message); }
  }
  async function toggleItem(id:string,completed:boolean) {
    try {
      await send(`/checklist/${id}`,'PATCH',{completed:!completed});
      remember({label:'marcar item',undo:[{path:`/checklist/${id}`,method:'PATCH',body:{completed}}],redo:[{path:`/checklist/${id}`,method:'PATCH',body:{completed:!completed}}]});
      await load();
    } catch (err) { setError((err as Error).message); }
  }
  if (!ready) return <div className="min-h-screen bg-[#f7f8fa]"/>;
  if (!user) return <AuthScreen onDone={account => {setCurrentUser(account);load();}}/>;
  const cards=data.upNext.filter(card => filter==='all' || (filter==='overdue' ? Boolean(card.due_date && new Date(card.due_date).getTime()<now) : Boolean(card.due_date && new Date(card.due_date).getTime()>=now)));
  const openCard=(boardId:string,cardId?:string|null)=>router.push(cardUrl(boardId,cardId));
  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]"><AppHeader user={user} boards={boards} onCreate={()=>setCreate(true)}/><div className="flex min-h-0 flex-1"><WorkspaceSidebar boards={boards} onCreate={()=>setCreate(true)} onChoose={id=>router.push(id?`/board/${id}`:'/boards')}/><main className="mx-auto w-full max-w-[1400px] px-4 py-7 sm:px-7 lg:px-9">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-[.12em] text-[#626f86]">VISÃO GERAL</p><h1 className="text-[27px] font-bold tracking-tight sm:text-[31px]">Bom trabalho, {user.name.split(' ')[0]} <span className="text-[#e2b203]">✦</span></h1><p className="mt-1 text-sm text-[#626f86]">Aqui está o que merece sua atenção hoje.</p></div><button onClick={()=>router.push('/boards')} className="flex items-center gap-2 rounded bg-[#e9f2ff] px-3 py-2 text-sm font-semibold text-[#0c66e4] hover:bg-[#d8e8ff]"><LayoutDashboard size={16}/> Todos os quadros <ArrowRight size={15}/></button></div>
    {error && <p role="alert" className="mb-5 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]"><div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dfe1e6] px-5 py-4"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Sparkles size={19} className="text-[#0c66e4]"/> Up Next</h2><p className="mt-1 text-xs text-[#626f86]">Cartões com prazo ou atribuídos a você</p></div><div className="flex rounded bg-[#f1f2f4] p-1 text-xs font-semibold">{([['all','Todos'],['overdue','Vencidos'],['upcoming','Próximos']] as const).map(([key,label])=><button key={key} onClick={()=>setFilter(key)} className={`rounded px-2.5 py-1.5 ${filter===key?'bg-white text-[#0c66e4] shadow-sm':'text-[#626f86] hover:text-[#172b4d]'}`}>{label}</button>)}</div></div><div className="divide-y divide-[#f1f2f4]">{cards.length===0?<div className="px-5 py-10 text-center"><Check className="mx-auto mb-3 text-[#22a06b]" size={28}/><p className="font-semibold">Tudo em dia por aqui</p><p className="mt-1 text-sm text-[#626f86]">Adicione prazos ou atribua cartões para vê-los nesta lista.</p></div>:cards.map(card=><div key={card.id} className="p-4 sm:px-5"><div className="flex flex-wrap items-start gap-3"><button onClick={()=>openCard(card.board_id,card.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold hover:text-[#0c66e4]">{card.title}</span><span className="mt-1 block truncate text-xs text-[#626f86]">{card.board_title} · {card.list_title}</span></button><span className={`rounded px-2 py-1 text-[11px] font-bold ${dueStyle(card.due_date,now)}`}>{dueText(card.due_date,now)}</span></div><div className="mt-3 flex items-center gap-2"><button onClick={()=>complete(card)} className="flex items-center gap-1 rounded bg-[#e3fcef] px-2.5 py-1.5 text-xs font-semibold text-[#216e4e] hover:bg-[#baf3db]"><Check size={14}/> Concluir</button><button onClick={()=>{setReplyId(replyId===card.id?null:card.id);setReply('')}} className="flex items-center gap-1 rounded bg-[#f1f2f4] px-2.5 py-1.5 text-xs font-semibold hover:bg-[#dfe1e6]"><MessageSquare size={14}/> Responder</button></div>{replyId===card.id&&<form onSubmit={e=>{e.preventDefault();submitReply(card)}} className="mt-3 flex gap-2"><input autoFocus value={reply} onChange={e=>setReply(e.target.value)} placeholder="Escreva um comentário..." className="min-w-0 flex-1 rounded border border-[#8590a2] px-3 py-2 text-sm"/><button disabled={!reply.trim()} className="rounded bg-[#0c66e4] px-3 text-xs font-semibold text-white">Enviar</button></form>}</div>)}</div></section>
      <section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><div className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-bold"><Activity size={19} className="text-[#6554c0]"/> Highlights</h2><p className="mt-1 text-xs text-[#626f86]">Novidades dos seus quadros</p></div><div className="divide-y divide-[#f1f2f4]">{data.highlights.length===0?<p className="px-5 py-8 text-center text-sm text-[#626f86]">As atividades dos quadros aparecerão aqui.</p>:data.highlights.slice(0,8).map(item=><button key={item.id} onClick={()=>item.board_id&&openCard(item.board_id,item.card_id)} className="flex w-full gap-3 px-5 py-3 text-left hover:bg-[#f7f8fa]"><span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e9e5fa] text-[#6554c0]"><Activity size={16}/></span><span className="min-w-0 flex-1"><span className="block text-sm"><strong>{item.actor_name}</strong> {item.body}</span><span className="mt-1 block truncate text-xs text-[#626f86]">{item.board_title}{item.card_title?` · ${item.card_title}`:''} · {new Date(item.created_at).toLocaleString('pt-BR')}</span></span></button>)}</div></section>
    </div><div className="space-y-6">
      <section id="your-items" className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><div className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-bold"><CheckSquare size={19} className="text-[#22a06b]"/> Your Items</h2><p className="mt-1 text-xs text-[#626f86]">Itens de checklist atribuídos a você</p></div><div className="max-h-[400px] divide-y divide-[#f1f2f4] overflow-y-auto">{data.yourItems.length===0?<p className="px-5 py-8 text-center text-sm text-[#626f86]">Atribua um item de checklist para acompanhá-lo aqui.</p>:data.yourItems.map(item=><div key={item.id} className="flex items-start gap-2 px-5 py-3"><input type="checkbox" checked={item.completed} onChange={()=>toggleItem(item.id,item.completed)} className="mt-1"/><button onClick={()=>openCard(item.board_id,item.card_id)} className="min-w-0 flex-1 text-left"><span className={`block text-sm ${item.completed?'text-[#626f86] line-through':''}`}>{item.text}</span><span className="mt-0.5 block truncate text-xs text-[#626f86]">{item.board_title} · {item.card_title}</span></button>{item.due_date&&<span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${dueStyle(item.due_date,now)}`}>{dateLabel(item.due_date)}</span>}</div>)}</div></section>
      <section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><div className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-bold"><MessageSquare size={19} className="text-[#0c66e4]"/> Conversas recentes</h2></div><div className="divide-y divide-[#f1f2f4]">{data.recentConversations.length===0?<p className="px-5 py-7 text-center text-sm text-[#626f86]">Comentários recentes aparecerão aqui.</p>:data.recentConversations.slice(0,4).map(item=><button key={item.id} onClick={()=>openCard(item.board_id,item.card_id)} className="w-full px-5 py-3 text-left hover:bg-[#f7f8fa]"><span className="block truncate text-sm"><strong>{item.author_name}</strong> em {item.card_title}</span><span className="mt-1 block truncate text-xs text-[#626f86]">{item.body}</span></button>)}</div></section>
    </div></div>
    {(data.favorites.length>0||data.recentBoards.length>0||boards.length===0)&&<div className="mt-8 grid gap-7 lg:grid-cols-2">{data.favorites.length>0&&<section><h2 className="mb-4 flex items-center gap-2 text-base font-bold"><Star size={18}/> Favoritos</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{data.favorites.slice(0,6).map(board=><BoardTile key={board.id} board={board} onClick={()=>router.push(`/board/${board.id}`)}/>)}</div></section>}{data.recentBoards.length>0&&<section><h2 className="mb-4 flex items-center gap-2 text-base font-bold"><Clock3 size={18}/> Quadros recentes</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{data.recentBoards.slice(0,6).map(board=><BoardTile key={board.id} board={board} onClick={()=>router.push(`/board/${board.id}`)}/>)}</div></section>}{boards.length===0&&<section className="rounded-xl border border-dashed border-[#c1c7d0] bg-white p-7 text-center"><LayoutDashboard className="mx-auto mb-3 text-[#0c66e4]" size={28}/><h3 className="font-bold">Crie seu primeiro quadro</h3><p className="mt-1 text-sm text-[#626f86]">Depois, suas tarefas e atividades aparecerão nesta Home.</p><button onClick={()=>setCreate(true)} className="mt-4 inline-flex items-center gap-2 rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white"><Plus size={16}/> Criar quadro</button></section>}</div>}
  </main></div>{create&&<CreateBoardModal onClose={()=>setCreate(false)} onCreate={createBoard}/>}</div>;
}
