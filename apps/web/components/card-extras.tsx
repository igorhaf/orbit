'use client';

import { useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { Board, Card, Label, labelColors, labelTextColor, send } from '@/lib/api';
import { Avatar } from './ui';

type Run = (action:()=>Promise<unknown>)=>Promise<boolean>;
type Update = (body:Record<string,unknown>,undo:Record<string,unknown>,label:string)=>Promise<boolean>;

const toLocal=(date:string|null)=>{
  if(!date)return '';
  const value=new Date(date);
  const pad=(part:number)=>String(part).padStart(2,'0');
  return String(value.getFullYear())+'-'+pad(value.getMonth()+1)+'-'+pad(value.getDate())+'T'+pad(value.getHours())+':'+pad(value.getMinutes());
};

export function CardDatesPanel({card,update}: {card:Card;update:Update}) {
  const [start,setStart]=useState(toLocal(card.start_date));
  const [due,setDue]=useState(toLocal(card.due_date));
  const [reminder,setReminder]=useState(card.reminder_minutes===null?'':String(card.reminder_minutes));
  const [recurrence,setRecurrence]=useState(card.recurrence||'');
  const [error,setError]=useState('');
  async function save() {
    if(start&&due&&new Date(start)>new Date(due)){setError('A data inicial deve preceder o vencimento.');return}
    const body={start_date:start?new Date(start).toISOString():null,due_date:due?new Date(due).toISOString():null,
      reminder_minutes:due&&reminder!==''?Number(reminder):null,recurrence:due&&recurrence?recurrence:null};
    const undo={start_date:card.start_date,due_date:card.due_date,reminder_minutes:card.reminder_minutes,recurrence:card.recurrence};
    if(await update(body,undo,'alterar datas'))setError('');
  }
  return <div className="space-y-3 text-xs">
    <label className="block">Data inicial<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} className="mt-1 w-full rounded border border-[#8590a2] p-1.5"/></label>
    <label className="block">Vencimento<input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)} className="mt-1 w-full rounded border border-[#8590a2] p-1.5"/></label>
    <label className="block">Lembrete<select value={reminder} onChange={e=>setReminder(e.target.value)} disabled={!due} className="mt-1 w-full rounded border border-[#8590a2] p-1.5"><option value="">Sem lembrete</option><option value="0">No vencimento</option><option value="5">5 minutos antes</option><option value="10">10 minutos antes</option><option value="15">15 minutos antes</option><option value="30">30 minutos antes</option><option value="60">1 hora antes</option><option value="1440">1 dia antes</option><option value="2880">2 dias antes</option><option value="10080">1 semana antes</option></select></label>
    <label className="block">Repetir ao concluir<select value={recurrence} onChange={e=>setRecurrence(e.target.value)} disabled={!due} className="mt-1 w-full rounded border border-[#8590a2] p-1.5"><option value="">Não repetir</option><option value="daily">Diariamente</option><option value="weekly">Semanalmente</option><option value="monthly">Mensalmente</option><option value="yearly">Anualmente</option></select></label>
    {error&&<p role="alert" className="text-[#ae2a19]">{error}</p>}
    <button onClick={()=>void save()} className="w-full rounded bg-[#0c66e4] py-1.5 font-semibold text-white">Salvar datas</button>
  </div>;
}

export function CardLabelsPanel({board,card,run}: {board:Board;card:Card;run:Run}) {
  const [name,setName]=useState('');
  const [color,setColor]=useState('green');
  const [editing,setEditing]=useState<Label|null>(null);
  const [error,setError]=useState('');
  async function action(work:()=>Promise<unknown>) { if(await run(work))setError(''); }
  async function save(event:React.FormEvent) {
    event.preventDefault();
    if(name.trim().length>100){setError('O nome deve ter até 100 caracteres.');return}
    const path='/boards/'+board.id+'/labels'+(editing?'/'+editing.id:'');
    const success=await run(()=>send(path,editing?'PATCH':'POST',{name:name.trim(),color}));
    if(success){setEditing(null);setName('');setColor('green');setError('')}
  }
  return <div className="text-xs">
    <div className="max-h-44 space-y-1 overflow-y-auto">{board.labels?.map(label=><div key={label.id} className="flex items-center gap-1"><button onClick={()=>void action(()=>send('/cards/'+card.id+'/labels/'+label.id+'/toggle','POST'))} className="flex min-w-0 flex-1 items-center justify-between rounded px-2 py-1.5 text-left font-semibold" style={{background:labelColors[label.color]||label.color,color:labelTextColor(label.color)}}><span className="truncate">{label.name||'Sem nome'}</span>{card.labels?.some(selected=>selected.id===label.id)&&<Check size={14}/>}</button><button title="Editar etiqueta" onClick={()=>{setEditing(label);setName(label.name);setColor(label.color)}} className="rounded p-1 hover:bg-[#e9eaed]"><Pencil size={14}/></button><button title="Excluir etiqueta" onClick={()=>{if(confirm('Excluir esta etiqueta do quadro?'))void action(()=>send('/boards/'+board.id+'/labels/'+label.id,'DELETE'))}} className="rounded p-1 text-[#ae2a19] hover:bg-[#ffebe6]"><Trash2 size={14}/></button></div>)}</div>
    <form onSubmit={save} className="mt-3 border-t border-[#dfe1e6] pt-3"><label className="font-semibold">{editing?'Editar etiqueta':'Nova etiqueta'}</label><input value={name} onChange={e=>setName(e.target.value)} maxLength={100} placeholder="Nome opcional" className="mt-1 w-full rounded border border-[#8590a2] px-2 py-1.5"/><div className="mt-2 grid grid-cols-6 gap-1">{Object.entries(labelColors).map(([key,hex])=><button type="button" title={key==='none'?'Sem cor':key.replace('_',' ')} aria-label={key} key={key} onClick={()=>setColor(key)} className={'h-7 rounded '+(color===key?'ring-2 ring-[#0c66e4] ring-offset-1':'')} style={{background:hex}}/>)}</div>{error&&<p role="alert" className="mt-2 text-[#ae2a19]">{error}</p>}<div className="mt-3 flex gap-2"><button className="rounded bg-[#0c66e4] px-3 py-1.5 font-semibold text-white">{editing?'Salvar':'Criar'}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setName('');setColor('green')}} className="rounded bg-[#e9eaed] px-3 py-1.5">Cancelar</button>}</div></form>
  </div>;
}

export function CardMembersPanel({board,card,run}: {board:Board;card:Card;run:Run}) {
  return <div className="space-y-1 text-xs">{board.members?.map(member=><button key={member.id} onClick={()=>void run(()=>send('/cards/'+card.id+'/assignees/'+member.id+'/toggle','POST'))} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[#f1f2f4]"><Avatar name={member.name} url={member.avatar_url} size="sm"/><span className="min-w-0 flex-1 truncate">{member.name}</span>{card.assignees?.some(current=>current.id===member.id)&&<Check size={15}/>}</button>)}</div>;
}
