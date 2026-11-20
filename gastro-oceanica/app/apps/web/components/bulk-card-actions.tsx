'use client';
import { useEffect, useState } from 'react';
import { api, Board } from '@/lib/api';

export function BulkCardActions({board,boards,count,onCancel,onAction}: {board:Board;boards:Board[];count:number;onCancel:()=>void;onAction:(action:'move'|'copy'|'merge'|'archive'|'delete',listId?:string,inbox?:boolean)=>Promise<void>}){
  const [targetBoardId,setTargetBoardId]=useState(board.id);
  const [remoteTarget,setRemoteTarget]=useState<Board|null>(null);
  const target=targetBoardId===board.id?board:remoteTarget;
  const [listId,setListId]=useState(board.lists?.[0]?.id||'');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{if(targetBoardId!==board.id)api<Board>(`/boards/${targetBoardId}`).then(value=>{setRemoteTarget(value);setListId(value.lists?.[0]?.id||'')}).catch(()=>{})},[targetBoardId,board.id]);
  async function act(action:'move'|'copy'|'merge'|'archive'|'delete',inbox=false){setBusy(true);try{await onAction(action,listId,inbox)}finally{setBusy(false)}}
  const control='min-w-0 rounded-lg border border-[#dfe1e6] bg-white px-2.5 py-2 text-xs text-[#172b4d]';
  const button='rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
  return <section aria-label="Ações dos cartões selecionados" className="mx-3 mt-2 rounded-xl border border-[#c7d2e2] bg-white p-3 text-[#172b4d] shadow-lg sm:mx-5">
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-auto"><strong className="block text-sm">{count} cartão{count===1?'':'ões'} selecionado{count===1?'':'s'}</strong><span className="text-[11px] text-[#626f86]">Use Ctrl/Cmd para alternar ou Shift para selecionar um intervalo · máximo 20</span></div>
      <button disabled={busy} onClick={()=>void act('archive')} className={`${button} bg-[#f1f2f4] text-[#172b4d] hover:bg-[#dfe1e6]`}>Arquivar</button>
      <button disabled={busy} onClick={()=>void act('delete')} className={`${button} bg-[#ffebe6] text-[#ae2a19] hover:bg-[#ffd5cc]`}>Excluir definitivamente</button>
      <button disabled={busy} onClick={onCancel} className={`${button} bg-transparent text-[#626f86] hover:bg-[#f1f2f4]`}>Cancelar</button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#dfe1e6] pt-3">
      <span className="text-[11px] font-semibold text-[#626f86]">Mover ou copiar</span>
      <select aria-label="Quadro de destino" value={targetBoardId} onChange={event=>{const next=event.target.value;setTargetBoardId(next);setListId(next===board.id?board.lists?.[0]?.id||'':'')}} className={`${control} max-w-40`}>{boards.filter(item=>!item.is_inbox).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select>
      <select aria-label="Lista de destino" value={listId} onChange={event=>setListId(event.target.value)} className={`${control} max-w-40`}>{target?.lists?.map(list=><option key={list.id} value={list.id}>{list.title}</option>)}</select>
      <button disabled={busy||!listId} onClick={()=>void act('move')} className={`${button} bg-[#e9f2ff] text-[#0c66e4] hover:bg-[#d6e7ff]`}>Mover</button><button disabled={busy} onClick={()=>void act('move',true)} className={`${button} bg-[#e9f2ff] text-[#0c66e4] hover:bg-[#d6e7ff]`}>Mover para Inbox</button><button disabled={busy||!listId} onClick={()=>void act('copy')} className={`${button} bg-[#e9f2ff] text-[#0c66e4] hover:bg-[#d6e7ff]`}>Copiar</button><button disabled={busy} onClick={()=>void act('copy',true)} className={`${button} bg-[#e9f2ff] text-[#0c66e4] hover:bg-[#d6e7ff]`}>Copiar para Inbox</button>
      {count>=2&&targetBoardId===board.id&&<button disabled={busy||!listId} onClick={()=>void act('merge')} className={`${button} bg-[#e9f2ff] text-[#0c66e4] hover:bg-[#d6e7ff]`}>Mesclar</button>}
    </div>
  </section>;
}
