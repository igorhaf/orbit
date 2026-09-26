'use client';
import { useState } from 'react';
import { ListFilter, Plus, Settings2, Trash2 } from 'lucide-react';
import { Board, Card, CustomField, CustomValue, send } from '@/lib/api';

type Mutate=(action:()=>Promise<unknown>)=>Promise<void>;
const labels:Record<CustomField['type'],string>={text:'Texto',number:'Número',date:'Data e hora',dropdown:'Dropdown',checkbox:'Checkbox'};
const localDate=(value:string)=>{const date=new Date(value),pad=(n:number)=>String(n).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`};

function ValueEditor({field,card,value,mutate}: {field:CustomField;card:Card;value:CustomValue|undefined;mutate:Mutate}){
  const [draft,setDraft]=useState(value?.value===undefined?'':String(value.value));
  const save=(next:unknown)=>void mutate(()=>send('/cards/'+card.id+'/custom-fields/'+field.id,'POST',{value:next}));
  const base='w-full rounded border border-[#dfe1e6] bg-white px-2 py-1.5 text-sm';
  return <label className="block text-xs"><span className="mb-1 block font-semibold text-[#626f86]">{field.name}</span>
    {field.type==='checkbox'?<input type="checkbox" checked={value?.value===true} onChange={event=>save(event.target.checked)} className="h-4 w-4"/>:
    field.type==='dropdown'?<select value={String(value?.value??'')} onChange={event=>save(event.target.value||null)} className={base}><option value="">Não selecionado</option>{field.options.map(option=><option key={option} value={option}>{option}</option>)}</select>:
    field.type==='date'?<input type="datetime-local" value={draft?localDate(draft):''} onChange={event=>{setDraft(event.target.value);save(event.target.value?new Date(event.target.value).toISOString():null)}} className={base}/>:
    <input type={field.type==='number'?'number':'text'} step={field.type==='number'?'any':undefined} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={()=>{const next=draft.trim();if(next!==String(value?.value??''))save(next===''?null:field.type==='number'?Number(next):next)}} maxLength={field.type==='text'?1000:undefined} className={base}/>}
  </label>;
}

function FieldManager({field,board,mutate}: {field:CustomField;board:Board;mutate:Mutate}){
  const [name,setName]=useState(field.name);const [options,setOptions]=useState(field.options.join('\n'));
  const save=()=>void mutate(()=>send(`/boards/${board.id}/custom-fields/${field.id}`,'PATCH',{name,options:field.type==='dropdown'?options.split(/\r?\n/).map(option=>option.trim()).filter(Boolean):[],show_on_card:field.show_on_card}));
  return <div className="rounded border border-[#dfe1e6] bg-white p-2"><div className="flex items-center gap-2"><input value={name} onChange={event=>setName(event.target.value)} maxLength={100} aria-label="Nome do campo" className="min-w-0 flex-1 rounded border border-[#dfe1e6] p-1.5 text-xs"/><span className="text-xs text-[#626f86]">{labels[field.type]}</span><button type="button" title="Excluir campo" onClick={()=>{if(confirm('Excluir este campo e seus valores em todos os cartões?'))void mutate(()=>send(`/boards/${board.id}/custom-fields/${field.id}`,'DELETE'))}} className="text-[#ae2a19]"><Trash2 size={14}/></button></div>{field.type==='dropdown'&&<textarea value={options} onChange={event=>setOptions(event.target.value)} rows={3} placeholder="Uma opção por linha" className="mt-2 w-full rounded border border-[#dfe1e6] p-1.5 text-xs"/>}<div className="mt-2 flex items-center justify-between"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={field.show_on_card} onChange={event=>void mutate(()=>send(`/boards/${board.id}/custom-fields/${field.id}`,'PATCH',{show_on_card:event.target.checked}))}/> Mostrar na frente</label><button type="button" onClick={save} className="rounded bg-[#e9eaed] px-2 py-1 text-xs">Salvar</button></div></div>;
}

export function CardCustomFields({card,board,values,mutate}: {card:Card;board:Board;values:CustomValue[];mutate:Mutate}){
  const [managing,setManaging]=useState(false);const [name,setName]=useState('');const [type,setType]=useState<CustomField['type']>('text');const [options,setOptions]=useState('');
  const fields=board.custom_fields||[];
  return <section id="card-fields"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><ListFilter size={21}/> Campos personalizados</h3><button type="button" onClick={()=>setManaging(!managing)} className="flex items-center gap-1 rounded bg-[#e9eaed] px-2 py-1 text-xs"><Settings2 size={13}/> Gerenciar</button></div><div className="space-y-3 sm:pl-8">{fields.length?<div className="grid gap-3 sm:grid-cols-2">{fields.map(field=><ValueEditor key={field.id+String(values.find(value=>value.field_id===field.id)?.value)} field={field} card={card} value={values.find(value=>value.field_id===field.id)} mutate={mutate}/>)}</div>:<p className="text-sm text-[#626f86]">Nenhum campo definido neste quadro.</p>}
    {managing&&<div className="space-y-2 rounded-lg border border-[#dfe1e6] bg-[#f7f8fa] p-3"><p className="text-xs text-[#626f86]">Os campos e as opções pertencem ao quadro. Cada cartão guarda seus próprios valores.</p>{fields.map(field=><FieldManager key={field.id+field.name+field.options.join(":")+String(field.show_on_card)} field={field} board={board} mutate={mutate}/>)}<form onSubmit={async event=>{event.preventDefault();if(!name.trim())return;await mutate(()=>send('/boards/'+board.id+'/custom-fields','POST',{name,type,options:type==='dropdown'?options.split(/\r?\n/).map(option=>option.trim()).filter(Boolean):[]}));setName('');setOptions('')}} className="rounded border border-dashed border-[#8590a2] p-2"><div className="flex flex-wrap gap-2"><input value={name} onChange={event=>setName(event.target.value)} maxLength={100} placeholder="Nome do novo campo" className="min-w-32 flex-1 rounded border border-[#dfe1e6] p-1.5 text-xs"/><select value={type} onChange={event=>setType(event.target.value as CustomField['type'])} className="rounded border border-[#dfe1e6] bg-white p-1.5 text-xs">{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>{type==='dropdown'&&<textarea value={options} onChange={event=>setOptions(event.target.value)} placeholder="Uma opção por linha" rows={3} className="mt-2 w-full rounded border border-[#dfe1e6] p-1.5 text-xs"/>}<button disabled={!name.trim()||(type==='dropdown'&&!options.trim())} className="mt-2 flex items-center gap-1 rounded bg-[#0c66e4] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"><Plus size={13}/> Criar campo</button></form></div>}
  </div></section>;
}
