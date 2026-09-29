"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, CreditCard, Link2, Plus, Unlink } from "lucide-react";
import { api, Board, cardUrl, getToken, send, User } from "@/lib/api";
import { AppHeader, Modal, WorkspaceSidebar } from "@/components/ui";

type PlannerCard = { id: string; title: string; due_date: string; completed: boolean; board_id: string; board_title: string; list_title: string };
type LinkedCard = Pick<PlannerCard, "id" | "title" | "board_id">;
type FocusEvent = { id: string; title: string; starts_at: string; ends_at: string; cards: LinkedCard[] };

const weekdays = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}
function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
function time(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function dateTimeInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function Planner() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [cards, setCards] = useState<PlannerCard[]>([]);
  const [events, setEvents] = useState<FocusEvent[]>([]);
  const [board, setBoard] = useState("");
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async (boardId: string) => {
    try {
      const [data, all, account] = await Promise.all([
        api<{ cards?: PlannerCard[]; events?: FocusEvent[] }>(`/planner${boardId ? `?board_id=${encodeURIComponent(boardId)}` : ""}`),
        api<Board[]>("/boards"),
        api<User>("/auth/me"),
      ]);
      setCards(Array.isArray(data.cards) ? data.cards : []);
      setEvents(Array.isArray(data.events) ? data.events : []);
      setBoards(all);
      setUser(account);
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) { router.push("/"); return; }
    const timer = window.setTimeout(() => void load(""), 0);
    return () => window.clearTimeout(timer);
  }, [load, router]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week]);
  const weekEvents = events.filter((event) => days.some((day) => sameDay(new Date(event.starts_at), day)));
  const weekCards = cards.filter((card) => days.some((day) => sameDay(new Date(card.due_date), day)));
  const weekLabel = `${week.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}`;

  function openCreate(day = new Date(), card?: PlannerCard) {
    const now = new Date();
    const hour = sameDay(day, now) ? Math.max(9, now.getHours() + 1) : 9;
    const nextStart = hour < 24
      ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour)
      : new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 9);
    setTitle(card ? `Foco: ${card.title}` : "");
    setSelectedCard(card?.id || "");
    setStart(dateTimeInput(nextStart));
    setEnd(dateTimeInput(new Date(nextStart.getTime() + 3600000)));
    setError("");
    setCreating(true);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!start || !end || new Date(end) <= new Date(start)) { setError("O término precisa ser depois do início."); return; }
    setSaving(true);
    try {
      await send("/planner/focus-events", "POST", {
        title: title.trim() || "Tempo de foco",
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(end).toISOString(),
        card_id: selectedCard || undefined,
      });
      setCreating(false);
      await load(board);
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }
  async function changeLink(eventId: string, cardId: string, method: "POST" | "DELETE") {
    if (!cardId) return;
    try {
      await send(`/planner/focus-events/${eventId}/cards/${cardId}`, method);
      await load(board);
      setLinkTargets((current) => ({ ...current, [eventId]: "" }));
    } catch (reason) { setError((reason as Error).message); }
  }

  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
    <AppHeader user={user} boards={boards} />
    <div className="flex min-h-0 flex-1">
    <WorkspaceSidebar boards={boards} onCreate={() => router.push("/boards?create=1")} onChoose={(id) => router.push(id ? `/board/${id}` : "/boards")} />
    <main className="mx-auto w-full min-w-0 max-w-[1400px] px-4 py-7 sm:px-7 lg:px-9">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div><p className="mb-1 text-xs font-bold uppercase tracking-[.12em] text-[#626f86]">PLANEJAMENTO</p>
          <h1 className="flex items-center gap-2.5 text-[27px] font-bold tracking-tight sm:text-[31px]"><CalendarClock size={25} className="text-[#0c66e4]" /> Planner</h1>
          <p className="mt-1 text-sm text-[#626f86]">Organize seus blocos de foco e acompanhe os próximos prazos.</p></div>
        <button onClick={() => openCreate()} className="flex items-center gap-2 rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0055cc]"><Plus size={17} /> Reservar tempo</button>
      </div>
      {error && !creating && <p role="alert" className="mb-4 rounded border border-[#ffbdad] bg-[#ffebe6] px-4 py-3 text-sm text-[#ae2a19]">{error}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm" aria-label="Planejamento da semana">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe1e6] px-5 py-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeek(startOfWeek(new Date()))} className="rounded border border-[#dfe1e6] px-3 py-1.5 text-sm font-semibold hover:bg-[#f1f2f4]">Hoje</button>
              <button onClick={() => setWeek(addDays(week, -7))} aria-label="Semana anterior" className="rounded p-1.5 hover:bg-[#f1f2f4]"><ChevronLeft size={19} /></button>
              <button onClick={() => setWeek(addDays(week, 7))} aria-label="Próxima semana" className="rounded p-1.5 hover:bg-[#f1f2f4]"><ChevronRight size={19} /></button>
              <h2 className="ml-1 text-sm font-bold sm:text-base">{weekLabel}</h2>
            </div>
            <span className="text-xs text-[#626f86]">{weekEvents.length} {weekEvents.length === 1 ? "bloco" : "blocos"} de foco · {weekCards.length} {weekCards.length === 1 ? "prazo" : "prazos"}</span>
          </div>
          <div className="scrollbar-thin overflow-x-auto"><div className="grid min-w-[770px] grid-cols-7 divide-x divide-[#dfe1e6]">
            {days.map((day, index) => {
              const dayEvents = events.filter((event) => sameDay(new Date(event.starts_at), day)).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
              const dayCards = cards.filter((card) => sameDay(new Date(card.due_date), day));
              const today = sameDay(day, new Date());
              return <div key={day.toISOString()} className="min-h-[390px] bg-white">
                <div className={`flex items-center justify-between border-b border-[#dfe1e6] px-2 py-3 ${today ? "bg-[#e9f2ff]" : ""}`}>
                  <div><p className="text-[11px] font-semibold uppercase text-[#626f86]">{weekdays[index]}</p><p className={`mt-1 text-lg font-bold ${today ? "text-[#0c66e4]" : ""}`}>{day.getDate()}</p></div>
                  <button onClick={() => openCreate(day)} aria-label={`Reservar tempo em ${weekdays[index]}`} className="rounded p-1 text-[#626f86] hover:bg-white hover:text-[#0c66e4]"><Plus size={15} /></button>
                </div>
                <div className="space-y-2 p-2">
                  {dayEvents.map((event) => <div key={event.id} className="rounded border border-[#b3d4ff] bg-[#e9f2ff] p-2 text-xs">
                    <p className="mb-1 flex items-center gap-1 font-semibold text-[#0c66e4]"><Clock3 size={12} />{time(event.starts_at)}–{time(event.ends_at)}</p>
                    <p className="break-words font-semibold">{event.title}</p>
                    {event.cards?.length > 0 && <p className="mt-1 text-[11px] text-[#44546f]">{event.cards.map((card) => card.title).join(", ")}</p>}
                  </div>)}
                  {dayCards.map((card) => <button key={card.id} onClick={() => router.push(cardUrl(card.board_id, card.id))} className="w-full rounded border border-[#dfe1e6] bg-[#f7f8fa] p-2 text-left text-xs hover:border-[#0c66e4]" title={`Abrir cartão ${card.title}`}>
                    <p className="mb-1 flex items-center gap-1 text-[11px] text-[#626f86]"><CreditCard size={12} />Prazo · {time(card.due_date)}</p>
                    <p className={`break-words font-semibold ${card.completed ? "line-through opacity-60" : ""}`}>{card.title}</p>
                  </button>)}
                  {dayEvents.length === 0 && dayCards.length === 0 && <button onClick={() => openCreate(day)} className="mt-2 w-full rounded border border-dashed border-[#dfe1e6] px-1 py-3 text-[11px] text-[#626f86] hover:border-[#0c66e4] hover:text-[#0c66e4]">+ Reservar foco</button>}
                </div>
              </div>;
            })}
          </div></div>
        </section>
        <aside className="space-y-6">
          <section className="rounded-xl border border-[#dfe1e6] bg-white p-5 shadow-sm">
            <label htmlFor="planner-board" className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[#626f86]">Quadro</label>
            <select id="planner-board" value={board} onChange={(event) => { setBoard(event.target.value); void load(event.target.value); }} className="w-full rounded border border-[#8590a2] bg-white px-3 py-2 text-sm">
              <option value="">Todos os quadros</option>{boards.filter((item) => !item.is_inbox).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </section>
          <section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm">
            <div className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-bold"><CreditCard size={19} className="text-[#0c66e4]" /> Cartões com prazo</h2>
            <p className="mt-1 text-xs text-[#626f86]">Prazos dos cartões acessíveis para você.</p></div>
            <div className="p-3">
            {cards.length === 0 ? <p className="rounded bg-[#f7f8fa] p-3 text-xs text-[#626f86]">Nenhum cartão com prazo encontrado.</p> : <div className="max-h-[390px] space-y-1 overflow-y-auto">
              {cards.slice(0, 12).map((card) => <div key={card.id} className="flex items-center gap-1 rounded px-2 py-2 hover:bg-[#f1f2f4]">
                <button onClick={() => router.push(cardUrl(card.board_id, card.id))} className="min-w-0 flex-1 text-left">
                  <p className={`truncate text-sm font-semibold ${card.completed ? "line-through opacity-60" : ""}`}>{card.title}</p>
                  <p className="mt-0.5 truncate text-xs text-[#626f86]">{card.board_title} · {new Date(card.due_date).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}</p>
                </button>
                <button onClick={() => openCreate(new Date(), card)} title={`Planejar ${card.title}`} aria-label={`Planejar ${card.title}`} className="rounded p-1.5 text-[#0c66e4] hover:bg-[#e9f2ff]"><CalendarClock size={16} /></button>
              </div>)}
            </div>}
            </div>
          </section>
        </aside>
      </div>

        {events.length > 0 && <section className="mt-6 rounded-xl border border-[#dfe1e6] bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-base font-bold">Blocos de foco</h2><p className="mb-4 text-xs text-[#626f86]">Vincule cartões ao tempo reservado para trabalhar neles.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{events.map((event) => <article key={event.id} className="rounded border border-[#dfe1e6] p-3">
          <p className="text-sm font-semibold">{event.title}</p>
          <p className="mt-1 text-xs text-[#626f86]">{new Date(event.starts_at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} · {time(event.starts_at)}–{time(event.ends_at)}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {event.cards?.map((card) => <span key={card.id} className="flex max-w-full items-center gap-1 rounded bg-[#f1f2f4] px-2 py-1 text-xs"><span className="truncate">{card.title}</span><button onClick={() => void changeLink(event.id, card.id, "DELETE")} title={`Desvincular ${card.title}`} aria-label={`Desvincular ${card.title}`}><Unlink size={13} /></button></span>)}
            {!event.cards?.length && <span className="text-xs text-[#626f86]">Nenhum cartão vinculado</span>}
          </div>
          {cards.length > 0 && <div className="mt-3 flex gap-2">
            <select aria-label={`Cartão para vincular a ${event.title}`} value={linkTargets[event.id] || ""} onChange={(change) => setLinkTargets((current) => ({ ...current, [event.id]: change.target.value }))} className="min-w-0 flex-1 rounded border border-[#8590a2] bg-white px-2 py-1.5 text-xs"><option value="">Escolher cartão</option>{cards.filter((card) => !event.cards?.some((linked) => linked.id === card.id)).map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</select>
            <button onClick={() => void changeLink(event.id, linkTargets[event.id], "POST")} disabled={!linkTargets[event.id]} aria-label={`Vincular cartão a ${event.title}`} className="rounded bg-[#e9f2ff] px-2 text-[#0c66e4]"><Link2 size={16} /></button>
          </div>}
        </article>)}</div>
      </section>}
    </main></div>

    {creating && <Modal onClose={() => setCreating(false)}><form onSubmit={(event) => void create(event)} className="p-6">
      <h2 className="text-lg font-bold">Reservar tempo de foco</h2><p className="mt-1 text-sm text-[#626f86]">Escolha quando você vai trabalhar. O prazo dos cartões permanece como está.</p>
      <label className="mt-5 block text-sm font-semibold" htmlFor="focus-title">Título</label>
      <input id="focus-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Revisar proposta" maxLength={160} className="mt-1 w-full rounded border border-[#8590a2] px-3 py-2 text-sm" />
      {cards.length > 0 && <><label className="mt-4 block text-sm font-semibold" htmlFor="focus-card">Cartão para trabalhar (opcional)</label>
        <select id="focus-card" value={selectedCard} onChange={(event) => setSelectedCard(event.target.value)} className="mt-1 w-full rounded border border-[#8590a2] bg-white px-3 py-2 text-sm"><option value="">Nenhum cartão</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</select></>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="block text-sm font-semibold" htmlFor="focus-start">Início</label><input id="focus-start" required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 w-full rounded border border-[#8590a2] px-3 py-2 text-sm" /></div>
        <div><label className="block text-sm font-semibold" htmlFor="focus-end">Término</label><input id="focus-end" required type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1 w-full rounded border border-[#8590a2] px-3 py-2 text-sm" /></div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-[#ae2a19]">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setCreating(false)} className="rounded bg-[#e9eaed] px-4 py-2 text-sm font-semibold">Cancelar</button><button disabled={saving} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white">{saving ? "Reservando…" : "Reservar tempo"}</button></div>
    </form></Modal>}
  </div>;
}
