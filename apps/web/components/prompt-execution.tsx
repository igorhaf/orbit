'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Files, LoaderCircle, Terminal, XCircle } from 'lucide-react';
import { io } from 'socket.io-client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Board, Card, PromptActivity, PromptFileChange, PromptRun, api, getToken } from '@/lib/api';

type ProgressEvent={runId:string;cardId:string;status:'queued'|'running'|'success'|'error'|'cancelled';message:string;output?:boolean;replace?:boolean;files?:PromptFileChange[];activity?:PromptActivity;at:string};
const withoutSummary=(value:string)=>value.replace(/\[\[ORBIT_SUMMARY\]\][\s\S]*(?:\[\[\/ORBIT_SUMMARY\]\]|$)/i,'').trimEnd();

function LiveMarkdown({text}:{text:string}) {
  return <div className="min-w-0 break-words text-sm leading-6 text-[#d0d9e8] dark:text-[#172b4d]">
    <Markdown remarkPlugins={[remarkGfm]} components={{
      p:({children})=><p className="my-2 whitespace-pre-wrap">{children}</p>,
      h1:({children})=><h1 className="mb-3 mt-5 text-xl font-semibold">{children}</h1>,
      h2:({children})=><h2 className="mb-2 mt-4 text-lg font-semibold">{children}</h2>,
      h3:({children})=><h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>,
      ul:({children})=><ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
      ol:({children})=><ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
      li:({children})=><li className="pl-1">{children}</li>,
      a:({children,href})=><a href={href} target="_blank" rel="noreferrer" className="text-[#579dff] underline decoration-[#579dff]/40 underline-offset-2">{children}</a>,
      code:({children,className})=><code className={`rounded bg-[#263244] px-1 py-0.5 font-mono text-[0.9em] dark:bg-[#e9eaed] ${className||''}`}>{children}</code>,
      pre:({children})=><pre className="my-3 max-w-full overflow-x-auto rounded-lg border border-white/10 bg-[#0b1220] p-3 text-xs leading-5 dark:border-[#dfe1e6] dark:bg-[#f7f8fa]">{children}</pre>,
      blockquote:({children})=><blockquote className="my-3 border-l-2 border-[#579dff] pl-3 text-[#a9b8ca] dark:text-[#626f86]">{children}</blockquote>,
      table:({children})=><div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
      th:({children})=><th className="border border-white/15 px-2 py-1 dark:border-[#dfe1e6]">{children}</th>,
      td:({children})=><td className="border border-white/15 px-2 py-1 dark:border-[#dfe1e6]">{children}</td>,
      hr:()=><hr className="my-4 border-white/10 dark:border-[#dfe1e6]"/>,
    }}>{text}</Markdown>
  </div>;
}

