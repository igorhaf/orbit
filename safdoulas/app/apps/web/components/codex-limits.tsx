'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Pause, Play } from 'lucide-react';
import { api, send } from '@/lib/api';

type WaitingAnswer = {id:string;card_id:string;board_id:string;card_title:string};
type Window = {usedPercent:number;windowDurationMins:number;resetsAt:number};
type Snapshot = {primary?:Window|null;secondary?:Window|null};
type Limits = {rateLimits?:Snapshot;rateLimitsByLimitId?:Record<string,Snapshot>};

export function CodexLimitsBar({visible,isRoot}:{visible:boolean;isRoot:boolean}){
  const [waitingAnswers,setWaitingAnswers]=useState<WaitingAnswer[]>([]);
  const [autoPaused,setAutoPaused]=useState(false);
  const [autoResume,setAutoResume]=useState(false);
  const [limits,setLimits]=useState<Limits|null>(null);
  const [paused,setPaused]=useState<boolean|null>(null);
  const [error,setError]=useState('');
  const [queueError,setQueueError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{
      const results=await Promise.allSettled([isRoot?api<Limits>('/codex/limits'):Promise.resolve(null),api<{paused:boolean;autoPaused:boolean;autoResume:boolean;waitingAnswers:WaitingAnswer[]}>('/codex/queue')]);
      if(!active)return;
      if(results[0].status==='fulfilled'){setLimits(results[0].value);setError('')}else{setLimits(null);setError(results[0].reason instanceof Error?results[0].reason.message:'Limites indisponíveis.')}
      if(results[1].status==='fulfilled'){setWaitingAnswers(results[1].value.waitingAnswers||[]);setPaused(results[1].value.paused);setAutoPaused(results[1].value.autoPaused);setAutoResume(results[1].value.autoResume);setQueueError('')}else{setPaused(null);setQueueError('Não foi possível consultar a fila.')}
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),5_000);
    window.addEventListener('queues:changed',refresh);
    const focus=()=>void refresh();
    window.addEventListener('focus',focus);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('queues:changed',refresh)};
  },[isRoot]);
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
    try{const result=await send<{paused:boolean;autoPaused:boolean}>('/codex/queue','PATCH',{paused:!paused});setPaused(result.paused);setAutoPaused(result.autoPaused);setQueueError('')}
    catch(cause){setQueueError(cause instanceof Error?cause.message:'Não foi possível alterar a fila.')}
    finally{setBusy(false)}
  };
  const toggleAutoResume=async(checked:boolean)=>{setBusy(true);try{const result=await send<{autoResume:boolean}>('/codex/queue','PATCH',{autoResume:checked});setAutoResume(result.autoResume);setQueueError('');window.dispatchEvent(new Event('queues:changed'))}catch(cause){setQueueError((cause as Error).message)}finally{setBusy(false)}};
  if(!visible)return null;
  return <div id="codex-limits-bar" role="status" className={`relative z-20 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 text-sm text-white ${isRoot?'bg-[#c9372c]':'bg-[#44546f]'}`}>
    {autoPaused&&<span><strong>{isRoot?'Fila pausada automaticamente: cota em 1% ou menos.':'Fila pausada automaticamente.'}</strong></span>}
    {isRoot&&(error?<span>{error}</span>:limits?<><span><strong>5 horas:</strong> {describe(300)}</span><span><strong>Semanal:</strong> {describe(10080)}</span></>:<span>Consultando limites do Codex…</span>)}
    <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
    <div className="flex min-h-11 items-center gap-2 text-sm" title="Retoma pausas por cota quando a janela renovar. Pausas manuais são mantidas.">
      <button type="button" role="switch" aria-checked={autoResume} aria-label="Retomada automática da fila" disabled={busy||paused===null} onClick={()=>void toggleAutoResume(!autoResume)} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-white/60 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${autoResume?'bg-emerald-500':'bg-slate-700'}`}>
        <span aria-hidden="true" className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoResume?'translate-x-6':'translate-x-1'}`}/>
      </button>
      <span>Retomada automática</span>
      <span className="rounded bg-white/15 px-1.5 py-0.5 text-xs font-semibold">{autoResume?'Ligado':'Desligado'}</span>
    </div>
    <button disabled={busy||paused===null} onClick={()=>void toggle()} title="A pausa mantém os prompts atuais em execução e aguarda para iniciar os próximos." className="flex min-h-11 items-center gap-2 rounded border border-white/60 px-3 py-1 font-semibold hover:bg-white/15 disabled:opacity-50">{paused?<Play size={16}/>:<Pause size={16}/>} {busy?'Aguarde…':paused?'Retomar fila':'Pausar fila'}</button>
    <Link href="/queues" className="inline-flex min-h-11 items-center px-2 font-semibold underline underline-offset-4">Gerenciar filas</Link>
    </div>
    {waitingAnswers.length>0&&<details className="w-full"><summary className="cursor-pointer font-semibold">Fila de perguntas ({waitingAnswers.length})</summary><div className="mt-2 flex flex-wrap gap-2">{waitingAnswers.map(run=><Link key={run.id} href={`/board/${run.board_id}?card=${run.card_id}`} className="max-w-full truncate rounded border border-white/60 px-3 py-2">{run.card_title}</Link>)}</div></details>}
    {queueError&&<span role="alert">{queueError}</span>}
  </div>;
}
