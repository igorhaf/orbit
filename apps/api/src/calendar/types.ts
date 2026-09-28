export type CalendarResourceType = "event" | "card";

export type CalendarItem = {
  id: string;
  sourceId: string;
  resourceType: CalendarResourceType;
  title: string;
  description?: string | null;
  start: string;
  end?: string | null;
  allDay: boolean;
  timeZone?: string | null;
  location?: string | null;
  externalResourceId?: string | null;
  cardId?: string | null;
  externalUrl?: string | null;
  status?: string;
  recurrence?: unknown[];
  attendees?: unknown[];
  conference?: unknown;
  metadata: Record<string, unknown>;
};

export type CalendarSource = {
  id: string;
  providerId: string;
  connectionId?: string | null;
  externalId: string;
  name: string;
  timeZone?: string | null;
  color?: string | null;
  accessRole?: string | null;
  primary: boolean;
  selected: boolean;
  visible: boolean;
  isDefault: boolean;
  capabilities: Record<string, boolean>;
  metadata: Record<string, unknown>;
};

export type CalendarMutation = {
  title: string;
  description?: string | null;
  start: string;
  end?: string | null;
  allDay?: boolean;
  timeZone?: string | null;
  location?: string | null;
  attendees?: Array<{ email: string; displayName?: string }>;
  recurrence?: string[];
  conference?: boolean;
};

export type AvailabilityRequest = {
  sourceIds: string[];
  start: string;
  end: string;
  timeZone?: string;
};
export type Availability = {
  sourceId: string;
  busy: Array<{ start: string; end: string }>;
};

export interface CalendarSourceProvider {
  readonly id: string;
  readonly name: string;
  listSources(
    ownerId: string,
    connectionId?: string,
  ): Promise<CalendarSource[]>;
  listItems(
    ownerId: string,
    sourceIds: string[],
    start: Date,
    end: Date,
  ): Promise<CalendarItem[]>;
  createItem?(
    ownerId: string,
    sourceId: string,
    input: CalendarMutation,
  ): Promise<CalendarItem>;
  updateItem?(
    ownerId: string,
    itemId: string,
    input: Partial<CalendarMutation>,
    operationId?: string,
  ): Promise<CalendarItem>;
  deleteItem?(
    ownerId: string,
    itemId: string,
    operationId?: string,
  ): Promise<void>;
  getAvailability?(
    ownerId: string,
    input: AvailabilityRequest,
  ): Promise<Availability[]>;
  syncSource?(sourceId: string): Promise<void>;
  sourceSelectionChanged?(sourceId: string, selected: boolean): Promise<void>;
  getConnectUrl?(ownerId: string, option?: string): Promise<{url:string}>;
  readonly connectOptions?: Array<{id:string;label:string}>;
}

export type PluginContribution = {
  navigation?: Array<{
    id: string;
    label: string;
    href: string;
    icon?: string;
  }>;
  calendarSources?: Array<{
    providerId: string;
    label: string;
    connectPath?: string;
  }>;
  cardActions?: Array<{ id: string; label: string }>;
  automationActions?: Array<{
    id: string;
    label: string;
    inputSchema: Record<string, unknown>;
  }>;
  automationTriggers?: Array<{
    id: string;
    label: string;
    payloadSchema: Record<string, unknown>;
  }>;
  settingsPanels?: Array<{ id: string; label: string; href: string }>;
};
