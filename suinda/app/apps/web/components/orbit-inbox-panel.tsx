'use client';

import { Modal } from './modal';

import { RecordBoardContext } from '@/plugins/record-cards/RecordBoardContext';

import { useCallback, useEffect, useState } from 'react';

import { useDroppable } from '@dnd-kit/core';

import { api, send, Board, Card, profileSimulationSocketAuth } from '@/lib/api';

import { CardDialog } from './card-dialog';

import { CardActivityIndicator } from './card-execution';

import { io } from 'socket.io-client';

type AssignedInboxCard={id:string;title:string;board_id:string;board_title:string};

export function InboxPanel({boards,dropId='inbox:panel'}:{boards:Board[];dropId?:string}) {
  const [inbox,setInbox]=useState<Board|null>(null),[assigned,setAssigned]=useState<AssignedInboxCard[]>([]);
  const [selected,setSelected]=useState<{card:Card;board:Board}|null>(null);
  const [title,setTitle]=useState(''),[error,setError]=useState(''),[transfer,setTransfer]=useState<Card|null>(null);
  const inboxId=boards.find(board=>board.is_inbox)?.id;
  const {setNodeRef:setInboxDropRef,isOver:isInboxOver}=useDroppable({id:dropId,data:{type:'inbox'}});
  const load=useCallback(async()=>{try{const [full,assigned]=await Promise.all([inboxId?api<Board>(`/boards/${inboxId}`):Promise.resolve(null),api<AssignedInboxCard[]>('/inbox/cards')]);setInbox(full);setAssigned(assigned);setError('')}catch(err){setError((err as Error).message)}},[inboxId]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const refresh=()=>void load();window.addEventListener('data:changed',refresh);return()=>{window.clearTimeout(timer);window.removeEventListener('data:changed',refresh)}},[load]);
 useEffect(()=>{const socket=io({path:'/socket.io',auth:profileSimulationSocketAuth()});socket.on('connect',()=>{if(inboxId)socket.emit('board:join',inboxId)});const refresh=()=>void load();socket.on('board:changed',refresh);socket.on('comment:changed',refresh);socket.on('prompt:progress',refresh);socket.on('notification:changed',refresh);socket.on('plugins:changed',refresh);socket.on('connect',refresh);return()=>{socket.disconnect()}},[inboxId,load]);
  useEffect(()=>{
    const over=(event:DragEvent)=>{if(event.dataTransfer?.types.includes('application/x-orbit-inbox-card')&&event.dataTransfer?.types.includes('application/x-orbit-inbox-owned'))event.preventDefault()};
    const drop=async(event:DragEvent)=>{const source=event.dataTransfer?.getData('application/x-orbit-inbox-card'),owned=event.dataTransfer?.getData('application/x-orbit-inbox-owned');const target=(event.target as Element|null)?.closest('[data-orbit-list]')?.getAttribute('data-orbit-list');if(!source||owned!=='1'||!target)return;event.preventDefault();try{await send('/cards/move','POST',{card_ids:[source],list_id:target});await load();window.dispatchEvent(new Event('data:changed'))}catch(err){setError((err as Error).message)}};
    document.addEventListener('dragover',over);document.addEventListener('drop',drop);return()=>{document.removeEventListener('dragover',over);document.removeEventListener('drop',drop)};
  },[load]);
  async function open(entry:AssignedInboxCard){try{const board=await api<Board>(`/boards/${entry.board_id}`);const card=board.lists?.flatMap(list=>list.cards).find(card=>card.id===entry.id);if(!card)throw new Error('Cartão não encontrado no quadro de origem.');setSelected({board,card});setError('')}catch(error){setError((error as Error).message)}}
  async function refreshSelected(){await load();if(selected)await open({id:selected.card.id,title:selected.card.title,board_id:selected.board.id,board_title:selected.board.title})}
  const ownCards=inbox?.lists?.flatMap(list=>list.cards)||[],ownedIds=new Set(ownCards.map(card=>card.id));
  const entries=[...ownCards.map(card=>({id:card.id,title:card.title,board_id:inbox!.id,board_title:'Inbox',card})),...assigned.filter(card=>!ownedIds.has(card.id)).map(card=>({...card,card:undefined}))];
  const collection=boards.find(board=>board.is_collection);
  return <><section ref={setInboxDropRef} data-orbit-inbox-drop className={`rounded-lg pt-1 ${isInboxOver?'bg-[#e9f2ff] ring-2 ring-[#0c66e4]':''}`}><p className="px-2 text-xs text-[#626f86]">Solte um cartão aqui para atribuir a você e acompanhá-lo no Inbox.</p><form onSubmit={async event=>{event.preventDefault();const list=inbox?.lists?.[0];if(!title.trim()||!list)return;try{await send(`/lists/${list.id}/cards`,'POST',{title});setTitle('');await load()}catch(err){setError((err as Error).message)}}} className="mt-2 px-2"><input aria-label="Adicionar cartão ao Inbox" disabled={!inbox?.lists?.[0]} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Adicionar um cartão" className="w-full rounded border border-[#8590a2] px-2 py-1.5 text-sm disabled:opacity-50"/></form><div className="mt-2 max-h-[calc(100vh-190px)] space-y-2 overflow-y-auto px-2">{entries.map(entry=><div key={entry.id} className="flex items-center gap-1 rounded bg-[#f1f2f4] px-2 py-1 shadow-sm"><button draggable onDragStart={event=>{event.dataTransfer.setData('application/x-orbit-inbox-card',entry.id);event.dataTransfer.setData('application/x-orbit-inbox-title',entry.title);if(entry.card)event.dataTransfer.setData('application/x-orbit-inbox-owned','1');event.dataTransfer.effectAllowed=entry.card?'move':'copyMove'}} onClick={()=>void open(entry)} className="min-h-11 min-w-0 flex-1 py-1 text-left text-sm hover:bg-[#e9eaed]"><span className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{entry.title}</span>{entry.card&&<CardActivityIndicator card={entry.card}/>}</span>{!entry.card&&<span className="block truncate text-[11px] text-[#626f86]">{entry.board_title} · atribuído a você</span>}</button>{collection&&entry.card&&<button title="Enviar para Coleções" onClick={()=>setTransfer(entry.card!)} className="rounded px-1 text-xs text-[#6554c0] hover:bg-[#e2dffc]">↗</button>}</div>)}{!entries.length&&<p className="py-3 text-xs text-[#626f86]">Sem itens</p>}</div>{error&&<p role="alert" className="px-2 pt-2 text-xs text-[#ae2a19]">{error}</p>}<p className="px-2 pt-2 text-[11px] text-[#626f86]">Os cartões atribuídos permanecem no seu quadro de origem.</p></section>{selected&&<CardDialog key={selected.card.id} card={selected.card} board={selected.board} recordContent={selected.board.record_scope&&selected.card.id===selected.board.record_scope.primary_card_id?<RecordBoardContext scope={selected.board.record_scope} onChanged={refreshSelected}/>:undefined} onClose={()=>setSelected(null)} onChanged={refreshSelected} onDeleted={async()=>{setSelected(null);await load()}}/>}{transfer&&collection&&<TransferCardModal card={transfer} target={collection} label="Enviar para Coleções" onClose={()=>setTransfer(null)} onDone={async()=>{setTransfer(null);await load();window.dispatchEvent(new Event('data:changed'))}}/>}</>;
}

export function TransferCardModal({card,target,label,onClose,onDone}:{card:Card;target:Board;label:string;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [listId,setListId]=useState(target.lists?.[0]?.id||''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(){if(!listId)return;setBusy(true);try{await send('/cards/move','POST',{card_ids:[card.id],list_id:listId});await onDone()}catch(err){setError((err as Error).message)}finally{setBusy(false)}}
  return <Modal onClose={onClose}><div className="p-5"><h2 className="text-lg font-bold">{label}</h2><p className="mt-1 text-sm text-[#626f86]">Escolha a categoria de destino.</p><select value={listId} onChange={event=>setListId(event.target.value)} className="mt-4 w-full rounded border p-2 text-sm">{target.lists?.map(list=><option key={list.id} value={list.id}>{list.title}</option>)}</select>{error&&<p className="mt-2 text-xs text-[#ae2a19]">{error}</p>}<button disabled={busy||!listId} onClick={()=>void submit()} className="mt-4 rounded bg-[#6554c0] px-4 py-2 text-sm font-semibold text-white">{busy?'Enviando…':'Enviar cartão'}</button></div></Modal>;
}
