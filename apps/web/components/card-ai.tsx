"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, ChevronDown, ChevronUp, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  AiModel,
  AiProject,
  Board,
  Card,
  CardExtensions,
  PromptRun,
  api,
  send,
} from "@/lib/api";
import { RichText } from "./rich-text";
import { AiEffortField } from "./ai-model-fields";

type Action =
  "write" | "elaborate" | "refine" | "summarize" | "shorten" | "negative" | "action_items" | "checklist";
type Result = { output: string; items: string[]; action?: Action };
type PromptContext = { id: string; name: string; prompt: string; project_id?: string | null; board_id?: string | null; card_id?: string | null; selected?: boolean };
export function PromptContexts({ card, board }: { card: Card; board: Board }) {
  const [items, setItems] = useState<PromptContext[]>([]); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [name, setName] = useState(""); const [prompt, setPrompt] = useState(""); const [scope, setScope] = useState<'card'|'board'|'project'>('card');
  const load = useCallback(() => api<PromptContext[]>(`/prompt-contexts?card_id=${card.id}`).then(setItems).catch(() => undefined), [card.id]);
  useEffect(() => { void load(); }, [load]);
  const selected = items.filter(item => item.selected);
  const applied = items.filter(item => item.selected || item.board_id===board.id || item.project_id===(card.ai_project_id||board.ai_default_project_id));
  async function toggle(id: string, checked: boolean) { setBusy(true); try { await send(`/cards/${card.id}/prompt-contexts`, "PATCH", { ids: items.filter(item => item.selected && item.id !== id).map(item => item.id).concat(checked ? [id] : []) }); await load(); } finally { setBusy(false); } }
  async function create() { if (!name.trim() || !prompt.trim() || (scope==='project'&&!card.ai_project_id&&!board.ai_default_project_id)) return; setBusy(true); try { const target=scope==='card'?{card_id:card.id}:scope==='board'?{board_id:board.id}:{project_id:card.ai_project_id||board.ai_default_project_id}; const item = await send<PromptContext>("/prompt-contexts", "POST", { name, prompt, ...target }); if(scope==='card')await send(`/cards/${card.id}/prompt-contexts`, "PATCH", { ids: [...selected.map(context => context.id), item.id] }); setName(""); setPrompt(""); await load(); } finally { setBusy(false); } }
  async function remove(item:PromptContext){if(!window.confirm(`Excluir o contexto “${item.name}”?`))return;setBusy(true);try{await send(`/prompt-contexts/${item.id}`,"DELETE");await load()}finally{setBusy(false)}}
  const groups=[['Cartão',items.filter(item=>item.card_id===card.id)],['Quadro',items.filter(item=>item.board_id===board.id)],['Projeto',items.filter(item=>item.project_id&&(item.project_id===card.ai_project_id||item.project_id===board.ai_default_project_id))]] as const;
  return <div className="rounded-lg border border-[#dfe1e6] bg-white p-3"><div className="flex items-center justify-between"><b className="text-xs text-[#172b4d]">Contextos aplicados ({applied.length})</b><button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#403294]"><Plus size={14} /> Gerenciar</button></div><div className="mt-2 space-y-1">{applied.map(item => <div key={item.id} className="rounded bg-[#f1f2f4] px-2 py-1 text-xs">{item.name}</div>)}{!applied.length && <p className="text-xs text-[#626f86]">Nenhum contexto aplicado.</p>}</div>{open && <div className="mt-3 space-y-3 rounded border p-3">{groups.map(([label,group])=>group.length?<div key={label}><b className="text-xs text-[#626f86]">{label}</b><div className="mt-1 space-y-1">{group.map(item=>{const automatic=Boolean(item.board_id||item.project_id);return <div key={item.id} className="flex items-center gap-2 text-xs"><label className="min-w-0 flex-1"><input type="checkbox" checked={automatic||Boolean(item.selected)} disabled={busy||automatic} onChange={event => void toggle(item.id,event.target.checked)} className="mr-2" />{item.name}{automatic&&<span className="ml-1 text-[#626f86]">(padrão)</span>}</label><button type="button" disabled={busy} onClick={()=>void remove(item)} aria-label={`Excluir ${item.name}`} className="text-[#ae2a19]"><Trash2 size={13}/></button></div>})}</div></div>:null)}<div className="border-t pt-3"><b className="text-xs">Novo contexto</b><select value={scope} onChange={event=>setScope(event.target.value as typeof scope)} className="ml-2 rounded border p-1 text-xs"><option value="card">Deste cartão</option><option value="board">Padrão do quadro</option><option value="project" disabled={!card.ai_project_id&&!board.ai_default_project_id}>Padrão do projeto</option></select><input className="mt-2 w-full rounded border p-1.5 text-xs" placeholder="Nome do contexto" value={name} onChange={event => setName(event.target.value)} /><textarea className="mt-2 w-full rounded border p-1.5 text-xs" rows={4} placeholder="Instruções que serão adicionadas ao prompt" value={prompt} onChange={event => setPrompt(event.target.value)} /><div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void create()} className="rounded bg-[#403294] px-2 py-1 text-xs font-semibold text-white">Salvar</button><button type="button" onClick={() => setOpen(false)} className="text-xs">Fechar</button></div></div></div>}</div>;
}
const actions: { id: Action; label: string }[] = [
  { id: "write", label: "Escrever descrição" },
  { id: "elaborate", label: "Detalhar mantendo o original" },
  { id: "refine", label: "Refinar texto" },
  { id: "summarize", label: "Resumir" },
  { id: "shorten", label: "Encurtar" },
  { id: "negative", label: "Gerar prompt negativo" },
  { id: "action_items", label: "Encontrar ações" },
  { id: "checklist", label: "Criar checklist" },
];

