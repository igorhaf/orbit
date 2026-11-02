"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, GraduationCap, Save, ShieldCheck, UserRound } from "lucide-react";
import { api, apiBlob, getToken, type User } from "@/lib/api";
import TeachingProfilePanel from "../teaching-profile-panel";
import { SuindaWhatsAppConsent } from "@/plugins/suinda/SuindaWhatsAppConsent";

type ProfileValues = {
  phone: string;
  preferred_contact: string;
  date_of_birth: string;
  education_level: string;
  institution: string;
  study_program: string;
  academic_background: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  public_profile_enabled: boolean;
  alumni_public_enabled: boolean;
  public_bio: string;
  public_interests: string;
  gamification_public_enabled: boolean;
  weekly_learning_goal_days: number;
  weekly_learning_goal_metric: "study_days" | "lessons" | "attendance" | "practice_hours";
  weekly_learning_goal_target: number;
  academic_reminders_enabled: boolean;
  academic_session_reminder_minutes: string;
  academic_deadline_reminder_hours: string;
  academic_document_reminder_days: string;
  custom_fields: Record<string, unknown>;
};
type CustomProfileField = { field_key: string; label: string; field_type: "text" | "textarea" | "phone" | "date" | "number" | "select" | "multiselect" | "checkbox"; required: boolean; options: string[]; max_length?: number };
type ProfileWorkspace = {
  workspace_id: string;
  workspace_name: string;
  enrollment_count: number;
  profile_fields: CustomProfileField[];
  profile: { id: string; revision: number; payload: Partial<ProfileValues> } | null;
};

type ProfileEditableField = Exclude<keyof ProfileValues, "public_profile_enabled" | "alumni_public_enabled" | "gamification_public_enabled" | "weekly_learning_goal_days" | "weekly_learning_goal_metric" | "weekly_learning_goal_target" | "academic_reminders_enabled" | "academic_session_reminder_minutes" | "academic_deadline_reminder_hours" | "academic_document_reminder_days" | "custom_fields">;
type FontScale = "small" | "normal" | "large" | "largest";
type AccountWithFontScale = User & { preferences?: User["preferences"] & { fontScale?: unknown } };
const fontScaleOptions: Array<{ value: FontScale; label: string; detail: string }> = [
  { value: "small", label: "Menor", detail: "90%" },
  { value: "normal", label: "Padrão", detail: "100%" },
  { value: "large", label: "Maior", detail: "110%" },
  { value: "largest", label: "Máxima", detail: "125%" },
];
function isFontScale(value: string | null): value is FontScale {
  return value === "small" || value === "normal" || value === "large" || value === "largest";
}
function syncCachedFontScale(account: AccountWithFontScale) {
  try {
    const cached = JSON.parse(localStorage.getItem("orbit_user") || "null") as AccountWithFontScale | null;
    if (!cached || cached.id !== account.id) return;
    localStorage.setItem("orbit_user", JSON.stringify({ ...cached, preferences: { ...cached.preferences, ...account.preferences } }));
    window.dispatchEvent(new Event("account:changed"));
  } catch { /* A preferência continua salva no servidor mesmo sem cache local. */ }
}
const fields: Array<[ProfileEditableField, string]> = [
  ["phone", "Telefone de contato"], ["preferred_contact", "Contato preferencial"], ["date_of_birth", "Data de nascimento"],
  ["education_level", "Escolaridade"], ["institution", "Instituição de ensino"], ["study_program", "Curso ou programa de estudos"],
  ["academic_background", "Formação e informações acadêmicas"], ["emergency_contact_name", "Nome do contato de emergência"], ["emergency_contact_phone", "Telefone do contato de emergência"],
  ["public_bio", "Apresentação para colegas"], ["public_interests", "Interesses para networking (separados por vírgulas)"],
];
function profileValues(payload?: Partial<ProfileValues>): ProfileValues {
  const metric = ["study_days", "lessons", "attendance", "practice_hours"].includes(String(payload?.weekly_learning_goal_metric))
    ? payload!.weekly_learning_goal_metric! : "study_days";
  const legacyDays = Number.isInteger(payload?.weekly_learning_goal_days) ? Number(payload?.weekly_learning_goal_days) : 3;
  const defaultTarget = metric === "study_days" ? legacyDays : metric === "attendance" ? 1 : metric === "practice_hours" ? 2 : 3;
  return { ...Object.fromEntries(fields.map(([field]) => [field, typeof payload?.[field] === "string" ? payload[field] : ""])), public_profile_enabled: payload?.public_profile_enabled === true, alumni_public_enabled: payload?.alumni_public_enabled === true, gamification_public_enabled: payload?.gamification_public_enabled === true, weekly_learning_goal_days: legacyDays, weekly_learning_goal_metric: metric, weekly_learning_goal_target: typeof payload?.weekly_learning_goal_target === "number" ? payload.weekly_learning_goal_target : defaultTarget, academic_reminders_enabled: payload?.academic_reminders_enabled !== false, academic_session_reminder_minutes: payload?.academic_session_reminder_minutes || "1440", academic_deadline_reminder_hours: payload?.academic_deadline_reminder_hours || "24", academic_document_reminder_days: payload?.academic_document_reminder_days || "7", custom_fields: payload?.custom_fields && typeof payload.custom_fields === "object" && !Array.isArray(payload.custom_fields) ? payload.custom_fields as Record<string, unknown> : {} } as ProfileValues;
}

