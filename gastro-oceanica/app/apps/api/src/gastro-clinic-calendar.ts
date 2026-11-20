import { Inject, Injectable } from "@nestjs/common";
import { Db } from "./db";
import { ExtensionRecords } from "./plugins/records/records.service";
import type { CalendarItem, CalendarSource, CalendarSourceProvider } from "./calendar/types";

/** Read-only bridge from authorized clinic appointments and schedule blocks into Orbit's shared calendar. */
@Injectable()
export class GastroClinicCalendarSource implements CalendarSourceProvider {
  readonly id = "gastro-clinic";
  readonly name = "Gastro Oceânica · Agenda";

  constructor(@Inject(Db) private readonly db: Db, @Inject(ExtensionRecords) private readonly records: ExtensionRecords) {}

  async listSources(ownerId: string): Promise<CalendarSource[]> {
    let row = await this.db.one<{ id: string }>(
      "SELECT id FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2 AND connection_id IS NULL AND external_id=$3",
      [ownerId, this.id, "clinic-appointments"],
    );
    if (!row) row = await this.db.one<{ id: string }>(
      `INSERT INTO calendar_sources(owner_id,provider_id,external_id,name,color,selected,visible,is_default,capabilities)
       VALUES($1,$2,$3,$4,$5,true,true,false,'{}'::jsonb) RETURNING id`,
      [ownerId, this.id, "clinic-appointments", this.name, "#0f766e"],
    );
    if (!row) return [];
    return [{ id: row.id, providerId: this.id, externalId: "clinic-appointments", name: this.name,
      color: "#0f766e", primary: true, selected: true, visible: true, isDefault: false,
      capabilities: {}, metadata: { readOnly: true } }];
  }

  async listItems(ownerId: string, sourceIds: string[], start: Date, end: Date): Promise<CalendarItem[]> {
    const source = (await this.listSources(ownerId))[0];
    if (!source || sourceIds.length && !sourceIds.includes(source.id)) return [];
    const [appointments, blocks] = await Promise.all([
      this.records.calendarWindow("gastro-clinic", "appointment", ownerId, start, end, "starts_at", "ends_at"),
      this.records.calendarWindow("gastro-clinic", "schedule_block", ownerId, start, end, "starts_at", "ends_at", "all_day"),
    ]);
    const appointmentItems: CalendarItem[] = appointments.filter(record => record.state !== "cancelled").map(record => ({
      id: `gastro-appointment:${record.id}`, sourceId: source.id, resourceType: "event",
      title: "Agendamento", description: null, start: record.start, end: record.end,
      allDay: false, externalResourceId: record.id, status: record.state,
      metadata: { product: "gastro-oceanica", recordKind: "appointment" },
    }));
    const blockItems: CalendarItem[] = blocks.filter(record => record.state !== "cancelled").map(record => ({
      id: `gastro-schedule-block:${record.id}`, sourceId: source.id, resourceType: "event",
      title: "Bloqueio de horário", description: null, start: record.start, end: record.end,
      allDay: record.allDay === true, externalResourceId: record.id, status: record.state,
      metadata: { product: "gastro-oceanica", recordKind: "schedule_block" },
    }));
    return [...appointmentItems, ...blockItems].sort((left, right) => left.start.localeCompare(right.start));
  }
}
