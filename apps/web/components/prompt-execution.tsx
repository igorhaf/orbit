'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, Terminal, XCircle } from 'lucide-react';
import { io } from 'socket.io-client';
import { Board, Card, PromptRun, api, getToken } from '@/lib/api';

type ProgressEvent={runId:string;cardId:string;status:'running'|'success'|'error';message:string;at:string};

export function PromptExecution({card,board,active}:{card:Card;board:Board;active:boolean}) {
  const [runs,setRuns]=useState<PromptRun[]>([]);
  const [events,setEvents]=useState<ProgressEvent[]>([]);
  const [runId,setRunId]=useState<string|null>(null);
  useEffect(()=>{
    let mounted=true;
    void api<PromptRun[]>(`/cards/${card.id}/prompt-runs`).then(value=>{if(mounted){setRuns(value);setRunId(value.find(item=>item.status==='running')?.id||null);}}).catch(()=>undefined);
    const socket=io({path:'/socket.io',auth:{token:getToken()}});
    socket.on('connect',()=>socket.emit('board:join',board.id));
    socket.on('prompt:progress',(event:ProgressEvent)=>{
      if(event.cardId!==card.id)return;
      setRunId(event.runId);setEvents(current=>[...current,event].slice(-200));
      if(event.status!=='running')void api<PromptRun[]>(`/cards/${card.id}/prompt-runs`).then(value=>{if(mounted)setRuns(value);}).catch(()=>undefined);
    });
    return()=>{mounted=false;socket.emit('board:leave',board.id);socket.disconnect();};
  },[board.id,card.id]);
  const current=events.filter(event=>event.runId===runId),latest=runs[0],last=current.at(-1);
  const dot=last?.status==='error'?'bg-[#ff8f73]':last?.status==='success'?'bg-[#7ee2b8]':runId?'animate-pulse bg-[#579dff]':'bg-[#8590a2]';
  return <section className={active?'':'hidden'} aria-label="Execução de prompt"><div className="mb-3 flex items-center gap-2 font-semibold"><Terminal size={21}/> Execução</div><div className="overflow-hidden rounded-lg border border-[#172b4d] bg-[#101828] text-[#d0d9e8]"><div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs"><span className={`h-2 w-2 rounded-full ${dot}`}/><span>{last?.status==='error'?'Falhou':last?.status==='success'?'Concluída':runId?'Em execução':'Aguardando execução'}</span></div><div className="min-h-48 max-h-[44vh] overflow-y-auto p-3 font-mono text-xs leading-5">{current.length>0?current.map((event,index)=><p key={`${event.at}:${index}`} className={event.status==='error'?'text-[#ff8f73]':event.status==='success'?'text-[#7ee2b8]':'text-[#d0d9e8]'}><span className="mr-2 text-[#738496]">{new Date(event.at).toLocaleTimeString('pt-BR')}</span>{event.message}</p>):latest?<div><p className="flex items-center gap-2 text-[#d0d9e8]">{latest.status==='success'?<CheckCircle2 size={15} className="text-[#7ee2b8]"/>:latest.status==='error'?<XCircle size={15} className="text-[#ff8f73]"/>:<LoaderCircle size={15} className="animate-spin text-[#579dff]"/>}Última execução: {latest.status==='success'?'concluída':latest.status==='error'?'falhou':'em andamento'}.</p>{latest.output&&<pre className="mt-3 whitespace-pre-wrap text-[#d0d9e8]">{latest.output}</pre>}{latest.error&&<p className="mt-3 text-[#ff8f73]">{latest.error}</p>}</div>:<p className="text-[#9fadbc]">Inicie uma execução na sessão de prompt para acompanhar o Codex aqui.</p>}</div></div></section>;
}
