'use client';

import {useCallback,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {ArrowUpRight,CheckCircle2,Clipboard,Terminal,TriangleAlert,Wrench} from 'lucide-react';
import {api,Board,getToken,ToolDiagnostics,ToolDiagnostic,User} from '@/lib/api';
import {AppHeader,WorkspaceSidebar} from '@/components/ui';

function ToolIssue({issue,onOpen}:{issue:ToolDiagnostic;onOpen:()=>void}){
  const [copied,setCopied]=useState('');
  async function copy(value:string,label:string){
    try{await navigator.clipboard.writeText(value);setCopied(label);window.setTimeout(()=>setCopied(''),1800)}catch{setCopied('Copie o comando manualmente.')}
  }
  return <article className="rounded-xl border border-[#dfe1e6] bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#ffebe6] text-[#ae2a19]"><TriangleAlert size={18}/></span>
      <div className="min-w-0 flex-1"><h2 className="font-semibold">{issue.title}</h2><p className="mt-1 text-sm text-[#626f86]">{issue.board_title} · {issue.card_title} · {new Date(issue.created_at).toLocaleString('pt-BR')}</p></div>
      <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 rounded-lg border border-[#0c66e4] px-3 py-2 text-xs font-semibold text-[#0c66e4] hover:bg-[#e9f2ff]">Abrir cartão para tentar novamente<ArrowUpRight size={14}/></button>
    </div>
    <p className="mt-3 text-sm text-[#44546f]">{issue.details}</p>
    {issue.installCommands.length>0&&<div className="mt-4"><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#626f86]">Instalação da ferramenta</h3><div className="space-y-2">{issue.installCommands.map((entry,index)=>{const command=entry.includes(': ')?entry.slice(entry.indexOf(': ')+2):entry;return <div key={index} className="flex items-start gap-2 rounded-lg bg-[#f7f8fa] p-2.5"><code className="min-w-0 flex-1 break-all text-xs text-[#172b4d]">{entry}</code><button type="button" onClick={()=>void copy(command,`install-${index}`)} title="Copiar comando" aria-label="Copiar comando de instalação" className="shrink-0 rounded p-1 text-[#626f86] hover:bg-white"><Clipboard size={15}/></button></div>})}</div></div>}
    {issue.failedCommand&&<div className="mt-4"><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#626f86]">Comando que falhou</h3><div className="flex items-start gap-2 rounded-lg bg-[#172b4d] p-3 text-white"><Terminal size={15} className="mt-0.5 shrink-0 text-[#79c0ff]"/><code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs">{issue.failedCommand}</code><button type="button" onClick={()=>void copy(issue.failedCommand||'',`failed-${issue.run_id}`)} title="Copiar comando" aria-label="Copiar comando que falhou" className="shrink-0 rounded p-1 text-[#a9b8ca] hover:bg-white/10"><Clipboard size={15}/></button></div>{copied&&<p role="status" className="mt-1 text-xs text-[#626f86]">{copied.startsWith('install-')||copied.startsWith('failed-')?'Comando copiado.':copied}</p>}</div>}
    <p className="mt-4 rounded-lg bg-[#f7f8fa] p-3 text-xs text-[#44546f]">Depois de corrigir a ferramenta, abra o cartão e inicie novamente o prompt na aba de execução.</p>
  </article>;
}

export default function ToolsPage(){
  const router=useRouter();
  const [user,setUser]=useState<User|null>(null);
  const [boards,setBoards]=useState<Board[]>([]);
  const [diagnostics,setDiagnostics]=useState<ToolDiagnostics|null>(null);
  const [aiAvailable,setAiAvailable]=useState(false);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    try{const [all,current,catalog]=await Promise.all([api<Board[]>('/boards'),api<User>('/auth/me'),api<{plugins:Array<{id:string;enabled:boolean}>}>('/plugins')]);const enabled=catalog.plugins.some(plugin=>plugin.id==='ai'&&plugin.enabled);setBoards(all);setUser(current);setAiAvailable(enabled);if(enabled)setDiagnostics(await api<ToolDiagnostics>('/tools/diagnostics'));else setDiagnostics(null);setError('')}
    catch(reason){setError((reason as Error).message)}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>{if(!getToken()){router.push('/');return}void load()},0);return()=>window.clearTimeout(timer)},[load,router]);
  useEffect(()=>{if(!aiAvailable)return;const timer=window.setInterval(()=>void api<ToolDiagnostics>('/tools/diagnostics').then(setDiagnostics).catch(()=>undefined),15_000);return()=>window.clearInterval(timer)},[aiAvailable]);
  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]"><AppHeader user={user} boards={boards}/><div className="flex min-h-0 flex-1"><WorkspaceSidebar boards={boards} onCreate={()=>router.push('/boards?create=1')} onChoose={id=>router.push(id?`/board/${id}`:'/boards')}/><main className="min-w-0 flex-1 p-4 sm:p-6"><div className="mx-auto max-w-5xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Wrench className="text-[#0c66e4]"/>Ferramentas</h1><p className="mt-1 text-sm text-[#626f86]">Falhas de ferramentas detectadas nos prompts e como corrigi-las.</p></div>{(user?.is_root||user?.permissions?.includes('monitoring.read'))&&<Link href="/monitoring" className="inline-flex min-h-11 items-center rounded-lg border border-[#c1c7d0] bg-white px-3 text-sm font-semibold">Monitoramento operacional</Link>}</header>
    {!aiAvailable&&<p role="status" className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">O plugin de IA está desativado nesta instância; os diagnósticos de prompts não estão disponíveis.</p>}{aiAvailable&&diagnostics&&<div className={`mb-5 flex items-center gap-3 rounded-xl border p-4 ${diagnostics.status==='error'?'border-[#ffbdad] bg-[#ffebe6] text-[#ae2a19]':diagnostics.status==='running'?'border-[#b3d4ff] bg-[#e9f2ff] text-[#0747a6]':'border-[#abf5d1] bg-[#dcfff1] text-[#216e4e]'}`}>{diagnostics.status==='error'?<TriangleAlert size={19}/>:diagnostics.status==='running'?<Terminal size={19}/>:<CheckCircle2 size={19}/>}<p className="text-sm font-semibold">{diagnostics.status==='error'?'O último prompt falhou por causa de uma ferramenta.':diagnostics.status==='running'?'O último prompt está em andamento; o diagnóstico será atualizado ao terminar.':'Nenhuma falha de ferramenta detectada no último prompt.'}</p></div>}
    {error&&<p role="alert" className="mb-4 rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
    {aiAvailable&&(diagnostics?.issues.length?<section className="space-y-3" aria-label="Falhas de ferramentas"><div className="mb-3"><h2 className="text-lg font-bold">Erros encontrados</h2><p className="text-sm text-[#626f86]">{diagnostics.issues.length} falha(s) de ferramenta nos prompts registrados.</p></div>{diagnostics.issues.map(issue=><ToolIssue key={`${issue.run_id}-${issue.kind}-${issue.tool}`} issue={issue} onOpen={()=>router.push(`/board/${issue.board_id}?card=${issue.card_id}`)}/>)}</section>:diagnostics?<div className="rounded-xl border border-dashed border-[#abf5d1] bg-white p-10 text-center"><CheckCircle2 className="mx-auto text-[#22a06b]" size={28}/><h2 className="mt-3 font-semibold">Nenhum erro de ferramenta registrado</h2><p className="mt-1 text-sm text-[#626f86]">Quando um prompt falhar por ferramenta ausente, permissão ou comando inválido, as instruções aparecerão aqui.</p></div>:<p className="rounded-xl border bg-white p-8 text-center text-sm text-[#626f86]">Carregando diagnóstico…</p>)}
  </div></main></div></div>;
}
