"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, send, authenticatedBlob, User } from "@/lib/api";
import {
  AccessShell,
  accessInput as input,
  accessButton as button,
  accessPanel as panel,
} from "@/components/access-shell";
import SchemaFields, { Schema, fieldLabel } from "./SchemaFields";

type Kind = {
  id: string;
  label: string;
  schema: Schema;
  initial: string;
  serverCreated?: boolean;
  detailActions?: Array<{
    id: string;
    label: string;
    retryLabel?: string;
    description?: string;
    states: string[];
    permission: "write" | "publish";
    path: string;
    ownsTransitions?: boolean;
    when?: Record<string, string | number | boolean | null>;
    download?: { recordIdField: string; revisionField: string; fileNameField: string; path: string };
  }>;
  immutable?: string[];
  example: Record<string, unknown>;
};
function pathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, source);
}
function fillActionPath(path: string, values: Record<string, string | number>) {
  return path.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`A ação exige o valor ${key}.`);
    return encodeURIComponent(String(value));
  });
}
type Plugin = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  kinds: Kind[];
};
type Workspace = { id: string; name: string };
type RecordRow = {
  id: string;
  kind: string;
  title: string;
  state: string;
  revision: number;
  payload: Record<string, unknown>;
};
type Detail = RecordRow & {
  next_states: string[];
  validation_issues?: Array<{ severity: "error" | "warning"; code: string; path: string; message: string }>;
  record_permissions?: { write: boolean; publish: boolean };
  versions: Array<{
    revision: number;
    state: string;
    reason: string;
    created_at: string;
    payload: Record<string, unknown>;
  }>;
  links: Array<{
    target_record_id: string;
    target_revision: number;
    relation: string;
  }>;
};
type Integrity = {
  valid: boolean;
  events: number;
  protected_since: string | null;
  recent: Array<{
    sequence_number: number;
    action: string;
    created_at: string;
    event_hash: string;
  }>;
};
function operationKey() {
  const data = crypto.getRandomValues(new Uint8Array(16));
  data[6] = (data[6] & 15) | 64;
  data[8] = (data[8] & 63) | 128;
  const hex = Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const stateLabel = (state: string) =>
  ({
    draft: "Rascunho",
    published: "Publicado",
    received: "Recebido",
    identity_verification: "Verificar identidade",
    triage: "Triagem",
    in_review: "Em análise",
    response_ready: "Resposta pronta",
    completed: "Concluído",
    blocked: "Bloqueado",
    open: "Aberto",
    resolved: "Resolvido",
    dismissed: "Arquivado",
    submitted: "Enviado",
    active: "Ativo",
    responded: "Respondido",
    returned: "Devolvido",
    running: "Em contagem",
    paused: "Pausado",
  })[state] || state;

export default function ExtensionPage({ pluginId, workspaceId, recordId, embedded=false, onChanged }: { pluginId: string; workspaceId?:string;recordId?:string;embedded?:boolean;onChanged?:()=>Promise<void> }) {
  const [user, setUser] = useState<User | null>(null),
    [plugin, setPlugin] = useState<Plugin | null>(null),
    [spaces, setSpaces] = useState<Workspace[]>([]),
    [workspace, setWorkspace] = useState("");
  const [workspaceAccess, setWorkspaceAccess] = useState({
    write: false,
    publish: false,
  });
  const [rows, setRows] = useState<RecordRow[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [kind, setKind] = useState(""),
    [editing, setEditing] = useState(false);
  const [templateVersion, setTemplateVersion] = useState(0);
  const [title, setTitle] = useState(""),
    [payload, setPayload] = useState<Record<string, unknown>>({}),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [target, setTarget] = useState(""),
    [targetRevision, setTargetRevision] = useState(1),
    [relation, setRelation] = useState("reference"),
    [extensionDays, setExtensionDays] = useState(1);
  const [file, setFile] = useState<File | null>(null),
    [variant, setVariant] = useState("original"),
    [source, setSource] = useState(""),
    [sourceRevision, setSourceRevision] = useState(1);
  const [relatedRecord, setRelatedRecord] = useState("");
  const [relatedRevision, setRelatedRevision] = useState(1);
  const selection = useRef(0);
  const formSelection = useRef(0);
  const [formSchema, setFormSchema] = useState<Schema | null>(null);
  async function chooseForm(recordId: string, revision?: number, preserveAnswers = false) {
    const generation = ++formSelection.current;
    setFormSchema(null);
    if (!recordId) { setPayload({}); return; }
    try {
      const selected = rows.find((row) => row.id === recordId && row.kind === "form");
      const snapshot = await api<RecordRow>(`/extensions/forms/records/${encodeURIComponent(recordId)}/versions/${revision || selected?.revision || 1}/snapshot`);
      if (generation !== formSelection.current) return;
      if (snapshot.kind !== "form" || snapshot.state !== "published") throw new Error("Selecione uma versão publicada do formulário.");
      setFormSchema(snapshot.payload.schema as Schema);
      setPayload((current) => ({ ...current, form_id: recordId, form_revision: snapshot.revision, answers: preserveAnswers ? current.answers || {} : {} }));
    } catch (error) { if (generation === formSelection.current) setError((error as Error).message); }
  }
  const editableKinds = (plugin?.kinds || []).filter((item) => !item.serverCreated);
  const definition = plugin?.kinds.find(
    (item) => item.id === (editing ? kind : detail?.kind || kind),
  );
  const canWrite = Boolean(user?.is_root || workspaceAccess.write),
    canPublish = Boolean(user?.is_root || workspaceAccess.publish);
  const detailCanWrite = Boolean(user?.is_root || (detail?.record_permissions ? detail.record_permissions.write : canWrite)),
    detailCanPublish = Boolean(user?.is_root || (detail?.record_permissions ? detail.record_permissions.publish : canPublish));
  const refreshCatalog = useCallback(async () => {
    const catalog = await api<Plugin[]>("/extensions");
    setPlugin(catalog.find((item) => item.id === pluginId) || null);
  }, [pluginId]);
  useEffect(() => {
    let active = true;
    Promise.all([api<User>("/auth/me"), api<Workspace[]>("/workspaces")])
      .then(([account, workspaces]) => {
        if (active) {
          setUser(account);
          setSpaces(workspaces);
          const query = new URLSearchParams(window.location.search);
          const requestedWorkspace = workspaceId || query.get("workspace");
          const requestedRecord = recordId || query.get("record");
          if (requestedWorkspace && workspaces.some((space) => space.id === requestedWorkspace)) {
            void Promise.all([
              api<RecordRow[]>(`/extensions/${pluginId}/workspaces/${encodeURIComponent(requestedWorkspace)}/records`),
              api<{ write: boolean; publish: boolean }>(`/extensions/${pluginId}/workspaces/${encodeURIComponent(requestedWorkspace)}/access`),
              requestedRecord ? api<Detail>(`/extensions/${pluginId}/records/${encodeURIComponent(requestedRecord)}`) : Promise.resolve(null),
            ]).then(([records, permissions, selected]) => {
              if (!active) return;
              setWorkspace(requestedWorkspace);
              setRows(records);
              setWorkspaceAccess(permissions);
              if (selected && (selected as Detail & { workspace_id: string }).workspace_id === requestedWorkspace) setDetail(selected);
            }).catch((error) => { if (active) setError(error.message); });
          }
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    const refresh = () => {
      if (pluginId === "audit-history")
        api<Integrity>("/extensions/audit-history")
          .then((value) => {
            if (active) setIntegrity(value);
          })
          .catch((error) => {
            if (active) setError(error.message);
          });
      else
        void refreshCatalog().catch((error) => {
          if (active) setError(error.message);
        });
    };
    refresh();
    window.addEventListener("plugins:changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("plugins:changed", refresh);
    };
  }, [pluginId, refreshCatalog, workspaceId, recordId]);

  async function chooseWorkspace(id: string) {
    const request = ++selection.current;
    setWorkspace(id);
    setWorkspaceAccess({ write: false, publish: false });
    setDetail(null);
    setEditing(false);
    setRows([]);
    setError("");
    if (!id) return;
    try {
      const [records, permissions] = await Promise.all([
        api<RecordRow[]>(`/extensions/${pluginId}/workspaces/${id}/records`),
        api<{ write: boolean; publish: boolean }>(
          `/extensions/${pluginId}/workspaces/${id}/access`,
        ),
      ]);
      if (selection.current === request) {
        setRows(records);
        setWorkspaceAccess(permissions);
      }
    } catch (error) {
      if (selection.current === request) setError((error as Error).message);
    }
  }
  async function open(id: string) {
    const request = ++selection.current;
    setError("");
    setEditing(false);
    try {
      const result = await api<Detail>(`/extensions/${pluginId}/records/${id}`);
      if (selection.current === request) setDetail(result);
    } catch (error) {
      if (selection.current === request) setError((error as Error).message);
    }
  }
  async function action(callback: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = (await callback()) as RecordRow | undefined;
      setRows(
        await api<RecordRow[]>(
          `/extensions/${pluginId}/workspaces/${workspace}/records`,
        ),
      );
      if (result?.id) await open(result.id);
      else if (detail) await open(detail.id);
      setMessage("Operação concluída.");
      await onChanged?.();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(row?: RecordRow) {
    formSelection.current++;
    setFormSchema(null);
    if (pluginId === "forms" && row?.kind === "submission") void chooseForm(String(row.payload.form_id), Number(row.payload.form_revision), true);
    setKind(row?.kind || editableKinds[0]?.id || "");
    setTitle(row?.title || "");
    setPayload(row?.payload || {});
    setDetail(row ? detail : null);
    setReason("");
    setEditing(true);
    setFile(null);
    setVariant(String(row?.payload.variant || "original"));
    setSource(String(row?.payload.source_id || ""));
    setRelatedRecord(String(row?.payload.related_record_id || ""));
    setRelatedRevision(Number(row?.payload.related_record_revision || 1));
    setSourceRevision(Number(row?.payload.source_revision || 1));
  }
  async function save() {
    if (pluginId === "documents" && kind === "document") {
      if (!file) throw new Error("Selecione um arquivo.");
      if (file.size > 8388608) throw new Error("O arquivo excede 8 MB.");
      const data_base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      return send(
        `/extensions/documents/workspaces/${workspace}/files`,
        "POST",
        {
          title,
          file_name: file.name,
          mime_type:
            file.type ||
            {
              pdf: "application/pdf",
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              txt: "text/plain",
              docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }[file.name.split(".").pop()?.toLowerCase() || ""] ||
            "",
          data_base64,
          variant,
          ...(relatedRecord ? { related_record_id: relatedRecord, related_record_revision: relatedRevision } : {}),
          ...(variant === "anonymized"
            ? { source_id: source, source_revision: sourceRevision }
            : {}),
          ...(detail
            ? { record_id: detail.id, expected_revision: detail.revision }
            : {}),
          reason: reason || "Arquivo enviado",
          operation_key: operationKey(),
        },
      );
    }
    return detail
      ? send(`/extensions/${pluginId}/records/${detail.id}/versions`, "POST", {
          title,
          payload,
          reason,
          expected_revision: detail.revision,
          operation_key: operationKey(),
        })
      : send(
          `/extensions/${pluginId}/workspaces/${workspace}/records`,
          "POST",
          { kind, title, payload, operation_key: operationKey() },
        );
  }
  async function transition(body: Record<string, unknown>) {
    if (!detail) return;
    await action(() =>
      send(`/extensions/${pluginId}/records/${detail.id}/transitions`, "POST", {
        ...body,
        reason,
        expected_revision: detail.revision,
        operation_key: operationKey(),
      }),
    );
  }

  return (
    <AccessShell embedded={embedded}
      user={user}
      title={
        pluginId === "audit-history"
          ? "Auditoria verificável"
          : plugin?.name || "Extensões"
      }
    >
      {error && (
        <p
          role="alert"
          className="break-words rounded bg-[#601f25] p-3 text-white"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded bg-[#164b35] p-3 text-white">
          {message}
        </p>
      )}
      {pluginId === "audit-history" ? (
        <section className={panel}>
          {integrity && (
            <>
              <p className="text-lg font-semibold">
                {integrity.valid
                  ? "Cadeia íntegra"
                  : "Falha de integridade detectada"}{" "}
                · {integrity.events} eventos protegidos
              </p>
              <p className="mt-2 text-sm">
                A proteção começa na instalação deste recurso; registros
                anteriores continuam na auditoria de acessos.
              </p>
              <div className="mt-4 space-y-3">
                {integrity.recent.map((event) => (
                  <article
                    key={event.sequence_number}
                    className="min-w-0 rounded border p-3"
                  >
                    <strong>
                      #{event.sequence_number} · {event.action}
                    </strong>
                    <p className="break-all font-mono text-xs">
                      {event.event_hash}
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <>
          <p>{plugin?.description}</p>
          {plugin && !plugin.enabled && (
            <p role="status" className={panel}>
              Este plugin está suspenso por sua configuração ou por uma
              dependência; seus dados estão preservados.
            </p>
          )}
          <label className="block max-w-xl">
            Workspace
            <select
              className={input}
              value={workspace}
              onChange={(event) => void chooseWorkspace(event.target.value)}
              disabled={!plugin?.enabled}
            >
              <option value="">Selecione um espaço</option>
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
          {workspace && plugin?.enabled && (
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
              <section className={panel}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold">Registros</h2>
                  {canWrite && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => edit()}
                    >
                      Novo registro
                    </button>
                  )}
                </div>
                <p className="mb-3 text-xs">Até 100 registros recentes.</p>
                <div className="space-y-2">
                  {rows.map((row) => (
                    <button
                      type="button"
                      key={row.id}
                      onClick={() => void open(row.id)}
                      aria-pressed={detail?.id === row.id}
                      className="block min-h-11 w-full min-w-0 rounded border p-3 text-left"
                    >
                      <strong className="break-words">{row.title}</strong>
                      <span className="block text-sm">
                        {stateLabel(row.state)} · v{row.revision}
                      </span>
                    </button>
                  ))}
                </div>
                {!rows.length && <p>Nenhum registro neste workspace.</p>}
              </section>
              <section className={`${panel} min-w-0`}>
                {editing ? (
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action(save);
                    }}
                  >
                    <h2 className="text-lg font-semibold">
                      {detail ? "Nova revisão" : "Criar registro"}
                    </h2>
                    <label className="block">
                      Tipo
                      <select
                        className={input}
                        value={kind}
                        disabled={Boolean(detail)}
                        onChange={(event) => {
                          formSelection.current++;
                          setFormSchema(null);
                          setKind(event.target.value);
                          setPayload({});
                        }}
                      >
                        {editableKinds.map((kind) => (
                          <option key={kind.id} value={kind.id}>
                            {kind.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {pluginId === "forms" && kind === "submission" && <label className="block">
                      Formulário publicado
                      <select className={input} required disabled={Boolean(detail)} value={String(payload.form_id || "")} onChange={(event) => void chooseForm(event.target.value)}>
                        <option value="">Selecione o formulário a responder</option>
                        {rows.filter((row) => row.kind === "form" && row.state === "published").map((form) => <option key={form.id} value={form.id}>{form.title} · v{form.revision}</option>)}
                        {detail && !rows.some((row) => row.id === payload.form_id) && <option value={String(payload.form_id)}>{String(payload.form_id)} · v{String(payload.form_revision)}</option>}
                      </select>
                    </label>}
                    <label className="block">
                      Título
                      <input
                        className={input}
                        required
                        maxLength={240}
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                      />
                    </label>
                    {pluginId === "documents" && kind === "document" ? (
                      <>
                        <label className="block">
                          Arquivo de até 8 MB
                          <input
                            className={input}
                            type="file"
                            required
                            accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx"
                            onChange={(event) =>
                              setFile(event.target.files?.[0] || null)
                            }
                          />
                        </label>
                        <label className="block">
                          Versão
                          <select
                            className={input}
                            value={variant}
                            onChange={(event) => setVariant(event.target.value)}
                          >
                            <option value="original">Original</option>
                            <option value="anonymized">
                              Cópia anonimizada
                            </option>
                          </select>
                        </label>
                        <details className="rounded border p-3">
                          <summary>Relacionar a um registro ou processo (opcional)</summary>
                          <p className="my-2 text-sm">Preserva a versão do processo a que este comprovante pertence.</p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label>ID do registro<input className={input} value={relatedRecord} onChange={(event) => setRelatedRecord(event.target.value)} /></label>
                            <label>Versão do registro<input className={input} min={1} type="number" value={relatedRevision} onChange={(event) => setRelatedRevision(Number(event.target.value))} /></label>
                          </div>
                        </details>
                        {variant === "anonymized" && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label>
                              ID do original
                              <input
                                required
                                className={input}
                                value={source}
                                onChange={(event) =>
                                  setSource(event.target.value)
                                }
                              />
                            </label>
                            <label>
                              Versão original
                              <input
                                required
                                min={1}
                                type="number"
                                className={input}
                                value={sourceRevision}
                                onChange={(event) =>
                                  setSourceRevision(Number(event.target.value))
                                }
                              />
                            </label>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {definition && (
                          <SchemaFields
                            key={`${detail?.id || "new"}:${kind}:${templateVersion}`}
                            schema={pluginId === "forms" && kind === "submission" && formSchema ? { ...definition.schema, properties: { ...definition.schema.properties, answers: { ...formSchema, title: "Respostas" } } } : definition.schema}
                            value={payload}
                            onChange={setPayload}
                            skip={
                              pluginId === "workflows" && kind === "process"
                                ? ["current_state", "protocol"]
                                : pluginId === "forms" && kind === "submission"
                                  ? formSchema ? ["form_id", "form_revision"] : ["form_id", "form_revision", "answers"]
                                : pluginId === "deadlines"
                                  ? ["started_at", "due_at", "paused_at"]
                                  : []
                            }
                          />
                        )}
                        <button
                          type="button"
                          className="min-h-11 text-sm underline"
                          onClick={() => {
                            if (definition) {
                              setPayload(structuredClone(definition.example));
                              setTemplateVersion((value) => value + 1);
                            }
                          }}
                        >
                          Carregar exemplo genérico
                        </button>
                      </>
                    )}
                    {detail && (
                      <label className="block">
                        Motivo da revisão
                        <textarea
                          required
                          className={input}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button disabled={busy || (pluginId === "forms" && kind === "submission" && !formSchema)} className={button}>
                        {busy ? "Salvando…" : "Salvar"}
                      </button>
                      <button
                        type="button"
                        className={`${button} !bg-[#44546f]`}
                        onClick={() => setEditing(false)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : detail ? (
                  <div className="space-y-5">
                    <div className="flex flex-wrap justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="break-words text-xl font-semibold">
                          {detail.title}
                        </h2>
                        <p>
                          {stateLabel(detail.state)} · versão {detail.revision}
                        </p>
                        <p className="break-all text-xs">ID: {detail.id}</p>
                      </div>
                      {detailCanWrite &&
                        (!definition?.immutable?.includes(detail.state) ||
                          detail.state === "published") &&
                        pluginId !== "deadlines" && (
                          <button
                            type="button"
                            className={button}
                            onClick={() => edit(detail)}
                          >
                            Nova revisão
                          </button>
                        )}
                    </div>
                    {detail.validation_issues !== undefined && detail.validation_issues.length > 0 && (
                      <section
                        aria-label="Validação do registro"
                        className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4"
                        role="status"
                      >
                        <h3 className="font-semibold">Validação do registro</h3>
                        <p className="mt-1 text-sm">Revise os avisos e inconsistências antes de concluir a análise.</p>
                        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                          {detail.validation_issues.map((issue, index) => (
                            <li key={`${issue.code}-${index}`}>
                              <span className="font-medium">{fieldLabel(issue.path.split(/[.[]/)[0])}:</span> {issue.message}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    <dl className="space-y-3">
                      {Object.entries(detail.payload).map(([key, value]) => (
                        <div key={key} className="min-w-0">
                          <dt className="text-sm font-semibold">
                            {fieldLabel(key)}
                          </dt>
                          <dd className="whitespace-pre-wrap break-words text-sm">
                            {typeof value === "object" ? (
                              <pre className="max-w-full whitespace-pre-wrap break-all rounded bg-black/15 p-3">
                                {JSON.stringify(value, null, 2)}
                              </pre>
                            ) : (
                              String(value)
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {(definition?.detailActions || []).filter((item) =>
                      item.states.includes(detail.state)
                      && (item.permission === "write" ? detailCanWrite : detailCanPublish)
                      && Object.entries(item.when || {}).every(([path, expected]) => pathValue({ payload: detail.payload, state: detail.state }, path) === expected),
                    ).map((item) => (
                      <section key={item.id} className="space-y-2 rounded-lg border border-blue-400/30 bg-blue-400/5 p-4">
                        {item.description && <p className="text-sm">{item.description}</p>}
                        <button type="button" className={button} disabled={busy} onClick={() => void action(async () => {
                          const result = await send<Record<string, unknown>>(fillActionPath(item.path, { recordId: detail.id }), "POST", {});
                          if (item.download) {
                            const fileId = result[item.download.recordIdField];
                            const revision = result[item.download.revisionField];
                            const fileName = result[item.download.fileNameField];
                            if (typeof fileId !== "string" || typeof revision !== "number" || typeof fileName !== "string") throw new Error("A ação não retornou os dados necessários para baixar o arquivo.");
                            const blob = await authenticatedBlob(fillActionPath(item.download.path, { recordId: fileId, revision }));
                            const url = URL.createObjectURL(blob);
                            const anchor = document.createElement("a");
                            anchor.href = url;
                            anchor.download = fileName;
                            anchor.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          }
                          return result;
                        })}>
                          {item.retryLabel && detail.state === "failed" ? item.retryLabel : item.label}
                        </button>
                      </section>
                    ))}
                    {detailCanPublish &&
                      !definition?.immutable?.includes(detail.state) && !definition?.detailActions?.some((item) => item.ownsTransitions && item.states.includes(detail.state) && Object.entries(item.when || {}).every(([path, expected]) => pathValue({ payload: detail.payload, state: detail.state }, path) === expected)) && (
                        <div className="space-y-3 rounded border p-3">
                          <label className="block">
                            Justificativa da ação
                            <textarea
                              className={input}
                              value={reason}
                              onChange={(event) =>
                                setReason(event.target.value)
                              }
                            />
                          </label>
                          <div className="flex flex-wrap gap-3">
                            {pluginId === "deadlines" ? (
                              <>
                                {detail.state === "running" && (
                                  <button
                                    disabled={busy || !reason}
                                    className={button}
                                    onClick={() =>
                                      void transition({ event: "pause" })
                                    }
                                  >
                                    Pausar
                                  </button>
                                )}
                                {detail.state === "paused" && (
                                  <button
                                    disabled={busy || !reason}
                                    className={button}
                                    onClick={() =>
                                      void transition({ event: "resume" })
                                    }
                                  >
                                    Retomar
                                  </button>
                                )}
                                <label>
                                  Dias adicionais
                                  <input
                                    aria-label="Dias adicionais"
                                    type="number"
                                    min={1}
                                    max={3660}
                                    className={input}
                                    value={extensionDays}
                                    onChange={(event) =>
                                      setExtensionDays(
                                        Number(event.target.value),
                                      )
                                    }
                                  />
                                </label>
                                <button
                                  disabled={busy || !reason}
                                  className={button}
                                  onClick={() =>
                                    void transition({
                                      event: "extend",
                                      extension_days: extensionDays,
                                    })
                                  }
                                >
                                  Prorrogar
                                </button>
                                <button
                                  disabled={busy || !reason}
                                  className={button}
                                  onClick={() =>
                                    void transition({ event: "complete" })
                                  }
                                >
                                  Concluir
                                </button>
                              </>
                            ) : (
                              detail.next_states.map((state) => (
                                <button
                                  key={state}
                                  disabled={busy || !reason}
                                  className={button}
                                  onClick={() =>
                                    void transition(
                                      pluginId === "workflows" &&
                                        detail.kind === "process"
                                        ? { next_state: state }
                                        : { state },
                                    )
                                  }
                                >
                                  {stateLabel(state)}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    {pluginId === "documents" && detail.kind === "document" && (
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            const blob = await authenticatedBlob(
                              `/extensions/documents/records/${detail.id}/files/${detail.revision}`,
                            );
                            const url = URL.createObjectURL(blob);
                            const anchor = document.createElement("a");
                            anchor.href = url;
                            anchor.download = String(detail.payload.file_name);
                            anchor.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          })
                        }
                      >
                        Baixar versão
                      </button>
                    )}
                    {pluginId === "terms" && detail.state === "published" && (
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Você leu e aceita o conteúdo desta versão do termo?",
                            )
                          )
                            void action(() =>
                              send(
                                `/extensions/terms/records/${detail.id}/acceptances`,
                                "POST",
                                {
                                  revision: detail.revision,
                                  accepted: true,
                                  operation_key: operationKey(),
                                },
                              ),
                            );
                        }}
                      >
                        Li e aceito esta versão
                      </button>
                    )}
                    <details>
                      <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                        Referências a versões · {detail.links.length}
                      </summary>
                      {detail.links.map((link, index) => (
                        <p key={index} className="break-all text-sm">
                          {link.relation} · {link.target_record_id} · v
                          {link.target_revision}
                        </p>
                      ))}
                      {detailCanWrite && (
                        <form
                          className="mt-3 grid gap-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void action(() =>
                              send(
                                `/extensions/${pluginId}/records/${detail.id}/links`,
                                "POST",
                                {
                                  target_id: target,
                                  target_revision: targetRevision,
                                  relation,
                                  operation_key: operationKey(),
                                },
                              ),
                            );
                          }}
                        >
                          <label>
                            ID da referência
                            <input
                              required
                              className={input}
                              value={target}
                              onChange={(event) =>
                                setTarget(event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Versão
                            <input
                              required
                              type="number"
                              min={1}
                              className={input}
                              value={targetRevision}
                              onChange={(event) =>
                                setTargetRevision(Number(event.target.value))
                              }
                            />
                          </label>
                          <label>
                            Relação
                            <input
                              required
                              className={input}
                              value={relation}
                              onChange={(event) =>
                                setRelation(event.target.value)
                              }
                            />
                          </label>
                          <button disabled={busy || (pluginId === "forms" && kind === "submission" && !formSchema)} className={button}>
                            Fixar referência
                          </button>
                        </form>
                      )}
                    </details>
                    <details>
                      <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                        Histórico imutável · {detail.versions.length}
                      </summary>
                      <div className="space-y-3">
                        {detail.versions.map((version) => (
                          <article
                            key={version.revision}
                            className="min-w-0 rounded border p-3"
                          >
                            <strong>
                              v{version.revision} · {stateLabel(version.state)}
                            </strong>
                            <p className="break-words text-sm">
                              {version.reason}
                            </p>
                            <details>
                              <summary className="min-h-11 cursor-pointer py-2">
                                Ver conteúdo desta versão
                              </summary>
                              <pre className="whitespace-pre-wrap break-all text-xs">
                                {JSON.stringify(version.payload, null, 2)}
                              </pre>
                            </details>
                          </article>
                        ))}
                      </div>
                    </details>
                  </div>
                ) : (
                  <p>
                    Selecione um registro para consultar suas versões ou crie um
                    novo.
                  </p>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </AccessShell>
  );
}
