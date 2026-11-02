"use client";

import { useCallback, useEffect, useState } from "react";
import { api, send } from "@/lib/api";

type Workspace = { id: string; name: string };
type Policy = { interval_hours: number; updated_at: string | null };
const intervals = [1, 6, 12, 24, 48];

export default function SurveyReminderSettings() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (selected: string) => {
    if (!selected) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const policy = await api<Policy>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(selected)}/survey-reminder-policy`);
      setHours(intervals.includes(policy.interval_hours) ? policy.interval_hours : 24);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a configuração."); }
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

  async function save() {
    if (!workspaceId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await send(`/extensions/suinda-learning/workspaces/${encodeURIComponent(workspaceId)}/survey-reminder-policy`, "PUT", { interval_hours: hours });
      setMessage("Intervalo de lembrete salvo e auditado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a configuração."); }
    finally { setBusy(false); }
  }

  return <section className="mt-4 rounded-2xl border border-cyan-200/15 bg-[#2c333a] p-4 sm:p-5" aria-labelledby="survey-reminder-settings-title">
    <div><h2 id="survey-reminder-settings-title" className="text-sm font-semibold text-white">Lembretes de pesquisa</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-[#9fadbc]">A coordenação define por workspace quando o lembrete interno aparece antes do encerramento. O aluno pode desativar lembretes acadêmicos no perfil; a preferência global de notificações do Orbit também é respeitada. E-mail usa as preferências e a fila do Orbit. WhatsApp exige consentimento separado do aluno para lembretes de pesquisa, credenciais institucionais e template aprovado.</p></div>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-[11px] text-[#9fadbc]">Workspace<select value={workspaceId} disabled={busy} onChange={(event) => { setWorkspaceId(event.target.value); void load(event.target.value); }} className="min-h-9 min-w-48 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#dee4ea]">{workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
      <label className="grid gap-1 text-[11px] text-[#9fadbc]">Antecedência<select value={hours} disabled={busy || !workspaceId} onChange={(event) => setHours(Number(event.target.value))} className="min-h-9 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-[#dee4ea]">{intervals.map((value) => <option key={value} value={value}>{value} {value === 1 ? "hora" : "horas"} antes</option>)}</select></label>
      <button type="button" disabled={busy || !workspaceId} onClick={() => void save()} className="min-h-9 rounded-lg border border-cyan-200/20 bg-cyan-200/10 px-3 text-xs font-medium text-cyan-100 hover:bg-cyan-200/15 disabled:opacity-50">Salvar intervalo</button>
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}{message && <p role="status" className="mt-3 text-xs text-emerald-200">{message}</p>}
  </section>;
}
