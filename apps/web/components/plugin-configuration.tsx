"use client";

import {useEffect,useState} from "react";
import Link from "next/link";
import {api,PluginCatalogItem,send} from "@/lib/api";
import {CalendarIntegrations} from "@/components/calendar-integrations";

import {VaultConstantSelect} from '@/components/vault-constant-select';

type Field={key:string;label:string;secret:boolean;type?:'text'|'textarea'|'number'|'boolean'|'url'|'select';required?:boolean;description?:string;placeholder?:string;min?:number;max?:number;maxLength?:number;options?:Array<{value:string;label:string}>;allowVaultReference?:boolean;value:string;configured:boolean;vaultReference?:string};
type Settings={id:string;name:string;fields:Field[];oauthRedirectUri?:string};
type ConnectionStatus={configured:boolean;connections:Array<{id:string;display_name?:string;label?:string;status?:string}>};

const connectPath:Record<string,string>={
  dropbox:"/dropbox/oauth/start",
  github:"/github/oauth/start",
  gmail:"/mail/gmail/oauth/start",
  google_drive:"/google/drive/oauth/start",
};

export function PluginConfiguration({plugin,onClose,oauthResult}:{plugin:PluginCatalogItem;onClose:()=>void;oauthResult?:{connected:boolean;error:string}}){
  const [settings,setSettings]=useState<Settings|null>(null);
  const [draft,setDraft]=useState<Record<string,string>>({});
  const [clear,setClear]=useState<string[]>([]);
  const [saving,setSaving]=useState(false);
  const [connectionStatus,setConnectionStatus]=useState<ConnectionStatus|null>(null);
  const [error,setError]=useState(oauthResult?.error||"");
  const [notice,setNotice]=useState(oauthResult?.connected?`${plugin.name} conectado.`:"");
  useEffect(()=>{
    let active=true;
    void api<Settings>(`/settings/environment/plugins/${encodeURIComponent(plugin.id)}`).then(data=>{
      if(!active)return;
      setSettings(data);
      setDraft(Object.fromEntries(data.fields.map(field=>[field.key,field.vaultReference||field.value])));
    }).catch(reason=>{if(active)setError((reason as Error).message)});
    return()=>{active=false};
  },[plugin.id]);
  useEffect(()=>{
    if(!plugin.enabled||!['dropbox','github'].includes(plugin.id))return;
    let active=true;
    void api<ConnectionStatus>(`/${plugin.id}/status`).then(result=>{if(active)setConnectionStatus(result)}).catch(reason=>{if(active)setError((reason as Error).message)});
    return()=>{active=false};
  },[plugin.id,plugin.enabled]);
  async function save(event:React.FormEvent){
    event.preventDefault();setSaving(true);setError("");setNotice("");
    try{
      const values=Object.fromEntries(Object.entries(draft).filter(([key,value])=>value.length>0&&!clear.includes(key)));
      const result=await send<{message:string}>(`/settings/environment/plugins/${encodeURIComponent(plugin.id)}`,"PATCH",{values,clear});
      const data=await api<Settings>(`/settings/environment/plugins/${encodeURIComponent(plugin.id)}`);
      setSettings(data);setDraft(Object.fromEntries(data.fields.map(field=>[field.key,field.vaultReference||field.value])));setClear([]);setNotice(result.message);
    }catch(reason){setError((reason as Error).message)}finally{setSaving(false)}
  }
  async function connect(){
    setError("");
    try{const result=await api<{url:string}>(connectPath[plugin.id]);window.location.assign(result.url)}catch(reason){setError((reason as Error).message)}
  }
  function updateField(field:Field,value:string){setDraft(current=>({...current,[field.key]:value}));setClear(current=>current.filter(key=>key!==field.key))}
  function renderField(field:Field){
    const value=draft[field.key]?.startsWith('orbit-vault://')?'':draft[field.key]||'';
    const disabled=Boolean(draft[field.key]?.startsWith('orbit-vault://'));
    const controlClass='mt-1 w-full min-h-10 rounded border border-[#c1c7d0] px-3 py-2 text-sm font-normal text-[#172b4d]';
    if(field.type==='select'||field.type==='boolean')return <select required={field.required} disabled={disabled} value={value} onChange={event=>updateField(field,event.target.value)} className={controlClass}><option value="">Selecione</option>{(field.type==='boolean'?[{value:'true',label:'Sim'},{value:'false',label:'Não'}]:field.options||[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    if(field.type==='textarea')return <textarea required={field.required} autoComplete="off" spellCheck={false} rows={3} maxLength={field.maxLength} disabled={disabled} value={value} onChange={event=>updateField(field,event.target.value)} placeholder={field.configured?'Configurado; deixe vazio para manter':field.placeholder||'Não configurado'} className={`${controlClass} resize-y`}/>;
    return <input required={field.required} type={field.secret?'password':field.type==='number'?'number':field.type==='url'?'url':'text'} min={field.min} max={field.max} maxLength={field.maxLength} autoComplete="off" spellCheck={false} disabled={disabled} value={value} onChange={event=>updateField(field,event.target.value)} placeholder={field.configured&&field.secret?'Configurado; deixe vazio para manter':field.placeholder||'Não configurado'} className={controlClass}/>;
  }
  const calendarProvider=plugin.id==='google_calendar'?'google_calendar':['outlook_calendar','outlook_mail','teams'].includes(plugin.id)?'outlook_calendar':null;
  const calendarOption=plugin.id==='outlook_mail'?'mail':plugin.id==='teams'?'teams':plugin.id==='outlook_calendar'?'calendar':undefined;
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#091e42a6] p-4 pt-[6vh]" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section role="dialog" aria-modal="true" aria-label={`Configurar ${plugin.name}`} className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-dialog">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-[#0c66e4]">Configuração do plugin</p><h2 className="mt-1 text-xl font-bold text-[#172b4d]">{plugin.name}</h2><p className="mt-1 font-mono text-xs text-[#626f86]">{plugin.id}</p></div><button type="button" onClick={onClose} className="rounded px-2 py-1 text-xl text-[#626f86] hover:bg-[#f1f2f4]" aria-label="Fechar">×</button></div>
      {error&&<p role="alert" className="mt-5 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
      {notice&&<p role="status" className="mt-5 rounded bg-[#dffcf0] p-3 text-sm text-[#216e4e]">{notice}</p>}
      {!settings&&!error&&<p className="mt-6 text-sm text-[#626f86]">Carregando configuração…</p>}
      {settings&&<form onSubmit={save} className="mt-6">
        {settings.oauthRedirectUri&&<div className="mb-5 rounded border border-[#c3b6f7] bg-[#f7f5ff] p-3 text-sm text-[#344563]"><p className="font-semibold">URI de redirecionamento enviado ao Google</p><code className="mt-2 block break-all select-all rounded bg-white p-2 text-xs">{settings.oauthRedirectUri}</code><p className="mt-2">Cadastre este URI em “URIs de redirecionamento autorizados” no <a className="font-semibold text-[#0c66e4] underline" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">cliente OAuth do Google Cloud</a> e salve. Use o mesmo cliente configurado nas credenciais Google compartilhadas.</p></div>}
        {settings.fields.length?<><p className="mb-4 text-sm text-[#626f86]">As variáveis deste plugin ficam no servidor. Segredos configurados não são exibidos; deixe o campo vazio para mantê-los.</p><div className="grid gap-4 md:grid-cols-2">{settings.fields.map(field=><div key={field.key} className="min-w-0 text-xs font-semibold text-[#344563]"><span>{field.label}{field.required?' · obrigatório':''}</span>{renderField(field)}{field.description&&<p className="mt-1 text-xs font-normal text-[#626f86]">{field.description}</p>}{(field.secret||field.allowVaultReference)&&<VaultConstantSelect label={`Constante para ${field.label}`} value={draft[field.key]||""} onChange={value=>{setDraft(current=>({...current,[field.key]:value}));setClear(current=>!value&&draft[field.key]?.startsWith("orbit-vault://")?[...new Set([...current,field.key])]:current.filter(key=>key!==field.key))}}/>}<div className="mt-1 flex items-center justify-between gap-2 font-normal text-[#626f86]"><code>{field.key}</code>{field.configured&&<button type="button" className="text-[#ae2a19] hover:underline" onClick={()=>{setClear(current=>current.includes(field.key)?current.filter(key=>key!==field.key):[...current,field.key]);setDraft(current=>({...current,[field.key]:clear.includes(field.key)?field.value:""}))}}>{clear.includes(field.key)?"Cancelar remoção":"Remover"}</button>}</div></div>)}</div><div className="mt-5 flex flex-wrap items-center gap-3"><button disabled={saving} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?"Salvando…":"Salvar configuração"}</button><span className="text-xs text-[#626f86]">Reinicie a API para aplicar as alterações.</span></div></>:<p className="text-sm text-[#626f86]">Este plugin não possui variáveis próprias. Credenciais compartilhadas ficam em Integrações.</p>}
      </form>}
      {connectPath[plugin.id]&&<div className="mt-6 border-t border-[#dfe1e6] pt-5">{connectionStatus?.connections.map(connection=><div key={connection.id} className="mb-2 rounded border border-[#dfe1e6] p-3 text-sm"><strong>{connection.display_name||connection.label||'Conta conectada'}</strong><span className="ml-2 text-xs text-[#626f86]">{connection.status||'Ativa'}</span></div>)}<button type="button" disabled={!plugin.enabled||connectionStatus?.configured===false} onClick={()=>void connect()} className="rounded border border-[#0c66e4] px-3 py-2 text-sm font-semibold text-[#0c66e4] disabled:opacity-50">Conectar {plugin.name}</button>{!plugin.enabled?<span className="ml-3 text-xs text-[#626f86]">Ative o plugin para conectar uma conta.</span>:connectionStatus?.configured===false?<span className="ml-3 text-xs text-[#626f86]">Configure as credenciais e reinicie a API.</span>:null}</div>}
      {plugin.id==='google_drive'&&<Link href="/backups" className="mt-4 inline-block text-sm font-semibold text-[#0c66e4]">Abrir backups</Link>}
      {calendarProvider&&plugin.enabled&&<div className="mt-6 border-t border-[#dfe1e6] pt-5"><CalendarIntegrations providerId={calendarProvider} optionId={calendarOption} showSources={plugin.id==='google_calendar'||plugin.id==='outlook_calendar'}/></div>}
      <button type="button" onClick={onClose} className="mt-6 w-full rounded-lg border border-[#c1c7d0] px-4 py-2 text-sm font-semibold text-[#172b4d] hover:bg-[#f1f2f4]">Fechar</button>
    </section>
  </div>;
}
