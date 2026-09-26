'use client';

import { useState } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Archive, ChevronLeft, ChevronRight, GripVertical, MoreHorizontal, Plus, X } from 'lucide-react';
import { api, send, Board, Card, List } from '@/lib/api';
import { AutomationControls } from './automations';

const colors: Record<string,string> = {
  blue:'#579dff', green:'#4bce97', yellow:'#f5cd47', orange:'#fea362',
  red:'#f87168', purple:'#9f8fef', pink:'#e774bb', teal:'#60c6d2',
};
type Action = (action: string, payload?: Record<string,unknown>) => Promise<void>;

export function BoardList({list,lists,boards,onOpen,onAdd,onRename,onAction,renderCard,query,statusFilter,fieldFilter}: {
  list:List; lists:List[]; boards:Board[]; onOpen:(card:Card)=>void;
  onAdd:(listId:string,text:string,position:number)=>Promise<void>; onRename:(listId:string,title:string)=>Promise<void>;
  onAction:Action; renderCard:(card:Card)=>React.ReactNode; query:string; statusFilter:'all'|'open'|'completed';fieldFilter:string;
}) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:`list:${list.id}`,data:{type:'list',list}});
  const [adding,setAdding]=useState(false);
  const [title,setTitle]=useState('');
  const [insertPosition,setInsertPosition]=useState<number|null>(null);
  const [editing,setEditing]=useState(false);
  const [listTitle,setListTitle]=useState(list.title);
  const [menu,setMenu]=useState(false);
  const [section,setSection]=useState<'main'|'copy'|'move'|'cards'|'sort'|'archived'>('main');
  const [targetBoard,setTargetBoard]=useState(list.board_id);
  const [targetList,setTargetList]=useState('');
  const [copyTitle,setCopyTitle]=useState(`${list.title} (cópia)`);
  const [insertTitle,setInsertTitle]=useState('');
  const [inserting,setInserting]=useState(false);
  const [archivedCards,setArchivedCards]=useState<{id:string;title:string}[]>([]);
  const [busy,setBusy]=useState(false);
  const [actionError,setActionError]=useState('');
  const visible=list.cards.filter(card=>{const [fieldId,expected]=fieldFilter.split(':');const checkbox=fieldFilter===''||Boolean(card.custom_values?.find(value=>value.field_id===fieldId)?.value)===(expected==='true');return checkbox&&(statusFilter==='all'||card.completed===(statusFilter==='completed'))&&(card.title.toLowerCase().includes(query.toLowerCase())||card.description?.toLowerCase().includes(query.toLowerCase()))});
  const close=()=>{setMenu(false);setSection('main')};
  async function act(action:string,payload?:Record<string,unknown>) {
    setBusy(true);
    try { await onAction(action,payload); setActionError(''); close(); }
    catch(err) { setActionError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function showArchived() {
    try { setArchivedCards(await api<{id:string;title:string}[]>(`/lists/${list.id}/cards/archived`)); setSection('archived'); setActionError(''); }
    catch(err) { setActionError((err as Error).message); }
  }
  const openComposer=(position:number)=>{setInsertPosition(position);setAdding(true);setMenu(false)};
  const menuButton=(label:string,click:()=>void,destructive=false)=><button type="button" onClick={click} className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[#e9eaed] ${destructive?'text-[#ae2a19]':''}`}>{label}</button>;
  return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition,opacity:isDragging?.5:1,borderTop:list.color?`5px solid ${colors[list.color]}`:undefined}} className={`relative flex max-h-full shrink-0 flex-col rounded-xl bg-[#f1f2f4] shadow-sm ${list.collapsed?'w-14':'w-[272px] sm:w-[280px]'}`}>
    <div className={`flex shrink-0 items-center gap-1 px-2 pb-2 pt-2 ${list.collapsed?'flex-col':''}`}>
      <button type="button" {...attributes} {...listeners} title="Arrastar lista" className="rounded p-1 text-[#626f86] hover:bg-[#dfe1e6]"><GripVertical size={16}/></button>
      {!list.collapsed&&(editing?<form className="min-w-0 flex-1" onSubmit={async e=>{e.preventDefault();if(listTitle.trim())await onRename(list.id,listTitle);setEditing(false)}}><input autoFocus value={listTitle} onChange={e=>setListTitle(e.target.value)} onBlur={()=>{if(listTitle.trim()&&listTitle!==list.title)void onRename(list.id,listTitle);setEditing(false)}} className="w-full rounded border border-[#388bff] px-2 py-1 text-sm font-semibold"/></form>:<button type="button" onClick={()=>{setListTitle(list.title);setEditing(true)}} className="min-w-0 flex-1 truncate px-1 text-left text-sm font-bold" title="Renomear lista">{list.title}</button>)}
      <button type="button" onClick={()=>void act('collapse',{collapsed:!list.collapsed})} title={list.collapsed?'Expandir lista':'Recolher lista'} className="rounded p-1 text-[#44546f] hover:bg-[#dfe1e6]">{list.collapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>
      <button type="button" onClick={()=>setMenu(!menu)} aria-label={`Menu da lista ${list.title}`} className="rounded p-1 text-[#44546f] hover:bg-[#dfe1e6]"><MoreHorizontal size={18}/></button>
    </div>
    {list.collapsed?<div className="flex min-h-28 flex-col items-center gap-2 pb-3"><span className="rounded bg-white px-1 text-xs">{list.cards.length}</span><span className="text-sm font-bold [writing-mode:vertical-rl]">{list.title}</span></div>:<>
      <div className="scrollbar-thin min-h-1 space-y-1 overflow-y-auto px-2 pb-2">
        <button onClick={()=>openComposer(0)} className="w-full rounded px-2 py-1 text-left text-xs text-[#626f86] hover:bg-[#dfe1e6]"><Plus size={12} className="mr-1 inline"/>Inserir no início</button>
        <SortableContext items={list.cards.map(card=>'card:'+card.id)} strategy={verticalListSortingStrategy}>
          {visible.map(card=><div key={card.id} className="group relative"><button onClick={()=>openComposer(list.cards.findIndex(item=>item.id===card.id))} className="w-full rounded px-2 py-0.5 text-left text-[11px] text-[#626f86] hover:bg-[#dfe1e6] sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100">+ Inserir antes</button><div onDoubleClick={()=>onOpen(card)}>{renderCard(card)}</div></div>)}
        </SortableContext>
      </div>
      <div className="shrink-0 px-2 pb-2">{adding?<form onSubmit={async e=>{e.preventDefault();if(!title.trim())return;setBusy(true);try{await onAdd(list.id,title,insertPosition??list.cards.length);setTitle('');setActionError('')}catch(err){setActionError((err as Error).message)}finally{setBusy(false)}}}>
        <textarea autoFocus value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit()}}} placeholder="Uma linha por cartão; cole várias linhas para criar em massa" rows={3} className="w-full resize-none rounded-lg border-0 bg-white p-3 text-sm shadow-card"/>
        <p className="mt-1 text-[11px] text-[#626f86]">Cada linha vira um cartão. Datas como 25/12/2026 no título definem o prazo.</p>
        {insertPosition!==null&&<p className="mt-1 text-xs text-[#626f86]">Posição {insertPosition+1} na lista</p>}
        {actionError&&<p role="alert" className="mt-1 text-xs text-[#ae2a19]">{actionError}</p>}
        <div className="mt-2 flex items-center gap-2"><button disabled={busy||!title.trim()} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white">{title.trim().split(/\r?\n/).filter(Boolean).length>1?'Adicionar cartões':'Adicionar cartão'}</button><button type="button" onClick={()=>setAdding(false)} className="rounded p-1 hover:bg-[#dfe1e6]"><X size={20}/></button></div>
      </form>:<button onClick={()=>openComposer(list.cards.length)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[#44546f] hover:bg-[#dfe1e6]"><Plus size={18}/> Adicionar um cartão</button>}</div>
    </>}
    {menu&&<div className="absolute left-0 top-10 z-30 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-[#dfe1e6] bg-white p-2 text-[#172b4d] shadow-dialog">
      <div className="mb-2 flex items-center justify-between border-b border-[#dfe1e6] pb-1"><strong className="truncate text-sm">{list.title}</strong><button onClick={close} aria-label="Fechar menu"><X size={16}/></button></div>
      {actionError&&<p role="alert" className="mb-2 rounded bg-[#ffebe6] p-2 text-xs text-[#ae2a19]">{actionError}</p>}
      {section==='main'&&<>
        <AutomationControls boardId={list.board_id} listId={list.id}/>
        {menuButton('Renomear',()=>{setListTitle(list.title);setEditing(true);close()})}
        {menuButton('Adicionar cartão',()=>openComposer(list.cards.length))}
        {menuButton('Adicionar cartão no início',()=>openComposer(0))}
        {menuButton('Adicionar lista à direita',()=>setInserting(true))}
        {inserting&&<form onSubmit={async e=>{e.preventDefault();if(insertTitle.trim()){await act('insert',{title:insertTitle,position:lists.findIndex(item=>item.id===list.id)+1});setInsertTitle('');setInserting(false)}}} className="p-1"><input autoFocus value={insertTitle} onChange={e=>setInsertTitle(e.target.value)} placeholder="Nome da lista" maxLength={160} className="w-full rounded border px-2 py-1 text-sm"/><button className="mt-1 rounded bg-[#0c66e4] px-2 py-1 text-xs text-white">Criar</button></form>}
        {menuButton('Mover lista para a esquerda',()=>void act('reorder',{position:Math.max(0,lists.findIndex(item=>item.id===list.id)-1)}))}
        {menuButton('Mover lista para a direita',()=>void act('reorder',{position:Math.min(lists.length-1,lists.findIndex(item=>item.id===list.id)+1)}))}
        {menuButton('Mover para outro quadro',()=>{setTargetBoard(boards.find(board=>board.id!==list.board_id)?.id||list.board_id);setSection('move')})}
        {menuButton('Copiar lista',()=>setSection('copy'))}
        {menuButton('Ações dos cartões',()=>setSection('cards'))}
        {menuButton('Ordenar cartões',()=>setSection('sort'))}
        {menuButton('Cartões arquivados',()=>void showArchived())}
        <div className="mt-2 border-t border-[#dfe1e6] pt-2"><p className="px-2 text-xs font-semibold">Cor da lista</p><div className="flex flex-wrap gap-1 p-2"><button onClick={()=>void act('color',{color:null})} title="Sem cor" className="h-6 w-6 rounded border border-[#8590a2] bg-white">×</button>{Object.entries(colors).map(([key,color])=><button key={key} onClick={()=>void act('color',{color:key})} title={key} className="h-6 w-6 rounded" style={{background:color,outline:list.color===key?'2px solid #172b4d':undefined}}/>)}</div></div>
        {menuButton('Arquivar lista',()=>void act('archive'),true)}
      </>}
      {section==='move'&&<form onSubmit={e=>{e.preventDefault();void act('move',{board_id:targetBoard})}} className="space-y-2"><p className="text-xs">Mover lista e cartões para:</p><select value={targetBoard} onChange={e=>setTargetBoard(e.target.value)} className="w-full rounded border p-2 text-sm">{boards.filter(board=>board.id!==list.board_id).map(board=><option key={board.id} value={board.id}>{board.title}</option>)}</select><button disabled={busy||targetBoard===list.board_id} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm text-white">Mover</button></form>}
      {section==='copy'&&<form onSubmit={e=>{e.preventDefault();if(copyTitle.trim())void act('copy',{board_id:targetBoard,title:copyTitle})}} className="space-y-2"><input value={copyTitle} onChange={e=>setCopyTitle(e.target.value)} maxLength={160} className="w-full rounded border p-2 text-sm"/><select value={targetBoard} onChange={e=>setTargetBoard(e.target.value)} className="w-full rounded border p-2 text-sm">{boards.map(board=><option key={board.id} value={board.id}>{board.title}</option>)}</select><button disabled={busy||!copyTitle.trim()} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm text-white">Criar cópia</button></form>}
      {section==='cards'&&<><p className="mb-2 text-xs">Mover todos os cartões para:</p><select value={targetList} onChange={e=>setTargetList(e.target.value)} className="w-full rounded border p-2 text-sm"><option value="">Selecione a lista</option>{lists.filter(item=>item.id!==list.id).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><button disabled={busy||!targetList} onClick={()=>void act('moveCards',{list_id:targetList})} className="mt-2 w-full rounded bg-[#0c66e4] px-3 py-1.5 text-sm text-white">Mover todos</button>{menuButton('Arquivar todos os cartões',()=>{if(confirm('Arquivar todos os cartões desta lista?'))void act('archiveCards')},true)}</>}
      {section==='sort'&&<>{[['title','Título (A–Z)'],['due','Prazo mais próximo'],['newest','Mais recentes'],['oldest','Mais antigos']].map(([key,label])=><button key={key} onClick={()=>void act('sort',{by:key})} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[#e9eaed]">{label}</button>)}</>}
      {section==='archived'&&<><p className="mb-2 text-xs">Cartões arquivados nesta lista</p>{archivedCards.length===0?<p className="text-xs text-[#626f86]">Nenhum cartão arquivado.</p>:archivedCards.map(card=><div key={card.id} className="flex items-center gap-2 border-t py-2 text-xs"><span className="min-w-0 flex-1 truncate">{card.title}</span><button onClick={()=>void act('restoreCard',{card_id:card.id})} className="text-[#0c66e4]">Restaurar</button><button onClick={()=>{if(confirm(`Excluir definitivamente “${card.title}”?`))void act('deleteCard',{card_id:card.id})}} className="text-[#ae2a19]">Excluir</button></div>)}</>}
      {section!=='main'&&menuButton('← Voltar',()=>setSection('main'))}
    </div>}
  </div>;
}

export function ArchivedLists({boardId,onChanged}: {boardId:string;onChanged:()=>Promise<void>}) {
  const [open,setOpen]=useState(false);
  const [items,setItems]=useState<(List&{card_count:number})[]>([]);
  const [error,setError]=useState('');
  async function refresh(){try{setItems(await api<(List&{card_count:number})[]>(`/boards/${boardId}/lists/archived`));setError('')}catch(err){setError((err as Error).message)}}
  async function action(id:string,kind:'restore'|'delete') {
    if(kind==='delete'&&!confirm('Excluir permanentemente esta lista e seus cartões?'))return;
    try { await send(`/lists/${id}${kind==='restore'?'/restore':''}`,kind==='restore'?'POST':'DELETE'); await refresh(); await onChanged(); }
    catch(err){setError((err as Error).message)}
  }
  return <div className="relative"><button onClick={()=>{setOpen(!open);if(!open)void refresh()}} className="flex items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-white/20"><Archive size={15}/> <span className="hidden sm:inline">Arquivadas</span></button>{open&&<div className="absolute right-0 top-9 z-40 max-h-[70vh] w-72 overflow-y-auto rounded-lg bg-white p-3 text-[#172b4d] shadow-dialog"><div className="mb-2 flex justify-between"><strong className="text-sm">Listas arquivadas</strong><button onClick={()=>setOpen(false)} aria-label="Fechar"><X size={16}/></button></div>{error&&<p className="text-xs text-[#ae2a19]">{error}</p>}{items.length===0?<p className="text-xs text-[#626f86]">Nenhuma lista arquivada.</p>:items.map(item=><div key={item.id} className="border-t py-2 text-sm"><p className="font-semibold">{item.title} <span className="font-normal text-[#626f86]">({item.card_count})</span></p><div className="mt-1 flex gap-3 text-xs"><button onClick={()=>void action(item.id,'restore')} className="text-[#0c66e4]">Restaurar</button><button onClick={()=>void action(item.id,'delete')} className="text-[#ae2a19]">Excluir definitivamente</button></div></div>)}</div>}</div>;
}
