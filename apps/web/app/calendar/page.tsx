"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Unlink,
  Users,
} from "lucide-react";
import {
  api,
  Board,
  CalendarItem,
  CalendarSource,
  cardUrl,
  getToken,
  send,
  User,
} from "@/lib/api";
import { AppHeader, Modal, useConfirmModal } from "@/components/ui";

type View = "month" | "week" | "day" | "agenda" | "timeline";
type CalendarProvider = {id:string;name:string;connectable:boolean;connectOptions?:Array<{id:string;label:string}>};
const views: Record<View, string> = {
  month: "Mês",
  week: "Semana",
  day: "Dia",
  agenda: "Agenda",
  timeline: "Timeline",
};
const dayMs = 86400000;
const floorDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * dayMs);
const eventColor = (source?: CalendarSource) => source?.color || "#0c66e4";
const sourceGroup = (source: CalendarSource) =>
  source.provider_id === "orbit_cards"
    ? "Orbit"
    : source.connection_name || source.provider_id;
const readable = (date: string, allDay = false) =>
  new Date(date).toLocaleString(
    "pt-BR",
    allDay
      ? { dateStyle: "long" }
      : { dateStyle: "medium", timeStyle: "short" },
  );

function range(view: View, anchor: Date) {
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1),
      start = addDays(first, -first.getDay());
    return { start, end: addDays(start, 42) };
  }
  if (view === "week") {
    const start = addDays(floorDay(anchor), -anchor.getDay());
    return { start, end: addDays(start, 7) };
  }
  if (view === "day")
    return { start: floorDay(anchor), end: addDays(floorDay(anchor), 1) };
  return { start: floorDay(anchor), end: addDays(floorDay(anchor), 30) };
}

