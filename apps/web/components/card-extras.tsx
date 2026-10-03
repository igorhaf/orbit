"use client";

import { useState } from "react";
import { Check, Pencil, Search, Trash2, X } from "lucide-react";
import {
  Board,
  Card,
  Label,
  labelColors,
  labelTextColor,
  send,
} from "@/lib/api";
import { Avatar, Modal, useConfirmModal } from "./ui";

type Run = (action: () => Promise<unknown>) => Promise<boolean>;
type Update = (
  body: Record<string, unknown>,
  undo: Record<string, unknown>,
  label: string,
) => Promise<boolean>;

const toLocal = (date: string | null) => {
  if (!date) return "";
  const value = new Date(date);
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    String(value.getFullYear()) +
    "-" +
    pad(value.getMonth() + 1) +
    "-" +
    pad(value.getDate()) +
    "T" +
    pad(value.getHours()) +
    ":" +
    pad(value.getMinutes())
  );
};

export function CardDatesPanel({
  card,
  update,
}: {
  card: Card;
  update: Update;
}) {
  const [start, setStart] = useState(toLocal(card.start_date));
  const [due, setDue] = useState(toLocal(card.due_date));
  const [reminder, setReminder] = useState(
    card.reminder_minutes === null ? "" : String(card.reminder_minutes),
  );
  const [recurrence, setRecurrence] = useState(card.recurrence || "");
  const [scheduled, setScheduled] = useState(Boolean(card.schedule));
  const [scheduleStart, setScheduleStart] = useState(
    toLocal(card.schedule?.startAt || null),
  );
  const [scheduleEnd, setScheduleEnd] = useState(
    toLocal(card.schedule?.endAt || null),
  );
  const [allDay, setAllDay] = useState(Boolean(card.schedule?.allDay));
  const [timeZone, setTimeZone] = useState(
    card.schedule?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [error, setError] = useState("");
  async function save() {
    if (start && due && new Date(start) > new Date(due)) {
      setError("A data inicial deve preceder o vencimento.");
      return;
    }
    if (scheduled && !scheduleStart) {
      setError("Informe o início do agendamento.");
      return;
    }
    if (
      scheduled &&
      scheduleEnd &&
      new Date(scheduleStart) > new Date(scheduleEnd)
    ) {
      setError("O fim do agendamento deve ser posterior ao início.");
      return;
    }
    const body = {
      start_date: start ? new Date(start).toISOString() : null,
      due_date: due ? new Date(due).toISOString() : null,
      reminder_minutes: due && reminder !== "" ? Number(reminder) : null,
      recurrence: due && recurrence ? recurrence : null,
      schedule: scheduled
        ? {
            startAt: new Date(scheduleStart).toISOString(),
            endAt: scheduleEnd ? new Date(scheduleEnd).toISOString() : null,
            allDay,
            timeZone,
          }
        : null,
    };
    const undo = {
      start_date: card.start_date,
      due_date: card.due_date,
      reminder_minutes: card.reminder_minutes,
      recurrence: card.recurrence,
      schedule: card.schedule || null,
    };
    if (await update(body, undo, "alterar datas")) setError("");
  }
  return (
    <div className="space-y-4 text-sm">
      <label className="block font-semibold">
        Data inicial
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]"
        />
      </label>
      <label className="block font-semibold">
        Vencimento
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]"
        />
      </label>
      <label className="block font-semibold">
        Lembrete
        <select
          value={reminder}
          onChange={(e) => setReminder(e.target.value)}
          disabled={!due}
          className="mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]"
        >
          <option value="">Sem lembrete</option>
          <option value="0">No vencimento</option>
          <option value="5">5 minutos antes</option>
          <option value="10">10 minutos antes</option>
          <option value="15">15 minutos antes</option>
          <option value="30">30 minutos antes</option>
          <option value="60">1 hora antes</option>
          <option value="1440">1 dia antes</option>
          <option value="2880">2 dias antes</option>
          <option value="10080">1 semana antes</option>
        </select>
      </label>
      <label className="block font-semibold">
        Repetir ao concluir
        <select
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
          disabled={!due}
          className="mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]"
        >
          <option value="">Não repetir</option>
          <option value="daily">Diariamente</option>
          <option value="weekly">Semanalmente</option>
          <option value="monthly">Mensalmente</option>
          <option value="yearly">Anualmente</option>
        </select>
      </label>
      <div className="border-t border-[#dfe1e6] pt-4">
        <label className="flex items-center gap-2 font-semibold">
          <input
            className="size-4 accent-[#0c66e4]"
            type="checkbox"
            checked={scheduled}
            onChange={(event) => setScheduled(event.target.checked)}
          />
          Exibir no calendário
        </label>
        {scheduled && (
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2">
              <input
                className="size-4 accent-[#0c66e4]"
                type="checkbox"
                checked={allDay}
                onChange={(event) => setAllDay(event.target.checked)}
              />
              Dia inteiro
            </label>
            <label className="block font-semibold">
              Início
              <input
                type="datetime-local"
                value={scheduleStart}
                onChange={(event) => setScheduleStart(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]"
              />
            </label>
            <label className="block font-semibold">
              Fim
              <input
                type="datetime-local"
                value={scheduleEnd}
                onChange={(event) => setScheduleEnd(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]"
              />
            </label>
            <label className="block font-semibold">
              Fuso horário
              <input
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]"
              />
            </label>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[#ae2a19]">
          {error}
        </p>
      )}
      <button
        onClick={() => void save()}
        className="min-h-11 w-full rounded-lg bg-[#0c66e4] px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60"
      >
        Salvar datas
      </button>
    </div>
  );
}

export function CardLabelsPanel({
  board,
  card,
  run,
  busy = false,
  onClose,
}: {
  board: Board;
  card: Card;
  run: Run;
  busy?: boolean;
  onClose: () => void;
}) {
  const { confirm, confirmationModal } = useConfirmModal();
  const [name, setName] = useState("");
  const [color, setColor] = useState("green");
  const [editing, setEditing] = useState<Label | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const colors = Object.entries(labelColors).filter(([key]) => !key.endsWith("_light") && !key.endsWith("_dark") && key !== "none");
  async function action(work: () => Promise<unknown>) {
    if (await run(work)) setError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length > 100) {
      setError("O nome deve ter até 100 caracteres.");
      return;
    }
    const path = "/boards/" + board.id + "/labels" + (editing ? "/" + editing.id : "");
    const success = await run(async () => {
      if (editing) return send(path, "PATCH", { name: name.trim(), color });
      const label = await send<Label>(path, "POST", { name: name.trim(), color });
      await send("/cards/" + card.id + "/labels/" + label.id + "/toggle", "POST");
    });
    if (success) {
      setEditing(null);
      setName("");
      setColor("green");
      setError("");
      setEditorOpen(false);
    }
  }
  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
    setName("");
    setColor("green");
    setError("");
  }
  const selectedIds = new Set(card.labels?.map((label) => label.id) || []);
  const filteredLabels = (board.labels || []).filter((label) => label.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <>
    <Modal onClose={onClose}>
    <div className="space-y-5 p-6 text-sm sm:p-8">
      <div className="border-b border-[#dfe1e6] pb-4"><h2 className="pr-12 text-xl font-bold">Etiquetas</h2><p className="mt-2 text-sm text-[#626f86]">Selecione, renomeie ou crie etiquetas.</p></div>
      {!editorOpen ? <>
        <label className="relative block">
          <Search size={18} className="absolute left-3 top-3 text-[#626f86]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar etiquetas..." className="min-h-11 w-full rounded-lg border border-[#8590a2] bg-white py-2.5 pl-10 pr-3 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4]" />
        </label>
        <div className="max-h-72 space-y-2 overflow-y-auto">
        {filteredLabels.map((label) => (
          <div key={label.id} className="group flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(() =>
                  send(
                    "/cards/" + card.id + "/labels/" + label.id + "/toggle",
                    "POST",
                  ),
                )
              }
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-[#f1f2f4] disabled:opacity-60"
            >
              <span className="flex min-h-10 min-w-0 flex-1 items-center rounded-lg px-4 font-semibold" style={{ background: labelColors[label.color] || label.color, color: labelTextColor(label.color) }}>{label.name || <span className="opacity-60">Sem nome</span>}</span>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">{selectedIds.has(label.id) && <Check size={18} />}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              title="Editar etiqueta"
              onClick={() => {
                setEditing(label);
                setName(label.name);
                setColor(label.color);
                setError("");
                setEditorOpen(true);
              }}
              className="rounded-lg p-2.5 text-[#626f86] hover:bg-[#e9eaed] hover:text-[#172b4d] focus:opacity-100"
            >
              <Pencil size={17} />
            </button>
          </div>
        ))}
        {filteredLabels.length === 0 && <p className="px-2 py-3 text-center text-[#626f86]">{query ? "Nenhuma etiqueta encontrada." : "Nenhuma etiqueta criada neste quadro."}</p>}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setEditing(null);
          setName("");
          setColor("green");
          setError("");
          setEditorOpen(true);
        }}
        className="min-h-11 w-full rounded-lg bg-[#e9eaed] py-2.5 text-sm font-semibold transition-colors hover:bg-[#dfe1e6] disabled:opacity-60"
      >
        Criar uma nova etiqueta
      </button>
      </> : <form onSubmit={save} className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">{editing ? "Editar etiqueta" : "Criar etiqueta"}</h3>
            <button type="button" onClick={closeEditor} aria-label="Voltar para etiquetas" className="rounded p-1 hover:bg-[#e9eaed]"><X size={16} /></button>
          </div>
          <div className="rounded-lg px-4 py-3 text-center text-sm font-semibold" style={{ background: labelColors[color] || color, color: labelTextColor(color) }}>{name.trim() || "Prévia da etiqueta"}</div>
          <label className="block font-semibold">
            Nome da etiqueta
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Digite um nome (opcional)"
              className="mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]"
            />
          </label>
          <fieldset>
            <legend className="mb-2 font-semibold">Selecione uma cor</legend>
            <div className="grid grid-cols-5 gap-2">
              {colors.map(([key, hex]) => (
                <button
                  type="button"
                  title={key}
                  aria-label={`Cor ${key}`}
                  aria-pressed={color === key}
                  key={key}
                  onClick={() => setColor(key)}
                  className={"h-10 rounded-lg " + (color === key ? "ring-2 ring-[#0c66e4] ring-offset-2" : "hover:brightness-90")}
                  style={{ background: hex }}
                />
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-[#ae2a19]">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            {editing ? <button type="button" disabled={busy} onClick={() => confirm({ title: "Excluir etiqueta", description: "Excluir esta etiqueta do quadro e removê-la dos cartões?", confirmLabel: "Excluir" }, async () => { const removed = await run(() => send("/boards/" + board.id + "/labels/" + editing.id, "DELETE")); if (removed) closeEditor(); })} className="inline-flex items-center gap-1 rounded px-2 py-2 text-[#ae2a19] hover:bg-[#ffebe6]"><Trash2 size={14} />Excluir</button> : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={closeEditor} className="min-h-11 rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#f1f2f4]">Cancelar</button>
              <button disabled={busy} className="min-h-11 rounded-lg bg-[#0c66e4] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                {editing ? "Salvar" : "Criar e adicionar"}
              </button>
            </div>
          </div>
        </form>}
    </div>
    {confirmationModal}
    </Modal>
    </>
  );
}

export function CardMembersPanel({
  board,
  card,
  run,
}: {
  board: Board;
  card: Card;
  run: Run;
}) {
  return (
    <div className="space-y-1 text-xs">
      {board.members?.map((member) => (
        <button
          key={member.id}
          onClick={() =>
            void run(() =>
              send(
                "/cards/" + card.id + "/assignees/" + member.id + "/toggle",
                "POST",
              ),
            )
          }
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[#f1f2f4]"
        >
          <Avatar name={member.name} url={member.avatar_url} size="sm" />
          <span className="min-w-0 flex-1 truncate">{member.name}</span>
          {card.assignees?.some((current) => current.id === member.id) && (
            <Check size={15} />
          )}
        </button>
      ))}
    </div>
  );
}
