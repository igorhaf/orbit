"use client";

import { useEffect, useState } from "react";
import { Bot, Check, LoaderCircle, Sparkles } from "lucide-react";
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
import { AiEffortField, AiModelFields } from "./ai-model-fields";

type Action =
  "write" | "elaborate" | "refine" | "summarize" | "shorten" | "action_items" | "checklist";
type Result = { output: string; items: string[]; action?: Action };
const actions: { id: Action; label: string }[] = [
  { id: "write", label: "Escrever descrição" },
  { id: "elaborate", label: "Detalhar mantendo o original" },
  { id: "refine", label: "Refinar texto" },
  { id: "summarize", label: "Resumir" },
  { id: "shorten", label: "Encurtar" },
  { id: "action_items", label: "Encontrar ações" },
  { id: "checklist", label: "Criar checklist" },
];

export function CardAi({
  card,
  board,
  onApply,
  onChanged,
  onExecutionStart,
}: {
  card: Card;
  board: Board;
  onApply: (text: string, action?: Action) => Promise<void>;
  onChanged: () => Promise<void>;
  onExecutionStart?: () => void;
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
  const [error, setError] = useState("");
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
    if (!effective || !effectiveEffort) {
      setError("Configure modelo, versão e esforço em algum nível da hierarquia de IA.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const generated = await send<Result>(`/cards/${card.id}/ai`, "POST", {
        action,
      });
      const suggestion = { ...generated, action };
      setResult(suggestion);
      window.localStorage.setItem(suggestionStorageKey, JSON.stringify(suggestion));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function discardSuggestion() {
    setResult(null);
    window.localStorage.removeItem(suggestionStorageKey);
  }
  async function createChecklist() {
    if (!result?.items.length) return;
    setBusy(true);
    setError("");
    try {
      const details = await api<CardExtensions>(`/cards/${card.id}/extensions`);
      const checklist = details.checklists[0] || await send<{ id: string }>(
          `/cards/${card.id}/checklists`,
          "POST",
          { title: "Checklist" },
        );
      await send(`/checklists/${checklist.id}/items`, "POST", {
        text: result.items.join("\n"),
      });
      await onChanged();
      setResult(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!effectiveProjectId) {
      setError("Selecione um projeto no cartão ou configure o padrão do quadro.");
      return;
    }
    if (!effective || !effectiveEffort) {
      setError("Configure modelo, versão e esforço em algum nível da hierarquia de IA.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await send<PromptRun>(`/cards/${card.id}/prompt-runs`, "POST", {
        instruction,
      });
      onExecutionStart?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-lg border border-[#c3b6f7] bg-[#f7f5ff] p-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-[#403294]">
        <Sparkles size={17} /> IA do cartão
      </h3>
      <p className="mt-1 text-xs text-[#626f86]">
        Referência do quadro; se não estiver configurada, usa a configuração global. O cartão pode ter valores próprios.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-[#5e5a87]">
          Projeto
          <select
            disabled={busy}
            value={effectiveProjectId || ""}
            onChange={(event) =>
              void configure({ ai_project_id: event.target.value || null })
            }
            className="mt-1 block w-full rounded border border-[#c3b6f7] bg-white p-2 text-sm text-[#172b4d]"
          >
              {!effectiveProjectId && <option value="">Selecione um projeto</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <AiModelFields value={card.ai_model || inheritedModel} inheritedValue={null} models={models} disabled={busy} onSave={(value) => configure({ ai_model: value })} />
        <AiEffortField value={card.ai_effort || inheritedEffort} disabled={busy} onChange={(value) => configure({ ai_effort: value })} />
      </div>
      {selectedProject && (
        <p className="mt-2 truncate text-xs text-[#5e5a87]">
          Execução limitada a: {selectedProject.local_path}
        </p>
      )}
      <div className="mt-4 rounded-lg border border-[#c3b6f7] bg-white p-3">
        <label className="text-xs font-semibold text-[#5e5a87]">
          Executar prompt no projeto
          <textarea
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
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold text-[#5e5a87]">
          Assistente de texto
        </p>
        <div className="flex flex-wrap gap-2">
        <select
          value={action}
          onChange={(event) => setAction(event.target.value as Action)}
          className="rounded border border-[#c3b6f7] bg-white px-2 py-1.5 text-xs text-[#172b4d]"
        >
          {actions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !effective || !effectiveEffort}
          onClick={() => void generate()}
          className="flex items-center gap-1.5 rounded bg-[#6554c0] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Gerar
        </button>
        <button
          type="button"
          disabled={busy || !effectiveProjectId || !effective || !effectiveEffort}
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
          {result.items.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => void createChecklist()}
                className="rounded bg-[#e9e5fa] px-2 py-1 text-xs font-semibold text-[#403294]"
              >
                <Check size={13} className="mr-1 inline" />
                Adicionar à checklist
              </button>
            </div>
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
      )}
    </section>
  );
}
