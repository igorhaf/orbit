'use client';

import { useState } from 'react';
import { Check, LoaderCircle, Sparkles } from 'lucide-react';
import { Card, send } from '@/lib/api';
import { RichText } from './rich-text';

type Action = 'write'|'refine'|'summarize'|'shorten'|'action_items'|'checklist';
type Result = { output:string; items:string[] };

const actions: {id:Action;label:string}[] = [
  {id:'write',label:'Escrever descrição'}, {id:'refine',label:'Refinar texto'},
  {id:'summarize',label:'Resumir'}, {id:'shorten',label:'Encurtar'},
  {id:'action_items',label:'Encontrar ações'}, {id:'checklist',label:'Criar checklist'},
];

export function CardAi({card,onApply,onChanged}:{card:Card;onApply:(text:string)=>Promise<void>;onChanged:()=>Promise<void>}) {
  const [action,setAction]=useState<Action>('refine');
  const [instruction,setInstruction]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function generate(){
    setBusy(true);setError('');setResult(null);
    try { setResult(await send<Result>(`/cards/${card.id}/ai`,'POST',{action,instruction})); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function createChecklist(){
    if(!result?.items.length)return;
    setBusy(true);setError('');
    try {
      const checklist=await send<{id:string}>(`/cards/${card.id}/checklists`,'POST',{title:'Checklist sugerido por IA'});
      await send(`/checklists/${checklist.id}/items`,'POST',{text:result.items.join('\n')});
      await onChanged();setResult(null);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  const itemsAction=action==='checklist'||action==='action_items';
  return <section className="rounded-lg border border-[#c3b6f7] bg-[#f7f5ff] p-3"><h3 className="flex items-center gap-2 text-sm font-bold text-[#403294]"><Sparkles size={17}/> Assistente Codex</h3><p className="mt-1 text-xs text-[#5e5a87]">A sugestão só altera o cartão quando você aplicá-la.</p>
    <div className="mt-3 flex flex-wrap gap-1.5">{actions.map(option=><button key={option.id} type="button" onClick={()=>{setAction(option.id);setResult(null)}} className={`rounded px-2 py-1 text-xs font-semibold ${action===option.id?'bg-[#6554c0] text-white':'bg-white text-[#403294] hover:bg-[#e9e5fa]'}`}>{option.label}</button>)}</div>
    <textarea value={instruction} onChange={event=>setInstruction(event.target.value)} maxLength={2000} placeholder="Instrução opcional para a IA" className="mt-3 min-h-16 w-full rounded border border-[#b7b1d7] bg-white p-2 text-sm outline-none focus:border-[#6554c0]"/>
    <button type="button" disabled={busy} onClick={()=>void generate()} className="mt-2 inline-flex items-center gap-2 rounded bg-[#6554c0] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{busy?<LoaderCircle className="animate-spin" size={15}/>:<Sparkles size={15}/>} Gerar sugestão</button>
    {error&&<p role="alert" className="mt-3 rounded bg-[#ffebe6] p-2 text-xs text-[#ae2a19]">{error}</p>}
    {result&&<div className="mt-3 rounded border border-[#d8d2f5] bg-white p-3"><div className="max-h-56 overflow-y-auto text-sm">{itemsAction?<ul className="space-y-1">{result.items.map((item,index)=><li key={index} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-[#6554c0]"/>{item}</li>)}</ul>:<RichText text={result.output}/>}</div><div className="mt-3 flex flex-wrap gap-2">{itemsAction?<button type="button" disabled={busy||!result.items.length} onClick={()=>void createChecklist()} className="rounded bg-[#0c66e4] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">Criar checklist</button>:<button type="button" disabled={busy} onClick={()=>void onApply(result.output).then(()=>setResult(null)).catch(err=>setError((err as Error).message))} className="rounded bg-[#0c66e4] px-3 py-1.5 text-xs font-bold text-white">Aplicar à descrição</button>}<button type="button" onClick={()=>setResult(null)} className="rounded bg-[#f1f2f4] px-3 py-1.5 text-xs font-semibold">Descartar</button></div></div>}
  </section>;
}
