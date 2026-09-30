"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Clock3,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import {
  api,
  send,
  Board,
  User,
  clearSession,
  getToken,
  setUser,
} from "@/lib/api";
import { remember } from "@/lib/history";
import {
  AppHeader,
  BoardTile,
  CreateBoardModal,
  useConfirmModal,
  WorkspaceSidebar,
} from "@/components/ui";
import { useHydrated } from "@/lib/use-hydrated";

export default function BoardsPage() {
  const router = useRouter();
  const { confirm, confirmationModal } = useConfirmModal();
  const [user, setCurrentUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [closedBoards, setClosedBoards] = useState<Board[]>([]);
  const ready = useHydrated();
  const [query, setQuery] = useState("");
  const [create, setCreate] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [list, closed] = await Promise.all([
        api<Board[]>("/boards"),
        api<Board[]>("/boards?status=closed"),
      ]);
      setBoards(list);
      setClosedBoards(closed);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!getToken()) {
      router.push("/");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    api<User>("/auth/me")
      .then((account) => {
        setCurrentUser(account);
        setUser(account);
        load();
        if (params.has("create")) setCreate(true);
      })
      .catch(() => {
        clearSession();
        router.push("/");
      });
    const onChange = () => load();
    window.addEventListener("data:changed", onChange);
    return () => window.removeEventListener("data:changed", onChange);
  }, [load, router]);
  async function createBoard(
    title: string,
    background: string,
    workspaceId?: string,
  ) {
    const board = await send<Board>("/boards", "POST", {
      title,
      background,
      workspace_id: workspaceId,
    });
    remember({label:'criar quadro',undo:[{path:`/boards/${board.id}/close`,method:'PATCH'}],redo:[{path:`/boards/${board.id}/reopen`,method:'PATCH'}]});
    router.push(`/board/${board.id}`);
  }
  async function toggleStar(board: Board) {
    try {
      await send(`/boards/${board.id}`, "PATCH", { starred: !board.starred });
      remember({
        label: board.starred ? "remover favorito" : "favoritar quadro",
        undo: [
          {
            path: `/boards/${board.id}`,
            method: "PATCH",
            body: { starred: board.starred },
          },
        ],
        redo: [
          {
            path: `/boards/${board.id}`,
            method: "PATCH",
            body: { starred: !board.starred },
          },
        ],
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function reopenBoard(board: Board) {
    try {
      await send(`/boards/${board.id}/reopen`, "PATCH");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function deleteClosedBoard(board: Board) {
    confirm(
      { title: "Excluir quadro", description: `Excluir permanentemente o quadro “${board.title}” e todo o conteúdo?`, confirmLabel: "Excluir" },
      async () => { await send(`/boards/${board.id}`, "DELETE"); await load(); },
    );
  }
  async function moveFavorite(index: number, direction: -1 | 1) {
    const favorites = boards.filter((board) => board.starred && !board.is_inbox);
    const target = index + direction;
    if (target < 0 || target >= favorites.length) return;
    const previous = favorites.map((board) => board.id);
    const reordered = [...previous];
    [reordered[index], reordered[target]] = [
      reordered[target],
      reordered[index],
    ];
    try {
      await send("/favorites/reorder", "PATCH", { ids: reordered });
      remember({
        label: "reordenar favoritos",
        undo: [
          {
            path: "/favorites/reorder",
            method: "PATCH",
            body: { ids: previous },
          },
        ],
        redo: [
          {
            path: "/favorites/reorder",
            method: "PATCH",
            body: { ids: reordered },
          },
        ],
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  if (!ready) return <div className="min-h-screen bg-[#f7f8fa]" />;
  if (!user) return null;
  const visibleBoards = boards.filter((board) => !board.is_inbox);
  const filtered = visibleBoards.filter((board) =>
    board.title.toLowerCase().includes(query.toLowerCase()),
  );
  const favorites = filtered.filter((board) => board.starred);
  const recent = filtered
    .filter((board) => board.visited_at)
    .sort(
      (a, b) =>
        new Date(b.visited_at!).getTime() - new Date(a.visited_at!).getTime(),
    )
    .slice(0, 4);
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <AppHeader user={user} boards={boards} onCreate={() => setCreate(true)} />
      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar
          boards={boards}
          onCreate={() => setCreate(true)}
          onChoose={(id) => router.push(id ? `/board/${id}` : "/boards")}
        />
        <main className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-8 md:py-10">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-[.12em] text-[#626f86]">
                QUADROS
              </p>
              <h1 className="text-[26px] font-bold tracking-tight sm:text-[30px]">
                Seus quadros
              </h1>
              <p className="mt-1 text-sm text-[#626f86]">
                Acesse e organize os projetos da sua conta.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCreate(true)}
                className="flex items-center gap-2 rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0055cc]"
              >
                <Plus size={17} /> Criar quadro
              </button>
            </div>
          </div>
          {error && (
            <p
              role="alert"
              className="mb-5 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]"
            >
              {error}
            </p>
          )}
          <div className="relative mb-8 max-w-[360px]">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#626f86]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar seus quadros"
              className="w-full rounded border border-[#8590a2] bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>
          {favorites.length > 0 && (
            <section className="mb-9">
              <h2 className="mb-4 flex items-center gap-2 text-base font-bold">
                <Star size={19} /> Quadros favoritos
              </h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {favorites.map((board, index) => (
                  <div key={board.id} className="relative">
                    <BoardTile
                      board={board}
                      onClick={() => router.push(`/board/${board.id}`)}
                    />
                    <div className="absolute bottom-2 right-2 flex gap-1 rounded bg-black/30 p-0.5 text-white">
                      <button
                        onClick={() => moveFavorite(index, -1)}
                        disabled={index === 0}
                        title="Mover favorito para cima"
                        className="rounded p-0.5 hover:bg-white/20"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        onClick={() => moveFavorite(index, 1)}
                        disabled={index === favorites.length - 1}
                        title="Mover favorito para baixo"
                        className="rounded p-0.5 hover:bg-white/20"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {recent.length > 0 && (
            <section className="mb-9">
              <h2 className="mb-4 flex items-center gap-2 text-base font-bold">
                <Clock3 size={19} /> Acessados recentemente
              </h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {recent.map((board) => (
                  <BoardTile
                    key={board.id}
                    board={board}
                    onClick={() => router.push(`/board/${board.id}`)}
                  />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-base font-bold">
              <LayoutDashboard size={19} /> Todos os quadros
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {filtered.filter((board) => !board.is_inbox).map((board) => (
                      <div key={board.id} className="relative">
                        <BoardTile
                          board={board}
                          onClick={() => router.push(`/board/${board.id}`)}
                        />
                        <button
                          onClick={() => toggleStar(board)}
                          className="absolute right-2 top-2 rounded bg-black/20 p-1 text-white hover:bg-black/40"
                          title={
                            board.starred
                              ? "Remover favorito"
                              : "Adicionar favorito"
                          }
                        >
                          <Star
                            size={15}
                            fill={board.starred ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                    ))}
              <button
                onClick={() => setCreate(true)}
                className="flex h-[112px] items-center justify-center gap-2 rounded bg-[#dfe1e6] p-3 text-center text-sm font-semibold text-[#44546f] hover:bg-[#cdd3db]"
              >
                <Plus size={18} /> Criar novo quadro
              </button>
            </div>
            {visibleBoards.length > 0 && filtered.length === 0 && (
              <p className="py-8 text-sm text-[#626f86]">
                Nenhum quadro encontrado para “{query}”.
              </p>
            )}
          </section>
          {closedBoards.length > 0 && (
            <section className="mt-10 border-t border-[#dfe1e6] pt-7">
              <h2 className="mb-2 flex items-center gap-2 text-base font-bold">
                <Archive size={19} /> Quadros fechados{" "}
                <span className="text-sm font-normal text-[#626f86]">
                  ({closedBoards.length})
                </span>
              </h2>
              <p className="mb-4 text-sm text-[#626f86]">
                Os quadros fechados ficam guardados até serem reabertos ou
                excluídos.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {closedBoards.map((board) => (
                  <div
                    key={board.id}
                    className="rounded-lg border border-[#dfe1e6] bg-white p-4"
                  >
                    <button
                      onClick={() => router.push(`/board/${board.id}`)}
                      className="mb-1 block max-w-full truncate text-left font-bold hover:text-[#0c66e4]"
                    >
                      {board.title}
                    </button>
                    <p className="mb-4 text-xs text-[#626f86]">
                      Fechado em{" "}
                      {board.closed_at
                        ? new Date(board.closed_at).toLocaleDateString("pt-BR")
                        : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => reopenBoard(board)}
                        className="flex items-center gap-1 rounded bg-[#e9f2ff] px-2 py-1.5 text-xs font-semibold text-[#0c66e4]"
                      >
                        <RotateCcw size={14} /> Reabrir
                      </button>
                      <button
                        onClick={() => deleteClosedBoard(board)}
                        className="flex items-center gap-1 rounded bg-[#ffebe6] px-2 py-1.5 text-xs font-semibold text-[#ae2a19]"
                      >
                        <Trash2 size={14} /> Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
      {create && (
        <CreateBoardModal
          onClose={() => setCreate(false)}
          onCreate={createBoard}
        />
      )}
      {confirmationModal}
    </div>
  );
}
