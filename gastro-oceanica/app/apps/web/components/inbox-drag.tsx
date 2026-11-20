'use client';
import {useDraggable,useDroppable} from '@dnd-kit/core';
import {GripVertical,Inbox} from 'lucide-react';
import type {Card} from '@/lib/api';
import {assignCardsToInbox} from '@/lib/inbox';
import {useState} from 'react';
export function InboxDragHandle({card,disabled=false}:{card:Card;disabled?:boolean}){
 const {attributes,listeners,setNodeRef,isDragging}=useDraggable({id:`card:${card.id}`,data:{type:'card',view:'structured',card},disabled});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function assign(){setBusy(true);setError('');try{await assignCardsToInbox([card])}catch(error){setError((error as Error).message)}finally{setBusy(false)}}
 return <span className="relative shrink-0"><button ref={setNodeRef} {...attributes} {...listeners} disabled={disabled||busy} type="button" onClick={()=>{if(!isDragging)void assign()}} aria-label={`Arrastar ${card.title} para o Inbox ou atribuir a mim`} title="Arraste para o Inbox ou clique para atribuir a você" style={{touchAction:'none'}} className={'flex min-h-11 min-w-11 cursor-grab items-center justify-center rounded text-[#626f86] hover:bg-[#e9f2ff] disabled:opacity-40 active:cursor-grabbing '+(isDragging?'opacity-40':'')}><GripVertical size={17}/></button>{error&&<span role="alert" className="absolute left-0 top-full z-30 w-56 max-w-[80vw] rounded border border-red-700 bg-white p-2 text-xs text-red-900">{error}</span>}</span>;
}
export function InboxDropTarget(){
 const {setNodeRef,isOver}=useDroppable({id:'inbox:toolbar',data:{type:'inbox'}});
 return <button type="button" onClick={()=>window.dispatchEvent(new Event('inbox:open'))} ref={setNodeRef} aria-label="Abrir meu Inbox; solte aqui para atribuir a você" className={'flex min-h-11 items-center gap-2 rounded-lg border border-white/40 px-3 text-sm lg:hidden '+(isOver?'bg-white text-[#0c66e4] ring-2 ring-white':'bg-white/20')}><Inbox size={17}/>Meu Inbox</button>;
}
