import Ajv from "ajv";
import {
  ActionDefinition,
  CapabilityDefinition,
  ConnectionProviderDefinition,
  PluginContribution,
  PluginDefinition,
  TriggerDefinition,
} from "./contract";

const idPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const identifier = (value: string, label: string) => {
  if (!idPattern.test(value)) throw new Error(`${label} inválido: ${value}`);
  return value;
};
const schema = (value: Record<string, unknown>, label: string) => {
  try {
    new Ajv({ allErrors: true }).compile(value);
  } catch (error) {
    throw new Error(`${label} inválido: ${(error as Error).message}`);
  }
};
const unique = <T extends { id: string }>(items: T[], label: string) => {
  const ids = new Set<string>();
  for (const item of items) {
    identifier(item.id, label);
    if (ids.has(item.id)) throw new Error(`${label} duplicado: ${item.id}`);
    ids.add(item.id);
  }
};

export const defineCapability = <T extends CapabilityDefinition>(value: T) => {
  identifier(value.id, "Capability");
  if (!value.name.trim()) throw new Error("Nome da capability obrigatório.");
  return Object.freeze({ ...value });
};

export const defineAction = <T extends ActionDefinition>(value: T) => {
  identifier(value.id, "Action");
  if (!value.name.trim()) throw new Error("Nome da action obrigatório.");
  schema(value.inputSchema, `Input schema de ${value.id}`);
  if (value.outputSchema) schema(value.outputSchema, `Output schema de ${value.id}`);
  return Object.freeze({ ...value });
};

export const defineTrigger = <T extends TriggerDefinition>(value: T) => {
  identifier(value.id, "Trigger");
  if (!value.name.trim()) throw new Error("Nome do trigger obrigatório.");
  schema(value.eventSchema, `Event schema de ${value.id}`);
  return Object.freeze({ ...value });
};

export const defineConnectionProvider = <T extends ConnectionProviderDefinition>(
  value: T,
) => {
  identifier(value.id, "Connection provider");
  return Object.freeze({ ...value, capabilities: [...value.capabilities] });
};

export const defineContribution = <T extends Record<string, unknown>>(value: T) =>
  Object.freeze({ ...value });

export const defineCalendarSource = <T extends Record<string, unknown>>(value: T) =>
  defineContribution({ kind: "calendarSource", ...value });

export const defineCardAction = <T extends Record<string, unknown>>(value: T) =>
  defineContribution({ kind: "cardAction", ...value });

export const definePlugin = <T extends PluginDefinition>(definition: T): T => {
  identifier(definition.id, "Plugin");
  if (!definition.name.trim()) throw new Error("Nome do plugin obrigatório.");
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(definition.version))
    throw new Error(`Versão inválida para ${definition.id}.`);
  const capabilities = (definition.capabilities || []).map(defineCapability);
  const actions = (definition.actions || []).map(defineAction);
  const triggers = (definition.triggers || []).map(defineTrigger);
  unique(capabilities, "Capability");
  unique(actions, "Action");
  unique(triggers, "Trigger");
  const known = new Set(capabilities.map((item) => item.id));
  for (const action of actions)
    for (const capability of action.requiredCapabilities || [])
      if (!known.has(capability)) throw new Error(`Capability não registrada: ${capability}`);
  const connectionProvider = definition.connectionProvider
    ? defineConnectionProvider(definition.connectionProvider)
    : undefined;
  for (const capability of connectionProvider?.capabilities || [])
    if (!known.has(capability)) throw new Error(`Capability não registrada: ${capability}`);
  return Object.freeze({
    ...definition,
    capabilities,
    actions,
    triggers,
    connectionProvider,
    contributions: definition.contributions
      ? ({ ...definition.contributions } as PluginContribution)
      : undefined,
  }) as T;
};
