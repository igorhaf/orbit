'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Copy, History, ImagePlus, Info, Link2, MoreHorizontal, Paintbrush, Printer, RefreshCw, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Activity, AiEffort, AiModel, api, Board, boardColors, send, TrelloBoardOption, TrelloConnection } from '@/lib/api';
import { remember } from '@/lib/history';
import { Modal } from './ui';
import { RichText } from './rich-text';
export { RichText } from './rich-text';

type Panel = 'about' | 'activity' | 'background' | 'copy' | 'trello' | 'ai' | null;
const efforts:{id:AiEffort;label:string}[]=[{id:'low',label:'Baixo'},{id:'medium',label:'Médio'},{id:'high',label:'Alto'},{id:'xhigh',label:'Muito alto'}];
const effortIndex=(effort:AiEffort|null|undefined)=>Math.max(0,efforts.findIndex(item=>item.id===(effort||'medium')));
export function BoardTools({ board, onChanged, onClosed, onDeleted }: {board:Board;onChanged:()=>Promise<void>;onClosed:()=>void;onDeleted:()=>void}) {
  const router=useRouter();
  const [menu,setMenu]=useState(false);
  const [panel,setPanel]=useState<Panel>(null);
  const [description,setDescription]=useState(board.description||'');
  const [copyTitle,setCopyTitle]=useState(`${board.title} (cópia)`);
  const [activities,setActivities]=useState<Activity[]>([]);
  const [commentsOnly,setCommentsOnly]=useState(false);
  const [connections,setConnections]=useState<TrelloConnection[]>([]);
  const [trelloBoards,setTrelloBoards]=useState<TrelloBoardOption[]>([]);
  const [trelloBoardId,setTrelloBoardId]=useState('');
  const [models,setModels]=useState<AiModel[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  useEffect(()=>{
    if(panel!=='activity')return;
    api<Activity[]>(`/boards/${board.id}/activity?commentsOnly=${commentsOnly}`).then(setActivities).catch(err=>setError((err as Error).message));
  },[board.id,panel,commentsOnly]);
  useEffect(()=>{
    if(panel!=='trello')return;
    Promise.all([api<TrelloConnection[]>(`/boards/${board.id}/trello`),api<TrelloBoardOption[]>(`/boards/${board.id}/trello/available`)]).then(([linked,available])=>{setConnections(linked);setTrelloBoards(available);if(!trelloBoardId)setTrelloBoardId(available[0]?.id||'')}).catch(err=>setError((err as Error).message));
  },[board.id,panel,trelloBoardId]);
  useEffect(()=>{if(panel==='ai')api<AiModel[]>('/ai/models').then(setModels).catch(err=>setError((err as Error).message));},[panel]);
  async function run(action:()=>Promise<unknown>,refresh=true) {
    setBusy(true);setError('');
    try {await action();if(refresh)await onChanged();return true;}
    catch(err){setError((err as Error).message);return false;}
    finally {setBusy(false);}
  }
  function open(next:Panel){setMenu(false);setError('');setPanel(next);}
  async function saveDescription(){
    const before=board.description||'';
    if(await run(()=>send(`/boards/${board.id}`,'PATCH',{description}))) {
      remember({label:'editar descrição do quadro',undo:[{path:`/boards/${board.id}`,method:'PATCH',body:{description:before}}],redo:[{path:`/boards/${board.id}`,method:'PATCH',body:{description}}]});
      setFeedback('Descrição salva.');
    }
  }
  async function upload(file:File){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>1500000){setError('Escolha PNG, JPEG ou WebP com até 1,5 MB.');return;}
    const reader=new FileReader();
    reader.onload=async()=>{if(typeof reader.result==='string')await run(()=>send(`/boards/${board.id}/background`,'POST',{data_url:reader.result}));};
    reader.onerror=()=>setError('Não foi possível ler a imagem.');
    reader.readAsDataURL(file);
  }
  async function copyLink(){
    try {await navigator.clipboard.writeText(`${window.location.origin}/board/${board.id}`);setFeedback('Link copiado.');setMenu(false);}
    catch {setError('Não foi possível copiar o link.');}
  }
  async function closeBoard(){
    if(!window.confirm(`Fechar o quadro “${board.title}”? Você poderá reabri-lo depois.`))return;
    if(await run(()=>send(`/boards/${board.id}/close`,'PATCH'),false))onClosed();
  }
  async function deleteBoard(){
    if(!window.confirm(`Excluir permanentemente o quadro “${board.title}” e todo o conteúdo? Esta ação não pode ser desfeita.`))return;
    if(await run(()=>send(`/boards/${board.id}`,'DELETE'),false))onDeleted();
  }
  return <>
    <div className="relative"><button onClick={()=>setMenu(!menu)} className="rounded p-1.5 hover:bg-white/20" title="Menu do quadro" aria-expanded={menu}><MoreHorizontal size={20}/></button>
      {menu&&<div className="absolute right-0 top-9 z-30 max-h-[75vh] w-60 overflow-y-auto rounded-lg bg-white p-2 text-sm text-[#172b4d] shadow-dialog">
        <p className="px-2 py-2 font-bold">Menu do quadro</p>
        <MenuButton icon={<Info size={16}/>} label="Sobre este quadro" onClick={()=>open('about')}/>
        <MenuButton icon={<History size={16}/>} label="Atividade" onClick={()=>open('activity')}/>
        {!board.closed_at&&<MenuButton icon={<Sparkles size={16}/>} label="IA do quadro" onClick={()=>open('ai')}/>}
        {!board.closed_at&&<MenuButton icon={<RefreshCw size={16}/>} label="Sincronização Trello" onClick={()=>open('trello')}/>}
        {!board.closed_at&&<MenuButton icon={<Paintbrush size={16}/>} label="Plano de fundo" onClick={()=>open('background')}/>}
        <MenuButton icon={<Copy size={16}/>} label="Copiar quadro" onClick={()=>open('copy')}/>
        <MenuButton icon={<Link2 size={16}/>} label="Copiar link" onClick={copyLink}/>
        <MenuButton icon={<Printer size={16}/>} label="Imprimir quadro" onClick={()=>router.push(`/board/${board.id}/print`)}/>
        {board.closed_at?<MenuButton icon={<RotateCcw size={16}/>} label="Reabrir quadro" onClick={async()=>{setMenu(false);if(await run(()=>send(`/boards/${board.id}/reopen`,'PATCH')))setFeedback('Quadro reaberto.')}}/>:<MenuButton icon={<Archive size={16}/>} label="Fechar quadro" onClick={()=>{setMenu(false);closeBoard()}}/>}
        <div className="my-1 border-t border-[#dfe1e6]"/>
        <MenuButton icon={<Trash2 size={16}/>} label="Excluir permanentemente" danger onClick={()=>{setMenu(false);deleteBoard()}}/>
      </div>}
    </div>
    {feedback&&<span className="rounded bg-white/20 px-2 py-1 text-xs" role="status">{feedback}</span>}
    {error&&!panel&&<span className="rounded bg-[#ffebe6] px-2 py-1 text-xs text-[#ae2a19]" role="alert">{error}</span>}
    {panel&&<Modal onClose={()=>setPanel(null)}><div className="max-h-[80vh] overflow-y-auto p-6 text-[#172b4d]">
      <h2 className="mb-4 pr-8 text-lg font-bold">{panel==='about'?'Sobre este quadro':panel==='activity'?'Atividade do quadro':panel==='background'?'Plano de fundo':panel==='trello'?'Sincronização Trello':panel==='ai'?'IA do quadro':'Copiar quadro'}</h2>
      {error&&<p role="alert" className="mb-3 rounded bg-[#ffebe6] p-2 text-sm text-[#ae2a19]">{error}</p>}
      {panel==='about'&&<div className="space-y-4"><div><h3 className="mb-1 text-sm font-bold">Descrição</h3><p className="mb-2 text-xs text-[#626f86]">Explique a finalidade do quadro. Links e menções como @igor aparecem em destaque.</p><textarea disabled={Boolean(board.closed_at)} value={description} onChange={e=>setDescription(e.target.value)} maxLength={10000} rows={5} className="w-full resize-y rounded border border-[#8590a2] p-3 text-sm" placeholder="Adicione uma descrição..."/>{!board.closed_at&&<button disabled={busy||description===(board.description||'')} onClick={saveDescription} className="mt-2 rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar descrição</button>}</div>{board.description&&<div className="rounded bg-[#f1f2f4] p-3 text-sm"><RichText text={board.description}/></div>}</div>}
      {panel==='ai'&&<div className="space-y-5"><div><p className="mb-3 text-sm text-[#626f86]">Modelo usado pelos cartões que não possuem um modelo próprio.</p><select value={board.ai_default_model||''} onChange={event=>void run(()=>send(`/boards/${board.id}/prompt-settings`,'PATCH',{ai_default_model:event.target.value||null}))} className="w-full rounded border border-[#8590a2] bg-white p-2 text-sm"><option value="">Escolha um modelo</option>{models.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}</select></div><div><div className="mb-2 flex items-center justify-between"><label htmlFor="board-ai-effort" className="text-sm font-semibold">Esforço padrão</label><span className="text-sm text-[#626f86]">{efforts[effortIndex(board.ai_default_effort)].label}</span></div><input id="board-ai-effort" type="range" min="0" max={efforts.length-1} step="1" disabled={busy} value={effortIndex(board.ai_default_effort)} onChange={event=>void run(()=>send(`/boards/${board.id}/prompt-settings`,'PATCH',{ai_default_effort:efforts[Number(event.target.value)].id}))} className="w-full accent-[#6554c0]"/><div className="mt-1 flex justify-between text-[11px] text-[#626f86]">{efforts.map(item=><span key={item.id}>{item.label}</span>)}</div><p className="mt-2 text-xs text-[#626f86]">Aplicado aos cartões sem esforço próprio.</p></div></div>}
      {panel==='trello'&&<div className="space-y-4"><p className="text-sm text-[#626f86]">As alterações em listas e cartões vinculados são espelhadas nos dois sentidos a cada 5 segundos. Cartões importados recebem as etiquetas <strong>trello</strong> e o nome do quadro de origem.</p><form onSubmit={async event=>{event.preventDefault();if(!trelloBoardId)return;if(await run(()=>send(`/boards/${board.id}/trello`,'POST',{trello_board_id:trelloBoardId}))){setConnections(await api<TrelloConnection[]>(`/boards/${board.id}/trello`));await onChanged();}}} className="flex flex-col gap-2 rounded border border-[#dfe1e6] p-3"><label className="text-sm font-semibold">Adicionar quadro Trello</label><select value={trelloBoardId} onChange={event=>setTrelloBoardId(event.target.value)} className="rounded border border-[#8590a2] bg-white p-2 text-sm"><option value="">Selecione um quadro</option>{trelloBoards.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={busy||!trelloBoardId} className="self-start rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Conectar e sincronizar</button></form><div className="space-y-2">{connections.length===0&&<p className="text-sm text-[#626f86]">Nenhum quadro Trello conectado.</p>}{connections.map(connection=><div key={connection.id} className="rounded border border-[#dfe1e6] p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{connection.trello_board_name}</p><p className="text-xs text-[#626f86]">{connection.last_synced_at?`Última sincronização: ${new Date(connection.last_synced_at).toLocaleString('pt-BR')}`:'Aguardando primeira sincronização.'}</p>{connection.last_error&&<p className="mt-1 text-xs text-[#ae2a19]">{connection.last_error}</p>}</div><div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>void run(async()=>{await send(`/boards/${board.id}/trello/sync`,'POST');setConnections(await api<TrelloConnection[]>(`/boards/${board.id}/trello`));})} className="rounded bg-[#f1f2f4] px-2 py-1 text-xs">Sincronizar</button><button type="button" disabled={busy} onClick={()=>void run(async()=>{await send(`/boards/${board.id}/trello/${connection.id}`,'DELETE');setConnections(await api<TrelloConnection[]>(`/boards/${board.id}/trello`));})} className="rounded bg-[#ffebe6] px-2 py-1 text-xs text-[#ae2a19]">Desconectar</button></div></div></div>)}</div></div>}
      {panel==='activity'&&<div><div className="mb-4 flex gap-2"><button onClick={()=>setCommentsOnly(false)} className={`rounded px-3 py-1.5 text-sm ${!commentsOnly?'bg-[#0c66e4] text-white':'bg-[#f1f2f4]'}`}>Todas</button><button onClick={()=>setCommentsOnly(true)} className={`rounded px-3 py-1.5 text-sm ${commentsOnly?'bg-[#0c66e4] text-white':'bg-[#f1f2f4]'}`}>Só comentários</button></div><div className="max-h-[50vh] space-y-3 overflow-y-auto">{activities.length===0&&<p className="text-sm text-[#626f86]">Nenhuma atividade encontrada.</p>}{activities.map(item=><div key={item.id} className="border-b border-[#dfe1e6] pb-3 text-sm"><strong>{item.actor_name}</strong> <RichText text={item.body}/>{item.card_title&&<span className="ml-1 text-[#626f86]">· {item.card_title}</span>}<p className="mt-1 text-xs text-[#626f86]">{new Date(item.created_at).toLocaleString('pt-BR')}</p></div>)}</div></div>}
      {panel==='background'&&<div><h3 className="mb-2 text-sm font-bold">Cores</h3><div className="mb-5 grid grid-cols-4 gap-2">{Object.entries(boardColors).map(([name,gradient])=><button key={name} title={name} aria-label={`Cor ${name}`} onClick={async()=>{await run(async()=>{await send(`/boards/${board.id}`,'PATCH',{background:name});if(board.background_image)await send(`/boards/${board.id}/background`,'DELETE')})}} className={`h-16 rounded ${board.background===name&&!board.background_image?'ring-2 ring-[#0c66e4] ring-offset-2':''}`} style={{background:gradient}}/>)}</div><h3 className="mb-2 text-sm font-bold">Imagem do dispositivo</h3><label className="flex cursor-pointer items-center justify-center gap-2 rounded border-2 border-dashed border-[#8590a2] p-5 text-sm hover:bg-[#f1f2f4]"><ImagePlus size={18}/> Enviar imagem<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event=>{const file=event.target.files?.[0];if(file)upload(file)}}/></label><p className="mt-2 text-xs text-[#626f86]">PNG, JPEG ou WebP, até 1,5 MB.</p>{board.background_image&&<button disabled={busy} onClick={()=>run(()=>send(`/boards/${board.id}/background`,'DELETE'))} className="mt-4 rounded bg-[#f1f2f4] px-3 py-2 text-sm">Remover imagem</button>}</div>}
      {panel==='copy'&&<form onSubmit={async event=>{event.preventDefault();if(!copyTitle.trim())return;setBusy(true);try{const copied=await send<Board>(`/boards/${board.id}/copy`,'POST',{title:copyTitle});router.push(`/board/${copied.id}`)}catch(err){setError((err as Error).message)}finally{setBusy(false)}}}><p className="mb-3 text-sm text-[#626f86]">Copia listas, cartões, etiquetas, checklist, atribuições, descrição e fundo. Comentários e histórico não são copiados.</p><label htmlFor="copy-board-title" className="mb-1 block text-sm font-semibold">Nome do novo quadro</label><input id="copy-board-title" autoFocus maxLength={160} value={copyTitle} onChange={e=>setCopyTitle(e.target.value)} className="mb-4 w-full rounded border border-[#8590a2] px-3 py-2 text-sm"/><button disabled={busy||!copyTitle.trim()} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white">Criar cópia</button></form>}
    </div></Modal>}
  </>;
}
function MenuButton({icon,label,onClick,danger=false}:{icon:React.ReactNode;label:string;onClick:()=>void;danger?:boolean}){return <button onClick={onClick} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#f1f2f4] ${danger?'text-[#ae2a19]':''}`}>{icon}{label}</button>}
