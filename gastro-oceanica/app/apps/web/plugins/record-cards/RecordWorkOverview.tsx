'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api} from '@/lib/api';
import {usePluginAvailability} from '@/lib/plugin-availability';
type Work={id:string;title:string;board_id:string;record_id:string;workspace_id:string;record_href:string;board_href:string;state:string;due_date:string|null;completed:boolean;comments:number;pending_items:number};
const states:Record<string,string>={draft:'Rascunho',submitted:'Enviado',triage:'Triagem',review:'Avaliação',diligence:'Diligência',deliberation:'Deliberação',decision:'Decidido',appeal:'Recurso',active:'Ativo',published:'Publicado'};
export function RecordWorkOverview(){
 const availability=usePluginAvailability();const active=availability.enabled('record-cards')&&availability.hasRecordCards;
 const [rows,setRows]=useState<Work[]>([]),[query,setQuery]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(!active)return;let live=true;const load=()=>api<Work[]>('/record-cards/mine').then(items=>{if(live){setRows(items);setError('')}}).catch(error=>{if(live)setError(error.message)});void load();window.addEventListener('data:changed',load);return()=>{live=false;window.removeEventListener('data:changed',load)}},[active]);
 if(!active)return null;
 const pending=rows.reduce((sum,item)=>sum+item.pending_items,0);const upcoming=rows.filter(item=>item.due_date&&!item.completed);
 const filtered=rows.filter(item=>`${item.title} ${states[item.state]||item.state}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
 return <section aria-label="Acompanhamento dos registros" className="mb-6 space-y-4 rounded-xl border border-[#dfe1e6] bg-white p-4 shadow-sm sm:p-5">
  <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Seu acompanhamento</h2><p className="text-sm text-[#626f86]">Cartões, pendências e conversas dos registros aos quais você tem acesso.</p></div><Link className="inline-flex min-h-11 items-center rounded-lg border px-3 font-semibold" href="/calendar">Abrir calendário</Link></div>
  {error&&<p role="alert">{error}</p>}
  <div className="grid grid-cols-3 gap-3">{[[rows.length,'Cartões'],[pending,'Itens pendentes'],[upcoming.length,'Com prazo']].map(([value,label])=><div key={String(label)} className="min-w-0 rounded-lg bg-[#f7f8fa] p-3"><strong className="block text-2xl">{value}</strong><span className="break-words text-xs">{label}</span></div>)}</div>
  <label className="block text-sm font-semibold">Pesquisar registros<input className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Curso ou fase"/></label>
  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map(item=><Link key={item.id} href={item.board_href||item.record_href} className="min-w-0 rounded-xl border p-4 hover:bg-[#f7f8fa]"><strong className="block break-words">{item.title}</strong><span className="mt-2 inline-block rounded-full bg-[#e9f2ff] px-2 py-1 text-xs">{states[item.state]||item.state}</span><p className="mt-3 text-sm">{item.pending_items} pendências · {item.comments} comentários</p>{item.due_date&&<p className="mt-1 text-sm">Prazo: {new Date(item.due_date).toLocaleDateString('pt-BR')}</p>}<span className="mt-3 inline-flex min-h-11 items-center font-semibold text-[#0c66e4]">Abrir quadro →</span></Link>)}</div>
  {!filtered.length&&<p className="text-sm">Nenhum acompanhamento disponível para este perfil ou pesquisa.</p>}
 </section>;
}
