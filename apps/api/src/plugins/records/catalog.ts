import type { PluginDefinition, JsonSchema } from "../contract";

export type RecordDefinition = {
  label: string;
  schema: JsonSchema;
  initial: string;
  transitions: Record<string, string[]>;
  immutable?: string[];
  example: Record<string, unknown>;
};
export type RecordPlugin = {
  plugin: PluginDefinition;
  kinds: Record<string, RecordDefinition>;
};

const string = (maxLength = 2000): JsonSchema => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const strings: JsonSchema = {
  type: "array",
  items: string(240),
  maxItems: 100,
  uniqueItems: true,
};
const uuid: JsonSchema = {
  type: "string",
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
};
export function object(
  properties: Record<string, JsonSchema>,
  required = Object.keys(properties),
): JsonSchema {
  return { type: "object", additionalProperties: false, properties, required };
}
function published(
  label: string,
  schema: JsonSchema,
  example: Record<string, unknown>,
): RecordDefinition {
  return {
    label,
    schema,
    example,
    initial: "draft",
    transitions: { draft: ["published"] },
    immutable: ["published"],
  };
}
function plugin(
  id: string,
  name: string,
  description: string,
  kinds: Record<string, RecordDefinition>,
  dependencies = ["versioned-records"],
): RecordPlugin {
  return {
    plugin: {
      id,
      name,
      description,
      version: "1.0.0",
      scope: "workspace",
      dependencies,
      capabilities: ["read", "write", "publish"].map((action) => ({
        id: action,
        name:
          action === "read"
            ? "Consultar registros"
            : action === "write"
              ? "Criar e revisar registros"
              : "Publicar e concluir registros",
        permissions: [`plugin.${id}.${action}`],
      })),
      contributions: {
        navigation: [{ id, href: "/extensions", label: "Extensões" }],
      },
    },
    kinds,
  };
}

export const recordsBasePlugin: PluginDefinition = {
  id: "versioned-records",
  name: "Registros versionados",
  version: "1.0.0",
  scope: "workspace",
  dependencies: ["workspaces"],
  description:
    "Histórico imutável, referências a versões e operações idempotentes para extensões.",
};

