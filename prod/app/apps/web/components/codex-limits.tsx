'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Pause, Play } from 'lucide-react';
import { api, send } from '@/lib/api';

type WaitingAnswer = {id:string;card_id:string;board_id:string;card_title:string};
type Window = {usedPercent:number;windowDurationMins:number;resetsAt:number};
type Snapshot = {primary?:Window|null;secondary?:Window|null};
type Limits = {rateLimits?:Snapshot;rateLimitsByLimitId?:Record<string,Snapshot>};

export function CodexLimitsBar({isRoot}:{isRoot:boolean}){
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
  const available=(minutes:number)=>{
    const value=windows.find(item=>item?.windowDurationMins===minutes);
    return value?`${Math.max(0,Math.min(100,100-value.usedPercent)).toLocaleString('pt-BR')}%`:'—';
  };
  const toggle=async()=>{
    if(paused===null)return;
    setBusy(true);
    try{const result=await send<{paused:boolean;autoPaused:boolean}>('/codex/queue','PATCH',{paused:!paused});setPaused(result.paused);setAutoPaused(result.autoPaused);setQueueError('')}
    catch(cause){setQueueError(cause instanceof Error?cause.message:'Não foi possível alterar a fila.')}
    finally{setBusy(false)}
  };
  const toggleAutoResume=async(checked:boolean)=>{setBusy(true);try{const result=await send<{autoResume:boolean}>('/codex/queue','PATCH',{autoResume:checked});setAutoResume(result.autoResume);setQueueError('');window.dispatchEvent(new Event('queues:changed'))}catch(cause){setQueueError((cause as Error).message)}finally{setBusy(false)}};
  return <div id="codex-limits-bar" role="status" className={`relative z-20 flex min-w-0 flex-[1_1_9rem] flex-nowrap items-center gap-x-1 overflow-hidden whitespace-nowrap px-1 py-1 text-[10px] sm:gap-x-3 sm:text-xs ${isRoot?'text-[#9f2d25]':'text-[#44546f]'}`}>
    {autoPaused&&<span className="max-w-12 shrink-0 truncate font-semibold sm:max-w-none" title={isRoot?'Fila pausada automaticamente: cota em 1% ou menos.':'Fila pausada automaticamente.'}>Pausada</span>}
    {isRoot&&(error?<span className="shrink-0" title={error}>Erro</span>:limits?<><span className="shrink-0" title={describe(300)}><strong>5h</strong> {available(300)}</span><span className="shrink-0" title={describe(10080)}><strong><span className="hidden lg:inline">Semanal</span><span className="lg:hidden">Sem.</span></strong> {available(10080)}</span></>:<span className="shrink-0">Consultando…</span>)}
    <div className="flex min-w-0 flex-nowrap items-center gap-1 sm:gap-1.5 whitespace-nowrap">
    <div className="flex min-h-9 shrink-0 items-center gap-1" title="Retoma pausas por cota quando a janela renovar. Pausas manuais são mantidas.">
      <button type="button" role="switch" aria-checked={autoResume} aria-label="Retomada automática da fila" disabled={busy||paused===null} onClick={()=>void toggleAutoResume(!autoResume)} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-[#8590a2] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${autoResume?'bg-emerald-500':'bg-slate-500'}`}>
        <span aria-hidden="true" className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoResume?'translate-x-6':'translate-x-1'}`}/>
      </button>
      <span className="hidden whitespace-nowrap lg:inline">Auto-retoma</span>
    </div>
    <button disabled={busy||paused===null} onClick={()=>void toggle()} title="A pausa mantém os prompts atuais em execução e aguarda para iniciar os próximos." aria-label={busy?'Aguarde':paused?'Retomar fila':'Pausar fila'} className="flex min-h-9 shrink-0 items-center gap-1 rounded border border-[#8590a2] px-1.5 py-1 font-semibold hover:bg-[#f1f2f4] disabled:opacity-50">{paused?<Play size={14}/>:<Pause size={14}/>}<span className="hidden lg:inline">{busy?'Aguarde…':paused?'Retomar':'Pausar fila'}</span></button>
    <Link href="/queues" aria-label="Gerenciar filas" title="Gerenciar filas" className="inline-flex min-h-9 shrink-0 items-center px-1 font-semibold underline underline-offset-4"><span className="hidden lg:inline">Filas</span><span className="lg:hidden">Fila</span></Link>
    </div>
    {waitingAnswers.length>0&&<details className="relative"><summary title={`Perguntas aguardando resposta: ${waitingAnswers.length}`} className="min-h-9 shrink-0 cursor-pointer rounded px-1 py-2 font-semibold">?{waitingAnswers.length}</summary><div className="absolute bottom-full right-0 z-[80] mb-2 flex max-h-[45dvh] min-w-56 max-w-[min(80vw,28rem)] flex-col gap-1 overflow-y-auto rounded-lg border border-[#dfe1e6] bg-white p-2 text-[#172b4d] shadow-dialog">{waitingAnswers.map(run=><Link key={run.id} href={`/board/${run.board_id}?card=${run.card_id}`} className="max-w-full truncate rounded px-3 py-2 hover:bg-[#f1f2f4]">{run.card_title}</Link>)}</div></details>}
    {queueError&&<span role="alert" className="shrink-0 text-[#ae2a19]" title={queueError}>Erro</span>}
  </div>;
}
