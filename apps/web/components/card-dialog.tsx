'use client';
import { useEffect, useState } from 'react';
import { AlignLeft, Check, CheckSquare, Clock3, CreditCard, MoveRight, Palette, Printer, Plus, Tag, Trash2, UserRound, X } from 'lucide-react';
import { api, send, Board, Card, CardDetails, getUser, labelColors, labelTextColor } from '@/lib/api';
import { remember } from '@/lib/history';
import { Avatar, Modal } from './ui';
import { MarkdownEditor, RichText } from './rich-text';
import { CardDatesPanel, CardLabelsPanel, CardMembersPanel } from './card-extras';
import { CardSections } from './card-sections';
import { CardOperations } from './card-operations';
import { CardComments } from './card-comments';
import { CardAi } from './card-ai';
import { PromptExecution } from './prompt-execution';

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
  const [contentTab,setContentTab]=useState<'description'|'execution'>('description');
  const [panel,setPanel]=useState<'labels'|'date'|'members'|'move'|null>(null);
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
  return <Modal onClose={onClose} wide><div className="max-h-[84vh] overflow-y-auto rounded-xl bg-[#f7f8fa] p-4 text-[#172b4d] sm:p-6">
    <div className="pr-9"><div className="flex items-start gap-3"><CreditCard size={22} className="mt-1 shrink-0"/><div className="min-w-0 flex-1">
      <input value={title} maxLength={300} onChange={e=>setTitle(e.target.value)} onBlur={()=>{if(title.trim()&&title!==card.title)updateCard({title},{title:card.title},'renomear cartão')}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} className="w-full rounded bg-transparent px-1 py-0.5 text-xl font-semibold outline-none hover:bg-[#e9eaed] focus:bg-white" aria-label="Título do cartão"/>
      <p className="mt-1 text-sm text-[#626f86]">na lista <button onClick={()=>setPanel('move')} className="underline hover:text-[#172b4d]">{list?.title}</button>{card.kind==='template'&&<span className="ml-2 rounded bg-[#e9d8fd] px-1.5 py-0.5 text-xs text-[#6e44a3]">Modelo</span>}</p>
    </div></div></div>
    {error&&<div role="alert" className="mt-4 rounded bg-[#ffebe6] px-3 py-2 text-sm text-[#ae2a19]">{error}</div>}
    <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_170px]"><div className="min-w-0 space-y-7">
      <div className="flex flex-wrap gap-5 pl-1">
        {card.labels?.length>0&&<div><h3 className="mb-2 text-xs font-semibold text-[#626f86]">Etiquetas</h3><div className="flex flex-wrap gap-1">{card.labels.map(label=><button key={label.id} onClick={()=>setPanel('labels')} className="min-w-12 rounded px-2 py-1 text-xs font-semibold" style={{background:labelColors[label.color]||label.color,color:labelTextColor(label.color)}}>{label.name||'Sem nome'}</button>)}<button onClick={()=>setPanel('labels')} className="rounded bg-[#e9eaed] p-1.5"><Plus size={14}/></button></div></div>}
        {Boolean(card.assignees?.length)&&<div><h3 className="mb-2 text-xs font-semibold text-[#626f86]">Membros</h3><button onClick={()=>setPanel('members')} className="flex -space-x-1">{card.assignees?.map(member=><Avatar key={member.id} name={member.name} url={member.avatar_url} size="sm"/>)}</button></div>}
        <div><h3 className="mb-2 text-xs font-semibold text-[#626f86]">Status</h3><label className="flex items-center gap-2 rounded bg-[#e9eaed] px-2 py-1 text-sm"><input type="checkbox" checked={card.completed} onChange={e=>void updateCard({completed:e.target.checked},{completed:card.completed},e.target.checked?'concluir cartão':'reabrir cartão')}/><span className={card.completed?'font-semibold text-[#216e4e]':''}>{card.completed?'Concluído':'Em andamento'}</span></label></div>
        {(card.start_date||card.due_date)&&<div><h3 className="mb-2 text-xs font-semibold text-[#626f86]">Datas</h3><button onClick={()=>setPanel('date')} className="rounded bg-[#e9eaed] px-2 py-1 text-left text-xs">{card.start_date&&<span className="block">Início: {new Date(card.start_date).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</span>}{card.due_date&&<span className="block">Vence: {new Date(card.due_date).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</span>}{card.recurrence&&<span className="block text-[#0c66e4]">Recorrente: {({daily:'diário',weekly:'semanal',monthly:'mensal',yearly:'anual'} as const)[card.recurrence]}</span>}</button></div>}
      </div>
      <section><div className="mb-3 flex gap-1 border-b border-[#dfe1e6]"><button onClick={()=>setContentTab('description')} className={`flex items-center gap-2 border-b-2 px-2 py-2 text-sm font-semibold ${contentTab==='description'?'border-[#0c66e4] text-[#0c66e4]':'border-transparent text-[#626f86]'}`}><AlignLeft size={18}/> Descrição</button><button onClick={()=>setContentTab('execution')} className={`flex items-center gap-2 border-b-2 px-2 py-2 text-sm font-semibold ${contentTab==='execution'?'border-[#0c66e4] text-[#0c66e4]':'border-transparent text-[#626f86]'}`}>Execução</button></div><div className={contentTab==='description'?'pl-0 sm:pl-8':'hidden'}>{editingDescription?<div><MarkdownEditor value={description} onChange={setDescription} placeholder="Adicione contexto, links e imagens em Markdown..."/><div className="mt-2 flex gap-2"><button disabled={busy} onClick={async()=>{if(await updateCard({description},{description:card.description},'editar descrição'))setEditingDescription(false)}} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white">Salvar</button><button onClick={()=>{setDescription(card.description||'');setEditingDescription(false)}} className="rounded px-3 py-1.5 text-sm hover:bg-[#e9eaed]">Cancelar</button></div></div>:<div className="min-h-16 rounded bg-[#e9eaed] p-3 text-sm"><button onClick={()=>setEditingDescription(true)} className="mb-2 text-xs font-semibold text-[#0c66e4]">Editar descrição</button>{description?<RichText text={description}/>:<p>Adicione uma descrição mais detalhada...</p>}</div>}</div><PromptExecution card={card} board={board} active={contentTab==='execution'}/></section>
      <CardAi card={card} board={board} onExecutionStart={()=>setContentTab('execution')} onChanged={onChanged} onApply={async text=>{const changed=await updateCard({description:text},{description:card.description},'aplicar sugestão de IA');if(changed){setDescription(text);await onChanged();}}}/>
      <CardSections key={card.id} card={card} board={board} onChanged={onChanged}/>
      <CardComments card={card} board={board} details={details} onChanged={onChanged} run={run} user={user}/>
    </div><aside className="space-y-4"><div><h4 className="mb-2 text-xs font-bold text-[#626f86]">Adicionar ao cartão</h4><div className="space-y-2">
      <button onClick={()=>run(()=>send(`/cards/${card.id}/assignee/toggle`,'POST'))} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><UserRound size={16}/>{card.assigned_to_me?'Remover atribuição':'Atribuir a mim'}</button><button onClick={()=>setPanel(panel==='members'?null:'members')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><UserRound size={16}/> Membros do cartão</button>
      <button onClick={()=>setPanel(panel==='labels'?null:'labels')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Tag size={16}/> Etiquetas</button>
      <button onClick={()=>setPanel(panel==='date'?null:'date')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Clock3 size={16}/> Datas</button>
      <button onClick={()=>document.getElementById('card-checklists')?.scrollIntoView({behavior:'smooth'})} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><CheckSquare size={16}/> Checklists</button>
      <button onClick={()=>document.getElementById('card-fields')?.scrollIntoView({behavior:'smooth'})} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Palette size={16}/> Campos</button><button onClick={()=>document.getElementById('card-attachments')?.scrollIntoView({behavior:'smooth'})} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Palette size={16}/> Anexos e capa</button>
    </div></div><div><h4 className="mb-2 text-xs font-bold text-[#626f86]">Ações</h4><div className="space-y-2"><button onClick={()=>updateCard({completed:!card.completed},{completed:card.completed},card.completed?'reabrir cartão':'concluir cartão')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Check size={16}/>{card.completed?'Reabrir cartão':'Concluir cartão'}</button><button onClick={()=>setPanel(panel==='move'?null:'move')} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><MoveRight size={16}/> Mover, copiar ou espelhar</button>{['normal','template'].includes(card.kind||'normal')&&<><button onClick={()=>run(()=>send(`/cards/${card.id}/template`,'PATCH',{template:card.kind!=='template'}))} className="w-full rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]">{card.kind==='template'?'Remover modelo':'Marcar como modelo'}</button>{card.kind==='template'&&<button onClick={()=>run(()=>send('/cards/copy','POST',{card_ids:[card.id],list_id:card.list_id}))} className="w-full rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]">Criar cartão deste modelo</button>}</>}<a href={`/board/${board.id}/print?card=${card.id}`} target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"><Printer size={16}/> Imprimir cartão</a><button onClick={async()=>{if(confirm(`Arquivar o cartão “${card.title}”?`)){try{await send(`/cards/${card.id}/archive`,'POST');await onDeleted()}catch(error){setError((error as Error).message)}}}} className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm text-[#ae2a19] hover:bg-[#ffebe6]"><Trash2 size={16}/> Arquivar</button></div></div>
      {panel&&<div className="rounded-lg border border-[#dfe1e6] bg-white p-3 shadow-card"><div className="mb-3 flex items-center justify-between text-sm font-bold"><span>{panel==='labels'?'Etiquetas':panel==='date'?'Datas':panel==='members'?'Membros':'Mover cartão'}</span><button onClick={()=>setPanel(null)}><X size={15}/></button></div>
        {panel==='labels'&&<CardLabelsPanel board={board} card={card} run={run}/>}
        {panel==='date'&&<CardDatesPanel key={String(card.start_date)+String(card.due_date)+String(card.recurrence)+String(card.reminder_minutes)} card={card} update={updateCard}/>}
        {panel==='members'&&<CardMembersPanel board={board} card={card} run={run}/>}
        {panel==='move'&&<CardOperations card={card} board={board} onChanged={onChanged} onMoved={onDeleted}/>}
      </div>}
    </aside></div>
  </div></Modal>;
}
