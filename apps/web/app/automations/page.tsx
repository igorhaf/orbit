"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Library, Puzzle, Wrench } from "lucide-react";
import { AutomationStudio } from "@/components/automations";
import { AppHeader, WorkspaceSidebar } from "@/components/ui";
import { api, Board, getToken, User } from "@/lib/api";

export default function AutomationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState("");
  const [listId, setListId] = useState<string | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.push("/");
      return;
    }
    let active = true;
    Promise.all([api<User>("/auth/me"), api<Board[]>("/boards")])
      .then(([account, allBoards]) => {
        if (!active) return;
        const available = allBoards.filter((board) => !board.is_inbox && !board.is_collection && !board.closed_at);
        const parameters = new URLSearchParams(window.location.search);
        const requestedBoard = parameters.get("board");
        setUser(account);
        setBoards(allBoards);
        setBoardId(available.some((board) => board.id === requestedBoard) ? requestedBoard! : available[0]?.id || "");
        setListId(parameters.get("list") || undefined);
      })
      .catch((value) => {
        if (active) setError((value as Error).message);
      });
    return () => {
      active = false;
    };
  }, [router]);

  const available = boards.filter((board) => !board.is_inbox && !board.is_collection && !board.closed_at);
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      {user && <AppHeader user={user} boards={boards} />}
      <div className="flex min-h-0 flex-1">
        {user && (
          <WorkspaceSidebar
            boards={boards}
            onCreate={() => router.push("/boards?create=1")}
            onChoose={(id) => router.push(id ? `/board/${id}` : "/boards")}
          />
        )}
        <main className="mx-auto w-full min-w-0 max-w-[1400px] px-4 py-7 sm:px-7 lg:px-9">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.12em] text-[#6554c0]"><Wrench size={15} /> Operações</p>
              <h1 className="text-3xl font-bold tracking-tight">Automações</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#626f86]">Escolha uma operação, leia o que ela faz e execute quando precisar. O histórico registra cada resultado.</p>
            </div>
            {available.length > 0 && (
              <label className="min-w-64 text-xs font-bold text-[#44546f]">
                Contexto do quadro
                <select value={boardId} onChange={(event) => { setBoardId(event.target.value); setListId(undefined); window.history.replaceState(null, "", `/automations?board=${event.target.value}`); }} className="mt-1 w-full rounded-lg border border-[#8590a2] bg-white px-3 py-2 text-sm font-normal">
                  {available.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-xl border border-[#dfe1e6] bg-white p-4 shadow-sm"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#e9f2ff] text-[#0c66e4]"><Library size={20}/></span><div><h2 className="text-sm font-bold">Operações prontas</h2><p className="text-xs text-[#626f86]">Ative e execute sem montar diagramas.</p></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-[#dfe1e6] bg-white p-4 shadow-sm"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#f0edff] text-[#6554c0]"><Puzzle size={20}/></span><div><h2 className="text-sm font-bold">Resultado verificável</h2><p className="text-xs text-[#626f86]">Cada execução guarda seu resultado no histórico.</p></div></div>
          </div>
          {error && <p role="alert" className="rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
          {!error && !boardId && <div className="rounded-xl border border-dashed border-[#c1c7d0] bg-white p-12 text-center"><Wrench className="mx-auto mb-3 text-[#6554c0]" size={30}/><h2 className="font-bold">Crie um quadro para começar</h2><p className="mt-1 text-sm text-[#626f86]">As operações usam o quadro para manter o histórico.</p></div>}
          {boardId && <section className="rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><AutomationStudio key={`${boardId}:${listId || ""}`} boardId={boardId} listId={listId} /></section>}
        </main>
      </div>
    </div>
  );
}
