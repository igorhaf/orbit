import {
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Db } from "../db";
import { FeaturesService } from "../features";
import { PluginActionContext, PluginDefinition } from "../plugins/contract";
import { SecretVault } from "../secrets";
import {GoogleCredentials,GOOGLE_CALENDAR_SCOPES} from '../google/credentials';
import {googleRedirectUri} from '../google/redirect-uri';
import {
  Availability,
  AvailabilityRequest,
  CalendarItem,
  CalendarMutation,
  CalendarSource,
  CalendarSourceProvider,
} from "./types";

type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
};
type Connection = {
  id: string;
  owner_id: string;
  plugin_id?:string;
  display_name: string;
  credentials_encrypted: string;
  metadata: Record<string, unknown>;
};
type Source = {
  id: string;
  owner_id: string;
  connection_id: string;
  external_id: string;
  name: string;
  time_zone: string | null;
  color: string | null;
  selected: boolean;
  metadata: Record<string, unknown>;
};
type GoogleDate = { date?: string; dateTime?: string; timeZone?: string };
type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  location?: string;
  status?: string;
  etag?: string;
  htmlLink?: string;
  updated?: string;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleDate;
  attendees?: unknown[];
  conferenceData?: unknown;
  eventType?: string;
  [key: string]: unknown;
};
type GoogleCalendar = {
  id: string;
  summary: string;
  timeZone?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
  deleted?: boolean;
  etag?: string;
};
const apiBase = "https://www.googleapis.com/calendar/v3";
const oauthBase = "https://oauth2.googleapis.com";
const fail = (message: string, status = 400): never => {
  throw new HttpException({ message }, status);
};
const safeMessage = (status: number) =>
  status === 401
    ? "A conexão Google expirou. Reconecte a conta."
    : status === 403
      ? "O Google recusou esta operação. Verifique as permissões do calendário."
      : status === 404
        ? "Evento ou calendário não encontrado no Google."
        : "O Google Calendar não concluiu a operação.";

