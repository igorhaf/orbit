"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {CardDialog} from '@/components/card-dialog';
import {Modal} from '@/components/ui';
import ExtensionPage from '@/plugins/records/ExtensionPage';
import {send,type Board,type Card} from '@/lib/api';
import { ProcessBoard, type ProcessBoardStage } from "@/plugins/process-board/ProcessBoard";
import { usePluginAvailability } from "@/lib/plugin-availability";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessShell, accessButton as button, accessInput as input, accessPanel as panel } from "@/components/access-shell";
import { api, authenticatedBlob, type User } from "@/lib/api";

type Row = { display_title?: string; id: string; kind: string; title: string; state: string; revision: number; plugin_id: string; payload: Record<string, unknown> };
type Step = { key: string; label: string; description: string; plugins: string[] };
type Folder = { stage_groups: Array<{id:string;name:string;description:string;current:boolean;optional:boolean;records:Row[]}>; process: Row; records: Row[]; journey: Step[]; available_plugins: string[]; consistency_issues: Array<{ code: string; message: string }>; requirement_checks: Array<{ code: string; label: string; status: string; value: number | null; unit: string; minimum?: number; maximum?: number; source_reference?: string; explanation: string }> };
const pluginNames: Record<string, string> = { "safdoulas-registry": "Cadastro do curso e da formadora", forms: "Formulários e solicitações", documents: "Documentos", "safdoulas-processes": "Processos", "safdoulas-governance": "Editais e regras", "safdoulas-triage": "Triagem", "safdoulas-blinding": "Cópias cegadas", "safdoulas-accreditors": "Acreditadoras", "safdoulas-assessments": "Avaliações", "safdoulas-diligences": "Diligências e comunicações", "safdoulas-decisions": "Decisões e recursos", "safdoulas-accreditation": "Concessões e acompanhamento", deadlines: "Prazos", "safdoulas-reporting": "Relatórios" };
const stateNames: Record<string, string> = { draft: "Rascunho", submitted: "Enviado", triage: "Triagem", review: "Avaliação", diligence: "Diligência", deliberation: "Deliberação", decision: "Decidido", appeal: "Recurso", active: "Ativo", published: "Publicado", verified: "Cegamento verificado", completed: "Concluído", ratified: "Ratificado", closed: "Encerrado" };
const route = (plugin: string, workspace: string, record?: string) => `${plugin === "safdoulas-assessments" ? "/safdoulas/assessments" : plugin === "safdoulas-reporting" ? "/safdoulas/reports" : `/extensions/${plugin}`}?workspace=${encodeURIComponent(workspace)}${record ? `&record=${encodeURIComponent(record)}` : ""}`;

