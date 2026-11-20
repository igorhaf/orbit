"use client";

import {
  accessInput as input,
  accessButton as button,
} from "@/components/access-shell";
import { useId, useState } from "react";

export type SchemaFieldGroup = { id: string; label: string; fields: string[] };

export type Schema = {
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: string[];
  required?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  recordKind?: string;
  recordRevisionField?: string;
  enumLabels?: Record<string, string>;
  "x-orbit-field-groups"?: SchemaFieldGroup[];
};
export type RecordOption = { id: string; kind: string; title: string; revision: number };
const labels: Record<string, string> = {
  content: "Conteúdo",
  source_reference: "Referência da fonte",
  authority: "Autoridade responsável",
  topics: "Temas",
  valid_from: "Início da vigência",
  valid_until: "Fim da vigência",
  parameters: "Parâmetros",
  code: "Código",
  assigned_professional_ids: "Profissionais responsáveis",
  value: "Valor",
  minimum: "Mínimo",
  maximum: "Máximo",
  outcomes: "Resultados possíveis",
  dimensions: "Dimensões",
  criteria: "Critérios",
  title: "Título",
  evidence_required: "Evidência obrigatória",
  justification_required: "Justificativa obrigatória",
  purpose: "Finalidade",
  data_categories: "Categorias de dados",
  subject_categories: "Categorias de titulares",
  legal_basis_reference: "Referência da base legal",
  retention_reference: "Referência de retenção",
  request_type: "Tipo de solicitação",
  opaque_reference: "Referência opaca do caso",
  response_reference: "Referência da resposta",
  relationship_type: "Tipo de relação",
  related_resource_type: "Tipo de recurso relacionado",
  related_resource_id: "ID do recurso relacionado",
  statement: "Declaração",
  expires_at: "Válido até",
  reason: "Justificativa",
  resolution: "Resolução",
  decision_reference: "Referência da decisão",
  disclosure_id: "ID da declaração",
  description: "Descrição",
  schema: "Definição dos campos em JSON Schema",
  form_id: "ID do formulário",
  form_revision: "Versão do formulário",
  answers: "Respostas",
  states: "Estados possíveis",
  initial_state: "Estado inicial",
  transitions: "Transições",
  from: "Origem",
  to: "Destino",
  definition_id: "ID da definição de fluxo",
  definition_revision: "Versão da definição",
  target_type: "Tipo do recurso associado",
  target_id: "ID do recurso associado",
  process_id: "ID do processo",
  outcome: "Resultado",
  checks: "Verificações",
  responsible_user_id: "ID do responsável",
  due_at: "Prazo de resposta",
  response: "Resposta",
  duration_days: "Duração em dias",
  document_id: "ID do documento",
  document_revision: "Versão do documento",
  decision: "Decisão",
};
export const fieldLabel = (key: string) =>
  labels[key] || key.replaceAll("_", " ");

export function schemaFieldGroups(schema: Schema, skip: string[] = []): SchemaFieldGroup[] {
  const fields = Object.keys(schema.properties || {}).filter((key) => !skip.includes(key));
  const definitions = schema["x-orbit-field-groups"];
  if (!Array.isArray(definitions) || definitions.length === 0)
    return [{ id: "all", label: "", fields }];

  const known = new Set(fields);
  const assigned = new Set<string>();
  const groups = definitions.flatMap((group, index) => {
    if (!group || typeof group.label !== "string" || !Array.isArray(group.fields)) return [];
    const groupFields = group.fields.filter((field) => {
      if (typeof field !== "string" || !known.has(field) || assigned.has(field)) return false;
      assigned.add(field);
      return true;
    });
    if (!groupFields.length) return [];
    return [{ id: typeof group.id === "string" && group.id ? group.id : `group-${index + 1}`, label: group.label, fields: groupFields }];
  });
  const ungrouped = fields.filter((field) => !assigned.has(field));
  if (ungrouped.length) groups.push({ id: "other", label: "Outros dados", fields: ungrouped });
  return groups.length ? groups : [{ id: "all", label: "", fields }];
}

