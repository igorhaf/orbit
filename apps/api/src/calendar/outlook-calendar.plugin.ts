import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Db } from "../db";
import { FeaturesService } from "../features";
import { PluginActionContext, PluginDefinition } from "../plugins/contract";
import {
  Availability,
  AvailabilityRequest,
  CalendarItem,
  CalendarMutation,
  CalendarSource,
  CalendarSourceProvider,
} from "./types";
import {
  MicrosoftConnection,
  MicrosoftGraphClient,
  MicrosoftGraphError,
} from "./microsoft-graph";
import { MicrosoftGraphSubscriptionManager } from "./microsoft-subscriptions";
import {
  graphDateTime,
  graphLocalToDate,
  microsoftTimeZone,
  orbitTimeZone,
} from "./microsoft-timezones";

type GraphCalendar = {
  id: string;
  name?: string;
  color?: string;
  hexColor?: string;
  canEdit?: boolean;
  canShare?: boolean;
  canViewPrivateItems?: boolean;
  isDefaultCalendar?: boolean;
  isRemovable?: boolean;
  owner?: { name?: string; address?: string };
  changeKey?: string;
};
type GraphEvent = {
  id: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  bodyPreview?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  locations?: unknown[];
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
    status?: unknown;
    type?: string;
  }>;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  recurrence?: unknown;
  seriesMasterId?: string;
  type?: string;
  webLink?: string;
  changeKey?: string;
  lastModifiedDateTime?: string;
  showAs?: string;
  sensitivity?: string;
  categories?: string[];
  responseStatus?: unknown;
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string;
  onlineMeeting?: { joinUrl?: string; conferenceId?: string; tollNumber?: string };
  onlineMeetingUrl?: string;
  transactionId?: string;
  "@odata.etag"?: string;
  "@removed"?: { reason?: string };
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
type GraphPage<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

const bad = (message: string, status = 400): never => {
  throw new HttpException({ message }, status);
};
const outlookColors: Record<string, string> = {
  lightBlue: "#3b82f6",
  lightGreen: "#22c55e",
  lightOrange: "#f97316",
  lightGray: "#64748b",
  lightYellow: "#eab308",
  lightTeal: "#14b8a6",
  lightPink: "#ec4899",
  lightBrown: "#92400e",
  lightRed: "#ef4444",
  maxColor: "#6366f1",
  auto: "#6366f1",
};

