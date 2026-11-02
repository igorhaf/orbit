"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, send } from "@/lib/api";
import { accessButton as button, accessInput as input } from "@/components/access-shell";

type Delivery = { id: string; event_type: string; status: string; attempt_count: number; last_error: string | null; created_at: string };
type Subscription = { id: string; endpoint: string; event_types: string[]; active: boolean; deliveries: Delivery[] };
type EventOption = { type: string; label: string; version: number };

export function WebhooksPanel({ workspace, canManage }: { workspace: string; canManage: boolean }) {
  const [items, setItems] = useState<Subscription[]>([]);
  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["record.created", "record.updated"]);
  const [createdSecret, setCreatedSecret] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try { setItems(await api<Subscription[]>(`/workspaces/${workspace}/webhooks`)); }
    catch (cause) { setError((cause as Error).message); }
  }, [workspace]);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void Promise.all([
      api<Subscription[]>(`/workspaces/${workspace}/webhooks`),
      api<EventOption[]>(`/workspaces/${workspace}/webhooks/event-types`),
    ]).then(([subscriptions, eventTypes]) => {
      if (active) { setItems(subscriptions); setEventOptions(eventTypes); }
    }).catch((cause: unknown) => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [workspace, canManage]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setCreatedSecret("");
    if (!selectedEvents.length) { setError("Selecione pelo menos um evento."); return; }
    try {
      const result = await send<{ id: string; secret: string }>(`/workspaces/${workspace}/webhooks`, "POST", { endpoint, event_types: selectedEvents });
      setCreatedSecret(result.secret); setEndpoint(""); await refresh();
    } catch (cause) { setError((cause as Error).message); }
  }

  function toggleEvent(eventType: string) {
    setSelectedEvents((current) => current.includes(eventType) ? current.filter((value) => value !== eventType) : [...current, eventType]);
  }

  return <section className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">Webhooks</h3>
    <p className="text-sm">Assine eventos genéricos de registros ou eventos de domínio declarados por plugins. Os payloads contêm apenas identificadores e metadados mínimos; títulos e conteúdo dos registros não são enviados.</p>
    {error && <p role="alert" className="text-[#ae2a19]">{error}</p>}
    {canManage && <form className="grid min-w-0 gap-3" onSubmit={(event) => void create(event)}>
      <label className="grid gap-1 text-sm">Destino HTTPS
        <input type="url" required placeholder="https://example.org/orbit-hook" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} className={`${input} min-w-0`} />
      </label>
      <fieldset className="grid gap-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Eventos enviados</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {eventOptions.map((event) => <label key={event.type} className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={selectedEvents.includes(event.type)} onChange={() => toggleEvent(event.type)} />
            <span>{event.label}{event.version > 0 ? ` · v${event.version}` : ""}</span>
          </label>)}
        </div>
      </fieldset>
      <button className={button} disabled={!selectedEvents.length}>Criar assinatura</button>
    </form>}
    {createdSecret && <div role="status" className="break-all rounded border border-[#e2b203] bg-[#fff7d6] p-3"><strong>Copie o segredo agora. Ele não será exibido novamente.</strong><code className="mt-2 block select-all">{createdSecret}</code></div>}
    {items.map((item) => <article key={item.id} className="min-w-0 rounded-lg border p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><code className="block break-all text-sm">{item.endpoint}</code><p className="text-sm">{item.event_types.join(", ")} · {item.active ? "ativa" : "pausada"}</p></div>
        {canManage && <button className={`${button} !bg-[#44546f]`} onClick={async () => { try { await send(`/workspaces/${workspace}/webhooks/${item.id}`, "DELETE"); await refresh(); } catch (cause) { setError((cause as Error).message); } }}>Remover</button>}
      </div>
      <div className="mt-3 space-y-2">{item.deliveries.map((delivery) => <div key={delivery.id} className="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm"><span>{delivery.event_type} · {delivery.status} · tentativa {delivery.attempt_count}</span><span>{delivery.last_error || "sem erro"}</span></div>)}{item.deliveries.length === 0 && <p className="text-sm">Nenhuma entrega registrada.</p>}</div>
    </article>)}
  </section>;
}
