'use client';
import { useEffect, useState } from 'react';
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, CheckSquare, GripVertical, Plus, Trash2 } from 'lucide-react';
import { api, Board, Card, ChecklistGroup, ChecklistItem, send } from '@/lib/api';

type Props={card:Card;board:Board;groups:ChecklistGroup[];mutate:(action:()=>Promise<unknown>)=>Promise<void>};
type CatalogEntry={id:string;title:string;card_title:string};
const localDate=(value:string)=>{const date=new Date(value),pad=(part:number)=>String(part).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`};

function Item({item,group,index,groups,board,mutate}: {item:ChecklistItem;group:ChecklistGroup;index:number;groups:ChecklistGroup[];board:Board;mutate:Props['mutate']}){
  const {attributes,listeners,setNodeRef,transform,transition}=useSortable({id:'item:'+item.id});
  const [text,setText]=useState(item.text);
  const path='/checklist-items/'+item.id;
  const update=(body:Record<string,unknown>)=>void mutate(()=>send(path,'PATCH',body));
  return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} className="rounded border border-[#dfe1e6] bg-white p-2 shadow-sm">
    <div className="flex items-start gap-2"><button type="button" {...attributes} {...listeners} aria-label="Arrastar item" className="mt-1 cursor-grab text-[#626f86]"><GripVertical size={15}/></button><input type="checkbox" checked={item.completed} onChange={event=>update({completed:event.target.checked})} className="mt-1"/><input value={text} onChange={event=>setText(event.target.value)} onBlur={()=>{if(text.trim()&&text!==item.text)update({text})}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} maxLength={300} aria-label="Texto do item" className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${item.completed?'text-[#626f86] line-through':''}`}/><button type="button" title="Converter em cartão" onClick={()=>{if(confirm('Converter este item em um cartão na mesma lista?'))void mutate(()=>send(path+'/convert','POST',{}))}} className="text-xs text-[#0c66e4]">Cartão</button><button type="button" title="Excluir item" onClick={()=>void mutate(()=>send(path,'DELETE'))} className="text-[#ae2a19]"><Trash2 size={14}/></button></div>
    <div className="mt-2 flex flex-wrap items-center gap-2 pl-7"><select value={item.assignee_id||''} onChange={event=>update({assignee_id:event.target.value||null})} aria-label="Responsável do item" className="max-w-36 rounded border border-[#dfe1e6] bg-white p-1 text-xs"><option value="">Sem responsável</option>{board.members?.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select><input type="datetime-local" value={item.due_date?localDate(item.due_date):''} onChange={event=>update({due_date:event.target.value?new Date(event.target.value).toISOString():null})} aria-label="Prazo do item" className="max-w-44 rounded border border-[#dfe1e6] bg-white p-1 text-xs"/><select value={group.id} onChange={event=>update({checklist_id:event.target.value})} aria-label="Mover para checklist" className="max-w-36 rounded border border-[#dfe1e6] bg-white p-1 text-xs">{groups.map(current=><option key={current.id} value={current.id}>{current.title}</option>)}</select><button type="button" title="Mover item para cima" disabled={index===0} onClick={()=>update({position:index-1})} className="disabled:opacity-30"><ArrowUp size={13}/></button><button type="button" title="Mover item para baixo" disabled={index===group.items.length-1} onClick={()=>update({position:index+1})} className="disabled:opacity-30"><ArrowDown size={13}/></button></div>
  </div>;
}