@Injectable()
export class OutlookCalendarPlugin
  implements CalendarSourceProvider, OnModuleInit, OnModuleDestroy
{
  readonly id = "outlook_calendar";
  readonly name = "Outlook Calendar";
  readonly connectOptions = [
    { id: "calendar", label: "Conectar calendário Microsoft" },
    { id: "teams", label: "Ativar reuniões Teams" },
    { id: "mail", label: "Ativar Outlook Mail" },
  ];
  private syncing = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(Db) private db: Db,
    @Inject(MicrosoftGraphClient) private graph: MicrosoftGraphClient,
    @Inject(MicrosoftGraphSubscriptionManager)
    private subscriptions: MicrosoftGraphSubscriptionManager,
  ) {}

  onModuleInit() {
    if (process.env.ORBIT_ENV === 'development' && process.env.ORBIT_ALLOW_EXTERNAL_AUTOMATION !== 'true') return;
    this.timer = setInterval(() => void this.maintenance(), 15 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  getConnectUrl(ownerId: string, option?: string) {
    return this.graph.oauthUrl(
      ownerId,
      option === "teams" ? "teams" : option === "mail" ? "mail" : "calendar",
    );
  }
  connections(ownerId: string) {
    return this.graph.connections(ownerId);
  }

  async discover(ownerId: string, connectionId: string) {
    const connection = await this.graph.connection(connectionId, ownerId);
    let next: string | undefined = "me/calendars?$top=100";
    const calendars: GraphCalendar[] = [];
    while (next) {
      const page: GraphPage<GraphCalendar> = await this.graph.request<GraphPage<GraphCalendar>>(
        connection,
        next,
      );
      calendars.push(...(page.value || []));
      next = page["@odata.nextLink"];
    }
    const seen: string[] = [];
    for (const calendar of calendars) {
      if (!calendar.id) continue;
      seen.push(calendar.id);
      const existing = await this.db.one<{ selected: boolean }>(
        "SELECT selected FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2 AND connection_id=$3 AND external_id=$4",
        [ownerId, this.id, connectionId, calendar.id],
      );
      await this.db.query(
        `INSERT INTO calendar_sources(owner_id,provider_id,connection_id,external_id,name,color,access_role,is_primary,selected,capabilities,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(owner_id,provider_id,connection_id,external_id) DO UPDATE SET name=excluded.name,color=excluded.color,access_role=excluded.access_role,is_primary=excluded.is_primary,capabilities=excluded.capabilities,metadata=excluded.metadata,visible=true,updated_at=now()`,
        [
          ownerId,
          this.id,
          connectionId,
          calendar.id,
          calendar.name || "Calendário",
          calendar.hexColor || outlookColors[calendar.color || "auto"],
          calendar.canEdit ? "writer" : "reader",
          Boolean(calendar.isDefaultCalendar),
          existing?.selected ?? Boolean(calendar.isDefaultCalendar),
          JSON.stringify({
            read: true,
            write: Boolean(calendar.canEdit),
            share: Boolean(calendar.canShare),
            viewPrivate: Boolean(calendar.canViewPrivateItems),
          }),
          JSON.stringify({
            owner: calendar.owner,
            outlookColor: calendar.color,
            removable: calendar.isRemovable,
            changeKey: calendar.changeKey,
          }),
        ],
      );
    }
    await this.db.query(
      "UPDATE calendar_sources SET visible=false,selected=false,updated_at=now() WHERE owner_id=$1 AND provider_id=$2 AND connection_id=$3 AND NOT(external_id=ANY($4::text[]))",
      [ownerId, this.id, connectionId, seen],
    );
    await this.db.query(
      "UPDATE integration_connections SET metadata=metadata||$2::jsonb,updated_at=now() WHERE id=$1",
      [connectionId, JSON.stringify({ lastDiscoveryAt: new Date().toISOString() })],
    );
    return this.listSources(ownerId, connectionId);
  }

  async listSources(ownerId: string, connectionId?: string) {
    const connections = connectionId
      ? await this.db.query<MicrosoftConnection>(
          "SELECT * FROM integration_connections WHERE id=$1 AND owner_id=$2 AND plugin_id='microsoft' AND enabled",
          [connectionId, ownerId],
        )
      : await this.db.query<MicrosoftConnection>(
          "SELECT * FROM integration_connections WHERE owner_id=$1 AND plugin_id='microsoft' AND enabled",
          [ownerId],
        );
    for (const connection of connections) {
      const last = Date.parse(String(connection.metadata?.lastDiscoveryAt || ""));
      if (!Number.isFinite(last) || last < Date.now() - 6 * 3600_000)
        await this.discover(ownerId, connection.id).catch(() => undefined);
    }
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2${connectionId ? " AND connection_id=$3" : ""} ORDER BY is_primary DESC,name`,
      connectionId ? [ownerId, this.id, connectionId] : [ownerId, this.id],
    );
    return rows.map((row) => this.toSource(row));
  }

  private toSource(row: Record<string, unknown>): CalendarSource {
    return {
      id: String(row.id),
      providerId: this.id,
      connectionId: String(row.connection_id),
      externalId: String(row.external_id),
      name: String(row.name),
      timeZone: row.time_zone as string | null,
      color: row.color as string | null,
      accessRole: row.access_role as string | null,
      primary: Boolean(row.is_primary),
      selected: Boolean(row.selected),
      visible: Boolean(row.visible),
      isDefault: Boolean(row.is_default),
      capabilities: (row.capabilities || {}) as Record<string, boolean>,
      metadata: (row.metadata || {}) as Record<string, unknown>,
    };
  }

  private conference(event: GraphEvent) {
    const joinUrl = event.onlineMeeting?.joinUrl || event.onlineMeetingUrl;
    return event.isOnlineMeeting || joinUrl
      ? {
          provider: "microsoft_teams",
          joinUrl,
          conferenceId: event.onlineMeeting?.conferenceId,
          tollNumber: event.onlineMeeting?.tollNumber,
        }
      : null;
  }
  private dates(event: GraphEvent, source: Source) {
    if (!event.start?.dateTime) return null;
    const allDay = Boolean(event.isAllDay);
    const zone = orbitTimeZone(event.start.timeZone || source.time_zone);
    return {
      start: graphLocalToDate(event.start.dateTime, event.start.timeZone, allDay),
      end: event.end?.dateTime
        ? graphLocalToDate(event.end.dateTime, event.end.timeZone, allDay)
        : graphLocalToDate(event.start.dateTime, event.start.timeZone, allDay),
      allDay,
      zone,
    };
  }
  private async persist(source: Source, event: GraphEvent, operationId?: string) {
    const removed = Boolean(event["@removed"] || event.isCancelled);
    const dates = this.dates(event, source);
    if (removed && !dates) {
      const row = await this.db.one<Record<string, unknown>>(
        "UPDATE calendar_items SET status='cancelled',etag=$3,provider_updated_at=now(),updated_at=now() WHERE source_id=$1 AND external_id=$2 RETURNING *",
        [source.id, event.id, event["@odata.etag"] || event.changeKey || null],
      );
      if (row && !operationId)
        await this.afterChange(source, row);
      return row ? this.toItem(row) : null;
    }
    if (!dates) return null;
    const etag = event["@odata.etag"] || event.changeKey || null;
    const external = await this.db.one<{ id: string }>(
      `INSERT INTO external_resources(owner_id,plugin_id,connection_id,resource_type,external_id,external_parent_id,url,etag,metadata)
       VALUES($1,$2,$3,'calendar_event',$4,$5,$6,$7,$8)
       ON CONFLICT(owner_id,plugin_id,connection_id,resource_type,external_id) DO UPDATE SET external_parent_id=excluded.external_parent_id,url=excluded.url,etag=excluded.etag,metadata=excluded.metadata,updated_at=now() RETURNING id`,
      [
        source.owner_id,
        this.id,
        source.connection_id,
        event.id,
        event.seriesMasterId || null,
        event.webLink || null,
        etag,
        JSON.stringify({
          eventType: event.type || "singleInstance",
          categories: event.categories || [],
          sensitivity: event.sensitivity,
        }),
      ],
    );
    const old = await this.db.one<{ etag: string | null }>(
      "SELECT etag FROM calendar_items WHERE source_id=$1 AND external_id=$2",
      [source.id, event.id],
    );
    const recurrence = event.recurrence ? [event.recurrence] : [];
    const attendees = (event.attendees || []).map((attendee) => ({
      email: attendee.emailAddress?.address,
      displayName: attendee.emailAddress?.name,
      type: attendee.type,
      status: attendee.status,
    }));
    const row = await this.db.one<Record<string, unknown>>(
      `INSERT INTO calendar_items(owner_id,source_id,resource_type,external_resource_id,external_id,title,description,start_at,end_at,all_day,time_zone,location,recurrence,attendees,conference,status,external_url,etag,series_external_id,provider_updated_at,operation_id,metadata)
       VALUES($1,$2,'event',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT(source_id,external_id) DO UPDATE SET title=excluded.title,description=excluded.description,start_at=excluded.start_at,end_at=excluded.end_at,all_day=excluded.all_day,time_zone=excluded.time_zone,location=excluded.location,recurrence=excluded.recurrence,attendees=excluded.attendees,conference=excluded.conference,status=excluded.status,external_url=excluded.external_url,etag=excluded.etag,series_external_id=excluded.series_external_id,provider_updated_at=excluded.provider_updated_at,operation_id=excluded.operation_id,metadata=excluded.metadata,updated_at=now() RETURNING *`,
      [
        source.owner_id,
        source.id,
        external!.id,
        event.id,
        event.subject || "(Sem título)",
        event.body?.content || event.bodyPreview || "",
        dates.start,
        dates.end,
        dates.allDay,
        dates.zone,
        event.location?.displayName || null,
        JSON.stringify(recurrence),
        JSON.stringify(attendees),
        this.conference(event)
          ? JSON.stringify(this.conference(event))
          : null,
        removed ? "cancelled" : "confirmed",
        event.webLink || null,
        etag,
        event.seriesMasterId || null,
        event.lastModifiedDateTime
          ? new Date(event.lastModifiedDateTime)
          : null,
        operationId || null,
        JSON.stringify({
          eventType: event.type,
          organizer: event.organizer,
          responseStatus: event.responseStatus,
          categories: event.categories || [],
          sensitivity: event.sensitivity,
          showAs: event.showAs,
          locations: event.locations || [],
          transactionId: event.transactionId,
        }),
      ],
    );
    if (!old || old.etag !== etag)
      await this.afterChange(
        source,
        row!,
      );
    return this.toItem(row!);
  }

  private async afterChange(
    source: Source,
    item: Record<string, unknown>,
  ) {
    const settings = await this.db.one<Record<string, unknown>>(
      "SELECT * FROM calendar_source_settings WHERE source_id=$1",
      [source.id],
    );
    let cardId = item.card_id ? String(item.card_id) : null;
    if (!cardId && settings?.auto_create_cards && settings.target_list_id) {
      if (settings.recurring_strategy === "series" && item.series_external_id)
        cardId =
          (
            await this.db.one<{ orbit_entity_id: string }>(
              "SELECT orbit_entity_id FROM external_resources WHERE owner_id=$1 AND plugin_id=$2 AND external_parent_id=$3 AND orbit_entity_type='card' LIMIT 1",
              [source.owner_id, this.id, item.series_external_id],
            )
          )?.orbit_entity_id || null;
      if (!cardId) {
        cardId = (
          await this.db.one<{ id: string }>(
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
          )
        )!.id;
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
      const fields = (settings.field_mapping || {}) as Record<string, boolean>;
      await this.db.query(
        `UPDATE cards SET title=CASE WHEN $2 THEN $3 ELSE title END,description=CASE WHEN $4 THEN $5 ELSE description END,schedule_start_at=$6,schedule_end_at=$7,schedule_all_day=$8,schedule_time_zone=$9,archived_at=CASE WHEN $10 AND $11 THEN now() ELSE archived_at END,updated_at=now() WHERE id=$1 AND (($2 AND title IS DISTINCT FROM $3) OR ($4 AND description IS DISTINCT FROM $5) OR schedule_start_at IS DISTINCT FROM $6 OR schedule_end_at IS DISTINCT FROM $7 OR schedule_all_day IS DISTINCT FROM $8 OR schedule_time_zone IS DISTINCT FROM $9 OR ($10 AND $11 AND archived_at IS NULL))`,
        [
          cardId,
          fields.title !== false,
          item.title,
          fields.description !== false,
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
      const connection = await this.graph.connection(
        source.connection_id,
        source.owner_id,
      );
      const state = await this.db.one<{
        cursor: string | null;
        window_start: Date | null;
        window_end: Date | null;
      }>("SELECT * FROM calendar_sync_states WHERE source_id=$1", [sourceId]);
      const start = state?.window_start || new Date(Date.now() - 366 * 86400000);
      const end = state?.window_end || new Date(Date.now() + 730 * 86400000);
      await this.db.query(
        `INSERT INTO calendar_sync_states(source_id,status,window_start,window_end) VALUES($1,'syncing',$2,$3)
         ON CONFLICT(source_id) DO UPDATE SET status='syncing',last_error=NULL,window_start=COALESCE(calendar_sync_states.window_start,$2),window_end=COALESCE(calendar_sync_states.window_end,$3),updated_at=now()`,
        [sourceId, start, end],
      );
      const initial = `me/calendars/${encodeURIComponent(source.external_id)}/calendarView/delta?startDateTime=${encodeURIComponent(start.toISOString())}&endDateTime=${encodeURIComponent(end.toISOString())}`;
      const run = async (cursor?: string | null) => {
        let next: string | undefined = cursor || initial;
        let delta: string | undefined;
        const seen = new Set<string>();
        while (next) {
          const page: GraphPage<GraphEvent> = await this.graph.request<GraphPage<GraphEvent>>(
            connection,
            next,
            { headers: { Prefer: 'outlook.body-content-type="text"' } },
          );
          for (const event of page.value || []) {
            if (!cursor && event.id && !event["@removed"]) seen.add(event.id);
            await this.persist(source, event);
          }
          next = page["@odata.nextLink"];
          delta = page["@odata.deltaLink"] || delta;
        }
        if (!cursor) {
          const stale = await this.db.query<Record<string, unknown>>(
            `UPDATE calendar_items SET status='cancelled',provider_updated_at=now(),updated_at=now()
             WHERE source_id=$1 AND start_at<$3 AND COALESCE(end_at,start_at)>=$2 AND status<>'cancelled'
             AND NOT(external_id=ANY($4::text[])) RETURNING *`,
            [source.id, start, end, [...seen]],
          );
          for (const item of stale)
            await this.afterChange(source, item);
        }
        return delta;
      };
      let delta: string | undefined;
      try {
        delta = await run(state?.cursor);
      } catch (error) {
        if (!(error instanceof MicrosoftGraphError) || error.status !== 410)
          throw error;
        await this.db.query(
          "UPDATE calendar_sync_states SET cursor=NULL WHERE source_id=$1",
          [sourceId],
        );
        delta = await run(null);
      }
      await this.db.query(
        "UPDATE calendar_sync_states SET cursor=$2,status='idle',last_synced_at=now(),last_error=NULL,updated_at=now() WHERE source_id=$1",
        [sourceId, delta || state?.cursor || null],
      );
      await this.subscriptions.ensureCalendar(source).catch(() => undefined);
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
      `SELECT i.*,l.board_id,c.url_token AS card_url_token FROM calendar_items i JOIN calendar_sources s ON s.id=i.source_id LEFT JOIN cards c ON c.id=i.card_id LEFT JOIN lists l ON l.id=c.list_id
       WHERE i.owner_id=$1 AND s.provider_id=$2 AND i.source_id=ANY($3::uuid[]) AND i.start_at<$5 AND COALESCE(i.end_at,i.start_at)>=$4 ORDER BY i.start_at`,
      [ownerId, this.id, sourceIds, start, end],
    );
    return rows.map((row) => {
      const item = this.toItem(row);
      if (row.board_id)
        item.metadata = { ...item.metadata, boardId: row.board_id };
      return item;
    });
  }

  private mutation(input: CalendarMutation | Partial<CalendarMutation>, source: Source) {
    const allDay = input.allDay;
    const zone = input.timeZone || source.time_zone || "UTC";
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.subject = input.title;
    if (input.description !== undefined)
      body.body = { contentType: "text", content: input.description || "" };
    if (input.start !== undefined)
      body.start = allDay
        ? { dateTime: `${input.start.slice(0, 10)}T00:00:00`, timeZone: "UTC" }
        : graphDateTime(input.start, zone);
    if (input.end !== undefined && input.end !== null)
      body.end = allDay
        ? { dateTime: `${input.end.slice(0, 10)}T00:00:00`, timeZone: "UTC" }
        : graphDateTime(input.end, zone);
    if (allDay !== undefined) body.isAllDay = allDay;
    if (input.location !== undefined)
      body.location = { displayName: input.location || "" };
    if (input.attendees !== undefined)
      body.attendees = input.attendees.map((item) => ({
        emailAddress: { address: item.email, name: item.displayName },
        type: "required",
      }));
    if (input.recurrence?.length)
      body.recurrence = input.recurrence[0];
    if (input.conference) {
      body.isOnlineMeeting = true;
      body.onlineMeetingProvider = "teamsForBusiness";
    }
    return body;
  }
  async createItem(ownerId: string, sourceId: string, input: CalendarMutation) {
    const source = await this.db.one<Source>(
      "SELECT * FROM calendar_sources WHERE id=$1 AND owner_id=$2 AND provider_id=$3",
      [sourceId, ownerId, this.id],
    );
    if (!source) return bad("Calendário não encontrado.", 404);
    const connection = await this.graph.connection(source.connection_id, ownerId);
    const operationId = randomUUID();
    const event = await this.graph.request<GraphEvent>(
      connection,
      `me/calendars/${encodeURIComponent(source.external_id)}/events`,
      {
        method: "POST",
        headers: { Prefer: 'outlook.body-content-type="text"' },
        body: JSON.stringify({
          ...this.mutation(input, source),
          transactionId: operationId,
        }),
      },
    );
    return (await this.persist(source, event, operationId))!;
  }
  async getItem(ownerId: string, itemId: string) {
    const row = await this.db.one<Record<string, unknown>>(
      "SELECT i.*,s.connection_id,s.external_id AS calendar_external_id,s.owner_id,s.name,s.time_zone AS source_time_zone,s.color,s.selected,s.metadata AS source_metadata FROM calendar_items i JOIN calendar_sources s ON s.id=i.source_id WHERE i.id=$1 AND i.owner_id=$2 AND s.provider_id=$3",
      [itemId, ownerId, this.id],
    );
    if (!row) return bad("Evento não encontrado.", 404);
    const source: Source = {
      id: String(row.source_id),
      owner_id: ownerId,
      connection_id: String(row.connection_id),
      external_id: String(row.calendar_external_id),
      name: String(row.name),
      time_zone: row.source_time_zone as string | null,
      color: row.color as string | null,
      selected: Boolean(row.selected),
      metadata: row.source_metadata as Record<string, unknown>,
    };
    const connection = await this.graph.connection(source.connection_id, ownerId);
    const event = await this.graph.request<GraphEvent>(
      connection,
      `me/calendars/${encodeURIComponent(source.external_id)}/events/${encodeURIComponent(String(row.external_id))}`,
      { headers: { Prefer: 'outlook.body-content-type="text"' } },
    );
    return this.persist(source, event, randomUUID());
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
    if (!row) return bad("Evento não encontrado.", 404);
    const connection = await this.graph.connection(
      String(row.connection_id),
      ownerId,
    );
    const source: Source = {
      id: String(row.source_id),
      owner_id: ownerId,
      connection_id: String(row.connection_id),
      external_id: String(row.calendar_external_id),
      name: String(row.name),
      time_zone: row.source_time_zone as string | null,
      color: row.color as string | null,
      selected: Boolean(row.selected),
      metadata: row.source_metadata as Record<string, unknown>,
    };
    const event = await this.graph.request<GraphEvent>(
      connection,
      `me/calendars/${encodeURIComponent(source.external_id)}/events/${encodeURIComponent(String(row.external_id))}`,
      {
        method: "PATCH",
        headers: {
          ...(row.etag ? { "If-Match": String(row.etag) } : {}),
          Prefer: 'outlook.body-content-type="text"',
        },
        body: JSON.stringify(
          this.mutation(
            {
              ...input,
              allDay: input.allDay ?? Boolean(row.all_day),
              timeZone:
                input.timeZone ||
                String(row.time_zone || row.source_time_zone || "UTC"),
            },
            source,
          ),
        ),
      },
    );
    return (await this.persist(source, event, operationId))!;
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
    if (!row) return bad("Evento não encontrado.", 404);
    const connection = await this.graph.connection(
      String(row.connection_id),
      ownerId,
    );
    await this.graph.request<void>(
      connection,
      `me/calendars/${encodeURIComponent(String(row.calendar_external_id))}/events/${encodeURIComponent(String(row.external_id))}`,
      {
        method: "DELETE",
        headers: row.etag ? { "If-Match": String(row.etag) } : {},
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
    }, cancelled);
  }

  async getAvailability(
    ownerId: string,
    input: AvailabilityRequest,
  ): Promise<Availability[]> {
    const sources = await this.db.query<Source>(
      "SELECT * FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2 AND id=ANY($3::uuid[])",
      [ownerId, this.id, input.sourceIds],
    );
    const grouped = new Map<string, Source[]>();
    for (const source of sources)
      grouped.set(source.connection_id, [
        ...(grouped.get(source.connection_id) || []),
        source,
      ]);
    const result: Availability[] = [];
    for (const [connectionId, group] of grouped) {
      const connection = await this.graph.connection(connectionId, ownerId);
      const addresses = [
        ...new Set(
          group.map((source) => {
            const calendarOwner = source.metadata.owner as
              | { address?: string }
              | undefined;
            return calendarOwner?.address || String(connection.metadata.email || "");
          }),
        ),
      ].filter(Boolean);
      const response = await this.graph.request<{
        value?: Array<{
          scheduleId?: string;
          scheduleItems?: Array<{
            start?: { dateTime?: string; timeZone?: string };
            end?: { dateTime?: string; timeZone?: string };
          }>;
        }>;
      }>(connection, "me/calendar/getSchedule", {
        method: "POST",
        headers: {
          Prefer: `outlook.timezone="${microsoftTimeZone(input.timeZone || "UTC")}"`,
        },
        body: JSON.stringify({
          schedules: addresses,
          startTime: graphDateTime(input.start, input.timeZone),
          endTime: graphDateTime(input.end, input.timeZone),
          availabilityViewInterval: 30,
        }),
      });
      for (const source of group) {
        const owner = source.metadata.owner as { address?: string } | undefined;
        const address = owner?.address || String(connection.metadata.email || "");
        const schedule = response.value?.find(
          (item) => item.scheduleId?.toLowerCase() === address.toLowerCase(),
        );
        result.push({
          sourceId: source.id,
          busy: (schedule?.scheduleItems || [])
            .filter((item) => item.start?.dateTime && item.end?.dateTime)
            .map((item) => ({
              start: graphLocalToDate(
                item.start!.dateTime!,
                item.start!.timeZone,
              ).toISOString(),
              end: graphLocalToDate(
                item.end!.dateTime!,
                item.end!.timeZone,
              ).toISOString(),
            })),
        });
      }
    }
    return result;
  }

  async sourceSelectionChanged(sourceId: string, selected: boolean) {
    if (selected) {
      const source = await this.db.one<Source>(
        "SELECT * FROM calendar_sources WHERE id=$1 AND provider_id=$2",
        [sourceId, this.id],
      );
      if (source) await this.subscriptions.ensureCalendar(source);
    } else await this.subscriptions.removeForSource(sourceId);
  }
  async notification(body: { value?: unknown[] }) {
    const sources = await this.subscriptions.accept(
      body as Parameters<MicrosoftGraphSubscriptionManager["accept"]>[0],
    );
    for (const source of sources) void this.syncSource(source);
    return { ok: true };
  }
  async disconnect(ownerId: string, connectionId: string) {
    const sources = await this.db.query<{ id: string }>(
      "SELECT id FROM calendar_sources WHERE owner_id=$1 AND connection_id=$2 AND provider_id=$3",
      [ownerId, connectionId, this.id],
    );
    for (const source of sources)
      await this.subscriptions.removeForSource(source.id).catch(() => undefined);
    await this.graph.disconnect(connectionId, ownerId);
    await this.db.query(
      "UPDATE calendar_sources SET selected=false,visible=false,updated_at=now() WHERE owner_id=$1 AND connection_id=$2 AND provider_id=$3",
      [ownerId, connectionId, this.id],
    );
    return { ok: true };
  }
  private async maintenance() {
    await this.subscriptions.renewDue();
    const connections = await this.db.query<{ owner_id: string; id: string }>(
      "SELECT owner_id,id FROM integration_connections WHERE plugin_id='microsoft' AND enabled AND COALESCE((metadata->>'lastDiscoveryAt')::timestamptz,'epoch')<now()-interval '6 hours'",
    );
    for (const connection of connections)
      await this.discover(connection.owner_id, connection.id).catch(() => undefined);

  }
}

const actionSchema = {
  list: { type: "object", properties: { connectionId: { type: "string" } } },
  events: {
    type: "object",
    required: ["sourceId", "start", "end"],
    properties: {
      sourceId: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
    },
  },
  get: {
    type: "object",
    required: ["itemId"],
    properties: { itemId: { type: "string" } },
  },
  create: {
    type: "object",
    required: ["sourceId", "title", "start"],
    properties: {
      sourceId: { type: "string" },
      title: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      conference: { type: "boolean" },
    },
  },
  availability: {
    type: "object",
    required: ["sourceIds", "start", "end"],
    properties: {
      sourceIds: { type: "array", items: { type: "string" } },
      start: { type: "string" },
      end: { type: "string" },
    },
  },
};
const output = {
  type: "object",
  required: ["type", "value"],
  properties: { type: { type: "string" }, label: { type: "string" }, value: {} },
};
export const outlookCalendarPluginDefinition = (
  plugin: OutlookCalendarPlugin,
): PluginDefinition => {
  const execute = (
    name: string,
    run: (
      ownerId: string,
      input: Record<string, unknown>,
      context: PluginActionContext,
    ) => Promise<unknown>,
  ) => async (input: Record<string, unknown>, context: PluginActionContext) => {
    if (!context.userId) throw new Error("Usuário ausente.");
    return {
      type: "calendar",
      label: name,
      value: await run(context.userId, input, context),
    };
  };
  const actions = [
    {
      id: "list_calendars",
      name: "Listar calendários Outlook",
      inputSchema: actionSchema.list,
      run: (owner: string, input: Record<string, unknown>) =>
        plugin.listSources(owner, input.connectionId as string | undefined),
    },
    {
      id: "list_events",
      name: "Listar eventos Outlook",
      inputSchema: actionSchema.events,
      run: (owner: string, input: Record<string, unknown>) =>
        plugin.listItems(
          owner,
          [String(input.sourceId)],
          new Date(String(input.start)),
          new Date(String(input.end)),
        ),
    },
    {
      id: "get_event",
      name: "Obter evento Outlook",
      inputSchema: actionSchema.get,
      run: (owner: string, input: Record<string, unknown>) =>
        plugin.getItem(owner, String(input.itemId)),
    },
    {
      id: "create_event",
      name: "Criar evento Outlook",
      inputSchema: actionSchema.create,
      run: (owner: string, input: Record<string, unknown>) =>
        plugin.createItem(owner, String(input.sourceId), input as CalendarMutation),
    },
    {
      id: "update_event",
      name: "Atualizar evento Outlook",
      inputSchema: actionSchema.get,
      run: (owner: string, input: Record<string, unknown>) =>
        plugin.updateItem(owner, String(input.itemId), input),
    },
    {
      id: "delete_event",
      name: "Excluir evento Outlook",
      inputSchema: actionSchema.get,
      run: (owner: string, input: Record<string, unknown>) =>
        plugin.deleteItem(owner, String(input.itemId)),
    },
    {
      id: "get_availability",
      name: "Consultar disponibilidade Microsoft",
      inputSchema: actionSchema.availability,
      run: (owner: string, input: Record<string, unknown>) =>
        plugin.getAvailability(owner, {
          sourceIds: input.sourceIds as string[],
          start: String(input.start),
          end: String(input.end),
          timeZone: input.timeZone as string | undefined,
        }),
    },
  ];
  return {
    id: plugin.id,
    name: plugin.name,
    version: "1.0.0",
    scope: "account",
    configuration:[{key:'MICROSOFT_GRAPH_WEBHOOK_URL',label:'URL pública do webhook Microsoft Graph',secret:false}],
    capabilities: [
      { id: "calendar.events.read", name: "Ler eventos Outlook" },
      { id: "calendar.events.write", name: "Alterar eventos Outlook" },
      {
        id: "calendar.availability.read",
        name: "Consultar disponibilidade Microsoft",
      },
    ],
    actions: actions.map((action) => ({
      id: action.id,
      name: action.name,
      inputSchema: action.inputSchema,
      outputSchema: output,
      execute: execute(action.name, action.run),
    })),
    connectionProvider: {
      id: "microsoft-oauth",
      name: "Microsoft OAuth",
      supportsMultiple: true,
      capabilities: [
        "calendar.events.read",
        "calendar.events.write",
        "calendar.availability.read",
      ],
    },
    contributions: {
        calendarSources: [
        {
          providerId: plugin.id,
          label: plugin.name,
          connectPath: "/calendar/microsoft/oauth/start",
        },
      ],
      cardActions: [
        { id: "outlook_calendar.create_event", label: "Criar evento Outlook" },
        {
          id: "outlook_calendar.create_teams_event",
          label: "Criar evento Outlook com Teams",
        },
      ],
      settings: [
        {
          id: plugin.id,
          label: plugin.name,
          href: "/calendar?settings=outlook_calendar",
        },
      ],
    },
  };
};

@Controller("calendar/microsoft")
export class OutlookCalendarController {
  constructor(
    @Inject(OutlookCalendarPlugin) private outlook: OutlookCalendarPlugin,
    @Inject(MicrosoftGraphClient) private graph: MicrosoftGraphClient,
    @Inject(FeaturesService) private features: FeaturesService,
  ) {}
  @Get("status") async status(@Req() req: Request) {
    return {
      configured: this.graph.configured(),
      connections: await this.outlook.connections(this.features.user(req)),
    };
  }
  @Get("oauth/start") start(@Req() req: Request, @Query("capability") capability?: string) {
    return this.graph.oauthUrl(
      this.features.user(req),
      capability === "teams" ? "teams" : capability === "mail" ? "mail" : "calendar",
    );
  }
  @Get("oauth/callback") async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() response: Response,
  ) {
    try {
      await this.graph.oauthCallback(code, state);
      response.redirect(
        `${process.env.WEB_ORIGIN || "http://localhost:3000"}/calendar?connected=outlook_calendar`,
      );
    } catch (error) {
      response.redirect(
        `${process.env.WEB_ORIGIN || "http://localhost:3000"}/calendar?error=${encodeURIComponent((error as Error).message)}`,
      );
    }
  }
  @Post("connections/:id/discover") discover(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.outlook.discover(this.features.user(req), id);
  }
  @Delete("connections/:id") disconnect(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.outlook.disconnect(this.features.user(req), id);
  }
  @Post("webhook") webhook(
    @Query("validationToken") validationToken: string | undefined,
    @Body() body: { value?: unknown[] },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (validationToken !== undefined) {
      response.type("text/plain");
      return validationToken;
    }
    return this.outlook.notification(body);
  }
}