export default function CalendarPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null),
    [boards, setBoards] = useState<Board[]>([]),
    [sources, setSources] = useState<CalendarSource[]>([]),
    [providers,setProviders]=useState<CalendarProvider[]>([]),
    [items, setItems] = useState<CalendarItem[]>([]),
    [providerMenu,setProviderMenu]=useState(false),
    [view, setView] = useState<View>("month"),
    [anchor, setAnchor] = useState(new Date()),
    [selected, setSelected] = useState<CalendarItem | null>(null),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [settingsSource, setSettingsSource] = useState<CalendarSource | null>(null);
  const { confirm, confirmationModal } = useConfirmModal();
  const current = useMemo(() => range(view, anchor), [view, anchor]);
  const load = useCallback(async () => {
    try {
      setError("");
      const [u, b, s, p] = await Promise.all([
        api<User>("/auth/me"),
        api<Board[]>("/boards"),
        api<CalendarSource[]>("/calendar/sources"),
        api<CalendarProvider[]>("/calendar/catalog"),
      ]);
      setUser(u);
      setBoards(b);
      setSources(s);
      setProviders(p);
      const visible = s.filter((x) => x.selected && x.visible).map((x) => x.id);
      setItems(
        await api<CalendarItem[]>(
          `/calendar/items?start=${encodeURIComponent(current.start.toISOString())}&end=${encodeURIComponent(current.end.toISOString())}&sources=${visible.join(",")}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [current.end, current.start]);
  useEffect(() => {
    if (!getToken()) {
      router.push("/");
      return;
    }
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, router]);
  async function sourceChange(
    source: CalendarSource,
    body: Record<string, unknown>,
  ) {
    try {
      setSources(
        await send<CalendarSource[]>(
          `/calendar/sources/${source.id}`,
          "PATCH",
          body,
        ),
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(direction: number) {
    const amount =
      view === "month" ? 32 : view === "week" ? 7 : view === "day" ? 1 : 30;
    setAnchor(addDays(anchor, direction * amount));
  }
  async function connectProvider(providerId:string,option?:string) {
    try {
      const { url } = await api<{ url: string }>(
        `/calendar/providers/${providerId}/connect${option?`?option=${encodeURIComponent(option)}`:''}`,
      );
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function drop(item: CalendarItem, date: Date) {
    const oldStart = new Date(item.start),
      duration = item.end
        ? new Date(item.end).getTime() - oldStart.getTime()
        : 3600000;
    const next = new Date(date);
    if (!item.allDay) next.setHours(oldStart.getHours(), oldStart.getMinutes());
    try {
      setItems((value) =>
        value.map((x) =>
          x.id === item.id
            ? {
                ...x,
                start: next.toISOString(),
                end: new Date(next.getTime() + duration).toISOString(),
              }
            : x,
        ),
      );
      if (item.resourceType === "card")
        await send(`/cards/${item.cardId}`, "PATCH", {
          schedule_start_at: next.toISOString(),
          schedule_end_at: new Date(next.getTime() + duration).toISOString(),
        });
      else
        await send(`/calendar/items/${item.id}`, "PATCH", {
          start: next.toISOString(),
          end: new Date(next.getTime() + duration).toISOString(),
        });
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    }
  }
  const title =
    view === "month"
      ? anchor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      : `${current.start.toLocaleDateString("pt-BR")} — ${addDays(current.end, -1).toLocaleDateString("pt-BR")}`;
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <AppHeader user={user} boards={boards} />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-[#dfe1e6] bg-white p-4 lg:block">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Calendários</h2>
            <button
              onClick={() => setProviderMenu(!providerMenu)}
              title="Conectar calendário"
              className="rounded bg-[#e9f2ff] p-1.5 text-[#0c66e4]"
            >
              <Plus size={16} />
            </button>
          </div>
          {providerMenu&&<div className="mt-2 rounded border border-[#dfe1e6] bg-white p-2 shadow-sm">{providers.filter(item=>item.connectable).flatMap(provider=>provider.connectOptions?.length?provider.connectOptions.map(option=><button key={`${provider.id}:${option.id}`} onClick={()=>void connectProvider(provider.id,option.id)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#f1f2f4]">{option.label}</button>):[<button key={provider.id} onClick={()=>void connectProvider(provider.id)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#f1f2f4]">Conectar {provider.name}</button>])}</div>}
          <div className="mt-4 space-y-5">
            {Array.from(new Set(sources.map(sourceGroup))).map((group) => (
              <section key={group}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-bold text-[#626f86]">{group}</p>
                  <span className="flex gap-2 text-[10px]">
                    <button
                      onClick={() =>
                        void Promise.all(
                          sources
                            .filter((s) => sourceGroup(s) === group)
                            .map((s) =>
                              sourceChange(s, {
                                selected: true,
                                visible: true,
                              }),
                            ),
                        )
                      }
                    >
                      todos
                    </button>
                    <button
                      onClick={() =>
                        void Promise.all(
                          sources
                            .filter((s) => sourceGroup(s) === group)
                            .map((s) => sourceChange(s, { visible: false })),
                        )
                      }
                    >
                      limpar
                    </button>
                  </span>
                </div>
                {sources
                  .filter((s) => sourceGroup(s) === group)
                  .map((source) => (
                    <div key={source.id} className="mb-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={source.selected && source.visible}
                          onChange={(e) =>
                            void sourceChange(source, {
                              selected: e.target.checked,
                              visible: e.target.checked,
                            })
                          }
                        />
                        <span
                          className="h-3 w-3 rounded-full border"
                          style={{ background: eventColor(source) }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {source.name}
                        </span>
                        <input
                          type="radio"
                          name="default-calendar"
                          title="Calendário padrão"
                          checked={source.is_default}
                          onChange={() =>
                            void sourceChange(source, { is_default: true })
                          }
                        />
                      </label>
                      {source.provider_id !== "orbit_cards" &&
                        source.selected && (
                          <div className="ml-8 mt-1 flex gap-3">
                            <button
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await send(
                                    `/calendar/sources/${source.id}/sync`,
                                    "POST",
                                  );
                                  await load();
                                } catch (e) {
                                  setError((e as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="flex items-center gap-1 text-[11px] text-[#0c66e4]"
                            >
                              <RefreshCw
                                size={11}
                                className={busy ? "animate-spin" : ""}
                              />{" "}
                              sincronizar
                            </button>
                            <button
                              onClick={() => setSettingsSource(source)}
                              className="flex items-center gap-1 text-[11px] text-[#44546f]"
                            >
                              <Settings size={11} /> espelho
                            </button>
                          </div>
                        )}
                    </div>
                  ))}
              </section>
            ))}
          </div>
          {providers.filter(provider=>provider.connectable).map(provider=><button key={provider.id} onClick={() => void connectProvider(provider.id)} className="mt-3 w-full rounded border border-[#0c66e4] px-3 py-2 text-sm font-semibold text-[#0c66e4]">Conectar {provider.name}</button>)}
        </aside>
        <main className="min-w-0 flex-1 p-3 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h1 className="mr-auto flex items-center gap-2 text-xl font-bold">
              <CalendarDays className="text-[#0c66e4]" /> Calendário
            </h1>
            <button
              onClick={() => setAnchor(new Date())}
              className="rounded border bg-white px-3 py-1.5 text-sm"
            >
              Hoje
            </button>
            <button
              onClick={() => navigate(-1)}
              className="rounded p-2 hover:bg-white"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => navigate(1)}
              className="rounded p-2 hover:bg-white"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={() => setCreating(true)}
              className="rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white"
            >
              <Plus size={15} className="mr-1 inline" />
              Evento
            </button>
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="capitalize font-semibold">{title}</h2>
            <div className="flex rounded bg-[#e9eaed] p-1">
              {Object.entries(views).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key as View)}
                  className={`rounded px-2.5 py-1.5 text-xs font-semibold ${view === key ? "bg-white text-[#0c66e4] shadow-sm" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div
              role="alert"
              className="mb-3 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]"
            >
              {error}
            </div>
          )}
          <CalendarView
            view={view}
            start={current.start}
            end={current.end}
            items={items}
            sources={sources}
            choose={setSelected}
            drop={drop}
          />
        </main>
      </div>
      {selected && (
        <EventDetail
          item={selected}
          source={sources.find((s) => s.id === selected.sourceId)}
          boards={boards}
          close={() => setSelected(null)}
          changed={async () => {
            setSelected(null);
            await load();
          }}
          confirm={confirm}
        />
      )}{" "}
      {creating && (
        <EventForm
          sources={sources.filter((s) => s.capabilities?.create)}
          close={() => setCreating(false)}
          changed={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {settingsSource && (
        <SourceSettings
          source={settingsSource}
          boards={boards}
          close={() => setSettingsSource(null)}
          changed={async () => {
            setSettingsSource(null);
            await load();
          }}
        />
      )}
      {confirmationModal}
    </div>
  );
}

function ItemButton({
  item,
  source,
  choose,
}: {
  item: CalendarItem;
  source?: CalendarSource;
  choose: (item: CalendarItem) => void;
}) {
  return (
    <button
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("application/x-orbit-calendar-item", item.id)
      }
      onClick={() => choose(item)}
      className="mb-1 block w-full truncate rounded px-1.5 py-1 text-left text-[11px] font-semibold text-white shadow-sm"
      style={{ background: eventColor(source) }}
      title={item.title}
    >
      {!item.allDay &&
        new Date(item.start).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }) + " "}
      {item.title}
    </button>
  );
}
function CalendarView({
  view,
  start,
  end,
  items,
  sources,
  choose,
  drop,
}: {
  view: View;
  start: Date;
  end: Date;
  items: CalendarItem[];
  sources: CalendarSource[];
  choose: (item: CalendarItem) => void;
  drop: (item: CalendarItem, date: Date) => void;
}) {
  const days = Array.from(
    { length: Math.round((end.getTime() - start.getTime()) / dayMs) },
    (_, i) => addDays(start, i),
  );
  const source = (id: string) => sources.find((s) => s.id === id);
  const dayItems = (day: Date) =>
    items.filter((item) => isoDate(new Date(item.start)) === isoDate(day));
  if (view === "agenda")
    return (
      <div className="space-y-3">
        {days.map(
          (day) =>
            dayItems(day).length > 0 && (
              <section
                key={isoDate(day)}
                className="rounded-xl border bg-white"
              >
                <h3 className="border-b px-4 py-2 text-sm font-bold capitalize">
                  {day.toLocaleDateString("pt-BR", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                  })}
                </h3>
                {dayItems(day).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => choose(item)}
                    className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-0"
                  >
                    <span
                      className="h-9 w-1 rounded"
                      style={{ background: eventColor(source(item.sourceId)) }}
                    />
                    <Clock3 size={16} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm">{item.title}</b>
                      <span className="text-xs text-[#626f86]">
                        {readable(item.start, item.allDay)}
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            ),
        )}
      </div>
    );
  if (view === "timeline")
    return (
      <div className="overflow-x-auto rounded-xl border bg-white">
        <div
          className="grid min-w-[900px]"
          style={{
            gridTemplateColumns: `180px repeat(${Math.min(days.length, 14)},1fr)`,
          }}
        >
          <div className="border-b p-3 font-bold">Fonte</div>
          {days.slice(0, 14).map((day) => (
            <div
              key={isoDate(day)}
              className="border-b border-l p-2 text-center text-xs font-bold"
            >
              {day.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
              })}
            </div>
          ))}
          {sources
            .filter((s) => s.visible)
            .map((s) => (
              <div key={s.id} className="contents">
                <div className="border-b p-3 text-sm">
                  <span
                    className="mr-2 inline-block h-3 w-3 rounded-full"
                    style={{ background: eventColor(s) }}
                  />
                  {s.name}
                </div>
                {days.slice(0, 14).map((day) => (
                  <div
                    key={s.id + isoDate(day)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const item = items.find(
                        (x) =>
                          x.id ===
                          e.dataTransfer.getData(
                            "application/x-orbit-calendar-item",
                          ),
                      );
                      if (item) void drop(item, day);
                    }}
                    className="min-h-16 border-b border-l p-1"
                  >
                    {dayItems(day)
                      .filter((item) => item.sourceId === s.id)
                      .map((item) => (
                        <ItemButton
                          key={item.id}
                          item={item}
                          source={s}
                          choose={choose}
                        />
                      ))}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    );
  return (
    <div
      className={`grid overflow-hidden rounded-xl border bg-white ${view === "month" ? "grid-cols-7" : view === "week" ? "grid-cols-7" : "grid-cols-1"}`}
    >
      {days.map((day) => (
        <div
          key={isoDate(day)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const item = items.find(
              (x) =>
                x.id ===
                e.dataTransfer.getData("application/x-orbit-calendar-item"),
            );
            if (item) void drop(item, day);
          }}
          className={`border-b border-r p-1.5 ${view === "month" ? "min-h-28" : view === "week" ? "min-h-[560px]" : "min-h-[650px]"}`}
        >
          <div
            className={`mb-2 text-xs font-bold ${isoDate(day) === isoDate(new Date()) ? "text-[#0c66e4]" : ""}`}
          >
            {day.toLocaleDateString("pt-BR", {
              weekday: view === "day" ? "long" : "short",
              day: "2-digit",
              month: view === "day" ? "long" : undefined,
            })}
          </div>
          {dayItems(day).map((item) => (
            <ItemButton
              key={item.id}
              item={item}
              source={source(item.sourceId)}
              choose={choose}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EventForm({
  sources,
  close,
  changed,
}: {
  sources: CalendarSource[];
  close: () => void;
  changed: () => Promise<void>;
}) {
  const [source, setSource] = useState(
      sources.find((s) => s.is_default)?.id || sources[0]?.id || "",
    ),
    [title, setTitle] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [allDay, setAllDay] = useState(false),
    [description, setDescription] = useState(""),
    [location, setLocation] = useState(""),
    [attendees, setAttendees] = useState(""),
    [recurrence, setRecurrence] = useState(""),
    [conference, setConference] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await send(`/calendar/sources/${source}/items`, "POST", {
              title,
              start: new Date(start).toISOString(),
              end: end ? new Date(end).toISOString() : undefined,
              allDay,
              description,
              location,
              attendees: attendees
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean)
                .map((email) => ({ email })),
              recurrence: recurrence ? [recurrence] : [],
              conference,
            });
            await changed();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        className="space-y-3 p-6"
      >
        <h2 className="pr-8 text-lg font-bold">Novo evento</h2>
        <select
          required
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full rounded border p-2"
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.connection_name ? `${s.connection_name} · ` : ""}
              {s.name}
            </option>
          ))}
        </select>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título"
          className="w-full rounded border p-2"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            required
            type={allDay ? "date" : "datetime-local"}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded border p-2"
          />
          <input
            type={allDay ? "date" : "datetime-local"}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded border p-2"
          />
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          Dia inteiro
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição"
          className="min-h-20 w-full rounded border p-2"
        />
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Local"
          className="w-full rounded border p-2"
        />
        <input
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          placeholder="Convidados, separados por vírgula"
          className="w-full rounded border p-2"
        />
        <input
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
          placeholder="RRULE:FREQ=WEEKLY (opcional)"
          className="w-full rounded border p-2"
        />
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={conference}
            onChange={(e) => setConference(e.target.checked)}
          />
          Criar videoconferência quando suportado
        </label>
        {error && <p className="text-sm text-[#ae2a19]">{error}</p>}
        <button
          disabled={!source}
          className="w-full rounded bg-[#0c66e4] p-2 font-semibold text-white"
        >
          Criar evento
        </button>
      </form>
    </Modal>
  );
}

function SourceSettings({
  source,
  boards,
  close,
  changed,
}: {
  source: CalendarSource;
  boards: Board[];
  close: () => void;
  changed: () => Promise<void>;
}) {
  const settings = source.settings || {};
  const [auto, setAuto] = useState(Boolean(settings.auto_create_cards)),
    [updates, setUpdates] = useState(Boolean(settings.update_linked_cards)),
    [archive, setArchive] = useState(Boolean(settings.archive_cancelled_cards)),
    [strategy, setStrategy] = useState(
      String(settings.recurring_strategy || "series"),
    ),
    [board, setBoard] = useState(
      String(settings.target_board_id || boards[0]?.id || ""),
    ),
    [lists, setLists] = useState<Board["lists"]>([]),
    [list, setList] = useState(String(settings.target_list_id || "")),
    [error, setError] = useState("");
  useEffect(() => {
    if (!board) return;
    api<Board>(`/boards/${board}`)
      .then((value) => {
        setLists(value.lists || []);
        setList((current) => current || value.lists?.[0]?.id || "");
      })
      .catch((e) => setError((e as Error).message));
  }, [board]);
  return (
    <Modal onClose={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await send(`/calendar/sources/${source.id}`, "PATCH", {
              auto_create_cards: auto,
              target_board_id: auto ? board : null,
              target_list_id: auto ? list : null,
              update_linked_cards: updates,
              archive_cancelled_cards: archive,
              recurring_strategy: strategy,
            });
            await changed();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        className="space-y-4 p-6"
      >
        <h2 className="pr-8 text-lg font-bold">
          Espelho de eventos · {source.name}
        </h2>
        <p className="text-sm text-[#626f86]">
          Desativado por padrão. O vínculo usa ExternalResource e mantém
          workflow, etiquetas, responsáveis e automações sob autoridade do
          Orbit.
        </p>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          Criar Cards automaticamente para novos eventos
        </label>
        {auto && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-bold">
              Quadro
              <select
                value={board}
                onChange={(e) => {
                  setBoard(e.target.value);
                  setList("");
                }}
                className="mt-1 w-full rounded border p-2 text-sm"
              >
                {boards.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold">
              Lista
              <select
                value={list}
                onChange={(e) => setList(e.target.value)}
                className="mt-1 w-full rounded border p-2 text-sm"
              >
                {lists?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={updates}
            onChange={(e) => setUpdates(e.target.checked)}
          />
          Atualizar título, descrição e agenda dos Cards vinculados
        </label>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={archive}
            onChange={(e) => setArchive(e.target.checked)}
          />
          Arquivar Card quando o evento for cancelado
        </label>
        <label className="block text-xs font-bold">
          Eventos recorrentes
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="mt-1 w-full rounded border p-2 text-sm"
          >
            <option value="series">Um Card para toda a série (padrão)</option>
            <option value="occurrence">Um Card por ocorrência</option>
          </select>
        </label>
        {error && <p className="text-sm text-[#ae2a19]">{error}</p>}
        <button className="w-full rounded bg-[#0c66e4] p-2 font-semibold text-white">
          Salvar configuração
        </button>
      </form>
    </Modal>
  );
}

function EventDetail({
  item,
  source,
  boards,
  close,
  changed,
  confirm,
}: {
  item: CalendarItem;
  source?: CalendarSource;
  boards: Board[];
  close: () => void;
  changed: () => Promise<void>;
  confirm: (
    options: {
      title: string;
      description: string;
      confirmLabel?: string;
      destructive?: boolean;
    },
    action: () => Promise<void>,
  ) => void;
}) {
  const router = useRouter();
  const conference = item.conference && typeof item.conference === 'object' ? item.conference as {joinUrl?:string;provider?:string} : null;
  const [linking, setLinking] = useState(false),
    [editing, setEditing] = useState(false),
    [editTitle, setEditTitle] = useState(item.title),
    [editDescription, setEditDescription] = useState(item.description || ""),
    [editLocation, setEditLocation] = useState(item.location || ""),
    [editStart, setEditStart] = useState(item.start.slice(0, 16)),
    [editEnd, setEditEnd] = useState((item.end || item.start).slice(0, 16)),
    [board, setBoard] = useState(boards[0]?.id || ""),
    [boardData, setBoardData] = useState<Board | null>(null),
    [list, setList] = useState(""),
    [existingCard, setExistingCard] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (board)
      api<Board>(`/boards/${board}`)
        .then((value) => {
          setBoardData(value);
          setList(value.lists?.[0]?.id || "");
          setExistingCard(
            value.lists?.flatMap((group) => group.cards)[0]?.id || "",
          );
        })
        .catch((e) => setError((e as Error).message));
  }, [board]);
  const resize = async (minutes: number) => {
    if (item.resourceType === "card") return;
    const end = new Date(
      item.end || new Date(new Date(item.start).getTime() + 3600000),
    );
    end.setMinutes(end.getMinutes() + minutes);
    await send(`/calendar/items/${item.id}`, "PATCH", {
      end: end.toISOString(),
    });
    await changed();
  };
  return (
    <Modal onClose={close} wide>
      <div className="p-6">
        <div className="pr-8">
          <p
            className="text-xs font-bold"
            style={{ color: eventColor(source) }}
          >
            {source?.name}
          </p>
          <h2 className="mt-1 text-xl font-bold">{item.title}</h2>
        </div>
        <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p>
              <CalendarDays size={15} className="mr-2 inline" />
              {readable(item.start, item.allDay)}
              {item.end && ` — ${readable(item.end, item.allDay)}`}
            </p>
            {item.timeZone && (
              <p className="mt-2 text-[#626f86]">Fuso: {item.timeZone}</p>
            )}
            {item.location && <p className="mt-2">Local: {item.location}</p>}
            {Boolean(item.attendees?.length) && (
              <p className="mt-2">
                <Users size={15} className="mr-2 inline" />
                {item.attendees?.length} convidado(s)
              </p>
            )}
            {Boolean(item.recurrence?.length) && (
              <p className="mt-2">
                Recorrência: {String(item.recurrence?.join(", "))}
              </p>
            )}
          </div>
          <div>
            {item.description && (
              <p className="whitespace-pre-wrap text-[#44546f]">
                {item.description}
              </p>
            )}
            {Boolean(item.conference) && (
              <p className="mt-2">Conferência disponível</p>
            )}
            {conference?.joinUrl&&<a href={conference.joinUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded bg-[#e9f2ff] px-3 py-2 text-sm font-semibold text-[#0c66e4]">Entrar na reunião{conference.provider==='microsoft_teams'?' Teams':''}</a>}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {item.resourceType === "event" && (
            <button
              onClick={() => setEditing(!editing)}
              className="rounded bg-[#e9eaed] px-3 py-2 text-sm"
            >
              Editar
            </button>
          )}
          {item.externalUrl && (
            <a
              href={item.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded bg-[#e9f2ff] px-3 py-2 text-sm font-semibold text-[#0c66e4]"
            >
              <ExternalLink size={14} className="mr-1 inline" />
              Abrir no provider
            </a>
          )}
          {item.cardId ? (
            <>
              <button
                onClick={() =>
                  router.push(
                    cardUrl(String(item.metadata.boardId || ""), item.cardId),
                  )
                }
                className="rounded bg-[#e9eaed] px-3 py-2 text-sm"
              >
                Abrir Card
              </button>
              {item.resourceType === "event" && (
                <button
                  onClick={() =>
                    void send(
                      `/calendar/items/${item.id}/link-card`,
                      "DELETE",
                    ).then(changed)
                  }
                  className="rounded bg-[#e9eaed] px-3 py-2 text-sm"
                >
                  <Unlink size={14} className="mr-1 inline" />
                  Desvincular
                </button>
              )}
            </>
          ) : (
            item.resourceType === "event" && (
              <button
                onClick={() => setLinking(!linking)}
                className="rounded bg-[#e9eaed] px-3 py-2 text-sm"
              >
                <Link2 size={14} className="mr-1 inline" />
                Criar ou vincular Card
              </button>
            )
          )}
          {item.resourceType === "event" && (
            <>
              <button
                onClick={() =>
                  void resize(30).catch((e) => setError((e as Error).message))
                }
                className="rounded bg-[#e9eaed] px-3 py-2 text-sm"
              >
                +30 min
              </button>
              <button
                onClick={() =>
                  void resize(-30).catch((e) => setError((e as Error).message))
                }
                className="rounded bg-[#e9eaed] px-3 py-2 text-sm"
              >
                −30 min
              </button>
              <button
                onClick={() =>
                  confirm(
                    {
                      title: "Excluir evento?",
                      description:
                        "O evento será cancelado no provider e reconciliado no mirror local.",
                      confirmLabel: "Excluir",
                    },
                    async () => {
                      await send(`/calendar/items/${item.id}`, "DELETE");
                      await changed();
                    },
                  )
                }
                className="rounded bg-[#ffebe6] px-3 py-2 text-sm text-[#ae2a19]"
              >
                <Trash2 size={14} className="mr-1 inline" />
                Excluir
              </button>
            </>
          )}
        </div>
        {editing && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await send(`/calendar/items/${item.id}`, "PATCH", {
                  title: editTitle,
                  description: editDescription,
                  location: editLocation,
                  start: new Date(editStart).toISOString(),
                  end: new Date(editEnd).toISOString(),
                });
                await changed();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
            className="mt-4 grid gap-2 rounded border bg-[#f7f8fa] p-3 sm:grid-cols-2"
          >
            <input
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="rounded border p-2 sm:col-span-2"
            />
            <input
              type="datetime-local"
              required
              value={editStart}
              onChange={(e) => setEditStart(e.target.value)}
              className="rounded border p-2"
            />
            <input
              type="datetime-local"
              required
              value={editEnd}
              onChange={(e) => setEditEnd(e.target.value)}
              className="rounded border p-2"
            />
            <input
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              placeholder="Local"
              className="rounded border p-2 sm:col-span-2"
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Descrição"
              className="min-h-20 rounded border p-2 sm:col-span-2"
            />
            <button className="rounded bg-[#0c66e4] p-2 font-semibold text-white sm:col-span-2">
              Salvar alterações
            </button>
          </form>
        )}
        {linking && (
          <div className="mt-4 rounded border bg-[#f7f8fa] p-3">
            <p className="mb-2 text-sm font-bold">
              Criar Card a partir do evento
            </p>
            <select
              value={board}
              onChange={(e) => setBoard(e.target.value)}
              className="mr-2 rounded border p-2 text-sm"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            <select
              value={list}
              onChange={(e) => setList(e.target.value)}
              className="mr-2 rounded border p-2 text-sm"
            >
              {boardData?.lists?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
            <button
              onClick={async () => {
                try {
                  await send(`/calendar/items/${item.id}/link-card`, "POST", {
                    list_id: list,
                    import: { title: true, description: true },
                  });
                  await changed();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              className="rounded bg-[#0c66e4] px-3 py-2 text-sm text-white"
            >
              Criar Card
            </button>
            <div className="mt-3 flex gap-2 border-t pt-3">
              <select
                value={existingCard}
                onChange={(e) => setExistingCard(e.target.value)}
                className="min-w-0 flex-1 rounded border p-2 text-sm"
              >
                <option value="">Selecione um Card existente</option>
                {boardData?.lists?.flatMap((group) =>
                  group.cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {group.title} · {card.title}
                    </option>
                  )),
                )}
              </select>
              <button
                disabled={!existingCard}
                onClick={async () => {
                  try {
                    await send(`/calendar/items/${item.id}/link-card`, "POST", {
                      card_id: existingCard,
                    });
                    await changed();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
                className="rounded bg-[#e9eaed] px-3 py-2 text-sm disabled:opacity-50"
              >
                Vincular existente
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-[#ae2a19]">{error}</p>}
      </div>
    </Modal>
  );
}