function Group({group,index,groups,board,mutate}: {group:ChecklistGroup;index:number;groups:ChecklistGroup[];board:Board;mutate:Props['mutate']}){
  const {attributes,listeners,setNodeRef,transform,transition}=useSortable({id:'group:'+group.id});
  const [title,setTitle]=useState(group.title);
  const [bulk,setBulk]=useState('');
  const progress=group.items.length?Math.round(group.items.filter(item=>item.completed).length/group.items.length*100):0;
  return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} className="rounded-lg border border-[#dfe1e6] bg-[#f7f8fa] p-3">
    <div className="flex items-center gap-2"><button type="button" {...attributes} {...listeners} title="Arrastar checklist" className="cursor-grab text-[#626f86]"><GripVertical size={16}/></button><input value={title} onChange={event=>setTitle(event.target.value)} onBlur={()=>{if(title.trim()&&title!==group.title)void mutate(()=>send('/checklists/'+group.id,'PATCH',{title}))}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} maxLength={160} aria-label="Nome do checklist" className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none"/><span className="text-xs text-[#626f86]">{progress}%</span><button type="button" title="Subir checklist" disabled={index===0} onClick={()=>void mutate(()=>send('/checklists/'+group.id,'PATCH',{position:index-1}))} className="disabled:opacity-30"><ArrowUp size={14}/></button><button type="button" title="Descer checklist" disabled={index===groups.length-1} onClick={()=>void mutate(()=>send('/checklists/'+group.id,'PATCH',{position:index+1}))} className="disabled:opacity-30"><ArrowDown size={14}/></button><button type="button" title="Excluir checklist" onClick={()=>{if(confirm('Excluir este checklist e todos os seus itens?'))void mutate(()=>send('/checklists/'+group.id,'DELETE'))}} className="text-[#ae2a19]"><Trash2 size={14}/></button></div>
    <div className="mt-2 h-2 overflow-hidden rounded bg-[#dfe1e6]"><div className="h-full bg-[#4bce97]" style={{width:progress+'%'}}/></div>
    <SortableContext items={group.items.map(item=>'item:'+item.id)} strategy={verticalListSortingStrategy}><div className="mt-3 space-y-2">{group.items.map((item,itemIndex)=><Item key={item.id+item.text} item={item} group={group} index={itemIndex} groups={groups} board={board} mutate={mutate}/>)}</div></SortableContext>
    <form onSubmit={async event=>{event.preventDefault();if(!bulk.trim())return;await mutate(()=>send('/checklists/'+group.id+'/items','POST',{text:bulk}));setBulk('')}} className="mt-3"><textarea value={bulk} onChange={event=>setBulk(event.target.value)} rows={2} placeholder="Adicionar item ou colar várias linhas" className="w-full resize-y rounded border border-[#dfe1e6] bg-white p-2 text-sm"/><button disabled={!bulk.trim()} className="mt-1 flex items-center gap-1 rounded bg-[#e9eaed] px-2 py-1 text-xs font-semibold disabled:opacity-50"><Plus size={13}/> Adicionar {bulk.includes('\n')?'itens':'item'}</button></form>
  </div>;
}

export function CardChecklists({card,board,groups,mutate}:Props){
  const [title,setTitle]=useState('Checklist');
  const [source,setSource]=useState('');
  const [catalog,setCatalog]=useState<CatalogEntry[]>([]);
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}));
  useEffect(()=>{api<CatalogEntry[]>('/boards/'+board.id+'/checklists/catalog').then(setCatalog).catch(()=>{})},[board.id,groups]);
  async function onDragEnd(event:DragEndEvent){
    const active=String(event.active.id),over=String(event.over?.id||'');if(!over||active===over)return;
    if(active.startsWith('group:')){const target=groups.findIndex(group=>'group:'+group.id===over);if(target>=0)await mutate(()=>send('/checklists/'+active.slice(6),'PATCH',{position:target}));return}
    if(!active.startsWith('item:'))return;
    const id=active.slice(5),sourceGroup=groups.find(group=>group.items.some(item=>item.id===id));
    const targetGroup=over.startsWith('group:')?groups.find(group=>group.id===over.slice(6)):groups.find(group=>group.items.some(item=>'item:'+item.id===over));
    if(!sourceGroup||!targetGroup)return;
    const targetIndex=over.startsWith('group:')?targetGroup.items.length:targetGroup.items.findIndex(item=>'item:'+item.id===over);
    await mutate(()=>send('/checklist-items/'+id,'PATCH',{checklist_id:targetGroup.id,position:targetIndex}));
  }
  return <section id="card-checklists"><h3 className="mb-3 flex items-center gap-2 font-semibold"><CheckSquare size={21}/> Checklists</h3><div className="space-y-3 sm:pl-8"><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={event=>void onDragEnd(event)}><SortableContext items={groups.map(group=>'group:'+group.id)} strategy={verticalListSortingStrategy}>{groups.map((group,index)=><Group key={group.id+group.title} group={group} index={index} groups={groups} board={board} mutate={mutate}/>)}</SortableContext></DndContext>
    <form onSubmit={async event=>{event.preventDefault();await mutate(()=>send('/cards/'+card.id+'/checklists','POST',{title,source_id:source||undefined}));setTitle('Checklist');setSource('')}} className="rounded-lg border border-dashed border-[#8590a2] p-3"><label className="block text-xs font-semibold">Novo checklist<input value={title} onChange={event=>setTitle(event.target.value)} maxLength={160} className="mt-1 w-full rounded border border-[#dfe1e6] px-2 py-1.5 text-sm"/></label><select value={source} onChange={event=>setSource(event.target.value)} aria-label="Copiar checklist existente" className="mt-2 w-full rounded border border-[#dfe1e6] bg-white p-1.5 text-xs"><option value="">Começar vazio</option>{catalog.map(entry=><option key={entry.id} value={entry.id}>Copiar {entry.title} — {entry.card_title}</option>)}</select><button disabled={!title.trim()} className="mt-2 rounded bg-[#0c66e4] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Criar checklist</button></form>
  </div></section>;
}
