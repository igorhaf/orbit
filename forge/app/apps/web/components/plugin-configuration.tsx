"use client";

import {useEffect,useState} from "react";
import Link from "next/link";
import {api,PluginCatalogItem,send} from "@/lib/api";
import {CalendarIntegrations} from "@/components/calendar-integrations";
import {Modal} from "@/components/ui";

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
    const controlClass=`mt-1 w-full min-h-10 rounded border px-3 py-2 text-sm font-normal ${dark?'border-[#46515c] bg-[#1d2125] text-[#dee4ea]':'border-[#c1c7d0] bg-white text-[#172b4d]'}`;
    if(field.type==='select'||field.type==='boolean')return <select required={field.required} disabled={disabled} value={value} onChange={event=>updateField(field,event.target.value)} className={controlClass}><option value="">Selecione</option>{(field.type==='boolean'?[{value:'true',label:'Sim'},{value:'false',label:'Não'}]:field.options||[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    if(field.type==='textarea')return <textarea required={field.required} autoComplete="off" spellCheck={false} rows={3} maxLength={field.maxLength} disabled={disabled} value={value} onChange={event=>updateField(field,event.target.value)} placeholder={field.configured?'Configurado; deixe vazio para manter':field.placeholder||'Não configurado'} className={`${controlClass} resize-y`}/>;
    return <input required={field.required} type={field.secret?'password':field.type==='number'?'number':field.type==='url'?'url':'text'} min={field.min} max={field.max} maxLength={field.maxLength} autoComplete="off" spellCheck={false} disabled={disabled} value={value} onChange={event=>updateField(field,event.target.value)} placeholder={field.configured&&field.secret?'Configurado; deixe vazio para manter':field.placeholder||'Não configurado'} className={controlClass}/>;
  }
  const calendarProvider=plugin.id==='google_calendar'?'google_calendar':['outlook_calendar','outlook_mail','teams'].includes(plugin.id)?'outlook_calendar':null;
  const calendarOption=plugin.id==='outlook_mail'?'mail':plugin.id==='teams'?'teams':plugin.id==='outlook_calendar'?'calendar':undefined;
  const dark=process.env.NEXT_PUBLIC_ORBIT_THEME==='dark';
  const textMain=dark?'text-[#dee4ea]':'text-[#172b4d]';
  const textMuted=dark?'text-[#b6c2cf]':'text-[#626f86]';
  return <Modal onClose={onClose} title={`Configurar ${plugin.name}`} wide theme={dark?'dark':'light'}>
    <div className={`p-6 ${textMain}`}>
      <div className="flex items-start justify-between gap-4"><div><p className={`text-xs font-bold uppercase tracking-wide ${dark?'text-cyan-200':'text-[#0c66e4]'}`}>Configuração do plugin</p><h2 className="mt-1 text-xl font-bold">{plugin.name}</h2><p className={`mt-1 font-mono text-xs ${textMuted}`}>{plugin.id}</p></div></div>
      {error&&<p role="alert" className={`mt-5 rounded p-3 text-sm ${dark?'bg-rose-300/10 text-rose-200':'bg-[#ffebe6] text-[#ae2a19]'}`}>{error}</p>}
      {notice&&<p role="status" className={`mt-5 rounded p-3 text-sm ${dark?'bg-emerald-200/10 text-emerald-100':'bg-[#dffcf0] text-[#216e4e]'}`}>{notice}</p>}
      {!settings&&!error&&<p className={`mt-6 text-sm ${textMuted}`}>Carregando configuração…</p>}
      {settings&&<form onSubmit={save} className="mt-6">
        {settings.oauthRedirectUri&&<div className={`mb-5 rounded border p-3 text-sm ${dark?'border-violet-300/20 bg-violet-300/[0.06] text-[#dee4ea]':'border-[#c3b6f7] bg-[#f7f5ff] text-[#344563]'}`}><p className="font-semibold">URI de redirecionamento enviado ao Google</p><code className={`mt-2 block break-all select-all rounded p-2 text-xs ${dark?'bg-[#111519]':'bg-white'}`}>{settings.oauthRedirectUri}</code><p className="mt-2">Cadastre este URI em “URIs de redirecionamento autorizados” no <a className={`font-semibold underline ${dark?'text-cyan-200':'text-[#0c66e4]'}`} href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">cliente OAuth do Google Cloud</a> e salve. Use o mesmo cliente configurado nas credenciais Google compartilhadas.</p></div>}
        {settings.fields.length?<><p className={`mb-4 text-sm ${textMuted}`}>As variáveis deste plugin ficam no servidor. Segredos configurados não são exibidos; deixe o campo vazio para mantê-los.</p><div className="grid gap-4 md:grid-cols-2">{settings.fields.map(field=><div key={field.key} className={`min-w-0 text-xs font-semibold ${textMain}`}><span>{field.label}{field.required?' · obrigatório':''}</span>{renderField(field)}{field.description&&<p className={`mt-1 text-xs font-normal ${textMuted}`}>{field.description}</p>}{(field.secret||field.allowVaultReference)&&<VaultConstantSelect label={`Constante para ${field.label}`} value={draft[field.key]||""} onChange={value=>{setDraft(current=>({...current,[field.key]:value}));setClear(current=>!value&&draft[field.key]?.startsWith("orbit-vault://")?[...new Set([...current,field.key])]:current.filter(key=>key!==field.key))}}/>}<div className={`mt-1 flex items-center justify-between gap-2 font-normal ${textMuted}`}><code>{field.key}</code>{field.configured&&<button type="button" className={`${dark?'text-rose-200':'text-[#ae2a19]'} hover:underline`} onClick={()=>{setClear(current=>current.includes(field.key)?current.filter(key=>key!==field.key):[...current,field.key]);setDraft(current=>({...current,[field.key]:clear.includes(field.key)?field.value:""}))}}>{clear.includes(field.key)?"Cancelar remoção":"Remover"}</button>}</div></div>)}</div><div className="mt-5 flex flex-wrap items-center gap-3"><button disabled={saving} className={`rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${dark?'bg-blue-600 hover:bg-blue-500':'bg-[#0c66e4]'}`}>{saving?"Salvando…":"Salvar configuração"}</button><span className={`text-xs ${textMuted}`}>Reinicie a API para aplicar as alterações.</span></div></>:<p className={`text-sm ${textMuted}`}>Este plugin não possui variáveis próprias. Credenciais compartilhadas ficam em Integrações.</p>}
      </form>}
      {connectPath[plugin.id]&&<div className={`mt-6 border-t pt-5 ${dark?'border-[#3b4754]':'border-[#dfe1e6]'}`}>{connectionStatus?.connections.map(connection=><div key={connection.id} className={`mb-2 rounded border p-3 text-sm ${dark?'border-[#3b4754] bg-white/[0.02]':'border-[#dfe1e6]'}`}><strong>{connection.display_name||connection.label||'Conta conectada'}</strong><span className={`ml-2 text-xs ${textMuted}`}>{connection.status||'Ativa'}</span></div>)}<button type="button" disabled={!plugin.enabled||connectionStatus?.configured===false} onClick={()=>void connect()} className={`rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${dark?'border-cyan-200/30 text-cyan-100 hover:bg-white/[0.04]':'border-[#0c66e4] text-[#0c66e4]'}`}>Conectar {plugin.name}</button>{!plugin.enabled?<span className={`ml-3 text-xs ${textMuted}`}>Ative o plugin para conectar uma conta.</span>:connectionStatus?.configured===false?<span className={`ml-3 text-xs ${textMuted}`}>Configure as credenciais e reinicie a API.</span>:null}</div>}
      {plugin.id==='google_drive'&&<Link href="/backups" className={`mt-4 inline-block text-sm font-semibold underline ${dark?'text-cyan-200':'text-[#0c66e4]'}`}>Abrir backups</Link>}
      {calendarProvider&&plugin.enabled&&<div className={`mt-6 border-t pt-5 ${dark?'border-[#3b4754]':'border-[#dfe1e6]'}`}><CalendarIntegrations providerId={calendarProvider} optionId={calendarOption} showSources={plugin.id==='google_calendar'||plugin.id==='outlook_calendar'}/></div>}
      <button type="button" onClick={onClose} className={`mt-6 w-full rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-white/[0.05] ${dark?'border-[#46515c] text-[#dee4ea]':'border-[#c1c7d0] text-[#172b4d] hover:bg-[#f1f2f4]'}`}>Fechar</button>
    </div>
  </Modal>;
}
