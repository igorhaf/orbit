"use client";

import { useCallback, useEffect, useState } from "react";
import { api, CalendarSource, send } from "@/lib/api";

type Provider = { id:string; name:string; connectable:boolean; connectOptions?:Array<{id:string;label:string}> };
const groupName = (source:CalendarSource) => source.provider_id === "orbit_cards" ? "Orbit" : source.connection_name || source.provider_id;

export function CalendarIntegrations() {
  const [sources,setSources] = useState<CalendarSource[]>([]);
  const [providers,setProviders] = useState<Provider[]>([]);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [calendarSources,catalog] = await Promise.all([
        api<CalendarSource[]>("/calendar/sources"),
        api<Provider[]>("/calendar/catalog"),
      ]);
      setSources(calendarSources);
      setProviders(catalog);
      setError("");
    } catch (reason) { setError((reason as Error).message); }
  },[]);
  useEffect(() => { const timer = window.setTimeout(() => void load(),0); return () => window.clearTimeout(timer); },[load]);

  async function update(source:CalendarSource,values:Record<string,unknown>) {
    setBusy(true);
    try {
      setSources(await send<CalendarSource[]>(`/calendar/sources/${source.id}`,"PATCH",values));
      setError("");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function connect(provider:Provider,option?:string) {
    try {
      const {url} = await api<{url:string}>(`/calendar/providers/${provider.id}/connect${option ? `?option=${encodeURIComponent(option)}` : ""}`);
      window.location.assign(url);
    } catch (reason) { setError((reason as Error).message); }
  }

  return <section className="max-w-4xl rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
    <h2 className="text-lg font-bold">Contas de calendário</h2>
    <p className="mt-1 text-sm text-[#626f86]">O calendário do Orbit funciona com seus próprios dados. Conecte contas externas apenas se quiser trazer outras agendas.</p>
    {error && <p role="alert" className="mt-4 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      {providers.filter(provider => provider.connectable).map(provider => provider.connectOptions?.length
        ? provider.connectOptions.map(option => <button key={`${provider.id}:${option.id}`} onClick={() => void connect(provider,option.id)} className="rounded border border-[#0c66e4] px-3 py-2 text-sm font-semibold text-[#0c66e4] hover:bg-[#e9f2ff]">{option.label}</button>)
        : <button key={provider.id} onClick={() => void connect(provider)} className="rounded border border-[#0c66e4] px-3 py-2 text-sm font-semibold text-[#0c66e4] hover:bg-[#e9f2ff]">Conectar {provider.name}</button>)}
      {providers.every(provider => !provider.connectable) && <p className="rounded bg-[#f7f8fa] p-3 text-sm text-[#626f86]">Nenhuma nova conexão disponível. Confira as credenciais dos provedores nas configurações do servidor abaixo.</p>}
    </div>
    <div className="mt-5 space-y-4">
      {Array.from(new Set(sources.map(groupName))).map(group => <div key={group} className="rounded-lg border border-[#dfe1e6] p-4">
        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">{group}</h3><div className="flex gap-3 text-xs font-semibold text-[#0c66e4]"><button disabled={busy} onClick={() => void Promise.all(sources.filter(source => groupName(source) === group).map(source => update(source,{selected:true,visible:true})))}>Selecionar todas</button><button disabled={busy} onClick={() => void Promise.all(sources.filter(source => groupName(source) === group).map(source => update(source,{visible:false})))}>Limpar</button></div></div>
        <div className="space-y-2">{sources.filter(source => groupName(source) === group).map(source => <label key={source.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={source.selected && source.visible} onChange={event => void update(source,{selected:event.target.checked,visible:event.target.checked})}/><span className="h-3 w-3 rounded-full border" style={{background:source.color || "#0c66e4"}}/><span className="min-w-0 flex-1 truncate">{source.name}</span><span className="text-xs text-[#626f86]">Padrão</span><input type="radio" name="default-calendar" title="Calendário padrão" checked={source.is_default} onChange={() => void update(source,{is_default:true})}/></label>)}</div>
      </div>)}
      {sources.length === 0 && <p className="rounded bg-[#f7f8fa] p-3 text-sm text-[#626f86]">Nenhuma agenda conectada.</p>}
    </div>
  </section>;
}
