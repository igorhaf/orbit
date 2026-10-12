'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Pause, Play } from 'lucide-react';
import { api, send } from '@/lib/api';

type WaitingAnswer = {id:string;card_id:string;board_id:string;card_title:string};
type Window = {usedPercent:number;windowDurationMins:number;resetsAt:number};
type Snapshot = {primary?:Window|null;secondary?:Window|null};
type Limits = {rateLimits?:Snapshot;rateLimitsByLimitId?:Record<string,Snapshot>};

export function CodexLimitsBar({visible,onAutoPaused}:{visible:boolean;onAutoPaused:(paused:boolean)=>void}){
  const [waitingAnswers,setWaitingAnswers]=useState<WaitingAnswer[]>([]);
  const [autoPaused,setAutoPaused]=useState(false);
  const [limits,setLimits]=useState<Limits|null>(null);
  const [paused,setPaused]=useState<boolean|null>(null);
  const [error,setError]=useState('');
  const [queueError,setQueueError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{
      const results=await Promise.allSettled([api<Limits>('/codex/limits'),api<{paused:boolean;autoPaused:boolean;waitingAnswers:WaitingAnswer[]}>('/codex/queue')]);
      if(!active)return;
      if(results[0].status==='fulfilled'){setLimits(results[0].value);setError('')}else{setLimits(null);setError(results[0].reason instanceof Error?results[0].reason.message:'Limites indisponíveis.')}
      if(results[1].status==='fulfilled'){setWaitingAnswers(results[1].value.waitingAnswers||[]);setPaused(results[1].value.paused);setAutoPaused(results[1].value.autoPaused);onAutoPaused(results[1].value.autoPaused);setQueueError('')}else{setPaused(null);setQueueError('Não foi possível consultar a fila.')}
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),5_000);
    const focus=()=>void refresh();
    window.addEventListener('focus',focus);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus)};
  },[onAutoPaused]);
  const snapshot=limits?.rateLimitsByLimitId?.codex||limits?.rateLimits;
  const windows=[snapshot?.primary,snapshot?.secondary];
  const describe=(minutes:number)=>{
    const value=windows.find(item=>item?.windowDurationMins===minutes);
    if(!value)return 'Não informado pelo Codex';
    return `${Math.max(0,Math.min(100,100-value.usedPercent)).toLocaleString('pt-BR')}% disponível · renova ${new Date(value.resetsAt*1000).toLocaleString('pt-BR')}`;
  };
  const toggle=async()=>{
    if(paused===null)return;
    setBusy(true);
    try{const result=await send<{paused:boolean;autoPaused:boolean}>('/codex/queue','PATCH',{paused:!paused});setPaused(result.paused);setAutoPaused(result.autoPaused);onAutoPaused(result.autoPaused);setQueueError('')}
    catch(cause){setQueueError(cause instanceof Error?cause.message:'Não foi possível alterar a fila.')}
    finally{setBusy(false)}
  };
  if(!visible&&!autoPaused&&!waitingAnswers.length)return null;
  return <div id="codex-limits-bar" role="status" className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 bg-[#c9372c] px-4 py-2 text-sm text-white">
    {autoPaused&&<span><strong>Fila pausada automaticamente: cota em 1% ou menos.</strong></span>}
    {error?<span>{error}</span>:limits?<><span><strong>5 horas:</strong> {describe(300)}</span><span><strong>Semanal:</strong> {describe(10080)}</span></>:<span>Consultando limites do Codex…</span>}
    <button disabled={busy||paused===null} onClick={()=>void toggle()} title="A pausa mantém os prompts atuais em execução e aguarda para iniciar os próximos." className="ml-auto flex items-center gap-2 rounded border border-white/60 px-3 py-1 font-semibold hover:bg-white/15 disabled:opacity-50">{paused?<Play size={16}/>:<Pause size={16}/>} {busy?'Aguarde…':paused?'Retomar fila':'Pausar fila'}</button>
    {waitingAnswers.length>0&&<details className="w-full"><summary className="cursor-pointer font-semibold">Fila de perguntas ({waitingAnswers.length})</summary><div className="mt-2 flex flex-wrap gap-2">{waitingAnswers.map(run=><Link key={run.id} href={`/board/${run.board_id}?card=${run.card_id}`} className="max-w-full truncate rounded border border-white/60 px-3 py-2">{run.card_title}</Link>)}</div></details>}
    {queueError&&<span role="alert">{queueError}</span>}
  </div>;
}