export const recordPlugins: RecordPlugin[] = [
  plugin(
    "reference-library",
    "Biblioteca de referências",
    "Documentos, diretrizes e taxonomias com publicação versionada.",
    {
      document: published(
        "Documento",
        object(
          {
            content: string(100000),
            source_reference: string(1000),
            authority: string(240),
            topics: strings,
            valid_from: { type: "string", format: "date" },
            valid_until: { type: "string", format: "date" },
          },
          ["content", "source_reference"],
        ),
        {
          content: "Política genérica de atendimento.",
          source_reference: "Documento de demonstração",
          topics: ["Atendimento"],
        },
      ),
      guideline: published(
        "Diretriz",
        object(
          {
            content: string(100000),
            source_reference: string(1000),
            topics: strings,
          },
          ["content", "source_reference"],
        ),
        {
          content: "Utilizar linguagem clara nos comunicados.",
          source_reference: "Exemplo genérico",
          topics: ["Comunicação"],
        },
      ),
    },
  ),
  plugin(
    "policy-parameters",
    "Parâmetros versionados",
    "Conjuntos de parâmetros publicados e referências congeladas.",
    {
      policy: published(
        "Política de parâmetros",
        object({
          source_reference: string(1000),
          parameters: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            items: object(
              {
                code: string(80),
                value: {},
                minimum: { type: "number" },
                maximum: { type: "number" },
                source_reference: string(1000),
              },
              ["code", "value"],
            ),
          },
        }),
        {
          source_reference: "Política de atendimento de demonstração",
          parameters: [
            { code: "response_days", value: 5, minimum: 1, maximum: 30 },
          ],
        },
      ),
    },
  ),
  plugin(
    "terms",
    "Termos e aceites",
    "Publicação de termos e histórico de aceite por usuário.",
    {
      term: published(
        "Termo",
        object({ content: string(100000), source_reference: string(1000) }, [
          "content",
        ]),
        { content: "Termo de uso de demonstração." },
      ),
    },
  ),
  plugin(
    "assessments",
    "Matrizes de avaliação",
    "Dimensões, critérios e resultados configuráveis.",
    {
      matrix: published(
        "Matriz",
        object({
          outcomes: strings,
          dimensions: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: object({
              code: string(80),
              title: string(240),
              criteria: {
                type: "array",
                minItems: 1,
                maxItems: 200,
                items: object(
                  {
                    code: string(80),
                    title: string(500),
                    source_reference: string(1000),
                    evidence_required: { type: "boolean" },
                    justification_required: { type: "boolean" },
                    outcomes: strings,
                  },
                  ["code", "title", "outcomes"],
                ),
              },
            }),
          },
        }),
        {
          outcomes: ["adequate", "needs_improvement"],
          dimensions: [
            {
              code: "quality",
              title: "Qualidade",
              criteria: [
                {
                  code: "clarity",
                  title: "Clareza da documentação",
                  outcomes: ["adequate", "needs_improvement"],
                  evidence_required: true,
                },
              ],
            },
          ],
        },
      ),
    },
  ),
  plugin(
    "privacy",
    "Privacidade",
    "Inventário de tratamentos e acompanhamento de solicitações.",
    {
      activity: published(
        "Atividade de tratamento",
        object(
          {
            purpose: string(2000),
            data_categories: strings,
            subject_categories: strings,
            legal_basis_reference: string(1000),
            retention_reference: string(1000),
            source_reference: string(1000),
          },
          [
            "purpose",
            "data_categories",
            "subject_categories",
            "legal_basis_reference",
            "retention_reference",
          ],
        ),
        {
          purpose: "Atendimento a clientes de demonstração",
          data_categories: ["Contato"],
          subject_categories: ["Clientes"],
          legal_basis_reference: "Definir antes da publicação",
          retention_reference: "Definir antes da publicação",
        },
      ),
      request: {
        label: "Solicitação de titular",
        schema: object(
          {
            request_type: {
              enum: [
                "access",
                "correction",
                "elimination",
                "portability",
                "revocation",
                "objection",
                "other",
              ],
            },
            opaque_reference: {
              type: "string",
              pattern: "^[A-Z]{2,10}-[0-9]{4,12}$",
            },
            response_reference: string(240),
          },
          ["request_type", "opaque_reference"],
        ),
        initial: "received",
        transitions: {
          received: ["identity_verification", "triage", "blocked"],
          identity_verification: ["triage", "blocked"],
          triage: ["in_review", "blocked"],
          in_review: ["response_ready", "blocked"],
          response_ready: ["in_review", "completed", "blocked"],
          blocked: ["triage"],
        },
        immutable: ["completed"],
        example: { request_type: "access", opaque_reference: "DEMO-000001" },
      },
    },
  ),
  plugin(
    "compliance",
    "Declarações e conflitos",
    "Declarações de relações e tratamento de conflitos de interesse.",
    {
      disclosure: published(
        "Declaração",
        object(
          {
            relationship_type: string(120),
            related_resource_type: string(80),
            related_resource_id: uuid,
            statement: string(4000),
            expires_at: { type: "string", format: "date-time" },
          },
          ["relationship_type", "statement"],
        ),
        {
          relationship_type: "professional",
          statement: "Exemplo genérico de declaração de relação profissional.",
        },
      ),
      case: {
        label: "Caso de conformidade",
        schema: object(
          {
            reason: string(4000),
            resolution: string(4000),
            decision_reference: string(1000),
            disclosure_id: uuid,
          },
          ["reason"],
        ),
        initial: "open",
        transitions: {
          open: ["in_review"],
          in_review: ["resolved", "dismissed"],
        },
        immutable: ["resolved", "dismissed"],
        example: { reason: "Analisar uma possível relação declarada." },
      },
    },
  ),
  plugin(
    "forms",
    "Formulários",
    "Definições configuráveis, rascunhos e submissões versionadas.",
    {
      form: published(
        "Formulário",
        object({ description: string(4000), schema: { type: "object" } }, [
          "schema",
        ]),
        {
          description: "Solicitação genérica de atendimento",
          schema: object({ request: string(1000) }),
        },
      ),
      submission: {
        label: "Resposta",
        schema: object({
          form_id: uuid,
          form_revision: { type: "integer", minimum: 1 },
          answers: { type: "object" },
        }),
        initial: "draft",
        transitions: { draft: ["submitted"] },
        immutable: ["submitted"],
        example: {
          form_id: "00000000-0000-4000-8000-000000000001",
          form_revision: 1,
          answers: { request: "Exemplo de solicitação" },
        },
      },
    },
  ),
  plugin(
    "workflows",
    "Processos e triagem",
    "Fluxos configuráveis, protocolos, revisões e pedidos de complemento.",
    {
      definition: published(
        "Definição de fluxo",
        object({
          states: strings,
          initial_state: string(80),
          transitions: {
            type: "array",
            maxItems: 500,
            items: object({ from: string(80), to: string(80) }),
          },
        }),
        {
          states: ["open", "in_review", "completed"],
          initial_state: "open",
          transitions: [
            { from: "open", to: "in_review" },
            { from: "in_review", to: "completed" },
          ],
        },
      ),
      process: {
        label: "Processo",
        schema: object(
          {
            definition_id: uuid,
            definition_revision: { type: "integer", minimum: 1 },
            current_state: string(80),
            protocol: string(120),
            target_type: string(80),
            target_id: uuid,
          },
          ["definition_id", "definition_revision"],
        ),
        initial: "active",
        transitions: { active: ["completed"] },
        immutable: ["completed"],
        example: {
          definition_id: "00000000-0000-4000-8000-000000000001",
          definition_revision: 1,
        },
      },
      review: {
        label: "Revisão de triagem",
        schema: object({
          process_id: uuid,
          outcome: { enum: ["pending", "ready", "human_review"] },
          reason: string(4000),
          checks: { type: "object", additionalProperties: { type: "boolean" } },
        }),
        initial: "draft",
        transitions: { draft: ["published"] },
        immutable: ["published"],
        example: {
          process_id: "00000000-0000-4000-8000-000000000001",
          outcome: "pending",
          reason: "Conferir documentação recebida.",
          checks: { complete: false },
        },
      },
      followup: {
        label: "Pedido de complemento",
        schema: object(
          {
            process_id: uuid,
            reason: string(4000),
            responsible_user_id: uuid,
            due_at: { type: "string", format: "date-time" },
            response: string(4000),
          },
          ["process_id", "reason", "responsible_user_id", "due_at"],
        ),
        initial: "open",
        transitions: {
          open: ["responded"],
          responded: ["returned", "resolved"],
          returned: ["responded"],
        },
        immutable: ["resolved"],
        example: {
          process_id: "00000000-0000-4000-8000-000000000001",
          reason: "Complementar a informação solicitada.",
          responsible_user_id: "00000000-0000-4000-8000-000000000001",
          due_at: "2030-01-01T12:00:00Z",
        },
      },
    },
  ),
  plugin(
    "deadlines",
    "Prazos e SLA",
    "Relógios configuráveis com pausa, retomada e prorrogação.",
    {
      clock: {
        label: "Prazo",
        schema: object(
          {
            duration_days: { type: "integer", minimum: 1, maximum: 3660 },
            started_at: { type: "string", format: "date-time" },
            due_at: { type: "string", format: "date-time" },
            paused_at: { type: ["string", "null"], format: "date-time" },
            target_type: string(80),
            target_id: uuid,
          },
          ["duration_days"],
        ),
        initial: "running",
        transitions: {
          running: ["paused", "completed"],
          paused: ["running", "completed"],
        },
        immutable: ["completed"],
        example: { duration_days: 5 },
      },
    },
  ),
  plugin(
    "documents",
    "Documentos versionados",
    "Arquivos, verificações de integridade e revisão de anonimização.",
    {
      document: {
        label: "Documento",
        schema: object(
          {
            file_name: string(240),
            mime_type: string(160),
            size_bytes: { type: "integer", minimum: 1, maximum: 8388608 },
            sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
            variant: { enum: ["original", "anonymized"] },
            source_id: uuid,
            source_revision: { type: "integer", minimum: 1 },
            file_revision: { type: "integer", minimum: 1 },
            scan_status: { enum: ["clean", "not_configured"] },
          },
          [
            "file_name",
            "mime_type",
            "size_bytes",
            "sha256",
            "variant",
            "file_revision",
            "scan_status",
          ],
        ),
        initial: "draft",
        transitions: { draft: ["published"] },
        immutable: ["published"],
        example: {},
      },
      review: published(
        "Revisão independente",
        object({
          document_id: uuid,
          document_revision: { type: "integer", minimum: 1 },
          decision: { enum: ["approved", "rejected"] },
          checks: {
            type: "object",
            minProperties: 1,
            additionalProperties: { type: "boolean" },
          },
          reason: string(4000),
        }),
        {
          document_id: "00000000-0000-4000-8000-000000000001",
          document_revision: 1,
          decision: "approved",
          checks: { personal_data_removed: true, metadata_checked: true },
          reason: "Revisão independente de demonstração.",
        },
      ),
    },
  ),
];

export const genericPlugins = [
  recordsBasePlugin,
  ...recordPlugins.map((item) => item.plugin),
];
const documentsPlugin = genericPlugins.find((item) => item.id === "documents")!;
documentsPlugin.configuration = [
  {
    key: "ORBIT_DOCUMENT_SCANNER_BIN",
    label: "Executável ClamAV",
    secret: false,
    type: "text",
    description:
      "Opcional; quando configurado, cada envio exige uma verificação concluída pelo scanner.",
  },
];
documentsPlugin.configurable = true;
export function recordPlugin(pluginId: string): RecordPlugin | undefined {
  return recordPlugins.find((item) => item.plugin.id === pluginId);
}
