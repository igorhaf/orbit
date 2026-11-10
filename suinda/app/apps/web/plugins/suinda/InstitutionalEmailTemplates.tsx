"use client";

import { useCallback, useEffect, useState } from "react";
import { api, send } from "@/lib/api";

type Workspace = { id: string; name: string };
type Template = { kind: string; subject_template: string; body_template: string; enabled: boolean; updated_at?: string };
const kinds = [
  ["academic_reminder", "Lembrete acadêmico"], ["survey_reminder", "Lembrete de pesquisa"], ["attendance_risk", "Frequência abaixo do mínimo"],
  ["announcement", "Comunicado"], ["scholarship_decision", "Decisão de bolsa"],
  ["study_group_message", "Grupo de estudo"], ["alumni_reply", "Comunidade de ex-alunos"],
  ["community_connection", "Conexão na comunidade"], ["community_message", "Mensagem direta da comunidade"],
  ["community_reply", "Resposta na comunidade"],
] as const;
const fields = "{{learner_name}}, {{institution_name}}, {{notification_title}}, {{notification_body}}, {{course_link}}, {{product_name}}";
const control = "min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white";

export default function InstitutionalEmailTemplates() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [kind, setKind] = useState<string>(kinds[0][0]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Pick<Template, "subject_template" | "body_template" | "enabled">>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (selected: string) => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const saved = await api<Template[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(selected)}/email-templates`);
      setTemplates(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os modelos."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void api<Workspace[]>("/workspaces").then((spaces) => {
      setWorkspaces(spaces);
      const initial = spaces[0]?.id || "";
      setWorkspaceId(initial);
      if (initial) void load(initial);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar os workspaces."));
  }, [load]);

  const draftKey = `${workspaceId}:${kind}`;
  const savedTemplate = templates.find((item) => item.kind === kind);
  const draft = drafts[draftKey] || { subject_template: savedTemplate?.subject_template || "Olá, {{learner_name}}.\n{{notification_title}}",
    body_template: savedTemplate?.body_template || "{{notification_body}}\n\nAcesse: {{course_link}}\n{{institution_name}}", enabled: savedTemplate?.enabled || false };

  async function save() {
    if (!workspaceId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await send<Template>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/email-templates/${encodeURIComponent(kind)}`, "PUT", {
        kind, ...draft,
      });
      setTemplates((current) => [...current.filter((item) => item.kind !== kind), saved]);
      setMessage(draft.enabled ? "Modelo salvo e selecionado para este workspace." : "Modelo salvo e desativado; o formato Orbit padrão continuará em uso.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o modelo."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="institutional-email-templates-title" className="mt-4 rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-4 sm:p-5">
    <h2 id="institutional-email-templates-title" className="text-sm font-semibold text-white">Modelos institucionais de e-mail</h2>
    <p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">Personalize e selecione o modelo usado nas notificações educacionais por e-mail. Os campos permitidos são: <code className="break-words text-cyan-100">{fields}</code>. O conteúdo é enviado como texto simples e os e-mails continuam sujeitos à preferência de notificações do aluno.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs text-[#9fadbc]">Workspace<select value={workspaceId} disabled={busy} onChange={(event) => { setWorkspaceId(event.target.value); void load(event.target.value); }} className={control}>{workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-[#9fadbc]">Tipo de mensagem<select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value)} className={control}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-[#9fadbc] sm:col-span-2">Assunto<input maxLength={250} value={draft.subject_template} disabled={busy} onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: { ...draft, subject_template: event.target.value } }))} className={control}/></label>
      <label className="grid gap-1 text-xs text-[#9fadbc] sm:col-span-2">Corpo do e-mail<textarea maxLength={10000} rows={7} value={draft.body_template} disabled={busy} onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: { ...draft, body_template: event.target.value } }))} className={`${control} py-2 font-mono text-xs`}/></label>
      <label className="flex min-h-10 items-center gap-2 text-sm text-[#dee4ea] sm:col-span-2"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: { ...draft, enabled: event.target.checked } }))} className="accent-cyan-400"/>Usar este modelo neste workspace e tipo</label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" disabled={busy || !workspaceId} onClick={() => void save()} className="min-h-10 rounded-lg border border-cyan-200/20 bg-cyan-200/10 px-4 text-sm font-medium text-cyan-100 hover:bg-cyan-200/15 disabled:opacity-50">Salvar modelo</button>{busy && <span role="status" className="text-xs text-[#9fadbc]">Salvando…</span>}</div>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}{message && <p role="status" className="mt-3 text-xs text-emerald-200">{message}</p>}
  </section>;
}
