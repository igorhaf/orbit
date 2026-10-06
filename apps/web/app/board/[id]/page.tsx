'use client';
import { CardActivityIndicator, CardExecutionBadge } from '@/components/card-execution';
import { use, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DndContext, DragEndEvent, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Star, Plus, X, Search, Users, Check, CheckSquare, AlignLeft, MessageSquare, Pencil, ChevronLeft, Archive, Trash2, Play, MoveRight } from 'lucide-react';
import { api, send, Board, List, Card, CustomField, User, getToken, boardColors, cardUrl, labelColors, labelTextColor, clearSession, setUser as cacheUser } from '@/lib/api';
import { AppHeader, Avatar, CreateBoardModal, Modal, WorkspaceSidebar, useConfirmModal } from '@/components/ui';
import { remember } from '@/lib/history';
import { boardCollisionDetection } from '@/lib/board-drag';
import { CardDialog } from '@/components/card-dialog';
import { BoardTools } from '@/components/board-tools';
import { BoardList, ArchivedLists } from '@/components/board-list';
import { BulkCardActions } from '@/components/bulk-card-actions';
import { CardOperations } from '@/components/card-operations';
import { io } from 'socket.io-client';

function linkPreview(raw:string){
  try{
    const url=new URL(raw),host=url.hostname.replace(/^www\./,'');
    if(host==='youtube.com'||host==='m.youtube.com'||host==='youtu.be'){
      const video=host==='youtu.be'?url.pathname.slice(1):url.searchParams.get('v');
      if(video&&/^[\w-]{11}$/.test(video))return {service:'YouTube',title:'Vídeo do YouTube',detail:url.pathname,thumbnail:`https://i.ytimg.com/vi/${video}/hqdefault.jpg`};
    }
    if(host==='github.com'){
      const [owner,repo]=url.pathname.split('/').filter(Boolean);
      if(owner&&repo)return {service:'GitHub',title:`${owner} / ${repo}`,detail:'Repositório GitHub',thumbnail:null};
    }
    if(host==='figma.com')return {service:'Figma',title:decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1)||'Arquivo Figma').replace(/-/g,' '),detail:'Arquivo de design',thumbnail:null};
    return {service:host,title:decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1)||host).replace(/[-_]/g,' ').slice(0,100),detail:url.href,thumbnail:null};
  }catch{return {service:'Link',title:raw,detail:raw,thumbnail:null}}
}

