"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  CheckSquare,
  Clock3,
  CreditCard,
  ExternalLink,
  LoaderCircle,
  Mail,
  MoveRight,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  MessageSquare,
} from "lucide-react";
import {
  api,
  send,
  Board,
  Card,
  CardDetails,
  PromptRun,
  getUser,
  labelColors,
  labelTextColor,
  withExpansion,
} from "@/lib/api";
import { remember } from "@/lib/history";
import { Modal, useConfirmModal } from "./ui";
import { MarkdownEditor, RichText } from "./rich-text";
import { CardDatesPanel, CardLabelsPanel } from "./card-extras";
import { CardSections } from "./card-sections";
import { CardOperations } from "./card-operations";
import { CardComments } from "./card-comments";
import { CardAi } from "./card-ai";
import { CardExecutionPanel } from "./card-execution";
import { PromptExecution } from "./prompt-execution";

const imageData = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
  reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
  reader.readAsDataURL(file);
});

function PromptPreview({ card, board }: { card: Card; board: Board }) {
  const [run, setRun] = useState<PromptRun | null>(null);
  const [models, setModels] = useState<{ id: string; name: string; version: string }[]>([]);
  useEffect(() => {
    let live = true;
    void api<PromptRun[]>(`/cards/${card.id}/prompt-runs`).then((runs) => {
      if (live) setRun(runs[0] || null);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [card.id]);
  useEffect(() => {
    let live = true;
    void api<{ id: string; name: string; version: string }[]>("/ai/models").then((available) => {
      if (live) setModels(available);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const model = card.ai_model || board.ai_default_model || card.ai_project_default_model || board.ai_global_model || card.ai_global_model || "Não configurado";
  const effort = card.ai_effort || board.ai_default_effort || card.ai_project_default_effort || board.ai_global_effort || card.ai_global_effort || "Não configurado";
  const selectedModel = models.find((item) => item.id === (run?.model || model));
  const modelLabel = selectedModel ? `${selectedModel.name} · ${selectedModel.version}` : run?.model || model;
  const prompt = run?.prompt || `Você está iniciando a sessão de prompt do Orbit no projeto selecionado. Trabalhe somente dentro do diretório atual. Se alguma coisa bugar durante a execução, identifique a causa, corrija o problema e retome a solicitação até concluir ou registrar claramente o bloqueio.\n\nCARTÃO: ${card.title}\n\nINSTRUÇÃO PRINCIPAL:\n${card.description || card.title}`;
  return <section className="mt-6 space-y-4" aria-label="Próximo prompt">
    <div className="flex min-w-max flex-nowrap gap-3 overflow-x-auto text-xs"><span className="shrink-0 rounded bg-[#e9f2ff] px-3 py-2">Modelo: <b>{modelLabel}</b></span><span className="shrink-0 rounded bg-[#e9f2ff] px-3 py-2">Esforço: <b>{run?.effort || effort}</b></span><span className="shrink-0 rounded bg-[#e9f2ff] px-3 py-2">Projeto: <b>{card.ai_project_id ? "Definido no cartão" : board.ai_default_project_id ? "Padrão do quadro" : "Selecione no cartão"}</b></span></div>
    <p className="text-sm text-[#626f86]">Prévia da instrução usada na sessão. Após executar, esta aba mostra o prompt completo enviado.</p>
    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[#dfe1e6] bg-[#f7f8fa] p-4 font-mono text-xs leading-5">{prompt}</pre>
  </section>;
}

function CardPromptSummary({ card, onOpenExecution, onChanged, aiLocked, onExecutionStart, onExecutionEnd }: { card: Card; onOpenExecution: () => void; onChanged: () => Promise<void>; aiLocked: boolean; onExecutionStart: () => void; onExecutionEnd: () => void }) {
  const [run, setRun] = useState<PromptRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const runs = await api<PromptRun[]>(`/cards/${card.id}/prompt-runs`);
        if (live) setRun(runs.find((item) => item.source !== "comment") || null);
      } catch { /* Mantém o último resumo carregado. */ }
    };
    void refresh();
    const timer = window.setInterval(() => { if (run && ["queued", "running"].includes(run.status)) void refresh(); }, 1200);
    return () => { live = false; window.clearInterval(timer); };
  }, [card.id, run]);
  if (!run || (!run.summary && !run.prompt?.includes("[[ORBIT_SUMMARY]]"))) return null;
  async function perform(action: () => Promise<unknown>, startsExecution = false) {
    setBusy(true);
    setError("");
    if (startsExecution) onExecutionStart();
    try {
      await action();
      await onChanged();
      if (run?.id) {
        const runs = await api<PromptRun[]>(`/cards/${card.id}/prompt-runs`);
        setRun(runs.find((item) => item.id === run.id) || runs[0] || null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (startsExecution) onExecutionEnd();
    }
  }
  const summary = run.summary || "";
  return <section aria-label="Resultado do último prompt da descrição" className="mt-3 rounded-lg border border-[#c3b6f7] bg-[#f7f5ff] p-3 dark:border-[#594b86] dark:bg-[#302a43]">
    <h3 className="text-sm font-semibold text-[#403294] dark:text-[#d4c7ff]">Resultado do último prompt</h3>
    {run.summary ? <>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#172b4d] dark:text-[#e6e0ff]">{summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void perform(() => send<Card>(`/cards/${card.id}`, "PATCH", { description: summary }))} className="rounded border border-[#c3b6f7] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#403294] hover:bg-[#eeeaff] disabled:opacity-50">Sobrescrever como descrição</button>
        <button type="button" disabled={busy} onClick={() => void perform(() => send(`/cards/${card.id}/comments`, "POST", { body: summary }))} className="flex items-center gap-1 rounded border border-[#c3b6f7] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#403294] hover:bg-[#eeeaff] disabled:opacity-50"><MessageSquare size={14} /> Adicionar como comentário</button>
        <button type="button" disabled={busy || aiLocked} onClick={() => { onOpenExecution(); void perform(() => send(`/cards/${card.id}/prompt-runs`, "POST", {}), true); }} className="flex items-center gap-1 rounded border border-[#c3b6f7] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#403294] hover:bg-[#eeeaff] disabled:opacity-50"><RotateCcw size={14} /> Reexecutar</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-[#ae2a19]">{error}</p>}
    </>
      : run.status === "queued" || run.status === "running" ? <p className="mt-2 text-sm text-[#626f86] dark:text-[#c4bce0]">A execução está em andamento. O resumo aparecerá ao finalizar.</p>
      : run.status === "error" ? <p className="mt-2 text-sm text-[#ae2a19] dark:text-[#ff9f8f]">A última execução falhou. <button type="button" onClick={onOpenExecution} className="underline hover:text-[#7f1d1d] dark:hover:text-[#ffd0c7]">Veja os detalhes na aba Execução.</button></p>
      : <p className="mt-2 text-sm text-[#626f86] dark:text-[#c4bce0]">Esta execução não retornou o resumo estruturado.</p>}
  </section>;
}

export function CardDialog({
  card,
  board,
  onClose,
  onChanged,
  onDeleted,
}: {
  card: Card;
  board: Board;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { confirm, confirmationModal } = useConfirmModal();
  const [details, setDetails] = useState<CardDetails>({
    comments: [],
    checklist: [],
    externalResources: [],
  });
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || "");
  const [editingDescription, setEditingDescription] = useState(false);
  const [panel, setPanel] = useState<"labels" | "date" | "move" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"card" | "prompt" | "output">("card");
  const [aiActionPending, setAiActionPending] = useState(false);
  const [previousCard, setPreviousCard] = useState(card);
  const markedActivityRead = useRef("");
  const descriptionEditorRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef(description);
  const saveDescriptionRef = useRef<() => Promise<boolean>>(async () => false);
  const savingDescriptionRef = useRef<Promise<boolean> | null>(null);
  if (card !== previousCard) {
    setPreviousCard(card);
    setTitle(card.title);
    // A troca do projeto de IA atualiza o cartão no servidor. Não substitua
    // um rascunho que ainda está sendo editado por essa versão recarregada.
    if (!editingDescription) setDescription(card.description || "");
  }
  const user = getUser();
  const list = board.lists?.find((current) => current.id === card.list_id);
  const promptRunning = card.prompt?.status === "queued" || card.prompt?.status === "running";
  const executionRunning = card.result?.status === "queued" || card.result?.status === "running";
  const mainTabExecution = promptRunning || executionRunning;
  const aiLocked = aiActionPending || mainTabExecution;
  const mainTabStatus = promptRunning
    ? card.prompt?.status === "queued" ? "Na fila" : "Executando"
    : executionRunning
      ? card.result?.status === "queued" ? "Na fila" : "Executando"
      : card.prompt?.status === "error" || card.result?.status === "failed" ? "Falhou"
        : card.prompt?.status === "success" || card.result?.status === "success" ? "Concluído" : "";
  useEffect(() => {
    if (!card.prompt?.unread && !card.result?.unread) return;
    const activityId = `${card.id}:${card.prompt?.finished_at || card.prompt?.status || card.result?.status || "complete"}`;
    if (markedActivityRead.current === activityId) return;
    markedActivityRead.current = activityId;
    void send(`/cards/${card.id}/prompt-notifications/read`, "PATCH").then(onChanged).catch(() => undefined);
  }, [card.id, card.prompt?.finished_at, card.prompt?.status, card.prompt?.unread, card.result?.status, card.result?.unread, onChanged]);

  function openDescriptionEditor() {
    setDescription(card.description || "");
    setEditingDescription(true);
  }

  const loadDetails = useCallback(async () => {
    try {
      setDetails(await api<CardDetails>(`/cards/${card.id}/details`));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [card.id]);
  useEffect(() => {
    let active = true;
    api<CardDetails>(`/cards/${card.id}/details`)
      .then((value) => { if (active) setDetails(value); })
      .catch((err) => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [card.id]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await Promise.all([onChanged(), loadDetails()]);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function uploadDescriptionImages(files: File[]) {
    if (files.length > 10) throw new Error("Envie no máximo 10 imagens por vez.");
    return Promise.all(files.map(async file => {
      if (!file.type.startsWith("image/")) throw new Error("Envie somente imagens na descrição.");
      const attachment = await send<{ id: string }>(`/cards/${card.id}/attachments`, "POST", {
        name: file.name || "imagem",
        mime_type: file.type,
        data: await imageData(file),
      });
      return `/api/card-attachments/${attachment.id}/content`;
    }));
  }
  async function updateCard(
    body: Record<string, unknown>,
    undoBody: Record<string, unknown>,
    label: string,
  ) {
    let updated: Card | undefined;
    const success = await run(async () => {
      updated = await send<Card>(`/cards/${card.id}`, "PATCH", body);
    });
    if (success) {
      const recurring = body.completed === true && Boolean(card.recurrence);
      const undo = recurring
        ? { ...undoBody, start_date: card.start_date, due_date: card.due_date }
        : undoBody;
      const redo = recurring
        ? {
            completed: false,
            start_date: updated?.start_date,
            due_date: updated?.due_date,
          }
        : body;
      remember({
        label,
        undo: [{ path: `/cards/${card.id}`, method: "PATCH", body: undo }],
        redo: [{ path: `/cards/${card.id}`, method: "PATCH", body: redo }],
      });
    }
    return success;
  }

  const saveDescription = useCallback(async (): Promise<boolean> => {
    if (!editingDescription) return false;
    if (savingDescriptionRef.current) return savingDescriptionRef.current;
    const save = (async () => {
      const nextDescription = descriptionRef.current;
      if (nextDescription !== card.description) {
        const success = await updateCard(
          { description: nextDescription },
          { description: card.description },
          "editar descrição",
        );
        if (success) setEditingDescription(false);
        return success;
      } else {
        setEditingDescription(false);
        return true;
      }
    })();
    savingDescriptionRef.current = save;
    try {
      return await save;
    } finally {
      if (savingDescriptionRef.current === save) savingDescriptionRef.current = null;
    }
  // updateCard is intentionally kept local to the dialog and is recreated with its current card state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.description, editingDescription]);

  useEffect(() => {
    descriptionRef.current = description;
    saveDescriptionRef.current = saveDescription;
  }, [description, saveDescription]);

  useEffect(() => {
    if (!editingDescription) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (descriptionEditorRef.current?.contains(target)) return;
      void saveDescriptionRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [editingDescription]);

  return (
    <>
    <Modal onClose={onClose} extraWide>
      <div className="max-h-[84vh] overflow-y-auto rounded-xl bg-[#f7f8fa] p-4 text-[#172b4d] sm:p-6">
        <div className="pr-9">
          <div className="flex items-start gap-3">
            <CreditCard size={22} className="mt-1 shrink-0" />
            <div className="min-w-0 flex-1">
              <input
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (title.trim() && title !== card.title)
                    updateCard(
                      { title },
                      { title: card.title },
                      "renomear cartão",
                    );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="w-full rounded bg-transparent px-1 py-0.5 text-xl font-semibold outline-none hover:bg-[#e9eaed] focus:bg-white"
                aria-label="Título do cartão"
              />
              <p className="mt-1 text-sm text-[#626f86]">
                na lista{" "}
                <button
                  onClick={() => setPanel("move")}
                  className="underline hover:text-[#172b4d]"
                >
                  {list?.title}
                </button>
                {card.kind === "template" && (
                  <span className="ml-2 rounded bg-[#e9d8fd] px-1.5 py-0.5 text-xs text-[#6e44a3]">
                    Modelo
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="mt-4 rounded bg-[#ffebe6] px-3 py-2 text-sm text-[#ae2a19]"
          >
            {error}
          </div>
        )}
        <nav className="mt-6 flex gap-1 border-b border-[#dfe1e6]" aria-label="Abas do cartão">
          {[ ["card", "Cartão"], ["prompt", "Próximo prompt"], ["output", "Execução"] ].map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id as typeof tab)} className={`border-b-2 px-4 py-2 text-sm font-semibold ${tab === id ? "border-[#0c66e4] text-[#0c66e4]" : "border-transparent text-[#626f86] hover:text-[#172b4d]"}`}>{id === "card" && mainTabExecution && <LoaderCircle size={14} className="mr-1 inline animate-spin" aria-label="Execução em andamento" />}<span>{label}</span>{id === "card" && mainTabStatus && <span className={`ml-1 text-[11px] font-medium ${mainTabExecution ? "text-[#579dff]" : mainTabStatus === "Falhou" ? "text-[#ae2a19]" : "text-[#216e4e]"}`}>({mainTabStatus})</span>}</button>)}
        </nav>
        {tab === "card" && <div className="mt-6 grid gap-7 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]">
          <div className="min-w-0 space-y-7">
            <div className="flex flex-wrap gap-5 pl-1">
              {card.labels?.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold text-[#626f86]">
                    Etiquetas
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {card.labels.map((label) => (
                      <button
                        key={label.id}
                        onClick={() => setPanel("labels")}
                        className="min-w-12 rounded px-2 py-1 text-xs font-semibold"
                        style={{
                          background: labelColors[label.color] || label.color,
                          color: labelTextColor(label.color),
                        }}
                      >
                        {label.name || "Sem nome"}
                      </button>
                    ))}
                    <button
                      onClick={() => setPanel("labels")}
                      className="rounded bg-[#e9eaed] p-1.5"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              )}
              {(card.start_date || card.due_date) && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold text-[#626f86]">
                    Datas
                  </h3>
                  <button
                    onClick={() => setPanel("date")}
                    className="rounded bg-[#e9eaed] px-2 py-1 text-left text-xs"
                  >
                    {card.start_date && (
                      <span className="block">
                        Início:{" "}
                        {new Date(card.start_date).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    )}
                    {card.due_date && (
                      <span className="block">
                        Vence:{" "}
                        {new Date(card.due_date).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    )}
                    {card.recurrence && (
                      <span className="block text-[#0c66e4]">
                        Recorrente:{" "}
                        {
                          (
                            {
                              daily: "diário",
                              weekly: "semanal",
                              monthly: "mensal",
                              yearly: "anual",
                            } as const
                          )[card.recurrence]
                        }
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setPanel("labels")}
                className="rounded border border-[#dfe1e6] bg-white px-3 py-2 text-sm font-medium hover:bg-[#f1f2f4]"
              >
                <Tag size={16} className="mr-1 inline" />
                Etiquetas
              </button>
              <button
                type="button"
                aria-pressed={card.completed}
                aria-label={`Status: ${card.completed ? "concluído" : "em andamento"}. Alternar status`}
                onClick={() =>
                  void updateCard(
                    { completed: !card.completed },
                    { completed: card.completed },
                    card.completed ? "reabrir cartão" : "concluir cartão",
                  )
                }
                className={`order-first flex shrink-0 items-center gap-1 rounded border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c66e4] ${card.completed ? "border-[#7ee2b8] bg-[#e3fcef] text-[#216e4e] hover:bg-[#dffcf0]" : "border-[#dfe1e6] bg-white text-[#626f86] hover:bg-[#f1f2f4]"}`}
              >
                <CheckCircle2 size={16} aria-hidden="true" />
                {card.completed ? "Concluído" : "Em andamento"}
              </button>
              <button
                onClick={() => setPanel("date")}
                className="rounded border border-[#dfe1e6] bg-white px-3 py-2 text-sm font-medium hover:bg-[#f1f2f4]"
              >
                <Clock3 size={16} className="mr-1 inline" />
                Datas
              </button>
              <button
                onClick={() =>
                  document
                    .getElementById("card-checklists")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="rounded border border-[#dfe1e6] bg-white px-3 py-2 text-sm font-medium hover:bg-[#f1f2f4]"
              >
                <CheckSquare size={16} className="mr-1 inline" />
                Checklist
              </button>
            </div>
            <div className="pl-0 sm:pl-8">
              <section>
                {editingDescription ? (
                  <div ref={descriptionEditorRef}>
                    <div>
                      <MarkdownEditor
                        value={description}
                        onChange={setDescription}
                        placeholder="Adicione contexto, links e imagens em Markdown..."
                        onImageFiles={uploadDescriptionImages}
                      />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveDescription()}
                        className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        disabled={busy || aiLocked}
                        onClick={() => void (async () => {
                          if (await saveDescription()) {
                            window.dispatchEvent(new CustomEvent("orbit:card-description-saved", { detail: card.id }));
                          }
                        })()}
                        className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        Salvar e executar
                      </button>
                      <button
                        onClick={() => { setDescription(card.description || ""); setEditingDescription(false); }}
                        className="rounded px-3 py-1.5 text-sm hover:bg-[#e9eaed]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onDoubleClick={openDescriptionEditor}
                    className="min-h-16 rounded bg-[#e9eaed] p-3 text-sm"
                  >
                    <button
                      onClick={openDescriptionEditor}
                      className="mb-2 text-xs font-semibold text-[#0c66e4]"
                    >
                      Editar descrição
                    </button>
                    {description ? (
                      <RichText text={description} />
                    ) : (
                      <p>Adicione uma descrição mais detalhada...</p>
                    )}
                  </div>
                )}
              </section>
              <CardAi
                key={`text-assistant:${card.id}`}
                card={card}
                board={board}
                variant="text"
                onChanged={onChanged}
                onExecutionStart={() => { setAiActionPending(true); setTab("output"); }}
                onAiActionStart={() => setAiActionPending(true)}
                onExecutionEnd={() => setAiActionPending(false)}
                aiLocked={aiLocked}
                onApply={async (text, action) => {
                  const nextDescription = action === "elaborate" ? withExpansion(card.description, text) : text;
                  const changed = await updateCard(
                    { description: nextDescription },
                    { description: card.description },
                    action === "elaborate" ? "detalhar descrição" : "aplicar sugestão de IA",
                  );
                  if (changed) setDescription(nextDescription);
                }}
              />
            </div>
            <CardPromptSummary key={`prompt-summary:${card.id}`} card={card} onOpenExecution={() => setTab("output")} onChanged={onChanged} aiLocked={aiLocked} onExecutionStart={() => setAiActionPending(true)} onExecutionEnd={() => setAiActionPending(false)} />
            <CardSections
              key={card.id}
              card={card}
              board={board}
              onChanged={onChanged}
            />
              <CardExecutionPanel
              key={"execution:" + card.id}
              card={card}
              board={board}
              onChanged={onChanged}
              onExecutionStart={() => setAiActionPending(true)}
              onExecutionEnd={() => setAiActionPending(false)}
              aiLocked={aiLocked}
              mode="settings"
            />
            {details.externalResources.length > 0 && (
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                  <ExternalLink size={17} /> Recursos externos
                </h3>
                <div className="space-y-2">
                  {details.externalResources.map((resource) => {
                    const metadata = resource.metadata || {},
                      mail =
                        resource.resource_type === "mail_thread" ||
                        resource.resource_type === "mail_message";
                    return (
                      <a
                        key={resource.id}
                        href={resource.url || undefined}
                        target={resource.url ? "_blank" : undefined}
                        rel="noopener noreferrer"
                        className="block rounded-lg border border-[#dfe1e6] bg-white p-3 hover:bg-[#f1f2f4]"
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          {mail ? (
                            <Mail size={16} />
                          ) : (
                            <ExternalLink size={16} />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {String(metadata.subject || metadata.name || resource.resource_type)}
                          </span>
                          <span className="rounded bg-[#e9eaed] px-1.5 py-0.5 text-[10px] uppercase">
                            {resource.plugin_id.replace("_", " ")}
                          </span>
                        </div>
                        {Boolean(metadata.preview) && (
                          <p className="mt-1 line-clamp-2 text-xs text-[#626f86]">
                            {String(metadata.preview)}
                          </p>
                        )}
                        {Boolean(metadata.sender) &&
                          typeof metadata.sender === "object" && (
                            <p className="mt-1 truncate text-[11px] text-[#626f86]">
                              De:{" "}
                              {String(
                                (
                                  metadata.sender as {
                                    name?: string;
                                    address?: string;
                                  }
                                ).name ||
                                  (metadata.sender as { address?: string })
                                    .address ||
                                  "",
                              )}
                            </p>
                          )}
                      </a>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
          <aside className="min-w-0 space-y-6 border-l border-[#dfe1e6] pl-0 xl:pl-7">
            <CardAi
              key={card.id}
              card={card}
              board={board}
              onChanged={onChanged}
              onExecutionStart={() => { setAiActionPending(true); setTab("output"); }}
              onAiActionStart={() => setAiActionPending(true)}
              onExecutionEnd={() => setAiActionPending(false)}
              aiLocked={aiLocked}
              onApply={async (text, action) => {
                const nextDescription = action === "elaborate"
                  ? withExpansion(card.description, text)
                  : text;
                const changed = await updateCard(
                  { description: nextDescription },
                  { description: card.description },
                  action === "elaborate" ? "detalhar descrição" : "aplicar sugestão de IA",
                );
                if (changed) {
                  setDescription(nextDescription);
                  await onChanged();
                }
              }}
            />
            <CardComments
              card={card}
              board={board}
              details={details}
              onChanged={onChanged}
              refreshDetails={loadDetails}
              run={run}
              user={user}
              aiLocked={aiLocked}
              onAiActionStart={() => setAiActionPending(true)}
              onAiActionEnd={() => setAiActionPending(false)}
            />
            <div>
              <h4 className="mb-2 text-xs font-bold text-[#626f86]">Ações</h4>
              <div className="space-y-2">
                <button
                  onClick={() =>
                    updateCard(
                      { completed: !card.completed },
                      { completed: card.completed },
                      card.completed ? "reabrir cartão" : "concluir cartão",
                    )
                  }
                  className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"
                >
                  <Check size={16} />
                  {card.completed ? "Reabrir cartão" : "Concluir cartão"}
                </button>
                <button
                  onClick={() => setPanel(panel === "move" ? null : "move")}
                  className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"
                >
                  <MoveRight size={16} /> Mover, copiar ou espelhar
                </button>
                {["normal", "template"].includes(card.kind || "normal") && (
                  <>
                    <button
                      onClick={() =>
                        run(() =>
                          send(`/cards/${card.id}/template`, "PATCH", {
                            template: card.kind !== "template",
                          }),
                        )
                      }
                      className="w-full rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"
                    >
                      {card.kind === "template"
                        ? "Remover modelo"
                        : "Marcar como modelo"}
                    </button>
                    {card.kind === "template" && (
                      <button
                        onClick={() =>
                          run(() =>
                            send("/cards/copy", "POST", {
                              card_ids: [card.id],
                              list_id: card.list_id,
                            }),
                          )
                        }
                        className="w-full rounded bg-[#e9eaed] px-3 py-2 text-left text-sm hover:bg-[#dfe1e6]"
                      >
                        Criar cartão deste modelo
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => confirm(
                    { title: "Arquivar cartão", description: `Arquivar o cartão “${card.title}”?`, confirmLabel: "Arquivar" },
                    async () => { await send(`/cards/${card.id}/archive`, "POST"); remember({label:'arquivar cartão',undo:[{path:`/cards/${card.id}/restore`,method:'POST'}],redo:[{path:`/cards/${card.id}/archive`,method:'POST'}]}); await onDeleted(); },
                  )}
                  className="flex w-full items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-left text-sm text-[#ae2a19] hover:bg-[#ffebe6]"
                >
                  <Trash2 size={16} /> Arquivar
                </button>
                <button
                  onClick={() => confirm(
                    { title: "Excluir cartão definitivamente", description: `O cartão “${card.title}” será apagado permanentemente. Essa ação não pode ser desfeita. Continuar?`, confirmLabel: "Excluir definitivamente" },
                    async () => { await send(`/cards/${card.id}/archive`, "POST"); await send(`/cards/${card.id}`, "DELETE"); await onDeleted(); },
                  )}
                  className="flex w-full items-center gap-2 rounded bg-[#ffebe6] px-3 py-2 text-left text-sm font-semibold text-[#ae2a19] hover:bg-[#ffd9d2]"
                >
                  <Trash2 size={16} /> Excluir definitivamente
                </button>
              </div>
            </div>
          </aside>
        </div>}
        {tab === "prompt" && <PromptPreview card={card} board={board} />}
          {tab === "output" && <div className="mt-6"><CardExecutionPanel key={`execution-output:${card.id}`} card={card} board={board} onChanged={onChanged} mode="outputs" aiLocked={aiLocked}/></div>}
        <div className={tab === "output" ? "mt-6" : "hidden"}>
          <PromptExecution card={card} board={board} active={tab === "output"} />
        </div>
        </div>
      </Modal>
      {panel === "labels" && (
        <CardLabelsPanel
          board={board}
          card={card}
          run={run}
          busy={busy}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "date" && (
        <Modal onClose={() => setPanel(null)}>
          <div className="space-y-5 p-6 text-sm sm:p-8">
            <div className="border-b border-[#dfe1e6] pb-4">
              <h2 className="pr-12 text-xl font-bold">Datas</h2>
              <p className="mt-2 text-sm text-[#626f86]">
                Configure início, vencimento, lembretes e agendamento.
              </p>
            </div>
            <CardDatesPanel
              key={
                String(card.start_date) +
                String(card.due_date) +
                String(card.recurrence) +
                String(card.reminder_minutes)
              }
              card={card}
              update={updateCard}
            />
          </div>
        </Modal>
      )}
      {panel === "move" && (
        <Modal onClose={() => setPanel(null)}>
          <div className="space-y-5 p-6 text-sm sm:p-8">
            <div className="border-b border-[#dfe1e6] pb-4">
              <h2 className="pr-12 text-xl font-bold">Mover cartão</h2>
              <p className="mt-2 text-sm text-[#626f86]">
                Mova, copie ou crie um espelho deste cartão.
              </p>
            </div>
            <CardOperations
              card={card}
              board={board}
              onChanged={onChanged}
              onMoved={onDeleted}
            />
          </div>
        </Modal>
      )}
    {confirmationModal}
    </>
  );
}
