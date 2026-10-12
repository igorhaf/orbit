"use client";

import {useEffect,useState} from 'react';
import {Play,Square,RotateCw,ShieldCheck,RefreshCw,X} from 'lucide-react';
import {api,send} from '@/lib/api';

type Configuration={tunnelName:string;tunnelId:string;publicHostname:string;mode:'remote'|'local'|'quick';executablePath:string;configPath:string;quickUrl:string;managedBy:'orbit'|'system';autoStart:boolean;restartOnFailure:boolean;restartDelaySeconds:number;maxRestartAttempts:number;restartWindowSeconds:number;logLimit:number};
type Status={state:string;enabled:boolean;installed:boolean;version:string|null;pid:number|null;startedAt:string|null;uptimeSeconds:number|null;restartCount:number;lastError:string|null;temporaryUrl:string|null;recovered:boolean;running:boolean;logs:Array<{at:string;stream:string;message:string}>};
type Settings={configuration:Configuration;tokenConfigured:boolean;enabled:boolean};
const base='/plugins/cloudflare-tunnel';
const labels:Record<string,string>={DISABLED:'Desativado',NOT_INSTALLED:'cloudflared não instalado',NOT_CONFIGURED:'Configuração incompleta',STOPPED:'Parado',STARTING:'Iniciando',CONNECTED:'Conectado',STOPPING:'Encerrando',DEGRADED:'Degradado',ERROR:'Erro'};
const inputClass='mt-1 min-h-11 w-full min-w-0 rounded border border-[#c1c7d0] bg-white px-3 py-2 text-sm font-normal text-[#172b4d] disabled:opacity-60';
const buttonClass='inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#c1c7d0] px-3 py-2 text-sm font-semibold text-[#172b4d] disabled:opacity-50';
export function CloudflareTunnelPanel({onClose,onEnabledChanged}:{onClose:()=>void;onEnabledChanged:(enabled:boolean)=>void}) {
  const [draft,setDraft]=useState<Configuration|null>(null);
  const [status,setStatus]=useState<Status|null>(null);
  const [tokenConfigured,setTokenConfigured]=useState(false);
  const [replaceToken,setReplaceToken]=useState(false);
  const [removeToken,setRemoveToken]=useState(false);
  const [token,setToken]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    let active=true;
    void Promise.all([api<Settings>(`${base}/configuration`),api<Status>(`${base}/status`)]).then(([settings,current])=>{if(active){setDraft(settings.configuration);setTokenConfigured(settings.tokenConfigured);setStatus(current);}}).catch(reason=>{if(active)setError((reason as Error).message);});
    const timer=setInterval(()=>{void api<Status>(`${base}/status`).then(current=>{if(active)setStatus(current);}).catch(()=>{});},3000);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  async function refresh() {const current=await api<Status>(`${base}/status`);setStatus(current);}
  async function action(name:'detect'|'validate'|'start'|'stop'|'restart') {
    setBusy(name);setError('');setNotice('');
    try{const result=await send<{valid?:boolean;issues?:string[]}>(`${base}/${name}`,'POST');if(name==='validate')setNotice(result.valid?'Configuração válida. Você pode iniciar o tunnel.':(result.issues||[]).join(' '));else if(name==='detect')setNotice('Detecção concluída. Confira o executável e a versão abaixo.');await refresh();}
    catch(reason){setError((reason as Error).message);}finally{setBusy('');}
  }
  async function toggle() {
    setBusy('toggle');setError('');
    try{const result=await send<{enabled:boolean}>(base,'PATCH',{enabled:!status?.enabled});onEnabledChanged(result.enabled);window.dispatchEvent(new Event('plugins:changed'));await refresh();}
    catch(reason){setError((reason as Error).message);}finally{setBusy('');}
  }
  async function save(event:React.FormEvent) {
    event.preventDefault();setBusy('save');setError('');setNotice('');
    try{const result=await send<{tokenConfigured:boolean;status:Status}>(`${base}/configuration`,'PATCH',{configuration:draft,...(token?{token}:{}),removeToken});setTokenConfigured(result.tokenConfigured);setToken('');setReplaceToken(false);setRemoveToken(false);setStatus(result.status);setNotice('Configuração salva. O token armazenado não é retornado pela API.');}
    catch(reason){setError((reason as Error).message);}finally{setBusy('');}
  }
  function change<K extends keyof Configuration>(key:K,value:Configuration[K]) {setDraft(current=>current?{...current,[key]:value}:current);}
  const owned=draft?.managedBy==='orbit';
  const running=Boolean(status?.running&&owned);
  const blocked=Boolean(busy);
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#091e42a6] p-2 sm:p-6" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section role="dialog" aria-modal="true" aria-label="Configurar Cloudflare Tunnel" className="mx-auto my-3 w-full max-w-4xl min-w-0 rounded-xl bg-white p-4 text-[#172b4d] shadow-dialog sm:my-6 sm:p-6">
      <header className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-[#0c66e4]">Configuração do plugin</p><h2 className="mt-1 text-xl font-bold">Cloudflare Tunnel</h2><p className="mt-2 text-sm text-[#626f86]">1. Detecte o binário · 2. Escolha o modo · 3. Salve · 4. Valide · 5. Inicie</p></div><button aria-label="Fechar Cloudflare Tunnel" className={buttonClass} onClick={onClose}><X size={18}/></button></header>
      {error&&<p role="alert" className="mt-4 break-words rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
      {notice&&<p role="status" className="mt-4 break-words rounded bg-[#e9f2ff] p-3 text-sm">{notice}</p>}
      {status&&<div className="mt-5 rounded-xl border border-[#dfe1e6] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><strong data-testid="tunnel-state" className={status.state==='CONNECTED'?'text-[#216e4e]':'text-[#344563]'}>{labels[status.state]||status.state}</strong><button className={buttonClass} disabled={blocked} onClick={()=>void toggle()}>{status.enabled?'Desativar plugin':'Ativar plugin'}</button></div><dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">{[['cloudflared',status.installed?'Instalado':'Não detectado'],['Versão',status.version||'—'],['PID',status.pid?.toString()||'—'],['Iniciado',status.startedAt?new Date(status.startedAt).toLocaleString('pt-BR'):'—'],['Tempo ativo',status.uptimeSeconds===null?'—':`${status.uptimeSeconds}s`],['Reinícios',String(status.restartCount)]].map(([name,value])=><div key={name} className="min-w-0"><dt className="text-xs text-[#626f86]">{name}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}</dl>{status.lastError&&<p className="mt-4 break-words text-sm text-[#ae2a19]">{status.lastError}</p>}{status.temporaryUrl&&<p className="mt-4 break-words text-sm">URL temporária: <a className="text-[#0c66e4] underline" href={status.temporaryUrl} target="_blank" rel="noreferrer">{status.temporaryUrl}</a></p>}{status.recovered&&<p className="mt-3 text-xs text-[#626f86]">Processo recuperado com identidade verificada; apenas novos eventos de monitoramento ficam disponíveis.</p>}</div>}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"><button className={buttonClass} disabled={blocked} onClick={()=>void action('detect')}><RefreshCw size={16}/>Detectar</button><button className={buttonClass} disabled={blocked} onClick={()=>void action('validate')}><ShieldCheck size={16}/>Validar</button><button className={`${buttonClass} bg-[#0c66e4] text-white`} disabled={blocked||!status?.enabled||!owned||running} onClick={()=>void action('start')}><Play size={16}/>Iniciar</button><button className={buttonClass} disabled={blocked||!owned||!status?.running} onClick={()=>void action('stop')}><Square size={16}/>Parar</button><button className={buttonClass} disabled={blocked||!status?.enabled||!owned} onClick={()=>void action('restart')}><RotateCw size={16}/>Reiniciar</button></div>
      {!draft&&!error&&<p className="mt-6 text-sm">Carregando configuração…</p>}
      {draft&&<form onSubmit={save} className="mt-6"><h3 className="font-bold">Configuração</h3>{running&&<p className="mt-2 text-sm text-[#626f86]">Pare o tunnel para alterar e salvar a configuração.</p>}<fieldset disabled={running||blocked} className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-semibold">Nome do tunnel<input className={inputClass} value={draft.tunnelName||''} onChange={event=>change('tunnelName',event.target.value)}/></label>
        <label className="min-w-0 text-sm font-semibold">ID do tunnel<input className={inputClass} value={draft.tunnelId||''} onChange={event=>change('tunnelId',event.target.value)} placeholder="UUID informado pela Cloudflare"/></label>
        <label className="min-w-0 text-sm font-semibold sm:col-span-2">Domínio público<input className={inputClass} value={draft.publicHostname||''} onChange={event=>change('publicHostname',event.target.value)} placeholder="orbit.meadadigital.com"/><span className="mt-1 block text-xs font-normal text-[#626f86]">Registro de referência. Configure a rota e o DNS deste hostname no painel Cloudflare; salvar aqui não publica o endereço.</span></label>
        <label className="min-w-0 text-sm font-semibold">Modo<select className={inputClass} value={draft.mode} onChange={event=>{const mode=event.target.value as Configuration['mode'];setDraft(current=>current?{...current,mode,autoStart:mode==='quick'?false:current.autoStart}:current);}}><option value="remote">Remote Managed · recomendado</option><option value="local">Locally Managed</option><option value="quick">Quick Tunnel · temporário</option></select></label>
        <label className="min-w-0 text-sm font-semibold">Administrado por<select className={inputClass} value={draft.managedBy} onChange={event=>change('managedBy',event.target.value as Configuration['managedBy'])}><option value="orbit">Orbit</option><option value="system">Sistema · somente observar</option></select></label>
        <label className="min-w-0 text-sm font-semibold sm:col-span-2">Caminho do executável<input className={inputClass} value={draft.executablePath} placeholder="auto ou /usr/bin/cloudflared" onChange={event=>change('executablePath',event.target.value)}/></label>
        {draft.mode==='remote'&&<div className="min-w-0 sm:col-span-2"><p className="text-sm font-semibold">Tunnel Token</p>{tokenConfigured&&!replaceToken?<div className="mt-2 flex flex-wrap items-center gap-3"><span aria-label="Token armazenado">••••••••••••••••••</span><button type="button" className={buttonClass} onClick={()=>{setReplaceToken(true);setRemoveToken(false);}}>Substituir token</button><button type="button" className={buttonClass} onClick={()=>{setRemoveToken(current=>!current);setToken('');}}>{removeToken?'Cancelar remoção':'Remover token'}</button></div>:<label className="block"><span className="sr-only">Novo Tunnel Token</span><input className={inputClass} type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={event=>setToken(event.target.value)} placeholder={tokenConfigured?'Deixe vazio para manter o token':'Cole o token do tunnel'}/>{replaceToken&&<button type="button" className="mt-2 min-h-11 text-sm text-[#0c66e4]" onClick={()=>{setReplaceToken(false);setToken('');}}>Cancelar substituição</button>}</label>}{removeToken&&<p className="mt-2 text-sm text-[#ae2a19]">O token será removido ao salvar.</p>}</div>}
        {draft.mode==='local'&&<label className="min-w-0 text-sm font-semibold sm:col-span-2">Arquivo YAML existente<input className={inputClass} value={draft.configPath} placeholder="~/.cloudflared/config.yml" onChange={event=>change('configPath',event.target.value)}/><span className="mt-1 block text-xs font-normal text-[#626f86]">O Orbit valida o arquivo e as credenciais, sem sobrescrevê-los.</span></label>}
        {draft.mode==='quick'&&<label className="min-w-0 text-sm font-semibold sm:col-span-2">URL local<input className={inputClass} value={draft.quickUrl} onChange={event=>change('quickUrl',event.target.value)}/><span className="mt-1 block text-xs font-normal text-[#626f86]">Endereço temporário para desenvolvimento. Nunca substitui outro modo automaticamente.</span></label>}
        {owned?<><label className="flex min-h-11 items-center gap-3 text-sm"><input className="h-5 w-5" type="checkbox" checked={draft.autoStart} disabled={draft.mode==='quick'} onChange={event=>change('autoStart',event.target.checked)}/>Iniciar automaticamente ao carregar o plugin</label><label className="flex min-h-11 items-center gap-3 text-sm"><input className="h-5 w-5" type="checkbox" checked={draft.restartOnFailure} onChange={event=>change('restartOnFailure',event.target.checked)}/>Reiniciar após falha, com limite</label>{([['restartDelaySeconds','Intervalo entre reinícios (s)',1,300],['maxRestartAttempts','Máximo de reinícios',0,20],['restartWindowSeconds','Janela do limite (s)',10,86400],['logLimit','Linhas de log retidas',50,1000]] as const).map(([key,label,min,max])=><label className="min-w-0 text-sm font-semibold" key={key}>{label}<input className={inputClass} type="number" min={min} max={max} value={draft[key]} onChange={event=>change(key,Number(event.target.value))}/></label>)}</>:<p className="text-sm text-[#626f86] sm:col-span-2">Processos externos não são parados, reiniciados ou adotados. A observação confirma somente a presença do processo, sem afirmar conectividade.</p>}
      </fieldset><button className={`${buttonClass} mt-4 bg-[#0c66e4] text-white`} disabled={running||blocked}>{busy==='save'?'Salvando…':'Salvar configuração'}</button><p className="mt-2 text-xs text-[#626f86]">Alterações são aplicadas pelo próprio plugin. Autostart habilitado também se aplica ao salvar uma configuração válida.</p></form>}
      <details className="mt-6 rounded-lg border border-[#dfe1e6] p-4"><summary className="min-h-11 cursor-pointer font-bold">Logs · {status?.logs.length||0} linhas</summary><div role="log" aria-label="Logs do Cloudflare Tunnel" className="mt-3 max-h-80 min-w-0 overflow-y-auto rounded bg-[#f1f2f4] p-3 font-mono text-xs">{status?.logs.length?status.logs.map((entry,index)=><p className="mb-2 whitespace-pre-wrap break-all" key={`${entry.at}-${index}`}>{entry.at} [{entry.stream}] {entry.message}</p>):<p>Sem logs. Processos externos não fornecem logs ao Orbit.</p>}</div></details>
      <p className="mt-5 text-xs leading-5 text-[#626f86]">Em Docker, o executável e os arquivos precisam estar acessíveis no contêiner da API. A instalação do binário, volumes, serviços do sistema e DNS são configurados explicitamente pelo administrador.</p>
    </section>
  </div>;
}
