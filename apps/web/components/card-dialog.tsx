'use client';
import { useEffect, useState } from 'react';
import { AlignLeft, Check, CheckSquare, Clock3, CreditCard, MessageSquare, MoveRight, Palette, Printer, Plus, Tag, Trash2, UserRound, X } from 'lucide-react';
import { api, send, Board, Card, CardDetails, ChecklistItem, getUser, labelColors, labelTextColor } from '@/lib/api';
import { remember } from '@/lib/history';
import { Avatar, Modal } from './ui';
import { MarkdownEditor, RichText } from './rich-text';
import { CardDatesPanel, CardLabelsPanel, CardMembersPanel } from './card-extras';

export function CardDialog({ card, board, onClose, onChanged, onDeleted }: {
  card: Card;
  board: Board;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [details,setDetails]=useState<CardDetails>({comments:[],checklist:[]});
  const [title,setTitle]=useState(card.title);
  const [description,setDescription]=useState(card.description||'');
  const [editingDescription,setEditingDescription]=useState(false);
  const [comment,setComment]=useState('');
  const [item,setItem]=useState('');
  const [itemDue,setItemDue]=useState('');
  const [assignNew,setAssignNew]=useState(false);
  const [addingItem,setAddingItem]=useState(false);
  const [panel,setPanel]=useState<'labels'|'date'|'members'|'cover'|'move'|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [previousCard,setPreviousCard]=useState(card);
  if (card !== previousCard) {
    setPreviousCard(card);
    setTitle(card.title);
    setDescription(card.description || '');
  }
  const user=getUser();
  const list=board.lists?.find(current=>current.id===card.list_id);
  const progress=details.checklist.length?Math.round(details.checklist.filter(current=>current.completed).length/details.checklist.length*100):0;

  async function loadDetails() {
    try {setDetails(await api<CardDetails>(`/cards/${card.id}/details`));}
    catch(err){setError((err as Error).message)}
  }
  useEffect(()=>{
    api<CardDetails>(`/cards/${card.id}/details`).then(setDetails).catch(err=>setError((err as Error).message));
  },[card.id]);
  async function run(action:()=>Promise<unknown>) {
    setBusy(true); setError('');
    try {await action();await Promise.all([onChanged(),loadDetails()]);return true;}
    catch(err){setError((err as Error).message);return false;}
    finally{setBusy(false)}
  }
  async function updateCard(body:Record<string,unknown>,undoBody:Record<string,unknown>,label:string) {
    let updated:Card|undefined;
    const success=await run(async()=>{updated=await send<Card>(`/cards/${card.id}`,'PATCH',body)});
    if(success){
      const recurring=body.completed===true&&Boolean(card.recurrence);
      const undo=recurring?{...undoBody,start_date:card.start_date,due_date:card.due_date}:undoBody;
      const redo=recurring?{completed:false,start_date:updated?.start_date,due_date:updated?.due_date}:body;
      remember({label,undo:[{path:`/cards/${card.id}`,method:'PATCH',body:undo}],redo:[{path:`/cards/${card.id}`,method:'PATCH',body:redo}]});
    }
    return success;
  }
  async function toggleChecklist(checklist:ChecklistItem) {
    const body={completed:!checklist.completed};
    const success=await run(()=>send(`/checklist/${checklist.id}`,'PATCH',body));
    if(success)remember({label:'marcar item',undo:[{path:`/checklist/${checklist.id}`,method:'PATCH',body:{completed:checklist.completed}}],redo:[{path:`/checklist/${checklist.id}`,method:'PATCH',body}]});
  }
  async function addChecklist(event:React.FormEvent) {
    event.preventDefault(); if(!item.trim())return;
    const success=await run(()=>send(`/cards/${card.id}/checklist`,'POST',{text:item,assigned:assignNew,due_date:itemDue||null}));
    if(success){setItem('');setItemDue('');setAssignNew(false)}
  }
  return <Modal onClose={onClose} wide><div className="max-h-[84vh] overflow-y-auto rounded-xl bg-[#f7f8fa] p-4 text-[#172b4d] sm:p-6">
    <div className="pr-9"><div className="flex items-start gap-3"><CreditCard size={22} className="mt-1 shrink-0"/><div className="min-w-0 flex-1">
      <input value={title} maxLength={300} onChange={e=>setTitle(e.target.value)} onBlur={()=>{if(title.trim()&&title!==card.title)updateCard({title},{title:card.title},'renomear cartão')}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} className="w-full rounded bg-transparent px-1 py-0.5 text-xl font-semibold outline-none hover:bg-[#e9eaed] focus:bg-white" aria-label="Título do cartão"/>
      <p className="mt-1 text-sm text-[#626f86]">na lista <button onClick={()=>setPanel('move')} className="underline hover:text-[#172b4d]">{list?.title}</button></p>
    </div></div></div>
    {error&&<div role="alert" className="mt-4 rounded bg-[#ffebe6] px-3 py-2 text-sm text-[#ae2a19]">{error}</div>}
    <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_170px]"><div className="min-w-0 space-y-7">
      <div className="flex flex-wrap gap-5 pl-1">
        {card.labels?.length>0&&<div><h3 className="mb-2 text-xs font-semibold text-[#626f86]">Etiquetas</h3><div className="flex flex-wrap gap-1">{card.labels.map(label=><button key={label.id} onClick={()=>setPanel('labels')} className="min-w-12 rounded px-2 py-1 text-xs font-semibold" style={{background:labelColors[label.color]||label.color,color:labelTextColor(label.color)}}>{label.name||'Sem nome'}</button>)}<button onClick={()=>setPanel('labels')} className="rounded bg-[#e9eaed] p-1.5"><Plus size={14}/></button></div></div>}
        {Boolean(card.assignees?.length)&&<div><h3 className="mb-2 text-xs font-semibold text-[#626f86]">Membros</h3><button onClick={()=>setPanel('members')} className="flex -space-x-1">{card.assignees?.map(member=><Avatar key={member.id} name={member.name} url={member.avatar_url} size="sm"/>)}</button></div>}
        <div><h3 className="mb-2 text-xs font-semibold text-[#626f86]">Status</h3><label className="flex items-center gap-2 rounded bg-[#e9eaed] px-2 py-1 text-sm"><input type="checkbox" checked={card.completed} onChange={e=>void updateCard({completed:e.target.checked},{completed:card.completed},e.target.checked?'concluir cartão':'reabrir cartão')}/><span className={card.completed?'font-semibold text-[#216e4e]':''}>{card.completed?'Concluído':'Em andamento'}</span></label></div>
        {(card.start_date||card.due_date)&&<div><h3 className="mb-2 text-xs font-semibold text-[#626f86]">Datas</h3><button onClick={()=>setPanel('date')} className="rounded bg-[#e9eaed] px-2 py-1 text-left text-xs">{card.start_date&&<span className="block">Início: {new Date(card.start_date).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</span>}{card.due_date&&<span className="block">Vence: {new Date(card.due_date).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</span>}{card.recurrence&&<span className="block text-[#0c66e4]">Recorrente: {({daily:'diário',weekly:'semanal',monthly:'mensal',yearly:'anual'} as const)[card.recurrence]}</span>}</button></div>}
      </div>
      <section><h3 className="mb-3 flex items-center gap-3 font-semibold"><AlignLeft size={21}/> Descrição</h3><div className="pl-0 sm:pl-8">{editingDescription?<div><MarkdownEditor value={description} onChange={setDescription} placeholder="Adicione contexto, links e imagens em Markdown..."/><div className="mt-2 flex gap-2"><button disabled={busy} onClick={async()=>{if(await updateCard({description},{description:card.description},'editar descrição'))setEditingDescription(false)}} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white">Salvar</button><button onClick={()=>{setDescription(card.description||'');setEditingDescription(false)}} className="rounded px-3 py-1.5 text-sm hover:bg-[#e9eaed]">Cancelar</button></div></div>:<div className="min-h-16 rounded bg-[#e9eaed] p-3 text-sm"><button onClick={()=>setEditingDescription(true)} className="mb-2 text-xs font-semibold text-[#0c66e4]">Editar descrição</button>{description?<RichText text={description}/>:<p>Adicione uma descrição mais detalhada...</p>}</div>}</div></section>
      <section><h3 className="mb-3 flex items-center gap-3 font-semibold"><CheckSquare size={21}/> Checklist {details.checklist.length>0&&<span className="text-sm font-normal text-[#626f86]">{progress}%</span>}</h3><div className="pl-0 sm:pl-8">
        {details.checklist.length>0&&<div className="mb-3 flex items-center gap-2"><span className="text-xs text-[#626f86]">{progress}%</span><div className="h-2 flex-1 overflow-hidden rounded bg-[#dfe1e6]"><div className="h-full rounded bg-[#4bce97] transition-all" style={{width:`${progress}%`}}/></div></div>}
        <div className="space-y-1">{details.checklist.map(checklist=><div key={checklist.id} className="group rounded px-1 py-1 hover:bg-[#e9eaed]"><div className="flex items-start gap-2"><input type="checkbox" checked={checklist.completed} onChange={()=>toggleChecklist(checklist)} className="mt-1"/><span className={`min-w-0 flex-1 break-words text-sm ${checklist.completed?'text-[#626f86] line-through':''}`}>{checklist.text}</span><button onClick={()=>run(()=>send(`/checklist/${checklist.id}`,'DELETE'))} className="opacity-0 group-hover:opacity-100" title="Excluir item"><X size={15}/></button></div><div className="ml-6 mt-1 flex flex-wrap items-center gap-2"><button onClick={()=>run(()=>send(`/checklist/${checklist.id}`,'PATCH',{assigned:checklist.assignee_id!==user?.id}))} className={`rounded px-2 py-0.5 text-[11px] ${checklist.assignee_id===user?.id?'bg-[#dfe1f8] text-[#403294]':'bg-[#e9eaed] text-[#626f86]'}`}>{checklist.assignee_id===user?.id?'Atribuído a você':'+ Atribuir a você'}</button><label className="flex items-center gap-1 text-[11px] text-[#626f86]"><Clock3 size={12}/><input type="date" value={checklist.due_date?new Date(checklist.due_date).toISOString().slice(0,10):''} onChange={e=>run(()=>send(`/checklist/${checklist.id}`,'PATCH',{due_date:e.target.value||null}))} className="max-w-31 rounded border border-[#dfe1e6] bg-white px-1 py-0.5 text-[11px]"/></label></div></div>)}</div>
        {addingItem?<form onSubmit={addChecklist} className="mt-2"><input autoFocus value={item} onChange={e=>setItem(e.target.value)} placeholder="Adicionar um item" className="w-full rounded border border-[#388bff] bg-white px-3 py-2 text-sm"/><div className="mt-2 flex flex-wrap items-center gap-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={assignNew} onChange={e=>setAssignNew(e.target.checked)}/> Atribuir a mim</label><input type="date" value={itemDue} onChange={e=>setItemDue(e.target.value)} className="rounded border border-[#8590a2] bg-white px-2 py-1 text-xs"/></div><div className="mt-2 flex gap-2"><button disabled={busy||!item.trim()} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white">Adicionar</button><button type="button" onClick={()=>setAddingItem(false)} className="rounded px-3 py-1.5 text-sm hover:bg-[#e9eaed]">Cancelar</button></div></form>:<button onClick={()=>setAddingItem(true)} className="mt-2 rounded bg-[#e9eaed] px-3 py-1.5 text-sm hover:bg-[#dfe1e6]">Adicionar um item</button>}
      </div></section>
      <section><h3 className="mb-3 flex items-center gap-3 font-semibold"><MessageSquare size={21}/> Atividade</h3><div className="pl-0 sm:pl-8"><form onSubmit={async e=>{e.preventDefault();if(!comment.trim())return;if(await run(()=>send(`/cards/${card.id}/comments`,'POST',{body:comment})))setComment('')}} className="flex items-start gap-2"><Avatar name={user?.name||'Você'} url={user?.avatar_url} size="sm"/><div className="min-w-0 flex-1"><textarea value={comment} onChange={e=>setComment(e.target.value)} rows={2} placeholder="Escreva um comentário... Use @igor para uma menção." className="w-full resize-y rounded border border-[#dfe1e6] bg-white p-3 text-sm shadow-card"/><button disabled={busy||!comment.trim()} className="mt-2 rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white">Salvar</button></div></form><div className="mt-5 space-y-4">{details.comments.map(current=><div key={current.id} className="flex items-start gap-2"><Avatar name={current.author_name} url={current.author_id===user?.id?user?.avatar_url:null} size="sm"/><div className="min-w-0 flex-1"><p className="text-sm"><strong>{current.author_name}</strong> <span className="text-xs text-[#626f86]">{new Date(current.created_at).toLocaleString('pt-BR')}</span></p><div className="mt-1 whitespace-pre-wrap rounded bg-white px-3 py-2 text-sm shadow-card"><RichText text={current.body}/></div>{current.author_id===user?.id&&<button onClick={()=>run(()=>send(`/comments/${current.id}`,'DELETE'))} className="mt-1 text-xs text-[#626f86] underline hover:text-[#ae2a19]">Excluir</button>}</div></div>)}</div></div></section>
    </div><aside className="space-y-4"><div><h4 className="mb-2 text-xs font-bold text-[#626f86]">Adicionar ao cartão</h4><div className="space-y-2">
      <button onClick={()=>run(()=>send(`/cards/${card.id}/assignee/toggle`,'POST'))} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><UserRound size={16}/>{card.assigned_to_me?'Remover atribuição':'Atribuir a mim'}</button><button onClick={()=>setPanel(panel==='members'?null:'members')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><UserRound size={16}/> Membros do cartão</button>
      <button onClick={()=>setPanel(panel==='labels'?null:'labels')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Tag size={16}/> Etiquetas</button>
      <button onClick={()=>setPanel(panel==='date'?null:'date')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Clock3 size={16}/> Datas</button>
      <button onClick={()=>setAddingItem(true)} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><CheckSquare size={16}/> Checklist</button>
      <button onClick={()=>setPanel(panel==='cover'?null:'cover')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Palette size={16}/> Capa</button>
    </div></div><div><h4 className="mb-2 text-xs font-bold text-[#626f86]">Ações</h4><div className="space-y-2"><button onClick={()=>updateCard({completed:!card.completed},{completed:card.completed},card.completed?'reabrir cartão':'concluir cartão')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Check size={16}/>{card.completed?'Reabrir cartão':'Concluir cartão'}</button><button onClick={()=>setPanel(panel==='move'?null:'move')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><MoveRight size={16}/> Mover</button><a href={`/board/${board.id}/print?card=${card.id}`} target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Printer size={16}/> Imprimir cartão</a><button onClick={async()=>{if(confirm(`Excluir o cartão “${card.title}”?`)){await send(`/cards/${card.id}`,'DELETE');await onDeleted()}}} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm text-[#ae2a19] hover:bg-[#ffebe6]"><Trash2 size={16}/> Excluir</button></div></div>
      {panel&&<div className="rounded-lg border border-[#dfe1e6] bg-white p-3 shadow-card"><div className="mb-3 flex items-center justify-between text-sm font-bold"><span>{panel==='labels'?'Etiquetas':panel==='date'?'Datas':panel==='members'?'Membros':panel==='cover'?'Capa':'Mover cartão'}</span><button onClick={()=>setPanel(null)}><X size={15}/></button></div>
        {panel==='labels'&&<CardLabelsPanel board={board} card={card} run={run}/>}
        {panel==='date'&&<CardDatesPanel key={String(card.start_date)+String(card.due_date)+String(card.recurrence)+String(card.reminder_minutes)} card={card} update={updateCard}/>}
        {panel==='members'&&<CardMembersPanel board={board} card={card} run={run}/>}
        {panel==='cover'&&<><div className="grid grid-cols-4 gap-1">{Object.entries(labelColors).filter(([color])=>color!=='none'&&!color.includes('_')).map(([color,hex])=><button key={color} aria-label={color} onClick={async()=>{if(await updateCard({cover_color:color},{cover_color:card.cover_color},'alterar capa'))setPanel(null)}} className="h-8 rounded" style={{background:hex}}/>)}</div><button onClick={async()=>{if(await updateCard({cover_color:null},{cover_color:card.cover_color},'remover capa'))setPanel(null)}} className="mt-2 w-full rounded bg-[#e9eaed] py-1.5 text-xs">Remover capa</button></>}
        {panel==='move'&&<div className="space-y-1">{board.lists?.map(target=><button key={target.id} disabled={target.id===card.list_id} onClick={async()=>{if(await updateCard({list_id:target.id,position:target.cards.length},{list_id:card.list_id,position:card.position},'mover cartão'))setPanel(null)}} className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-xs hover:bg-[#f1f2f4]">{target.title}{target.id===card.list_id&&<Check size={15}/>}</button>)}</div>}
      </div>}
    </aside></div>
  </div></Modal>;
}