function FileChangeReview({files}:{files:PromptFileChange[]}) {
  const [showAll,setShowAll]=useState(false);
  const [selectedPath,setSelectedPath]=useState<string|null>(null);
  if(!files.length)return null;
  const additions=files.reduce((total,file)=>total+(file.additions||0),0);
  const deletions=files.reduce((total,file)=>total+(file.deletions||0),0);
  const hasStats=files.some(file=>file.additions!==undefined||file.deletions!==undefined);
  const visible=showAll?files:files.slice(0,4);
  const selected=files.find(file=>file.path===selectedPath);
  return <section className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#171d26] text-[#d0d9e8] dark:border-[#dfe1e6] dark:bg-[#f7f8fa] dark:text-[#172b4d]" aria-label="Arquivos editados">
    <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3 dark:border-[#dfe1e6]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/15 dark:border-[#c1c7d0]"><Files size={16}/></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{files.length===1?'1 arquivo editado':`${files.length} arquivos editados`}</p>{hasStats&&<p className="mt-0.5 text-xs"><span className="text-[#4fd49a]">+{additions}</span><span className="ml-1 text-[#ff776f]">-{deletions}</span></p>}</div>
      {files.some(file=>file.diff)&&<button type="button" onClick={()=>setSelectedPath(selectedPath?null:files.find(file=>file.diff)?.path||null)} className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/5 dark:border-[#c1c7d0] dark:hover:bg-[#e9eaed]">{selectedPath?'Fechar revisão':'Revisar'}</button>}
    </header>
    <div className="divide-y divide-white/10 dark:divide-[#dfe1e6]">
      {visible.map(file=><button key={file.path} type="button" onClick={()=>setSelectedPath(current=>current===file.path?null:file.path)} className={`flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-white/5 dark:hover:bg-[#e9eaed] ${selectedPath===file.path?'bg-white/5 dark:bg-[#e9eaed]':''}`}>
        <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>{(file.additions!==undefined||file.deletions!==undefined)&&<><span className="shrink-0 text-[#4fd49a]">+{file.additions??0}</span><span className="shrink-0 text-[#ff776f]">-{file.deletions??0}</span></>}
      </button>)}
    </div>
    {files.length>4&&<button type="button" onClick={()=>setShowAll(!showAll)} className="px-4 py-2 text-xs text-[#a9b8ca] hover:text-white dark:text-[#626f86] dark:hover:text-[#172b4d]">{showAll?'Mostrar menos arquivos':`Mostrar mais ${files.length-4} arquivos`}</button>}
    {selected&&<div className="border-t border-white/10 p-3 dark:border-[#dfe1e6]">
      <div className="mb-2 truncate font-mono text-xs text-[#a9b8ca] dark:text-[#626f86]">{selected.path}</div>
      {selected.diff?<pre className="max-h-72 overflow-auto rounded-md bg-[#0b1220] p-2 font-mono text-[11px] leading-5 dark:bg-[#1d2125]"><code>{selected.diff.split('\n').map((line,index)=><span key={index} className={`block whitespace-pre ${line.startsWith('+')&&!line.startsWith('+++')?'text-[#4fd49a]':line.startsWith('-')&&!line.startsWith('---')?'text-[#ff776f]':line.startsWith('@@')?'text-[#79c0ff]':'text-[#c4cbd4]'}`}><span className="mr-3 inline-block w-8 select-none text-right text-[#718096]">{index+1}</span>{line||' '}</span>)}</code></pre>:<p className="text-xs text-[#a9b8ca] dark:text-[#626f86]">O Codex informou o arquivo alterado, mas não há diff Git disponível para prévia.</p>}
    </div>}
  </section>;
}

function CommandActivities({activities}:{activities:PromptActivity[]}) {
  if(!activities.length)return null;
  return <section className="my-4 space-y-2" aria-label="Comandos executados">
    {activities.map(activity=><details key={activity.id} open={activity.status==='running'} className="overflow-hidden rounded-lg border border-white/10 bg-[#151b24] dark:border-[#dfe1e6] dark:bg-[#f7f8fa]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs">
        {activity.status==='running'?<LoaderCircle size={14} className="animate-spin text-[#79c0ff]"/>:activity.status==='failed'?<XCircle size={14} className="text-[#ff776f]"/>:<Terminal size={14} className="text-[#a9b8ca] dark:text-[#626f86]"/>}
        <code className="min-w-0 flex-1 truncate font-mono text-[#d0d9e8] dark:text-[#172b4d]" title={activity.command}>{activity.command}</code>
        <span className={`shrink-0 ${activity.status==='failed'?'text-[#ff776f]':activity.status==='completed'?'text-[#4fd49a]':'text-[#79c0ff]'}`}>{activity.status==='running'?'Executando':activity.status==='failed'?'Falhou':'Concluído'}</span>
      </summary>
      {activity.output&&<pre className="max-h-60 overflow-auto border-t border-white/10 bg-[#0b1220] p-3 font-mono text-[11px] leading-5 text-[#c4cbd4] dark:border-[#dfe1e6] dark:bg-[#1d2125]">{activity.output}</pre>}
    </details>)}
  </section>;
}

export function PromptExecution({card,board,active}:{card:Card;board:Board;active:boolean}) {
  const [runs,setRuns]=useState<PromptRun[]>([]);
  const [events,setEvents]=useState<ProgressEvent[]>([]);
  const [streamedOutput,setStreamedOutput]=useState<Record<string,string>>({});
  const [liveFiles,setLiveFiles]=useState<Record<string,PromptFileChange[]>>({});
  const [liveActivities,setLiveActivities]=useState<Record<string,PromptActivity[]>>({});
  const [runId,setRunId]=useState<string|null>(null);
  const [historyRunId,setHistoryRunId]=useState<string|null>(null);
  const loadRuns=useCallback(()=>api<PromptRun[]>(`/cards/${card.id}/prompt-runs`).then(value=>{setRuns(value);setRunId(current=>current||value.find(item=>['queued','running'].includes(item.status))?.id||null);}).catch(()=>undefined),[card.id]);
  useEffect(()=>{
    let mounted=true;
    void api<PromptRun[]>(`/cards/${card.id}/prompt-runs`).then(value=>{if(mounted){setRuns(value);setRunId(value.find(item=>['queued','running'].includes(item.status))?.id||null);}}).catch(()=>undefined);
    const socket=io({path:'/socket.io',auth:{token:getToken()}});
    socket.on('connect',()=>socket.emit('board:join',board.id));
    socket.on('prompt:progress',(event:ProgressEvent)=>{
      if(event.cardId!==card.id)return;
      setRunId(event.runId);
      setHistoryRunId(null);
      if(event.output)setStreamedOutput(current=>({...current,[event.runId]:event.replace?event.message:(current[event.runId]||'')+event.message}));
      else if(event.message)setEvents(current=>[...current,event].slice(-200));
      const changed=event.files;
      if(changed)setLiveFiles(current=>({...current,[event.runId]:[...(current[event.runId]||[]).filter(file=>!changed.some(change=>change.path===file.path)),...changed]}));
      const activity=event.activity;
      if(activity)setLiveActivities(current=>({...current,[event.runId]:[...(current[event.runId]||[]).filter(item=>item.id!==activity.id),activity]}));
      if(event.status!=='running')void api<PromptRun[]>(`/cards/${card.id}/prompt-runs`).then(value=>{if(mounted)setRuns(value);}).catch(()=>undefined);
    });
    return()=>{mounted=false;socket.emit('board:leave',board.id);socket.disconnect();};
  },[board.id,card.id]);
  useEffect(()=>{
    if(!runs.some(run=>['queued','running'].includes(run.status)))return;
    const timer=window.setInterval(()=>void loadRuns(),900);
    return()=>window.clearInterval(timer);
  },[runs,loadRuns]);
  const displayedRunId=historyRunId||runId||runs[0]?.id||null;
  const displayedRun=runs.find(run=>run.id===displayedRunId)||null;
  const cancel=async()=>{if(!displayedRun||displayedRun.status!=='queued')return;await api(`/cards/${card.id}/prompt-runs/${displayedRun.id}/cancel`,{method:'POST'});await loadRuns();};
  const current=events.filter(event=>event.runId===displayedRunId),last=current.at(-1);
  const dot=last?.status==='error'?'bg-[#ff8f73]':last?.status==='success'?'bg-[#0c66e4]':runId?'animate-pulse bg-[#579dff]':'bg-[#8590a2]';
  const rawOutput=streamedOutput[displayedRunId||'']??displayedRun?.output;
  const output=rawOutput?withoutSummary(rawOutput):rawOutput;
  const changedFiles=displayedRun?.file_changes?.length?displayedRun.file_changes:liveFiles[displayedRunId||'']||[];
  const activities=displayedRun?.activities?.length?displayedRun.activities:liveActivities[displayedRunId||'']||[];
  const outputRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const container=outputRef.current;
    if(container)container.scrollTop=container.scrollHeight;
  },[current.length,output,activities.length,changedFiles.length,displayedRunId]);
  return <section className={active?'':'hidden'} aria-label="Execução de prompt">
    <div className="mb-3 flex items-center gap-2 font-semibold"><Terminal size={21}/> Execução</div>
    <div className="overflow-hidden rounded-lg border border-[#172b4d] bg-[#101828] text-[#d0d9e8] dark:border-[#dfe1e6] dark:bg-white dark:text-[#172b4d]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs dark:border-[#dfe1e6]"><span className={`h-2 w-2 rounded-full ${dot}`}/>{(last?.status==='running'||displayedRun?.status==='running')&&<LoaderCircle size={14} className="animate-spin text-[#579dff]"/>}<span>{last?.status==='error'||displayedRun?.status==='error'?'Falhou':displayedRun?.status==='cancelled'?'Cancelada':last?.status==='success'||displayedRun?.status==='success'?'Concluída':last?.status==='queued'||displayedRun?.status==='queued'?'Na fila':runId?'Em execução':'Aguardando execução'}</span>{displayedRun?.status==='queued'&&<button type="button" onClick={()=>void cancel()} className="ml-auto rounded border border-[#ff8f73] px-2 py-1 font-semibold text-[#ff8f73]">Cancelar</button>}</div>
      <div ref={outputRef} className="min-h-48 max-h-[44vh] overflow-y-auto p-3 font-mono text-xs leading-5">
        {current.map((event,index)=><p key={`${event.at}:${index}`} className={event.status==='error'?'text-[#ff8f73] dark:text-[#ae2a19]':event.status==='success'?'text-[#7ee2b8] dark:text-[#216e4e]':'text-[#d0d9e8] dark:text-[#172b4d]'}><span className="mr-2 text-[#738496] dark:text-[#626f86]">{new Date(event.at).toLocaleTimeString('pt-BR')}</span>{event.message}</p>)}
        {displayedRun?<div className={current.length?'mt-3 border-t border-white/10 pt-3 dark:border-[#dfe1e6]':''}>
          <p className="flex items-center gap-2 text-[#d0d9e8] dark:text-[#172b4d]">{displayedRun.status==='success'?<span className="h-2 w-2 rounded-full bg-[#0c66e4]"/>:displayedRun.status==='error'?<XCircle size={15} className="text-[#ff8f73] dark:text-[#ae2a19]"/>:displayedRun.status==='cancelled'?<XCircle size={15}/>:<LoaderCircle size={15} className="animate-spin text-[#579dff]"/>}<span>Execução: {displayedRun.status==='success'?'concluída':displayedRun.status==='error'?'falhou':displayedRun.status==='cancelled'?'cancelada':displayedRun.status==='queued'?'na fila':'em andamento'}.</span></p>
          {displayedRun.error&&<p className="mt-3 text-[#ff8f73] dark:text-[#ae2a19]">{displayedRun.error}</p>}
        </div>:null}
        {output&&<LiveMarkdown text={output}/>}
        <CommandActivities activities={activities}/>
        <FileChangeReview files={changedFiles}/>
        {!displayedRun&&current.length===0&&!output?<p className="text-[#9fadbc] dark:text-[#626f86]">Inicie uma execução na sessão de prompt para acompanhar o Codex aqui.</p>:null}
      </div>
    </div>
    {runs.length>0&&<div className="mt-4"><h4 className="mb-2 text-sm font-semibold">Histórico de execuções</h4><div className="space-y-1">{runs.map(run=><button key={run.id} type="button" onClick={()=>setHistoryRunId(run.id)} className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-xs ${displayedRunId===run.id?'border-[#0c66e4] bg-[#e9f2ff]':'border-[#dfe1e6] bg-white'}`}><span className="min-w-0 truncate"><span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${run.source==='comment'?'bg-[#e9ddff] text-[#403294]':'bg-[#dfeeff] text-[#0747a6]'}`}>{run.source==='comment'?'Comentário':'Descrição'}</span>{new Date(run.started_at).toLocaleString('pt-BR')} · {run.model} · {run.effort}</span><span className={run.status==='error'?'text-[#ae2a19]':run.status==='success'?'text-[#0c66e4]':'text-[#626f86]'}>{run.status==='success'?'Concluída':run.status==='error'?'Falhou':run.status==='cancelled'?'Cancelada':run.status==='queued'?'Na fila':'Executando'}</span></button>)}</div></div>}
  </section>;
}