export function CardAi({
  card,
  board,
  onApply,
  onChanged,
  onExecutionStart,
  onAiActionStart,
  onExecutionEnd,
  aiLocked = false,
  variant = "settings",
}: {
  card: Card;
  board: Board;
  onApply: (text: string, action?: Action) => Promise<void>;
  onChanged: () => Promise<void>;
  onExecutionStart?: () => void;
  onAiActionStart?: () => void;
  onExecutionEnd?: () => void;
  aiLocked?: boolean;
  variant?: "settings" | "text";
}) {
  const [action, setAction] = useState<Action>("refine");
  const [instruction, setInstruction] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem(`orbit:card:${card.id}:prompt-instruction`) || "",
  );
  const suggestionStorageKey = `orbit:card:${card.id}:description-suggestion`;
  const [result, setResult] = useState<Result | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = window.localStorage.getItem(suggestionStorageKey);
      return saved ? JSON.parse(saved) as Result : null;
    } catch {
      window.localStorage.removeItem(suggestionStorageKey);
      return null;
    }
  });
  const [models, setModels] = useState<AiModel[]>([]);
  const [projects, setProjects] = useState<AiProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const effectiveProjectId =
    card.ai_project_id || board.ai_default_project_id || null;
  const selectedProject = projects.find(
    (project) => project.id === effectiveProjectId,
  );
  const inheritedModel = board.ai_default_model || selectedProject?.ai_default_model || board.ai_global_model || null;
  const inheritedEffort = board.ai_default_effort || selectedProject?.ai_default_effort || board.ai_global_effort || null;
  const effective = card.ai_model || inheritedModel;
  const effectiveEffort = card.ai_effort || inheritedEffort;
  const instructionStorageKey = `orbit:card:${card.id}:prompt-instruction`;
  useEffect(() => {
    const handleGeneration = (event: Event) => setGenerationBusy(Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active));
    window.addEventListener("orbit:text-generation", handleGeneration);
    return () => window.removeEventListener("orbit:text-generation", handleGeneration);
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      api<AiModel[]>("/ai/models"),
      api<AiProject[]>("/ai/execution-projects"),
    ])
      .then(([available, localProjects]) => {
        if (active) {
          setModels(available);
          setProjects(localProjects);
        }
      })
      .catch((err) => {
        if (active) setError((err as Error).message);
      });
    return () => {
      active = false;
    };
  }, [card.id]);
  async function configure(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await send(`/cards/${card.id}/prompt-settings`, "PATCH", body);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (aiLocked) return;
    if (!effective || !effectiveEffort) {
      setError("Configure modelo, versão e esforço em algum nível da hierarquia de IA.");
      return;
    }
    setBusy(true);
    onAiActionStart?.();
    window.dispatchEvent(new CustomEvent("orbit:text-generation", { detail: { active: true } }));
    setError("");
    setResult(null);
    try {
      const generated = await send<Result>(`/cards/${card.id}/ai`, "POST", {
        action,
      });
      const suggestion = { ...generated, action };
      if (action === "checklist") {
        await createChecklist(generated.items);
      } else {
        setResult(suggestion);
        window.localStorage.setItem(suggestionStorageKey, JSON.stringify(suggestion));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      window.dispatchEvent(new CustomEvent("orbit:text-generation", { detail: { active: false } }));
      onExecutionEnd?.();
    }
  }
  function discardSuggestion() {
    setResult(null);
    window.localStorage.removeItem(suggestionStorageKey);
  }
  async function createChecklist(items: string[]) {
    if (!items.length) return;
    try {
      const details = await api<CardExtensions>(`/cards/${card.id}/extensions`);
      const checklist = details.checklists[0] || await send<{ id: string }>(
          `/cards/${card.id}/checklists`,
          "POST",
          { title: "Checklist" },
        );
      for (const item of items) {
        await send(`/checklists/${checklist.id}/items`, "POST", { text: item });
        await onChanged();
        window.dispatchEvent(new CustomEvent("orbit:card-details-changed", { detail: card.id }));
      }
      setResult(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function execute() {
    if (aiLocked) return;
    if (!effectiveProjectId) {
      setError("Selecione um projeto no cartão ou configure o padrão do quadro.");
      return;
    }
    if (!effective || !effectiveEffort) {
      setError("Configure modelo, versão e esforço em algum nível da hierarquia de IA.");
      return;
    }
    setBusy(true);
    onExecutionStart?.();
    setError("");
    try {
      await send<PromptRun>(`/cards/${card.id}/prompt-runs`, "POST", {
        instruction,
      });
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      onExecutionEnd?.();
    }
  }
  useEffect(() => {
    const handleDescriptionSaved = (event: Event) => {
      if ((event as CustomEvent<string>).detail === card.id) void execute();
    };
    window.addEventListener("orbit:card-description-saved", handleDescriptionSaved);
    return () => window.removeEventListener("orbit:card-description-saved", handleDescriptionSaved);
    // execute intentionally uses the latest settings from this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, effective, effectiveEffort, effectiveProjectId]);
  return (
    <section className={variant === "settings" ? "rounded-lg border border-[#c3b6f7] bg-[#f7f5ff] p-3" : "mt-2"}>
      {variant === "settings" && <div className="w-full text-left text-base font-bold text-[#403294]">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Sparkles size={17} /> IA do cartão</span>
          <button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-label={expanded ? "Recolher IA do cartão" : "Expandir IA do cartão"} className="shrink-0">{expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="min-w-0 text-xs font-semibold text-[#5e5a87]">
          Modelo
          <select id={`card-ai-model-${card.id}`} aria-label="Modelo e versão" value={effective || ""} disabled={busy} onChange={(event) => void configure({ ai_model: event.target.value || null })} className="mt-1 block w-full min-w-0 rounded border border-[#c3b6f7] bg-white p-2 text-sm font-normal text-[#172b4d]">
          <option value="">Modelo: não configurado</option>
          {models.map((model) => <option key={model.id} value={model.id}>Modelo: {model.name} · Versão: {model.version}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-semibold text-[#5e5a87]">
          Modo
          <select aria-label="Modo de execução da IA" value={card.ai_execution_mode || "bypass"} disabled={busy} onChange={(event) => void configure({ ai_execution_mode: event.target.value })} className="mt-1 block w-full min-w-0 rounded border border-[#c3b6f7] bg-white p-2 text-sm font-normal text-[#172b4d]">
            <option value="planning">Plan</option>
            <option value="bypass">Bypass</option>
          </select>
        </label>
        <div className="min-w-0 text-sm font-normal text-[#5e5a87]"><AiEffortField value={card.ai_effort || inheritedEffort} disabled={busy} onChange={(value) => configure({ ai_effort: value })} /></div>
        </div>
      </div>}
      {(variant === "text" || expanded) && <>
      {variant === "settings" && <>
        <p className="mt-1 text-xs text-[#626f86]">
          Referência do quadro; se não estiver configurada, usa a configuração global. O cartão pode ter valores próprios.
        </p>
        <div className="mt-3">
          <label className="block text-xs font-semibold text-[#5e5a87]">Projeto<select disabled={busy} value={effectiveProjectId || ""} onChange={(event) => void configure({ ai_project_id: event.target.value || null })} className="mt-1 block w-full rounded border border-[#c3b6f7] bg-white p-1.5 text-sm font-normal text-[#172b4d]"><option value="">Selecione um projeto</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        </div>
        {selectedProject && <p className="mt-2 truncate text-xs text-[#5e5a87]">Execução limitada a: {selectedProject.local_path}</p>}
      {effectiveProjectId && <div className="mt-4 rounded-lg border border-[#c3b6f7] bg-white p-3">
        <label className="text-xs font-semibold text-[#5e5a87]">
          Executar prompt no projeto
          <textarea
            disabled={aiLocked}
            value={instruction}
            onChange={(event) => {
              const value = event.target.value;
              setInstruction(value);
              window.localStorage.setItem(instructionStorageKey, value);
            }}
            maxLength={4000}
            rows={3}
            placeholder="Instrução adicional (opcional). A descrição do cartão será a instrução principal."
            className="mt-1 block w-full resize-y rounded border border-[#c3b6f7] bg-white p-2 text-sm font-normal text-[#172b4d]"
          />
        </label>
      </div>}
      </>}
      {variant === "settings" && error && (
        <p role="alert" className="mt-2 text-xs text-[#ae2a19]">{error}</p>
      )}
      {variant === "text" && <><div className="mt-4">
        <div className="flex flex-wrap gap-2">
        <select
          value={action}
          onChange={(event) => setAction(event.target.value as Action)}
          disabled={aiLocked}
          className="rounded border border-[#c3b6f7] bg-white px-2 py-1.5 text-xs text-[#172b4d]"
        >
          {actions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {effectiveProjectId && <button
          disabled={busy || generationBusy || aiLocked || !effective || !effectiveEffort}
          onClick={() => void generate()}
          className="flex items-center gap-1.5 rounded bg-[#6554c0] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Gerar
        </button>}
        <button
          type="button"
          disabled={busy || aiLocked || !effectiveProjectId || !effective || !effectiveEffort}
          onClick={() => void execute()}
          className="flex items-center gap-1.5 rounded bg-[#403294] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#35297d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Bot size={14} />}
          Executar
        </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-[#ae2a19]">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-3 rounded bg-white p-3 text-sm">
              {result.action === "elaborate" && (
                <p className="mb-2 rounded bg-[#e9f2ff] px-2 py-1 text-xs text-[#172b4d]">
                  O texto atual será preservado. Este conteúdo será acrescentado como um bloco de detalhamento.
                </p>
              )}
              <RichText text={result.output} />
          {result.items.length > 0 && result.action !== "checklist" && (
            <div className="mt-3 text-xs text-[#626f86]">Itens prontos para adicionar à checklist.</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={async () => { await onApply(result.output, result.action); discardSuggestion(); }}
              className="rounded bg-[#6554c0] px-2 py-1 text-xs font-semibold text-white"
            >
              {result.action === "elaborate" ? "Adicionar detalhamento" : "Aplicar à descrição"}
            </button>
            <button
              onClick={discardSuggestion}
              className="rounded px-2 py-1 text-xs font-semibold text-[#626f86] hover:bg-[#f1f2f4]"
            >
              Descartar sugestão
            </button>
          </div>
        </div>
      )}</>}
      </>}
    </section>
  );
}
