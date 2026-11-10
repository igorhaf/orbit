"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, GraduationCap, Send, Users } from "lucide-react";
import { api, getToken } from "@/lib/api";

type AlumniEnrollment = { enrollment_id: string; course_id: string; course_revision: number; course_title: string; alumni_public_enabled: boolean };
type AlumniCommunityData = {
  course: { id: string; title: string; revision: number };
  can_post: boolean;
  members: Array<{ name: string; avatar_url: string | null; bio: string | null; interests: string[] }>;
  posts: Array<{ id: string; title: string; body: string; author_name: string; author_avatar: string | null; created_at: string; replies: Array<{ id: string; body: string; author_name: string; created_at: string }> }>;
};

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SuindaAlumniPage() {
  const [enrollments, setEnrollments] = useState<AlumniEnrollment[]>([]);
  const [activeId, setActiveId] = useState("");
  const [community, setCommunity] = useState<AlumniCommunityData | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [communityStatus, setCommunityStatus] = useState("");

  useEffect(() => {
    Promise.resolve().then(() => setSignedIn(Boolean(getToken())));
    if (!getToken()) { Promise.resolve().then(() => setLoading(false)); return; }
    api<AlumniEnrollment[]>("/extensions/suinda-learning/me/alumni")
      .then(setEnrollments)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar suas comunidades."))
      .finally(() => setLoading(false));
  }, []);

  async function openCommunity(item: AlumniEnrollment) {
    setActiveId(item.enrollment_id); setCommunity(null); setError(""); setCommunityStatus(`Carregando a comunidade de ${item.course_title}.`);
    try {
      setCommunity(await api<AlumniCommunityData>(`/extensions/suinda-learning/me/alumni/enrollments/${encodeURIComponent(item.enrollment_id)}`));
      setCommunityStatus(`Comunidade de ${item.course_title} carregada.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível abrir a comunidade."); setCommunityStatus(""); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeId || saving || !title.trim() || !body.trim()) return;
    setSaving("post"); setError("");
    try {
      await api(`/extensions/suinda-learning/me/alumni/enrollments/${encodeURIComponent(activeId)}/posts`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), title: title.trim(), body: body.trim() }),
      });
      setTitle(""); setBody("");
      const item = enrollments.find((entry) => entry.enrollment_id === activeId);
      if (item) await openCommunity(item);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível publicar."); }
    finally { setSaving(""); }
  }

  async function reply(postId: string) {
    const message = (replyDrafts[postId] || "").trim(); if (!activeId || !message || saving) return;
    setSaving(postId); setError("");
    try {
      await api(`/extensions/suinda-learning/me/alumni/enrollments/${encodeURIComponent(activeId)}/posts/${encodeURIComponent(postId)}/replies`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), body: message }),
      });
      setReplyDrafts((current) => ({ ...current, [postId]: "" }));
      const item = enrollments.find((entry) => entry.enrollment_id === activeId);
      if (item) await openCommunity(item);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível responder."); }
    finally { setSaving(""); }
  }

  return <main className="min-h-screen bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-8 sm:py-10">
    <div className="mx-auto max-w-6xl">
      <Link href="/suinda" className="inline-flex min-h-10 items-center gap-2 text-sm text-[#b6c2cf] hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Minha jornada</Link>
      <header className="mt-5 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.11),_transparent_45%),#101621] p-6 sm:p-8">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-cyan-200"><GraduationCap size={15} aria-hidden="true" />Suindá · comunidade</p>
        <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Comunidade de ex-alunos</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#b6c2cf]">Converse com quem concluiu a mesma edição. Só participantes que ativaram a opção de ex-alunos aparecem no diretório e publicam mensagens.</p>
        <Link href="/suinda/profile" className="mt-4 inline-flex min-h-9 items-center gap-2 text-sm text-cyan-100 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">Preferências de visibilidade <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </header>

      {loading && <p role="status" className="mt-6 text-sm text-[#9fadbc]">Carregando comunidades…</p>}
      {!loading && !signedIn && <section className="mt-6 rounded-xl border border-[#3b4754] bg-[#2c333a] p-5"><p className="text-sm text-[#b6c2cf]">Entre na sua conta para acessar a comunidade de ex-alunos.</p><Link href="/" className="mt-3 inline-flex min-h-9 items-center text-sm text-cyan-100 underline">Entrar</Link></section>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</p>}
      {!loading && signedIn && enrollments.length === 0 && <section className="mt-6 rounded-xl border border-dashed border-white/15 bg-[#2c333a] p-6 text-center"><p className="text-sm text-[#b6c2cf]">As comunidades aparecem aqui depois que você conclui um curso.</p><Link href="/suinda" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950">Ver minha jornada</Link></section>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Cursos concluídos" className="h-fit rounded-2xl border border-[#3b4754] bg-[#2c333a] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Users size={16} className="text-cyan-200" aria-hidden="true" />Minhas edições concluídas</h2>
          <ul className="mt-3 space-y-2">{enrollments.map((item) => <li key={item.enrollment_id}><button type="button" aria-pressed={activeId === item.enrollment_id} onClick={() => void openCommunity(item)} className={`w-full rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${activeId === item.enrollment_id ? "border-cyan-200/30 bg-cyan-200/[0.06]" : "border-white/[0.08] hover:bg-white/[0.03]"}`}><span className="block text-sm font-medium text-[#dee4ea]">{item.course_title}</span><span className="mt-1 block text-xs text-[#9fadbc]">Edição {item.course_revision}{item.alumni_public_enabled ? " · perfil público" : " · somente leitura"}</span></button></li>)}</ul>
        </nav>

        <section aria-label="Comunidade da edição selecionada" className="min-h-64 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-4 sm:p-6">
          <p role="status" className="sr-only">{communityStatus}</p>
          {!activeId && <p className="py-16 text-center text-sm text-[#9fadbc]">Selecione uma edição concluída para abrir sua comunidade.</p>}
          {activeId && !community && !error && <p className="py-16 text-center text-sm text-[#9fadbc]">Carregando comunidade…</p>}
          {community && <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-cyan-200">Edição {community.course.revision}</p><h2 className="mt-1 text-xl font-semibold text-white">{community.course.title}</h2></div><span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-3 py-1 text-xs text-[#b6c2cf]"><Users size={13} aria-hidden="true" />{community.members.length} ex-aluno(s) visível(is)</span></div>
            {community.can_post ? <form onSubmit={(event) => void publish(event)} className="mt-5 grid gap-3 rounded-xl border border-[#3b4754] bg-black/10 p-4"><h3 className="text-sm font-semibold text-white">Compartilhe com seus colegas</h3><label className="grid gap-1 text-xs font-medium text-[#b6c2cf]" htmlFor="alumni-post-title">Assunto<input id="alumni-post-title" required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label><label className="grid gap-1 text-xs font-medium text-[#b6c2cf]" htmlFor="alumni-post-body">Mensagem<textarea id="alumni-post-body" required maxLength={8000} rows={3} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escreva uma atualização, uma pergunta ou uma oportunidade…" className="rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /></label><button disabled={saving === "post"} className="inline-flex min-h-10 items-center justify-center gap-2 justify-self-end rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50"><Send size={14} aria-hidden="true" />{saving === "post" ? "Publicando…" : "Publicar"}</button></form> : <p className="mt-5 rounded-xl border border-amber-200/10 bg-amber-200/[0.03] p-4 text-sm leading-6 text-[#b6c2cf]">Ative <Link href="/suinda/profile" className="text-cyan-100 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Participar da comunidade de ex-alunos</Link> no seu perfil acadêmico para aparecer no diretório e publicar.</p>}
            {community.members.length > 0 && <section className="mt-5"><h3 className="text-sm font-semibold text-white">Ex-alunos participantes</h3><ul className="mt-3 grid gap-2 sm:grid-cols-2">{community.members.map((member, index) => <li key={`${member.name}-${index}`} className="flex items-start gap-3 rounded-xl border border-[#3b4754] bg-white/[0.02] p-3">{member.avatar_url ? <Image src={member.avatar_url} alt="" width={36} height={36} unoptimized className="size-9 shrink-0 rounded-full object-cover" /> : <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-cyan-200/10 text-xs text-cyan-100">{member.name.slice(0, 1).toUpperCase()}</span>}<div className="min-w-0"><p className="text-sm font-medium text-[#dee4ea]">{member.name}</p>{member.bio && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#9fadbc]">{member.bio}</p>}{member.interests.length > 0 && <p className="mt-2 text-[11px] text-cyan-100">{member.interests.join(" · ")}</p>}</div></li>)}</ul></section>}
            <section className="mt-6"><h3 className="text-sm font-semibold text-white">Conversas</h3>{community.posts.length === 0 ? <p className="mt-3 rounded-lg border border-dashed border-[#3b4754] p-5 text-center text-sm text-[#9fadbc]">Ainda não há publicações nesta edição.</p> : <ul className="mt-3 space-y-3">{community.posts.map((post) => <li key={post.id} className="rounded-xl border border-[#3b4754] bg-white/[0.02] p-4"><div className="flex items-center gap-2">{post.author_avatar ? <Image src={post.author_avatar} alt="" width={32} height={32} unoptimized className="size-8 rounded-full object-cover" /> : <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-cyan-200/10 text-xs text-cyan-100">{post.author_name.slice(0, 1).toUpperCase()}</span>}<div><p className="text-sm font-medium text-[#dee4ea]">{post.author_name}</p><time dateTime={post.created_at} className="text-xs text-[#b6c2cf]">{dateLabel(post.created_at)}</time></div></div><h4 className="mt-3 text-sm font-semibold text-white">{post.title}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#b6c2cf]">{post.body}</p>{post.replies.length > 0 && <ul className="mt-3 space-y-2 border-l border-[#3b4754] pl-3">{post.replies.map((replyItem) => <li key={replyItem.id}><p className="text-xs text-cyan-100">{replyItem.author_name} · {dateLabel(replyItem.created_at)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#b6c2cf]">{replyItem.body}</p></li>)}</ul>}{community.can_post && <form onSubmit={(event) => { event.preventDefault(); void reply(post.id); }} className="mt-3 flex flex-wrap gap-2"><label className="sr-only" htmlFor={`alumni-reply-${post.id}`}>Resposta para a publicação de {post.author_name}: {post.title}</label><input id={`alumni-reply-${post.id}`} value={replyDrafts[post.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [post.id]: event.target.value }))} maxLength={8000} required placeholder="Escreva uma resposta…" className="min-h-10 min-w-0 flex-1 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white placeholder:text-[#9fadbc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" /><button disabled={saving === post.id} className="min-h-10 rounded-lg border border-[#3b4754] px-3 text-sm text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50">{saving === post.id ? "Enviando…" : "Responder"}</button></form>}</li>)}</ul>}</section>
          </>}
        </section>
      </div>
    </div>
  </main>;
}
