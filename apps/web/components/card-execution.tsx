'use client';
import {useCallback,useEffect,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import {api,send,Board,Card} from '@/lib/api';
import {Catalog,ExecutionConfig,ExecutionDetails,Output,executionStatus} from '@/lib/execution';

export function CardActivityIndicator({card}:{card:Card}){
  const promptStatus=card.prompt?.status;
  const runStatus=card.result?.status;
  const active=['queued','running'].includes(promptStatus||'')||['queued','running'].includes(runStatus||'');
  const unread=Boolean(card.prompt?.unread||card.result?.unread);
  const failed=(promptStatus==='error'&&Boolean(card.prompt?.unread))||(runStatus==='failed'&&Boolean(card.result?.unread));
  if(active)return <LoaderCircle aria-label="Atividade em andamento" size={14} className="shrink-0 animate-spin text-[#0c66e4]"/>;
  if(failed&&unread)return <span aria-label="Atividade falhou" title="Atividade falhou" className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#e5484d]"/>;
  if(unread)return <span aria-label="Atividade concluída" title="Atividade concluída" className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0c66e4]"/>;
  return null;
}

const input='w-full min-w-0 rounded border border-white/15 bg-[#0b1220] px-2 py-1.5 text-sm text-[#d0d9e8]';
const button='rounded bg-[#1f6feb] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50';
function Select({label,value,options,onChange}:{label:string;value:string;options:{id:string;name:string}[];onChange:(v:string)=>void}){return <label className="block text-xs font-semibold">{label}<select aria-label={label} className={input+' mt-1'} value={value} onChange={e=>onChange(e.target.value)}><option value="">Selecione</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
function Multi({label,value,options,onChange}:{label:string;value:string[];options:{id:string;name:string}[];onChange:(v:string[])=>void}){return <fieldset className="space-y-1 text-xs"><legend className="mb-1 font-semibold">{label}</legend>{!options.length&&<p className="text-[#626f86]">Nenhum recurso registrado.</p>}{options.map(o=><label key={o.id} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={value.includes(o.id)} onChange={e=>onChange(e.target.checked?[...value,o.id]:value.filter(x=>x!==o.id))}/>{o.name}</label>)}</fieldset>}
export function ExecutionOutput({output}:{output:Output}){
  const text=typeof output.value==='string'?output.value:JSON.stringify(output.value,null,2);
  const url=['url','pull_request'].includes(output.type)&&typeof output.value==='string'&&/^https?:\/\//.test(output.value);
  return <div className="min-w-0 rounded border border-white/10 bg-[#151b24] p-2 text-[#d0d9e8]"><h4 className="text-xs font-bold">{output.label||output.type}</h4>{url?<a href={text} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-[#79c0ff] underline">{text}</a>:<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{text}</pre>}</div>;
}
export function CardExecutionBadge({card}:{card:Card;listColor?:string|null}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!card.execution?.enabled||!card.execution.project_id)return null;
  const active=busy||['queued','running'].includes(card.prompt?.status||'')||['queued','running'].includes(card.result?.status||'');
  return <div className="mt-2 flex flex-wrap items-center gap-2 overflow-hidden rounded-lg border border-[#172b4d] bg-[#101828] px-3 py-2 text-[11px] text-[#d0d9e8] dark:border-[#dfe1e6] dark:bg-white dark:text-[#172b4d]">
    <span className={`h-2 w-2 rounded-full ${active?'bg-[#79c0ff] animate-pulse':'bg-[#4fd49a]'}`}/>
    <span className="font-mono">{card.execution.agent||card.execution.executor} · {executionStatus[card.result?.status||'idle']}</span>
    <button disabled={active} onPointerDown={e=>e.stopPropagation()} onClick={async e=>{e.stopPropagation();setBusy(true);setError('');try{await send(`/cards/${card.source_card_id||card.id}/runs`,'POST',{request_key:crypto.randomUUID()});window.dispatchEvent(new Event('data:changed'))}catch(error){setError((error as Error).message)}finally{setBusy(false)}}} className="rounded-md border border-white/15 px-2 py-1 font-mono text-[#79c0ff] hover:bg-white/5 disabled:opacity-50">{active?'Executando…':'Executar'}</button>
    {error&&<span role="alert" className="text-[#ff776f]">{error}</span>}
  </div>;
}

export function CardExecutionPanel({card,board,onChanged,onExecutionStart,onExecutionEnd,aiLocked=false,mode='all'}:{card:Card;board:Board;onChanged:()=>Promise<void>;onExecutionStart?:()=>void;onExecutionEnd?:()=>void;aiLocked?:boolean;mode?:'all'|'settings'|'outputs'}){
  const [details,setDetails]=useState<ExecutionDetails|null>(null),[draft,setDraft]=useState<ExecutionConfig|null>(null),[catalog,setCatalog]=useState<Catalog|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  useEffect(()=>{let live=true;api<ExecutionDetails>(`/cards/${card.id}/execution`).then(data=>{if(live){setDetails(data);setDraft(data.execution)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[card.id]);
  const project=draft?.project_id;
  useEffect(()=>{let live=true;api<Catalog>('/execution/catalog'+(project?'?project_id='+project:'')).then(data=>{if(live)setCatalog(data)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[project]);
  const refresh=useCallback(async()=>{const data=await api<ExecutionDetails>(`/cards/${card.id}/execution`);setDetails(data);return data},[card.id]);
  const active=details?.runs.some(r=>['queued','running'].includes(r.status));
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)void api<ExecutionDetails>(`/cards/${card.id}/execution`).then(setDetails).catch(e=>setError(e.message))},active?1500:5000);return()=>clearInterval(timer)},[card.id,active]);
  function edit(patch:Partial<ExecutionConfig>){setDraft(current=>current?{...current,...patch}:null);setDirty(true)}
  async function work(fn:()=>Promise<unknown>,startsExecution=false){setBusy(true);setError('');if(startsExecution)onExecutionStart?.();try{await fn();await refresh();await onChanged()}catch(error){setError((error as Error).message)}finally{setBusy(false);if(startsExecution)onExecutionEnd?.()}}
  if(!draft||!catalog)return error?<p role="alert" className="text-sm text-red-700">{error}</p>:null;
  if(!draft.project_id)return null;
  const resources=(kind:string)=>catalog.project?.resources.filter(r=>r.kind===kind)||[];
  const enabledPlugins=Array.isArray(catalog.project?.config.plugins)?catalog.project.config.plugins.filter((id):id is string=>typeof id==='string'):[];
  const plugins=catalog.plugins.filter(plugin=>enabledPlugins.includes(plugin.id));
  const actions=catalog.executors.find(e=>e.id===draft.executor)?.actions||[];
  const section='rounded-lg border border-white/10 bg-[#151b24] p-3';
  const textList=(text:string)=>text.split('\n').map(x=>x.trim()).filter(Boolean);
  const context=(patch:Partial<ExecutionConfig['context']>)=>edit({context:{...draft.context,...patch}});
  return <section className="space-y-2 rounded-lg bg-[#101828] p-3 text-[#d0d9e8]" aria-label="Capacidades do cartão">
    {mode !== 'outputs' && <>
    {error&&<p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    <details className={section}><summary className="cursor-pointer text-sm font-semibold">Execução opcional {draft.enabled&&<span className="ml-2 text-xs font-normal">{executionStatus[details?.result.status||'idle']}</span>}</summary><fieldset disabled={Boolean(active)||aiLocked} className="mt-3 space-y-3 disabled:opacity-60">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e=>edit({enabled:e.target.checked})}/>Habilitar execução neste cartão</label>
      <Select label="Projeto" value={draft.project_id||''} options={catalog.projects} onChange={id=>edit({project_id:id||null,agent:null,skills:[],context:{},integrations:[]})}/>
      {!catalog.projects.length&&<p className="text-xs">Cadastre a pasta do projeto em <a href="/profile" className="text-[#0c66e4] underline">Perfil</a>.</p>}
      {catalog.project?.warnings.map((warning,i)=><p key={i} className="text-xs text-red-700">{warning}</p>)}
      <div className="grid gap-3 sm:grid-cols-2"><Select label="Agente" value={draft.agent||''} options={resources('agents')} onChange={agent=>edit({agent:agent||null})}/><Select label="Executor" value={draft.executor||''} options={catalog.executors} onChange={executor=>edit({executor:executor||null,action:null})}/><Select label="Ação de execução" value={draft.action||''} options={actions} onChange={action=>edit({action:action||null})}/></div>
      <Multi label="Skills" options={resources('skills')} value={draft.skills} onChange={skills=>edit({skills})}/>
      <label className="block text-xs font-semibold">Pasta de trabalho (relativa ao projeto)<input className={input+' mt-1'} value={draft.working_directory} onChange={e=>edit({working_directory:e.target.value})}/></label>
      <Multi label="Permissões explícitas" value={draft.permissions} options={catalog.permissions.map(id=>({id,name:({'filesystem.read':'Ler arquivos','filesystem.write':'Alterar arquivos','process.execute':'Executar processos','mail.read':'Ler e pesquisar e-mails','mail.draft':'Criar rascunhos','mail.send':'Enviar e responder e-mails','repository.read':'Ler repositórios','repository.write':'Alterar repositórios','issues.read':'Ler issues','issues.write':'Alterar issues','pull_requests.read':'Ler pull requests','pull_requests.write':'Alterar pull requests','branches.read':'Ler branches','branches.write':'Criar branches'} as Record<string,string>)[id]||id}))} onChange={permissions=>edit({permissions})}/>
      <p className="text-xs text-[#626f86]">As permissões também precisam estar autorizadas no projeto e no agente. A execução de processos usa o sandbox do executor.</p>
    </fieldset></details>
    <details className={section}><summary className="cursor-pointer text-sm font-semibold">Contexto</summary><fieldset disabled={Boolean(active)||aiLocked} className="mt-3 space-y-3"><Multi label="Knowledge" value={draft.context.knowledge||[]} options={resources('knowledge')} onChange={knowledge=>context({knowledge})}/><Multi label="Rules" value={draft.context.rules||[]} options={resources('rules')} onChange={rules=>context({rules})}/><label className="block text-xs font-semibold">Arquivos (um caminho relativo por linha)<textarea className={input+' mt-1'} rows={2} value={draft.context.files?.join('\n')||''} onChange={e=>context({files:textList(e.target.value)})}/></label><Multi label="Cartões de contexto deste quadro" value={draft.context.cards||[]} options={(board.lists||[]).flatMap(l=>l.cards).filter(c=>c.id!==card.id).map(c=>({id:c.id,name:c.title}))} onChange={cards=>context({cards})}/><label className="block text-xs font-semibold">Instruções adicionais<textarea rows={3} className={input+' mt-1'} value={draft.context.instructions||''} onChange={e=>context({instructions:e.target.value})}/></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(draft.context.include_agents_md)} onChange={e=>context({include_agents_md:e.target.checked})}/>Incluir orientação geral do AGENTS.md</label></fieldset></details>
    <details className={section}><summary className="cursor-pointer text-sm font-semibold">Integrações ({draft.integrations.length})</summary><fieldset disabled={Boolean(active)||aiLocked} className="mt-3 space-y-3">{draft.integrations.map((integration,index)=>{const plugin=plugins.find(p=>p.id===integration.plugin),action=plugin?.actions.find(a=>a.id===integration.action);const change=(patch:Partial<typeof integration>)=>edit({integrations:draft.integrations.map((x,i)=>i===index?{...x,...patch}:x)});return <div key={index} className="space-y-2 rounded border p-2"><Select label="Plugin" value={integration.plugin} options={plugins} onChange={plugin=>change({plugin,action:'',config:{}})}/><Select label="Capacidade" value={integration.action} options={plugin?.actions||[]} onChange={action=>change({action,config:{}})}/>{Object.entries(action?.inputSchema.properties||{}).map(([name,schema])=><label key={name} className="block text-xs font-semibold">{name}<input className={input} type={schema.type==='number'?'number':'text'} value={String(integration.config?.[name]||'')} onChange={e=>change({config:{...integration.config,[name]:schema.type==='number'?Number(e.target.value):e.target.value}})}/></label>)}<button type="button" className="text-xs text-red-700" onClick={()=>edit({integrations:draft.integrations.filter((_,i)=>i!==index)})}>Remover integração</button></div>})}<button disabled={draft.integrations.length>=10||!plugins.length} className="text-sm text-[#0c66e4]" onClick={()=>edit({integrations:[...draft.integrations,{plugin:plugins[0]?.id||'',action:plugins[0]?.actions[0]?.id||'',config:{}}]})}>Adicionar integração</button><p className="text-xs text-[#626f86]">Credenciais ficam no servidor. Somente capacidades registradas e habilitadas no projeto podem executar.</p></fieldset></details>
    {dirty&&<button className={button} disabled={busy} onClick={()=>void work(async()=>{const saved=await send<ExecutionConfig>(`/cards/${card.id}/execution`,'PATCH',draft);setDraft(saved);setDirty(false)})}>Salvar capacidades</button>}
    {details?.execution.enabled&&details.execution.project_id&&<div className="flex flex-wrap items-center gap-2"><button className={button} disabled={busy||Boolean(active)||dirty||aiLocked} onClick={()=>void work(()=>send(`/cards/${card.id}/runs`,'POST',{request_key:crypto.randomUUID()}),true)}>{active?'Executando…':'Executar'}</button>{active&&<button className="text-sm text-red-700" disabled={busy} onClick={()=>void work(()=>send(`/execution/runs/${details.runs.find(r=>['queued','running'].includes(r.status))!.id}/cancel`,'POST'))}>Cancelar execução</button>}<span className="text-xs">{executionStatus[details.result.status]}</span></div>}
    </>}
    {mode !== 'settings' && <>
    </>}
  </section>;
}
