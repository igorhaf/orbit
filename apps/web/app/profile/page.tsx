'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity as ActivityIcon, CheckSquare, Clock3, FolderKanban, ImagePlus, Moon, Palette, UserRound } from 'lucide-react';
import { api, send, Activity, AiProject, Board, HomeCard, Preferences, User, cardUrl, clearSession, getToken, setUser } from '@/lib/api';
import { AppHeader, Avatar, CreateBoardModal, WorkspaceSidebar } from '@/components/ui';
import { useHydrated } from '@/lib/use-hydrated';

type Tab = 'profile'|'activity'|'cards'|'projects'|'settings';
const tabs: {id:Tab;label:string;icon:React.ElementType}[] = [
  {id:'profile',label:'Perfil',icon:UserRound},
  {id:'activity',label:'Atividade',icon:ActivityIcon},
  {id:'cards',label:'Cartões atribuídos',icon:CheckSquare},
  {id:'projects',label:'Projetos',icon:FolderKanban},
  {id:'settings',label:'Configurações',icon:Palette},
];
export default function ProfilePage() {
  const router=useRouter();
  const [user,setCurrentUser]=useState<User|null>(null);
  const [boards,setBoards]=useState<Board[]>([]);
  const [activities,setActivities]=useState<Activity[]>([]);
  const [cards,setCards]=useState<HomeCard[]>([]);
  const [projects,setProjects]=useState<AiProject[]>([]);
  const [projectName,setProjectName]=useState('');
  const [projectPath,setProjectPath]=useState('');
  const ready=useHydrated();
  const [tab,setTab]=useState<Tab>('profile');
  const [name,setName]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [create,setCreate]=useState(false);
  const load = useCallback(async () => {
    try {
      const [account,all,activity,assigned,projectList]=await Promise.all([
        api<User>('/account'),api<Board[]>('/boards'),api<Activity[]>('/account/activity'),api<HomeCard[]>('/account/cards'),api<AiProject[]>('/ai/projects'),
      ]);
      setCurrentUser(account);setUser(account);setName(account.name);setBoards(all);setActivities(activity);setCards(assigned);setProjects(projectList);setError('');
    } catch (err) {setError((err as Error).message)}
  }, []);
  useEffect(()=>{
    if (!getToken()) {router.push('/');return}
    const requested=new URLSearchParams(window.location.search).get('tab');
    api<User>('/auth/me').then(()=>{
      if (tabs.some(item=>item.id===requested)) setTab(requested as Tab);
      load();
    }).catch(()=>{clearSession();router.push('/')});
  },[load,router]);
  function changeTab(value:Tab) {setTab(value);window.history.replaceState(null,'',value==='profile'?'/profile':`/profile?tab=${value}`);setError('');setNotice('')}
  async function updateProfile(body:Record<string,unknown>) {
    try {const account=await send<User>('/account','PATCH',body);setCurrentUser(account);setUser(account);setName(account.name);setNotice('Perfil atualizado.');setError('')}
    catch(err){setError((err as Error).message)}
  }
  async function uploadAvatar(file:File|null) {
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>250000) {setError('Escolha uma imagem PNG, JPEG ou WebP de até 250 KB.');return}
    const reader=new FileReader();
    reader.onload=()=>updateProfile({avatar_url:String(reader.result)});
    reader.readAsDataURL(file);
  }
  async function preference(key:keyof Preferences,value:Preferences[keyof Preferences]) {
    try {const account=await send<User>('/account/preferences','PATCH',{[key]:value});setCurrentUser(account);setUser(account);setNotice('Preferências salvas.');setError('')}
    catch(err){setError((err as Error).message)}
  }
  async function browserNotifications() {
    if (!user?.preferences) return;
    if (user.preferences.browserNotifications) return preference('browserNotifications',false);
    if (typeof Notification==='undefined') {setError('Este navegador não oferece notificações externas.');return}
    const permission=await Notification.requestPermission();
    if (permission==='granted') await preference('browserNotifications',true);
    else setError('Permissão de notificações não concedida pelo navegador.');
  }
  async function createProject(event:React.FormEvent){event.preventDefault();try{const project=await send<AiProject>('/ai/projects','POST',{name:projectName,local_path:projectPath});setProjects([...projects,project].sort((a,b)=>a.name.localeCompare(b.name)));setProjectName('');setProjectPath('');setNotice('Projeto adicionado.');setError('');}catch(err){setError((err as Error).message);}}
  async function removeProject(id:string){if(!confirm('Remover este projeto? Os cartões manterão apenas a referência vazia.'))return;try{await send(`/ai/projects/${id}`,'DELETE');setProjects(projects.filter(project=>project.id!==id));setNotice('Projeto removido.');}catch(err){setError((err as Error).message);}}
  async function createBoard(title:string,background:string,workspaceId?:string){const board=await send<Board>('/boards','POST',{title,background,workspace_id:workspaceId});router.push(`/board/${board.id}`)}
  if (!ready) return <div className="min-h-screen bg-[#f7f8fa]"/>;
  if (!user) return null;
  const preferences=user.preferences || {theme:'light',notifications:true,browserNotifications:false,shortcuts:true,compactCards:false};
  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]"><AppHeader user={user} boards={boards} onCreate={()=>setCreate(true)}/><div className="flex min-h-0 flex-1"><WorkspaceSidebar boards={boards} onCreate={()=>setCreate(true)} onChoose={id=>router.push(id?`/board/${id}`:'/boards')}/><main className="mx-auto w-full max-w-[1050px] px-4 py-8 sm:px-8"><div className="mb-7 flex flex-wrap items-center gap-4"><Avatar name={user.name} url={user.avatar_url} size="lg"/><div><p className="text-xs font-bold uppercase tracking-widest text-[#626f86]">SUA CONTA</p><h1 className="text-[27px] font-bold">{user.name}</h1><p className="text-sm text-[#626f86]">{user.email}</p></div></div><div className="mb-6 flex gap-1 overflow-x-auto border-b border-[#dfe1e6]">{tabs.map(item=><button key={item.id} onClick={()=>changeTab(item.id)} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold ${tab===item.id?'border-[#0c66e4] text-[#0c66e4]':'border-transparent text-[#626f86] hover:text-[#172b4d]'}`}><item.icon size={16}/>{item.label}</button>)}</div>
    {error&&<p role="alert" className="mb-4 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}{notice&&<p role="status" className="mb-4 rounded bg-[#e3fcef] p-3 text-sm text-[#216e4e]">{notice}</p>}
    {tab==='profile'&&<div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]"><section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm"><h2 className="mb-5 text-lg font-bold">Informações do perfil</h2><div className="mb-5 flex flex-wrap items-center gap-4"><Avatar name={user.name} url={user.avatar_url} size="lg"/><div><label className="inline-flex cursor-pointer items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-sm font-semibold hover:bg-[#dfe1e6]"><ImagePlus size={16}/> Alterar avatar<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>uploadAvatar(e.target.files?.[0]||null)} className="sr-only"/></label>{user.avatar_url&&<button onClick={()=>updateProfile({avatar_url:null})} className="ml-2 text-xs text-[#626f86] underline">Remover</button>}<p className="mt-1 text-xs text-[#626f86]">PNG, JPEG ou WebP até 250 KB.</p></div></div><form onSubmit={e=>{e.preventDefault();updateProfile({name})}}><label htmlFor="profile-name" className="mb-1 block text-xs font-bold">Nome exibido</label><input id="profile-name" required maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="mb-4 w-full rounded border border-[#8590a2] px-3 py-2 text-sm"/><label className="mb-1 block text-xs font-bold">E-mail da conta</label><input readOnly value={user.email} className="mb-5 w-full rounded border border-[#dfe1e6] bg-[#f1f2f4] px-3 py-2 text-sm text-[#626f86]"/><button disabled={!name.trim()||name===user.name} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white">Salvar alterações</button></form></section><section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm"><h2 className="mb-4 text-lg font-bold">Seu trabalho</h2><div className="space-y-3"><div className="flex justify-between rounded bg-[#f1f2f4] p-3 text-sm"><span>Quadros acessíveis</span><strong>{boards.length}</strong></div><div className="flex justify-between rounded bg-[#f1f2f4] p-3 text-sm"><span>Cartões atribuídos</span><strong>{cards.length}</strong></div><div className="flex justify-between rounded bg-[#f1f2f4] p-3 text-sm"><span>Atividades recentes</span><strong>{activities.length}</strong></div></div><button onClick={()=>changeTab('activity')} className="mt-5 text-sm font-semibold text-[#0c66e4] hover:underline">Ver atividade →</button></section></div>}
    {tab==='activity'&&<section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><div className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="text-lg font-bold">Atividade recente</h2><p className="text-xs text-[#626f86]">Alterações e conversas nos seus quadros</p></div>{activities.length===0?<p className="p-8 text-center text-sm text-[#626f86]">Suas atividades aparecerão aqui.</p>:<div className="divide-y divide-[#f1f2f4]">{activities.map(item=><button key={item.id} onClick={()=>item.board_id&&router.push(cardUrl(item.board_id,item.card_id))} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-[#f7f8fa]"><span className="mt-1 rounded-full bg-[#e9e5fa] p-2 text-[#6554c0]"><ActivityIcon size={16}/></span><span className="min-w-0 flex-1"><span className="block text-sm"><strong>{item.actor_name}</strong> {item.body}</span><span className="mt-1 block truncate text-xs text-[#626f86]">{item.board_title}{item.card_title?` · ${item.card_title}`:''} · {new Date(item.created_at).toLocaleString('pt-BR')}</span></span></button>)}</div>}</section>}
    {tab==='cards'&&<section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><div className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="text-lg font-bold">Cartões atribuídos a você</h2><p className="text-xs text-[#626f86]">Todos os seus cartões, reunidos aqui</p></div>{cards.length===0?<p className="p-8 text-center text-sm text-[#626f86]">Atribua-se a um cartão para acompanhá-lo nesta lista.</p>:<div className="divide-y divide-[#f1f2f4]">{cards.map(card=><button key={card.id} onClick={()=>router.push(cardUrl(card.board_id,card.id))} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#f7f8fa]"><span className="h-9 w-1 rounded bg-[#0c66e4]"/><span className="min-w-0 flex-1"><strong className={`block truncate text-sm ${card.completed?'text-[#626f86] line-through':''}`}>{card.title}</strong><span className="mt-1 block truncate text-xs text-[#626f86]">{card.board_title} · {card.list_title}</span></span>{card.due_date&&<span className="shrink-0 rounded bg-[#fff1b8] px-2 py-1 text-xs text-[#7f5f01]"><Clock3 size={12} className="mr-1 inline"/>{new Date(card.due_date).toLocaleDateString('pt-BR')}</span>}</button>)}</div>}</section>}
    {tab==='projects'&&<div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]"><section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><div className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="text-lg font-bold">Projetos locais</h2><p className="text-xs text-[#626f86]">A execução de uma sessão de prompt fica limitada à pasta selecionada.</p></div>{projects.length===0?<p className="p-6 text-sm text-[#626f86]">Nenhum projeto cadastrado.</p>:<div className="divide-y divide-[#f1f2f4]">{projects.map(project=><div key={project.id} className="flex items-center gap-3 px-5 py-4"><FolderKanban size={18} className="text-[#6554c0]"/><div className="min-w-0 flex-1"><strong className="block text-sm">{project.name}</strong><code className="block truncate text-xs text-[#626f86]">{project.local_path}</code></div><button onClick={()=>void removeProject(project.id)} className="text-xs text-[#ae2a19]">Remover</button></div>)}</div>}</section><form onSubmit={createProject} className="h-fit rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm"><h2 className="mb-4 text-lg font-bold">Adicionar projeto</h2><label className="mb-3 block text-sm font-semibold">Nome<input required maxLength={120} value={projectName} onChange={event=>setProjectName(event.target.value)} className="mt-1 w-full rounded border border-[#8590a2] px-3 py-2 text-sm font-normal" placeholder="Meu projeto"/></label><label className="block text-sm font-semibold">Pasta local<input required value={projectPath} onChange={event=>setProjectPath(event.target.value)} className="mt-1 w-full rounded border border-[#8590a2] px-3 py-2 text-sm font-normal" placeholder="/home/meada/projetos/exemplo"/></label><button className="mt-4 rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white">Adicionar</button></form></div>}
    {tab==='settings'&&<div className="grid gap-6 md:grid-cols-2"><section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm"><h2 className="mb-1 text-lg font-bold">Aparência</h2><p className="mb-5 text-sm text-[#626f86]">Escolha como o Orbit aparece para você.</p><div className="grid grid-cols-2 gap-3">{(['light','dark'] as const).map(theme=><button key={theme} onClick={()=>preference('theme',theme)} className={`flex flex-col items-center gap-2 rounded-lg border-2 p-5 text-sm font-semibold ${preferences.theme===theme?'border-[#0c66e4] bg-[#e9f2ff]':'border-[#dfe1e6] hover:border-[#8590a2]'}`}>{theme==='light'?<Palette size={25}/>:<Moon size={25}/>} {theme==='light'?'Claro':'Escuro'}</button>)}</div><label className="mt-5 flex items-center justify-between gap-3 border-t border-[#dfe1e6] pt-4 text-sm"><span><strong>Cartões compactos</strong><small className="mt-1 block text-[#626f86]">Reduz o espaço vertical dos cartões.</small></span><input type="checkbox" checked={preferences.compactCards} onChange={e=>preference('compactCards',e.target.checked)} className="h-4 w-4"/></label></section><section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm"><h2 className="mb-1 text-lg font-bold">Notificações e atalhos</h2><p className="mb-5 text-sm text-[#626f86]">Ajuste o comportamento da interface.</p><div className="space-y-4"><label className="flex items-center justify-between gap-3 text-sm"><span><strong>Notificações no aplicativo</strong><small className="mt-1 block text-[#626f86]">Prazos e menções na central.</small></span><input type="checkbox" checked={preferences.notifications} onChange={e=>preference('notifications',e.target.checked)} className="h-4 w-4"/></label><div className="border-t border-[#dfe1e6] pt-4"><label className="flex items-center justify-between gap-3 text-sm"><span><strong>Notificações do navegador</strong><small className="mt-1 block text-[#626f86]">Avisos fora da aba, quando permitidos.</small></span><input type="checkbox" checked={preferences.browserNotifications} onChange={browserNotifications} className="h-4 w-4"/></label><p className="mt-2 text-xs text-[#626f86]">Disponível em localhost ou HTTPS com permissão do navegador.</p></div><label className="flex items-center justify-between gap-3 border-t border-[#dfe1e6] pt-4 text-sm"><span><strong>Atalhos de teclado</strong><small className="mt-1 block text-[#626f86]">/ busca · Ctrl+Z desfaz · Ctrl+Shift+Z refaz.</small></span><input type="checkbox" checked={preferences.shortcuts} onChange={e=>preference('shortcuts',e.target.checked)} className="h-4 w-4"/></label></div></section></div>}
  </main></div>{create&&<CreateBoardModal onClose={()=>setCreate(false)} onCreate={createBoard}/>}</div>;
}