@Injectable()
export class GoogleCalendarPlugin
  implements
    CalendarSourceProvider,
    OnModuleInit,
    OnModuleDestroy
{
  readonly id = "google_calendar";
  readonly name = "Google Calendar";
  readonly scope = "account" as const;
  readonly contributions = {
    calendarSources: [
      {
        providerId: this.id,
        label: "Google Calendar",
        connectPath: "/calendar/google/oauth/start",
      },
    ],
    pluginActions: [
      {
        id: "google_calendar.list_calendars",
        label: "Listar calendários",
        inputSchema: {
          type: "object",
          properties: { connectionId: { type: "string" } },
        },
      },
      {
        id: "google_calendar.list_events",
        label: "Listar eventos",
        inputSchema: {
          type: "object",
          required: ["sourceId", "start", "end"],
          properties: {
            sourceId: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
          },
        },
      },
      {
        id: "google_calendar.get_event",
        label: "Obter evento",
        inputSchema: {
          type: "object",
          required: ["itemId"],
          properties: { itemId: { type: "string" } },
        },
      },
      {
        id: "google_calendar.create_event",
        label: "Criar evento",
        inputSchema: {
          type: "object",
          required: ["sourceId", "title", "start"],
          properties: {
            sourceId: { type: "string" },
            title: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            description: { type: "string" },
            location: { type: "string" },
            allDay: { type: "boolean" },
            timeZone: { type: "string" },
            attendees: { type: "array", items: { type: "object" } },
            recurrence: { type: "array", items: { type: "string" } },
            conference: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      {
        id: "google_calendar.update_event",
        label: "Atualizar evento",
        inputSchema: {
          type: "object",
          required: ["itemId"],
          properties: {
            itemId: { type: "string" }, title: { type: "string" },
            description: { type: "string" }, start: { type: "string" },
            end: { type: "string" }, location: { type: "string" },
            allDay: { type: "boolean" }, timeZone: { type: "string" },
            attendees: { type: "array", items: { type: "object" } },
            recurrence: { type: "array", items: { type: "string" } },
            conference: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      {
        id: "google_calendar.delete_event",
        label: "Excluir evento",
        inputSchema: {
          type: "object",
          required: ["itemId"],
          properties: { itemId: { type: "string" } },
        },
      },
      {
        id: "google_calendar.get_availability",
        label: "Consultar disponibilidade",
        inputSchema: {
          type: "object",
          required: ["sourceIds", "start", "end"],
          properties: {
            sourceIds: { type: "array", items: { type: "string" } },
            start: { type: "string" },
            end: { type: "string" },
          },
        },
      },
    ],
    settingsPanels: [
      {
        id: "google_calendar",
        label: "Google Calendar",
        href: "/calendar?settings=google_calendar",
      },
    ],
  };
  private timer?: ReturnType<typeof setInterval>;
  private syncing = new Set<string>();
  constructor(
    @Inject(Db) private db: Db,
    @Inject(SecretVault) private vault: SecretVault,
    @Optional() @Inject(GoogleCredentials) private google?:GoogleCredentials,
  ) {}
  onModuleInit() {
    if (process.env.ORBIT_ENV === 'development' && process.env.ORBIT_ALLOW_EXTERNAL_AUTOMATION !== 'true') return;
    this.timer = setInterval(() => void this.maintenance(), 30 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.maintenance(), 5000).unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  configured() {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    );
  }
  private config(): { clientId: string; clientSecret: string } {
    const clientId = process.env.GOOGLE_CLIENT_ID,
      clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      return fail(
        "Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.",
        503,
      );
    return { clientId, clientSecret };
  }
  private redirectUri() {
    return googleRedirectUri('calendar');
  }
  async oauthUrl(ownerId: string) {
    return (this.google??new GoogleCredentials(this.db,this.vault)).start(ownerId,'calendar',GOOGLE_CALENDAR_SCOPES,this.redirectUri());
  }
  getConnectUrl(ownerId:string){return this.oauthUrl(ownerId)}
  async oauthCallback(code: string, state: string) {
    const connection=await (this.google??new GoogleCredentials(this.db,this.vault)).complete(code,state,'calendar');
    const discovered = await this.discover(connection.ownerId, connection.id);
    for (const source of discovered.filter((item) => item.selected))
      await this.syncSource(source.id);
    return connection.id;
  }
  async connections(ownerId: string) {
    const legacy=await this.db.query(
      "SELECT id,display_name,enabled,metadata,created_at,updated_at FROM integration_connections WHERE owner_id=$1 AND plugin_id=$2 ORDER BY created_at",
      [ownerId, this.id],
    );
    const shared=await (this.google??new GoogleCredentials(this.db,this.vault)).available(ownerId,GOOGLE_CALENDAR_SCOPES);
    return [...legacy,...shared.filter(row=>row.pluginId==='google').map(row=>({id:row.id,display_name:row.name,enabled:true,metadata:{},created_at:null,updated_at:null}))];
  }
  private async connection(id: string, ownerId?: string): Promise<Connection> {
    const row = await this.db.one<Connection>(
      "SELECT * FROM integration_connections WHERE id=$1 AND plugin_id=ANY($2::text[]) AND enabled" +
        (ownerId ? " AND owner_id=$3" : ""),
      ownerId ? [id, [this.id,'google'], ownerId] : [id, [this.id,'google']],
    );
    if (!row) return fail("Conexão Google não encontrada.", 404);
    return row;
  }
  private async token(connection: Connection) {
    if(connection.plugin_id==='google')return (this.google??new GoogleCredentials(this.db,this.vault)).token(connection.owner_id,connection.id,GOOGLE_CALENDAR_SCOPES);
    let tokens = this.vault.open<Tokens>(connection.credentials_encrypted);
    if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
    const { clientId, clientSecret } = this.config();
    if (!tokens.refresh_token)
      fail("A conexão Google precisa ser refeita.", 401);
    const response = await fetch(`${oauthBase}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: String(tokens.refresh_token),
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) fail("Não foi possível renovar a conexão Google.", 401);
    const raw = (await response.json()) as Record<string, unknown>;
    tokens = {
      ...tokens,
      access_token: String(raw.access_token),
      expires_at: Date.now() + Number(raw.expires_in || 3600) * 1000,
    };
    await this.db.query(
      "UPDATE integration_connections SET credentials_encrypted=$2,updated_at=now() WHERE id=$1",
      [connection.id, this.vault.seal(tokens)],
    );
    return tokens.access_token;
  }
  private async request<T>(
    connection: Connection,
    path: string,
    init: RequestInit = {},
  ) {
    const response = await fetch(`${apiBase}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.token(connection)}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const error = new Error(safeMessage(response.status)) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  async discover(ownerId: string, connectionId: string) {
    const connection = await this.connection(connectionId, ownerId);
    let syncToken =
      typeof connection.metadata.calendarListSyncToken === "string"
        ? connection.metadata.calendarListSyncToken
        : undefined;
    let pageToken: string | undefined;
    const reconcile = async () => {
      do {
        const query = new URLSearchParams({ maxResults: "250" });
        if (syncToken) query.set("syncToken", syncToken);
        if (pageToken) query.set("pageToken", pageToken);
        const page = await this.request<{
          items?: GoogleCalendar[];
          nextPageToken?: string;
          nextSyncToken?: string;
        }>(connection, `users/me/calendarList?${query}`);
        for (const calendar of page.items || []) {
          if (calendar.deleted) {
            await this.db.query(
              "UPDATE calendar_sources SET selected=false,visible=false,updated_at=now() WHERE owner_id=$1 AND provider_id=$2 AND connection_id=$3 AND external_id=$4",
              [ownerId, this.id, connectionId, calendar.id],
            );
            continue;
          }
          await this.db.query(
            `INSERT INTO calendar_sources(owner_id,provider_id,connection_id,external_id,name,time_zone,color,access_role,is_primary,selected,visible,capabilities,metadata)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12) ON CONFLICT(owner_id,provider_id,connection_id,external_id) DO UPDATE SET name=excluded.name,time_zone=excluded.time_zone,color=excluded.color,access_role=excluded.access_role,is_primary=excluded.is_primary,metadata=excluded.metadata,updated_at=now()`,
            [
              ownerId,
              this.id,
              connectionId,
              calendar.id,
              calendar.summary,
              calendar.timeZone || null,
              calendar.backgroundColor || null,
              calendar.accessRole || null,
              Boolean(calendar.primary),
              Boolean(calendar.selected || calendar.primary),
              JSON.stringify({
                create: ["owner", "writer"].includes(calendar.accessRole || ""),
                update: ["owner", "writer"].includes(calendar.accessRole || ""),
                delete: ["owner", "writer"].includes(calendar.accessRole || ""),
                availability: true,
                sync: true,
              }),
              JSON.stringify({ etag: calendar.etag }),
            ],
          );
        }
        pageToken = page.nextPageToken;
        if (page.nextSyncToken)
          await this.db.query(
            `UPDATE integration_connections SET metadata=metadata||$2::jsonb,updated_at=now() WHERE id=$1`,
            [
              connectionId,
              JSON.stringify({
                calendarListSyncToken: page.nextSyncToken,
                lastDiscoveryAt: new Date().toISOString(),
              }),
            ],
          );
      } while (pageToken);
    };
    try {
      await reconcile();
    } catch (error) {
      if ((error as Error & { status?: number }).status !== 410) throw error;
      syncToken = undefined;
      pageToken = undefined;
      await this.db.query(
        "UPDATE integration_connections SET metadata=metadata-'calendarListSyncToken' WHERE id=$1",
        [connectionId],
      );
      await reconcile();
    }
    return this.listSources(ownerId, connectionId);
  }
  async listSources(
    ownerId: string,
    connectionId?: string,
  ): Promise<CalendarSource[]> {
    const rows = await this.db.query<Source>(
      "SELECT * FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2" +
        (connectionId ? " AND connection_id=$3" : ""),
      connectionId ? [ownerId, this.id, connectionId] : [ownerId, this.id],
    );
    return rows.map((row) => ({
      id: row.id,
      providerId: this.id,
      connectionId: row.connection_id,
      externalId: row.external_id,
      name: row.name,
      timeZone: row.time_zone,
      color: row.color,
      primary: Boolean((row as unknown as { is_primary: boolean }).is_primary),
      selected: row.selected,
      visible: Boolean((row as unknown as { visible: boolean }).visible),
      isDefault: Boolean(
        (row as unknown as { is_default: boolean }).is_default,
      ),
      capabilities: (
        row as unknown as { capabilities: Record<string, boolean> }
      ).capabilities,
      metadata: row.metadata,
    }));
  }
  private date(value: GoogleDate | undefined, defaultZone?: string | null) {
    if (value?.dateTime)
      return {
        at: new Date(value.dateTime),
        allDay: false,
        timeZone: value.timeZone || defaultZone || null,
      };
    if (value?.date)
      return {
        at: new Date(`${value.date}T00:00:00.000Z`),
        allDay: true,
        timeZone: value.timeZone || defaultZone || null,
      };
    return null;
  }
  private async persist(
    source: Source,
    event: GoogleEvent,
    operationId?: string,
  ) {
    const start = this.date(event.start, source.time_zone);
    if (!start && event.status === "cancelled") {
      const cancelled = await this.db.one<Record<string, unknown>>(
        "UPDATE calendar_items SET status='cancelled',etag=$3,provider_updated_at=now(),updated_at=now() WHERE source_id=$1 AND external_id=$2 RETURNING *",
        [source.id, event.id, event.etag || null],
      );
      if (cancelled && !operationId)
        await this.afterChange(
          source,
          cancelled,
          cancelled.card_id as string | null,
        );
      return cancelled ? this.toItem(cancelled) : null;
    }
    if (!start) return null;
    const end = this.date(event.end, source.time_zone);
    const external = await this.db.one<{ id: string }>(
      `INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,external_parent_id,url,etag,metadata)
      VALUES($1,$2,$3,'calendar_event',$4,$5,$6,$7,$8) ON CONFLICT(owner_id,plugin_id,connection_id,resource_type,external_id) DO UPDATE SET external_parent_id=excluded.external_parent_id,url=excluded.url,etag=excluded.etag,metadata=excluded.metadata,updated_at=now() RETURNING id`,
      [
        source.owner_id,
        this.id,
        source.connection_id,
        event.id,
        event.recurringEventId || null,
        event.htmlLink || null,
        event.etag || null,
        JSON.stringify({ eventType: event.eventType || "default" }),
      ],
    );
    const old = await this.db.one<{
      id: string;
      etag: string | null;
      card_id: string | null;
    }>(
      "SELECT id,etag,card_id FROM calendar_items WHERE source_id=$1 AND external_id=$2",
      [source.id, event.id],
    );
    const row = await this.db.one<Record<string, unknown>>(
      `INSERT INTO calendar_items(owner_id,source_id,resource_type,external_resource_id,external_id,title,description,start_at,end_at,all_day,time_zone,location,recurrence,attendees,conference,status,external_url,etag,series_external_id,occurrence_external_id,provider_updated_at,operation_id,metadata)
      VALUES($1,$2,'event',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT(source_id,external_id) DO UPDATE SET title=excluded.title,description=excluded.description,start_at=excluded.start_at,end_at=excluded.end_at,all_day=excluded.all_day,time_zone=excluded.time_zone,location=excluded.location,recurrence=excluded.recurrence,attendees=excluded.attendees,conference=excluded.conference,status=excluded.status,external_url=excluded.external_url,etag=excluded.etag,series_external_id=excluded.series_external_id,occurrence_external_id=excluded.occurrence_external_id,provider_updated_at=excluded.provider_updated_at,operation_id=excluded.operation_id,metadata=excluded.metadata,updated_at=now() RETURNING *`,
      [
        source.owner_id,
        source.id,
        external!.id,
        event.id,
        event.summary || "(Sem título)",
        event.description || "",
        start.at,
        end?.at || start.at,
        start.allDay,
        start.timeZone,
        event.location || null,
        JSON.stringify(event.recurrence || []),
        JSON.stringify(event.attendees || []),
        event.conferenceData ? JSON.stringify(event.conferenceData) : null,
        event.status || "confirmed",
        event.htmlLink || null,
        event.etag || null,
        event.recurringEventId || null,
        event.originalStartTime?.dateTime ||
          event.originalStartTime?.date ||
          null,
        event.updated ? new Date(event.updated) : null,
        operationId || null,
        JSON.stringify({ eventType: event.eventType || "default" }),
      ],
    );
    if (!old || old.etag !== event.etag)
      await this.afterChange(
        source,
        row!,
        old?.card_id || null,
      );
    return this.toItem(row!);
  }
  private async afterChange(
    source: Source,
    item: Record<string, unknown>,
    linkedCard: string | null,
  ) {
    const settings = await this.db.one<Record<string, unknown>>(
      "SELECT * FROM calendar_source_settings WHERE source_id=$1",
      [source.id],
    );
    let cardId = linkedCard;
    if (!cardId && settings?.auto_create_cards && settings.target_list_id) {
      const series = String(item.series_external_id || item.external_id);
      if (settings.recurring_strategy === "series")
        cardId =
          (
            await this.db.one<{ orbit_entity_id: string }>(
              "SELECT orbit_entity_id FROM external_resources WHERE owner_id=$1 AND plugin_id=$2 AND external_parent_id=$3 AND orbit_entity_type='card' LIMIT 1",
              [source.owner_id, this.id, series],
            )
          )?.orbit_entity_id || null;
      if (!cardId) {
        cardId = (await this.db.one<{ id: string }>(
          "INSERT INTO cards(list_id,title,description,position,schedule_start_at,schedule_end_at,schedule_all_day,schedule_time_zone) VALUES($1,$2,$3,COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$1),0),$4,$5,$6,$7) RETURNING id",
          [
            settings.target_list_id,
            item.title,
            item.description || "",
            item.start_at,
            item.end_at,
            item.all_day,
            item.time_zone,
          ],
        ))!.id;
        await this.db.query(
          "UPDATE calendar_items SET card_id=$2 WHERE id=$1",
          [item.id, cardId],
        );
        await this.db.query(
          "UPDATE external_resources SET orbit_entity_type='card',orbit_entity_id=$2 WHERE id=$1",
          [item.external_resource_id, cardId],
        );
      }
    } else if (cardId && settings?.update_linked_cards) {
      const fields = settings.field_mapping as Record<string, boolean>;
      await this.db.query(
        `UPDATE cards SET title=CASE WHEN $2 THEN $3 ELSE title END,description=CASE WHEN $4 THEN $5 ELSE description END,schedule_start_at=$6,schedule_end_at=$7,schedule_all_day=$8,schedule_time_zone=$9,archived_at=CASE WHEN $10 AND $11 THEN now() ELSE archived_at END,updated_at=now() WHERE id=$1 AND (($2 AND title IS DISTINCT FROM $3) OR ($4 AND description IS DISTINCT FROM $5) OR schedule_start_at IS DISTINCT FROM $6 OR schedule_end_at IS DISTINCT FROM $7 OR schedule_all_day IS DISTINCT FROM $8 OR schedule_time_zone IS DISTINCT FROM $9 OR ($10 AND $11 AND archived_at IS NULL))`,
        [
          cardId,
          fields?.title !== false,
          item.title,
          fields?.description !== false,
          item.description || "",
          item.start_at,
          item.end_at,
          item.all_day,
          item.time_zone,
          Boolean(settings.archive_cancelled_cards),
          item.status === "cancelled",
        ],
      );
    }
  }
  private toItem(row: Record<string, unknown>): CalendarItem {
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      resourceType: "event",
      title: String(row.title),
      description: row.description as string | null,
      start: new Date(row.start_at as string).toISOString(),
      end: row.end_at ? new Date(row.end_at as string).toISOString() : null,
      allDay: Boolean(row.all_day),
      timeZone: row.time_zone as string | null,
      location: row.location as string | null,
      externalResourceId: row.external_resource_id as string | null,
      cardId: row.card_id as string | null,
      cardUrlToken: row.card_url_token as string | null,
      externalUrl: row.external_url as string | null,
      status: String(row.status || "confirmed"),
      recurrence: row.recurrence as unknown[],
      attendees: row.attendees as unknown[],
      conference: row.conference,
      metadata: (row.metadata || {}) as Record<string, unknown>,
    };
  }
  async syncSource(sourceId: string) {
    if (this.syncing.has(sourceId)) return;
    this.syncing.add(sourceId);
    try {
      const source = await this.db.one<Source>(
        "SELECT * FROM calendar_sources WHERE id=$1 AND provider_id=$2",
        [sourceId, this.id],
      );
      if (!source || !source.selected) return;
      const connection = await this.connection(source.connection_id);
      const state = await this.db.one<{ cursor: string | null }>(
        "SELECT cursor FROM calendar_sync_states WHERE source_id=$1",
        [source.id],
      );
      await this.db.query(
        `INSERT INTO calendar_sync_states(source_id,status) VALUES($1,'syncing') ON CONFLICT(source_id) DO UPDATE SET status='syncing',last_error=NULL,updated_at=now()`,
        [source.id],
      );
      let cursor = state?.cursor || null,
        pageToken: string | undefined,
        nextSync: string | undefined;
      const run = async (syncToken: string | null) => {
        do {
          const query = new URLSearchParams({
            maxResults: "2500",
            showDeleted: "true",
            singleEvents: "false",
          });
          if (syncToken) query.set("syncToken", syncToken);
          if (pageToken) query.set("pageToken", pageToken);
          const page = await this.request<{
            items?: GoogleEvent[];
            nextPageToken?: string;
            nextSyncToken?: string;
          }>(
            connection,
            `calendars/${encodeURIComponent(source.external_id)}/events?${query}`,
          );
          for (const event of page.items || [])
            await this.persist(source, event);
          pageToken = page.nextPageToken;
          nextSync = page.nextSyncToken || nextSync;
        } while (pageToken);
      };
      try {
        await run(cursor);
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 410) throw error;
        cursor = null;
        pageToken = undefined;
        await this.db.query(
          "UPDATE calendar_sync_states SET cursor=NULL WHERE source_id=$1",
          [source.id],
        );
        await run(null);
      }
      await this.db.query(
        "UPDATE calendar_sync_states SET cursor=$2,status='idle',last_synced_at=now(),last_error=NULL,updated_at=now() WHERE source_id=$1",
        [source.id, nextSync || cursor],
      );
      await this.ensureWatch(source).catch(() => undefined);
    } catch (error) {
      await this.db
        .query(
          "INSERT INTO calendar_sync_states(source_id,status,last_error) VALUES($1,'error',$2) ON CONFLICT(source_id) DO UPDATE SET status='error',last_error=$2,updated_at=now()",
          [sourceId, (error as Error).message.slice(0, 1000)],
        )
        .catch(() => undefined);
      throw error;
    } finally {
      this.syncing.delete(sourceId);
    }
  }
  async listItems(
    ownerId: string,
    sourceIds: string[],
    start: Date,
    end: Date,
  ) {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT i.*,l.board_id,c.url_token AS card_url_token FROM calendar_items i JOIN calendar_sources s ON s.id=i.source_id LEFT JOIN cards c ON c.id=i.card_id LEFT JOIN lists l ON l.id=c.list_id WHERE i.owner_id=$1 AND i.source_id=ANY($2::uuid[]) AND i.start_at<$4 AND COALESCE(i.end_at,i.start_at)>=$3 ORDER BY i.start_at`,
      [ownerId, sourceIds, start, end],
    );
    return rows.map((row) => {
      const item = this.toItem(row);
      if (row.board_id)
        item.metadata = { ...item.metadata, boardId: row.board_id };
      return item;
    });
  }
  async getItem(ownerId: string, itemId: string) {
    const row = await this.db.one<Record<string, unknown>>(
      "SELECT i.*,s.connection_id,s.external_id AS calendar_external_id,s.owner_id,s.name,s.time_zone AS source_time_zone,s.color,s.selected,s.metadata AS source_metadata FROM calendar_items i JOIN calendar_sources s ON s.id=i.source_id WHERE i.id=$1 AND i.owner_id=$2 AND s.provider_id=$3",
      [itemId, ownerId, this.id],
    );
    if (!row) return fail("Evento não encontrado.", 404);
    const source: Source = {
      id: String(row.source_id), owner_id: ownerId,
      connection_id: String(row.connection_id),
      external_id: String(row.calendar_external_id), name: String(row.name),
      time_zone: row.source_time_zone as string | null,
      color: row.color as string | null, selected: Boolean(row.selected),
      metadata: (row.source_metadata || {}) as Record<string, unknown>,
    };
    const connection = await this.connection(source.connection_id, ownerId);
    const event = await this.request<GoogleEvent>(
      connection,
      `calendars/${encodeURIComponent(source.external_id)}/events/${encodeURIComponent(String(row.external_id))}`,
    );
    return (await this.persist(source, event))!;
  }
  private googleDate(date: string, allDay?: boolean, timeZone?: string | null) {
    if (allDay) return { date: new Date(date).toISOString().slice(0, 10) };
    return {
      dateTime: new Date(date).toISOString(),
      ...(timeZone ? { timeZone } : {}),
    };
  }
  async createItem(ownerId: string, sourceId: string, input: CalendarMutation) {
    const source = await this.db.one<Source>(
      "SELECT * FROM calendar_sources WHERE id=$1 AND owner_id=$2 AND provider_id=$3",
      [sourceId, ownerId, this.id],
    );
    if (!source) return fail("Calendário não encontrado.", 404);
    const connection = await this.connection(source.connection_id, ownerId),
      operationId = randomUUID();
    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description || "",
      start: this.googleDate(
        input.start,
        input.allDay,
        input.timeZone || source.time_zone,
      ),
      end: this.googleDate(
        input.end || input.start,
        input.allDay,
        input.timeZone || source.time_zone,
      ),
      location: input.location || undefined,
      attendees: input.attendees,
      recurrence: input.recurrence,
    };
    if (input.conference)
      body.conferenceData = {
        createRequest: {
          requestId: operationId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    const event = await this.request<GoogleEvent>(
      connection,
      `calendars/${encodeURIComponent(source.external_id)}/events?conferenceDataVersion=1&sendUpdates=all`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return (await this.persist(source, event, operationId))!;
  }
  async updateItem(
    ownerId: string,
    itemId: string,
    input: Partial<CalendarMutation>,
    operationId = randomUUID(),
  ) {
    const row = await this.db.one<Record<string, unknown>>(
      "SELECT i.*,s.connection_id,s.external_id AS calendar_external_id,s.owner_id,s.name,s.time_zone AS source_time_zone,s.color,s.selected,s.metadata AS source_metadata FROM calendar_items i JOIN calendar_sources s ON s.id=i.source_id WHERE i.id=$1 AND i.owner_id=$2 AND s.provider_id=$3",
      [itemId, ownerId, this.id],
    );
    if (!row) return fail("Evento não encontrado.", 404);
    const connection = await this.connection(
      String(row.connection_id),
      ownerId,
    );
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.summary = input.title;
    if (input.description !== undefined) body.description = input.description;
    if (input.location !== undefined) body.location = input.location;
    if (input.start !== undefined)
      body.start = this.googleDate(
        input.start,
        input.allDay ?? Boolean(row.all_day),
        input.timeZone || String(row.time_zone || row.source_time_zone || ""),
      );
    if (input.end !== undefined)
      body.end = this.googleDate(
        input.end || input.start!,
        input.allDay ?? Boolean(row.all_day),
        input.timeZone || String(row.time_zone || row.source_time_zone || ""),
      );
    if (input.attendees !== undefined) body.attendees = input.attendees;
    if (input.recurrence !== undefined) body.recurrence = input.recurrence;
    const event = await this.request<GoogleEvent>(
      connection,
      `calendars/${encodeURIComponent(String(row.calendar_external_id))}/events/${encodeURIComponent(String(row.external_id))}?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: "PATCH",
        headers: row.etag ? { "if-match": String(row.etag) } : {},
        body: JSON.stringify(body),
      },
    );
    return (await this.persist(
      {
        id: String(row.source_id),
        owner_id: ownerId,
        connection_id: String(row.connection_id),
        external_id: String(row.calendar_external_id),
        name: String(row.name),
        time_zone: row.source_time_zone as string | null,
        color: row.color as string | null,
        selected: Boolean(row.selected),
        metadata: row.source_metadata as Record<string, unknown>,
      },
      event,
      operationId,
    ))!;
  }
  async deleteItem(
    ownerId: string,
    itemId: string,
    operationId = randomUUID(),
  ) {
    const row = await this.db.one<Record<string, unknown>>(
      "SELECT i.*,s.connection_id,s.external_id AS calendar_external_id,s.owner_id,s.name,s.time_zone AS source_time_zone,s.color,s.selected,s.metadata AS source_metadata FROM calendar_items i JOIN calendar_sources s ON s.id=i.source_id WHERE i.id=$1 AND i.owner_id=$2 AND s.provider_id=$3",
      [itemId, ownerId, this.id],
    );
    if (!row) return fail("Evento não encontrado.", 404);
    const connection = await this.connection(
      String(row.connection_id),
      ownerId,
    );
    await this.request<void>(
      connection,
      `calendars/${encodeURIComponent(String(row.calendar_external_id))}/events/${encodeURIComponent(String(row.external_id))}?sendUpdates=all`,
      {
        method: "DELETE",
        headers: row.etag ? { "if-match": String(row.etag) } : {},
      },
    );
    const cancelled = await this.db.one<Record<string, unknown>>(
      "UPDATE calendar_items SET status='cancelled',operation_id=$2,updated_at=now() WHERE id=$1 RETURNING *",
      [itemId, operationId],
    );
    if (cancelled) await this.afterChange({
      id: String(row.source_id), owner_id: ownerId,
      connection_id: String(row.connection_id),
      external_id: String(row.calendar_external_id), name: String(row.name),
      time_zone: row.source_time_zone as string | null,
      color: row.color as string | null, selected: Boolean(row.selected),
      metadata: (row.source_metadata || {}) as Record<string, unknown>,
    }, cancelled, cancelled.card_id as string | null);
  }
  async getAvailability(
    ownerId: string,
    input: AvailabilityRequest,
  ): Promise<Availability[]> {
    const sources = await this.db.query<Source>(
      "SELECT * FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2 AND id=ANY($3::uuid[])",
      [ownerId, this.id, input.sourceIds],
    );
    const byConnection = new Map<string, Source[]>();
    for (const source of sources)
      byConnection.set(source.connection_id, [
        ...(byConnection.get(source.connection_id) || []),
        source,
      ]);
    const output: Availability[] = [];
    for (const [connectionId, items] of byConnection) {
      const connection = await this.connection(connectionId, ownerId);
      const data = await this.request<{
        calendars: Record<
          string,
          { busy?: Array<{ start: string; end: string }> }
        >;
      }>(connection, "freeBusy", {
        method: "POST",
        body: JSON.stringify({
          timeMin: input.start,
          timeMax: input.end,
          timeZone: input.timeZone,
          items: items.map((source) => ({ id: source.external_id })),
        }),
      });
      for (const source of items)
        output.push({
          sourceId: source.id,
          busy: data.calendars[source.external_id]?.busy || [],
        });
    }
    return output;
  }
  private async ensureWatch(source: Source) {
    const webhook = process.env.GOOGLE_CALENDAR_WEBHOOK_URL;
    if (!webhook || !/^https:\/\//.test(webhook)) return;
    const current = await this.db.one<{
      id: string;
      expires_at: Date;
      provider_channel_id: string;
      provider_resource_id: string | null;
    }>(
      "SELECT id,expires_at,provider_channel_id,provider_resource_id FROM calendar_watch_channels WHERE source_id=$1 AND status='active' ORDER BY expires_at DESC LIMIT 1",
      [source.id],
    );
    if (
      current &&
      new Date(current.expires_at).getTime() > Date.now() + 24 * 3600000
    )
      return;
    const connection = await this.connection(source.connection_id),
      channelId = randomUUID(),
      secret = randomBytes(32).toString("base64url"),
      expiration = Date.now() + 6 * 86400000;
    const response = await this.request<{
      resourceId?: string;
      expiration?: string;
    }>(
      connection,
      `calendars/${encodeURIComponent(source.external_id)}/events/watch`,
      {
        method: "POST",
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: webhook,
          token: secret,
          expiration,
        }),
      },
    );
    if (current?.provider_resource_id)
      await this.request<void>(connection, "channels/stop", {
        method: "POST",
        body: JSON.stringify({
          id: current.provider_channel_id,
          resourceId: current.provider_resource_id,
        }),
      }).catch(() => undefined);
    await this.db.query(
      "UPDATE calendar_watch_channels SET status='replaced',updated_at=now() WHERE source_id=$1 AND status='active'",
      [source.id],
    );
    await this.db.query(
      "INSERT INTO calendar_watch_channels(source_id,provider_channel_id,provider_resource_id,secret_encrypted,expires_at) VALUES($1,$2,$3,$4,$5)",
      [
        source.id,
        channelId,
        response.resourceId || null,
        this.vault.seal({ secret }),
        new Date(Number(response.expiration || expiration)),
      ],
    );
  }
  async notification(channelId: string, token: string | undefined) {
    const channel = await this.db.one<{
      source_id: string;
      secret_encrypted: string;
      status: string;
    }>("SELECT * FROM calendar_watch_channels WHERE provider_channel_id=$1", [
      channelId,
    ]);
    if (!channel || channel.status !== "active" || !token) return false;
    const expected = this.vault.open<{ secret: string }>(
      channel.secret_encrypted,
    ).secret;
    const a = Buffer.from(token),
      b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    setImmediate(
      () => void this.syncSource(channel.source_id).catch(() => undefined),
    );
    return true;
  }
  async sourceSelectionChanged(sourceId: string, selected: boolean) {
    if (selected) return;
    const source = await this.db.one<Source>(
      "SELECT * FROM calendar_sources WHERE id=$1 AND provider_id=$2",
      [sourceId, this.id],
    );
    if (!source) return;
    const connection = await this.connection(source.connection_id);
    const channels = await this.db.query<{
      provider_channel_id: string;
      provider_resource_id: string | null;
    }>(
      "SELECT provider_channel_id,provider_resource_id FROM calendar_watch_channels WHERE source_id=$1 AND status='active'",
      [sourceId],
    );
    for (const channel of channels)
      if (channel.provider_resource_id)
        await this.request<void>(connection, "channels/stop", {
          method: "POST",
          body: JSON.stringify({
            id: channel.provider_channel_id,
            resourceId: channel.provider_resource_id,
          }),
        }).catch(() => undefined);
    await this.db.query(
      "UPDATE calendar_watch_channels SET status='stopped',updated_at=now() WHERE source_id=$1 AND status='active'",
      [sourceId],
    );
  }
  private async maintenance() {
    const sources = await this.db.query<Source>(
      `SELECT s.* FROM calendar_sources s LEFT JOIN calendar_watch_channels w ON w.source_id=s.id AND w.status='active' AND w.expires_at>now()+interval '24 hours' WHERE s.provider_id=$1 AND s.selected AND w.id IS NULL`,
      [this.id],
    );
    for (const source of sources)
      await this.ensureWatch(source).catch(() => undefined);
    const connections = await this.db.query<Connection>(
      "SELECT * FROM integration_connections WHERE plugin_id=ANY($1::text[]) AND enabled AND COALESCE((metadata->>'lastDiscoveryAt')::timestamptz,'epoch')<now()-interval '6 hours'",
      [[this.id,'google']],
    );
    const sharedByOwner=new Map<string,Set<string>>();
    for (const connection of connections) {
      if(connection.plugin_id==='google'){
        if(!sharedByOwner.has(connection.owner_id))sharedByOwner.set(connection.owner_id,new Set((await (this.google??new GoogleCredentials(this.db,this.vault)).available(connection.owner_id,GOOGLE_CALENDAR_SCOPES)).map(row=>row.id)));
        if(!sharedByOwner.get(connection.owner_id)?.has(connection.id))continue;
      }
      await this.discover(connection.owner_id, connection.id).catch(
        () => undefined,
      );
    }

  }
}

export const googleCalendarPluginDefinition = (
  plugin: GoogleCalendarPlugin,
): PluginDefinition => ({
  id: plugin.id,
  name: plugin.name,
  version: "1.0.0",
  scope: "account",
  configuration:[
    {key:'GOOGLE_CALENDAR_REDIRECT_URI',label:'URL de retorno OAuth do Calendar',secret:false},
    {key:'GOOGLE_CALENDAR_WEBHOOK_URL',label:'URL pública do webhook',secret:false},
  ],
  capabilities: [
    { id: "calendar.events.read", name: "Ler eventos" },
    { id: "calendar.events.write", name: "Alterar eventos" },
    { id: "calendar.availability.read", name: "Consultar disponibilidade" },
  ],
  actions: plugin.contributions.pluginActions.map((action) => ({
    id: action.id,
    name: action.label,
    requiredCapabilities: [
      action.id.endsWith(".create_event") || action.id.endsWith(".update_event") || action.id.endsWith(".delete_event")
        ? "calendar.events.write"
        : action.id.endsWith(".list_calendars") || action.id.endsWith(".list_events") || action.id.endsWith(".get_event") || action.id.endsWith(".get_availability")
          ? action.id.endsWith(".get_availability") ? "calendar.availability.read" : "calendar.events.read"
          : "calendar.events.read",
    ],
    permissions: [
      action.id.endsWith(".create_event") || action.id.endsWith(".update_event") || action.id.endsWith(".delete_event")
        ? "calendar.events.write"
        : action.id.endsWith(".get_availability") ? "calendar.availability.read" : "calendar.events.read",
    ],
    inputSchema: action.inputSchema,
    outputSchema: {
      type: "object", required: ["type", "label", "value"],
      properties: { type: { const: "calendar" }, label: { type: "string" }, value: {} },
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>, context: PluginActionContext) {
      if (!context.userId) throw new Error("Usuário ausente.");
      const itemId = String(input.itemId || "");
      let value: unknown;
      switch (action.id) {
        case "google_calendar.list_calendars":
          value = await plugin.listSources(context.userId, input.connectionId as string | undefined);
          break;
        case "google_calendar.list_events":
          value = await plugin.listItems(context.userId, [String(input.sourceId)], new Date(String(input.start)), new Date(String(input.end)));
          break;
        case "google_calendar.get_event":
          value = await plugin.getItem(context.userId, itemId);
          break;
        case "google_calendar.create_event":
          value = await plugin.createItem(context.userId, String(input.sourceId), input as unknown as CalendarMutation);
          break;
        case "google_calendar.update_event":
          value = await plugin.updateItem(context.userId, itemId, input as Partial<CalendarMutation>);
          break;
        case "google_calendar.delete_event":
          await plugin.deleteItem(context.userId, itemId);
          value = { deleted: true };
          break;
        case "google_calendar.get_availability":
          value = await plugin.getAvailability(context.userId, {
            sourceIds: input.sourceIds as string[], start: String(input.start),
            end: String(input.end), timeZone: input.timeZone as string | undefined,
          });
          break;
        default:
          throw new Error(`Action Google desconhecida: ${action.id}`);
      }
      return { type: "calendar", label: action.label, value };
    },
  })),
    connectionProvider: {
    id: "google-oauth",
    name: "Google OAuth",
    supportsMultiple: true,
    capabilities: [
      "calendar.events.read",
      "calendar.events.write",
      "calendar.availability.read",
    ],
  },
  contributions: {
    navigation: [{ id: "calendar", label: "Calendar", href: "/calendar" }],
    calendarSources: plugin.contributions.calendarSources,
        settings: plugin.contributions.settingsPanels,
  },
});

@Controller("calendar/google")
export class GoogleCalendarController {
  constructor(
    @Inject(GoogleCalendarPlugin) private google: GoogleCalendarPlugin,
    @Inject(FeaturesService) private features: FeaturesService,
  ) {}
  @Get("status") status(@Req() req: Request) {
    const owner = this.features.user(req);
    return Promise.all([
      this.google.connections(owner),
      Promise.resolve(this.google.configured()),
    ]).then(([connections, configured]) => ({ configured, connections }));
  }
  @Get("oauth/start") start(@Req() req: Request) {
    return this.google.oauthUrl(this.features.user(req));
  }
  @Get("oauth/callback") async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() response: Response,
  ) {
    try {
      await this.google.oauthCallback(code, state);
      response.redirect(
        `${process.env.WEB_ORIGIN || "http://localhost:3000"}/calendar?connected=google_calendar`,
      );
    } catch (error) {
      const message =
        error instanceof HttpException
          ? String(
              (error.getResponse() as { message?: string }).message ||
                error.message,
            )
          : "Falha na conexão Google.";
      response.redirect(
        `${process.env.WEB_ORIGIN || "http://localhost:3000"}/calendar?error=${encodeURIComponent(message)}`,
      );
    }
  }
  @Post("connections/:id/discover") discover(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.google.discover(this.features.user(req), id);
  }
  @Post("sources/:id/sync") async sync(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const owner = this.features.user(req);
    const source = (await this.google.listSources(owner)).find(
      (item) => item.id === id,
    );
    if (!source) fail("Calendário não encontrado.", 404);
    await this.google.syncSource(id);
    return { ok: true };
  }
  @Post("webhook") async webhook(
    @Headers("x-goog-channel-id") channel: string,
    @Headers("x-goog-channel-token") token: string | undefined,
    @Res() response: Response,
  ) {
    if (!channel || !(await this.google.notification(channel, token)))
      return response.status(404).end();
    return response.status(204).end();
  }
}