function CardFace({card,listColor,fields=[],onClick,onMirrorToggle,onTitleChange,onContextAction,selected=false,renameSelected=false,onRenameSelect,dragging=false}: {card:Card;listColor?:string|null;fields?:CustomField[];onClick:(event:React.MouseEvent)=>void;onMirrorToggle?:(card:Card)=>void;onTitleChange?:(card:Card)=>void;onContextAction?:(action:'edit'|'archive'|'delete'|'execute'|'move',card:Card)=>void;selected?:boolean;renameSelected?:boolean;onRenameSelect?:(card:Card)=>void;dragging?:boolean}) {
  const [editingTitle,setEditingTitle]=useState(false);
  const [title,setTitle]=useState(card.title);
  const [locallyRenameSelected,setLocallyRenameSelected]=useState(false);
  const [contextOpen,setContextOpen]=useState(false);
  const [contextPosition,setContextPosition]=useState<{top:number;left:number}|null>(null);
  const [contextAnchor,setContextAnchor]=useState<{x:number;y:number}|null>(null);
  const contextButton=useRef<HTMLButtonElement>(null);
  const contextMenu=useRef<HTMLDivElement>(null);
  const titleInput=useRef<HTMLInputElement>(null);
  const isCardControl=(target:EventTarget|null)=>{
    if(!(target instanceof Element))return false;
    const card=target.closest('.kanban-card');
    const control=target.closest('button,input,textarea,select,a,[role="button"]');
    return Boolean(card&&control&&card.contains(control));
  };
  useEffect(()=>{if(editingTitle)titleInput.current?.select()},[editingTitle]);
  useEffect(()=>{const select=(event:Event)=>setLocallyRenameSelected((event as CustomEvent<string>).detail===card.id);window.addEventListener('card:rename-select',select);return()=>window.removeEventListener('card:rename-select',select)},[card.id]);
  useEffect(()=>{const edit=(event:Event)=>{if((event as CustomEvent<string>).detail!==card.id)return;setTitle(card.title);setEditingTitle(true)};window.addEventListener('card:edit-title',edit);return()=>window.removeEventListener('card:edit-title',edit)},[card.id,card.title]);
  useEffect(()=>{
    if(!contextOpen)return;
    const close=(event:PointerEvent)=>{
      if(!contextButton.current?.contains(event.target as Node)&&!contextMenu.current?.contains(event.target as Node)){
        setContextOpen(false);
        setContextPosition(null);
        setContextAnchor(null);
      }
    };
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[contextOpen]);
  useLayoutEffect(()=>{
    if(!contextOpen||!contextAnchor||!contextMenu.current)return;
    const menu=contextMenu.current.getBoundingClientRect();
    const padding=8;
    const gap=4;
    const fitsBelow=contextAnchor.y+gap+menu.height<=window.innerHeight-padding;
    const top=fitsBelow?contextAnchor.y+gap:contextAnchor.y-gap-menu.height;
    const left=Math.min(Math.max(padding,contextAnchor.x+gap),window.innerWidth-padding-menu.width);
    setContextPosition({top:Math.max(padding,top),left});
  },[contextAnchor,contextOpen]);
  if(card.kind==='separator')return <div onClick={onClick} className={`my-2 flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-widest text-[#44546f] ${selected?'rounded ring-2 ring-[#0c66e4]':''}`}><span className="h-px flex-1 bg-[#8590a2]"/>Separador<span className="h-px flex-1 bg-[#8590a2]"/></div>;
  if(card.kind==='board')return <button onClick={onClick} className={`w-full rounded-lg bg-[#172b4d] p-3 text-left text-sm font-bold text-white shadow-card hover:bg-[#25436f] ${selected?'ring-2 ring-[#0c66e4]':''}`}><span className="block text-[10px] font-normal uppercase tracking-wide text-white/70">Quadro vinculado</span>{card.target_board_title||card.title}</button>;
  if(card.kind==='link'){
    const preview=linkPreview(card.link_url||card.title);
    return <button onClick={onClick} className={`w-full overflow-hidden rounded-lg bg-white text-left shadow-card hover:ring-2 hover:ring-[#388bff] ${selected?'ring-2 ring-[#0c66e4]':''}`}>{preview.thumbnail&&<div className="h-28 bg-cover bg-center" style={{backgroundImage:`url("${preview.thumbnail}")`}}/>}<div className="p-3"><span className="block text-[10px] font-semibold uppercase text-[#626f86]">{preview.service} · Link externo</span><span className="mt-1 block truncate text-sm font-semibold text-[#0c66e4]">{preview.title}</span><span className="mt-1 block truncate text-[11px] text-[#626f86]">{preview.detail} ↗</span></div></button>;
  }
  function finishTitle(){setEditingTitle(false);if(title.trim()&&title.trim()!==card.title){if(onTitleChange)onTitleChange({...card,title:title.trim()});else void send(`/cards/${card.id}`,'PATCH',{title:title.trim()}).then(()=>window.dispatchEvent(new Event('data:changed'))).catch(()=>setTitle(card.title))}else setTitle(card.title)}
  return <div data-card-id={card.id} onKeyDown={event=>{if(event.key==='F2'&&!isCardControl(event.target)){event.preventDefault();window.dispatchEvent(new CustomEvent<string>('card:rename-select',{detail:card.id}));setTitle(card.title);setEditingTitle(true)}}} onClick={event=>{if(editingTitle||isCardControl(event.target))return;onClick(event)}} onDoubleClick={event=>{event.preventDefault();event.stopPropagation();window.dispatchEvent(new CustomEvent<string>('card:rename-select',{detail:card.id}));if(!dragging){onRenameSelect?.(card);setTitle(card.title);setEditingTitle(true)}}} className={`kanban-card group relative cursor-pointer overflow-visible rounded-lg bg-white shadow-card transition hover:ring-2 hover:ring-[#388bff] ${contextOpen?'z-[100]':''} ${selected||renameSelected||locallyRenameSelected?'ring-2 ring-[#0c66e4]':''} ${dragging?'rotate-2 shadow-xl':''}`}>
    <div className="px-3 py-2">{(card.kind==='template'||card.kind==='mirror')&&<div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-[#626f86]"><span>{card.kind==='template'?'MODELO':card.mirror_expanded?`ESPELHO · ${card.source_board_title||'Quadro original'}`:'ESPELHO'}</span>{card.kind==='mirror'&&<button onClick={event=>{event.stopPropagation();onMirrorToggle?.(card)}} className="rounded bg-[#e9eaed] px-1.5 py-0.5 text-[#172b4d]">{card.mirror_expanded?'Recolher':'Expandir'}</button>}</div>}{(card.kind!=='mirror'||card.mirror_expanded)&&<div className="mb-1 flex flex-wrap gap-1">{card.labels?.map(label=><span key={label.id} className="min-h-2 min-w-9 rounded-sm px-1.5 text-[10px] font-semibold" style={{background:labelColors[label.color]||label.color,color:labelTextColor(label.color)}}>{label.name}</span>)}</div>}
<div className={`text-[14px] leading-5 ${card.completed?'line-through text-[#626f86]':''}`}>{card.completed&&<Check size={14} className="mr-1 inline rounded-full bg-[#baf3db] text-[#216e4e]"/>}{editingTitle?<input ref={titleInput} autoFocus value={title} maxLength={300} onChange={event=>setTitle(event.target.value)} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onBlur={finishTitle} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur()}if(event.key==='Escape'){setTitle(card.title);setEditingTitle(false)}}} className="w-[calc(100%-1.5rem)] rounded border border-[#388bff] px-1 outline-none" aria-label="Título do cartão"/>:card.title}<span className="relative float-right mt-1 flex items-center gap-1"><button ref={contextButton} type="button" aria-label="Ações do cartão" aria-expanded={contextOpen} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setContextAnchor({x:event.clientX,y:event.clientY});setContextPosition({top:event.clientY+4,left:event.clientX+4});setContextOpen(open=>!open)}} className="rounded p-0.5 opacity-0 hover:bg-[#e9eaed] group-hover:opacity-100 focus:opacity-100"><Pencil size={13}/></button>{contextOpen&&contextPosition&&<div ref={contextMenu} role="menu" style={{position:'fixed',top:contextPosition.top,left:contextPosition.left}} className="z-[200] w-48 rounded-md border border-[#dfe1e6] bg-white py-1 text-[#172b4d] shadow-lg" onPointerDown={event=>event.stopPropagation()} onMouseLeave={()=>{setContextOpen(false);setContextPosition(null);setContextAnchor(null)}}>{([{id:'edit',label:'Editar título',icon:Pencil},{id:'move',label:'Mover',icon:MoveRight},{id:'execute',label:'Executar',icon:Play},{id:'archive',label:'Arquivar',icon:Archive},{id:'delete',label:'Excluir permanentemente',icon:Trash2}] as const).map(item=>{const Icon=item.icon;return <button key={item.id} role="menuitem" type="button" onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setContextOpen(false);setContextPosition(null);setContextAnchor(null);if(item.id==='edit'){setTitle(card.title);setEditingTitle(true)}else onContextAction?.(item.id,card)}} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[#f1f2f4] ${item.id==='delete'?'text-[#ae2a19]':''}`}><Icon size={14}/>{item.label}</button>})}</div>}<CardActivityIndicator card={card}/></span></div>
      <CardExecutionBadge card={card} listColor={listColor ? labelColors[listColor] || listColor : undefined}/>
      {(card.kind!=='mirror'||card.mirror_expanded)&&<>{Boolean(card.custom_values?.length)&&<div className="mt-2 flex flex-wrap gap-1">{card.custom_values?.map(entry=>{const field=fields.find(current=>current.id===entry.field_id)||entry;if(!field)return null;const value=entry.value===true?'✓':entry.value===false?'Não':field.type==='date'?new Date(String(entry.value)).toLocaleDateString('pt-BR'):String(entry.value);return <span key={entry.field_id} className="max-w-full truncate rounded bg-[#e9eaed] px-1.5 py-0.5 text-[10px] text-[#44546f]">{field.name}: {value}</span>})}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#626f86]">{card.description&&<AlignLeft size={13}/>} {card.comment_count>0&&<span className="inline-flex items-center gap-1"><MessageSquare size={13}/>{card.comment_count}</span>}{card.assigned_to_me&&<span className="ml-auto"><Avatar name="Igor" size="sm"/></span>}{card.checklist_total>0&&<span className={`inline-flex items-center gap-1 rounded px-1 ${card.checklist_done===card.checklist_total?'bg-[#baf3db] text-[#216e4e]':''}`}><CheckSquare size={13}/>{card.checklist_done}/{card.checklist_total}</span>}</div></>}
    </div>
  </div>;
}
function SortableCard({card,listColor,fields,onOpen,onMirrorToggle,onTitleChange,onContextAction,selected,renameSelected=false,onRenameSelect}: {card:Card;listColor?:string|null;fields:CustomField[];onOpen:(card:Card,event:React.MouseEvent)=>void;onMirrorToggle:(card:Card)=>void;onTitleChange?:(card:Card)=>void;onContextAction:(action:'edit'|'archive'|'delete'|'execute'|'move',card:Card)=>void;onFileDrop?:(card:Card,files:FileList)=>void;selected:boolean;renameSelected?:boolean;onRenameSelect?:(card:Card)=>void}) {const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:`card:${card.id}`,data:{type:'card',card}});return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition,opacity:isDragging?.35:1,zIndex:50}} {...attributes} {...listeners}><CardFace card={card} listColor={listColor} fields={fields} onClick={event=>onOpen(card,event)} onMirrorToggle={onMirrorToggle} onTitleChange={onTitleChange} onContextAction={onContextAction} selected={selected} renameSelected={renameSelected} onRenameSelect={onRenameSelect} dragging={isDragging}/></div>}
export default function BoardPage({params}:{params:Promise<{id:string}>}) {
  const droppedFiles=(...args:unknown[])=>void args;
  const lastCardTitleClick=useRef<{cardId:string;left:number;top:number;right:number;bottom:number;time:number}|null>(null);
  const pendingCardOpen=useRef<number|null>(null);
  const {confirm,confirmationModal}=useConfirmModal();
  const {id}=use(params);const router=useRouter();const [board,setBoard]=useState<Board|null>(null);const [boards,setBoards]=useState<Board[]>([]);const [user,setUser]=useState<User|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [create,setCreate]=useState(false);const [activeCard,setActiveCard]=useState<Card|null>(null);const [newList,setNewList]=useState(false);const [listTitle,setListTitle]=useState('');const [selected,setSelected]=useState<Card|null>(null);const [selectedBoard,setSelectedBoard]=useState<Board|null>(null);const [moveCard,setMoveCard]=useState<Card|null>(null);const [selection,setSelection]=useState<string[]>([]);const [selectionMode,setSelectionMode]=useState(false);const [selectionAnchor,setSelectionAnchor]=useState<string|null>(null);const [renameSelectedCardId,setRenameSelectedCardId]=useState<string|null>(null);const [mergeId,setMergeId]=useState<string|null>(null);const [aiMerge,setAiMerge]=useState<{title:string;description:string;items:string[];listId:string}|null>(null);const [query,setQuery]=useState('');const [statusFilter,setStatusFilter]=useState<'all'|'open'|'completed'>('all');const [fieldFilter,setFieldFilter]=useState('');const [labelFilter,setLabelFilter]=useState('');const [dueFilter,setDueFilter]=useState('');const [invite,setInvite]=useState(false);const [inviteEmail,setInviteEmail]=useState('');const [inviteError,setInviteError]=useState('');const [renaming,setRenaming]=useState(false);const [boardTitle,setBoardTitle]=useState('');const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:8}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const load=useCallback(async()=>{try{const [b,all]=await Promise.all([api<Board>(`/boards/${id}`),api<Board[]>('/boards')]);if(b.is_inbox){router.replace('/boards');return}setBoard(b);setBoards(all);setBoardTitle(b.title);const params=new URLSearchParams(window.location.search),deepCard=params.get('card');if(deepCard){const found=b.lists?.flatMap(l=>l.cards).find(c=>c.id===deepCard);if(found?.url_token&&params.get('token')!==found.url_token)router.replace(cardUrl(id,found.id,found.url_token),{scroll:false});if(found?.kind==='mirror'&&found.source_board_id&&found.source_card_id){const source=await api<Board>(`/boards/${found.source_board_id}`);const original=source.lists?.flatMap(list=>list.cards).find(card=>card.id===found.source_card_id);if(original){setSelectedBoard(source);setSelected(original)}}else if(found){setSelectedBoard(null);setSelected(found)}}setError('')}catch(err){setError((err as Error).message)}finally{setLoading(false)}},[id,router]);
  useEffect(()=>{if(!getToken()){router.push('/');return}api<User>('/auth/me').then(u=>{setUser(u);cacheUser(u);load()}).catch(()=>{clearSession();router.push('/')});const refresh=()=>load();window.addEventListener('data:changed',refresh);return()=>window.removeEventListener('data:changed',refresh)},[load,router]);
  useEffect(()=>{const socket=io({path:'/socket.io',auth:{token:getToken()}});socket.on('connect',()=>socket.emit('board:join',id));socket.on('board:changed',(event:{boardId?:string})=>{if(event.boardId===id)void load();});socket.on('comment:changed',(event:{boardId?:string})=>{if(event.boardId===id)void load();});socket.on('notification:changed',()=>void load());socket.on('prompt:progress',(event:{boardId?:string;cardId:string;status:'queued'|'running'|'success'|'error'})=>{if(event.boardId!==id)return;const update=(current:Board|null)=>current?{...current,lists:current.lists?.map(list=>({...list,cards:list.cards.map(card=>card.id===event.cardId?{...card,prompt:{...card.prompt,status:event.status}}:card)}))}:current;setBoard(update);setSelected(current=>current?.id===event.cardId?{...current,prompt:{...current.prompt,status:event.status}}:current);if(event.status==='success'||event.status==='error')void load();});return()=>{socket.emit('board:leave',id);socket.disconnect();};},[id,load]);
  useEffect(()=>{if(!mergeId)return;const timeout=window.setTimeout(()=>setMergeId(null),5*60*1000);return()=>window.clearTimeout(timeout)},[mergeId]);
  useEffect(()=>{const select=(event:Event)=>setRenameSelectedCardId((event as CustomEvent<string>).detail);window.addEventListener('card:rename-select',select);return()=>window.removeEventListener('card:rename-select',select)},[]);
  useEffect(()=>{if(renameSelectedCardId)window.dispatchEvent(new CustomEvent<string>('card:rename-select',{detail:renameSelectedCardId}))},[renameSelectedCardId]);
  useEffect(()=>{
    const handleClick=(event:MouseEvent)=>{
      const target=event.target instanceof Element?event.target:null;
      const last=lastCardTitleClick.current;
      const now=performance.now();
      if(last&&now-last.time<=500&&event.clientX>=last.left&&event.clientX<=last.right&&event.clientY>=last.top&&event.clientY<=last.bottom){
        lastCardTitleClick.current=null;
        if(pendingCardOpen.current!==null){window.clearTimeout(pendingCardOpen.current);pendingCardOpen.current=null}
        event.preventDefault();
        event.stopPropagation();
        setSelected(null);
        setSelectedBoard(null);
        window.history.replaceState(null,'',`/board/${id}`);
        window.dispatchEvent(new CustomEvent<string>('card:edit-title',{detail:last.cardId}));
        return;
      }
      const title=target?.closest<HTMLElement>('.kanban-card .leading-5');
      const card=title?.closest<HTMLElement>('.kanban-card');
      if(!target?.closest('button,input,textarea,select,a')&&title&&card?.dataset.cardId){
        const rect=title.getBoundingClientRect();
        lastCardTitleClick.current={cardId:card.dataset.cardId,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,time:now};
      }else lastCardTitleClick.current=null;
    };
    document.addEventListener('click',handleClick,true);
    return()=>{document.removeEventListener('click',handleClick,true);if(pendingCardOpen.current!==null)window.clearTimeout(pendingCardOpen.current)};
  },[id]);
  async function run(action:()=>Promise<unknown>){try{await action();await load();setError('')}catch(err){setError((err as Error).message)}}
  async function addList(e:React.FormEvent){e.preventDefault();if(!listTitle.trim())return;try{const created=await send<{id:string}>(`/boards/${id}/lists`,'POST',{title:listTitle});remember({label:'criar lista',undo:[{path:`/lists/${created.id}/archive`,method:'POST'}],redo:[{path:`/lists/${created.id}/restore`,method:'POST'}]});await load();setError('');setListTitle('');setNewList(false)}catch(err){setError((err as Error).message)}}
  async function addCard(listId:string,text:string,position:number){
    try {
      const created=await send<Card>(`/lists/${listId}/cards`,'POST',{title:text.trim(),position});
      remember({label:'criar cartão',undo:[{path:`/cards/${created.id}/archive`,method:'POST'}],redo:[{path:`/cards/${created.id}/restore`,method:'POST'}]});
      await load();setError('');
      return created;
    } catch(err) {setError((err as Error).message);throw err}
  }
  async function openCard(card:Card,event?:React.MouseEvent){
    if(selectionMode||event?.shiftKey||event?.ctrlKey||event?.metaKey){
      const all=board?.lists?.flatMap(list=>list.cards).map(item=>item.id)||[];
      const anchor=selectionAnchor||card.id;
      const range=event?.shiftKey?all.slice(Math.min(all.indexOf(anchor),all.indexOf(card.id)),Math.max(all.indexOf(anchor),all.indexOf(card.id))+1):[card.id];
      const next=event?.shiftKey?[...new Set([...selection,...range])]:selection.includes(card.id)?selection.filter(id=>id!==card.id):[...selection,card.id];
      if(next.length>20){setError('Selecione no máximo 20 cartões.');return}
      setSelection(next);setSelectionAnchor(card.id);return;
    }
    if(selection.length){setSelection([]);setSelectionAnchor(null)}
    if(card.kind==='separator')return;
    if(card.kind==='board'&&card.target_board_id){router.push(`/board/${card.target_board_id}`);return}
    if(card.kind==='link'&&card.link_url){window.open(card.link_url,'_blank','noopener,noreferrer');return}
    if(card.kind==='mirror'&&card.source_board_id&&card.source_card_id){
      try{const source=await api<Board>(`/boards/${card.source_board_id}`);const original=source.lists?.flatMap(list=>list.cards).find(item=>item.id===card.source_card_id);if(!original)throw new Error('Cartão original indisponível.');setSelectedBoard(source);setSelected(original)}catch(error){setError((error as Error).message)}return;
    }
    setSelectedBoard(null);setSelected(card);router.replace(cardUrl(id,card.id,card.url_token),{scroll:false});
  }
  function scheduleCardOpen(card:Card,event:React.MouseEvent){
    if(selectionMode||event.shiftKey||event.ctrlKey||event.metaKey){void openCard(card,event);return}
    if(pendingCardOpen.current!==null)window.clearTimeout(pendingCardOpen.current);
    pendingCardOpen.current=window.setTimeout(()=>{pendingCardOpen.current=null;void openCard(card)},500);
  }
  async function toggleMirror(card:Card){try{await send(`/cards/${card.id}`,'PATCH',{mirror_expanded:!card.mirror_expanded});await load()}catch(error){setError((error as Error).message)}}
  async function cardContextAction(action:'edit'|'archive'|'delete'|'execute'|'move',card:Card){
    if(action==='edit'){await openCard(card);return}
    if(action==='move'){setMoveCard(card);return}
    if(action==='execute'){
      try{
        await send(`/cards/${card.id}/prompt-runs`,'POST',{});
        await load();
        setError('');
      }catch(error){setError((error as Error).message)}
      return;
    }
    const permanent=action==='delete';
    confirm({title:permanent?'Excluir cartão definitivamente':'Arquivar cartão',description:permanent?`O cartão “${card.title}” será apagado permanentemente. Essa ação não pode ser desfeita.`:`Arquivar o cartão “${card.title}”?`,confirmLabel:permanent?'Excluir definitivamente':'Arquivar'},async()=>{try{await send(`/cards/${card.id}/archive`,'POST');if(permanent)await send(`/cards/${card.id}`,'DELETE');else remember({label:'arquivar cartão',undo:[{path:`/cards/${card.id}/restore`,method:'POST'}],redo:[{path:`/cards/${card.id}/archive`,method:'POST'}]});await load();setError('')}catch(error){setError((error as Error).message)}});
  }
  async function bulkAction(action:'move'|'copy'|'merge'|'archive',listId?:string,inbox=false){try{
    if(action==='merge'){const proposal=await send<{title:string;description:string;items:string[]}>('/cards/ai/merge','POST',{card_ids:selection});setAiMerge({...proposal,listId:listId||board!.lists?.[0]?.id||''});return}
    else if(action==='archive'){await Promise.all(selection.map(cardId=>send(`/cards/${cardId}/archive`,'POST')));remember({label:'arquivar cartões',undo:selection.map(cardId=>({path:`/cards/${cardId}/restore`,method:'POST'})),redo:selection.map(cardId=>({path:`/cards/${cardId}/archive`,method:'POST'}))});}
    else await send(`/cards/${action}`,'POST',{card_ids:selection,list_id:listId,inbox});
    setSelection([]);setSelectionMode(false);setSelectionAnchor(null);await load();setError('');
  }catch(error){setError((error as Error).message)}}
  async function acceptAiMerge(){if(!aiMerge)return;try{const result=await send<{id:string;card_id:string}>('/cards/merge','POST',{card_ids:selection,list_id:aiMerge.listId,title:aiMerge.title});await send(`/cards/${result.card_id}`,'PATCH',{description:aiMerge.description});if(aiMerge.items.length){const checklist=await send<{id:string}>(`/cards/${result.card_id}/checklists`,'POST',{title:'Checklist da mesclagem por IA'});await send(`/checklists/${checklist.id}/items`,'POST',{text:aiMerge.items.join('\n')})}setMergeId(result.id);setAiMerge(null);setSelection([]);setSelectionMode(false);setSelectionAnchor(null);await load()}catch(error){setError((error as Error).message)}}
  async function createBoard(title:string,background:string,workspaceId?:string){const b=await send<Board>('/boards','POST',{title,background,workspace_id:workspaceId});remember({label:'criar quadro',undo:[{path:`/boards/${b.id}/close`,method:'PATCH'}],redo:[{path:`/boards/${b.id}/reopen`,method:'PATCH'}]});router.push(`/board/${b.id}`)}
  async function toggleStar(){try{await send(`/boards/${id}`,'PATCH',{starred:!board!.starred});remember({label:board!.starred?'remover favorito':'favoritar quadro',undo:[{path:`/boards/${id}`,method:'PATCH',body:{starred:board!.starred}}],redo:[{path:`/boards/${id}`,method:'PATCH',body:{starred:!board!.starred}}]});await load()}catch(err){setError((err as Error).message)}}
  async function renameBoard(){if(!boardTitle.trim()||boardTitle===board?.title){setRenaming(false);return}const old=board!.title;try{await send(`/boards/${id}`,'PATCH',{title:boardTitle});remember({label:'renomear quadro',undo:[{path:`/boards/${id}`,method:'PATCH',body:{title:old}}],redo:[{path:`/boards/${id}`,method:'PATCH',body:{title:boardTitle}}]});setRenaming(false);await load()}catch(err){setError((err as Error).message)}}
  async function renameList(listId:string,title:string){const old=board?.lists?.find(l=>l.id===listId)?.title;if(!old||old===title)return;try{await send(`/lists/${listId}`,'PATCH',{title});remember({label:'renomear lista',undo:[{path:`/lists/${listId}`,method:'PATCH',body:{title:old}}],redo:[{path:`/lists/${listId}`,method:'PATCH',body:{title}}]});await load()}catch(err){setError((err as Error).message)}}
  async function listAction(list:List,action:string,payload:Record<string,unknown>={}) {
    try {
      const path=`/lists/${list.id}`;
      if(action==='insert') await send(`/boards/${id}/lists`,'POST',payload);
      else if(action==='reorder'||action==='color'||action==='collapse'||action==='completion') {
        const body=action==='reorder'?{position:payload.position}:action==='color'?{color:payload.color}:action==='completion'?{is_completion_list:payload.is_completion_list}:{collapsed:payload.collapsed};
        await send(path,'PATCH',body);
        const old=action==='reorder'?{position:board?.lists?.findIndex(item=>item.id===list.id)??0}:action==='color'?{color:list.color}:action==='completion'?{is_completion_list:list.is_completion_list}:{collapsed:list.collapsed};
        remember({label:'alterar lista',undo:[{path,method:'PATCH',body:old}],redo:[{path,method:'PATCH',body}]});
      }
      else if(action==='archive') { await send(`${path}/archive`,'POST'); remember({label:'arquivar lista',undo:[{path:`${path}/restore`,method:'POST'}],redo:[{path:`${path}/archive`,method:'POST'}]}); }
      else if(action==='move') await send(`${path}/move`,'POST',payload);
      else if(action==='copy') await send(`${path}/copy`,'POST',payload);
      else if(action==='moveCards') await send(`${path}/cards/move-all`,'POST',payload);
      else if(action==='archiveCards') await send(`${path}/cards/archive-all`,'POST');
      else if(action==='sort') await send(`${path}/cards/sort`,'POST',payload);
      else if(action==='restoreCard') await send(`/cards/${payload.card_id}/restore`,'POST');
      else if(action==='deleteCard') await send(`/cards/${payload.card_id}`,'DELETE');
      await load(); setError('');
    } catch(err) { setError((err as Error).message); throw err; }
  }
  async function moveToCollection(cardId:string,listId:string){
    const cardIds=selection.includes(cardId)?board?.lists?.flatMap(list=>list.cards).filter(card=>selection.includes(card.id)).map(card=>card.id)||[cardId]:[cardId];
    try{
      await send('/cards/move','POST',{card_ids:cardIds,list_id:listId});
      setSelection([]);setError('');
      window.dispatchEvent(new Event('data:changed'));
      await load();
    }catch(err){setError((err as Error).message);await load()}
  }
  function onDragEnd(event:DragEndEvent){setActiveCard(null);if(!board?.lists)return;const a=String(event.active.id);if(a.startsWith('card:')&&event.over?.data.current?.type==='collection'){void moveToCollection(a.slice(5),event.over.data.current.listId);return}if(a.startsWith('card:')&&event.over?.data.current?.type==='inbox'){void send('/cards/move','POST',{card_ids:[a.slice(5)],inbox:true}).then(()=>{setSelection([]);void load();window.dispatchEvent(new Event('data:changed'))}).catch(err=>{setError(err.message);void load()});return}if(!event.over)return;const o=String(event.over.id);if(a===o)return;
    if(a.startsWith('list:')){const lists=[...board.lists];const target=o.startsWith('card:')?lists.find(l=>l.cards.some(c=>`card:${c.id}`===o))?.id:o.startsWith('list:')?o.slice(5):undefined;const from=lists.findIndex(l=>`list:${l.id}`===a),to=lists.findIndex(l=>l.id===target);if(from<0||to<0)return;const [moved]=lists.splice(from,1);lists.splice(to,0,moved);setBoard({...board,lists});send(`/lists/${moved.id}`,'PATCH',{position:to}).then(()=>{remember({label:'mover lista',undo:[{path:`/lists/${moved.id}`,method:'PATCH',body:{position:from}}],redo:[{path:`/lists/${moved.id}`,method:'PATCH',body:{position:to}}]});load()}).catch(err=>{setError(err.message);load()});return}
    if(!a.startsWith('card:'))return;const cardId=a.slice(5);const lists=board.lists.map(l=>({...l,cards:[...l.cards]}));const source=lists.find(l=>l.cards.some(c=>c.id===cardId));const dest=o.startsWith('list:')?lists.find(l=>l.id===o.slice(5)):lists.find(l=>l.cards.some(c=>c.id===o.slice(5)));if(!source||!dest)return;if(selection.includes(cardId)&&selection.length>1){const ids=board.lists.flatMap(list=>list.cards).map(card=>card.id).filter(card=>selection.includes(card));const remaining=dest.cards.filter(card=>!selection.includes(card.id));const index=o.startsWith('card:')?remaining.findIndex(card=>card.id===o.slice(5)):remaining.length;send('/cards/move','POST',{card_ids:ids,list_id:dest.id,position:index<0?remaining.length:index}).then(()=>{setSelection([]);load()}).catch(err=>{setError(err.message);load()});return}const from=source.cards.findIndex(c=>c.id===cardId);const [moved]=source.cards.splice(from,1);const index=o.startsWith('card:')?dest.cards.findIndex(c=>c.id===o.slice(5)):dest.cards.length;dest.cards.splice(index<0?dest.cards.length:index,0,{...moved,list_id:dest.id});setBoard({...board,lists});const updates=Array.from(new Set([source,dest])).flatMap(l=>l.cards.map((c,i)=>send(`/cards/${c.id}`,'PATCH',{list_id:l.id,position:i})));Promise.all(updates).then(()=>{const affected=new Set([source.id,dest.id]);remember({label:'mover cartão',undo:board.lists!.filter(l=>affected.has(l.id)).flatMap(l=>l.cards.map(c=>({path:`/cards/${c.id}`,method:'PATCH' as const,body:{list_id:l.id,position:c.position}}))),redo:lists.filter(l=>affected.has(l.id)).flatMap(l=>l.cards.map((c,i)=>({path:`/cards/${c.id}`,method:'PATCH' as const,body:{list_id:l.id,position:i}})))});load()}).catch(err=>{setError(err.message);load()});
  }
  if(loading)return <div className="flex min-h-screen items-center justify-center bg-[#f7f8fa] text-[#626f86]">Carregando quadro...</div>;
  if(!board)return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f7f8fa]"><h1 className="text-xl font-bold">Quadro indisponível</h1><p className="text-sm text-[#626f86]">{error}</p><button onClick={()=>router.push('/')} className="rounded bg-[#0c66e4] px-4 py-2 text-white">Voltar aos quadros</button></div>;
  if(board.closed_at)return <div className="flex min-h-screen flex-col bg-[#f7f8fa]"><AppHeader user={user} boards={boards} onCreate={()=>setCreate(true)}/><main className="mx-auto w-full max-w-3xl p-6"><button onClick={()=>router.push('/boards')} className="mb-6 text-sm text-[#0c66e4]">← Seus quadros</button><div className="rounded-xl bg-white p-6 shadow-card"><div className="mb-4 flex items-center justify-between gap-3"><h1 className="text-2xl font-bold">{board.title}</h1><div className="rounded bg-[#172b4d] text-white"><BoardTools board={board} filters={{status:statusFilter,setStatus:setStatusFilter,field:fieldFilter,setField:setFieldFilter,label:labelFilter,setLabel:setLabelFilter,due:dueFilter,setDue:setDueFilter}} onChanged={load} onClosed={load} onDeleted={()=>router.push('/boards')}/></div></div><p className="mb-5 text-sm text-[#626f86]">Este quadro está fechado. Reabra-o para voltar a editar listas e cartões.</p><div className="flex flex-wrap gap-2"><button onClick={()=>run(()=>send(`/boards/${id}/reopen`,'PATCH'))} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white">Reabrir quadro</button><button onClick={()=>router.push(`/board/${id}/print`)} className="rounded bg-[#f1f2f4] px-4 py-2 text-sm">Visualizar impressão</button></div>{error&&<p role="alert" className="mt-4 text-sm text-[#ae2a19]">{error}</p>}</div></main></div>;
  const lists=board.lists||[];
return <DndContext sensors={sensors} collisionDetection={boardCollisionDetection} onDragStart={e=>{const id=String(e.active.id);if(id.startsWith('card:'))setActiveCard(lists.flatMap(l=>l.cards).find(c=>c.id===id.slice(5))||null)}} onDragEnd={onDragEnd} onDragCancel={()=>setActiveCard(null)}><div className="flex h-screen min-h-[500px] flex-col"><AppHeader user={user} boards={boards} onCreate={()=>setCreate(true)}/><div className="flex min-h-0 flex-1"><WorkspaceSidebar boards={boards} activeId={board.id} onCreate={()=>setCreate(true)} onChoose={boardId=>router.push(boardId?`/board/${boardId}`:'/boards')}/><div className="flex min-w-0 flex-1 flex-col" style={{background:board.background_image ? `linear-gradient(#0002,#0002),url("${board.background_image}") center/cover` : boardColors[board.background]||boardColors.blue}}><div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 bg-[#00000030] px-3 py-2 text-white sm:px-5"><button onClick={()=>router.push('/')} className="rounded p-1.5 hover:bg-white/20 lg:hidden" title="Voltar"><ChevronLeft size={20}/></button>{renaming?<form onSubmit={async e=>{e.preventDefault();await renameBoard()}}><input autoFocus value={boardTitle} onChange={e=>setBoardTitle(e.target.value)} onBlur={()=>setRenaming(false)} className="w-44 rounded border border-[#388bff] px-2 py-1 font-bold text-[#172b4d]"/></form>:<button onClick={()=>setRenaming(true)} title="Renomear quadro" className="max-w-[220px] truncate rounded px-2 py-1 text-left text-lg font-bold hover:bg-white/20 sm:max-w-[350px]">{board.title}</button>}<button onClick={toggleStar} className="rounded p-1.5 hover:bg-white/20" title={board.starred?'Remover estrela':'Adicionar estrela'}><Star size={17} fill={board.starred?'#f5cd47':'none'} color={board.starred?'#f5cd47':'white'}/></button><div className="hidden h-6 border-l border-white/40 sm:block"/><div className="flex-1"/><div className="relative hidden sm:block"><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filtrar cartões" className="w-36 rounded border border-white/40 bg-white/20 py-1 pl-7 pr-2 text-xs text-white placeholder:text-white/80"/></div><div className="hidden -space-x-2 sm:flex">{board.members?.slice(0,4).map(m=><Avatar key={m.id} name={m.name} size="sm"/>)}</div><button onClick={()=>router.push('/profile')} className="rounded bg-white px-3 py-1.5 text-sm font-semibold text-[#172b4d] hover:bg-[#f1f2f4]"><Users size={15} className="mr-1 inline"/><span className="hidden sm:inline">Meu perfil</span></button><button onClick={()=>{setSelectionMode(!selectionMode);setSelection([])}} className={`rounded px-2 py-1.5 text-xs font-semibold ${selectionMode?'bg-[#e9d8fd] text-[#5e2a96]':'bg-white/20 text-white hover:bg-white/30'}`}>{selectionMode?'Concluir seleção':'Selecionar'}</button><ArchivedLists boardId={id} onChanged={load}/><BoardTools board={board} filters={{status:statusFilter,setStatus:setStatusFilter,field:fieldFilter,setField:setFieldFilter,label:labelFilter,setLabel:setLabelFilter,due:dueFilter,setDue:setDueFilter}} onChanged={load} onClosed={load} onDeleted={()=>router.push('/boards')}/></div>{error&&<div role="alert" className="mx-4 mt-2 flex items-center justify-between rounded bg-[#ffebe6] px-3 py-2 text-sm text-[#ae2a19]">{error}<button onClick={()=>setError('')}><X size={16}/></button></div>}{selection.length>0&&<BulkCardActions board={board} boards={boards} count={selection.length} onCancel={()=>{setSelection([]);setSelectionMode(false)}} onAction={bulkAction}/>}{mergeId&&<div className="mx-3 mt-2 flex items-center gap-3 rounded bg-[#dffcf0] p-2 text-xs text-[#216e4e] sm:mx-5">Cartões mesclados. <button className="font-bold underline" onClick={async()=>{try{await send(`/card-merges/${mergeId}/undo`,'POST');setMergeId(null);await load()}catch(error){setError((error as Error).message)}}}>Desfazer agora</button><button onClick={()=>setMergeId(null)} aria-label="Fechar">×</button></div>}<div className="board-scroll flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden p-3 pb-5 sm:p-5"><SortableContext items={lists.map(l=>`list:${l.id}`)} strategy={horizontalListSortingStrategy}>{lists.map(list=><BoardList key={list.id} list={list} lists={lists} boards={boards} onOpen={card=>void openCard(card)} onAdd={addCard} onRename={renameList} onAction={(action,payload)=>listAction(list,action,payload)} renderCard={card=><SortableCard card={card} fields={board.custom_fields||[]} onOpen={(item,event)=>scheduleCardOpen(item,event)} onFileDrop={(item,files)=>void droppedFiles(item,files)} onMirrorToggle={item=>void toggleMirror(item)} onContextAction={(action,item)=>void cardContextAction(action,item)} selected={selection.includes(card.id)}/>} query={query} statusFilter={statusFilter} fieldFilter={fieldFilter} labelFilter={labelFilter} dueFilter={dueFilter}/>)}</SortableContext><DragOverlay style={{pointerEvents:'none'}}>{activeCard&&<div className="w-[272px]"><CardFace card={activeCard} fields={board.custom_fields||[]} onClick={()=>{}} dragging/></div>}</DragOverlay><div className="w-[272px] shrink-0 sm:w-[280px]">{newList?<form onSubmit={addList} className="rounded-xl bg-[#f1f2f4] p-2"><input autoFocus value={listTitle} onChange={e=>setListTitle(e.target.value)} placeholder="Insira o título da lista..." className="w-full rounded border border-[#388bff] px-3 py-2 text-sm"/><div className="mt-2 flex items-center gap-2"><button disabled={!listTitle.trim()} className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white">Adicionar lista</button><button type="button" onClick={()=>setNewList(false)} className="rounded p-1 hover:bg-[#dfe1e6]"><X size={20}/></button></div></form>:<button onClick={()=>setNewList(true)} className="flex w-full items-center gap-2 rounded-xl bg-white/25 px-3 py-3 text-left text-sm font-semibold text-white hover:bg-white/35"><Plus size={19}/> Adicionar outra lista</button>}</div></div></div></div>{aiMerge&&<Modal onClose={()=>setAiMerge(null)}><div className="p-6"><h2 className="text-lg font-bold">Proposta de mesclagem por IA</h2><input value={aiMerge.title} onChange={event=>setAiMerge({...aiMerge,title:event.target.value})} className="mt-4 w-full rounded border p-2 font-semibold"/><textarea value={aiMerge.description} onChange={event=>setAiMerge({...aiMerge,description:event.target.value})} className="mt-3 min-h-36 w-full rounded border p-2 text-sm"/><p className="mt-3 text-xs font-bold">Checklist</p><ul className="mt-1 list-disc pl-5 text-sm">{aiMerge.items.map((item,index)=><li key={index}>{item}</li>)}</ul><button onClick={()=>void acceptAiMerge()} className="mt-5 rounded bg-[#6554c0] px-3 py-2 text-sm font-bold text-white">Confirmar mesclagem</button></div></Modal>}{moveCard&&<Modal onClose={()=>setMoveCard(null)}><div className="w-[min(92vw,420px)] p-6"><h2 className="mb-1 text-lg font-bold">Mover cartão</h2><p className="mb-5 text-sm text-[#626f86]">Escolha o quadro e a lista de destino.</p><CardOperations card={moveCard} board={board} onChanged={load} onMoved={async()=>{setMoveCard(null);await load()}}/></div></Modal>}{selected&&<CardDialog card={selected} board={selectedBoard||board} onClose={()=>{setSelected(null);window.history.replaceState(null,'',`/board/${id}`)}} onChanged={async()=>{await load();const updated=await api<Board>(`/boards/${selectedBoard?.id||id}`);if(selectedBoard)setSelectedBoard(updated);const card=updated.lists?.flatMap(l=>l.cards).find(c=>c.id===selected.id);if(card)setSelected(card)}} onDeleted={async()=>{setSelected(null);await load()}}/>}{invite&&<Modal onClose={()=>setInvite(false)}><div className="p-6"><h2 className="mb-2 text-lg font-bold">Compartilhar quadro</h2><p className="mb-5 text-sm text-[#626f86]">Convide alguém que já possui uma conta usando o e-mail.</p><form onSubmit={async e=>{e.preventDefault();try{await send(`/boards/${id}/members`,'POST',{email:inviteEmail});await load();setInviteEmail('');setInvite(false);setInviteError('')}catch(err){setInviteError((err as Error).message)}}} className="flex gap-2"><input type="email" required value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="E-mail da pessoa" className="min-w-0 flex-1 rounded border border-[#8590a2] px-3 py-2 text-sm"/><button className="rounded bg-[#0c66e4] px-3 text-sm font-semibold text-white">Convidar</button></form>{inviteError&&<p role="alert" className="mt-2 rounded bg-[#ffebe6] p-2 text-xs text-[#ae2a19]">{inviteError}</p>}<div className="mt-6 border-t border-[#dfe1e6] pt-4"><h3 className="mb-3 text-sm font-bold">Membros do quadro</h3><div className="space-y-2">{board.members?.map(m=><div key={m.id} className="flex items-center gap-2"><Avatar name={m.name}/><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{m.name}</div><div className="truncate text-xs text-[#626f86]">{m.email}</div></div><span className="text-xs text-[#626f86]">{m.role==='owner'?'Proprietário':'Membro'}</span></div>)}</div></div></div></Modal>}{confirmationModal}{create&&<CreateBoardModal onClose={()=>setCreate(false)} onCreate={createBoard}/>}</div></DndContext>;
}
