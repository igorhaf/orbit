import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../access/access";
import { Db } from "../../db";
import { CalendarItem, CalendarSource, CalendarSourceProvider } from "../../calendar/types";
import { productWebOrigin } from "../../product-profile";

type AcademicSession = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  modality: string;
  session_type: string | null;
  meeting_provider: string | null;
  meeting_url: string | null;
  location: string | null;
  room_address: string | null;
  course_title: string;
  cohort_code: string;
  enrollment_id: string | null;
};

type AcademicCalendarRecord = {
  id: string;
  title: string;
  event_type: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  course_title: string | null;
  cohort_code: string | null;
  enrollment_id: string | null;
};

@Injectable()
export class SuindaCalendarProvider implements CalendarSourceProvider {
  readonly id = "suinda-learning";
  readonly name = "Suindá · Agenda acadêmica";

  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService) {}

  private async ensureSource(ownerId: string) {
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`suinda-calendar-source:${ownerId}`]);
      let source = (await client.query<{ id: string }>(
        "SELECT id FROM calendar_sources WHERE owner_id=$1 AND provider_id=$2 AND connection_id IS NULL AND external_id='academic' FOR UPDATE",
        [ownerId, this.id],
      )).rows[0];
      if (!source) source = (await client.query<{ id: string }>(
        `INSERT INTO calendar_sources(owner_id,provider_id,external_id,name,color,selected,visible,is_default,capabilities,metadata)
         VALUES($1,$2,'academic','Suindá · Agenda acadêmica','#22d3ee',true,true,false,'{"read":true}'::jsonb,'{"product":"suinda"}'::jsonb) RETURNING id`,
        [ownerId, this.id],
      )).rows[0];
      await client.query("COMMIT");
      return source.id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listSources(ownerId: string): Promise<CalendarSource[]> {
    const id = await this.ensureSource(ownerId);
    const row = await this.db.one<Record<string, unknown>>("SELECT * FROM calendar_sources WHERE id=$1 AND owner_id=$2", [id, ownerId]);
    if (!row) return [];
    return [{
      id, providerId: this.id, externalId: "academic", name: String(row.name),
      timeZone: row.time_zone as string | null, color: row.color as string | null,
      primary: false, selected: Boolean(row.selected), visible: Boolean(row.visible), isDefault: Boolean(row.is_default),
      capabilities: { read: true }, metadata: { product: "suinda" },
    }];
  }

  async listItems(ownerId: string, sourceIds: string[], start: Date, end: Date): Promise<CalendarItem[]> {
    const sourceId = await this.ensureSource(ownerId);
    if (sourceIds.length && !sourceIds.includes(sourceId)) return [];
    const rows = await this.db.query<AcademicSession>(
      `SELECT DISTINCT s.id,s.title,s.payload->>'starts_at' AS starts_at,s.payload->>'ends_at' AS ends_at,
         s.payload->>'modality' AS modality,s.payload->>'session_type' AS session_type,s.payload->>'meeting_provider' AS meeting_provider,
         s.payload->>'meeting_url' AS meeting_url,s.payload->>'location' AS location,
         room.payload->>'address' AS room_address,course.title AS course_title,cohort.payload->>'code' AS cohort_code,
         enrollment.id AS enrollment_id
       FROM extension_records s
       JOIN extension_records cohort ON cohort.id::text=s.payload->>'cohort_record_id' AND cohort.workspace_id=s.workspace_id
         AND cohort.plugin_id='suinda-learning' AND cohort.kind='cohort'
       JOIN extension_records course ON course.id::text=cohort.payload->>'course_record_id' AND course.workspace_id=s.workspace_id
         AND course.plugin_id='suinda-learning' AND course.kind='course'
       LEFT JOIN extension_records room ON room.id::text=s.payload->>'room_record_id' AND room.workspace_id=s.workspace_id
         AND room.plugin_id='suinda-learning' AND room.kind='room'
       LEFT JOIN extension_records enrollment ON enrollment.workspace_id=s.workspace_id AND enrollment.plugin_id='suinda-learning'
         AND enrollment.kind='enrollment' AND enrollment.payload->>'learner_user_id'=$1
         AND enrollment.payload->>'course_record_id'=cohort.payload->>'course_record_id'
         AND enrollment.payload->>'course_revision'=cohort.payload->>'course_revision'
         AND enrollment.payload->>'cohort_record_id'=cohort.id::text AND enrollment.state=ANY($2::text[])
         AND (COALESCE(NULLIF(course.payload->>'price_amount','')::numeric,0)<=0 OR enrollment.payload->>'payment_status'=ANY(ARRAY['paid','waived']))
       WHERE s.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=$1)
         AND s.plugin_id='suinda-learning' AND s.kind='session' AND s.state=ANY(ARRAY['scheduled','live'])
         AND NULLIF(s.payload->>'starts_at','')::timestamptz<$4::timestamptz
         AND NULLIF(s.payload->>'ends_at','')::timestamptz >= $3::timestamptz
         AND (
           (enrollment.id IS NOT NULL AND (COALESCE(NULLIF(course.payload->>'price_amount','')::numeric,0)<=0
             OR enrollment.payload->>'payment_status'=ANY(ARRAY['paid','waived'])))
           OR s.payload->>'instructor_user_id'=$1
           OR course.payload->'instructor_ids' @> jsonb_build_array($1::text)
           OR cohort.payload->'instructor_ids' @> jsonb_build_array($1::text)
           OR cohort.payload->'tutor_ids' @> jsonb_build_array($1::text)
         )
       ORDER BY s.id`,
      [ownerId, ["enrolled", "active"], start, end],
    );
    const origin = productWebOrigin().replace(/\/$/, "");
    const items = rows.map((row): CalendarItem => {
      const learner = Boolean(row.enrollment_id);
      const modality = row.modality === "in_person" ? "Presencial" : row.modality === "hybrid" ? "Híbrida" : "Online";
      const makeup = row.session_type === "makeup";
      return {
        id: `suinda-session:${row.id}`, sourceId, resourceType: "event", title: `${makeup ? "Reposição: " : ""}${row.title}`,
        description: `${row.course_title} · Turma ${row.cohort_code} · ${modality}${makeup ? " · Encontro de reposição" : ""}`,
        start: new Date(row.starts_at).toISOString(), end: new Date(row.ends_at).toISOString(), allDay: false,
        location: row.location || row.room_address || null,
        conference: row.modality !== "in_person" && row.meeting_url
          ? { provider: row.meeting_provider || "suinda", joinUrl: row.meeting_url } : undefined,
        externalUrl: `${origin}${learner ? `/suinda/learning/${encodeURIComponent(row.enrollment_id!)}` : "/suinda"}`,
        metadata: { product: "Suindá", courseTitle: row.course_title, cohortCode: row.cohort_code, sessionType: makeup ? "makeup" : "regular", readOnly: true },
      };
    });
    const visibleSessionIds = new Set(rows.map((row) => row.id));
    const makeupSessions = await this.db.query<AcademicSession & { original_session_title: string; source_cohort_code: string }>(
      `SELECT DISTINCT s.id,s.title,s.payload->>'starts_at' AS starts_at,s.payload->>'ends_at' AS ends_at,
         s.payload->>'modality' AS modality,s.payload->>'session_type' AS session_type,s.payload->>'meeting_provider' AS meeting_provider,
         s.payload->>'meeting_url' AS meeting_url,s.payload->>'location' AS location,
         room.payload->>'address' AS room_address,course.title AS course_title,target_cohort.payload->>'code' AS cohort_code,
         enrollment.id::text AS enrollment_id,original.title AS original_session_title,source_cohort.payload->>'code' AS source_cohort_code
       FROM extension_records request
       JOIN extension_records enrollment ON enrollment.id::text=request.payload->>'enrollment_record_id' AND enrollment.workspace_id=request.workspace_id
         AND enrollment.plugin_id='suinda-learning' AND enrollment.kind='enrollment'
         AND enrollment.payload->>'learner_user_id'=$1 AND enrollment.state=ANY(ARRAY['enrolled','active']::text[])
       JOIN extension_records original ON original.id::text=request.payload->>'original_session_record_id' AND original.workspace_id=request.workspace_id
         AND original.plugin_id='suinda-learning' AND original.kind='session'
       JOIN extension_records source_cohort ON source_cohort.id::text=original.payload->>'cohort_record_id' AND source_cohort.workspace_id=request.workspace_id
         AND source_cohort.plugin_id='suinda-learning' AND source_cohort.kind='cohort'
       JOIN extension_records s ON s.id::text=request.payload->>'replacement_session_record_id' AND s.workspace_id=request.workspace_id
         AND s.plugin_id='suinda-learning' AND s.kind='session' AND s.state=ANY(ARRAY['scheduled','live']::text[])
         AND s.payload->>'session_type'='makeup' AND s.payload->>'replacement_session_record_id'=original.id::text
       JOIN extension_records target_cohort ON target_cohort.id::text=s.payload->>'cohort_record_id' AND target_cohort.workspace_id=s.workspace_id
         AND target_cohort.plugin_id='suinda-learning' AND target_cohort.kind='cohort'
         AND target_cohort.payload->>'course_record_id'=enrollment.payload->>'course_record_id'
         AND target_cohort.payload->>'course_revision'=enrollment.payload->>'course_revision'
       JOIN extension_records course ON course.id::text=target_cohort.payload->>'course_record_id' AND course.workspace_id=target_cohort.workspace_id
         AND course.plugin_id='suinda-learning' AND course.kind='course'
       LEFT JOIN extension_records room ON room.id::text=s.payload->>'room_record_id' AND room.workspace_id=s.workspace_id
         AND room.plugin_id='suinda-learning' AND room.kind='room'
       WHERE request.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=$1)
         AND request.plugin_id='suinda-learning' AND request.kind='makeup_request' AND request.state='scheduled'
         AND request.payload->>'fee_status'=ANY(ARRAY['not_required','paid','waived']::text[])
         AND (COALESCE(NULLIF(enrollment.payload->>'amount_due','')::numeric,COALESCE(NULLIF(course.payload->>'price_amount','')::numeric,0))<=0
           OR enrollment.payload->>'payment_status'=ANY(ARRAY['paid','validated','waived','scholarship']::text[]))
         AND NULLIF(s.payload->>'starts_at','')::timestamptz<$3::timestamptz
         AND NULLIF(s.payload->>'ends_at','')::timestamptz >= $2::timestamptz
       ORDER BY s.id`,
      [ownerId, start, end],
    );
    for (const row of makeupSessions) {
      if (visibleSessionIds.has(row.id)) continue;
      const modality = row.modality === "in_person" ? "Presencial" : row.modality === "hybrid" ? "Híbrida" : "Online";
      items.push({
        id: `suinda-session:${row.id}`, sourceId, resourceType: "event", title: `Reposição: ${row.title}`,
        description: `${row.course_title} · Turma ${row.cohort_code} · reposição de “${row.original_session_title}” · turma de origem ${row.source_cohort_code} · ${modality}`,
        start: new Date(row.starts_at).toISOString(), end: new Date(row.ends_at).toISOString(), allDay: false,
        location: row.location || row.room_address || null,
        conference: row.modality !== "in_person" && row.meeting_url
          ? { provider: row.meeting_provider || "suinda", joinUrl: row.meeting_url } : undefined,
        externalUrl: `${origin}/suinda/learning/${encodeURIComponent(row.enrollment_id!)}/attendance`,
        metadata: { product: "Suindá", courseTitle: row.course_title, cohortCode: row.cohort_code, sessionType: "makeup", readOnly: true },
      });
      visibleSessionIds.add(row.id);
    }
    const assessments = await this.db.query<{
      id: string; title: string; due_at: string; course_title: string; enrollment_id: string;
    }>(
      `SELECT DISTINCT a.id,a.title,a.payload->>'due_at' AS due_at,course.title AS course_title,enrollment.id AS enrollment_id
       FROM extension_records enrollment
       JOIN extension_records a ON a.workspace_id=enrollment.workspace_id AND a.plugin_id='suinda-learning' AND a.kind='assessment'
         AND a.state='published' AND a.payload->>'course_record_id'=enrollment.payload->>'course_record_id'
         AND (NULLIF(a.payload->>'cohort_record_id','') IS NULL OR a.payload->>'cohort_record_id'=enrollment.payload->>'cohort_record_id')
       JOIN extension_records course ON course.id::text=enrollment.payload->>'course_record_id' AND course.workspace_id=enrollment.workspace_id
         AND course.plugin_id='suinda-learning' AND course.kind='course'
       WHERE enrollment.plugin_id='suinda-learning' AND enrollment.kind='enrollment' AND enrollment.payload->>'learner_user_id'=$1
         AND enrollment.state=ANY($2::text[]) AND NULLIF(a.payload->>'due_at','')::timestamptz >= $3::timestamptz
         AND NULLIF(a.payload->>'due_at','')::timestamptz < $4::timestamptz
         AND (COALESCE(NULLIF(course.payload->>'price_amount','')::numeric,0)<=0 OR enrollment.payload->>'payment_status'=ANY(ARRAY['paid','waived']))
       ORDER BY a.id`,
      [ownerId, ["enrolled", "active"], start, end],
    );
    for (const assessment of assessments) {
      const due = new Date(assessment.due_at);
      if (Number.isNaN(due.getTime())) continue;
      const day = due.toISOString().slice(0, 10);
      const nextDay = new Date(due);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      items.push({ id: `suinda-assessment:${assessment.id}`, sourceId, resourceType: "event",
        title: `Prazo: ${assessment.title}`, description: assessment.course_title,
        start: `${day}T00:00:00.000Z`, end: `${nextDay.toISOString().slice(0, 10)}T00:00:00.000Z`, allDay: true,
        externalUrl: `${origin}/suinda/learning/${encodeURIComponent(assessment.enrollment_id)}/assessments`,
        metadata: { product: "Suindá", category: "assessment", courseTitle: assessment.course_title, readOnly: true },
      });
    }
    const practices = await this.db.query<{
      id: string; title: string; scheduled_at: string; location: string | null; activity_description: string;
      course_title: string; enrollment_id: string | null;
    }>(
      `SELECT DISTINCT practice.id,practice.title,practice.payload->>'scheduled_at' AS scheduled_at,
         practice.payload->>'location' AS location,practice.payload->>'activity_description' AS activity_description,
         course.title AS course_title,
         CASE WHEN practice.payload->>'learner_user_id'=$1 AND (COALESCE(NULLIF(course.payload->>'price_amount','')::numeric,0)<=0
           OR enrollment.payload->>'payment_status'=ANY(ARRAY['paid','waived'])) THEN enrollment.id::text ELSE NULL END AS enrollment_id
       FROM extension_records practice
       JOIN extension_records enrollment ON enrollment.id::text=practice.payload->>'enrollment_record_id' AND enrollment.workspace_id=practice.workspace_id
         AND enrollment.plugin_id='suinda-learning' AND enrollment.kind='enrollment'
       JOIN extension_records course ON course.id::text=enrollment.payload->>'course_record_id' AND course.workspace_id=enrollment.workspace_id
         AND course.plugin_id='suinda-learning' AND course.kind='course'
       WHERE practice.plugin_id='suinda-learning' AND practice.kind='practice'
         AND practice.state=ANY(ARRAY['scheduled','in_progress','submitted','needs_correction'])
         AND NULLIF(practice.payload->>'scheduled_at','')::timestamptz >= $2::timestamptz
         AND NULLIF(practice.payload->>'scheduled_at','')::timestamptz < $3::timestamptz
         AND (practice.payload->>'learner_user_id'=$1 OR practice.payload->>'supervisor_user_id'=$1)
         AND (practice.payload->>'supervisor_user_id'=$1 OR enrollment.state=ANY(ARRAY['enrolled','active'])
           AND (COALESCE(NULLIF(course.payload->>'price_amount','')::numeric,0)<=0 OR enrollment.payload->>'payment_status'=ANY(ARRAY['paid','waived'])))
       ORDER BY practice.id`,
      [ownerId, start, end],
    );
    for (const practice of practices) {
      const beginsAt = new Date(practice.scheduled_at);
      if (Number.isNaN(beginsAt.getTime())) continue;
      const endsAt = new Date(beginsAt.getTime() + 60 * 60 * 1000);
      items.push({ id: `suinda-practice:${practice.id}`, sourceId, resourceType: "event",
        title: `Prática: ${practice.title}`, description: `${practice.course_title} · ${practice.activity_description}`,
        start: beginsAt.toISOString(), end: endsAt.toISOString(), allDay: false, location: practice.location,
        externalUrl: `${origin}${practice.enrollment_id ? `/suinda/learning/${encodeURIComponent(practice.enrollment_id)}` : "/suinda"}`,
        metadata: { product: "Suindá", category: "practice", courseTitle: practice.course_title, readOnly: true },
      });
    }
    const memberships = await this.db.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM workspace_members WHERE user_id=$1", [ownerId],
    );
    const managerWorkspaces: string[] = [];
    for (const membership of memberships) {
      if (await this.access.has(ownerId, "plugin.suinda-learning.manage", "workspace", membership.workspace_id)
        || await this.access.has(ownerId, "plugin.suinda-learning.write", "workspace", membership.workspace_id)) managerWorkspaces.push(membership.workspace_id);
    }
    const academicEvents = await this.db.query<AcademicCalendarRecord>(
      `SELECT DISTINCT ON (a.id) a.id,a.title,a.payload->>'event_type' AS event_type,a.payload->>'description' AS description,
         a.payload->>'starts_at' AS starts_at,a.payload->>'ends_at' AS ends_at,COALESCE((a.payload->>'all_day')::boolean,false) AS all_day,
         a.payload->>'location' AS location,course_version.title AS course_title,cohort.payload->>'code' AS cohort_code,
         eligible_enrollment.id::text AS enrollment_id
       FROM extension_records a
       LEFT JOIN extension_records course ON course.id::text=a.payload->>'course_record_id' AND course.workspace_id=a.workspace_id
         AND course.plugin_id='suinda-learning' AND course.kind='course'
       LEFT JOIN extension_record_versions course_version ON course_version.record_id=course.id
         AND course_version.revision=NULLIF(a.payload->>'course_revision','')::int
       LEFT JOIN extension_records cohort ON cohort.id::text=a.payload->>'cohort_record_id' AND cohort.workspace_id=a.workspace_id
         AND cohort.plugin_id='suinda-learning' AND cohort.kind='cohort'
       LEFT JOIN LATERAL (
         SELECT e.id FROM extension_records e WHERE e.workspace_id=a.workspace_id AND e.plugin_id='suinda-learning' AND e.kind='enrollment'
           AND e.payload->>'learner_user_id'=$1 AND e.payload->>'course_record_id'=a.payload->>'course_record_id'
           AND e.payload->>'course_revision'=a.payload->>'course_revision' AND e.state=ANY(ARRAY['enrolled','active'])
           AND (a.payload->>'cohort_record_id' IS NULL OR e.payload->>'cohort_record_id'=a.payload->>'cohort_record_id')
           AND (COALESCE(NULLIF(course.payload->>'price_amount','')::numeric,0)<=0 OR e.payload->>'payment_status'=ANY(ARRAY['paid','waived']))
         ORDER BY e.updated_at DESC,e.id LIMIT 1
       ) eligible_enrollment ON true
       WHERE a.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=$1)
         AND a.plugin_id='suinda-learning' AND a.kind='academic_calendar_event' AND a.state='published'
         AND NULLIF(a.payload->>'starts_at','')::timestamptz<$3::timestamptz
         AND NULLIF(a.payload->>'ends_at','')::timestamptz >= $2::timestamptz
         AND (a.payload->>'course_record_id' IS NULL AND a.payload->>'cohort_record_id' IS NULL OR a.workspace_id=ANY($4::uuid[])
           OR eligible_enrollment.id IS NOT NULL
           OR course.payload->'instructor_ids' @> jsonb_build_array($1::text)
           OR course.payload->'tutor_ids' @> jsonb_build_array($1::text)
           OR cohort.payload->'instructor_ids' @> jsonb_build_array($1::text)
           OR cohort.payload->'tutor_ids' @> jsonb_build_array($1::text))
       ORDER BY a.id`,
      [ownerId, start, end, managerWorkspaces],
    );
    for (const event of academicEvents) {
      const startAt = new Date(event.starts_at), endAt = new Date(event.ends_at);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) continue;
      const eventType = event.event_type === "makeup" ? "Reposição" : event.event_type === "recess" ? "Recesso" : "Feriado";
      items.push({ id: `suinda-academic-event:${event.id}`, sourceId, resourceType: "event",
        title: `${eventType}: ${event.title}`, description: [event.course_title, event.cohort_code ? `Turma ${event.cohort_code}` : null, event.description]
          .filter((part): part is string => Boolean(part)).join(" · "),
        start: event.all_day ? startAt.toISOString().slice(0, 10) : startAt.toISOString(),
        end: event.all_day ? endAt.toISOString().slice(0, 10) : endAt.toISOString(), allDay: event.all_day,
        location: event.location, externalUrl: `${origin}${event.enrollment_id ? `/suinda/learning/${encodeURIComponent(event.enrollment_id)}` : "/suinda"}`,
        metadata: { product: "Suindá", category: event.event_type, courseTitle: event.course_title, cohortCode: event.cohort_code, readOnly: true },
      });
    }
    for (const item of items) {
      const separator = item.id.indexOf(":");
      if (separator < 1) continue;
      const category = item.id.slice(0, separator);
      const recordId = item.id.slice(separator + 1);
      const eventType = category === "suinda-session" ? "session"
        : category === "suinda-assessment" ? "assessment"
          : category === "suinda-practice" ? "practice"
            : category === "suinda-academic-event" ? "academic_event" : null;
      if (!eventType) continue;
      await this.access.audit(ownerId, `suinda-learning.calendar.${eventType}.read`, recordId, { type: "extension_record", id: recordId });
    }
    return items;
  }
}
