import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { randomUUID } from "node:crypto";
import { Db } from "../db";
import { FeaturesService } from "../features";
import { CalendarSourceRegistry } from "./source-registry";
import { CalendarMutation } from "./types";

const bad = (message: string, status = 400): never => {
  throw new HttpException({ message }, status);
};
const uid = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
  )
    return bad("ID inválido.");
  return value;
};
const instant = (value: unknown, label: string): Date => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return bad(`${label} inválido.`);
  return new Date(value);
};

@Injectable()
export class CalendarService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(FeaturesService) private features: FeaturesService,
    @Inject(CalendarSourceRegistry) private registry: CalendarSourceRegistry,
  ) {}
  user(req: Request) {
    return this.features.user(req);
  }
  async sources(ownerId: string) {
    await Promise.all(
      this.registry
        .all()
        .map((provider) => provider.listSources(ownerId).catch(() => [])),
    );
    return this.db.query(
      `SELECT s.id,s.provider_id,s.connection_id,s.external_id,s.name,s.time_zone,s.color,s.access_role,s.is_primary,s.selected,s.visible,s.is_default,s.capabilities,s.metadata,
      c.display_name AS connection_name,c.enabled AS connection_enabled,COALESCE(to_jsonb(st)-'source_id','{}'::jsonb) AS settings
      FROM calendar_sources s LEFT JOIN integration_connections c ON c.id=s.connection_id LEFT JOIN calendar_source_settings st ON st.source_id=s.id
      WHERE s.owner_id=$1 ORDER BY s.provider_id,c.created_at,s.is_primary DESC,s.name`,
      [ownerId],
    );
  }
  async updateSource(
    ownerId: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    uid(id);
    const source = await this.db.one(
      "SELECT id FROM calendar_sources WHERE id=$1 AND owner_id=$2",
      [id, ownerId],
    );
    if (!source) bad("Calendário não encontrado.", 404);
    for (const key of ["selected", "visible", "is_default"])
      if (body[key] !== undefined && typeof body[key] !== "boolean")
        bad("Configuração inválida.");
    if (body.is_default === true)
      await this.db.query(
        "UPDATE calendar_sources SET is_default=false WHERE owner_id=$1",
        [ownerId],
      );
    await this.db.query(
      "UPDATE calendar_sources SET selected=COALESCE($3,selected),visible=COALESCE($4,visible),is_default=COALESCE($5,is_default),updated_at=now() WHERE id=$1 AND owner_id=$2",
      [
        id,
        ownerId,
        body.selected ?? null,
        body.visible ?? null,
        body.is_default ?? null,
      ],
    );
    const settingKeys = [
      "auto_create_cards",
      "update_linked_cards",
      "archive_cancelled_cards",
    ];
    for (const key of settingKeys)
      if (body[key] !== undefined && typeof body[key] !== "boolean")
        bad("Configuração de espelho inválida.");
    const board =
      body.target_board_id === null
        ? null
        : body.target_board_id === undefined
          ? undefined
          : uid(body.target_board_id);
    const list =
      body.target_list_id === null
        ? null
        : body.target_list_id === undefined
          ? undefined
          : uid(body.target_list_id);
    if (board) await this.features.member(board, ownerId);
    if (
      list &&
      !(await this.db.one(
        "SELECT 1 FROM lists l JOIN board_members m ON m.board_id=l.board_id WHERE l.id=$1 AND m.user_id=$2",
        [list, ownerId],
      ))
    )
      bad("Lista não encontrada.", 404);
    if (
      body.recurring_strategy !== undefined &&
      !["series", "occurrence"].includes(String(body.recurring_strategy))
    )
      bad("Estratégia de recorrência inválida.");
    if (
      settingKeys.some((key) => body[key] !== undefined) ||
      board !== undefined ||
      list !== undefined ||
      body.recurring_strategy !== undefined
    )
      await this.db.query(
        `INSERT INTO calendar_source_settings(source_id,auto_create_cards,target_board_id,target_list_id,update_linked_cards,archive_cancelled_cards,recurring_strategy)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_id) DO UPDATE SET auto_create_cards=COALESCE($2,calendar_source_settings.auto_create_cards),target_board_id=COALESCE($3,calendar_source_settings.target_board_id),target_list_id=COALESCE($4,calendar_source_settings.target_list_id),update_linked_cards=COALESCE($5,calendar_source_settings.update_linked_cards),archive_cancelled_cards=COALESCE($6,calendar_source_settings.archive_cancelled_cards),recurring_strategy=COALESCE($7,calendar_source_settings.recurring_strategy),updated_at=now()`,
        [
          id,
          body.auto_create_cards ?? null,
          board ?? null,
          list ?? null,
          body.update_linked_cards ?? null,
          body.archive_cancelled_cards ?? null,
          body.recurring_strategy ?? null,
        ],
      );
    if (body.selected !== undefined) {
      const provider = await this.provider(ownerId, id);
      await provider.sourceSelectionChanged?.(id, body.selected as boolean);
      if (body.selected) await provider.syncSource?.(id);
    }
    return this.sources(ownerId);
  }
  private async provider(ownerId: string, sourceId: string) {
    const source = await this.db.one<{ provider_id: string }>(
      "SELECT provider_id FROM calendar_sources WHERE id=$1 AND owner_id=$2",
      [uid(sourceId), ownerId],
    );
    if (!source) return bad("Calendário não encontrado.", 404);
    return this.registry.get(source.provider_id);
  }
  async items(
    ownerId: string,
    startValue: string,
    endValue: string,
    ids?: string,
  ) {
    const start = instant(startValue, "Início"),
      end = instant(endValue, "Fim");
    if (end <= start || end.getTime() - start.getTime() > 366 * 86400000)
      bad("Intervalo inválido.");
    const requested = (ids || "").split(",").filter(Boolean);
    const sourceRows = await this.db.query<{ id: string; provider_id: string }>(
      "SELECT id,provider_id FROM calendar_sources WHERE owner_id=$1 AND selected AND visible" +
        (requested.length ? " AND id=ANY($2::uuid[])" : ""),
      requested.length ? [ownerId, requested] : [ownerId],
    );
    const grouped = new Map<string, string[]>();
    for (const row of sourceRows)
      grouped.set(row.provider_id, [
        ...(grouped.get(row.provider_id) || []),
        row.id,
      ]);
    const items = (
      await Promise.all(
        [...grouped].map(([provider, sourceIds]) =>
          this.registry.get(provider).listItems(ownerId, sourceIds, start, end),
        ),
      )
    ).flat();
    return items.sort((a, b) => a.start.localeCompare(b.start));
  }
  private mutation(
    body: Record<string, unknown>,
    partial = false,
  ): Partial<CalendarMutation> {
    const result: Record<string, unknown> = {};
    if (!partial || body.title !== undefined) {
      const title = body.title;
      if (typeof title !== "string" || !title.trim() || title.length > 500)
        return bad("Título inválido.");
      result.title = title.trim();
    }
    for (const key of ["description", "location", "timeZone"])
      if (body[key] !== undefined) {
        if (body[key] !== null && typeof body[key] !== "string")
          return bad("Texto inválido.");
        result[key] = body[key];
      }
    for (const key of ["start", "end"])
      if (body[key] !== undefined)
        result[key] =
          body[key] === null ? null : instant(body[key], key).toISOString();
    if (!partial && !result.start) return bad("Início obrigatório.");
    if (body.allDay !== undefined) {
      if (typeof body.allDay !== "boolean") return bad("All-day inválido.");
      result.allDay = body.allDay;
    }
    if (body.attendees !== undefined) {
      if (
        !Array.isArray(body.attendees) ||
        body.attendees.some(
          (x) =>
            !x ||
            typeof x !== "object" ||
            typeof (x as { email?: unknown }).email !== "string",
        )
      )
        return bad("Convidados inválidos.");
      result.attendees = body.attendees;
    }
    if (body.recurrence !== undefined) {
      if (
        !Array.isArray(body.recurrence) ||
        body.recurrence.some((x) => typeof x !== "string")
      )
        return bad("Recorrência inválida.");
      result.recurrence = body.recurrence;
    }
    if (body.conference !== undefined)
      result.conference = Boolean(body.conference);
    return result;
  }
  async create(
    ownerId: string,
    sourceId: string,
    body: Record<string, unknown>,
  ) {
    const provider = await this.provider(ownerId, sourceId);
    if (!provider.createItem) return bad("Esta fonte é somente leitura.", 409);
    return provider.createItem(
      ownerId,
      sourceId,
      this.mutation(body) as CalendarMutation,
    );
  }
  async update(ownerId: string, itemId: string, body: Record<string, unknown>) {
    const item = await this.db.one<{ source_id: string }>(
      "SELECT source_id FROM calendar_items WHERE id=$1 AND owner_id=$2",
      [uid(itemId), ownerId],
    );
    if (!item) return bad("Evento não encontrado.", 404);
    const provider = await this.provider(ownerId, item.source_id);
    if (!provider.updateItem) return bad("Este evento é somente leitura.", 409);
    return provider.updateItem(
      ownerId,
      itemId,
      this.mutation(body, true),
      randomUUID(),
    );
  }
  async remove(ownerId: string, itemId: string) {
    const item = await this.db.one<{ source_id: string }>(
      "SELECT source_id FROM calendar_items WHERE id=$1 AND owner_id=$2",
      [uid(itemId), ownerId],
    );
    if (!item) return bad("Evento não encontrado.", 404);
    const provider = await this.provider(ownerId, item.source_id);
    if (!provider.deleteItem) return bad("Este evento é somente leitura.", 409);
    await provider.deleteItem(ownerId, itemId, randomUUID());
    return { ok: true };
  }
  async linkCard(
    ownerId: string,
    itemId: string,
    body: Record<string, unknown>,
  ) {
    const item = await this.db.one<{
      external_resource_id: string | null;
      title: string;
      description: string | null;
      start_at: Date;
      end_at: Date | null;
      all_day: boolean;
      time_zone: string | null;
    }>("SELECT * FROM calendar_items WHERE id=$1 AND owner_id=$2", [
      uid(itemId),
      ownerId,
    ]);
    if (!item) return bad("Evento não encontrado.", 404);
    let cardId = body.card_id ? uid(body.card_id) : null;
    if (cardId) await this.features.cardBoard(cardId, ownerId);
    else {
      const listId = uid(body.list_id);
      const list = await this.db.one<{ board_id: string }>(
        "SELECT l.board_id FROM lists l JOIN board_members m ON m.board_id=l.board_id WHERE l.id=$1 AND m.user_id=$2 AND l.archived_at IS NULL",
        [listId, ownerId],
      );
      if (!list) return bad("Lista não encontrada.", 404);
      const imports = (body.import || {}) as Record<string, unknown>;
      const created = await this.db.one<{ id: string }>(
        `INSERT INTO cards(list_id,title,description,position,schedule_start_at,schedule_end_at,schedule_all_day,schedule_time_zone) VALUES($1,$2,$3,COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$1),0),$4,$5,$6,$7) RETURNING id`,
        [
          listId,
          imports.title === false ? "Novo cartão" : item.title,
          imports.description === false ? "" : item.description || "",
          item.start_at,
          item.end_at,
          item.all_day,
          item.time_zone,
        ],
      );
      cardId = created!.id;
    }
    if (item.external_resource_id)
      await this.db.query(
        "UPDATE external_resources SET orbit_entity_type='card',orbit_entity_id=$2,updated_at=now() WHERE id=$1",
        [item.external_resource_id, cardId],
      );
    await this.db.query(
      "UPDATE calendar_items SET card_id=$2,updated_at=now() WHERE id=$1",
      [itemId, cardId],
    );
    return { card_id: cardId };
  }
  async unlink(ownerId: string, itemId: string) {
    const item = await this.db.one<{ external_resource_id: string | null }>(
      "SELECT external_resource_id FROM calendar_items WHERE id=$1 AND owner_id=$2",
      [uid(itemId), ownerId],
    );
    if (!item) return bad("Evento não encontrado.", 404);
    await this.db.query("UPDATE calendar_items SET card_id=NULL WHERE id=$1", [
      itemId,
    ]);
    if (item.external_resource_id)
      await this.db.query(
        "UPDATE external_resources SET orbit_entity_type=NULL,orbit_entity_id=NULL WHERE id=$1",
        [item.external_resource_id],
      );
    return { ok: true };
  }
  async availability(ownerId: string, body: Record<string, unknown>) {
    const sourceIds = Array.isArray(body.source_ids)
      ? body.source_ids.map(uid)
      : bad("Fontes inválidas.");
    const start = instant(body.start, "Início"),
      end = instant(body.end, "Fim");
    const rows = await this.db.query<{ provider_id: string; id: string }>(
      "SELECT id,provider_id FROM calendar_sources WHERE owner_id=$1 AND id=ANY($2::uuid[])",
      [ownerId, sourceIds],
    );
    const grouped = new Map<string, string[]>();
    for (const row of rows)
      grouped.set(row.provider_id, [
        ...(grouped.get(row.provider_id) || []),
        row.id,
      ]);
    return (
      await Promise.all(
        [...grouped].map(([id, ids]) => {
          const p = this.registry.get(id);
          return p.getAvailability
            ? p.getAvailability(ownerId, {
                sourceIds: ids,
                start: start.toISOString(),
                end: end.toISOString(),
                timeZone:
                  typeof body.time_zone === "string"
                    ? body.time_zone
                    : undefined,
              })
            : [];
        }),
      )
    ).flat();
  }
}

@Controller("calendar")
export class CalendarController {
  constructor(@Inject(CalendarService) private service: CalendarService) {}
  @Get("sources") sources(@Req() req: Request) {
    return this.service.sources(this.service.user(req));
  }
  @Patch("sources/:id") updateSource(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.updateSource(this.service.user(req), id, body);
  }
  @Get("items") items(
    @Req() req: Request,
    @Query("start") start: string,
    @Query("end") end: string,
    @Query("sources") sources?: string,
  ) {
    return this.service.items(this.service.user(req), start, end, sources);
  }
  @Post("sources/:id/items") create(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.create(this.service.user(req), id, body);
  }
  @Patch("items/:id") update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.update(this.service.user(req), id, body);
  }
  @Delete("items/:id") remove(@Req() req: Request, @Param("id") id: string) {
    return this.service.remove(this.service.user(req), id);
  }
  @Post("items/:id/link-card") link(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.linkCard(this.service.user(req), id, body);
  }
  @Delete("items/:id/link-card") unlink(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.service.unlink(this.service.user(req), id);
  }
  @Post("availability") availability(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.availability(this.service.user(req), body);
  }
}
