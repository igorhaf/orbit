"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type Workspace = { id: string; name: string };
type Profile = { id: string; name: string; permissions: string[] };
type Member = { user_id: string; name: string; email: string; is_root: boolean; profiles: Array<{ id: string; name: string }> };
const prefix = "plugin.suinda-learning.";
const field = "min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-sm text-[#dee4ea]";

export default function AccessProfiles() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [memberId, setMemberId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const result = await api<{ profiles: Profile[]; members: Member[]; permissions: string[] }>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(id)}/access-profiles`);
      setProfiles(result.profiles); setMembers(result.members); setPermissions(result.permissions.filter((permission) => permission.startsWith(prefix)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os perfis desta instituição."); }
  }, []);

  useEffect(() => {
    void api<Workspace[]>("/extensions/suinda-learning/access-profiles/workspaces").then((spaces) => {
      setWorkspaces(spaces);
      const first = spaces[0]?.id || ""; setWorkspaceId(first); if (first) void load(first);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar a gestão de acessos."));
  }, [load]);

  function chooseProfile(value: string) {
    setProfileId(value); const profile = profiles.find((item) => item.id === value);
    setName(profile?.name || ""); setSelectedPermissions(profile?.permissions || []);
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const path = `/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/access-profiles${profileId ? `/${encodeURIComponent(profileId)}` : ""}`;
      await api(path, { method: profileId ? "PUT" : "POST", body: JSON.stringify({ name, permissions: selectedPermissions }) });
      setMessage(profileId ? "Perfil atualizado; sessões das pessoas atribuídas foram revogadas." : "Perfil criado.");
      chooseProfile(""); await load(workspaceId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o perfil."); }
    finally { setBusy(false); }
  }

  async function assign() {
    if (!memberId || !assignmentId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/access-profiles/members/${encodeURIComponent(memberId)}/assignments/${encodeURIComponent(assignmentId)}`, { method: "POST" });
      setMessage("Perfil atribuído; a sessão da pessoa foi revogada."); await load(workspaceId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atribuir o perfil."); }
    finally { setBusy(false); }
  }

  async function revoke(member: Member, assignment: { id: string; name: string }) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/access-profiles/members/${encodeURIComponent(member.user_id)}/assignments/${encodeURIComponent(assignment.id)}`, { method: "DELETE" });
      setMessage("Perfil revogado; a sessão da pessoa foi revogada."); await load(workspaceId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível revogar o perfil."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!profileId || !window.confirm("Remover este perfil? Ele precisa estar sem atribuições.")) return;
    setBusy(true); setError(""); setMessage("");
    try { await api(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/access-profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" }); setMessage("Perfil removido."); chooseProfile(""); await load(workspaceId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível remover o perfil."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="suinda-access-profile-title" className="mt-5 space-y-5 rounded-2xl border border-violet-200/15 bg-[#2c333a] p-5 text-[#dee4ea]">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-violet-200">Acessos institucionais</p><h2 id="suinda-access-profile-title" className="mt-1 text-lg font-semibold text-white">Perfis personalizados</h2><p className="mt-1 text-sm text-[#9fadbc]">Os perfis pertencem a um único workspace e só podem conter permissões registradas do Suindá. A administração exige <code>plugin.suinda-learning.manage</code> nesse workspace.</p></header>
    <label className="grid max-w-lg gap-1 text-sm text-[#b6c2cf]">Instituição / workspace<select className={field} value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); void load(event.target.value); }}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
    {error && <p role="alert" className="rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p>}{message && <p role="status" className="text-sm text-emerald-200">{message}</p>}
    <form onSubmit={(event) => void save(event)} className="space-y-4 rounded-xl border border-[#3b4754] p-4">
      <h3 className="font-semibold text-white">{profileId ? "Editar perfil" : "Criar perfil"}</h3>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm text-[#b6c2cf]">Perfil existente<select className={field} value={profileId} onChange={(event) => chooseProfile(event.target.value)}><option value="">Novo perfil</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label className="grid gap-1 text-sm text-[#b6c2cf]">Nome<input required maxLength={100} className={field} value={name} onChange={(event) => setName(event.target.value)} /></label></div>
      <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 text-sm font-medium text-white">Permissões Suindá</legend>{permissions.map((permission) => <label key={permission} className="flex items-start gap-2 rounded-lg border border-white/[0.08] p-2 text-xs text-[#b6c2cf]"><input type="checkbox" checked={selectedPermissions.includes(permission)} onChange={(event) => setSelectedPermissions((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))} />{permission}</label>)}</fieldset>
      <div className="flex flex-wrap gap-2"><button disabled={busy || !workspaceId} className="min-h-10 rounded-lg bg-violet-300 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{profileId ? "Salvar alterações" : "Criar perfil"}</button>{profileId && <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-10 rounded-lg border border-rose-300/25 px-4 text-sm text-rose-100 disabled:opacity-50">Remover perfil</button>}</div>
    </form>
    <section className="space-y-3 rounded-xl border border-[#3b4754] p-4"><h3 className="font-semibold text-white">Atribuir perfil a membro</h3><div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><select aria-label="Membro do workspace" className={field} value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Selecione membro</option>{members.filter((member) => !member.is_root).map((member) => <option key={member.user_id} value={member.user_id}>{member.name} · {member.email}</option>)}</select><select aria-label="Perfil a atribuir" className={field} value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}><option value="">Selecione perfil</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><button type="button" disabled={busy || !memberId || !assignmentId} onClick={() => void assign()} className="min-h-10 rounded-lg border border-violet-200/25 px-4 text-sm text-violet-100 disabled:opacity-50">Atribuir</button></div>
      {members.map((member) => <article key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.08] p-3 text-sm"><div><p className="text-white">{member.name}{member.is_root ? " · ROOT protegido" : ""}</p><div className="mt-1 flex flex-wrap gap-2">{member.profiles.map((assignment) => <span key={assignment.id} className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-2 py-1 text-xs text-[#b6c2cf]">{assignment.name}{!member.is_root && <button type="button" disabled={busy} onClick={() => void revoke(member, assignment)} aria-label={`Revogar ${assignment.name} de ${member.name}`} className="text-rose-200 underline">Revogar</button>}</span>)}{member.profiles.length === 0 && <span className="text-xs text-[#9fadbc]">Sem perfil personalizado</span>}</div></div></article>)}
    </section>
  </section>;
}
