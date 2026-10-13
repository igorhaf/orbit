import Ajv from "ajv";
import {
  CardLayoutContribution,
  CardTypeContribution,
  BoardViewContribution,
  ActionDefinition,
  CapabilityDefinition,
  ConnectionProviderDefinition,
  PluginContribution,
  PluginDefinition,
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

export const defineCardLayout = <T extends CardLayoutContribution>(value:T)=>{
  identifier(value.id,'Card layout');if(!value.name.trim()||!Array.isArray(value.slots))throw new Error('Layout de cartão inválido.');return Object.freeze({...value,slots:[...value.slots],fields:value.fields?.map(field=>({...field,options:field.options?.map(option=>({...option}))}))});
};

export const defineCardType = <T extends CardTypeContribution>(value:T)=>{
  identifier(value.id,'Card type');if(!value.name.trim()||(value.slots||[]).some(slot=>typeof slot!=='string'||!slot))throw new Error('Tipo de cartão inválido.');return Object.freeze({...value,slots:[...(value.slots||[])]});
};

export const defineBoardView = <T extends BoardViewContribution>(value:T)=>{
  identifier(value.id,'Board view');identifier(value.renderer,'Board renderer');identifier(value.permission,'Board permission');
  if(!value.name.trim())throw new Error('Nome da visualização obrigatório.');return Object.freeze({...value});
};

export const definePlugin = <T extends PluginDefinition>(definition: T): T => {
  identifier(definition.id, "Plugin");
  if (!definition.name.trim()) throw new Error("Nome do plugin obrigatório.");
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(definition.version))
    throw new Error(`Versão inválida para ${definition.id}.`);
  const dependencies=definition.dependencies||[];for(const dependency of dependencies){identifier(dependency,'Dependency');if(dependency===definition.id)throw new Error('Plugin não pode depender de si mesmo.');}
  const layouts=(definition.contributions?.cardLayouts||[]).map(defineCardLayout);unique(layouts,'Card layout');
  const cardTypes=(definition.contributions?.cardTypes||[]).map(defineCardType);unique(cardTypes,'Card type');
  const boardViews=(definition.contributions?.boardViews||[]).map(defineBoardView);unique(boardViews,'Board view');
  const capabilities = (definition.capabilities || []).map(defineCapability);
  const actions = (definition.actions || []).map(defineAction);
  unique(capabilities, "Capability");
  unique(actions, "Action");
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
    dependencies:[...dependencies],
    capabilities,
    actions,
    connectionProvider,
    contributions: definition.contributions
      ? ({ ...definition.contributions,cardLayouts:layouts,cardTypes,boardViews } as PluginContribution)
      : undefined,
  }) as T;
};
