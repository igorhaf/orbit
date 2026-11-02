"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, getToken, profileSimulationHeaders } from "@/lib/api";

type Slot = { weekday: number; start_time: string; end_time: string; timezone: string };
type ProfileItem = { workspace_id: string; workspace_name: string; profile: { id: string; revision: number; payload: { staff_role?: string; recurring_availability?: Slot[] } } | null };
type Credential = { id: string; attachment_id: string | null; revision: number; state: string; staff_user_id: string; category: string; file_name: string; mime_type: string; size_bytes: number; scan_status: string; expires_at: string | null; description: string | null };
type StaffMember = { staff_user_id: string; staff_name: string; roles: string[]; units?: Array<{ id: string; title: string }> };
type Honorarium = { id: string; staff_user_id: string; institution_unit_record_id: string | null; unit_name: string | null; period_start: string; period_end: string; amount: string; paid_amount: string; outstanding_amount: string; currency: string; description: string; created_at: string };
const input = "min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-[#dee4ea] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200";
const weekdayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function StaffProfessional({ workspaceId, canManage = false }: { workspaceId: string; canManage?: boolean }) {
  const [profile, setProfile] = useState<ProfileItem | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [role, setRole] = useState("instructor");
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [honoraria, setHonoraria] = useState<Honorarium[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("diploma");
  const [expires, setExpires] = useState("");
  const [staffUserId, setStaffUserId] = useState("");
  const [unitRecordId, setUnitRecordId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [paymentBusyId, setPaymentBusyId] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentOperationKeys, setPaymentOperationKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [profiles, docs, entries, directory] = await Promise.all([
      api<ProfileItem[]>("/extensions/suinda-learning/me/teaching-profiles"),
      api<Credential[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/staff-credentials`),
      api<Honorarium[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/staff-honoraria`),
      api<StaffMember[]>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/staff-directory`),
    ]);
    const own = profiles.find((item) => item.workspace_id === workspaceId) || null;
    setProfile(own);
    setRole(own?.profile?.payload.staff_role || "instructor");
    setSlots(own?.profile?.payload.recurring_availability || []);
    setCredentials(docs); setHonoraria(entries); setStaff(directory);
  }, [workspaceId]);
  useEffect(() => { void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados profissionais.")); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);
  function updateSlot(index: number, patch: Partial<Slot>) { setSlots((current) => current.map((slot, i) => i === index ? { ...slot, ...patch } : slot)); }
  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/me/teaching-profiles/${encodeURIComponent(workspaceId)}`, { method: "PUT", body: JSON.stringify({ staff_role: role, recurring_availability: slots, expected_revision: profile?.profile?.revision, operation_key: crypto.randomUUID() }) });
      await load(); setMessage("Disponibilidade e função profissional salvas em nova revisão.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o perfil."); } finally { setBusy(false); }
  }
  function readBase64(selected: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Não foi possível ler o arquivo.")); reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || ""); reader.readAsDataURL(selected); }); }
  async function uploadCredential(event: FormEvent) {
    event.preventDefault(); if (!file) return; setBusy(true); setError(""); setMessage("");
    try { await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/me/staff-credentials`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), category, expires_at: expires || null, file_name: file.name, mime_type: file.type, data_base64: await readBase64(file) }) }); setFile(null); await load(); setMessage("Credencial enviada com acesso privado."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar a credencial."); } finally { setBusy(false); }
  }
  async function downloadCredential(item: Credential) {
    setError("");
    try { if (!item.attachment_id) throw new Error("O arquivo não está disponível nesta revisão."); const token = getToken(); const response = await fetch(`/api/extensions/suinda-learning/staff-credentials/${encodeURIComponent(item.id)}/files/${encodeURIComponent(item.attachment_id)}`, { headers: {...(token ? { Authorization: `Bearer ${token}` } : {}), ...profileSimulationHeaders()} }); if (!response.ok) throw new Error("Não foi possível baixar a credencial."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = item.file_name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar a credencial."); }
  }
  async function createHonorarium(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/staff-honoraria`, { method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), staff_user_id: staffUserId, institution_unit_record_id: unitRecordId || null, period_start: periodStart, period_end: periodEnd, amount: Number(amount), currency: "BRL", description }) }); setStaffUserId(""); setUnitRecordId(""); setAmount(""); setDescription(""); await load(); setMessage("Lançamento imutável registrado. Para corrigir, registre um novo ajuste documentado."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar os honorários."); } finally { setBusy(false); }
  }
  function clearPaymentOperationKey(honorariumId: string) {
    setPaymentOperationKeys((current) => {
      const next = { ...current };
      delete next[honorariumId];
      return next;
    });
  }
  async function recordHonorariumPayment(event: FormEvent<HTMLFormElement>, item: Honorarium) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const paidOn = String(values.get("paid_on") || "");
    const paymentAmount = Number(values.get("amount"));
    const outstanding = Number(item.outstanding_amount);
    if (!paidOn || !Number.isFinite(paymentAmount) || paymentAmount <= 0 || paymentAmount > outstanding) {
      setPaymentError("Informe uma data e um valor maior que zero, limitado ao saldo em aberto.");
      setPaymentMessage("");
      return;
    }
    const operationKey = paymentOperationKeys[item.id] || crypto.randomUUID();
    setPaymentOperationKeys((current) => ({ ...current, [item.id]: operationKey }));
    setPaymentBusyId(item.id);
    setPaymentError("");
    setPaymentMessage("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/staff-honoraria/${encodeURIComponent(item.id)}/payments`, {
        method: "POST",
        body: JSON.stringify({
          operation_key: operationKey,
          paid_on: paidOn,
          amount: paymentAmount,
          reference: String(values.get("reference") || "").trim() || undefined,
          notes: String(values.get("notes") || "").trim() || undefined,
        }),
      });
      clearPaymentOperationKey(item.id);
      setPaymentMessage("Baixa externa registrada. Nenhuma transferência foi realizada pelo Suindá.");
      form.reset();
      try {
        await load();
      } catch {
        setPaymentError("A baixa foi registrada, mas não foi possível atualizar o saldo exibido. Recarregue os dados.");
      }
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "Não foi possível registrar a baixa externa.");
    } finally {
      setPaymentBusyId("");
    }
  }
  return <section aria-labelledby="staff-professional-heading" className="mt-7 space-y-5 rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-5 sm:p-6">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Equipe acadêmica</p><h2 id="staff-professional-heading" className="mt-1 text-lg font-semibold text-white">Dados profissionais</h2><p className="mt-1 text-sm text-[#9fadbc]">Disponibilidade recorrente, credenciais privadas e histórico manual de honorários.</p></header>
    {error && <p role="alert" className="rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p>}{message && <p role="status" className="text-sm text-emerald-200">{message}</p>}
    {profile && <form onSubmit={(event) => void saveProfile(event)} className="space-y-4 rounded-xl border border-[#3b4754] p-4">
      <h3 className="font-semibold text-white">Função e disponibilidade semanal</h3><label className="block text-sm text-[#b6c2cf]">Função<select className={`${input} mt-1`} value={role} onChange={(event) => setRole(event.target.value)}><option value="instructor">Professor</option><option value="preceptor">Preceptor</option><option value="coordinator">Coordenador</option><option value="tutor">Tutor</option></select></label>
      {slots.map((slot, index) => <fieldset key={index} className="grid gap-2 rounded-lg border border-white/[0.08] p-3 sm:grid-cols-4"><legend className="sr-only">Faixa semanal {index + 1}</legend><label className="text-xs text-[#9fadbc]">Dia<select className={`${input} mt-1`} value={slot.weekday} onChange={(event) => updateSlot(index, { weekday: Number(event.target.value) })}>{weekdayNames.map((name, day) => <option key={day} value={day}>{name}</option>)}</select></label><label className="text-xs text-[#9fadbc]">Início<input className={`${input} mt-1`} type="time" value={slot.start_time} onChange={(event) => updateSlot(index, { start_time: event.target.value })} /></label><label className="text-xs text-[#9fadbc]">Fim<input className={`${input} mt-1`} type="time" value={slot.end_time} onChange={(event) => updateSlot(index, { end_time: event.target.value })} /></label><label className="text-xs text-[#9fadbc]">Fuso IANA<input className={`${input} mt-1`} value={slot.timezone} onChange={(event) => updateSlot(index, { timezone: event.target.value })} placeholder="America/Recife" /></label><button type="button" onClick={() => setSlots((current) => current.filter((_, i) => i !== index))} className="text-left text-xs text-rose-200 sm:col-span-4">Remover faixa</button></fieldset>)}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={slots.length >= 42} onClick={() => setSlots((current) => [...current, { weekday: 1, start_time: "09:00", end_time: "12:00", timezone: "America/Recife" }])} className="min-h-10 rounded-lg border border-white/15 px-3 text-sm text-[#b6c2cf] disabled:opacity-50">Adicionar faixa</button><button disabled={busy} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">Salvar revisão</button></div>
    </form>}
    <section className="space-y-3 rounded-xl border border-[#3b4754] p-4"><div><h3 className="font-semibold text-white">Credenciais profissionais</h3><p className="mt-1 text-xs text-[#9fadbc]">Arquivos privados, acessíveis somente à pessoa titular e à gestão acadêmica autorizada.</p></div>
      {profile && <form onSubmit={(event) => void uploadCredential(event)} className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-[#b6c2cf]">Tipo<select className={`${input} mt-1`} value={category} onChange={(event) => setCategory(event.target.value)}><option value="diploma">Diploma</option><option value="license">Registro profissional</option><option value="certificate">Certificado</option><option value="other">Outro</option></select></label><label className="text-sm text-[#b6c2cf]">Validade<input className={`${input} mt-1`} type="date" value={expires} onChange={(event) => setExpires(event.target.value)} /></label><label className="text-sm text-[#b6c2cf] sm:col-span-2">Arquivo (PDF, PNG ou JPEG; até 8 MB)<input className={`${input} mt-1 py-2`} type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button disabled={!file || busy} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50 sm:col-span-2">Enviar credencial</button></form>}
      {credentials.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.08] p-3 text-sm"><span className="text-[#b6c2cf]">{canManage ? `${staff.find((member) => member.staff_user_id === item.staff_user_id)?.staff_name || "Equipe"} · ` : ""}{item.file_name} · {item.category}{item.expires_at ? ` · validade ${item.expires_at.slice(0, 10)}` : ""}</span><button type="button" onClick={() => void downloadCredential(item)} className="text-cyan-200 underline">Baixar</button></div>)}
    </section>
    <section aria-labelledby="staff-honoraria-heading" className="space-y-4 rounded-xl border border-[#3b4754] p-4">
      <div><h3 id="staff-honoraria-heading" className="font-semibold text-white">Honorários</h3><p className="mt-1 text-xs text-[#9fadbc]">Baixas registram pagamentos realizados fora do Suindá; a plataforma não transfere valores.</p></div>
      {canManage && <form onSubmit={(event) => void createHonorarium(event)} className="grid gap-3 rounded-lg border border-white/[0.08] p-3 sm:grid-cols-2"><h4 className="font-medium text-white sm:col-span-2">Lançar honorários</h4><label className="text-sm text-[#b6c2cf]">Pessoa vinculada<select required className={`${input} mt-1`} value={staffUserId} onChange={(event) => { const nextId = event.target.value; setStaffUserId(nextId); const available = staff.find((member) => member.staff_user_id === nextId)?.units || []; setUnitRecordId(available.length === 1 ? available[0].id : ""); }}><option value="">Selecione</option>{staff.map((member) => <option key={member.staff_user_id} value={member.staff_user_id}>{member.staff_name} · {member.roles.join(", ")}</option>)}</select></label><label className="text-sm text-[#b6c2cf]">Unidade<select className={`${input} mt-1`} value={unitRecordId} onChange={(event) => setUnitRecordId(event.target.value)}><option value="">Detectar pela atribuição</option>{(staff.find((member) => member.staff_user_id === staffUserId)?.units || []).map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label><label className="text-sm text-[#b6c2cf]">Valor devido (BRL)<input required min="0.01" step="0.01" type="number" className={`${input} mt-1`} value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="text-sm text-[#b6c2cf]">Início<input required type="date" className={`${input} mt-1`} value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label><label className="text-sm text-[#b6c2cf]">Fim<input required type="date" className={`${input} mt-1`} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label><label className="text-sm text-[#b6c2cf] sm:col-span-2">Descrição / referência<input required maxLength={1000} className={`${input} mt-1`} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button disabled={busy} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50 sm:col-span-2">Registrar honorários</button></form>}
      {paymentError && <p id="suinda-honorarium-payment-error" role="alert" className="rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{paymentError}</p>}
      {paymentMessage && <p role="status" aria-live="polite" className="text-sm text-emerald-200">{paymentMessage}</p>}
      {honoraria.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-[#9fadbc]">Nenhum lançamento de honorários disponível.</p>}
      {honoraria.map((item) => {
        const due = Number(item.amount);
        const paid = Number(item.paid_amount);
        const outstanding = Number(item.outstanding_amount);
        const formatMoney = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.currency }).format(Number.isFinite(value) ? value : 0);
        const paymentFormId = `honorarium-payment-${item.id}`;
        return <article key={item.id} aria-labelledby={`${paymentFormId}-title`} className="space-y-3 rounded-lg border border-white/[0.08] p-3 text-sm">
          <div><h4 id={`${paymentFormId}-title`} className="font-medium text-white">{item.period_start.slice(0, 10)} a {item.period_end.slice(0, 10)}</h4><p className="mt-1 text-[#9fadbc]">{canManage ? `${staff.find((member) => member.staff_user_id === item.staff_user_id)?.staff_name || "Profissional"} · ` : ""}{item.unit_name ? `${item.unit_name} · ` : ""}{item.description}</p></div>
          <dl className="grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-white/[0.03] p-2"><dt className="text-xs text-[#9fadbc]">Devido</dt><dd className="mt-1 font-medium text-white">{formatMoney(due)}</dd></div><div className="rounded-lg bg-white/[0.03] p-2"><dt className="text-xs text-[#9fadbc]">Pago</dt><dd className="mt-1 font-medium text-emerald-200">{formatMoney(paid)}</dd></div><div className="rounded-lg bg-white/[0.03] p-2"><dt className="text-xs text-[#9fadbc]">Saldo em aberto</dt><dd className="mt-1 font-medium text-amber-100">{formatMoney(outstanding)}</dd></div></dl>
          {canManage && outstanding > 0 && <form id={paymentFormId} onSubmit={(event) => void recordHonorariumPayment(event, item)} aria-describedby={`${paymentFormId}-help`} className="grid gap-3 border-t border-white/[0.08] pt-3 sm:grid-cols-2">
            <p id={`${paymentFormId}-help`} className="text-xs text-[#9fadbc] sm:col-span-2">Registre uma baixa total ou parcial referente a um pagamento já realizado externamente.</p>
            <label htmlFor={`${paymentFormId}-date`} className="text-sm text-[#b6c2cf]">Data do pagamento<input id={`${paymentFormId}-date`} name="paid_on" required type="date" className={`${input} mt-1`} onChange={() => clearPaymentOperationKey(item.id)} /></label>
            <label htmlFor={`${paymentFormId}-amount`} className="text-sm text-[#b6c2cf]">Valor da baixa<input id={`${paymentFormId}-amount`} name="amount" required min="0.01" max={Number.isFinite(outstanding) ? outstanding : undefined} step="0.01" type="number" inputMode="decimal" className={`${input} mt-1`} onChange={() => clearPaymentOperationKey(item.id)} /></label>
            <label htmlFor={`${paymentFormId}-reference`} className="text-sm text-[#b6c2cf]">Referência (opcional)<input id={`${paymentFormId}-reference`} name="reference" maxLength={200} className={`${input} mt-1`} onChange={() => clearPaymentOperationKey(item.id)} /></label>
            <label htmlFor={`${paymentFormId}-notes`} className="text-sm text-[#b6c2cf]">Observações (opcional)<input id={`${paymentFormId}-notes`} name="notes" maxLength={1000} className={`${input} mt-1`} onChange={() => clearPaymentOperationKey(item.id)} /></label>
            <button type="submit" disabled={Boolean(paymentBusyId)} aria-busy={paymentBusyId === item.id} aria-describedby={`${paymentFormId}-help${paymentError ? " suinda-honorarium-payment-error" : ""}`} className="min-h-10 rounded-lg border border-cyan-200/20 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-200/[0.06] disabled:opacity-50 sm:col-span-2">{paymentBusyId === item.id ? "Registrando baixa…" : "Registrar pagamento externo"}</button>
          </form>}
          {canManage && outstanding <= 0 && <p className="text-sm text-emerald-200">Honorários quitados.</p>}
        </article>;
      })}
    </section>
  </section>;
}

export function StaffProfessionalManagement() {
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"instructor" | "tutor" | "preceptor" | "coordinator">("instructor");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  useEffect(() => {
    void api<Array<{ id: string; name: string }>>("/workspaces").then((items) => {
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id || "");
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar os workspaces."));
  }, []);
  async function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) {
      setInviteError("Selecione um workspace antes de enviar o convite.");
      return;
    }
    setInviteBusy(true);
    setInviteError("");
    setInviteMessage("");
    try {
      const result = await api<{ user_id: string; invited: boolean; staff_role: string }>(
        `/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/staff-invitations`,
        {
          method: "POST",
          body: JSON.stringify({
            name: inviteName.trim(),
            email: inviteEmail.trim().toLowerCase(),
            staff_role: inviteRole,
            operation_key: crypto.randomUUID(),
          }),
        },
      );
      setInviteName("");
      setInviteEmail("");
      setInviteMessage(result.invited
        ? "Convite enviado por e-mail para a pessoa da equipe."
        : "A conta ativa foi vinculada à equipe deste workspace.");
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : "Não foi possível convidar ou vincular a pessoa à equipe.");
    } finally {
      setInviteBusy(false);
    }
  }
  return <section className="mt-6 rounded-2xl border border-[#3b4754] bg-[#1d2125] p-4 sm:p-6">
    <h2 className="text-lg font-semibold text-white">Equipe acadêmica</h2>
    <p className="mt-1 text-sm text-[#9fadbc]">Convide ou vincule profissionais, revise credenciais e registre honorários manuais.</p>
    <label htmlFor="suinda-staff-workspace" className="mt-4 grid max-w-lg gap-1 text-sm text-[#b6c2cf]">Workspace<select id="suinda-staff-workspace" className={input} value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setInviteError(""); setInviteMessage(""); }}><option value="">Selecione um workspace</option>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
    {workspaceId && <>
      <form onSubmit={(event) => void inviteStaff(event)} aria-describedby="suinda-staff-invite-help" className="mt-5 grid gap-3 rounded-xl border border-[#3b4754] bg-[#242a30] p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><h3 className="font-semibold text-white">Adicionar profissional à equipe</h3><p id="suinda-staff-invite-help" className="mt-1 text-xs text-[#9fadbc]">Se já houver uma conta ativa com este e-mail, ela será vinculada. Caso contrário, será enviado um convite.</p></div>
        <label htmlFor="suinda-staff-invite-name" className="text-sm text-[#b6c2cf]">Nome<input id="suinda-staff-invite-name" required autoComplete="name" maxLength={200} className={`${input} mt-1`} value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></label>
        <label htmlFor="suinda-staff-invite-email" className="text-sm text-[#b6c2cf]">E-mail<input id="suinda-staff-invite-email" required type="email" autoComplete="email" maxLength={320} className={`${input} mt-1`} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
        <label htmlFor="suinda-staff-invite-role" className="text-sm text-[#b6c2cf]">Função profissional<select id="suinda-staff-invite-role" className={`${input} mt-1`} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}><option value="instructor">Professor</option><option value="tutor">Tutor</option><option value="preceptor">Preceptor</option><option value="coordinator">Coordenador</option></select></label>
        <p className="self-center text-xs text-[#9fadbc]">A função profissional identifica o papel acadêmico; ela não concede permissões de acesso do Orbit.</p>
        {inviteError && <p id="suinda-staff-invite-error" role="alert" className="sm:col-span-2 rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{inviteError}</p>}
        {inviteMessage && <p role="status" aria-live="polite" className="sm:col-span-2 text-sm text-emerald-200">{inviteMessage}</p>}
        <button type="submit" disabled={inviteBusy || !workspaceId} aria-describedby={inviteError ? "suinda-staff-invite-error" : undefined} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50 sm:col-span-2">{inviteBusy ? "Processando…" : "Convidar ou vincular profissional"}</button>
      </form>
      <StaffProfessional workspaceId={workspaceId} canManage />
    </>}
  </section>;
}
