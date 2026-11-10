"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppHeader, WorkspaceSidebar } from "@/components/ui";
import { api, getToken, type Board, type User } from "@/lib/api";

export default function SuindaOrbitShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);

  useEffect(() => {
    const updateTitle = () => {
      const heading = document.getElementById("suinda-main-content")?.querySelector("h1")?.textContent;
      const pageName = heading?.replace(/\s+/g, " ").trim();
      const title = pageName ? `${pageName} | Suindá` : "Suindá | Plataforma de cursos";
      if (document.title !== title) document.title = title;
    };
    const observer = new MutationObserver(updateTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const frame = window.requestAnimationFrame(updateTitle);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const token = getToken();
      if (!token) { if (active) { setUser(null); setBoards([]); } return; }
      try {
        const account = await api<User>("/auth/me");
        if (active) setUser(account);
      } catch {
        if (active) { setUser(null); setBoards([]); }
        return;
      }
      try { const boardList = await api<Board[]>("/boards"); if (active) setBoards(boardList); }
      catch { if (active) setBoards([]); }
    };
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("account:changed", refresh);
    return () => { active = false; window.removeEventListener("account:changed", refresh); };
  }, [pathname]);

  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
    <AppHeader user={user} boards={boards} appName="Suindá" homeHref="/suinda" signInHref="/" publicActions={[{ id: "course-catalog", label: "Explorar cursos", href: "/suinda/catalog" }]} onCreate={() => router.push("/boards?create=1")} />
    <div className="flex min-h-0 flex-1">
      {user && <WorkspaceSidebar boards={boards} onCreate={() => router.push("/boards?create=1")} onChoose={(id) => router.push(id ? `/board/${id}` : "/boards")} />}
      <div id="suinda-main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">{children}</div>
    </div>
  </div>;
}
