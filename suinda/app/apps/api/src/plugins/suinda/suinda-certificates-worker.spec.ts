import assert from "node:assert/strict";
import test from "node:test";
import { PluginRegistry } from "../../execution/registries";
import { workspacesPlugin } from "../../workspaces/workspaces.plugin";
import { genericPlugins } from "../records/catalog";
import { DocumentScanner } from "../records/documents";
import type { ExtensionRecord } from "../records/records.service";
import { suindaPlugin } from "./suinda.plugin";
import { SuindaLearningService } from "./suinda.service";

const workspaceId = "00000000-0000-4000-8000-000000000201";
const enrollmentId = "00000000-0000-4000-8000-000000000202";
const courseId = "00000000-0000-4000-8000-000000000203";
const lessonId = "00000000-0000-4000-8000-000000000205";
const learnerId = "00000000-0000-4000-8000-000000000206";
const actorId = "00000000-0000-4000-8000-000000000207";

test("worker emite cada marco uma vez e também emite a conclusão da matrícula", async () => {
  const enrollment: ExtensionRecord = {
    id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula", state: "completed", revision: 2, created_by: actorId, updated_by: actorId,
    payload: { course_record_id: courseId, course_revision: 4, learner_user_id: learnerId,
      amount_due: 0, payment_status: "not_required", completed_at: "2026-10-20T12:00:00.000Z" },
  };
  const course: ExtensionRecord = {
    id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course",
    title: "Formação", state: "completed", revision: 4, created_by: actorId, updated_by: actorId,
    payload: { version: 7, workload_mode: "manual", workload_hours: 8, price_amount: 0,
      intermediate_certificate_milestones: [{ milestone_key: "fundamentos", milestone_title: "Fundamentos", required_lesson_ids: [lessonId] }] },
  };
  const certificates: ExtensionRecord[] = [];
  const auditActions: string[] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("SELECT * FROM extension_records WHERE id=$1 FOR UPDATE")) return { rows: [enrollment] };
      if (sql.includes("extension_record_versions v") && sql.includes("v.revision=$3")) return { rows: [course] };
      if (sql.includes("kind='certificate'") && sql.includes("payload->>'enrollment_record_id'=$2")) {
        const milestoneOnly = sql.includes("payload->>'certificate_kind'='milestone'");
        return { rows: certificates.filter((record) => record.payload.enrollment_record_id === enrollmentId
          && (!milestoneOnly || record.payload.certificate_kind === "milestone")) };
      }
      if (sql.includes("SELECT l.id::text AS id")) return { rows: [{ id: lessonId, title: "Introdução", workload_minutes: 60, state: "published" }] };
      if (sql.includes("MAX(NULLIF(payload->>'completed_at'")) return { rows: [{ lesson_id: lessonId, completed_at: "2026-10-19T12:00:00.000Z" }] };
      if (sql.includes("AS satisfied")) return { rows: [{ satisfied: true }] };
      if (sql.includes("kind='certificate_template'")) return { rows: [] };
      if (sql.includes("INSERT INTO extension_records") && sql.includes("'certificate'")) {
        const record: ExtensionRecord = {
          id: `certificate-${certificates.length + 1}`, workspace_id: String(values[0]), plugin_id: "suinda-learning",
          kind: "certificate", title: String(values[1]), state: "draft", revision: 1, created_by: actorId, updated_by: actorId,
          payload: JSON.parse(String(values[2])) as Record<string, unknown>,
        };
        certificates.push(record);
        return { rows: [record] };
      }
      if (sql.includes("INSERT INTO access_audit")) {
        if (sql.includes("certificate.milestone_issued")) auditActions.push("suinda-learning.certificate.milestone_issued");
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const db = {
    pool: { async connect() { return client; } },
    async query(sql: string) {
      if (sql.includes("intermediate_certificate_milestones")) return [];
      if (sql.includes("SELECT e.* FROM extension_records e") && sql.includes("kind='enrollment'")) {
        assert.match(sql, /COALESCE\(c\.payload->>'certificate_kind','completion'\)='completion'/,
          "completion candidate query must ignore intermediate certificates");
        return [enrollment];
      }
      return [];
    },
    async one() { return null; },
  };
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(suindaPlugin);
  const service = new SuindaLearningService(db as never, {} as never, registry, new DocumentScanner());
  Object.defineProperty(service, "snapshot", { configurable: true, value: async () => undefined });
  Object.defineProperty(service, "save", { configurable: true, value: async (_client: unknown, current: ExtensionRecord,
    _actor: string, title: string, payload: Record<string, unknown>, state: string) => {
    const saved = { ...current, title, payload, state, revision: current.revision + 1, updated_by: actorId };
    const index = certificates.findIndex((record) => record.id === current.id);
    if (index >= 0) certificates[index] = saved;
    return saved;
  } });
  const worker = service as unknown as {
    issueIntermediateCertificatesForEnrollment(id: string, actor: string): Promise<void>;
    issueAutomaticCertificates(actor: string): Promise<void>;
  };

  await worker.issueIntermediateCertificatesForEnrollment(enrollmentId, actorId);
  await worker.issueIntermediateCertificatesForEnrollment(enrollmentId, actorId);
  const milestones = certificates.filter((record) => record.payload.certificate_kind === "milestone");
  assert.equal(milestones.length, 1, "repeated worker cycles must not duplicate the same configured milestone");
  assert.equal(milestones[0].state, "issued");
  assert.equal(milestones[0].payload.milestone_key, "fundamentos");

  await worker.issueAutomaticCertificates(actorId);
  const kinds = certificates.filter((record) => record.state === "issued").map((record) => record.payload.certificate_kind).sort();
  assert.deepEqual(kinds, ["completion", "milestone"], "intermediate issuance must coexist with the final completion certificate");
  assert.equal(auditActions.filter((action) => action === "suinda-learning.certificate.milestone_issued").length, 1);
});
