"use client";

import { useEffect, useState } from "react";
import { api, send, Board, Card } from "@/lib/api";

type Mode = "move" | "copy" | "mirror";

const defaults = { description: true, dates: true, labels: true, members: true, checklists: true, customFields: true, comments: false };
const labels: Record<keyof typeof defaults, string> = { description: "Descrição", dates: "Datas", labels: "Etiquetas", members: "Membros", checklists: "Checklists", customFields: "Campos personalizados", comments: "Comentários" };
const inputClass = "mt-2 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2.5 text-sm font-normal text-[#172b4d]";

export function CardOperations({ card, board, onChanged, onMoved }: { card: Card; board: Board; onChanged: () => Promise<void>; onMoved: () => Promise<void> }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [boardId, setBoardId] = useState(board.id);
  const [remoteTarget, setRemoteTarget] = useState<Board | null>(null);
  const target = boardId === board.id ? board : remoteTarget;
  const [listId, setListId] = useState(card.list_id);
  const [position, setPosition] = useState("end");
  const [inbox, setInbox] = useState(false);
  const [include, setInclude] = useState(defaults);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Board[]>("/boards").then(setBoards).catch((error) => setError((error as Error).message)); }, []);
  useEffect(() => { if (boardId !== board.id) api<Board>(`/boards/${boardId}`).then((data) => { setRemoteTarget(data); setListId(data.lists?.[0]?.id || ""); }).catch((error) => setError((error as Error).message)); }, [boardId, board.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!mode || (!inbox && !listId)) return;
    setBusy(true); setError("");
    try {
      const place = position === "end" ? {} : { position: Number(position) };
      if (mode === "mirror") await send(`/cards/${card.id}/mirror`, "POST", { list_id: listId, ...place });
      if (mode === "copy") await send("/cards/copy", "POST", { card_ids: [card.id], list_id: listId, inbox, include, ...place });
      if (mode === "move") await send("/cards/move", "POST", { card_ids: [card.id], list_id: listId, ...place });
      setMode(null); if (mode === "move") await onMoved(); else await onChanged();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }

  return <div className="space-y-4 text-sm">
    <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#e9eaed] p-1.5">{(["move", "copy", "mirror"] as const).map((item) => <button key={item} type="button" onClick={() => { setMode(mode === item ? null : item); setInbox(false); }} className={`min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold ${mode === item ? "bg-[#0c66e4] text-white shadow-sm" : "text-[#44546f] hover:bg-white"}`}>{item === "move" ? "Mover" : item === "copy" ? "Copiar" : "Espelhar"}</button>)}</div>
    {mode && <form onSubmit={submit} className="space-y-4">
      {mode === "copy" && <label className="flex items-center gap-2 font-semibold"><input className="size-4 accent-[#0c66e4]" type="checkbox" checked={inbox} onChange={(event) => { setInbox(event.target.checked); setPosition("end"); }} />Enviar para Inbox</label>}
      {!inbox && <><label className="block font-semibold">Quadro<select value={boardId} onChange={(event) => { const next = event.target.value; setBoardId(next); setListId(next === board.id ? board.lists?.[0]?.id || "" : ""); setPosition("end"); }} className={inputClass}><option value={board.id}>{board.title}</option>{boards.filter((item) => item.id !== board.id && !item.is_inbox).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="block font-semibold">Lista<select value={listId} onChange={(event) => { setListId(event.target.value); setPosition("end"); }} className={inputClass}>{target?.lists?.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label><label className="block font-semibold">Posição<select value={position} onChange={(event) => setPosition(event.target.value)} className={inputClass}><option value="end">No final</option>{Array.from({ length: Math.max(0, (target?.lists?.find((list) => list.id === listId)?.cards.length || 0) - (mode === "move" && card.list_id === listId ? 1 : 0)) + 1 }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select></label></>}
      {mode === "copy" && <details className="rounded-lg border border-[#dfe1e6] p-4"><summary className="cursor-pointer font-semibold">Conteúdo da cópia</summary><div className="mt-3 grid grid-cols-2 gap-3">{(Object.keys(defaults) as (keyof typeof defaults)[]).map((key) => <label key={key} className="flex items-center gap-2"><input className="size-4 accent-[#0c66e4]" type="checkbox" checked={include[key]} onChange={(event) => setInclude({ ...include, [key]: event.target.checked })} />{labels[key]}</label>)}</div></details>}
      {error && <p role="alert" className="text-sm text-[#ae2a19]">{error}</p>}
      <button disabled={busy || (!inbox && !listId)} className="min-h-11 w-full rounded-lg bg-[#0c66e4] px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Aguarde..." : mode === "move" ? "Mover cartão" : mode === "copy" ? "Criar cópia" : "Criar espelho"}</button>
    </form>}
  </div>;
}
