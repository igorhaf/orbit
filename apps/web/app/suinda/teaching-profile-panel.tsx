"use client";

import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api, getToken } from "@/lib/api";
import { StaffProfessional } from "@/plugins/suinda/StaffProfessional";

type TeachingProfileValues = {
  professional_title: string;
  biography: string;
  qualifications: string;
  specialties: string[];
  website_url: string;
  public_profile_enabled: boolean;
};
type TeachingProfileWorkspace = {
  workspace_id: string;
  workspace_name: string;
  assigned_courses: number;
  assigned_cohorts: number;
  profile: { id: string; revision: number; payload: Partial<TeachingProfileValues> } | null;
};
const emptyProfile: TeachingProfileValues = { professional_title: "", biography: "", qualifications: "", specialties: [], website_url: "", public_profile_enabled: false };
function profileValues(payload?: Partial<TeachingProfileValues>): TeachingProfileValues {
  return { professional_title: payload?.professional_title || "", biography: payload?.biography || "", qualifications: payload?.qualifications || "",
    specialties: Array.isArray(payload?.specialties) ? payload.specialties : [], website_url: payload?.website_url || "", public_profile_enabled: payload?.public_profile_enabled === true };
}

export default function TeachingProfilePanel() {
  const [items, setItems] = useState<TeachingProfileWorkspace[]>([]);
  const [values, setValues] = useState<Record<string, TeachingProfileValues>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const result = await api<TeachingProfileWorkspace[]>("/extensions/suinda-learning/me/teaching-profiles");
    setItems(result);
    setValues(Object.fromEntries(result.map((item) => [item.workspace_id, profileValues(item.profile?.payload)])));
  }, []);
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    load().catch((reason: unknown) => setMessages({ load: reason instanceof Error ? reason.message : "Não foi possível carregar os perfis profissionais." }))
      .finally(() => setLoading(false));
  }, [load]);
  function update(workspaceId: string, field: keyof TeachingProfileValues, value: string | string[] | boolean) {
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], [field]: value } }));
  }
  async function save(item: TeachingProfileWorkspace) {
    if (busy) return;
    setBusy(item.workspace_id);
    setMessages((current) => ({ ...current, [item.workspace_id]: "" }));
    const value = values[item.workspace_id] || emptyProfile;
    try {
      await api(`/extensions/suinda-learning/me/teaching-profiles/${encodeURIComponent(item.workspace_id)}`, {
        method: "PUT", body: JSON.stringify({ ...value, expected_revision: item.profile?.revision, operation_key: crypto.randomUUID() }),
      });
      await load();
      setMessages((current) => ({ ...current, [item.workspace_id]: "Perfil profissional salvo." }));
    } catch (reason) {
      setMessages((current) => ({ ...current, [item.workspace_id]: reason instanceof Error ? reason.message : "Não foi possível salvar o perfil profissional." }));
    } finally { setBusy(""); }
  }

  if (loading || messages.load || items.length === 0) return messages.load ? <p role="alert" className="mt-7 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{messages.load}</p> : null;
  return <section className="mt-8 space-y-4" aria-labelledby="professional-profile-heading">
    <div><h2 id="professional-profile-heading" className="text-xl font-semibold text-white">Perfil profissional</h2><p className="mt-1 text-sm text-[#9fadbc]">Apresente sua formação e experiência nos cursos e turmas aos quais você está atribuída.</p></div>
    {items.map((item) => {
      const value = values[item.workspace_id] || emptyProfile;
      return <article key={item.workspace_id} className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7">
        <div className="mb-5"><h3 className="text-lg font-semibold text-white">{item.workspace_name}</h3><p className="mt-1 text-xs text-[#9fadbc]">{item.assigned_courses} cursos · {item.assigned_cohorts} turmas · {item.profile ? `versão ${item.profile.revision}` : "perfil ainda não preenchido"}</p></div>
        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-[#3b4754] bg-black/10 p-4"><input type="checkbox" checked={value.public_profile_enabled} onChange={(event) => update(item.workspace_id, "public_profile_enabled", event.target.checked)} className="mt-1 size-4 accent-cyan-200" /><span><span className="block text-sm font-medium text-[#b6c2cf]">Exibir perfil na página pública dos cursos atribuídos</span><span className="mt-1 block text-xs leading-5 text-[#9fadbc]">Nome e foto vêm do perfil da conta Orbit. Quando ativado, também serão publicados título, biografia, formação, especialidades e site. Contatos pessoais não são exibidos.</span></span></label>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save(item); }}>
          <label className="block text-sm font-medium text-[#b6c2cf]">Título profissional<input className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" maxLength={180} value={value.professional_title} onChange={(event) => update(item.workspace_id, "professional_title", event.target.value)} /></label>
          <label className="block text-sm font-medium text-[#b6c2cf]">Site profissional<input className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" type="url" maxLength={2000} value={value.website_url} onChange={(event) => update(item.workspace_id, "website_url", event.target.value)} /></label>
          <label className="block text-sm font-medium text-[#b6c2cf] sm:col-span-2">Biografia<textarea className="mt-1 min-h-28 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm text-white" maxLength={4000} value={value.biography} onChange={(event) => update(item.workspace_id, "biography", event.target.value)} /></label>
          <label className="block text-sm font-medium text-[#b6c2cf] sm:col-span-2">Currículo e formação<textarea className="mt-1 min-h-28 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm text-white" maxLength={4000} value={value.qualifications} onChange={(event) => update(item.workspace_id, "qualifications", event.target.value)} /></label>
          <label className="block text-sm font-medium text-[#b6c2cf] sm:col-span-2">Especialidades (uma por linha)<textarea className="mt-1 min-h-24 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm text-white" maxLength={2000} value={value.specialties.join("\n")} onChange={(event) => update(item.workspace_id, "specialties", event.target.value.split(/\n/).map((entry) => entry.trim()).filter(Boolean))} /></label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="submit" disabled={Boolean(busy)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-60"><Save size={15} aria-hidden="true" />{busy === item.workspace_id ? "Salvando…" : "Salvar perfil profissional"}</button>{messages[item.workspace_id] && <p role="status" className="text-sm text-emerald-200">{messages[item.workspace_id]}</p>}</div>
        </form>
        <StaffProfessional workspaceId={item.workspace_id} />
      </article>;
    })}
  </section>;
}