export default function SuindaProfilePage() {
  const [fontScale, setFontScale] = useState<FontScale>("normal");
  const [savingFontScale, setSavingFontScale] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [savingEmailNotifications, setSavingEmailNotifications] = useState(false);
  const [workspaces, setWorkspaces] = useState<ProfileWorkspace[]>([]);
  const [values, setValues] = useState<Record<string, ProfileValues>>({});
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaChallengeId, setMfaChallengeId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    try {
      localStorage.removeItem("suinda:font-scale");
      const cached = JSON.parse(localStorage.getItem("orbit_user") || "null") as AccountWithFontScale | null;
      const saved = cached?.preferences?.fontScale;
      if (typeof saved === "string" && isFontScale(saved)) setFontScale(saved);
    } catch { /* A conta continua sendo consultada pela API abaixo. */ }
  }, []);

  async function changeFontScale(value: FontScale) {
    if (savingFontScale) return;
    const previous = fontScale;
    setFontScale(value);
    document.getElementById("suinda-root")?.setAttribute("data-suinda-font-scale", value);
    setSavingFontScale(true);
    try {
      const account = await api<AccountWithFontScale>("/account/preferences/font-scale", { method: "PATCH", body: JSON.stringify({ fontScale: value }) });
      syncCachedFontScale(account);
    } catch (cause) {
      setFontScale(previous);
      document.getElementById("suinda-root")?.setAttribute("data-suinda-font-scale", previous);
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o tamanho do texto na sua conta.");
    } finally { setSavingFontScale(false); }
  }

  async function changeEmailNotifications(value: boolean) {
    if (savingEmailNotifications) return;
    const previous = emailNotifications;
    setEmailNotifications(value);
    setSavingEmailNotifications(true);
    setError("");
    try {
      const account = await api<AccountWithFontScale>("/account/preferences", { method: "PATCH", body: JSON.stringify({ emailNotifications: value }) });
      syncCachedFontScale(account);
    } catch (cause) {
      setEmailNotifications(previous);
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a preferência de e-mail.");
    } finally { setSavingEmailNotifications(false); }
  }

  useEffect(() => {
    Promise.resolve().then(() => setSignedIn(Boolean(getToken())));
    if (!getToken()) { Promise.resolve().then(() => setLoading(false)); return; }
    Promise.all([api<ProfileWorkspace[]>("/extensions/suinda-learning/me/profiles"),api<{enabled:boolean}>("/account/mfa"),api<AccountWithFontScale>("/account")])
      .then(([items,mfa,account]) => {
        syncCachedFontScale(account);
        setEmailNotifications(account.preferences?.emailNotifications === true);
        setWorkspaces(items);
        setValues(Object.fromEntries(items.map((item) => [item.workspace_id, profileValues(item.profile?.payload)])));
        setMfaEnabled(mfa.enabled);
        const accountScale = account.preferences?.fontScale;
        if (typeof accountScale === "string" && isFontScale(accountScale)) {
          setFontScale(accountScale);
          document.getElementById("suinda-root")?.setAttribute("data-suinda-font-scale", accountScale);
        } else {
          setFontScale("normal");
          document.getElementById("suinda-root")?.setAttribute("data-suinda-font-scale", "normal");
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar seu perfil acadêmico."))
      .finally(() => setLoading(false));
  }, []);

  function update(workspaceId: string, field: ProfileEditableField, value: string) {
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], [field]: value } }));
  }
  function updateVisibility(workspaceId: string, value: boolean) {
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], public_profile_enabled: value } }));
  }
  function updateAlumniVisibility(workspaceId: string, value: boolean) {
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], alumni_public_enabled: value } }));
  }
  function updateGamificationVisibility(workspaceId: string, value: boolean) {
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], gamification_public_enabled: value } }));
  }
  function updateWeeklyGoalMetric(workspaceId: string, metric: ProfileValues["weekly_learning_goal_metric"]) {
    const target = metric === "study_days" ? 3 : metric === "attendance" ? 1 : metric === "practice_hours" ? 2 : 3;
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], weekly_learning_goal_metric: metric, weekly_learning_goal_target: target,
      ...(metric === "study_days" ? { weekly_learning_goal_days: target } : {}) } }));
  }
  function updateWeeklyGoalTarget(workspaceId: string, value: number) {
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], weekly_learning_goal_target: value,
      ...(current[workspaceId]?.weekly_learning_goal_metric === "study_days" ? { weekly_learning_goal_days: value } : {}) } }));
  }
  function updateReminderPreference(workspaceId: string, field: "academic_reminders_enabled" | "academic_session_reminder_minutes" | "academic_deadline_reminder_hours" | "academic_document_reminder_days", value: boolean | string) {
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], [field]: value } }));
  }
  function updateCustomField(workspaceId: string, fieldKey: string, value: unknown) {
    setValues((current) => ({ ...current, [workspaceId]: { ...current[workspaceId], custom_fields: { ...current[workspaceId]?.custom_fields, [fieldKey]: value } } }));
  }

  async function save(item: ProfileWorkspace) {
    if (saving) return;
    setSaving(item.workspace_id);
    setMessage((current) => ({ ...current, [item.workspace_id]: "" }));
    try {
      await api(`/extensions/suinda-learning/me/profiles/${encodeURIComponent(item.workspace_id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...values[item.workspace_id], expected_revision: item.profile?.revision, operation_key: crypto.randomUUID() }),
      });
      const updated = await api<ProfileWorkspace[]>("/extensions/suinda-learning/me/profiles");
      setWorkspaces(updated);
      setValues(Object.fromEntries(updated.map((entry) => [entry.workspace_id, profileValues(entry.profile?.payload)])));
      setMessage((current) => ({ ...current, [item.workspace_id]: "Perfil acadêmico salvo." }));
    } catch (cause) {
      setMessage((current) => ({ ...current, [item.workspace_id]: cause instanceof Error ? cause.message : "Não foi possível salvar o perfil." }));
    } finally { setSaving(""); }
  }

  async function requestMfaChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMfaBusy(true); setMfaError(""); setMfaMessage("");
    try {
      const result=await api<{challenge_id:string;email_hint:string}>("/account/mfa/challenge",{method:"POST",body:JSON.stringify({action:mfaEnabled?"disable":"enable",current_password:mfaPassword})});
      setMfaPassword(""); setMfaChallengeId(result.challenge_id); setMfaMessage(`Enviamos um código de confirmação para ${result.email_hint}.`);
    } catch(cause) { setMfaError(cause instanceof Error?cause.message:"Não foi possível enviar o código."); }
    finally { setMfaBusy(false); }
  }
  async function confirmMfaChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMfaBusy(true); setMfaError("");
    try {
      const result=await api<{enabled:boolean}>("/account/mfa/confirm",{method:"POST",body:JSON.stringify({challenge_id:mfaChallengeId,code:mfaCode})});
      setMfaEnabled(result.enabled); setMfaChallengeId(""); setMfaCode("");
      setMfaMessage(result.enabled?"Verificação em duas etapas ativada.":"Verificação em duas etapas desativada.");
    } catch(cause) { setMfaError(cause instanceof Error?cause.message:"Não foi possível confirmar o código."); }
    finally { setMfaBusy(false); }
  }
  async function downloadPersonalData() {
    setError("");
    try {
      const blob = await apiBlob("/extensions/suinda-learning/me/data-export");
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "suinda-dados-pessoais.json"; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível exportar seus dados."); }
  }

  return <main className="min-h-screen bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-8 sm:py-10">
    <div className="mx-auto max-w-4xl">
      <Link href="/suinda" className="inline-flex min-h-10 items-center gap-2 text-sm text-[#b6c2cf] hover:text-cyan-100"><ArrowLeft size={16} aria-hidden="true" /> Minha jornada</Link>
      <header className="mt-5 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.11),_transparent_45%),#101621] p-6 sm:p-8">
        <div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-cyan-200/10 text-cyan-100"><GraduationCap size={24} aria-hidden="true" /></span><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-cyan-200">Suindá</p><h1 className="mt-1 text-2xl font-semibold text-white">Perfil acadêmico</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#b6c2cf]">Mantenha seus contatos e informações de formação atualizados em cada instituição onde você tem uma inscrição.</p></div></div>
        <div className="mt-5 flex flex-wrap gap-4"><Link href="/profile" className="inline-flex min-h-9 items-center gap-2 text-sm text-cyan-100 underline underline-offset-4"><UserRound size={15} aria-hidden="true" /> Nome e foto da conta Orbit</Link><Link href="/suinda/alumni" className="inline-flex min-h-9 items-center gap-2 text-sm text-cyan-100 underline underline-offset-4">Comunidade de ex-alunos</Link>{signedIn && <><button type="button" onClick={() => void downloadPersonalData()} className="inline-flex min-h-9 items-center text-sm text-cyan-100 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">Baixar meus dados acadêmicos</button><Link href="/suinda/privacy" className="inline-flex min-h-9 items-center gap-1.5 text-sm text-cyan-100 underline underline-offset-4"><ShieldCheck size={15} aria-hidden="true" /> Solicitações de privacidade</Link></>}</div>
      </header>
      <section aria-labelledby="suinda-font-scale-heading" className="mt-6 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-6">
        <h2 id="suinda-font-scale-heading" className="text-base font-semibold text-white">Tamanho do texto</h2>
        <p id="suinda-font-scale-description" className="mt-1 text-sm leading-6 text-[#b6c2cf]">Ajuste a escala de leitura da plataforma Suindá. A preferência fica vinculada à sua conta Orbit.</p>
        <fieldset aria-describedby="suinda-font-scale-description" aria-busy={savingFontScale} className="mt-4">
          <legend className="sr-only">Escala do texto</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {fontScaleOptions.map((option) => <label key={option.value} className="cursor-pointer rounded-xl border border-[#3b4754] text-center has-[:checked]:border-cyan-200 has-[:checked]:bg-cyan-200/10 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan-200">
              <input type="radio" name="suinda-font-scale" value={option.value} checked={fontScale === option.value} onChange={() => void changeFontScale(option.value)} className="sr-only" />
              <span className="block px-3 py-2.5 text-sm font-medium text-[#dee4ea]">{option.label}</span>
              <span aria-hidden="true" className="block pb-2 text-xs text-[#b6c2cf]">{option.detail}</span>
            </label>)}
          </div>
          {savingFontScale && <span role="status" className="sr-only">Salvando o tamanho do texto…</span>}
        </fieldset>
      </section>
      {signedIn && <section aria-labelledby="suinda-email-notifications-heading" className="mt-6 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-6">
        <h2 id="suinda-email-notifications-heading" className="text-base font-semibold text-white">Notificações acadêmicas por e-mail</h2>
        <p className="mt-1 text-sm leading-6 text-[#b6c2cf]">Receba por e-mail as notificações que também chegam à central do Orbit. Exige e-mail confirmado e SMTP configurado; você pode desligar esta opção a qualquer momento.</p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-[#b6c2cf]"><input type="checkbox" checked={emailNotifications} disabled={savingEmailNotifications} onChange={(event) => void changeEmailNotifications(event.target.checked)} className="mt-1 size-4 accent-cyan-200" /><span>Enviar notificações da central por e-mail<span className="mt-1 block text-xs text-[#9fadbc]">Esta preferência vale para sua conta Orbit em todos os ambientes conectados.</span></span></label>
      </section>}
      <TeachingProfilePanel />

      {signedIn&&!loading&&<section className="mt-6 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7"><h2 className="text-lg font-semibold text-white">Verificação em duas etapas</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-[#b6c2cf]">{mfaEnabled?"O login exige a senha e um código enviado ao e-mail verificado da conta.":"Adicione um código de confirmação por e-mail depois da senha. Confirme seu endereço antes de ativar."}</p>{mfaMessage&&<p role="status" className="mt-3 text-sm text-emerald-200">{mfaMessage}</p>}{mfaError&&<p role="alert" className="mt-3 text-sm text-rose-200">{mfaError}</p>}{mfaChallengeId?<form onSubmit={(event)=>void confirmMfaChange(event)} className="mt-4 grid max-w-md gap-3"><label className="text-sm font-medium text-[#b6c2cf]">Código de seis dígitos<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event)=>setMfaCode(event.target.value.replace(/\D/g,"").slice(0,6))} className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm tracking-[.3em] text-white" /></label><div className="flex gap-2"><button disabled={mfaBusy||mfaCode.length!==6} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{mfaBusy?"Aguarde…":"Confirmar código"}</button><button type="button" disabled={mfaBusy} onClick={()=>{setMfaChallengeId("");setMfaCode("");setMfaMessage("");}} className="min-h-10 rounded-lg border border-[#3b4754] px-4 text-sm text-[#b6c2cf]">Cancelar</button></div></form>:<form onSubmit={(event)=>void requestMfaChange(event)} className="mt-4 grid max-w-md gap-3"><label className="text-sm font-medium text-[#b6c2cf]">Senha atual<input required type="password" maxLength={200} autoComplete="current-password" value={mfaPassword} onChange={(event)=>setMfaPassword(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" /></label><button disabled={mfaBusy||!mfaPassword} className="min-h-10 justify-self-start rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{mfaBusy?"Enviando…":mfaEnabled?"Desativar verificação em duas etapas":"Ativar verificação em duas etapas"}</button></form>}</section>}

      {loading && <p role="status" className="mt-7 text-sm text-[#9fadbc]">Carregando seus perfis…</p>}
      {error && <p role="alert" className="mt-6 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</p>}
      {!signedIn && !loading && <section className="mt-7 rounded-xl border border-[#3b4754] bg-[#2c333a] p-5"><p className="text-sm text-[#b6c2cf]">Entre na sua conta para acessar o perfil acadêmico.</p><Link href="/" className="mt-3 inline-flex min-h-9 items-center text-sm font-medium text-cyan-100 underline">Entrar</Link></section>}
      {!loading && signedIn && !error && workspaces.length === 0 && <section className="mt-7 rounded-xl border border-dashed border-white/15 bg-[#2c333a] p-6 text-center"><p className="text-sm text-[#b6c2cf]">O perfil acadêmico fica disponível depois que você enviar uma inscrição.</p><Link href="/suinda/catalog" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950">Explorar cursos</Link></section>}

      <div className="mt-7 grid gap-5">{workspaces.map((item) => <section key={item.workspace_id} className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{item.workspace_name}</h2><p className="mt-1 text-xs text-[#9fadbc]">{item.enrollment_count} {item.enrollment_count === 1 ? "inscrição" : "inscrições"} · {item.profile ? `versão ${item.profile.revision}` : "perfil ainda não preenchido"}</p></div>{item.profile && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-200/10 px-3 py-1 text-xs text-emerald-100"><Check size={13} aria-hidden="true" /> {item.profile.payload.public_profile_enabled ? "Visível a colegas do curso" : "Privado"}</span>}</div>
        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-[#3b4754] bg-black/10 p-4"><input type="checkbox" checked={values[item.workspace_id]?.public_profile_enabled || false} onChange={(event) => updateVisibility(item.workspace_id, event.target.checked)} className="mt-1 size-4 accent-cyan-200" /><span><span className="block text-sm font-medium text-[#b6c2cf]">Mostrar meu perfil aos colegas do curso</span><span className="mt-1 block text-xs leading-5 text-[#9fadbc]">Com sua autorização, alunos ativos da mesma edição verão seu nome, foto, apresentação e interesses. Você também poderá enviar solicitações de conexão. E-mail, telefone, formação acadêmica e contato de emergência permanecem privados.</span></span></label>
        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-cyan-200/10 bg-cyan-200/[0.03] p-4"><input type="checkbox" checked={values[item.workspace_id]?.alumni_public_enabled || false} onChange={(event) => updateAlumniVisibility(item.workspace_id, event.target.checked)} className="mt-1 size-4 accent-cyan-200" /><span><span className="block text-sm font-medium text-[#b6c2cf]">Participar da comunidade de ex-alunos</span><span className="mt-1 block text-xs leading-5 text-[#9fadbc]">Disponível após concluir e regularizar uma matrícula. Ao ativar, seu nome, foto, apresentação e interesses ficam visíveis a ex-alunos que também optaram por participar, nesta edição. Você pode sair da comunidade quando quiser.</span></span></label>
        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-violet-200/10 bg-violet-200/[0.03] p-4"><input type="checkbox" checked={values[item.workspace_id]?.gamification_public_enabled || false} onChange={(event) => updateGamificationVisibility(item.workspace_id, event.target.checked)} className="mt-1 size-4 accent-violet-200" /><span><span className="block text-sm font-medium text-[#b6c2cf]">Participar do ranking de aprendizagem</span><span className="mt-1 block text-xs leading-5 text-[#9fadbc]">Quando ativado, seu nome e seus pontos aparecem no ranking da edição. Esta opção é independente do perfil público e pode ser desativada a qualquer momento. Sem ativá-la, você continua vendo seus pontos, nível, metas e emblemas sem aparecer no ranking.</span></span></label>
        <div className="mb-4 rounded-xl border border-violet-200/10 bg-violet-200/[0.03] p-4"><p className="text-sm font-medium text-[#b6c2cf]">Meta pessoal semanal</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-[#b6c2cf]">Indicador<select aria-label="Indicador da meta pessoal semanal" value={values[item.workspace_id]?.weekly_learning_goal_metric || "study_days"} onChange={(event) => updateWeeklyGoalMetric(item.workspace_id, event.target.value as ProfileValues["weekly_learning_goal_metric"])} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white"><option value="study_days">Dias com atividade</option><option value="lessons">Aulas concluídas</option><option value="attendance">Presenças registradas</option><option value="practice_hours">Horas práticas validadas</option></select></label><label className="text-xs font-medium text-[#b6c2cf]">Meta por semana<input aria-label="Valor da meta pessoal semanal" type="number" min={values[item.workspace_id]?.weekly_learning_goal_metric === "practice_hours" ? 0.5 : 1} max={values[item.workspace_id]?.weekly_learning_goal_metric === "study_days" || values[item.workspace_id]?.weekly_learning_goal_metric === "attendance" ? 7 : values[item.workspace_id]?.weekly_learning_goal_metric === "lessons" ? 21 : 40} step={values[item.workspace_id]?.weekly_learning_goal_metric === "practice_hours" ? 0.5 : 1} value={values[item.workspace_id]?.weekly_learning_goal_target ?? 3} onChange={(event) => updateWeeklyGoalTarget(item.workspace_id, Number(event.target.value))} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" /></label></div><p className="mt-2 text-xs leading-5 text-[#9fadbc]">A contagem usa somente registros confirmados pelo sistema: conclusão de aula, chamada presente/atrasada ou prática validada. O padrão continua sendo três dias ativos.</p></div>
        <div className="mb-5 rounded-xl border border-cyan-200/10 bg-cyan-200/[0.03] p-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm font-medium text-[#b6c2cf]"><input type="checkbox" checked={values[item.workspace_id]?.academic_reminders_enabled ?? true} onChange={(event) => updateReminderPreference(item.workspace_id, "academic_reminders_enabled", event.target.checked)} className="mt-1 size-4 accent-cyan-200" /><span>Receber lembretes acadêmicos<span className="mt-1 block text-xs font-normal leading-5 text-[#9fadbc]">Aplica-se aos encontros, avaliações, pesquisas e vencimentos de documentos deste workspace. A preferência global de notificações da conta Orbit continua sendo respeitada.</span></span></label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-[#b6c2cf]">Lembrete de encontro<select disabled={!values[item.workspace_id]?.academic_reminders_enabled} value={values[item.workspace_id]?.academic_session_reminder_minutes || "1440"} onChange={(event) => updateReminderPreference(item.workspace_id, "academic_session_reminder_minutes", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white disabled:opacity-50"><option value="15">15 minutos antes</option><option value="60">1 hora antes</option><option value="360">6 horas antes</option><option value="1440">24 horas antes</option><option value="2880">48 horas antes</option></select><span className="mt-1 block text-xs font-normal text-[#9fadbc]">Se escolher mais de 15 minutos, aulas online com link também recebem um aviso fixo 15 minutos antes.</span></label>
            <label className="text-sm font-medium text-[#b6c2cf]">Lembrete de prazo<select disabled={!values[item.workspace_id]?.academic_reminders_enabled} value={values[item.workspace_id]?.academic_deadline_reminder_hours || "24"} onChange={(event) => updateReminderPreference(item.workspace_id, "academic_deadline_reminder_hours", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white disabled:opacity-50"><option value="1">1 hora antes</option><option value="6">6 horas antes</option><option value="12">12 horas antes</option><option value="24">24 horas antes</option><option value="48">48 horas antes</option></select></label>
            <label className="text-sm font-medium text-[#b6c2cf]">Vencimento de documentos<select disabled={!values[item.workspace_id]?.academic_reminders_enabled} value={values[item.workspace_id]?.academic_document_reminder_days || "7"} onChange={(event) => updateReminderPreference(item.workspace_id, "academic_document_reminder_days", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white disabled:opacity-50"><option value="3">3 dias antes</option><option value="7">7 dias antes</option><option value="14">14 dias antes</option><option value="30">30 dias antes</option></select><span className="mt-1 block text-xs font-normal text-[#9fadbc]">Apenas documentos aprovados com data de validade.</span></label>
          </div>
        </div>
        {item.enrollment_count > 0 && <SuindaWhatsAppConsent key={item.workspace_id} workspaceId={item.workspace_id} />}
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save(item); }}>
          {fields.map(([field, label]) => <label key={field} className={`block text-sm font-medium text-[#b6c2cf] ${field === "academic_background" ? "sm:col-span-2" : ""}`}>{label}
            {field === "preferred_contact" ? <select className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" value={values[item.workspace_id]?.[field] || ""} onChange={(event) => update(item.workspace_id, field, event.target.value)}><option value="">Selecione</option><option value="email">E-mail da conta</option><option value="phone">Telefone</option></select>
              : field === "education_level" ? <select className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" value={values[item.workspace_id]?.[field] || ""} onChange={(event) => update(item.workspace_id, field, event.target.value)}><option value="">Selecione</option><option value="secondary">Ensino médio</option><option value="technical">Técnico</option><option value="undergraduate">Graduação</option><option value="postgraduate">Pós-graduação</option><option value="other_education">Outro</option><option value="not_informed">Prefiro não informar</option></select>
              : field === "academic_background" || field === "public_bio" ? <textarea className="mt-1 min-h-28 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 py-2 text-sm text-white" maxLength={field === "public_bio" ? 500 : 4000} value={values[item.workspace_id]?.[field] || ""} onChange={(event) => update(item.workspace_id, field, event.target.value)} />
                  : <input className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white" type={field === "date_of_birth" ? "date" : field.includes("phone") || field === "phone" ? "tel" : "text"} maxLength={field.includes("phone") || field === "phone" ? 40 : field === "public_interests" ? 300 : undefined} value={values[item.workspace_id]?.[field] || ""} onChange={(event) => update(item.workspace_id, field, event.target.value)} />}
          </label>)}
          {item.profile_fields.map((field) => {
            const value = values[item.workspace_id]?.custom_fields?.[field.field_key];
            const controlClass = "mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-white";
            return <label key={field.field_key} className="block text-sm font-medium text-[#b6c2cf]">{field.label}{field.required && <span aria-hidden="true" className="ml-1 text-rose-200">*</span>}
              {field.field_type === "textarea" ? <textarea required={field.required} maxLength={field.max_length || 2000} value={typeof value === "string" ? value : ""} onChange={(event) => updateCustomField(item.workspace_id, field.field_key, event.target.value)} className={`${controlClass} min-h-28 py-2`} />
                : field.field_type === "select" ? <select required={field.required} value={typeof value === "string" ? value : ""} onChange={(event) => updateCustomField(item.workspace_id, field.field_key, event.target.value)} className={controlClass}><option value="">Selecione</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
            : field.field_type === "multiselect" ? <span role="group" aria-label={field.label} className="mt-2 grid gap-2">{field.options.map((option) => { const selected = Array.isArray(value) && value.includes(option); return <span key={option} className="flex items-center gap-2 font-normal text-[#b6c2cf]"><input type="checkbox" aria-label={`${field.label}: ${option}`} checked={selected} onChange={(event) => updateCustomField(item.workspace_id, field.field_key, event.target.checked ? [...(Array.isArray(value) ? value : []), option] : (Array.isArray(value) ? value.filter((entry) => entry !== option) : []))} className="size-4 accent-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200" />{option}</span>; })}</span>
                    : field.field_type === "checkbox" ? <span className="mt-2 flex items-center gap-2 font-normal"><input type="checkbox" aria-label={field.label} checked={value === true} onChange={(event) => updateCustomField(item.workspace_id, field.field_key, event.target.checked)} className="size-4 accent-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200" />Sim</span>
                    : <input required={field.required} type={field.field_type === "phone" ? "tel" : field.field_type} maxLength={field.field_type === "text" || field.field_type === "phone" ? field.max_length || 240 : undefined} value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onChange={(event) => updateCustomField(item.workspace_id, field.field_key, field.field_type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)} className={controlClass} />}
              {field.field_key === "professional_profile" && <span className="mt-1 block text-xs font-normal leading-5 text-[#9fadbc]">Este valor determina quais trilhas obrigatórias por perfil profissional se aplicam a você.</span>}
            </label>;
          })}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="submit" disabled={Boolean(saving)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-60"><Save size={15} aria-hidden="true" />{saving === item.workspace_id ? "Salvando…" : "Salvar perfil"}</button>{message[item.workspace_id] && <p role="status" className={`text-sm ${message[item.workspace_id] === "Perfil acadêmico salvo." ? "text-emerald-200" : "text-rose-200"}`}>{message[item.workspace_id]}</p>}</div>
        </form>
      </section>)}</div>
    </div>
  </main>;
}