function JsonField({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
}) {
  return (
    <textarea
      aria-label={label}
      className={`${input} min-h-36 font-mono text-sm`}
      defaultValue={value === undefined ? "" : JSON.stringify(value, null, 2)}
      onChange={(event) => {
        const field = event.currentTarget;
        try {
          const parsed = field.value.trim()
            ? JSON.parse(field.value)
            : undefined;
          field.setCustomValidity("");
          onChange(parsed);
        } catch {
          field.setCustomValidity("Informe um JSON válido.");
        }
      }}
    />
  );
}

function Field({
  schema,
  value,
  onChange,
  label,
  records,
}: {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  records?: RecordOption[];
}) {
  const type = Array.isArray(schema.type)
    ? schema.type.find((item) => item !== "null")
    : schema.type;
  if (type === "array" && schema.items?.recordKind)
    return (
      <select
        multiple
        aria-label={label}
        className={`${input} min-h-28`}
        value={Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []}
        onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, option => option.value))}
        size={Math.min(8, Math.max(3, (records || []).filter(record => record.kind === schema.items?.recordKind).length))}
      >
        {(records || []).filter((record) => record.kind === schema.items?.recordKind).map((record) => (
          <option key={record.id} value={record.id}>{record.title} · v{record.revision}</option>
        ))}
      </select>
    );
  if (schema.recordKind)
    return (
      <select
        aria-label={label}
        className={input}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">Selecione um registro</option>
        {(records || []).filter((record) => record.kind === schema.recordKind).map((record) => (
          <option key={record.id} value={record.id}>{record.title} · v{record.revision}</option>
        ))}
      </select>
    );
  if (schema.enum)
    return (
      <select
        aria-label={label}
        className={input}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">Selecione</option>
        {schema.enum.map((item) => (
          <option key={item} value={item}>{schema.enumLabels?.[item] || item}</option>
        ))}
      </select>
    );
  if (type === "boolean")
    return (
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        Sim
      </label>
    );
  if (type === "object" && schema.properties)
    return (
      <SchemaFields
        schema={schema}
        value={(value || {}) as Record<string, unknown>}
        onChange={onChange}
          records={records}
      />
    );
  if (type === "array" && schema.items) {
    const items = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={index}
            className="min-w-0 space-y-2 rounded border border-white/15 p-3"
          >
            <Field
              label={`${label} ${index + 1}`}
              schema={schema.items!}
              value={item}
              records={records}
              onChange={(next) =>
                onChange(items.map((value, i) => (i === index ? next : value)))
              }
            />
            <button
              type="button"
              className="min-h-11 text-sm text-[#ff8f73]"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              Remover item {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={button}
          onClick={() =>
            onChange([...items, schema.items?.type === "object" ? {} : ""])
          }
        >
          Adicionar item
        </button>
      </div>
    );
  }
  if (!type || type === "object")
    return (
      <JsonField key={label} label={label} value={value} onChange={onChange} />
    );
  if (type === "number" || type === "integer")
    return (
      <input
        aria-label={label}
        className={input}
        type="number"
        step={type === "integer" ? 1 : "any"}
        min={schema.minimum}
        max={schema.maximum}
        value={value === undefined ? "" : String(value)}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? undefined : Number(event.target.value),
          )
        }
      />
    );
  if (schema.format === "email")
    return (
      <input
        aria-label={label}
        className={input}
        type="email"
        maxLength={schema.maxLength}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    );
  if (schema.format === "date" || schema.format === "date-time")
    return (
      <input
        aria-label={label}
        className={input}
        type={schema.format === "date" ? "date" : "datetime-local"}
        value={String(value ?? "").replace(/Z$/, "")}
        onChange={(event) =>
          onChange(
            event.target.value
              ? schema.format === "date"
                ? event.target.value
                : new Date(event.target.value).toISOString()
              : undefined,
          )
        }
      />
    );
  return (
    <textarea
      aria-label={label}
      rows={schema.maxLength && schema.maxLength > 1000 ? 4 : 2}
      maxLength={schema.maxLength}
      className={input}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

export default function SchemaFields({
  schema,
  value,
  onChange,
  records,
  skip = [],
}: {
  schema: Schema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  records?: RecordOption[];
  skip?: string[];
}) {
  const [selectedGroup, setSelectedGroup] = useState("");
  const instanceId = useId().replaceAll(":", "");
  const groups = schemaFieldGroups(schema, skip);
  const hasGroups = Boolean(schema["x-orbit-field-groups"]?.length);
  const activeGroup = groups.find((group) => group.id === selectedGroup) || groups[0];
  const tabId = (groupId: string) => `${instanceId}-group-${groupId}`;
  const visibleFields = hasGroups ? activeGroup?.fields || [] : groups[0]?.fields || [];
  return (
    <div className="grid min-w-0 gap-4">
      {hasGroups && groups.length > 1 && (
        <div role="tablist" aria-label={schema.title || "Seções do formulário"} className="flex min-w-0 flex-wrap gap-2 border-b border-[#dfe1e6] pb-2">
          {groups.map((group) => (
            <button
              key={group.id}
              id={`${tabId(group.id)}-tab`}
              type="button"
              role="tab"
              aria-selected={activeGroup?.id === group.id}
              aria-controls={`${tabId(group.id)}-panel`}
              className={`min-h-11 rounded-lg border px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c66e4] ${activeGroup?.id === group.id ? "border-[#0c66e4] bg-[#0c66e4] text-white" : "border-[#8590a2] bg-white text-[#172b4d] hover:bg-[#f3f5f8]"}`}
              tabIndex={activeGroup?.id === group.id ? 0 : -1}
              onClick={() => setSelectedGroup(group.id)}
              onKeyDown={(event) => {
                const current = groups.findIndex((item) => item.id === group.id);
                let next = current;
                if (event.key === "ArrowRight") next = (current + 1) % groups.length;
                else if (event.key === "ArrowLeft") next = (current - 1 + groups.length) % groups.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = groups.length - 1;
                else return;
                event.preventDefault();
                const nextGroup = groups[next];
                setSelectedGroup(nextGroup.id);
                document.getElementById(`${tabId(nextGroup.id)}-tab`)?.focus();
              }}
            >
              {group.label}
            </button>
          ))}
        </div>
      )}
      {hasGroups && groups.length === 1 && <h3 className="text-base font-semibold">{groups[0].label}</h3>}
      <div
        role={hasGroups ? "tabpanel" : undefined}
        id={hasGroups && activeGroup ? `${tabId(activeGroup.id)}-panel` : undefined}
        aria-labelledby={hasGroups && activeGroup && groups.length > 1 ? `${tabId(activeGroup.id)}-tab` : undefined}
        className="grid min-w-0 gap-4"
      >
      {visibleFields.map((key) => {
        const field = schema.properties?.[key];
        if (!field) return null;
        return (
          <div key={key} className="min-w-0">
            <p className="mb-1 text-sm font-semibold">
              {field.title || fieldLabel(key)}
              {schema.required?.includes(key) ? " *" : ""}
            </p>
            {field.description && <p className="mb-2 text-sm">{field.description}</p>}
            <Field
              schema={field}
              label={field.title || fieldLabel(key)}
              value={value[key]}
        records={records}
              onChange={(next) => {
                const updated = { ...value };
                if (next === undefined) delete updated[key];
                else updated[key] = next;
          if (field.recordRevisionField) {
            const selected = records?.find((record) => record.id === next);
            if (selected) updated[field.recordRevisionField] = selected.revision;
            else delete updated[field.recordRevisionField];
          }
                onChange(updated);
              }}
            />
          </div>
        );
      })}
      </div>
    </div>
  );
}
