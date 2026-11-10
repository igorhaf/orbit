import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DocumentScanner } from "../records/documents";
import { PluginNotifications } from "../notifications";
import { SuindaLearningService } from "./suinda.service";
import { PluginRegistry } from "../../execution/registries";

test("convoca uma candidatura da lista por classificação, reserva a vaga e mantém aprovação humana", async () => {
  const workspaceId = randomUUID();
  const programId = randomUUID();
  const actorId = randomUUID();
  const program = { id: programId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "scholarship",
    title: "Programa", state: "open", revision: 1, payload: { available_places: 1 } };
  const applications: Array<{ id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> }> = [
    { id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "scholarship_application",
      title: "Candidatura A", state: "waitlisted", revision: 1,
      payload: { learner_user_id: randomUUID(), program_record_id: programId, score: 700, waitlist_position: 1, submitted_at: "2026-01-01T00:00:00.000Z" } },
    { id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "scholarship_application",
      title: "Candidatura B", state: "waitlisted", revision: 1,
      payload: { learner_user_id: randomUUID(), program_record_id: programId, score: 950, waitlist_position: 2, submitted_at: "2026-01-02T00:00:00.000Z" } },
  ];
  const events: Array<{ state: string; payload: Record<string, unknown>; userId: string }> = [];
  const published: Array<{ userId: string; input: Record<string, unknown> }> = [];
  const db = {
    async one() { return { id: actorId }; },
    async query() { return [{ id: programId, workspace_id: workspaceId }]; },
    pool: { async connect() { return { async query(sql: string) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("kind='scholarship'")) return { rows: [program] };
      if (sql.includes("COUNT(*)::int AS count")) return { rows: [{ count: applications.filter((item) => item.state === "approved"
        || item.state === "under_review" && item.payload.waitlist_invited_at).length }] };
      if (sql.includes("kind='scholarship_application'")) {
        const next = applications.filter((item) => item.state === "waitlisted").sort((a, b) => Number(b.payload.score) - Number(a.payload.score))[0];
        return { rows: next ? [next] : [] };
      }
      return { rows: [] };
    }, release() {} }; } },
  };
  const notifications = { async publish(_pluginId: string, userId: string, input: Record<string, unknown>) { published.push({ userId, input }); } };
  const registry = { isEnabled(id: string) { return id === "suinda-learning"; } };
  const service = new SuindaLearningService(db as never, { async has() { return false; } } as never,
    registry as unknown as PluginRegistry, new DocumentScanner(), notifications as unknown as PluginNotifications);
  Object.assign(service, {
    async payload(_client: unknown, _pluginId: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async save(_client: unknown, current: typeof applications[number], userId: string, _title: string,
      payload: Record<string, unknown>, state: string) {
      current.payload = payload;
      current.state = state;
      events.push({ state, payload, userId });
      return { ...current, revision: current.revision + 1 };
    },
  });

  await (service as unknown as { convocateScholarshipWaitlists(): Promise<void> }).convocateScholarshipWaitlists();

  assert.equal(applications.find((item) => item.payload.score === 950)?.state, "under_review");
  assert.equal(applications.find((item) => item.payload.score === 700)?.state, "waitlisted");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.userId, actorId);
  assert.equal(events[0]?.payload.waitlist_called_position, 2);
  assert.equal(typeof events[0]?.payload.waitlist_invited_at, "string");
  assert.equal("waitlist_position" in (events[0]?.payload || {}), false);
  assert.equal(published.length, 1);
  assert.match(String(published[0]?.input.body), /não representa aprovação/);
});
