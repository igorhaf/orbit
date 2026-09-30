"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import {
  AiModel,
  AiProject,
  Board,
  Card,
  api,
  send,
} from "@/lib/api";
import { RichText } from "./rich-text";
import { AiEffortField, AiModelFields } from "./ai-model-fields";

type Action =
  "write" | "refine" | "summarize" | "shorten" | "action_items" | "checklist";
type Result = { output: string; items: string[] };
const actions: { id: Action; label: string }[] = [
  { id: "write", label: "Escrever descrição" },
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
}: {
  card: Card;
  board: Board;
  onApply: (text: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [action, setAction] = useState<Action>("refine");
  const [result, setResult] = useState<Result | null>(null);
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
      setResult(
        await send<Result>(`/cards/${card.id}/ai`, "POST", {
          action,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createChecklist() {
    if (!result?.items.length) return;
    setBusy(true);
    setError("");
    try {
      const checklist = await send<{ id: string }>(
        `/cards/${card.id}/checklists`,
        "POST",
        { title: "Checklist sugerido por IA" },
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
  return (
    <section className="rounded-lg border border-[#c3b6f7] bg-[#f7f5ff] p-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-[#403294]">
        <Sparkles size={17} /> IA do cartão
      </h3>
      <p className="mt-1 text-xs text-[#626f86]">
        O cartão prevalece sobre quadro, projeto e configuração global. Campos sem configuração própria herdam o nível acima.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-[#5e5a87]">
          Projeto
          <select
            disabled={busy}
            value={card.ai_project_id || ""}
            onChange={(event) =>
              void configure({ ai_project_id: event.target.value || null })
            }
            className="mt-1 block w-full rounded border border-[#c3b6f7] bg-white p-2 text-sm text-[#172b4d]"
          >
              <option value="">
                {board.ai_default_project_id ? "Herdar projeto do quadro" : "Escolher projeto"}
              </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <AiModelFields value={card.ai_model} inheritedValue={inheritedModel} models={models} disabled={busy} onSave={(value) => configure({ ai_model: value })} />
        <AiEffortField value={card.ai_effort} inheritedValue={inheritedEffort} disabled={busy} onChange={(value) => configure({ ai_effort: value })} />
      </div>
      {selectedProject && (
        <p className="mt-2 truncate text-xs text-[#5e5a87]">
          Execução limitada a: {selectedProject.local_path}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
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
          className="rounded bg-[#6554c0] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : "Gerar"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-[#ae2a19]">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-3 rounded bg-white p-3 text-sm">
          <RichText text={result.output} />
          {result.items.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => void createChecklist()}
                className="rounded bg-[#e9e5fa] px-2 py-1 text-xs font-semibold text-[#403294]"
              >
                <Check size={13} className="mr-1 inline" />
                Adicionar checklist
              </button>
            </div>
          )}
          <button
            onClick={() => void onApply(result.output)}
            className="mt-3 rounded bg-[#6554c0] px-2 py-1 text-xs font-semibold text-white"
          >
            Aplicar à descrição
          </button>
        </div>
      )}
    </section>
  );
}