export default function SafdoulasCaseworkPage() {
  const router=useRouter();
  const availability=usePluginAvailability();
  const [user, setUser] = useState<User | null>(null);
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [workspace, setWorkspace] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [native,setNative]=useState<{board:Board;card:Card}|null>(null);
  const [formal,setFormal]=useState<{plugin:string;id:string}|null>(null);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const selection = useRef({ generation: 0 });
  const load = useCallback(async (workspaceId: string, initialRows?: Row[]) => {
    const generation = ++selection.current.generation;
    setWorkspace(workspaceId); setFolder(null);setNative(null); setRows([]); setError("");
    if (!workspaceId) return;
    setLoading(true);
    try {
      const result = initialRows ? {processes:initialRows} : await api<{ processes: Row[] }>(`/safdoulas/casework/workspaces/${workspaceId}`);
      if (generation === selection.current.generation) setRows(result.processes);
    } catch (error) { if (generation === selection.current.generation) setError((error as Error).message); }
    finally { if (generation === selection.current.generation) setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    const requests = selection.current;
    Promise.all([api<User>("/auth/me"), api<Array<{ id: string; name: string }>>("/workspaces")]).then(async ([account, workspaces]) => {
      if (!active) return;
      setUser(account); setSpaces(workspaces);
      const preferred = new URLSearchParams(window.location.search).get("workspace");
      if (workspaces.some((space) => space.id === preferred)) { void load(preferred!); return; }
      if (workspaces.length === 1) { void load(workspaces[0].id); return; }
      for (const space of workspaces) {
        const candidate = await api<{processes:Row[]}>(`/safdoulas/casework/workspaces/${space.id}`);
        if (!active) return;
        if (candidate.processes.length) { void load(space.id,candidate.processes); return; }
      }
      if (workspaces[0]) void load(workspaces[0].id,[]);
    }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; requests.generation++; };
  }, [load]);
  const open=useCallback(async(recordId:string,initialFolder?:Folder)=>{
    const generation=++selection.current.generation;setLoading(true);setError("");setNative(null);
    try{
      const result=initialFolder||await api<Folder>(`/safdoulas/casework/processes/${recordId}`);
      let link:{board_id:string;card_id:string};
      try{link=await api(`/record-cards/safdoulas-processes/records/${recordId}`)}
      catch(error){if((error as Error).message.includes('Cartão ainda não aberto'))link=await send(`/record-cards/safdoulas-processes/records/${recordId}`,'POST',{});else throw error}
      const board=await api<Board>(`/boards/${link.board_id}`);const card=board.lists?.flatMap(list=>list.cards).find(card=>card.id===link.card_id);
      if(!card)throw new Error('O cartão do curso não está disponível.');
      if(generation===selection.current.generation){setFolder(result);setNative({board,card})}
    }catch(error){if(generation===selection.current.generation)setError((error as Error).message)}
    finally{if(generation===selection.current.generation)setLoading(false)}
  },[]);
  async function refreshNative(){
    if(!native)return;const board=await api<Board>(`/boards/${native.board.id}`);const card=board.lists?.flatMap(list=>list.cards).find(card=>card.id===native.card.id);if(card)setNative({board,card});
  }
  useEffect(()=>{
    if(!workspace||!rows.length)return;const record=new URLSearchParams(window.location.search).get('process');
    let active=true;
    if(record&&rows.some(row=>row.id===record))void api<Folder>(`/safdoulas/casework/processes/${record}`).then(result=>{if(active)void open(record,result)}).catch(error=>{if(active)setError(error.message)});
    return()=>{active=false};
  },[workspace,rows,open]);
  async function refreshFormal(){
    if(!folder)return;const current=await api<Folder>(`/safdoulas/casework/processes/${folder.process.id}`);setFolder(current);
    setRows(rows=>rows.map(row=>row.id===current.process.id?{...row,...current.process}:row));await send(`/record-cards/safdoulas-processes/records/${folder.process.id}`,'POST',{});await refreshNative();
  }
  async function exportDossier() {
    if (!folder) return;
    setBusy(true); setError("");
    try {
      const blob = await authenticatedBlob(`/safdoulas/casework/processes/${folder.process.id}/dossier.json`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `dossie-${folder.process.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function loadStages(recordId: string): Promise<ProcessBoardStage[]> {
    const data = await api<Folder>(`/safdoulas/casework/processes/${recordId}`);
    return data.stage_groups.map(stage => ({ ...stage, records: stage.records.map(record => ({ id: `${record.id}:${record.revision}`, title: record.title, status: stateNames[record.state] || record.state, href: route(record.plugin_id, workspace, record.id) })) }));
  }
  if (availability.ready && (!availability.enabled("safdoulas-casework", "plugin.process-board.read") || !availability.enabled("process-board", "views.structured.use"))) return <AccessShell user={user} title="Cursos em acreditação"><p role="status">A gestão de processos está desativada ou seu perfil não tem acesso a esta visualização.</p><Link className={button} href="/boards">Voltar aos quadros</Link></AccessShell>;
  const canExport = Boolean(user?.is_root || user?.permissions?.includes("plugin.safdoulas-reporting.export"));
  return <AccessShell user={user} title="Cursos em acreditação">
    <p>Cada curso tem seu próprio quadro de acreditação, com fases fixas, atividades e documentos vinculados.</p>{availability.enabled("safdoulas-casework","plugin.safdoulas-processes.write")&&availability.enabled("record-cards","plugin.record-cards.write")&&<Link className={button} href="/safdoulas/courses/new">Novo quadro de curso</Link>}
    {error && <p role="alert" className="rounded border border-red-700 bg-red-50 p-3 text-red-900">{error}</p>}
    <label className="block max-w-xl">Espaço de trabalho<select className={input} value={workspace} onChange={(event) => void load(event.target.value)}><option value="">Selecione</option>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
    {workspace && <nav aria-label="Preparação da acreditação" className="flex flex-wrap gap-2">{["safdoulas-governance", "safdoulas-registry", "forms", "documents", "safdoulas-processes"].map((plugin) => <Link key={plugin} className={`${button} inline-flex items-center`} href={route(plugin, workspace)}>{pluginNames[plugin]}</Link>)}</nav>}
    {loading && <p role="status" aria-live="polite">Carregando processo…</p>}
    {workspace && <div className="min-w-0 space-y-5">
      <ProcessBoard selectLabel="Abrir quadro do curso" key={workspace} groups={rows.map(row=>({ id:row.id,title:row.display_title||row.title,status:stateNames[row.state]||row.state,reference:String(row.payload.protocol_number||"Sem protocolo"),revision:row.revision }))} loadStages={loadStages} onSelect={recordId=>{setError("");void send<{board_id:string}>(`/record-cards/safdoulas-processes/records/${recordId}`,'POST',{}).then(link=>router.push(`/board/${link.board_id}`)).catch(error=>setError(error.message))}}/>
      {folder ? <section className="min-w-0 space-y-5">
        <div className={panel}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="break-words text-xl font-semibold">{folder.process.title}</h2><p>{stateNames[folder.process.state] || folder.process.state} · revisão {folder.process.revision}</p></div>{canExport && <button className={button} disabled={busy} onClick={() => void exportDossier()}>Baixar dossiê</button>}</div><Link className="mt-4 inline-flex min-h-11 items-center underline" href={route("safdoulas-processes", workspace, folder.process.id)} onClick={event=>{event.preventDefault();setFormal({plugin:"safdoulas-processes",id:folder.process.id})}}>Abrir solicitação e suas transições</Link></div>
        <section className={panel}><h3 className="font-semibold">Conferência de requisitos</h3><p className="my-2 text-sm">Cálculos sobre os dados versionados. A decisão depende da análise humana das evidências.</p>{folder.consistency_issues.map((issue, index) => <p className="my-2 rounded border border-amber-600 bg-amber-50 p-3 text-amber-950" key={`${issue.code}:${index}`}>{issue.message}</p>)}{!folder.requirement_checks.length && <p>Vincule regras e matriz curricular com parâmetros para exibir os cálculos.</p>}<div className="space-y-3">{folder.requirement_checks.map((check) => <article className="rounded border p-3" key={check.code}><strong>{check.label}</strong><p>{check.status === "met" ? "Dentro do parâmetro" : check.status === "attention" ? "Requer análise" : "Dados a complementar"} · {check.value === null ? "Não calculado" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(check.value)} ${check.unit}`}</p><p className="text-sm">{check.minimum !== undefined && `Mínimo: ${check.minimum} ${check.unit}. `}{check.maximum !== undefined && `Máximo: ${check.maximum} ${check.unit}. `}{check.explanation}</p>{check.source_reference && <p className="mt-1 text-sm">Fonte: {check.source_reference}</p>}</article>)}</div></section>
        <section className={panel}><h3 className="mb-3 font-semibold">Registros e documentos relacionados · {folder.records.length}</h3><div className="space-y-2">{folder.records.map((record) => <Link key={`${record.id}:${record.revision}`} href={route(record.plugin_id, workspace, record.id)} onClick={event=>{if(!["safdoulas-assessments","safdoulas-reporting"].includes(record.plugin_id)){event.preventDefault();setFormal({plugin:record.plugin_id,id:record.id})}}} className="block min-h-11 rounded border p-3"><strong className="block break-words">{record.title}</strong><span className="text-sm">{pluginNames[record.plugin_id] || record.plugin_id} · {stateNames[record.state] || record.state} · v{record.revision}</span></Link>)}</div></section>
      </section> : <section className={panel}><p>Expanda um curso para ver suas fases e use “Abrir quadro do curso” para trabalhar com comentários, anexos, checklist, datas e registros vinculados.</p></section>}
    </div>}
    {native&&folder&&<CardDialog card={native.card} board={native.board} managedRecord onClose={()=>setNative(null)} onChanged={refreshNative} onDeleted={async()=>setNative(null)} recordContent={<section className="mb-5 space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Processo de acreditação · {stateNames[folder.process.state]||folder.process.state}</h3><span className="text-xs">Revisão {folder.process.revision}</span></div>
      <p className="text-sm">Organize o acompanhamento neste cartão. Evidências e decisões permanecem nos registros versionados vinculados.</p>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={()=>setFormal({plugin:"safdoulas-processes",id:folder.process.id})}>Solicitação e transições</button>{canExport&&<button className="min-h-11 rounded-lg border px-3" disabled={busy} onClick={()=>void exportDossier()}>Baixar dossiê</button>}</div>
      <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">Documentos e contextos · {folder.records.length}</summary><div className="max-h-72 space-y-2 overflow-y-auto">{folder.records.map(record=><button key={`${record.id}:${record.revision}`} onClick={()=>setFormal({plugin:record.plugin_id,id:record.id})} className="block min-h-11 w-full rounded border p-2 text-left text-sm"><strong className="block break-words">{record.title}</strong>{stateNames[record.state]||record.state} · v{record.revision}</button>)}</div></details>
      <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">Conferência de requisitos · {folder.requirement_checks.length}</summary><div className="space-y-2">{folder.requirement_checks.map(check=><p key={check.code} className="rounded border p-2 text-sm"><strong>{check.label}</strong> · {check.status==="met"?"Dentro do parâmetro":"Requer análise"}<span className="block">{check.explanation}</span></p>)}</div></details>
    </section>}/>}
    {formal&&<Modal extraWide onClose={()=>setFormal(null)}><div className="max-h-[85dvh] w-full min-w-0 overflow-y-auto p-4 sm:p-6"><ExtensionPage key={formal.plugin+formal.id} pluginId={formal.plugin} workspaceId={workspace} recordId={formal.id} embedded onChanged={refreshFormal}/></div></Modal>}

  </AccessShell>;
}
