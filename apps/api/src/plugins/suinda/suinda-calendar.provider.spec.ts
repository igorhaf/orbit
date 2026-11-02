import assert from "node:assert/strict";
import test from "node:test";
import { Db } from "../../db";
import { AccessService } from "../../access/access";
import { SuindaCalendarProvider } from "./suinda-calendar.provider";

test("academic calendar returns every eligible session in its bounded date range", async () => {
  const sourceId = "10000000-0000-4000-8000-000000000001";
  const sessions = Array.from({ length: 1_001 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `Session ${index + 1}`,
    starts_at: "2026-10-25T10:00:00.000Z",
    ends_at: "2026-10-25T11:00:00.000Z",
    modality: "online",
    session_type: "regular",
    meeting_provider: null,
    meeting_url: null,
    location: null,
    room_address: null,
    course_title: "Course",
    cohort_code: "A",
    enrollment_id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }));
  const db = {
    pool: { connect: async () => ({
      query: async (sql: string) => sql.includes("INSERT INTO calendar_sources")
        ? { rows: [{ id: sourceId }] }
        : { rows: [] },
      release: () => undefined,
    }) },
    one: async (sql: string) => sql.includes("FROM calendar_sources") ? { id: sourceId } : null,
    query: async (sql: string) => {
      if (sql.includes("FROM extension_records s")) {
        assert.doesNotMatch(sql, /LIMIT\s+1000/i);
        return sessions;
      }
      return [];
    },
  };
  const access = { audit: async () => undefined, has: async () => false };
  const provider = new SuindaCalendarProvider(db as unknown as Db, access as unknown as AccessService);

  const items = await provider.listItems("40000000-0000-4000-8000-000000000001", [],
    new Date("2026-10-25T00:00:00.000Z"), new Date("2026-10-26T00:00:00.000Z"));

  assert.equal(items.length, 1_001);
});
