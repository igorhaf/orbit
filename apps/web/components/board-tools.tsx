'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Copy, History, ImagePlus, Info, Link2, MoreHorizontal, Paintbrush, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { Activity, api, Board, boardColors, send } from '@/lib/api';
import { remember } from '@/lib/history';
import { Modal } from './ui';

export function RichText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap break-words">{text.split(/(https?:\/\/[^\s]+|@[\w.-]+)/g).map((part, index) => {
    if (/^https?:\/\//.test(part)) return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-[#0c66e4] underline" onClick={event=>event.stopPropagation()}>{part}</a>;
    if (part.startsWith('@')) return <strong key={index} className="rounded bg-[#dfe1f8] px-0.5 text-[#403294]">{part}</strong>;
    return <span key={index}>{part}</span>;
  })}</span>;
}

type Panel = 'about' | 'activity' | 'background' | 'copy' | null;
export function BoardTools({ board, onChanged, onClosed, onDeleted }: {board:Board;onChanged:()=>Promise<void>;onClosed:()=>void;onDeleted:()=>void}) {
  const router=useRouter();
  const [menu,setMenu]=useState(false);
  const [panel,setPanel]=useState<Panel>(null);
  const [description,setDescription]=useState(board.description||'');
  const [copyTitle,setCopyTitle]=useState(`${board.title} (cópia)`);
  const [activities,setActivities]=useState<Activity[]>([]);
  const [commentsOnly,setCommentsOnly]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  useEffect(()=>{
    if(panel!=='activity')return;
    api<Activity[]>(`/boards/${board.id}/activity?commentsOnly=${commentsOnly}`).then(setActivities).catch(err=>setError((err as Error).message));
  },[board.id,panel,commentsOnly]);
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
      <h2 className="mb-4 pr-8 text-lg font-bold">{panel==='about'?'Sobre este quadro':panel==='activity'?'Atividade do quadro':panel==='background'?'Plano de fundo':'Copiar quadro'}</h2>
      {error&&<p role="alert" className="mb-3 rounded bg-[#ffebe6] p-2 text-sm text-[#ae2a19]">{error}</p>}
      {panel==='about'&&<div className="space-y-4"><div><h3 className="mb-1 text-sm font-bold">Descrição</h3><p className="mb-2 text-xs text-[#626f86]">Explique a finalidade do quadro. Links e menções como @igor aparecem em destaque.</p><textarea disabled={Boolean(board.closed_at)} value={description} onChange={e=>setDescription(e.target.value)} maxLength={10000} rows={5} className="w-full resize-y rounded border border-[#8590a2] p-3 text-sm" placeholder="Adicione uma descrição..."/>{!board.closed_at&&<button disabled={busy||description===(board.description||'')} onClick={saveDescription} className="mt-2 rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar descrição</button>}</div>{board.description&&<div className="rounded bg-[#f1f2f4] p-3 text-sm"><RichText text={board.description}/></div>}</div>}
      {panel==='activity'&&<div><div className="mb-4 flex gap-2"><button onClick={()=>setCommentsOnly(false)} className={`rounded px-3 py-1.5 text-sm ${!commentsOnly?'bg-[#0c66e4] text-white':'bg-[#f1f2f4]'}`}>Todas</button><button onClick={()=>setCommentsOnly(true)} className={`rounded px-3 py-1.5 text-sm ${commentsOnly?'bg-[#0c66e4] text-white':'bg-[#f1f2f4]'}`}>Só comentários</button></div><div className="max-h-[50vh] space-y-3 overflow-y-auto">{activities.length===0&&<p className="text-sm text-[#626f86]">Nenhuma atividade encontrada.</p>}{activities.map(item=><div key={item.id} className="border-b border-[#dfe1e6] pb-3 text-sm"><strong>{item.actor_name}</strong> <RichText text={item.body}/>{item.card_title&&<span className="ml-1 text-[#626f86]">· {item.card_title}</span>}<p className="mt-1 text-xs text-[#626f86]">{new Date(item.created_at).toLocaleString('pt-BR')}</p></div>)}</div></div>}
      {panel==='background'&&<div><h3 className="mb-2 text-sm font-bold">Cores</h3><div className="mb-5 grid grid-cols-4 gap-2">{Object.entries(boardColors).map(([name,gradient])=><button key={name} title={name} aria-label={`Cor ${name}`} onClick={async()=>{await run(async()=>{await send(`/boards/${board.id}`,'PATCH',{background:name});if(board.background_image)await send(`/boards/${board.id}/background`,'DELETE')})}} className={`h-16 rounded ${board.background===name&&!board.background_image?'ring-2 ring-[#0c66e4] ring-offset-2':''}`} style={{background:gradient}}/>)}</div><h3 className="mb-2 text-sm font-bold">Imagem do dispositivo</h3><label className="flex cursor-pointer items-center justify-center gap-2 rounded border-2 border-dashed border-[#8590a2] p-5 text-sm hover:bg-[#f1f2f4]"><ImagePlus size={18}/> Enviar imagem<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event=>{const file=event.target.files?.[0];if(file)upload(file)}}/></label><p className="mt-2 text-xs text-[#626f86]">PNG, JPEG ou WebP, até 1,5 MB.</p>{board.background_image&&<button disabled={busy} onClick={()=>run(()=>send(`/boards/${board.id}/background`,'DELETE'))} className="mt-4 rounded bg-[#f1f2f4] px-3 py-2 text-sm">Remover imagem</button>}</div>}
      {panel==='copy'&&<form onSubmit={async event=>{event.preventDefault();if(!copyTitle.trim())return;setBusy(true);try{const copied=await send<Board>(`/boards/${board.id}/copy`,'POST',{title:copyTitle});router.push(`/board/${copied.id}`)}catch(err){setError((err as Error).message)}finally{setBusy(false)}}}><p className="mb-3 text-sm text-[#626f86]">Copia listas, cartões, etiquetas, checklist, atribuições, descrição e fundo. Comentários e histórico não são copiados.</p><label htmlFor="copy-board-title" className="mb-1 block text-sm font-semibold">Nome do novo quadro</label><input id="copy-board-title" autoFocus maxLength={160} value={copyTitle} onChange={e=>setCopyTitle(e.target.value)} className="mb-4 w-full rounded border border-[#8590a2] px-3 py-2 text-sm"/><button disabled={busy||!copyTitle.trim()} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white">Criar cópia</button></form>}
    </div></Modal>}
  </>;
}
function MenuButton({icon,label,onClick,danger=false}:{icon:React.ReactNode;label:string;onClick:()=>void;danger?:boolean}){return <button onClick={onClick} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#f1f2f4] ${danger?'text-[#ae2a19]':''}`}>{icon}{label}</button>}
