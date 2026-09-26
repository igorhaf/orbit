'use client';
import { useEffect, useState } from 'react';
import { api, Board } from '@/lib/api';

export function BulkCardActions({board,boards,count,onCancel,onAction}: {board:Board;boards:Board[];count:number;onCancel:()=>void;onAction:(action:'move'|'copy'|'merge'|'archive',listId?:string,inbox?:boolean)=>Promise<void>}){
  const [targetBoardId,setTargetBoardId]=useState(board.id);
  const [remoteTarget,setRemoteTarget]=useState<Board|null>(null);
  const target=targetBoardId===board.id?board:remoteTarget;
  const [listId,setListId]=useState(board.lists?.[0]?.id||'');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{if(targetBoardId!==board.id)api<Board>(`/boards/${targetBoardId}`).then(value=>{setRemoteTarget(value);setListId(value.lists?.[0]?.id||'')}).catch(()=>{})},[targetBoardId,board.id]);
  async function act(action:'move'|'copy'|'merge'|'archive',inbox=false){setBusy(true);try{await onAction(action,listId,inbox)}finally{setBusy(false)}}
  return <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[#172b4d] p-2 text-xs text-white shadow-lg sm:mx-5">
    <strong>{count}/20 selecionados</strong><span className="hidden text-white/70 sm:inline">Ctrl/Cmd para alternar · Shift para selecionar intervalo</span>
    <select aria-label="Quadro de destino" value={targetBoardId} onChange={event=>{const next=event.target.value;setTargetBoardId(next);setListId(next===board.id?board.lists?.[0]?.id||'':'')}} className="max-w-32 rounded bg-white p-1.5 text-[#172b4d]">{boards.filter(item=>!item.is_inbox).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select>
    <select aria-label="Lista de destino" value={listId} onChange={event=>setListId(event.target.value)} className="max-w-32 rounded bg-white p-1.5 text-[#172b4d]">{target?.lists?.map(list=><option key={list.id} value={list.id}>{list.title}</option>)}</select>
    <button disabled={busy||!listId} onClick={()=>void act('move')} className="rounded bg-[#0c66e4] px-2 py-1.5 font-semibold">Mover</button><button disabled={busy||!listId} onClick={()=>void act('copy')} className="rounded bg-[#0c66e4] px-2 py-1.5 font-semibold">Copiar</button><button disabled={busy} onClick={()=>void act('copy',true)} className="rounded bg-[#0c66e4] px-2 py-1.5 font-semibold">Copiar para Inbox</button>
    {count>=2&&targetBoardId===board.id&&<button disabled={busy||!listId} onClick={()=>void act('merge')} className="rounded bg-[#af77e8] px-2 py-1.5 font-semibold">Mesclar</button>}<button disabled={busy} onClick={()=>void act('archive')} className="rounded bg-[#ae2a19] px-2 py-1.5 font-semibold">Arquivar</button>
    <button onClick={onCancel} className="ml-auto rounded px-2 py-1.5 hover:bg-white/20">Cancelar</button>
  </div>;
}
