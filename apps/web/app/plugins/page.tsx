"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Boxes, Check, PlugZap, Power, RefreshCw, Settings, ShieldCheck, Zap } from "lucide-react";
import { api, Board, getToken, PluginCatalogItem, send, User } from "@/lib/api";
import { AppHeader, WorkspaceSidebar } from "@/components/ui";
import { PluginConfiguration } from "@/components/plugin-configuration";

export default function PluginsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [plugins, setPlugins] = useState<PluginCatalogItem[]>([]);
  const [selected, setSelected] = useState<PluginCatalogItem | null>(null);
  const [configuring,setConfiguring]=useState<PluginCatalogItem|null>(null);
  const [oauthResult,setOauthResult]=useState<{connected:boolean;error:string}|undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string|null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/");
      return;
    }
    let active = true;
    Promise.all([api<User>("/auth/me"), api<Board[]>("/boards"), api<{ plugins: PluginCatalogItem[] }>("/plugins")])
      .then(([account, allBoards, catalog]) => {
        if (!active) return;
        setUser(account);
        setBoards(allBoards);
        setPlugins(catalog.plugins);
        const query=new URLSearchParams(window.location.search),configured=catalog.plugins.find(plugin=>plugin.id===query.get('configure'));
        if(configured){setConfiguring(configured);setOauthResult({connected:query.get('connected')==='true',error:query.get('error')||''})}
      })
      .catch((value) => { if (active) setError((value as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);

  async function togglePlugin(plugin:PluginCatalogItem){
    setToggling(plugin.id);setError("");
    try{const state=await send<{enabled:boolean}>(`/plugins/${plugin.id}`,"PATCH",{enabled:!plugin.enabled});setPlugins(current=>current.map(item=>item.id===plugin.id?{...item,enabled:state.enabled}:item));setSelected(current=>current?.id===plugin.id?{...current,enabled:state.enabled}:current);window.dispatchEvent(new Event('plugins:changed'));}
    catch(value){setError((value as Error).message)}finally{setToggling(null)}
  }

  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
    {user && <AppHeader user={user} boards={boards} />}
    <div className="flex min-h-0 flex-1">
      {user && <WorkspaceSidebar boards={boards} onCreate={() => router.push("/boards?create=1")} onChoose={id => router.push(id ? `/board/${id}` : "/boards")} />}
      <main className="mx-auto w-full max-w-[1400px] px-4 py-7 sm:px-7 lg:px-9">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.12em] text-[#0c66e4]"><PlugZap size={15}/> Orbit Plugins</p>
          <h1 className="text-3xl font-bold tracking-tight text-[#172b4d]">Estenda o que o Orbit faz</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#626f86]">Ative ou desative os recursos externos e módulos internos do Orbit. Um plugin desativado deixa de contribuir com navegação, automações e ações.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[#cce0ff] bg-[#e9f2ff] px-3 py-2 text-xs font-semibold text-[#0c66e4]"><ShieldCheck size={16}/> Catálogo seguro do sistema</div>
      </div>
      {error && <div role="alert" className="mb-5 flex items-center gap-2 rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]"><span className="flex-1">{error}</span><button onClick={() => window.location.reload()} className="font-semibold underline">Tentar novamente</button></div>}
      {loading ? <div className="flex items-center justify-center rounded-xl border border-[#dfe1e6] bg-white p-16 text-sm text-[#626f86]"><RefreshCw className="mr-2 animate-spin" size={17}/> Carregando catálogo...</div> : plugins.length === 0 ? <div className="rounded-xl border border-dashed border-[#c1c7d0] bg-white p-16 text-center"><Boxes className="mx-auto mb-3 text-[#0c66e4]" size={32}/><h2 className="font-bold text-[#172b4d]">Nenhum plugin disponível</h2><p className="mt-1 text-sm text-[#626f86]">Os plugins registrados no servidor aparecerão aqui.</p></div> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{plugins.map(plugin => <article key={plugin.id} className="flex flex-col rounded-xl border border-[#dfe1e6] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e9f2ff] text-[#0c66e4]"><Boxes size={23}/></span><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${plugin.enabled?'bg-[#e3fcef] text-[#216e4e]':'bg-[#f1f2f4] text-[#626f86]'}`}>{plugin.enabled?'Ativo':'Desativado'} · v{plugin.version}</span></div>
        <h2 className="mt-5 text-lg font-bold text-[#172b4d]">{plugin.name}</h2><p className="mt-1 font-mono text-xs text-[#626f86]">{plugin.id}</p>
        <div className="mt-5 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-[#f1f2f4] p-3"><strong className="block text-base text-[#172b4d]">{plugin.actions.length}</strong><span className="text-[#626f86]">ações</span></div><div className="rounded-lg bg-[#f1f2f4] p-3"><strong className="block text-base text-[#172b4d]">{plugin.capabilities.length}</strong><span className="text-[#626f86]">capacidades</span></div></div>
        <div className="mt-5 flex-1 space-y-2">{plugin.actions.slice(0, 3).map(action => <div key={action.id} className="flex items-center gap-2 text-sm text-[#44546f]"><Check size={15} className="shrink-0 text-[#22a06b]"/><span className="truncate">{action.name}</span></div>)}{plugin.actions.length > 3 && <p className="text-xs text-[#626f86]">+ {plugin.actions.length - 3} outras ações</p>}</div>
        <div className="mt-6 flex flex-wrap gap-2"><button onClick={() => void togglePlugin(plugin)} disabled={toggling===plugin.id} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold disabled:opacity-50 ${plugin.enabled?'border border-[#dfe1e6] text-[#44546f] hover:bg-[#f1f2f4]':'bg-[#0c66e4] text-white hover:bg-[#0055cc]'}`}><Power size={15}/>{toggling===plugin.id?'Salvando…':plugin.enabled?'Desativar':'Ativar'}</button><button onClick={() => setConfiguring(plugin)} className="flex items-center justify-center gap-2 rounded-lg border border-[#0c66e4] px-3 py-2.5 text-sm font-semibold text-[#0c66e4] hover:bg-[#e9f2ff]"><Settings size={15}/> Configurar</button><button onClick={() => setSelected(plugin)} className="flex items-center justify-center gap-2 rounded-lg bg-[#0c66e4] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0055cc]">Ações <ArrowRight size={16}/></button></div>
      </article>)}</div>}
      <p className="mt-8 flex items-center gap-2 text-xs text-[#626f86]"><Zap size={14} className="text-[#e2b203]"/> O estado é global nesta instalação; ações de execução ainda respeitam as permissões configuradas em cada projeto.</p>
      </main>
    </div>
    {selected && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#091e42a6] p-4 pt-[10vh]" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}><section role="dialog" aria-modal="true" className="w-full max-w-xl rounded-xl bg-white p-6 shadow-dialog"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-[#0c66e4]">Plugin</p><h2 className="mt-1 text-xl font-bold text-[#172b4d]">{selected.name}</h2><p className="mt-1 font-mono text-xs text-[#626f86]">{selected.id} · v{selected.version}</p></div><button onClick={() => setSelected(null)} className="rounded px-2 py-1 text-xl text-[#626f86] hover:bg-[#f1f2f4]" aria-label="Fechar">×</button></div><div className="mt-6 space-y-2">{selected.actions.map(action => <div key={action.id} className="rounded-lg border border-[#dfe1e6] p-3"><div className="flex items-center gap-2"><Check size={15} className="text-[#22a06b]"/><strong className="text-sm text-[#172b4d]">{action.name}</strong></div><p className="mt-1 pl-6 font-mono text-xs text-[#626f86]">{selected.id}.{action.id}</p>{action.permissions?.length ? <p className="mt-2 pl-6 text-xs text-[#626f86]">Permissões: {action.permissions.join(", ")}</p> : null}</div>)}</div><button onClick={() => setSelected(null)} className="mt-6 w-full rounded-lg border border-[#c1c7d0] px-4 py-2 text-sm font-semibold text-[#172b4d] hover:bg-[#f1f2f4]">Fechar</button></section></div>}
    {configuring&&<PluginConfiguration key={configuring.id} plugin={configuring} oauthResult={oauthResult} onClose={()=>{setConfiguring(null);setOauthResult(undefined);window.history.replaceState(null,'','/plugins')}}/>}
  </div>;
}
