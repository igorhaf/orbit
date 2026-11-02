"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MessageCircle, RefreshCw, Send } from "lucide-react";
import { api } from "@/lib/api";

type Contact = { user_id: string; name: string };
type LearningMessage = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  sender_name: string;
  recipient_name: string;
  body: string;
  sent_at: string;
};
type MessageData = { viewer_role: "learner" | "teacher"; contacts: Contact[]; messages: LearningMessage[] };

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SuindaMessagesPage() {
  const params = useParams<{ enrollmentId: string }>();
  const enrollmentId = Array.isArray(params.enrollmentId) ? params.enrollmentId[0] : params.enrollmentId;
  const [data, setData] = useState<MessageData | null>(null);
  const [contactId, setContactId] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api<MessageData>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/messages`);
      setData(result);
      setError("");
      setContactId((current) => result.contacts.some((contact) => contact.user_id === current) ? current : result.contacts[0]?.user_id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar as mensagens.");
    } finally { setLoading(false); }
  }, [enrollmentId]);

  useEffect(() => {
    let active = true;
    api<MessageData>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/messages`)
      .then((result) => {
        if (!active) return;
        setData(result);
        setContactId(result.contacts[0]?.user_id || "");
        setError("");
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Não foi possível carregar as mensagens.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enrollmentId]);

  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const contact = data?.contacts.find((item) => item.user_id === contactId);
  const messages = useMemo(() => data?.messages.filter((message) =>
    message.sender_user_id === contactId || message.recipient_user_id === contactId,
  ) || [], [contactId, data?.messages]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactId || !draft.trim()) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ operation_key: crypto.randomUUID(), recipient_user_id: contactId, body: draft.trim() }),
      });
      setDraft("");
      setNotice("Mensagem enviada.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem.");
    } finally { setSending(false); }
  }

  return <main className="min-h-screen bg-[#1d2125] text-[#dee4ea]"><div className="mx-auto max-w-4xl px-4 py-6 sm:px-7 lg:py-9">
    <Link href="/suinda" className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-[#b6c2cf] transition hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Minha aprendizagem</Link>
    <header className="mt-6 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.12),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-5 sm:p-7">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-cyan-200"><MessageCircle size={14} aria-hidden="true" /> Comunicação da turma</p>
      <h1 className="mt-2 text-2xl font-semibold text-white">Mensagens individuais</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#b6c2cf]">Conversa privada entre o estudante matriculado e os professores ou tutores atribuídos a esta edição do curso.</p>
    </header>
    {error && <section role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/40 bg-white/10 px-3 text-xs font-medium hover:bg-white/15"><RefreshCw size={13} aria-hidden="true" /> Tentar novamente</button></section>}
    {loading && !data && <p role="status" className="mt-6 text-sm text-[#9fadbc]">Carregando mensagens…</p>}
    {data && <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]">
      {data.contacts.length > 1 && <div className="border-b border-white/[0.08] p-4"><label htmlFor="message-contact" className="mb-2 block text-xs font-medium text-[#b6c2cf]">Professor ou tutor</label><select id="message-contact" value={contactId} onChange={(event) => setContactId(event.target.value)} className="min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-[#dee4ea] sm:max-w-sm">{data.contacts.map((item) => <option key={item.user_id} value={item.user_id}>{item.name}</option>)}</select></div>}
      {contact && <div className="border-b border-white/[0.08] px-5 py-4"><p className="text-sm font-semibold text-white">{contact.name}</p><p className="mt-1 text-xs text-[#9fadbc]">{data.viewer_role === "learner" ? "Professor ou tutor" : "Estudante"}</p></div>}
      <div role="log" aria-label="Conversa da matrícula" tabIndex={0} className="max-h-[55vh] min-h-64 space-y-3 overflow-y-auto p-4 sm:p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-cyan-200" aria-live="polite">
        {messages.length ? messages.map((message) => {
          const mine = message.sender_user_id !== contactId;
          return <article key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[90%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${mine ? "bg-cyan-200 text-slate-950" : "border border-[#3b4754] bg-white/[0.04] text-[#dee4ea]"}`}><p className={`mb-1 text-[11px] font-semibold ${mine ? "text-slate-700" : "text-cyan-100"}`}>{mine ? "Você" : contact?.name}</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p><time dateTime={message.sent_at} className={`mt-2 block text-right text-[10px] ${mine ? "text-slate-700" : "text-[#9fadbc]"}`}>{dateLabel(message.sent_at)}</time></div></article>;
        }) : <div className="flex min-h-56 flex-col items-center justify-center text-center"><MessageCircle size={24} className="text-slate-600" aria-hidden="true" /><p className="mt-3 text-sm text-[#b6c2cf]">{contact ? `Comece uma conversa com ${contact.name}.` : "Nenhum professor ou tutor está atribuído a esta matrícula."}</p><p className="mt-1 text-xs text-[#9fadbc]">As mensagens ficam visíveis somente para as pessoas desta conversa.</p></div>}
      </div>
      <form onSubmit={send} className="border-t border-white/[0.08] p-4 sm:p-5"><label className="sr-only" htmlFor="message-draft">Escreva sua mensagem</label><textarea id="message-draft" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={5000} rows={3} disabled={!contact} placeholder={contact ? "Escreva sua mensagem…" : "Sem destinatário disponível"} className="w-full resize-y rounded-xl border border-[#3b4754] bg-[#0b1019] p-3 text-sm leading-6 text-[#dee4ea] placeholder:text-[#9fadbc] focus:border-cyan-200/40 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-cyan-200 disabled:opacity-50" /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="min-h-5 text-xs">{notice && <p role="status" aria-live="polite" className="text-emerald-200">{notice}</p>}{error && <p role="alert" className="text-rose-200">{error}</p>}</div><button type="submit" disabled={sending || !contact || !draft.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-200 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"><Send size={14} aria-hidden="true" /> {sending ? "Enviando…" : "Enviar mensagem"}</button></div></form>
    </section>}
  </div></main>;
}
