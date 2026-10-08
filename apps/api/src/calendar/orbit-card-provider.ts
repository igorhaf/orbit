import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../db";
import { CalendarItem, CalendarSource, CalendarSourceProvider } from "./types";

@Injectable()
export class OrbitCardCalendarSource implements CalendarSourceProvider {
  readonly id = "orbit_cards";
  readonly name = "Orbit · Cards agendados";
  constructor(@Inject(Db) private db: Db) {}
  private async ensure(ownerId: string) {
    const existing = await this.db.one<{ id: string }>(
      "SELECT id FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2 AND external_id=$3",
      [ownerId, this.id, "scheduled-cards"],
    );
    if (existing) return existing.id;
    return String(
      (await this.db.one<{ id: string }>(
        `INSERT INTO calendar_sources(owner_id,provider_id,external_id,name,color,selected,visible,is_default,capabilities)
      VALUES($1,$2,'scheduled-cards','Cards agendados','#0c66e4',true,true,true,'{"update":true}'::jsonb) RETURNING id`,
        [ownerId, this.id],
      ))!.id,
    );
  }
  async listSources(ownerId: string): Promise<CalendarSource[]> {
    const id = await this.ensure(ownerId);
    const row = await this.db.one<Record<string, unknown>>(
      "SELECT * FROM calendar_sources WHERE id=$1",
      [id],
    );
    return [
      {
        id,
        providerId: this.id,
        externalId: "scheduled-cards",
        name: String(row!.name),
        timeZone: row!.time_zone as string | null,
        color: row!.color as string | null,
        primary: true,
        selected: Boolean(row!.selected),
        visible: Boolean(row!.visible),
        isDefault: Boolean(row!.is_default),
        capabilities: { update: true },
        metadata: {},
      },
    ];
  }
  async listItems(
    ownerId: string,
    sourceIds: string[],
    start: Date,
    end: Date,
  ): Promise<CalendarItem[]> {
    const sourceId = await this.ensure(ownerId);
    if (sourceIds.length && !sourceIds.includes(sourceId)) return [];
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT c.id,c.url_token,c.title,c.description,c.schedule_start_at,c.schedule_end_at,c.schedule_all_day,c.schedule_time_zone,l.board_id,l.title AS list_title,b.title AS board_title
      FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=$1
      WHERE c.schedule_start_at IS NOT NULL AND c.archived_at IS NULL AND l.archived_at IS NULL AND b.closed_at IS NULL
      AND c.schedule_start_at<$3 AND COALESCE(c.schedule_end_at,c.schedule_start_at)>=$2 ORDER BY c.schedule_start_at`,
      [ownerId, start, end],
    );
    return rows.map((row) => ({
      id: `card:${row.id}`,
      sourceId,
      resourceType: "card",
      cardId: String(row.id),
      cardUrlToken: String(row.url_token),
      title: String(row.title),
      description: String(row.description || ""),
      start: new Date(row.schedule_start_at as string).toISOString(),
      end: row.schedule_end_at
        ? new Date(row.schedule_end_at as string).toISOString()
        : null,
      allDay: Boolean(row.schedule_all_day),
      timeZone: row.schedule_time_zone as string | null,
      metadata: {
        boardId: row.board_id,
        boardTitle: row.board_title,
        listTitle: row.list_title,
      },
    }));
  }
}
