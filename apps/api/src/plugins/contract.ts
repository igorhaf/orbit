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

export type PluginConfigurationField = {
  key: string;
  label: string;
  secret: boolean;
  type?: "text" | "textarea" | "number" | "boolean" | "url" | "select";
  required?: boolean;
  description?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
  allowVaultReference?: boolean;
};

export type CardLayoutContribution = { id: string; name: string; slots: string[]; fields?: Array<{key:string;label:string;type:"text"|"textarea"|"select";maxLength?:number;showOnCard?:boolean;childDefault?:string;options?:Array<{value:string;label:string;color?:string;blocksExecution?:boolean}>}> };
export type CardTypeContribution = { id: string; name: string; description?: string; slots?: string[] };
export type BoardViewContribution = { id:string; name:string; description?:string; renderer:string; permission:string };
export type RecordValidationIssue = { severity: "error" | "warning"; code: string; path: string; message: string };
export type ResolvedRecordReference = { id: string; pluginId: string; kind: string; state: string; revision: number; payload: Record<string, unknown> };
export type RecordValidationContext = {
  resolveRecord: (recordId: string, revision: number) => Promise<ResolvedRecordReference | null>;
  /** Resolves the current version of a record in the same workspace, for live entity relationships. */
  resolveLatestRecord?: (recordId: string) => Promise<ResolvedRecordReference | null>;
  /** Returns an aggregate count over latest versions in this workspace without returning record contents. */
  countLatestRecordsByPayloadValue?: (pluginId: string, kind: string, state: string, field: string, value: string, lockScope?: string, excludeRecordId?: string) => Promise<number | null>;
  /** Counts latest versions whose JSON payload contains all supplied scalar values. */
  countLatestRecordsMatchingPayload?: (pluginId: string, kind: string, state: string, match: Record<string, string>, lockScope?: string, excludeRecordId?: string) => Promise<number | null>;
  /** Checks authorship without exposing the linked record payload. */
  isRecordOwner?: (recordId: string, userId: string) => Promise<boolean>;
  nextSequence?: () => Promise<string>;
  actorId?: string;
  recordId?: string;
  hasPermission?: (permission: string) => Promise<boolean>;
  /** Checks a global capability independently from access to this record's exact scope. */
  hasGlobalPermission?: (permission: string) => Promise<boolean>;
  /** Checks a permission with membership in the current workspace. */
  hasWorkspacePermission?: (permission: string) => Promise<boolean>;
  /** Checks a permission on an exact record scope, independent of the current record being validated. */
  hasPermissionOnResource?: (permission: string, recordId: string) => Promise<boolean>;
  /** Checks whether a particular user accepted the exact published terms revision. */
  hasAcceptedTerm?: (recordId: string, revision: number, userId: string) => Promise<boolean>;
};
export type RecordKindContribution = {
  label: string;
  schema: JsonSchema;
  initial: string;
  transitions: Record<string, string[]>;
  immutable?: string[];
  example: Record<string, unknown>;
  /** Payload properties that must remain unique within a workspace for this plugin and kind. */
  uniqueFields?: string[];
  /** Payload fields that become immutable after the record leaves its initial state. */
  immutablePayloadFieldsAfterInitial?: string[];
  /** When enabled, each record requires an `extension_record` scoped grant or its creator's membership. */
  resourceScoped?: boolean;
  /** Optional global capability for staff who administer every record of this kind. */
  managePermission?: string;
  /** Optional authoritative record policy for assignments that must override broad plugin grants. */
  authorizeRecord?: (actorId: string, action: string, state: string, payload: Record<string, unknown>, context: RecordValidationContext) => boolean | Promise<boolean>;
  /** Optional resource-aware authorization for creating a record without granting workspace-wide write access. */
  authorizeCreate?: (actorId: string, payload: Record<string, unknown>, context: RecordValidationContext) => boolean | Promise<boolean>;
  /** Marks records created only by plugin-owned operations, not by the generic record form. */
  serverCreated?: boolean;
  /** Declarative plugin-owned operations shown in the shared record detail view. */
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
  /** Computes allowed states from a pinned, plugin-owned workflow definition. */
  availableTransitions?: (state: string, payload: Record<string, unknown>, context: RecordValidationContext) => string[] | Promise<string[]>;
  /** Performs a plugin-owned role check after the transition has passed the state-machine check. */
  authorizeTransition?: (from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext) => boolean | Promise<boolean>;
  /** Lets a plugin prepare its own payload when a validated state transition occurs. */
  prepareTransition?: (from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Lets a plugin pause or resume linked generic deadline clocks as part of the same atomic transition. */
  deadlineEffects?: (from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext) => Array<{ recordId: string; event: "pause" | "resume"; reason: string }> | Promise<Array<{ recordId: string; event: "pause" | "resume"; reason: string }>>;
  /** Applies exact resource-role grants atomically with a validated state transition. */
  recordRoleEffects?: (from: string, to: string, payload: Record<string, unknown>, context: RecordValidationContext) => Array<{ userId: string; roleId: string; recordId: string; effect: "grant" | "revoke" }> | Promise<Array<{ userId: string; roleId: string; recordId: string; effect: "grant" | "revoke" }>>;
  /** Optional semantic checks owned by the plugin; warnings remain reviewable, errors prevent persistence. */
  validate?: (payload: Record<string, unknown>, context: RecordValidationContext) => RecordValidationIssue[] | Promise<RecordValidationIssue[]>;
};

export type RecordBoardDefinition={
 visible:boolean;fixedScope:true;phases:Array<{id:string;label:string}>;
 templates:Array<{id:string;name:string;phase:string;description:string;checklist:string[]}>;
};
export type PluginContribution = {
 boardCreators?:Array<{id:string;name:string;href:string;permission:string}>;
  /** Opt-in native collaboration, with sensitive title references checked per user. */
  recordCards?:Array<{kind:string;label:string;description?:string;href?:string;recordParam?:string;board?:RecordBoardDefinition;titleReference?:{plugin:string;idField:string;revisionField:string;titleField:string}}>;

  /** Domain adapters expose a board backed by their existing authorized records. */
  processBoards?: Array<{id:string;name:string;href:string;permission:string}>;
  cardLayouts?: CardLayoutContribution[];
  cardTypes?: CardTypeContribution[];
  boardViews?: BoardViewContribution[];
  navigation?: Array<{id:string;label:string;href:string;permission?:string;order?:number;
    group?:{id:string;label:string;order?:number};section?:{id:string;label:string;order?:number}}> ;
  settings?: Array<Record<string, unknown>>;
  cardActions?: Array<Record<string, unknown>>;
  calendarSources?: Array<Record<string, unknown>>;
  resourceRenderers?: Array<Record<string, unknown>>;
  notifications?: Array<{ id: string; label: string }>;
  /** Versioned domain records provided by this plugin over the shared records engine. */
  recordKinds?: Record<string, RecordKindContribution>;
};

export type PluginDefinition = {
  id: string;
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
  /** Plugin-owned API route matcher; the host uses it for routing and access control. */
  handlesRoute?: (path: string) => boolean;
  /** Return null when a plugin route performs its own resource-level authorization. */
  routePermission?: (path: string, method: string) => string | null;
  scope?: PluginScope;
  configurable?: boolean;
  configuration?: PluginConfigurationField[];
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
