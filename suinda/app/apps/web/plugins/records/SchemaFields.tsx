"use client";

import {
  accessInput as input,
  accessButton as button,
} from "@/components/access-shell";

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
  criterion_id: "ID do critério",
  label: "Rótulo",
  weight: "Peso (%)",
  scale_min: "Nota mínima",
  scale_max: "Nota máxima",
  evidence_basis: "Bases de evidência",
  eligible_evaluators: "Público avaliador",
  nonresponse_policy: "Tratamento da não resposta",
  minimum_anonymous_responses: "Mínimo de respostas anônimas",
  validation_method: "Método de validação",
  appeal_window_days: "Prazo para recurso (dias)",
  appeal_reviewer_role: "Perfil de quem revisa o recurso",
  retention_days: "Retenção prevista (dias)",
  retention_notice_record_id: "Aviso de privacidade que rege a retenção",
  visibility_policy: "Política de visibilidade",
  consequence_policy: "Política de consequências",
  approval_reference: "Referência da aprovação institucional",
  approved_by_user_id: "Aprovado por",
  approved_at: "Aprovado em",
  policy_record_id: "Política institucional",
  teacher_user_id: "Pessoa docente avaliada",
  course_record_id: "Curso",
  course_revision: "Versão curricular",
  cohort_record_id: "Turma",
  survey_record_id: "Pesquisa anônima",
  opens_at: "Início do ciclo",
  closes_at: "Encerramento do ciclo",
  published_criteria: "Critérios publicados no ciclo",
  validation_summary: "Síntese da validação institucional",
  validation_reference: "Referência da ata/parecer institucional",
  validated_by_user_id: "Validado por",
  validated_at: "Validado em",
  cycle_record_id: "Ciclo de avaliação",
  decision_reason: "Fundamentação da decisão",
  reviewer_user_id: "Pessoa revisora",
  decided_at: "Decidido em",
  id: "Identificador",
  category: "Categoria",
  tags: "Etiquetas",
  questions: "Questões",
  question_id: "ID da questão",
  type: "Tipo",
  prompt: "Enunciado",
  options: "Alternativas",
  correct_option_ids: "Alternativas corretas",
  points: "Pontuação",
  max_length: "Limite de caracteres",
  record_id: "Registro",
  revision: "Versão",
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
  const revisionFields = new Set(Object.values(schema.properties || {}).flatMap((field) => field.recordRevisionField ? [field.recordRevisionField] : []));
  return (
    <div className="grid min-w-0 gap-4">
      {Object.entries(schema.properties || {})
        .filter(([key]) => !skip.includes(key) && !revisionFields.has(key))
        .map(([key, field]) => (
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
            {field.recordRevisionField && typeof value[key] === "string" && value[key] && typeof value[field.recordRevisionField] === "number" && <p className="mt-1 text-xs text-slate-400">Versão fixada: v{String(value[field.recordRevisionField])}</p>}
          </div>
        ))}
    </div>
  );
}
