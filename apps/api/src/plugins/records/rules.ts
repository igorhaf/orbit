import Ajv from "ajv";
import { HttpException } from "@nestjs/common";
import type { JsonSchema } from "../contract";

export type Payload = Record<string, unknown>;
export function invalid(message: string, status = 400): never {
  throw new HttpException({ message }, status);
}
export function only(body: Payload, keys: string[]) {
  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== "object" ||
    Object.keys(body).some((key) => !keys.includes(key))
  )
    invalid("O corpo contém campos não reconhecidos.");
}
export function validate(schema: JsonSchema, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined || serialized.length > 250000)
    invalid("Conteúdo ausente ou muito grande.");
  const ajv = new Ajv({ allErrors: true, jsonPointers: true });
  if (!ajv.validate(schema, payload))
    invalid(
      "Conteúdo inválido: " + ajv.errorsText(ajv.errors, { separator: "; " }),
    );
}
export function validateFormSchema(schema: unknown) {
  const ajv = new Ajv({ allErrors: true });
  try {
    if (
      !schema ||
      typeof schema !== "object" ||
      Array.isArray(schema) ||
      (schema as Payload).type !== "object"
    )
      invalid("O formulário precisa definir um objeto JSON Schema.");
    if (
      JSON.stringify(schema).length > 50000 ||
      JSON.stringify(schema).includes('"$ref"')
    )
      invalid(
        "O formulário deve usar um schema local com até 50 mil caracteres, sem referências externas.",
      );
    ajv.compile(schema as JsonSchema);
  } catch {
    invalid("Schema de formulário inválido.");
  }
}
export function validateDefinition(
  plugin: string,
  kind: string,
  payload: Payload,
) {
  if (plugin === "forms" && kind === "form") validateFormSchema(payload.schema);
  if (plugin === "policy-parameters") {
    const parameters = payload.parameters as Array<Payload>;
    const codes = new Set<string>();
    for (const parameter of parameters) {
      const code = String(parameter.code);
      if (codes.has(code)) invalid("Há parâmetros com código repetido.");
      codes.add(code);
      if (
        parameter.minimum !== undefined &&
        parameter.maximum !== undefined &&
        Number(parameter.minimum) > Number(parameter.maximum)
      )
        invalid("O mínimo não pode exceder o máximo.");
      if (parameter.minimum !== undefined || parameter.maximum !== undefined) {
        if (
          typeof parameter.value !== "number" ||
          !Number.isFinite(parameter.value)
        )
          invalid("Parâmetros com limites precisam ter valor numérico.");
        if (
          (parameter.minimum !== undefined &&
            parameter.value < Number(parameter.minimum)) ||
          (parameter.maximum !== undefined &&
            parameter.value > Number(parameter.maximum))
        )
          invalid("Valor do parâmetro fora dos limites.");
      }
    }
  }
  if (plugin === "assessments") {
    const outcomes = payload.outcomes as string[];
    if (!outcomes.length) invalid("A matriz precisa de resultados possíveis.");
    const dimensions = payload.dimensions as Array<{
      code: string;
      criteria: Array<{ code: string; outcomes: string[] }>;
    }>;
    if (new Set(dimensions.map((d) => d.code)).size !== dimensions.length)
      invalid("Dimensões com códigos repetidos.");
    for (const dimension of dimensions) {
      if (
        new Set(dimension.criteria.map((c) => c.code)).size !==
        dimension.criteria.length
      )
        invalid("Critérios com códigos repetidos.");
      for (const criterion of dimension.criteria)
        if (
          !criterion.outcomes.length ||
          criterion.outcomes.some((code) => !outcomes.includes(code))
        )
          invalid("O critério usa um resultado não definido na matriz.");
    }
  }
  if (plugin === "workflows" && kind === "definition") {
    const states = payload.states as string[];
    if (!states.length || !states.includes(String(payload.initial_state)))
      invalid("O estado inicial deve existir na definição de fluxo.");
    for (const transition of payload.transitions as Array<{
      from: string;
      to: string;
    }>)
      if (
        !states.includes(transition.from) ||
        !states.includes(transition.to) ||
        transition.from === transition.to
      )
        invalid("Transição de fluxo inválida.");
  }
  if (
    plugin === "reference-library" &&
    payload.valid_from &&
    payload.valid_until &&
    String(payload.valid_until) < String(payload.valid_from)
  )
    invalid("A vigência final deve ser posterior à inicial.");
}

export function deadlineDueAt(startedAt: Date, durationDays: number) {
  if (
    !Number.isInteger(durationDays) ||
    durationDays < 1 ||
    durationDays > 3660 ||
    !Number.isFinite(startedAt.getTime())
  )
    invalid("Duração ou data do prazo inválida.");
  return new Date(startedAt.getTime() + durationDays * 86400000).toISOString();
}
export function deadlineTransition(
  state: string,
  payload: Payload,
  event: string,
  now: Date,
  extensionDays?: unknown,
): { state: string; payload: Payload } {
  const next = { ...payload };
  if (state === "completed") invalid("O prazo já está concluído.", 409);
  if (
    !Number.isFinite(now.getTime()) ||
    now.getTime() < new Date(String(payload.started_at)).getTime()
  )
    invalid("Data de evento inválida.");
  if (event === "pause" && state === "running") {
    next.paused_at = now.toISOString();
    return { state: "paused", payload: next };
  }
  if (event === "resume" && state === "paused") {
    const elapsed =
      now.getTime() - new Date(String(payload.paused_at)).getTime();
    if (!Number.isFinite(elapsed) || elapsed < 0)
      invalid("A retomada deve suceder a pausa.");
    next.due_at = new Date(
      new Date(String(payload.due_at)).getTime() + elapsed,
    ).toISOString();
    next.paused_at = null;
    return { state: "running", payload: next };
  }
  if (event === "extend") {
    if (
      !Number.isInteger(extensionDays) ||
      Number(extensionDays) < 1 ||
      Number(extensionDays) > 3660
    )
      invalid("Prorrogação inválida.");
    next.due_at = new Date(
      new Date(String(payload.due_at)).getTime() +
        Number(extensionDays) * 86400000,
    ).toISOString();
    return { state, payload: next };
  }
  if (event === "complete")
    return { state: "completed", payload: { ...next, paused_at: null } };
  return invalid("Evento incompatível com o estado do prazo.", 409);
}

export function nextWorkflowState(
  definition: Payload,
  current: string,
  next: string,
) {
  const transitions = definition.transitions as Array<{
    from: string;
    to: string;
  }>;
  if (!transitions.some((edge) => edge.from === current && edge.to === next))
    invalid("Transição não prevista na versão do fluxo.", 409);
  return next;
}
