import type { ExecutionInput, Output } from "../execution/types";

export type JsonSchema = Record<string, unknown>;
export type PluginScope = "board" | "workspace" | "account";

export type CapabilityDefinition = {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
};

export type PluginActionContext = {
  userId?: string;
  workspaceId?: string;
  projectId?: string;
  cardId?: string;
  runId?: string;
  connectionId?: string;
  execution?: ExecutionInput;
  logger?: {
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
  };
  services?: Readonly<Record<string, unknown>> & {
    notifications?: { publish(input: import("./notifications").PluginNotificationInput): Promise<unknown> };
  };
};

export type ActionDefinition = {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
  requiredCapabilities?: string[];
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  execute?: (
    input: Record<string, unknown>,
    context: PluginActionContext,
  ) => Promise<Output>;
};

export type ConnectionProviderDefinition = {
  id: string;
  name: string;
  supportsMultiple: boolean;
  capabilities: string[];
  metadata?: Record<string, unknown>;
};

export type PluginContribution = {
  navigation?: Array<Record<string, unknown>>;
  settings?: Array<Record<string, unknown>>;
  cardActions?: Array<Record<string, unknown>>;
  calendarSources?: Array<Record<string, unknown>>;
  resourceRenderers?: Array<Record<string, unknown>>;
  notifications?: Array<{ id: string; label: string }>;
};

export type PluginDefinition = {
  id: string;
  name: string;
  version: string;
  description?: string;
  scope?: PluginScope;
  capabilities?: CapabilityDefinition[];
  actions?: ActionDefinition[];
  connectionProvider?: ConnectionProviderDefinition;
  contributions?: PluginContribution;
};

export type ExternalResource = {
  id: string;
  ownerId: string;
  pluginId: string;
  connectionId?: string | null;
  resourceType: string;
  externalId: string;
  externalParentId?: string | null;
  url?: string | null;
  etag?: string | null;
  orbitEntityType?: string | null;
  orbitEntityId?: string | null;
  metadata: Record<string, unknown>;
};
