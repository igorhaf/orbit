'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, Board, Card, CardDetails, CardExtensions, dateLabel, getToken, labelColors, labelTextColor } from '@/lib/api';
import { RichText } from '@/components/board-tools';

export default function PrintPage({params}:{params:Promise<{id:string}>}) {
  const {id}=use(params);
  const router=useRouter();
  const [board,setBoard]=useState<Board|null>(null);
  const [card,setCard]=useState<Card|null>(null);
  const [details,setDetails]=useState<CardDetails|null>(null);
  const [extensions,setExtensions]=useState<CardExtensions|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!getToken()){router.push('/');return;}
    const cardId=new URLSearchParams(window.location.search).get('card');
    api<Board>(`/boards/${id}`).then(async data=>{
      setBoard(data);
      if(cardId){
        const selected=data.lists?.flatMap(list=>list.cards).find(item=>item.id===cardId);
        if(!selected)throw new Error('Cartão não encontrado neste quadro.');
        setCard(selected);
        const [details,extensions]=await Promise.all([api<CardDetails>(`/cards/${cardId}/details`),api<CardExtensions>(`/cards/${cardId}/extensions`)]);
        setDetails(details);setExtensions(extensions);
      }
    }).catch(err=>setError((err as Error).message)).finally(()=>setLoading(false));
  },[id,router]);
  if(loading)return <main className="p-8">Preparando impressão...</main>;
  if(error||!board)return <main className="p-8 text-[#ae2a19]">{error||'Quadro indisponível.'}</main>;
  return <div className="min-h-screen bg-[#f1f2f4] p-4 text-[#172b4d] sm:p-8">
    <style>{`@page{size:auto;margin:14mm}@media print{body{background:#fff!important}.print-actions{display:none!important}.print-sheet{box-shadow:none!important;margin:0!important;max-width:none!important;padding:0!important}.print-list{break-inside:avoid}.print-card{break-inside:avoid}a{color:#172b4d!important;text-decoration:underline}}`}</style>
    <div className="print-actions mx-auto mb-5 flex max-w-6xl flex-wrap items-center gap-2"><button onClick={()=>router.back()} className="flex items-center gap-2 rounded bg-white px-3 py-2 text-sm font-semibold"><ArrowLeft size={16}/> Voltar</button><button onClick={()=>window.print()} className="flex items-center gap-2 rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white"><Printer size={16}/> Imprimir</button></div>
    <main className="print-sheet mx-auto max-w-6xl rounded-lg bg-white p-6 shadow-card sm:p-10">
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[#626f86]">{card?'Cartão':'Quadro'} · {board.title}</p>
      <h1 className="mb-2 text-3xl font-bold">{card?.title||board.title}</h1>
      {card? <>
        <p className="mb-7 text-sm text-[#626f86]">Lista: {board.lists?.find(list=>list.id===card.list_id)?.title}{card.due_date?` · Prazo: ${dateLabel(card.due_date)}`:''}{card.completed?' · Concluído':''}</p>
        {card.labels?.length>0&&<section className="mb-6"><h2 className="mb-2 font-bold">Etiquetas</h2><div className="flex flex-wrap gap-2">{card.labels.map(label=><span key={label.id} className="rounded px-2 py-1 text-sm" style={{background:labelColors[label.color]||label.color,color:labelTextColor(label.color)}}>{label.name||label.color}</span>)}</div></section>}
        {card.description&&<section className="mb-6"><h2 className="mb-2 font-bold">Descrição</h2><div className="text-sm"><RichText text={card.description}/></div></section>}
        {extensions?.checklists.map(group=><section key={group.id} className="mb-6"><h2 className="mb-2 font-bold">{group.title}</h2><ul className="space-y-1 text-sm">{group.items.map(item=><li key={item.id}>{item.completed?'☑':'☐'} {item.text}{item.assignee_name?` · ${item.assignee_name}`:''}{item.due_date?` · ${dateLabel(item.due_date)}`:''}</li>)}</ul></section>)}
        {Boolean(extensions?.values.length)&&<section className="mb-6"><h2 className="mb-2 font-bold">Campos personalizados</h2><dl className="grid gap-1 text-sm">{extensions?.values.map(entry=>{const field=board.custom_fields?.find(field=>field.id===entry.field_id);return field?<div key={entry.field_id}><dt className="inline font-semibold">{field.name}: </dt><dd className="inline">{typeof entry.value==='boolean'?(entry.value?'Sim':'Não'):field.type==='date'?dateLabel(String(entry.value)):String(entry.value)}</dd></div>:null})}</dl></section>}
        {details?.comments.length? <section><h2 className="mb-2 font-bold">Comentários</h2><div className="space-y-3">{details.comments.map(item=><div key={item.id} className="border-b border-[#dfe1e6] pb-2 text-sm"><strong>{item.author_name}</strong> <small>{new Date(item.created_at).toLocaleString('pt-BR')}</small><div><RichText text={item.body}/></div></div>)}</div></section>:null}
      </> : <>
        {board.description&&<div className="mb-6 text-sm"><RichText text={board.description}/></div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{board.lists?.map(list=><section key={list.id} className="print-list rounded border border-[#dfe1e6] p-3"><h2 className="mb-3 border-b border-[#dfe1e6] pb-2 font-bold">{list.title} <span className="font-normal text-[#626f86]">({list.cards.length})</span></h2><div className="space-y-3">{list.cards.map(item=><article key={item.id} className="print-card rounded border border-[#dfe1e6] p-3"><h3 className={`font-semibold ${item.completed?'line-through':''}`}>{item.title}</h3>{item.due_date&&<p className="mt-1 text-xs">Prazo: {dateLabel(item.due_date)}</p>}{item.description&&<div className="mt-2 text-xs"><RichText text={item.description}/></div>}</article>)}</div></section>)}</div>
      </>}
    </main>
  </div>;
}
