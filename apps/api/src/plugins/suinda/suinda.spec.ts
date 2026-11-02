import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import type { RecordValidationContext } from "../contract";
import { PluginRegistry } from "../../execution/registries";
import { workspacesPlugin } from "../../workspaces/workspaces.plugin";
import { genericPlugins } from "../records/catalog";
import { assessmentQuestionOrder, attendanceRiskPercent, calculateEnrollmentCouponAmounts, calculateWeeklyLearningGoal, calculateWorkloadProgress, enrollmentTransferIssue, isEligibleForAutomaticEnrollment, mergeScholarshipCounterpartyEvidenceFiles, normalizeWeeklyLearningGoal, reconcileRemoteParticipantMinutes, reconcileZoomParticipantMinutes, unitCapacitySummary, SuindaLearningService as ExtensionRecords } from "./suinda.service";
import { DocumentScanner } from "../records/documents";
import { AccessGuard, AccessService } from "../../access/access";
import { suindaPlugin, suindaRecordKinds } from "./suinda.plugin";
import { validate } from "../records/rules";
import { suindaCorporatePlugin } from "../suinda-corporate";
import { createCertificatePdf } from "./certificate-pdf";
import { parseCsvRecords, parseEnrollmentCsv } from "./enrollment-csv";
import { createAcademicReportPdf } from "./academic-report-pdf";
import { isProtectedAttachmentEnvelope, sealProtectedAttachment } from "../../data-protector";
import "./suinda-honorarium-payments.spec";

const enrollment = suindaRecordKinds.enrollment;
const cohortId = "00000000-0000-4000-8000-000000000001";

test("editor da aula explica a sintaxe de alt para imagens informativas e decorativas", () => {
  const properties = suindaRecordKinds.lesson.schema.properties as Record<string, { description?: string }>;
  assert.match(properties.body_markdown?.description || "", /!\[descrição\]\(URL\)/);
  assert.match(properties.body_markdown?.description || "", /!\[\]\(URL\)/);
  assert.match(properties.body_markdown?.description || "", /caracteres invisíveis não contam como descrição/);
});

test("nullable enum fields accept JSON null in enrollment and makeup schemas", () => {
  assert.doesNotThrow(() => validate(enrollment.schema, {
    course_record_id: cohortId,
    course_revision: 1,
    learner_user_id: "learner",
    discount_context_snapshot: null,
  }));
  assert.doesNotThrow(() => validate(suindaRecordKinds.makeup_request.schema, {
    enrollment_record_id: cohortId,
    learner_user_id: "learner",
    original_session_record_id: cohortId,
    reason: "Pedido de reposição",
    request_key: "enrollment:session",
    original_attendance_status: null,
  }));
});

test("resumo unitário de lotação aplica unidade efetiva, status elegíveis e limite de 80%", () => {
  const workspaceId = randomUUID(); const otherWorkspaceId = randomUUID();
  const unitId = randomUUID(); const otherUnitId = randomUUID();
  const fallbackCourseId = randomUUID();
  const cohorts = [
    { id: "cohort-b", workspace_id: workspaceId, title: "Turma B", state: "active", payload: { capacity: 10, course_record_id: fallbackCourseId, institution_unit_record_id: unitId } },
    { id: "cohort-a", workspace_id: workspaceId, title: "Turma A", state: "enrolling", payload: { capacity: 5, course_record_id: fallbackCourseId } },
    { id: "cohort-other", workspace_id: otherWorkspaceId, title: "Outra instituição", state: "active", payload: { capacity: 1, course_record_id: fallbackCourseId, institution_unit_record_id: unitId } },
    { id: "cohort-other-unit", workspace_id: workspaceId, title: "Outra unidade", state: "active", payload: { capacity: 1, course_record_id: fallbackCourseId, institution_unit_record_id: otherUnitId } },
    { id: "cohort-below", workspace_id: workspaceId, title: "Abaixo de 80%", state: "active", payload: { capacity: 10, course_record_id: fallbackCourseId, institution_unit_record_id: unitId } },
    { id: "cohort-closed", workspace_id: workspaceId, title: "Encerrada", state: "closed", payload: { capacity: 1, course_record_id: fallbackCourseId, institution_unit_record_id: unitId } },
  ];
  const enrollments = [
    ...Array.from({ length: 8 }, (_, index) => ({ state: index === 0 ? "paused" : "active", payload: { cohort_record_id: "cohort-b" } })),
    ...Array.from({ length: 4 }, () => ({ state: "approved", payload: { cohort_record_id: "cohort-a" } })),
    { state: "waitlisted", payload: { cohort_record_id: "cohort-a" } },
    { state: "active", payload: { cohort_record_id: "cohort-other" } },
    { state: "active", payload: { cohort_record_id: "cohort-other-unit" } },
    ...Array.from({ length: 7 }, () => ({ state: "active", payload: { cohort_record_id: "cohort-below" } })),
    { state: "active", payload: { cohort_record_id: "cohort-closed" } },
  ];
  const summary = unitCapacitySummary(cohorts, enrollments, [{ id: fallbackCourseId, payload: { institution_unit_record_id: unitId } }],
    [{ workspace_id: workspaceId, id: unitId }]);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.items.map((item) => [item.id, item.occupied, item.capacity]), [["cohort-a", 4, 5], ["cohort-b", 8, 10]]);
});

test("matrícula automática exige aprovação e curso quitado, isento ou sem valor devido", () => {
  const course = { price_amount: 120 };
  assert.equal(isEligibleForAutomaticEnrollment({ state: "approved", payload: { amount_due: 0, payment_status: "pending" } }, course), true);
  assert.equal(isEligibleForAutomaticEnrollment({ state: "approved", payload: { amount_due: 120, payment_status: "paid" } }, course), true);
  assert.equal(isEligibleForAutomaticEnrollment({ state: "approved", payload: { amount_due: 120, payment_status: "waived" } }, course), true);
  assert.equal(isEligibleForAutomaticEnrollment({ state: "approved", payload: { amount_due: 120, payment_status: "pending" } }, course), false);
  assert.equal(isEligibleForAutomaticEnrollment({ state: "submitted", payload: { amount_due: 0, payment_status: "not_required" } }, course), false);
});

test("a moderação da comunidade é limitada à matrícula, turma ou unidade exata", async () => {
  const courseId = "00000000-0000-4000-8000-000000000701";
  const cohortAId = "00000000-0000-4000-8000-000000000702";
  const cohortBId = "00000000-0000-4000-8000-000000000703";
  const enrollmentAId = "00000000-0000-4000-8000-000000000704";
  const enrollmentBId = "00000000-0000-4000-8000-000000000705";
  const unitAId = "00000000-0000-4000-8000-000000000706";
  const unitBId = "00000000-0000-4000-8000-000000000707";
  const records = new Map<string, { id: string; pluginId: string; kind: string; state?: string; payload: Record<string, unknown> }>([
    [courseId, { id: courseId, pluginId: "suinda-learning", kind: "course", payload: { instructor_ids: [], tutor_ids: [] } }],
    [cohortAId, { id: cohortAId, pluginId: "suinda-learning", kind: "cohort", payload: { course_record_id: courseId, course_revision: 1, instructor_user_id: "teacher-a" } }],
    [cohortBId, { id: cohortBId, pluginId: "suinda-learning", kind: "cohort", payload: { course_record_id: courseId, course_revision: 1, instructor_user_id: "teacher-b" } }],
    [enrollmentAId, { id: enrollmentAId, pluginId: "suinda-learning", kind: "enrollment", state: "active", payload: { course_record_id: courseId, course_revision: 1, cohort_record_id: cohortAId, institution_unit_record_id: unitAId } }],
    [enrollmentBId, { id: enrollmentBId, pluginId: "suinda-learning", kind: "enrollment", state: "active", payload: { course_record_id: courseId, course_revision: 1, cohort_record_id: cohortBId, institution_unit_record_id: unitBId } }],
    [unitAId, { id: unitAId, pluginId: "suinda-learning", kind: "institution_unit", payload: {} }],
    [unitBId, { id: unitBId, pluginId: "suinda-learning", kind: "institution_unit", payload: {} }],
  ]);
  const moderatorContext = (actorId: string, managedUnit?: string) => ({
    actorId,
    async hasWorkspacePermission() { return false; },
    async resolveLatestRecord(id: string) { return records.get(id) || null; },
    async hasPermissionOnResource(_permission: string, id: string) { return id === managedUnit; },
  } as never);
  const reportPayload = (enrollmentId: string) => ({ enrollment_record_id: enrollmentAId, target_enrollment_record_id: enrollmentId, course_record_id: courseId, course_revision: 1 });
  const report = suindaRecordKinds.community_report;
  assert.equal(await report.authorizeTransition!("open", "dismissed", reportPayload(enrollmentAId), moderatorContext("teacher-a")), true);
  assert.equal(await report.authorizeTransition!("open", "dismissed", reportPayload(enrollmentBId), moderatorContext("teacher-a")), false);
  assert.equal(await report.authorizeTransition!("open", "dismissed", reportPayload(enrollmentBId), moderatorContext("unit-manager", unitBId)), true);
  assert.equal(await report.authorizeTransition!("open", "dismissed", reportPayload(enrollmentAId), moderatorContext("unit-manager", unitBId)), false);
});

test("gestor de unidade pode desfixar um tópico autorizado pelo registro do próprio tópico", async () => {
  const threadId = randomUUID();
  const calls: unknown[][] = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("kind='discussion_thread'")) return {
        id: threadId, workspace_id: randomUUID(), plugin_id: "suinda-learning", kind: "discussion_thread", state: "open",
        payload: { course_record_id: randomUUID(), course_revision: 2, enrollment_record_id: randomUUID() },
      };
      if (sql.includes("kind='community_pin'")) return null;
      return null;
    },
  };
  const service = new ExtensionRecords(db as never, { async has() { return false; } } as never,
    learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async mayModerateCommunity(...args: unknown[]) { calls.push(args); return args[5] === threadId; },
  });

  const result = await service.setCommunityThreadPinned(threadId, "unit-manager", false, { operation_key: randomUUID() });

  assert.deepEqual(result, { id: null, revision: null, pinned: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![5], threadId, "authorization uses the exact reported thread record as the unit-scoped target");
});

test("a auditoria de acessibilidade pagina todos os cursos atribuídos além do limite histórico de 200", async () => {
  const user = "teacher-a";
  const workspaceId = randomUUID();
  const records = Array.from({ length: 105 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: `Curso ${index + 1}`,
    state: "published", revision: 1, payload: { instructor_ids: [user], tutor_ids: [] },
  }));
  const db = {
    async query(sql: string, args: unknown[] = []) {
      assert.match(sql, /ORDER BY r\.id LIMIT 250/);
      assert.match(sql, /w\.archived_at IS NULL/);
      const after = String(args[0] || "");
      return records.filter((record) => record.id > after).slice(0, 250);
    },
  };
  const service = new ExtensionRecords(db as never, { async has() { return false; } } as never,
    learningRegistry(), new DocumentScanner());
  const first = await service.teachingAccessibilityAuditCourses(user, undefined, 100);
  assert.equal(first.items.length, 100);
  assert.equal(first.complete, false);
  assert.equal(first.next_cursor, records[99]!.id);
  const second = await service.teachingAccessibilityAuditCourses(user, first.next_cursor!, 100);
  assert.equal(second.items.length, 5);
  assert.equal(second.complete, true);
  assert.equal(second.next_cursor, null);
});

test("a auditoria paginada associa anexos à revisão exata da aula", async () => {
  const user = "teacher-a";
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const lessonId = randomUUID();
  const nextLessonId = randomUUID();
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso atual",
    state: "published", revision: 3, payload: { instructor_ids: [user], tutor_ids: [], version: 2 } };
  const lessons = [lessonId, nextLessonId].map((id, index) => ({ id, workspace_id: workspaceId, plugin_id: "suinda-learning",
    kind: "lesson", title: `Aula ${index + 1}`, state: "published", revision: index + 1,
    payload: { content_type: "article", body_markdown: index === 0 ? "![ ](https://example.test/sem-descricao.png)" : "[](https://example.test/material)" } }));
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async one(sql: string, args: unknown[] = []) { assert.match(sql, /kind='course'/); assert.deepEqual(args, [courseId]); return course; },
    async query(sql: string, args: unknown[] = []) {
      queries.push({ sql, args });
      if (sql.includes("JOIN extension_records m")) return lessons;
      if (sql.includes("FROM extension_record_attachments")) return [{ record_id: nextLessonId, revision: 1,
        id: randomUUID(), file_name: "imagem-legada.png", mime_type: "image/png", size_bytes: 10, scan_status: "clean", alt_text: null }];
      return [];
    },
  };
  const auditEvents: string[] = [];
  const service = new ExtensionRecords(db as never, { async has() { return false; }, async audit(_user: string, _action: string, target: string) { auditEvents.push(target); } } as never,
    learningRegistry(), new DocumentScanner());
  const result = await service.teachingAccessibilityAuditLessons(user, courseId, undefined, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]!.lesson_id, lessonId);
  assert.equal(result.items[1]!.lesson_id, nextLessonId);
  assert.equal(result.next_cursor, null);
  assert.equal(result.complete, true);
  assert.deepEqual(result.items[0]!.accessibility_gaps, [
    { code: "markdown_image_alt_missing", message: "1 imagem no texto precisa de descrição alternativa." },
  ]);
  assert.deepEqual(result.items[1]!.attachments, []);
  assert.deepEqual(result.items[1]!.accessibility_gaps, [
    { code: "markdown_link_name_missing", message: "1 link precisa de um texto que descreva seu destino." },
  ]);
  assert.deepEqual(auditEvents, [lessonId, nextLessonId]);
  const lessonQuery = queries.find((query) => query.sql.includes("JOIN extension_records m"))!;
  assert.match(lessonQuery.sql, /l\.state='published'/);
  assert.match(lessonQuery.sql, /m\.payload->>'course_revision'=\$4::text/);
  assert.match(lessonQuery.sql, /m\.payload->>'course_version'=\$5::text/);
  assert.match(lessonQuery.sql, /extension_record_versions cv/);
  const attachmentQuery = queries.find((query) => query.sql.includes("FROM extension_record_attachments"))!;
  assert.match(attachmentQuery.sql, /unnest\(\$1::uuid\[\],\$2::integer\[\]\)/);
  assert.deepEqual(attachmentQuery.args, [[lessonId, nextLessonId], [1, 2]]);
  assert.deepEqual(lessonQuery.args, [workspaceId, "00000000-0000-0000-0000-000000000000", courseId, 3, "2", 3]);
});

test("a fila de moderação pré-filtra denúncias por workspace, unidade ou atribuição antes de projetar pessoas", async () => {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const service = new ExtensionRecords({
    async query(sql: string, args: unknown[] = []) {
      queries.push({ sql, args });
      return [];
    },
  } as never, {
    async has() { return false; },
    async hasScoped() { return false; },
  } as never, learningRegistry(), new DocumentScanner());
  await service.teachingCommunityReports("moderator");
  assert.equal(queries.length, 2);
  const projection = queries[1];
  assert.match(projection.sql, /target_enrollment\.payload->>'institution_unit_record_id'/);
  assert.match(projection.sql, /LEFT JOIN extension_records target_thread/);
  assert.match(projection.sql, /target\.payload->>'enrollment_record_id'/);
  assert.doesNotMatch(projection.sql, /NULLIF\(r\.payload->>'enrollment_record_id'/);
  assert.match(projection.sql, /target_cohort\.payload->>'institution_unit_record_id'/);
  assert.match(projection.sql, /course\.payload->>'institution_unit_record_id'/);
  assert.match(projection.sql, /course\.payload->'instructor_ids' @> jsonb_build_array\(\$3::text\)/);
  assert.match(projection.sql, /r\.workspace_id=ANY\(\$1::uuid\[\]\)/);
  assert.match(projection.sql, /\$4::timestamptz IS NULL OR \(r\.created_at,r\.id\)>\(\$4::timestamptz,\$5::uuid\)/);
  assert.match(projection.sql, /ORDER BY r\.created_at,r\.id LIMIT \$6/);
  assert.deepEqual(projection.args, [[], [], "moderator", null, null, 100]);
});

test("decisão de denúncia legada usa a matrícula do conteúdo, nunca a matrícula denunciante", async () => {
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const reportId = randomUUID();
  const replyId = randomUUID();
  const reporterEnrollmentId = randomUUID();
  const targetEnrollmentId = randomUUID();
  const reporterCohortId = randomUUID();
  const targetCohortId = randomUUID();
  const actor = randomUUID();
  let selectedCohortId = "";
  const report = { id: reportId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "community_report",
    title: "Denúncia", state: "open", revision: 1,
    payload: { enrollment_record_id: reporterEnrollmentId, course_record_id: courseId, course_revision: 1,
      target_record_id: replyId, target_kind: "discussion_reply", reason: "other" } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", revision: 1,
    payload: { instructor_ids: [], tutor_ids: [] } };
  const reporterEnrollment = { id: reporterEnrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    payload: { course_record_id: courseId, course_revision: 1, cohort_record_id: reporterCohortId } };
  const targetEnrollment = { id: targetEnrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    payload: { course_record_id: courseId, course_revision: 1, cohort_record_id: targetCohortId } };
  const db = { async one(sql: string, args: unknown[] = []) {
    if (sql.includes("SELECT * FROM extension_records WHERE id=$1") && sql.includes("kind='community_report'")) return report;
    if (sql.includes("SELECT enrollment.id::text AS id")) return { id: targetEnrollmentId };
    if (sql.includes("kind='course'")) return course;
    if (sql.includes("kind='enrollment'")) return args[0] === targetEnrollmentId ? targetEnrollment : reporterEnrollment;
    if (sql.includes("kind='cohort'")) {
      selectedCohortId = String(args[0]);
      return { id: targetCohortId, payload: { instructor_user_id: "another-instructor" } };
    }
    return null;
  } };
  const service = new ExtensionRecords(db as never, {
    async has() { return false; }, async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { unitRecordAccess: { async canManageRecord() { return false; } } });

  await assert.rejects(() => service.resolveTeachingCommunityReport(actor, reportId, "dismiss", {
    operation_key: randomUUID(), expected_revision: 1, reason: "Revisão",
  }), /Denúncia não encontrada ou sem permissão/);

  assert.equal(selectedCohortId, targetCohortId);
});

test("fila de denúncias percorre páginas inacessíveis para alcançar as denúncias da unidade", async () => {
  const workspaceId = randomUUID();
  const unitId = randomUUID();
  let page = 0;
  const queries: string[] = [];
  const db = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("SELECT DISTINCT workspace_id")) return [{ workspace_id: workspaceId }];
      if (!sql.includes("JOIN extension_records target")) return [];
      page++;
      return Array.from({ length: page < 3 ? 100 : 1 }, (_, index) => {
        const number = (page - 1) * 100 + index + 1;
        return { id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "community_report",
          title: "Denúncia", state: "open", revision: 1, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString(),
          payload: { course_record_id: randomUUID(), course_revision: 1, target_enrollment_record_id: `enrollment-${number}`, target_record_id: randomUUID(), target_kind: "discussion_thread", reason: "review" },
          target_enrollment_id: `target-enrollment-${number}`, target_title: "Conteúdo", target_kind: "discussion_thread", target_state: "open", target_body: "Conteúdo denunciado", course_title: "Curso", reporter_name: "Aluno" };
      });
    },
  };
  const service = new ExtensionRecords(db as never, {
    async has(_user: string, _permission: string, scope?: string) { return scope === "workspace" ? false : false; },
    async hasScoped(_user: string, _permission: string, _type: string, scopeId: string) { return scopeId === unitId; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { unitRecordAccess: { async authorizedUnits() { return [{ id: unitId, workspace_id: workspaceId }]; } } });
  (service as unknown as { mayModerateCommunity(user: string, workspace: string, course: string, revision: number, enrollment: string): Promise<boolean> }).mayModerateCommunity =
    async (_user, _workspace, _course, _revision, enrollment) => enrollment === "target-enrollment-201";
  const reports = await service.teachingCommunityReports("unit-manager");
  assert.equal(reports.length, 1);
  assert.equal(page, 3);
  assert.ok(queries.slice(1).every((sql) => /ORDER BY r\.created_at,r\.id LIMIT \$6/.test(sql)));
});

test("fila de denúncias retorna todas as denúncias autorizadas além do antigo teto de 300", async () => {
  const workspaceId = randomUUID();
  const reports = Array.from({ length: 301 }, (_, index) => ({
    id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "community_report",
    title: `Denúncia ${index + 1}`, state: "open", revision: 1,
    created_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    payload: { course_record_id: randomUUID(), course_revision: 1, enrollment_record_id: randomUUID(), target_record_id: randomUUID(), reason: "spam" },
    target_enrollment_id: randomUUID(),
    target_title: "Conteúdo", target_kind: "discussion_thread", target_state: "open", target_body: "Texto denunciado",
    course_title: "Curso", reporter_name: "Aluno",
  }));
  const pageCursors: Array<[string | null, string | null]> = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT DISTINCT workspace_id")) return [{ workspace_id: workspaceId }];
    if (!sql.includes("JOIN extension_records target")) return [];
    const cursorAt = values[3] as string | null;
    const cursorId = values[4] as string | null;
    pageCursors.push([cursorAt, cursorId]);
    const start = cursorId ? reports.findIndex((report) => report.id === cursorId) + 1 : 0;
    return reports.slice(start, start + Number(values[5]));
  } };
  const service = new ExtensionRecords(db as never, {
    async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async mayModerateCommunity() { return true; } });

  const result = await service.teachingCommunityReports("manager");

  assert.equal(result.length, 301);
  assert.equal(result.at(-1)?.id, reports.at(-1)?.id);
  assert.equal(pageCursors.length, 4);
  assert.deepEqual(pageCursors[0], [null, null]);
  assert.deepEqual(pageCursors[3], [reports[299]!.created_at, reports[299]!.id]);
});

test("a lista docente da comunidade pagina além de 200 tópicos fora da unidade autorizada", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000708";
  const courseId = "00000000-0000-4000-8000-000000000709";
  const firstPage = Array.from({ length: 200 }, (_, index) => ({
    id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "discussion_thread",
    title: `Fora do escopo ${index}`, state: "open", revision: 1, created_at: new Date(1_700_000_000_000 - index * 1000),
    pinned: false, payload: { course_revision: 1, enrollment_record_id: randomUUID() },
  }));
  const authorizedId = randomUUID();
  const authorizedThread = { id: authorizedId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "discussion_thread",
    title: "Tópico autorizado", state: "open", revision: 1, created_at: new Date(1_600_000_000_000), pinned: false,
    payload: { course_revision: 1, enrollment_record_id: randomUUID() } };
  const pageCalls: unknown[][] = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("kind='course'")) return { id: courseId, workspace_id: workspaceId, revision: 1, payload: {} };
      return null;
    },
    async query(sql: string, args: unknown[] = []) {
      if (sql.includes("WITH thread_rows AS")) {
        pageCalls.push(args);
        return pageCalls.length === 1 ? firstPage : [authorizedThread];
      }
      return [];
    },
  };
  const service = new ExtensionRecords(db as never, { async has() { return true; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  Object.assign(service, { async mayModerateCommunity(_user: string, _workspace: string, _course: string, _revision: number,
    _enrollmentId?: string, scopedRecordId?: string) { return scopedRecordId === courseId || scopedRecordId === authorizedId; } });

  const result = await service.teachingCommunityThreads(courseId, "unit-manager");

  assert.equal(result.length, 1);
  assert.equal(result[0].id, authorizedId);
  assert.equal(pageCalls.length, 2);
  assert.equal(pageCalls[1][4], firstPage.at(-1)!.id, "the second keyset query starts after the last scanned row");
});

test("lista docente da comunidade retorna todos os tópicos autorizados além do antigo teto de 200", async () => {
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const threads = Array.from({ length: 201 }, (_, index) => ({
    id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "discussion_thread",
    title: `Tópico ${index + 1}`, state: "open", revision: 1,
    created_at: new Date(Date.UTC(2026, 0, 1) - index * 1000), pinned: false,
    payload: { course_revision: 1, enrollment_record_id: randomUUID(), thread_type: "question", body: "Pergunta" },
  }));
  const pageCursors: Array<string | null> = [];
  const db = {
    async one(sql: string) { return sql.includes("kind='course'") ? { id: courseId, workspace_id: workspaceId, revision: 1, payload: {} } : null; },
    async query(sql: string, values: unknown[] = []) {
      if (!sql.includes("WITH thread_rows AS")) return [];
      const cursorId = values[4] as string | null;
      pageCursors.push(cursorId);
      const start = cursorId ? threads.findIndex((thread) => thread.id === cursorId) + 1 : 0;
      return threads.slice(start, start + 200);
    },
  };
  const service = new ExtensionRecords(db as never, { async has() { return true; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  Object.assign(service, { async mayModerateCommunity() { return true; } });

  const result = await service.teachingCommunityThreads(courseId, "teacher");

  assert.equal(result.length, 201);
  assert.equal(result.at(-1)?.id, threads.at(-1)?.id);
  assert.deepEqual(pageCursors, [null, threads[199]!.id]);
});

test("fila de pagamentos em revisão filtra grants de gestão unitária no SQL antes do limite", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000710";
  const managedUnitId = "00000000-0000-4000-8000-000000000711";
  const readableUnitId = "00000000-0000-4000-8000-000000000712";
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db = { async query(sql: string, args: unknown[] = []) { queries.push({ sql, args }); return []; } };
  const access = {
    async has() { return false; },
    async hasScoped(_user: string, permission: string, _scope: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeId === managedUnitId;
    },
    async audit() {},
  };
  const unitAccess = { async authorizedUnits() { return [
    { workspace_id: workspaceId, id: managedUnitId }, { workspace_id: workspaceId, id: readableUnitId },
  ]; } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, unitAccess as never);

  await service.paymentReviewQueue(workspaceId, "unit-manager");

  assert.equal(queries.length, 1);
  const query = queries[0]!;
  assert.match(query.sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
  assert.match(query.sql, /ANY\(\$3::text\[\]\)/);
  assert.ok(query.sql.indexOf("ANY($3::text[])") < query.sql.indexOf("LIMIT 100"));
  assert.deepEqual(query.args, [workspaceId, false, [managedUnitId], null, null]);
});

test("fila de pagamentos confirma grants unitários em lotes limitados", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000713";
  const units = Array.from({ length: 201 }, (_, index) => ({
    workspace_id: workspaceId,
    id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
  }));
  let inFlight = 0;
  let peakInFlight = 0;
  let checked = 0;
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db = { async query(sql: string, args: unknown[] = []) { queries.push({ sql, args }); return []; } };
  const access = {
    async has() { return false; },
    async hasScoped() {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      checked += 1;
      inFlight -= 1;
      return true;
    },
    async audit() {},
  };
  const unitAccess = { async authorizedUnits() { return units; } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, unitAccess as never);

  await service.paymentReviewQueue(workspaceId, "unit-manager");

  assert.equal(checked, units.length);
  assert.ok(peakInFlight <= 100, `expected at most 100 checks in flight, got ${peakInFlight}`);
  assert.equal(queries[0]?.args[2] && (queries[0].args[2] as string[]).length, units.length);
});

test("fila de pagamentos em revisão percorre todas as páginas sem perder o escopo da unidade", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000720";
  const managedUnitId = "00000000-0000-4000-8000-000000000721";
  const rows = Array.from({ length: 101 }, (_, index) => ({
    checkout_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    enrollment_title: `Matrícula ${index + 1}`, learner_name: `Aluno ${index + 1}`, amount: 50,
    currency: "BRL", provider_status: "approved", review_reason: "ambiguous", provider_payment_id: `payment-${index + 1}`,
    created_at: "2026-10-24T00:00:00.000Z", updated_at: "2026-10-24T00:00:00.000Z",
  }));
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db = { async query(sql: string, args: unknown[] = []) {
    queries.push({ sql, args });
    const cursorId = args[4] ? String(args[4]) : null;
    const start = cursorId ? rows.findIndex((row) => row.checkout_id === cursorId) + 1 : 0;
    return rows.slice(start, start + 100);
  } };
  const access = {
    async has() { return false; },
    async hasScoped(_user: string, permission: string, _scope: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeId === managedUnitId;
    },
    async audit() {},
  };
  const unitAccess = { async authorizedUnits() { return [{ workspace_id: workspaceId, id: managedUnitId }]; } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, unitAccess as never);

  const result = await service.paymentReviewQueue(workspaceId, "unit-manager");

  assert.equal(result.items.length, 101);
  assert.equal(result.items.at(-1)?.checkout_id, rows.at(-1)?.checkout_id);
  assert.equal("updated_at" in result.items[0]!, false, "internal keyset fields do not change the public response");
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /ANY\(\$3::text\[\]\)/);
    assert.ok(query.sql.indexOf("ANY($3::text[])") < query.sql.indexOf("LIMIT 100"));
  }
  assert.deepEqual(queries[0]!.args, [workspaceId, false, [managedUnitId], null, null]);
  assert.deepEqual(queries[1]!.args, [workspaceId, false, [managedUnitId], rows[99]!.updated_at, rows[99]!.checkout_id]);
});

test("filas administrativas de estorno e cancelamento usam cursor composto até o último registro", async () => {
  const workspaceId = randomUUID();
  const records: Array<Record<string, unknown>> = [];
  for (let index = 1; index <= 51; index++) {
    const candidateId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    records.push({
    enrollment_id: candidateId, enrollment_revision: 2, enrollment_title: `Matrícula ${index}`, learner_name: `Aluno ${index}`,
    course_title: "Curso", payment_entry_id: candidateId, payment_amount: 100, amount_refunded: 0, amount_refundable: 100,
    amount_remaining: 100, amount_covered: 0, course_price: 100, currency: "BRL",
    enrollment_updated_at: "2030-01-01T12:00:00.000Z", payment_created_at: "2030-01-02T12:00:00.000Z",
    queue_created_at: "2030-01-02T12:00:00.123456Z",
  }); }
  const paymentRows = records.map((record, index) => ({ id: record.enrollment_id, revision: 1, title: `Matrícula ${index + 1}`,
    created_at: "2030-01-02T12:00:00.123Z", queue_created_at: "2030-01-02T12:00:00.123456Z", payload: { submitted_at: "2030-01-02T12:00:00Z", payment_status: "pending" },
    learner_name: record.learner_name, course_title: record.course_title, course_price: 100, currency: "BRL", amount_covered: 0,
    installment_count: 1, first_due_days: 0, interval_days: 30, agreement_amount: null, agreement_currency: null,
    agreement_installments: null, agreement_covered_amount: null }));
  const audits: string[] = [];
  const service = new ExtensionRecords({
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceId }];
      if (sql.includes("AS queue_created_at")) {
        assert.match(sql, /e\.workspace_id=ANY\(\$1::uuid\[\]\)/);
        assert.match(sql, /ORDER BY e\.created_at,e\.id LIMIT \$6/);
        const after = String(values[4] || "");
        return paymentRows.filter((record) => !after || String(record.id) > after);
      }
      if (sql.includes("AS payment_created_at")) {
        assert.match(sql, /e\.workspace_id=ANY\(\$1::uuid\[\]\)/);
        assert.match(sql, /e\.state='withdrawn'/);
        assert.match(sql, /ORDER BY e\.updated_at DESC,p\.created_at,p\.id LIMIT \$7/);
        const after = String(values[5] || "");
        return records.filter((record) => !after || String(record.payment_entry_id) > after).map((record) => ({ ...record }));
      }
      if (sql.includes("AS enrollment_updated_at") && sql.includes("price.amount>COALESCE")) {
        assert.match(sql, /e\.workspace_id=ANY\(\$1::uuid\[\]\)/);
        assert.match(sql, /e\.state='withdrawn'/);
        assert.match(sql, /ORDER BY e\.updated_at DESC,e\.id LIMIT \$6/);
        const after = String(values[4] || "");
        return records.filter((record) => !after || String(record.enrollment_id) > after).map((record) => ({ ...record }));
      }
      return [];
    },
  } as never, {
    async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; },
    async audit(_user: string, _action: string, target: string) { audits.push(target); },
  } as never, learningRegistry(), new DocumentScanner());

  for (const queue of ["payment", "refund", "cancellation"] as const) {
    const first = await service.teachingFinancialActionQueue("manager", queue, undefined, 50);
    assert.equal(first.items.length, 50);
    assert.ok(first.next_cursor);
    const second = await service.teachingFinancialActionQueue("manager", queue, first.next_cursor!, 50).catch((error: unknown) => {
      throw new Error(`${queue} next page failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    assert.equal(second.items.length, 1);
    assert.equal(second.next_cursor, null);
  }
  assert.equal(audits.length, 153);
  await assert.rejects(service.teachingFinancialActionQueue("manager", "refund", "not-a-cursor", 50), /Cursor inválido/);
});

test("fila administrativa de candidaturas a bolsas percorre páginas mantendo prioridade e auditoria", async () => {
  const workspaceId = randomUUID();
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, revision: 1, workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "scholarship_application", title: `Candidatura ${index + 1}`,
    state: "submitted", created_at: "2030-01-01T00:00:00.123Z", queue_created_at: "2030-01-01T00:00:00.123456Z",
    score_sort: "10", learner_name: `Aluno ${index + 1}`, program_title: "Programa", course_title: "Curso",
    payload: { score: 10, discount_percent: 50, document_uploads: [] },
  }));
  const audits: string[] = [];
  const service = new ExtensionRecords({ async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceId }];
    if (sql.includes("AS queue_created_at")) {
      assert.match(sql, /CASE a\.state WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END/);
      assert.match(sql, /ORDER BY CASE a\.state[\s\S]*COALESCE\(NULLIF\(a\.payload->>'score'/);
      const after = String(values[6] || "");
      return rows.filter((record) => !after || record.id > after);
    }
    return [];
  } } as never, {
    async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; },
    async audit(_user: string, _action: string, target: string) { audits.push(target); },
  } as never, learningRegistry(), new DocumentScanner());

  const first = await service.teachingScholarshipApplications("manager", undefined, 50);
  assert.equal(first.items.length, 50);
  assert.ok(first.next_cursor);
  const second = await service.teachingScholarshipApplications("manager", first.next_cursor!, 50);
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0]?.id, rows.at(-1)?.id);
  assert.equal(second.next_cursor, null);
  assert.equal(audits.length, 51);
  await assert.rejects(service.teachingScholarshipApplications("manager", "bad-cursor", 50), /Cursor inválido/);
});

test("programa de bolsa aceita rubrica com schema editável e recusa máximo diferente de 1000", async () => {
  const schema = suindaRecordKinds.scholarship.schema as { properties?: Record<string, unknown> };
  const rubricSchema = schema.properties?.scoring_criteria as { items?: { properties?: Record<string, unknown> } };
  assert.ok(rubricSchema.items?.properties?.max_points, "o editor genérico recebe propriedades estruturadas para cada critério");
  const validate = suindaRecordKinds.scholarship.validate!;
  const valid = await validate({ scoring_method: "weighted_v1", scoring_criteria: [
    { id: "income", label: "Renda familiar", max_points: 600 },
    { id: "dependents", label: "Pessoas dependentes", max_points: 400 },
  ] }, {} as never);
  assert.deepEqual(valid, []);
  const invalid = await validate({ scoring_method: "weighted_v1", scoring_criteria: [{ id: "income", label: "Renda familiar", max_points: 900 }] }, {} as never);
  assert.match(invalid[0]?.message || "", /exatamente 1000/);
  const empty = await validate({ scoring_method: "weighted_v1", scoring_criteria: [] }, {} as never);
  assert.match(empty[0]?.message || "", /ao menos um critério/);
  const legacy = await validate({ scoring_method: "manual", scoring_criteria: [{ criterion: "Critério antigo", weight: 100 }] }, {} as never);
  assert.deepEqual(legacy, [], "programas com critérios JSON legados continuam no fluxo manual");
});

test("análise de bolsa calcula a soma no servidor e recusa total fornecido pelo cliente", async () => {
  const workspaceId = randomUUID(); const applicationId = randomUUID();
  const rubric = [
    { id: "income", label: "Renda familiar", max_points: 600 },
    { id: "dependents", label: "Pessoas dependentes", max_points: 400 },
  ];
  const db = { async one() { return { workspace_id: workspaceId, learner_user_id: "learner", enrollment_id: randomUUID(),
    payload: { scoring_criteria_snapshot: rubric } }; } };
  const service = new ExtensionRecords(db as never, { async has() { return true; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  const mutationInputs: Record<string, unknown>[] = [];
  Object.assign(service, {
    async canManageWorkspaceOrUnitRecord() { return true; },
    async mutation(_plugin: string, _workspace: string, _actor: string, _operation: unknown, input: Record<string, unknown>) {
      mutationInputs.push(input);
      return { application_id: applicationId, revision: 2, state: "under_review", waitlist_position: null, scholarship_credit: null };
    },
  });
  await assert.rejects(service.reviewScholarshipApplication(applicationId, "manager", {
    operation_key: randomUUID(), action: "review", score: 999,
    criterion_scores: [{ criterion_id: "income", score: 500 }, { criterion_id: "dependents", score: 300 }],
  }), /calculada pelo servidor/);
  await assert.rejects(service.reviewScholarshipApplication(applicationId, "manager", {
    operation_key: randomUUID(), action: "approve",
    criterion_scores: [{ criterion_id: "income", score: 500 }, { criterion_id: "dependents", score: 300 }],
  }), /Informe o motivo/);
  await assert.rejects(service.reviewScholarshipApplication(applicationId, "manager", {
    operation_key: randomUUID(), action: "reject",
    criterion_scores: [{ criterion_id: "income", score: 500 }, { criterion_id: "dependents", score: 300 }], reason: "  ",
  }), /Informe o motivo/);
  assert.equal(mutationInputs.length, 0, "a tentativa de fornecer o total é recusada antes da mutação");
  await service.reviewScholarshipApplication(applicationId, "manager", {
    operation_key: randomUUID(), action: "review",
    criterion_scores: [{ criterion_id: "income", score: 500 }, { criterion_id: "dependents", score: 300 }],
  });
  assert.equal(mutationInputs[0]?.score, 800);
  assert.deepEqual(mutationInputs[0]?.criterion_scores, [
    { criterion_id: "income", score: 500 }, { criterion_id: "dependents", score: 300 },
  ]);
});

test("candidatura a bolsa bloqueia comprovantes quando o scanner não confirma conteúdo limpo", async () => {
  const db = { async one() { return { workspace_id: randomUUID(), payload: { course_record_id: randomUUID() } }; } };
  const scanner = { async scan() { return "not_configured" as const; } };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), scanner as never);
  Object.assign(service, { async mutation() { assert.fail("scanner não configurado não pode iniciar a candidatura"); } });
  await assert.rejects(service.createScholarshipApplication(randomUUID(), randomUUID(), {
    operation_key: randomUUID(), program_record_id: randomUUID(), accept_terms: true, signature_name: "Estudante",
    documents: [{ category: "income", file_name: "renda.pdf", mime_type: "application/pdf", data_base64: Buffer.from("%PDF-1.7 renda").toString("base64") }],
  }), /Configure um scanner de documentos/);
});

test("filas financeiras respeitam o par exato workspace/unidade e revalidam grants por página", async () => {
  const workspaceA = randomUUID(); const workspaceB = randomUUID(); const unitA = randomUUID(); const unitB = randomUUID();
  const seen: Array<{ sql: string; values: unknown[] }> = [];
  const service = new ExtensionRecords({ async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceA }, { id: workspaceB }];
    if (sql.includes("unnest($2::uuid[],$3::text[])")) {
      seen.push({ sql, values });
      assert.match(sql, /unit_scope\.workspace_id=e\.workspace_id/);
      assert.match(sql, /unit_scope\.unit_id=COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id',''\),\s*NULLIF\(co\.payload->>'institution_unit_record_id',''\),NULLIF\(c\.payload->>'institution_unit_record_id',''\)\)/);
      assert.deepEqual(values[1], [workspaceA]);
      assert.deepEqual(values[2], [unitA]);
      return [];
    }
    return [];
  } } as never, {
    async has() { return false; }, async hasScoped(_user: string, _permission: string, _type: string, unitId: string) { return unitId === unitA; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { unitRecordAccess: { async authorizedUnits() { return [
    { workspace_id: workspaceA, id: unitA }, { workspace_id: workspaceB, id: unitB },
  ]; } } });

  for (const queue of ["payment", "refund", "cancellation"] as const) {
    const result = await service.teachingFinancialActionQueue("unit-manager", queue, undefined, 50);
    assert.deepEqual(result.items, []);
  }
  assert.equal(seen.length, 3);
  await service.teachingFinancialActionQueue("unit-manager", "payment", undefined, 50, [workspaceA]);
  assert.equal(seen.length, 4, "dashboard loading scopes the unit-only view without enumerating global workspaces");

  let grantActive = true; let financialQueries = 0;
  const pagedService = new ExtensionRecords({ async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceA }];
    if (sql.includes("AS queue_created_at")) {
      financialQueries++;
      assert.deepEqual(values[1], [workspaceA]); assert.deepEqual(values[2], [unitA]);
      const candidates = [1, 2].map((index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        workspace_id: workspaceA, revision: 1, title: `Matrícula ${index}`, created_at: "2030-01-01T00:00:00.123Z",
        queue_created_at: "2030-01-01T00:00:00.123456Z", payload: { payment_status: "pending" },
        learner_name: `Aluno ${index}`, course_title: "Curso", course_price: 100, currency: "BRL", amount_covered: 0,
        installment_count: 1, first_due_days: 0, interval_days: 30, agreement_amount: null, agreement_currency: null,
        agreement_installments: null, agreement_covered_amount: null }));
      return candidates;
    }
    return [];
  } } as never, {
    async has() { return false; }, async hasScoped() { return grantActive; }, async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  Object.assign(pagedService, { unitRecordAccess: { async authorizedUnits() { return [{ workspace_id: workspaceA, id: unitA }]; } } });
  const firstPage = await pagedService.teachingFinancialActionQueue("unit-manager", "payment", undefined, 1);
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.next_cursor);
  grantActive = false;
  await assert.rejects(pagedService.teachingFinancialActionQueue("unit-manager", "payment", firstPage.next_cursor!, 1), /gestão acadêmica/);
  assert.equal(financialQueries, 1, "the next page rechecks current unit authority before querying records");
});

test("filas de bolsa de gestores de unidade usam a unidade efetiva da matrícula e isolamento workspace/unidade", async () => {
  const workspaceA = randomUUID(); const workspaceB = randomUUID(); const unitA = randomUUID(); const unitB = randomUUID();
  const seen: Array<{ sql: string; values: unknown[] }> = [];
  const service = new ExtensionRecords({ async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) throw new Error("unit-only pagination should not enumerate managed workspaces");
    if (sql.includes("unnest($2::uuid[],$3::text[])")) {
      seen.push({ sql, values });
      assert.deepEqual(values[1], [workspaceA]); assert.deepEqual(values[2], [unitA]);
      assert.match(sql, /unit_scope\.workspace_id=(?:a|r)\.workspace_id/);
      assert.match(sql, /unit_scope\.unit_id=COALESCE\([\s\S]*institution_unit_record_id[\s\S]*institution_unit_record_id[\s\S]*institution_unit_record_id/);
      return [];
    }
    return [];
  } } as never, {
    async has() { return false; }, async hasScoped(_user: string, _permission: string, _type: string, unitId: string) { return unitId === unitA; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { unitRecordAccess: { async authorizedUnits() { return [
    { workspace_id: workspaceA, id: unitA }, { workspace_id: workspaceB, id: unitB },
  ]; } } });
  const applications = await service.teachingScholarshipApplications("unit-manager", undefined, 50, [workspaceA]);
  const counterparties = await service.teachingScholarshipCounterparties("unit-manager", undefined, 50, [workspaceA]);
  assert.deepEqual(applications.items, []); assert.deepEqual(counterparties.items, []);
  assert.equal(seen.length, 2);
});

test("conciliação Mercado Pago aborta se o grant da unidade for revogado sob lock", async () => {
  const workspaceId = randomUUID();
  const checkoutId = randomUUID();
  const enrollmentId = randomUUID();
  const learnerId = randomUUID();
  const header = { id: checkoutId, workspace_id: workspaceId, enrollment_id: enrollmentId, learner_user_id: learnerId,
    amount: "100.00", currency: "BRL", preference_id: null, provider_payment_id: "123456789", status: "review_required",
    provider_status: "approved", review_reason: "approved_after_cancellation" };
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula", state: "withdrawn", revision: 2, payload: { learner_user_id: learnerId } };
  let unitChecks = 0;
  const statements: string[] = [];
  const db = { async one(sql: string) { return sql.includes("suinda_payment_checkouts") ? header : null; } };
  const client = { async query(sql: string) {
    statements.push(sql);
    if (sql.includes("suinda_payment_checkouts") && sql.includes("FOR UPDATE")) return { rows: [header] };
    if (sql.includes("kind='enrollment' FOR UPDATE")) return { rows: [enrollmentRecord] };
    return { rows: [] };
  } };
  const service = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    unitRecordAccess: { async canManageRecord() { unitChecks++; return unitChecks === 1; } },
    async mercadoPagoConnection() { return { credentials: { access_token: "provider-token" } }; },
    async mutation(...args: unknown[]) { return (args[5] as (tx: unknown) => Promise<unknown>)(client); },
  });
  const previousFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ id: header.provider_payment_id, status: "approved",
    external_reference: checkoutId, transaction_amount: 100, currency_id: "BRL" }),
  { status: 200, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(service.reconcileMercadoPagoCheckout(workspaceId, checkoutId, "unit-manager", {
      operation_key: randomUUID(), resolution: "record_payment", notes: "Conferido com o extrato bancário.",
    }), /revogada antes da conciliação/);
  } finally { global.fetch = previousFetch; }
  assert.equal(unitChecks, 2);
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO extension_records")), false);
  assert.equal(statements.some((sql) => sql.includes("UPDATE suinda_payment_checkouts")), false);
});

test("unidades institucionais são workspace-scoped e matrícula herda unidade própria da turma", async () => {
  const unitId = "00000000-0000-4000-8000-000000000501";
  const otherUnitId = "00000000-0000-4000-8000-000000000502";
  const invalidUnitId = "00000000-0000-4000-8000-000000000504";
  const courseId = "00000000-0000-4000-8000-000000000503";
  const unit = suindaRecordKinds.institution_unit;
  const course = suindaRecordKinds.course;
  const cohort = suindaRecordKinds.cohort;
  const enrollmentKind = suindaRecordKinds.enrollment;
  assert.ok(unit && course && cohort);
  assert.equal((course.schema.properties as Record<string, { recordKind?: string }>).institution_unit_record_id.recordKind, "institution_unit");
  assert.equal((cohort.schema.properties as Record<string, { recordKind?: string }>).institution_unit_record_id.recordKind, "institution_unit");

  const ctx = {
    resolveLatestRecord: async (recordId: string) => recordId === unitId
      ? { id: unitId, pluginId: "suinda-learning", kind: "institution_unit", state: "published", payload: {} }
      : recordId === otherUnitId
        ? { id: otherUnitId, pluginId: "suinda-learning", kind: "institution_unit", state: "published", payload: {} }
        : recordId === cohortId
          ? { id: cohortId, pluginId: "suinda-learning", kind: "cohort", state: "enrolling", payload: { course_record_id: courseId, institution_unit_record_id: otherUnitId } }
      : recordId === courseId
        ? { id: courseId, pluginId: "suinda-learning", kind: "course", state: "enrollment_open", payload: { institution_unit_record_id: unitId } }
        : null,
    resolveRecord: async () => ({ id: courseId, pluginId: "suinda-learning", kind: "course", state: "published", payload: {} }),
    listLatestRecords: async () => [],
  } as unknown as RecordValidationContext;
  const validCourse = { ...course.example, institution_unit_record_id: unitId };
  assert.equal((await course.validate!(validCourse, ctx)).some((issue) => issue.code === "institution_unit.invalid"), false);
  const invalidUnit = await course.validate!({ ...validCourse, institution_unit_record_id: invalidUnitId }, ctx);
  assert.ok(invalidUnit.some((issue) => issue.code === "institution_unit.invalid" && issue.path === "institution_unit_record_id"));
  const courseAssignmentContext = { ...ctx, recordId: courseId,
    resolveLatestRecord: async (recordId: string) => recordId === courseId
      ? { id: courseId, pluginId: "suinda-learning", kind: "course", state: "published", payload: { institution_unit_record_id: unitId } }
      : ctx.resolveLatestRecord?.(recordId) ?? null,
  } as unknown as RecordValidationContext;
  const unassignedCourse = await course.validate!({ ...course.example, institution_unit_record_id: otherUnitId }, courseAssignmentContext);
  assert.ok(!unassignedCourse.some((issue) => issue.code === "institution_unit.assignment_frozen"));
  const assignedCourse = await course.validate!({ ...course.example, institution_unit_record_id: otherUnitId }, {
    ...courseAssignmentContext, listLatestRecords: async () => [{ id: cohortId, pluginId: "suinda-learning", kind: "enrollment", state: "active", revision: 1, payload: {} }],
  } as unknown as RecordValidationContext);
  assert.ok(assignedCourse.some((issue) => issue.code === "institution_unit.assignment_frozen"));

  const validCohort = { ...cohort.example, course_record_id: courseId, course_revision: 1, institution_unit_record_id: otherUnitId };
  const unitSpecificCohort = await cohort.validate!(validCohort, ctx);
  assert.ok(!unitSpecificCohort.some((issue) => issue.code === "institution_unit.invalid"));

  const enrollmentPayload = { ...enrollmentKind.example, course_record_id: courseId, cohort_record_id: cohortId };
  const defaults = await enrollmentKind.defaultsForCreate!(enrollmentPayload, ctx);
  assert.equal(defaults.institution_unit_record_id, otherUnitId);
  const mismatchedEnrollment = await enrollmentKind.validate!({ ...enrollmentPayload, institution_unit_record_id: unitId }, ctx);
  assert.ok(mismatchedEnrollment.some((issue) => issue.code === "enrollment.institution_unit_mismatch"), JSON.stringify(mismatchedEnrollment));
  const validEnrollment = await enrollmentKind.validate!({ ...enrollmentPayload, institution_unit_record_id: otherUnitId }, ctx);
  assert.equal(validEnrollment.some((issue) => issue.code === "enrollment.institution_unit_mismatch"), false);
});

test("perfil acadêmico declara os campos pessoais para proteção em repouso", () => {
  assert.deepEqual(suindaRecordKinds.learner_profile.sensitiveFields, [
    "phone", "date_of_birth", "institution", "study_program", "academic_background",
    "emergency_contact_name", "emergency_contact_phone", "custom_fields",
  ]);
  assert.equal(suindaRecordKinds.learner_profile.personalOwnerField, "learner_user_id");
});

test("biblioteca acadêmica inclui documentos de consulta e mantém a exigência de assinatura explícita", async () => {
  const enrollmentId = "00000000-0000-4000-8000-000000000401";
  const workspaceId = "00000000-0000-4000-8000-000000000402";
  const learnerId = "00000000-0000-4000-8000-000000000403";
  const courseId = "00000000-0000-4000-8000-000000000404";
  const signingTermId = "00000000-0000-4000-8000-000000000405";
  const readOnlyTermId = "00000000-0000-4000-8000-000000000406";
  const courseTermId = "00000000-0000-4000-8000-000000000407";
  const wrongCourseRevisionTermId = "00000000-0000-4000-8000-000000000408";
  const wrongCohortTermId = "00000000-0000-4000-8000-000000000409";
  const unpublishedTermId = "00000000-0000-4000-8000-000000000410";
  const otherWorkspaceTermId = "00000000-0000-4000-8000-000000000411";
  const cohortId = "00000000-0000-4000-8000-000000000412";
  const otherWorkspaceId = "00000000-0000-4000-8000-000000000413";
  const enrollmentRecord = {
    id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula", state: "active", revision: 1,
    payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 2, cohort_record_id: cohortId, cohort_revision: 5 },
  };
  const terms = [
    { id: signingTermId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "academic_term", title: "Contrato", state: "published", revision: 3, term_title: "Contrato", term_revision: 3,
      payload: { signing_required: true, audience_type: "workspace", document_type: "contract", terms_version: "3.0", terms_body: "Contrato publicado" } },
    { id: readOnlyTermId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "academic_term", title: "Regulamento", state: "published", revision: 1, term_title: "Regulamento", term_revision: 1,
      payload: { signing_required: false, audience_type: "workspace", document_type: "regulation", terms_version: "1.0", terms_body: "Regulamento publicado" } },
    { id: courseTermId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "academic_term", title: "Plano do curso", state: "published", revision: 2, term_title: "Plano do curso", term_revision: 2,
      payload: { signing_required: false, audience_type: "course", course_record_id: courseId, course_revision: 2, document_type: "other", terms_version: "2.0", terms_body: "Conteúdo específico da revisão 2" } },
    { id: wrongCourseRevisionTermId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "academic_term", title: "Plano antigo", state: "published", revision: 1, term_title: "Plano antigo", term_revision: 1,
      payload: { signing_required: false, audience_type: "course", course_record_id: courseId, course_revision: 1, document_type: "other", terms_version: "1.0", terms_body: "Não aplicável" } },
    { id: wrongCohortTermId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "academic_term", title: "Outra turma", state: "published", revision: 1, term_title: "Outra turma", term_revision: 1,
      payload: { signing_required: false, audience_type: "cohort", cohort_record_id: "00000000-0000-4000-8000-000000000414", cohort_revision: 5, document_type: "other", terms_version: "1.0", terms_body: "Não aplicável" } },
    { id: unpublishedTermId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "academic_term", title: "Rascunho", state: "draft", revision: 1, term_title: "Rascunho", term_revision: 1,
      payload: { signing_required: false, audience_type: "workspace", document_type: "other", terms_version: "draft", terms_body: "Não aplicável" } },
    { id: otherWorkspaceTermId, workspace_id: otherWorkspaceId, plugin_id: "suinda-learning", kind: "academic_term", title: "Outro workspace", state: "published", revision: 1, term_title: "Outro workspace", term_revision: 1,
      payload: { signing_required: false, audience_type: "workspace", document_type: "other", terms_version: "1.0", terms_body: "Não aplicável" } },
  ];
  const statements: string[] = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM extension_records e JOIN workspaces")) return enrollmentRecord;
      if (sql.includes("FROM extension_record_versions v JOIN extension_records c")) return { payload: { required_document_categories: [] } };
      if (sql.includes("FROM users")) return { name: "Estudante" };
      return null;
    },
    async query(sql: string, values?: unknown[]) {
      statements.push(sql);
      if (sql.includes("kind='academic_term'")) {
        const [workspace, selectedCourse, courseRevision, selectedCohort, cohortRevision] = values as string[];
        return terms.filter((term) => term.workspace_id === workspace && term.state === "published"
          && (term.payload.audience_type === "workspace"
            || term.payload.audience_type === "course" && term.payload.course_record_id === selectedCourse && String(term.payload.course_revision) === courseRevision
            || term.payload.audience_type === "cohort" && term.payload.cohort_record_id === selectedCohort && String(term.payload.cohort_revision) === cohortRevision));
      }
      if (sql.includes("kind='academic_signature'")) return [];
      return [];
    },
  };
  const service = new ExtensionRecords(db as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner());
  const result = await service.learnerAcademicSignatures(enrollmentId, learnerId);
  assert.deepEqual(result.terms.map((term) => [term.id, term.signing_required, term.signed]), [
    [signingTermId, true, false], [readOnlyTermId, false, false], [courseTermId, false, false],
  ]);
  assert.match(statements[0], /v\.state='published'/);
  assert.doesNotMatch(statements[0], /signing_required/);
  const library = await service.learnerDocuments(enrollmentId, learnerId);
  assert.deepEqual(library.academic_documents.map((term) => term.id), [signingTermId, readOnlyTermId, courseTermId]);
  assert.equal(library.academic_documents.find((term) => term.id === readOnlyTermId)?.signing_required, false);
  assert.match(statements.find((sql) => sql.includes("kind='academic_term'")) || "", /r\.state='published'/);
  assert.match(statements.find((sql) => sql.includes("kind='academic_term'")) || "", /v\.payload->>'course_revision'=\$3/);
  assert.match(statements.find((sql) => sql.includes("kind='academic_term'")) || "", /v\.payload->>'cohort_revision'=\$5/);
  assert.ok(!library.academic_documents.some((term) => [wrongCourseRevisionTermId, wrongCohortTermId, unpublishedTermId, otherWorkspaceTermId].includes(term.id)));
});

test("o histórico de assinaturas acadêmicas não trunca após 500 registros", async () => {
  const enrollmentId = randomUUID();
  const workspaceId = randomUUID();
  const learnerId = randomUUID();
  const signatures = Array.from({ length: 501 }, (_, index) => ({
    id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "academic_signature",
    title: `Termo ${index + 1}`, state: "signed", revision: 1,
    payload: { term_record_id: randomUUID(), term_revision: 1, signer_name: "Estudante" },
  }));
  let signaturesSql = "";
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM extension_records e JOIN workspaces")) return {
        id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
        title: "Matrícula", state: "active", revision: 1,
        payload: { learner_user_id: learnerId, course_record_id: randomUUID(), course_revision: 1 },
      };
      if (sql.includes("FROM users")) return { name: "Estudante" };
      return null;
    },
    async query(sql: string) {
      if (sql.includes("kind='academic_signature'")) { signaturesSql = sql; return signatures; }
      return [];
    },
  };
  const service = new ExtensionRecords(db as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner());

  const result = await service.learnerAcademicSignatures(enrollmentId, learnerId);

  assert.equal(result.history.length, 501);
  assert.doesNotMatch(signaturesSql, /\bLIMIT\s+500\b/i);
});

test("biblioteca acadêmica rejeita matrícula em estado não permitido e arquivo fora do escopo publicado", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000421";
  const enrollmentId = "00000000-0000-4000-8000-000000000422";
  const workspaceId = "00000000-0000-4000-8000-000000000423";
  const db = { async one(sql: string) {
    if (sql.includes("FROM extension_records e JOIN workspaces")) return null;
    return null;
  }, async query() { return []; } };
  const service = new ExtensionRecords(db as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner());
  await assert.rejects(service.learnerDocuments(enrollmentId, learnerId), /Matrícula não encontrada ou indisponível/);
  await assert.rejects(service.learnerAcademicDocumentAttachment(enrollmentId, "00000000-0000-4000-8000-000000000424", 1,
    "00000000-0000-4000-8000-000000000425", learnerId), /Matrícula não encontrada ou indisponível/);

  const allowedEnrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1,
    payload: { learner_user_id: learnerId, course_record_id: "00000000-0000-4000-8000-000000000426", course_revision: 1 } };
  const scopedDb = {
    async one(sql: string) { return sql.includes("FROM extension_records e JOIN workspaces") ? allowedEnrollment : null; },
    async query() { return []; },
  };
  const scopedService = new ExtensionRecords(scopedDb as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner());
  await assert.rejects(scopedService.learnerAcademicDocumentAttachment(enrollmentId, "00000000-0000-4000-8000-000000000427", 1,
    "00000000-0000-4000-8000-000000000428", learnerId), /Documento acadêmico publicado não encontrado/);
});

test("download da biblioteca autentica a matrícula, verifica hash e revalida o scanner", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000431";
  const enrollmentId = "00000000-0000-4000-8000-000000000432";
  const workspaceId = "00000000-0000-4000-8000-000000000433";
  const courseId = "00000000-0000-4000-8000-000000000434";
  const termId = "00000000-0000-4000-8000-000000000435";
  const attachmentId = "00000000-0000-4000-8000-000000000436";
  const data = Buffer.from("%PDF-1.7 conteúdo acadêmico publicado");
  const sha256 = createHash("sha256").update(data).digest("hex");
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1,
    payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 2 } };
  const term = { id: termId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "academic_term", title: "Regulamento", state: "published", revision: 4,
    term_title: "Regulamento", term_revision: 4, payload: { audience_type: "workspace", terms_body: "Texto", terms_version: "4.0" } };
  let attachment = { data, sha256, file_name: "regulamento.pdf", mime_type: "application/pdf", scan_status: "clean" };
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM extension_records e JOIN workspaces")) return enrollmentRecord;
      if (sql.includes("SELECT data,sha256,file_name,mime_type,scan_status")) return attachment;
      return null;
    },
    async query(sql: string) { return sql.includes("kind='academic_term'") ? [term] : []; },
  };
  const actions: string[] = [];
  const scanner = { async scan() { actions.push("scan"); return "clean" as const; } };
  const service = new ExtensionRecords(db as never, { async audit(_user: string, action: string) { actions.push(action); } } as never,
    learningRegistry(), scanner as never);
  const downloaded = await service.learnerAcademicDocumentAttachment(enrollmentId, termId, 4, attachmentId, learnerId);
  assert.deepEqual(downloaded.data, data);
  assert.deepEqual(actions, ["scan", "suinda-learning.academic-document.attachment.read"]);
  attachment = { ...attachment, sha256: "0".repeat(64) };
  await assert.rejects(service.learnerAcademicDocumentAttachment(enrollmentId, termId, 4, attachmentId, learnerId), /falha de integridade/);
});

test("anexos acadêmicos privados declaram cifra em repouso no armazenamento compartilhado do Orbit", () => {
  for (const kind of ["staff_credential", "learner_document", "attendance_justification", "lesson", "submission", "scholarship_application", "scholarship_counterparty"] as const)
    assert.equal(suindaRecordKinds[kind].sensitiveAttachments, true, kind);
});

test("download autorizado abre o anexo protegido e rejeita metadados adulterados", async () => {
  const recordId = "00000000-0000-4000-8000-000000000301";
  const workspaceId = "00000000-0000-4000-8000-000000000302";
  const attachmentId = "00000000-0000-4000-8000-000000000303";
  const userId = "00000000-0000-4000-8000-000000000304";
  const original = Buffer.from("conteúdo acadêmico reservado");
  const sha256 = createHash("sha256").update(original).digest("hex");
  const record = { id: recordId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "staff_credential", title: "Diploma", state: "submitted", revision: 1,
    payload: { staff_user_id: userId } };
  const previousKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  process.env.ORBIT_DATA_ENCRYPTION_KEY = "suinda-download-test-key-with-adequate-entropy";
  const file = { data: sealProtectedAttachment(original, { pluginId: "suinda-learning", kind: "staff_credential", recordId, revision: 1,
    attachmentId, fileName: "diploma.pdf", mimeType: "application/pdf", sha256 }), sha256, file_name: "diploma.pdf", mime_type: "application/pdf" };
  const db = { async one(sql: string) {
    if (sql.includes("SELECT * FROM extension_records")) return record;
    if (sql.includes("SELECT id FROM workspaces")) return { id: workspaceId };
    if (sql.includes("SELECT state,payload FROM extension_record_versions")) return { state: "submitted", payload: record.payload };
    if (sql.includes("SELECT data,sha256,file_name,mime_type FROM extension_record_attachments")) return file;
    return null;
  } };
  const audited: string[] = [];
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit(_user: string, action: string) { audited.push(action); } } as never,
    learningRegistry(), new DocumentScanner());
  try {
    const opened = await records.downloadRecordAttachment("suinda-learning", recordId, 1, attachmentId, userId);
    assert.deepEqual(opened.data, original);
    assert.deepEqual(audited, ["suinda-learning.attachment.read"]);
    file.file_name = "adulterado.pdf";
    await assert.rejects(records.downloadRecordAttachment("suinda-learning", recordId, 1, attachmentId, userId), /Conteúdo protegido indisponível/);
  } finally {
    if (previousKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = previousKey;
  }
});

test("competências e habilidades são campos versionados em todos os níveis do currículo", () => {
  for (const kind of ["course", "module", "learning_unit", "lesson"] as const) {
    const properties = suindaRecordKinds[kind].schema.properties as Record<string, { maxItems?: number }>;
    assert.equal(properties.competencies.maxItems, 100, `${kind}.competencies`);
    assert.equal(properties.skills.maxItems, 100, `${kind}.skills`);
  }
  const publicCourseFields = (suindaRecordKinds.course as unknown as { publicRead: { fields: string[] } }).publicRead.fields;
  assert.ok(publicCourseFields.includes("competencies"));
  assert.ok(publicCourseFields.includes("skills"));
});

test("contrapartidas de bolsas são versionadas, privadas por titular e revisáveis apenas pela gestão", async () => {
  const kind = suindaRecordKinds.scholarship_counterparty;
  const owner = { async hasWorkspacePermission() { return false; }, async hasGlobalPermission() { return false; } };
  const manager = { async hasWorkspacePermission(permission: string) { return permission === "plugin.suinda-learning.manage"; } };
  const globalManager = { async hasWorkspacePermission() { return false; }, async hasGlobalPermission(permission: string) { return permission === "plugin.suinda-learning.manage"; } };
  const payload = { learner_user_id: "learner-1", requirement_text: "Exigência literal", requirement_key: "a".repeat(64) };
  assert.equal(kind.serverCreated, true);
  assert.deepEqual(kind.immutablePayloadFieldsAfterInitial, ["requirement_key", "scholarship_application_id", "program_record_id", "program_revision", "enrollment_record_id", "learner_user_id", "requirement_text"]);
  assert.equal((kind.schema.properties as Record<string, { maxLength?: number }>).requirement_text.maxLength, 2000);
  const scholarshipFields = suindaRecordKinds.scholarship.schema.properties as Record<string, { maxItems?: number; items?: { maxLength?: number } }>;
  assert.equal(scholarshipFields.counterparty_requirements.maxItems, 50);
  assert.equal(scholarshipFields.counterparty_requirements.items?.maxLength, 2000);
  assert.equal(await kind.authorizeCreate!("learner-1", payload, owner as never), false);
  assert.equal(await kind.authorizeRecord!("learner-1", "read", "pending", payload, owner as never), true);
  assert.equal(await kind.authorizeRecord!("other", "read", "pending", payload, owner as never), false);
  assert.equal(await kind.authorizeRecord!("manager", "read", "submitted", payload, manager as never), true);
  assert.equal(await kind.authorizeRecord!("global-manager", "read", "submitted", payload, globalManager as never), true);
  assert.equal(await kind.authorizeAttachment!("other", "read", "submitted", payload, owner as never), false);
  assert.equal(await kind.authorizeAttachment!("learner-1", "read", "submitted", payload, owner as never), true);
  assert.equal(await kind.authorizeAttachment!("manager", "read", "submitted", payload, manager as never), true);
  assert.deepEqual(kind.transitions?.pending, ["submitted"]);
  assert.deepEqual(kind.transitions?.submitted, ["accepted", "revision_requested"]);
  assert.deepEqual(kind.transitions?.accepted, []);
  const workspace = "00000000-0000-4000-8000-000000000411";
  const counterparty = "00000000-0000-4000-8000-000000000412";
  const financialQueue = "/extensions/suinda-learning/me/teaching/financial-action-queue";
  const scholarshipQueue = "/extensions/suinda-learning/me/teaching/scholarship-applications";
  const scholarshipCounterpartyQueue = "/extensions/suinda-learning/me/teaching/scholarship-counterparties";
  const unitAssessmentQueue = "/extensions/suinda-learning/me/teaching/unit-operations/assessment";
  const unitDocumentQueue = "/extensions/suinda-learning/me/teaching/unit-operations/document";
  const unitRiskQueue = "/extensions/suinda-learning/me/teaching/unit-operations/risk";
  const unitCapacityQueue = "/extensions/suinda-learning/me/teaching/unit-operations/capacity";
  const adminOperationsQueue = "/extensions/suinda-learning/me/teaching/admin/operations";
  const routes = [
    `/extensions/suinda-learning/me/scholarship-counterparties`,
    `/extensions/suinda-learning/me/scholarship-counterparties/${counterparty}/submission`,
    `/extensions/suinda-learning/me/teaching/scholarship-counterparties/${counterparty}/review`,
    `/extensions/suinda-learning/scholarship-counterparties/${counterparty}/files/${counterparty}`,
  ];
  assert.equal(suindaPlugin.handlesRoute?.(routes[0]), true);
  assert.equal(suindaPlugin.handlesRoute?.(routes[1]), true);
  assert.equal(suindaPlugin.handlesRoute?.(routes[2]), true);
  assert.equal(suindaPlugin.handlesRoute?.(routes[3]), true);
  assert.equal(suindaPlugin.handlesRoute?.(financialQueue), true);
  assert.equal(suindaPlugin.handlesRoute?.(scholarshipQueue), true);
  assert.equal(suindaPlugin.handlesRoute?.(scholarshipCounterpartyQueue), true);
  assert.equal(suindaPlugin.handlesRoute?.(unitAssessmentQueue), true);
  assert.equal(suindaPlugin.handlesRoute?.(unitDocumentQueue), true);
  assert.equal(suindaPlugin.handlesRoute?.(unitRiskQueue), true);
  assert.equal(suindaPlugin.handlesRoute?.(unitCapacityQueue), true);
  assert.equal(suindaPlugin.routePermission?.(unitCapacityQueue, "GET"), null);
  assert.equal(suindaPlugin.handlesRoute?.(adminOperationsQueue), true);
  assert.equal(suindaPlugin.routePermission?.(routes[2], "POST"), "plugin.suinda-learning.manage");
  assert.equal(suindaPlugin.routePermission?.(routes[1], "POST"), "plugin.suinda-learning.read");
  assert.equal(suindaPlugin.routePermission?.(routes[0], "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(routes[3], "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(financialQueue, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(scholarshipQueue, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(scholarshipCounterpartyQueue, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(unitAssessmentQueue, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(unitDocumentQueue, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(unitRiskQueue, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(adminOperationsQueue, "GET"), null);
  assert.equal(suindaPlugin.handlesRoute?.(`${routes[1]}/extra`), false);
  assert.equal(suindaPlugin.handlesRoute?.(`/extensions/suinda-learning/workspaces/${workspace}/scholarship-counterparties`), false);
});

test("complementos preservam anexos anteriores dentro dos limites do pacote de evidências", () => {
  const file = (index: number, size = 1024) => ({ attachment_id: `file-${index}`, file_name: `${index}.pdf`, mime_type: "application/pdf", size_bytes: size, sha256: "a".repeat(64), scan_status: "clean" });
  assert.deepEqual(mergeScholarshipCounterpartyEvidenceFiles([file(1)], [file(2)]), [file(1), file(2)]);
  assert.equal(mergeScholarshipCounterpartyEvidenceFiles(Array.from({ length: 10 }, (_, index) => file(index)), [file(11)]), null);
  assert.equal(mergeScholarshipCounterpartyEvidenceFiles([file(1, 8 * 1024 * 1024)], [file(2)]), null);
});

test("configuração institucional é única por workspace e restrita à gestão", async () => {
  const settings = suindaRecordKinds.institution_settings;
  const managerContext = { async hasWorkspacePermission(permission: string) { return permission === "plugin.suinda-learning.manage"; } };
  const learnerContext = { async hasWorkspacePermission() { return false; } };
  assert.deepEqual(settings.uniqueFields, ["settings_key"]);
  assert.deepEqual(settings.immutablePayloadFieldsAfterInitial, ["settings_key"]);
  assert.equal(await settings.authorizeCreate!("manager", { settings_key: "institution" }, managerContext as never), true);
  assert.equal(await settings.authorizeCreate!("learner", { settings_key: "institution" }, learnerContext as never), false);
  assert.equal(await settings.authorizeRecord!("learner", "read", "published", { settings_key: "institution" }, learnerContext as never), false);
  assert.ok("default_attendance_min_percent" in (settings.schema.properties as Record<string, unknown>));
  assert.ok("default_currency" in (settings.schema.properties as Record<string, unknown>));
});

test("novos cursos recebem padrões institucionais publicados sem impedir sobreposições do curso", async () => {
  const course = suindaRecordKinds.course;
  const settings = { default_attendance_min_percent: 82, default_certificate_min_grade: 65, default_currency: "USD",
    default_installment_count: 4, default_first_payment_due_days: 10, default_installment_interval_days: 21 };
  let query: unknown[] = [];
  const context = { async listLatestRecords(...args: unknown[]) { query = args; return [{ payload: settings }]; } };
  const defaults = await course.defaultsForCreate!({}, context as never);
  assert.deepEqual(query, ["suinda-learning", "institution_settings", { settings_key: "institution" }, "published", 1]);
  assert.deepEqual(defaults, { attendance_min_percent: 82, certificate_min_grade: 65, currency: "USD", installment_count: 4, first_payment_due_days: 10, installment_interval_days: 21 });
  const submitted = { currency: "BRL", installment_count: 2 };
  assert.deepEqual({ ...defaults, ...submitted }, { ...defaults, currency: "BRL", installment_count: 2 });
  const noSettings = await course.defaultsForCreate!({}, { async listLatestRecords() { return []; } } as never);
  assert.deepEqual(noSettings, {});
});

test("marcos de certificado são explícitos e as aulas devem pertencer à versão configurada do curso", async () => {
  const course = suindaRecordKinds.course;
  const milestoneSchema = (course.schema.properties as Record<string, { items?: { properties?: Record<string, { title?: string; items?: { recordKind?: string } }> } }>).intermediate_certificate_milestones;
  assert.equal(milestoneSchema.items?.properties?.milestone_key?.title, "Identificador do marco");
  assert.equal(milestoneSchema.items?.properties?.milestone_title?.title, "Nome do marco");
  assert.equal(milestoneSchema.items?.properties?.required_lesson_ids?.items?.recordKind, "lesson");
  const courseId = "00000000-0000-4000-8000-000000000101";
  const moduleId = "00000000-0000-4000-8000-000000000102";
  const lessonId = "00000000-0000-4000-8000-000000000103";
  const payload = { version: 3, workload_mode: "manual", workload_hours: 10, intermediate_certificate_milestones: [
    { milestone_key: "fundamentos", milestone_title: "Fundamentos", required_lesson_ids: [lessonId] },
  ] };
  const context = { recordId: courseId, async resolveLatestRecord(id: string) {
    if (id === lessonId) return { id, pluginId: "suinda-learning", kind: "lesson", state: "published", revision: 1, payload: { module_record_id: moduleId } };
    if (id === moduleId) return { id, pluginId: "suinda-learning", kind: "module", state: "published", revision: 1, payload: { course_record_id: courseId, course_version: 3 } };
    return null;
  } };
  assert.deepEqual(await course.validate!(payload, context as never), []);
  const duplicate = { ...payload, intermediate_certificate_milestones: [payload.intermediate_certificate_milestones[0], payload.intermediate_certificate_milestones[0]] };
  assert.ok((await course.validate!(duplicate, context as never)).some((issue) => issue.code === "course.intermediate_certificate_key_invalid"));
  const mismatch = { ...context, async resolveLatestRecord(id: string) {
    if (id === moduleId) return { id, pluginId: "suinda-learning", kind: "module", state: "published", revision: 1, payload: { course_record_id: courseId, course_version: 2 } };
    return context.resolveLatestRecord(id);
  } };
  assert.ok((await course.validate!(payload, mismatch as never)).some((issue) => issue.code === "course.intermediate_certificate_lesson_course_mismatch"));
});

test("credenciais profissionais são privadas para titular/gestão e funções acadêmicas têm campos próprios", async () => {
  const credential = suindaRecordKinds.staff_credential;
  const payload = { staff_user_id: "staff-owner", category: "license", file_name: "registro.pdf", mime_type: "application/pdf",
    size_bytes: 10, sha256: "a".repeat(64), scan_status: "clean" };
  const context = (manager: boolean) => ({ async hasWorkspacePermission(permission: string) { return manager && permission === "plugin.suinda-learning.manage"; } });
  assert.equal(await credential.authorizeRecord!("staff-owner", "read", "submitted", payload, context(false) as never), true);
  assert.equal(await credential.authorizeAttachment!("staff-owner", "read", "submitted", payload, context(false) as never), true);
  assert.equal(await credential.authorizeRecord!("other", "read", "submitted", payload, context(false) as never), false);
  assert.equal(await credential.authorizeAttachment!("other", "read", "submitted", payload, context(false) as never), false);
  assert.equal(await credential.authorizeAttachment!("manager", "read", "submitted", payload, context(true) as never), true);
  assert.ok("staff_role" in (suindaRecordKinds.staff_profile.schema.properties as Record<string, unknown>));
  assert.ok("recurring_availability" in (suindaRecordKinds.staff_profile.schema.properties as Record<string, unknown>));
  assert.ok("preceptor_ids" in (suindaRecordKinds.cohort.schema.properties as Record<string, unknown>));
  assert.ok("coordinator_ids" in (suindaRecordKinds.cohort.schema.properties as Record<string, unknown>));
});

test("rotas de equipe profissional são declaradas e lançamento de honorários exige gestão", () => {
  const workspace = "00000000-0000-4000-8000-000000000301";
  const credential = "00000000-0000-4000-8000-000000000302";
  const attachment = "00000000-0000-4000-8000-000000000303";
  const honorarium = "00000000-0000-4000-8000-000000000304";
  const routes = [
    `/extensions/suinda-learning/workspaces/${workspace}/staff-credentials`,
    `/extensions/suinda-learning/workspaces/${workspace}/staff-directory`,
    `/extensions/suinda-learning/workspaces/${workspace}/me/staff-credentials`,
    `/extensions/suinda-learning/staff-credentials/${credential}/files/${attachment}`,
    `/extensions/suinda-learning/workspaces/${workspace}/staff-honoraria`,
    `/extensions/suinda-learning/workspaces/${workspace}/staff-honoraria/${honorarium}/payments`,
  ];
  for (const route of routes) assert.equal(suindaPlugin.handlesRoute?.(route), true, route);
  assert.equal(suindaPlugin.routePermission?.(routes[0], "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(routes[2], "POST"), null);
  assert.equal(suindaPlugin.routePermission?.(routes[3], "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(routes[4], "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(routes[4], "POST"), "plugin.suinda-learning.manage");
  assert.equal(suindaPlugin.routePermission?.(routes[5], "POST"), "plugin.suinda-learning.manage");
  assert.equal(suindaPlugin.handlesRoute?.(`/extensions/suinda-learning/workspaces/${workspace}/staff-honoraria/not-an-id`), false);
  assert.equal(suindaPlugin.handlesRoute?.(`/extensions/suinda-learning/workspaces/${workspace}/staff-honoraria/${honorarium}/payments/extra`), false);
});

test("rotas de equipe por unidade são tratadas pelo serviço com autorização contextual", () => {
  const workspace = "00000000-0000-4000-8000-000000000304";
  const unit = "00000000-0000-4000-8000-000000000305";
  const member = "00000000-0000-4000-8000-000000000306";
  const base = `/extensions/suinda-learning/workspaces/${workspace}/units/${unit}/team`;
  for (const route of [base, `${base}/${member}`]) assert.equal(suindaPlugin.handlesRoute?.(route), true, route);
  assert.equal(suindaPlugin.routePermission?.(base, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(base, "POST"), null);
  assert.equal(suindaPlugin.routePermission?.(`${base}/${member}`, "DELETE"), null);
  assert.equal(suindaPlugin.handlesRoute?.(`${base}/invalid`), false);
});

test("diretório de equipe restringe consulta sem gestão, não consulta e-mail e audita a leitura", async () => {
  const userId = "00000000-0000-4000-8000-000000000311";
  const workspaceId = "00000000-0000-4000-8000-000000000312";
  let directorySql = "";
  let directoryArgs: unknown[] = [];
  const audited: unknown[][] = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM extension_records r JOIN workspaces")) return { id: "assigned-course" };
      return null;
    },
    async query(sql: string, values: unknown[] = []) {
      directorySql = sql;
      directoryArgs = values;
      return [{ staff_user_id: userId, staff_name: "Docente", roles: ["instructor"] }];
    },
  };
  const access = { async has() { return false; }, async audit(...args: unknown[]) { audited.push(args); } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  assert.deepEqual(await service.staffDirectory(workspaceId, userId), [
    { staff_user_id: userId, staff_name: "Docente", roles: ["instructor"] },
  ]);
  assert.deepEqual(directoryArgs, [workspaceId, false, userId, []]);
  assert.match(directorySql, /WHERE \$2::boolean OR staff_user_id=\$3 OR unit_id=ANY\(\$4::text\[\]\)/);
  assert.match(directorySql, /COALESCE\(NULLIF\(co\.payload->>'institution_unit_record_id',''\),NULLIF\(c\.payload->>'institution_unit_record_id',''\)\)/);
  assert.match(directorySql, /u\.name AS staff_name/);
  assert.doesNotMatch(directorySql, /u\.email/);
  assert.deepEqual(audited, [[userId, "suinda-learning.staff-directory.read", workspaceId, { type: "workspace", id: workspaceId }]]);
});

test("download de credencial exige gestão de todas as unidades efetivas da pessoa", async () => {
  const userId = "00000000-0000-4000-8000-000000000321";
  const workspaceId = "00000000-0000-4000-8000-000000000322";
  const credentialId = "00000000-0000-4000-8000-000000000323";
  const unitA = "00000000-0000-4000-8000-000000000324";
  const unitB = "00000000-0000-4000-8000-000000000325";
  const record = { id: credentialId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "staff_credential", title: "Diploma",
    state: "submitted", revision: 1, payload: { staff_user_id: "00000000-0000-4000-8000-000000000326" } };
  const makeService = (managedUnits: string[]) => {
    let attachmentRead = false;
    const db = {
      async one(sql: string) {
        if (sql.includes("kind='staff_credential'")) return record;
        if (sql.includes("FROM extension_records r JOIN workspaces")) return { id: "assigned-course" };
        if (sql.includes("SELECT file_name,mime_type,data")) { attachmentRead = true; return { file_name: "diploma.pdf", mime_type: "application/pdf", data: Buffer.from("pdf") }; }
        return null;
      },
      async query(sql: string) {
        if (sql.includes("WITH assignments AS")) return [{ unit_id: unitA }, { unit_id: unitB }];
        return [];
      },
    };
    const access = { async has() { return false; }, async hasScoped(_user: string, _permission: string, _type: string, scope: string) { return managedUnits.includes(scope); }, async audit() {} };
    const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
    Object.defineProperty(service, "unitRecordAccess", { value: { async authorizedUnits() { return managedUnits.map((id) => ({ id, workspace_id: workspaceId })); } } });
    return { service, wasAttachmentRead: () => attachmentRead };
  };
  const partial = makeService([unitA]);
  await assert.rejects(() => partial.service.staffCredentialFile(credentialId, "00000000-0000-4000-8000-000000000327", userId), /Credencial não encontrada/);
  assert.equal(partial.wasAttachmentRead(), false, "the file bytes are not loaded before every-unit authorization succeeds");
  const complete = makeService([unitA, unitB]);
  assert.deepEqual(await complete.service.staffCredentialFile(credentialId, "00000000-0000-4000-8000-000000000327", userId), {
    file_name: "diploma.pdf", mime_type: "application/pdf", data: Buffer.from("pdf"),
  });
});

test("honorários gravam a unidade efetiva e exigem grant de gestão antes de inserir", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000341";
  const userId = "00000000-0000-4000-8000-000000000342";
  const staffUserId = "00000000-0000-4000-8000-000000000343";
  const unitId = "00000000-0000-4000-8000-000000000344";
  const makeService = (granted: boolean, revokeBeforeGrantLock = false) => {
    let insertArgs: unknown[] | null = null;
    let grantActive = granted;
    const db = {
      async one(sql: string) {
        if (sql.includes("FROM extension_records r JOIN workspaces")) return { id: "assigned-course" };
        if (sql.includes("kind='institution_unit'")) return { id: unitId };
        return null;
      },
      async query(sql: string) {
        if (sql.includes("WITH assignments AS")) return [{ unit_id: unitId }];
        return [];
      },
      pool: { async connect() { return {
        async query(sql: string, values: unknown[] = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          if (sql.includes("FROM extension_records WHERE id=$1") && sql.includes("FOR SHARE")) return { rows: [{ id: unitId }] };
          if (sql.includes("FROM access_grants g JOIN access_roles role")) {
            if (revokeBeforeGrantLock) grantActive = false;
            return { rows: grantActive ? [{ role_id: "unit-manager" }] : [] };
          }
          if (sql.includes("INSERT INTO suinda_staff_honorarium_ledger")) { insertArgs = values; return { rows: [{ id: values[0] }] }; }
          throw new Error(`Unexpected SQL in honorarium creation spec: ${sql}`);
        }, release() {},
      }; } },
    };
    const access = { async has() { return false; }, async hasScoped() { return grantActive; }, async audit() {} };
    const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
    Object.assign(service, { unitRecordAccess: { async authorizedUnits() { return [{ id: unitId, workspace_id: workspaceId }]; } } });
    return { service, inserted: () => insertArgs };
  };
  const payload = { operation_key: "00000000-0000-4000-8000-000000000345", staff_user_id: staffUserId,
    institution_unit_record_id: unitId, period_start: "2026-10-01", period_end: "2026-10-31", amount: 500,
    currency: "BRL", description: "Aulas ministradas" };
  const authorized = makeService(true);
  const created = await authorized.service.createStaffHonorarium(workspaceId, userId, payload);
  assert.equal(created.institution_unit_record_id, unitId);
  assert.equal(authorized.inserted()?.[2], unitId);
  const denied = makeService(false);
  await assert.rejects(() => denied.service.createStaffHonorarium(workspaceId, userId, { ...payload, operation_key: "00000000-0000-4000-8000-000000000346" }), /Gestão da unidade não autorizada/);
  assert.equal(denied.inserted(), null);
  const revoked = makeService(true, true);
  await assert.rejects(() => revoked.service.createStaffHonorarium(workspaceId, userId, { ...payload, operation_key: "00000000-0000-4000-8000-000000000347" }), /Gestão da unidade não autorizada/);
  assert.equal(revoked.inserted(), null, "revocation before the transactional grant lock prevents the ledger insert");
});

test("lista de honorários limita a projeção ao grant de unidade e deixa o legado sem unidade fora do recorte", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000347";
  const userId = "00000000-0000-4000-8000-000000000348";
  const unitId = "00000000-0000-4000-8000-000000000349";
  let listSql = "";
  let listArgs: unknown[] = [];
  const db = {
    async one(sql: string) { return sql.includes("FROM extension_records r JOIN workspaces") ? { id: "assigned-course" } : null; },
    async query(sql: string, args: unknown[] = []) { listSql = sql; listArgs = args; return []; },
  };
  const access = { async has() { return false; }, async hasScoped(_user: string, _permission: string, _scope: string, id: string) { return id === unitId; }, async audit() {} };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { unitRecordAccess: { async authorizedUnits() { return [{ id: unitId, workspace_id: workspaceId }]; } } });
  assert.deepEqual(await service.staffHonoraria(workspaceId, userId), []);
  assert.deepEqual(listArgs, [workspaceId, false, userId, [unitId]]);
  assert.match(listSql, /cardinality\(\$4::uuid\[\]\)>0 AND h\.institution_unit_record_id=ANY\(\$4::uuid\[\]\)/);
  assert.doesNotMatch(listSql, /h\.staff_user_id=\$3::uuid OR h\.institution_unit_record_id/);
});

test("metas semanais pessoais mantêm o padrão e perfis antigos, usando atividades validadas", () => {
  assert.deepEqual(normalizeWeeklyLearningGoal({}, {}), { metric: "study_days", target: 3 });
  assert.deepEqual(normalizeWeeklyLearningGoal({ weekly_learning_goal_days: 5 }, {}), { metric: "study_days", target: 5 });
  assert.deepEqual(normalizeWeeklyLearningGoal({}, { weekly_learning_goal_days: 4 }), { metric: "study_days", target: 4 });
  assert.deepEqual(normalizeWeeklyLearningGoal({}, { weekly_learning_goal_metric: "lessons", weekly_learning_goal_target: 6 }), { metric: "lessons", target: 6 });
  assert.deepEqual(normalizeWeeklyLearningGoal({ weekly_learning_goal_metric: "practice_hours", weekly_learning_goal_target: 1.5 }, {}), { metric: "practice_hours", target: 1.5 });
  assert.deepEqual(normalizeWeeklyLearningGoal({ weekly_learning_goal_metric: "practice_hours", weekly_learning_goal_target: 1.3 }, {}), { metric: "practice_hours", target: 2 });

  const activities = [
    { activity_day: "2030-01-01", activity_metric: "lessons", activity_value: 1 },
    { activity_day: "2030-01-01", activity_metric: "lessons", activity_value: 1 },
    { activity_day: "2030-01-02", activity_metric: "attendance", activity_value: 1 },
    { activity_day: "2030-01-03", activity_metric: "practice_hours", activity_value: 1.5 },
    { activity_day: "2030-01-04", activity_metric: "practice_hours", activity_value: 2 },
    { activity_day: "2029-12-31", activity_metric: "lessons", activity_value: 1 },
  ];
  assert.deepEqual(calculateWeeklyLearningGoal("study_days", activities, "2030-01-01", "2030-01-07", 3),
    { metric: "study_days", activeDays: 4, current: 4, target: 3, unit: "dias ativos", percent: 100 });
  assert.equal(calculateWeeklyLearningGoal("lessons", activities, "2030-01-01", "2030-01-07", 3).current, 2);
  assert.equal(calculateWeeklyLearningGoal("attendance", activities, "2030-01-01", "2030-01-07", 1).current, 1);
  assert.equal(calculateWeeklyLearningGoal("practice_hours", activities, "2030-01-01", "2030-01-07", 4).current, 3.5);
});

test("gamificação preserva a sequência de atividades após mil eventos e a posição pessoal abaixo do top 1000", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const enrollmentId = randomUUID();
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const day = (offset: number) => new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
  const activities = [
    ...Array.from({ length: 1000 }, () => ({ activity_day: day(0), activity_metric: "lessons", activity_value: 1 })),
    ...Array.from({ length: 7 }, (_, index) => ({ activity_day: day(index + 1), activity_metric: "attendance", activity_value: 1 })),
  ];
  const topPeers = Array.from({ length: 10 }, (_, index) => ({ learner_user_id: randomUUID(), learner_name: `Aluno ${index + 1}`, points: 1000 - index, rank: index + 1 }));
  const peerRows = [...topPeers, { learner_user_id: userId, learner_name: "Aluno próprio", points: 1, rank: 1501 }];
  const queries: string[] = [];
  const db = {
    async one() { return { lesson_count: 1, assessment_count: 0, submission_count: 0, attendance_count: 7, practice_hours: 0,
      weekly_goal_days: 3, weekly_goal_metric: "study_days", weekly_goal_target: 3 }; },
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("SELECT activity_day,activity_metric")) return activities;
      if (sql.includes("WITH candidates AS")) return peerRows;
      if (sql.includes("kind='learning_challenge'")) return [];
      throw new Error(`Unexpected gamification query: ${sql.slice(0, 80)}`);
    },
  };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula", state: "active", revision: 1,
    payload: { course_record_id: randomUUID(), course_revision: 1 } };
  const gamification = await (service as unknown as { learnerGamification(enrollment: typeof enrollmentRecord, user: string): Promise<{
    study_streak_days: number; ranking_position: number; leaderboard: Array<{ name: string; rank: number }>;
  }> }).learnerGamification(enrollmentRecord, userId);
  assert.equal(gamification.study_streak_days, 8);
  assert.equal(gamification.ranking_position, 1501);
  assert.equal(gamification.leaderboard.length, 11);
  assert.equal(gamification.leaderboard.at(-1)?.rank, 1501);
  const activitySql = queries.find((sql) => sql.includes("SELECT activity_day,activity_metric"))!;
  const peerSql = queries.find((sql) => sql.includes("WITH candidates AS"))!;
  assert.doesNotMatch(activitySql, /LIMIT\s+1000/i);
  assert.match(peerSql, /WHERE rank<=10 OR learner_user_id=\$4/);
});

test("horas práticas creditadas entram na carga horária sem alterar frequência ou práticas realizadas", () => {
  assert.deepEqual(calculateWorkloadProgress(45, 3.5, 2.25), {
    attended_class_hours: 0.75, validated_practice_hours: 3.5, credited_practice_hours: 2.25, completed_hours: 6.5,
  });
  assert.deepEqual(calculateWorkloadProgress(45, 3.5), {
    attended_class_hours: 0.75, validated_practice_hours: 3.5, credited_practice_hours: 0, completed_hours: 4.25,
  });
});

test("transcrição retorna notas concluídas da própria matrícula e declara a rota autenticada", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000201";
  const enrollmentId = "00000000-0000-4000-8000-000000000202";
  const result = { id: "00000000-0000-4000-8000-000000000203", enrollment_id: enrollmentId,
    course_id: "00000000-0000-4000-8000-000000000204", course_title: "Curso versionado",
    assessment_id: "00000000-0000-4000-8000-000000000205", assessment_title: "Prova 1", assessment_type: "exam",
    score: "87.5", maximum_score: "100", graded_at: "2030-02-01T12:00:00.000Z", feedback: null,
    result_type: "assessment_attempt", attempt_number: 1, submitted_at: "2030-02-01T11:00:00.000Z" };
  let gradeQuery = "";
  const service = new ExtensionRecords({ async query(sql: string, values?: unknown[]) {
    if (sql.includes("JOIN workspaces")) {
      assert.deepEqual(values, [learnerId, ["enrolled", "active", "completed"]]);
      return [{ id: enrollmentId, workspace_id: "00000000-0000-4000-8000-000000000206", plugin_id: "suinda-learning",
        kind: "enrollment", state: "active", revision: 1, payload: { learner_user_id: learnerId } }];
    }
    gradeQuery = sql;
    assert.deepEqual(values, [[enrollmentId], learnerId, ["enrolled", "active", "completed"]]);
    return [result];
  } } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async canRecord(_user: string, _plugin: string, _kind: string, recordId: string) { return recordId === enrollmentId; } });
  assert.deepEqual(await service.learnerTranscript(learnerId), { entries: [{ ...result, score: 87.5, maximum_score: 100 }] });
  assert.match(gradeQuery, /r\.state='completed' AND r\.payload->>'grading_status'='completed'/);
  assert.match(gradeQuery, /s\.state='completed'/);
  assert.match(gradeQuery, /s\.payload->'group_member_user_ids'/);
  assert.match(gradeQuery, /JOIN extension_record_versions cv/);
  assert.match(gradeQuery, /r\.workspace_id=e\.workspace_id/);
  assert.match(gradeQuery, /s\.workspace_id=e\.workspace_id/);
  const route = "/extensions/suinda-learning/me/transcript";
  assert.equal(suindaPlugin.handlesRoute?.(route), true);
  assert.equal(suindaPlugin.routePermission?.(route, "GET"), null);
});

test("transcrição percorre todas as matrículas e notas além dos antigos limites de mil e cinco mil", async () => {
  const learnerId = randomUUID();
  const enrollments = Array.from({ length: 1001 }, () => ({
    id: randomUUID(), workspace_id: randomUUID(), plugin_id: "suinda-learning", kind: "enrollment", state: "active", revision: 1,
    payload: { learner_user_id: learnerId },
  }));
  const entries = Array.from({ length: 5001 }, (_, index) => ({
    id: randomUUID(), enrollment_id: enrollments[index % enrollments.length]!.id,
    course_id: randomUUID(), course_title: "Curso", assessment_id: randomUUID(), assessment_title: "Avaliação",
    assessment_type: "exam", score: "80", maximum_score: "100", graded_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    feedback: null, result_type: "assessment_attempt" as const, attempt_number: 1, submitted_at: null,
  }));
  let enrollmentQuery = "";
  let gradeQuery = "";
  let authorized = 0;
  const service = new ExtensionRecords({ async query(sql: string, values?: unknown[]) {
    if (sql.includes("JOIN workspaces")) { enrollmentQuery = sql; return enrollments; }
    gradeQuery = sql;
    assert.equal((values?.[0] as string[]).length, 1001);
    return entries;
  } } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async canRecord(_user: string, _plugin: string, _kind: string, enrollmentId: string) {
    authorized++;
    return enrollments.some((enrollment) => enrollment.id === enrollmentId);
  } });

  const result = await service.learnerTranscript(learnerId);

  assert.equal(authorized, 1001);
  assert.equal(result.entries.length, 5001);
  assert.equal(result.entries.at(-1)?.id, entries.at(-1)?.id);
  assert.doesNotMatch(enrollmentQuery, /LIMIT\s+1000/i);
  assert.doesNotMatch(gradeQuery, /LIMIT\s+5000/i);
});

test("perfil, avisos de privacidade e comunidade de ex-alunos não truncam workspaces ou cursos", async () => {
  const learnerId = randomUUID();
  const workspaces = Array.from({ length: 101 }, (_, index) => ({ workspace_id: randomUUID(), workspace_name: `Instituição ${index}`, enrollment_count: 1 }));
  const notices = workspaces.map((workspace, index) => ({ id: randomUUID(), workspace_id: workspace.workspace_id, plugin_id: "suinda-learning",
    kind: "privacy_notice", title: `Aviso ${index}`, revision: 1, payload: {} }));
  const audits: string[] = [];
  const noticesService = new ExtensionRecords({ async query(sql: string) {
    if (sql.includes("SELECT DISTINCT e.workspace_id")) return workspaces.map(({ workspace_id }) => ({ workspace_id }));
    if (sql.includes("kind='privacy_notice'")) return notices;
    return [];
  } } as never, { async audit(_actor: string, _action: string, target: string) { audits.push(target); } } as never,
  learningRegistry(), new DocumentScanner());
  const privacyNotices = await noticesService.learnerPrivacyNotices(learnerId);
  assert.equal(privacyNotices.length, 101);
  assert.equal(privacyNotices.at(-1)?.id, notices.at(-1)?.id);
  assert.equal(audits.length, 101);

  const profileQueries: string[] = [];
  const profilesService = new ExtensionRecords({ async query(sql: string) {
    profileQueries.push(sql);
    if (sql.includes("COUNT(e.id)::int AS enrollment_count")) return workspaces;
    return [];
  } } as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner());
  const profiles = await profilesService.learnerProfiles(learnerId);
  assert.equal(profiles.length, 101);
  assert.equal(profiles.at(-1)?.workspace_id, workspaces.at(-1)?.workspace_id);
  assert.doesNotMatch(profileQueries[0] || "", /LIMIT\s+100/i);

  const workspaceId = randomUUID();
  const alumniRows = Array.from({ length: 201 }, (_, index) => ({
    id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: `Matrícula ${index}`,
    revision: 1, updated_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    payload: { learner_user_id: learnerId, course_record_id: randomUUID(), course_revision: 1 },
    course_title: `Curso ${index}`, profile_enabled: true,
  }));
  const alumniAudit: string[] = [];
  const alumniService = new ExtensionRecords({ async query(sql: string) {
    if (sql.includes("FROM extension_records p")) return [];
    if (sql.includes("cv.title AS course_title")) return alumniRows;
    return [];
  } } as never, { async audit(_actor: string, _action: string, target: string) { alumniAudit.push(target); } } as never,
  learningRegistry(), new DocumentScanner());
  const alumni = await alumniService.alumniEnrollments(learnerId);
  assert.equal(alumni.length, 201);
  assert.equal(alumni.at(-1)?.enrollment_id, alumniRows.at(-1)?.id);
  assert.equal(alumniAudit.length, 201);
});

test("portfólio do aluno inclui todas as versões de entrega para consulta e exportação", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: randomUUID(), workspace_id: randomUUID(), plugin_id: "suinda-learning", kind: "submission", title: `Entrega ${index + 1}`,
    created_by: "learner", updated_by: "learner", record_revision: 1, submission_state: "completed", workspace_name: "Instituição",
    assessment_title: `Atividade ${index + 1}`, course_title: "Curso", course_id: randomUUID(), enrollment_id: randomUUID(), due_at: null,
    payload: { submitted_at: new Date(Date.UTC(2026, 0, 1) + (500 - index) * 1000).toISOString(), version: 1, score: 90, late: false, files: [] },
  }));
  let query = "";
  const audited: string[] = [];
  const service = new ExtensionRecords({ async query(sql: string) { query = sql; return rows; } } as never,
    { async audit(_actor: string, _action: string, target: string) { audited.push(target); } } as never,
    learningRegistry(), new DocumentScanner());

  const result = await service.learnerPortfolio(randomUUID());

  assert.equal(result.length, 501);
  assert.equal(result.at(-1)?.id, rows.at(-1)?.id);
  assert.equal(audited.length, 501);
  assert.doesNotMatch(query, /LIMIT\s+500/i);
});

test("temporadas de aprendizagem abrangem cursos e desafios do mesmo workspace e respeitam o ranking opcional", async () => {
  const season = suindaRecordKinds.learning_season;
  assert.deepEqual((season.schema as { properties: Record<string, unknown> }).properties.course_record_ids, {
    type: "array", items: { type: "string", maxLength: 80, recordKind: "course" }, maxItems: 20, uniqueItems: true, minItems: 2, title: "Registros dos cursos",
  });
  assert.deepEqual(season.transitions, { draft: ["published", "archived"], published: ["closed", "archived"], closed: ["archived"], archived: [] });
  const courseA = { id: "course-a", pluginId: "suinda-learning", kind: "course", state: "published", payload: {} };
  const courseB = { id: "course-b", pluginId: "suinda-learning", kind: "course", state: "published", payload: {} };
  const courseC = { id: "course-c", pluginId: "suinda-learning", kind: "course", state: "published", payload: {} };
  const challenge = { id: "challenge-a", pluginId: "suinda-learning", kind: "learning_challenge", state: "open", payload: { course_record_id: "course-a" } };
  const payload = { description: "Temporada", opens_at: "2030-01-01T00:00:00Z", closes_at: "2030-01-31T00:00:00Z",
    course_record_ids: ["course-a", "course-b"], challenge_record_ids: ["challenge-a"] };
  const records: Record<string, typeof courseA | typeof courseC | typeof challenge> = { "course-a": courseA, "course-b": courseB, "course-c": courseC, "challenge-a": challenge };
  const context = { resolveLatestRecord: async (recordId: string) => records[recordId] || null } as never;
  assert.deepEqual(await season.validate!(payload, context), []);
  assert.ok((await season.validate!({ ...payload, course_record_ids: ["course-a"] }, context)).some((issue) => issue.code === "season.invalid_courses"));
  assert.ok((await season.validate!({ ...payload, challenge_record_ids: ["challenge-a"], course_record_ids: ["course-b", "course-c"] }, context)).some((issue) => issue.code === "season.invalid_challenges"));
  assert.ok((await season.validate!({ ...payload, closes_at: "2032-01-01T00:00:00Z" }, context)).some((issue) => issue.code === "season.invalid_window"));
  const route = "/extensions/suinda-learning/me/seasons";
  assert.equal(suindaPlugin.handlesRoute?.(route), true);
  assert.equal(suindaPlugin.routePermission?.(route, "GET"), null);
  assert.equal(((season.schema as { properties: Record<string, { items: { recordKind: string } }> }).properties.challenge_record_ids).items.recordKind, "learning_challenge");
});

test("placar sazonal mantém pontuação pessoal privada e filtra projeções sem consentimento", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000231";
  const otherId = "00000000-0000-4000-8000-000000000232";
  const workspaceId = "00000000-0000-4000-8000-000000000233";
  const enrollment = { id: "00000000-0000-4000-8000-000000000234", workspace_id: workspaceId, plugin_id: "suinda-learning",
    kind: "enrollment", state: "active", revision: 1, title: "Matrícula", payload: { learner_user_id: learnerId, course_record_id: "course-a", payment_status: "not_required" } };
  const season = { id: "00000000-0000-4000-8000-000000000235", workspace_id: workspaceId, plugin_id: "suinda-learning",
    kind: "learning_season", state: "published", revision: 1, title: "Temporada de verão", payload: {
      description: "Desafios acadêmicos", opens_at: "2030-01-01T00:00:00Z", closes_at: "2030-01-31T00:00:00Z",
      course_record_ids: ["course-a", "course-b"], challenge_record_ids: ["challenge-a"],
    } };
  let scoreSql = "";
  let queryNumber = 0;
  const service = new ExtensionRecords({ async query(sql: string) {
    queryNumber++;
    if (queryNumber === 1) return [enrollment];
    if (queryNumber === 2) return [season];
    scoreSql = sql;
    return [
      { season_id: season.id, result_type: "learner", learner_user_id: learnerId, learner_name: null, course_id: null,
        course_title: null, score: 75, visible: false, rank: null, participants: null },
      { season_id: season.id, result_type: "learner", learner_user_id: otherId, learner_name: "Pessoa optante", course_id: null,
        course_title: null, score: 50, visible: true, rank: 1, participants: null },
    ];
  } } as never, {} as never, learningRegistry(), new DocumentScanner());
  const result = await service.learnerSeasons(learnerId);
  assert.match(scoreSql, /gamification_public_enabled/);
  assert.match(scoreSql, /consent_status'='consented'/);
  assert.match(scoreSql, /score_from/);
  assert.match(scoreSql, /FROM learner_scores WHERE visible/);
  assert.match(scoreSql, /rank<=10 OR learner_user_id=\$2/);
  assert.match(scoreSql, /WHEN s\.state='closed' THEN s\.updated_at/);
  assert.deepEqual(result.seasons, [{ id: season.id, title: season.title, description: "Desafios acadêmicos", opens_at: season.payload.opens_at,
    closes_at: season.payload.closes_at, my_points: 75, my_rank: null,
    leaderboard: [{ name: "Pessoa optante", score: 50, rank: 1 }], course_standings: [] }]);
});

test("recomenda cursos públicos por afinidade curricular própria e exclui cursos já matriculados", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000221";
  const publicCourse = (id: string, title: string, payload: Record<string, unknown>, state = "enrollment_open") => ({
    id, title, workspace_name: "Instituição", state, payload,
  });
  const candidates = [
    publicCourse("already-enrolled", "Curso já em andamento", { category: "Tecnologia", tags: ["typescript"], modality: "online", level: "introductory", objectives: ["Construir sistemas seguros"] }),
    publicCourse("recommended", "Segurança de aplicações", { category: "Segurança", tags: ["typescript"], modality: "online", level: "introductory", objectives: ["Sistemas seguros para web"] }),
    publicCourse("unrelated", "Cerâmica", { category: "Artes", tags: ["cerâmica"], modality: "in_person", level: "advanced", objectives: ["Modelar argila"] }),
    publicCourse("unpublished", "Rascunho privado", { category: "Tecnologia", tags: ["typescript"] }, "draft"),
  ];
  let historySql = "";
  const service = new ExtensionRecords({ async query(sql: string, values?: unknown[]) {
    historySql = sql;
    assert.deepEqual(values, [learnerId, ["approved", "enrolled", "active", "paused", "completed"]]);
    return [
      { enrollment_state: "active", course_id: "already-enrolled", course_payload: { category: "Tecnologia", tags: ["typescript"], modality: "online", level: "introductory", objectives: ["Construir sistemas seguros"] } },
      { enrollment_state: "completed", course_id: "past-course", course_payload: { category: "Tecnologia", tags: ["typescript"], modality: "online", level: "introductory", objectives: ["Construir sistemas seguros"] } },
    ];
  } } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async publicCourses() { return candidates; } });
  const result = await service.learnerRecommendations(learnerId);
  assert.deepEqual(result.recommendations, [{ ...candidates[1], reason: "Temas e objetivos próximos aos seus estudos." }]);
  assert.match(historySql, /e\.payload->>'learner_user_id'=\$1/);
  assert.match(historySql, /e\.state=ANY\(\$2::text\[\]\)/);
  assert.match(historySql, /v\.revision=NULLIF\(e\.payload->>'course_revision',''\)::int/);
  assert.match(historySql, /w\.archived_at IS NULL/);
  const route = "/extensions/suinda-learning/me/recommendations";
  assert.equal(suindaPlugin.handlesRoute?.(route), true);
  assert.equal(suindaPlugin.routePermission?.(route, "GET"), null);
});

test("contexto de recomendações inclui apenas cursos públicos elegíveis e resume o histórico próprio sem dados pessoais", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000222";
  const courses = [
    { id: "current-course", workspace_id: "workspace-1", workspace_name: "Instituição", kind: "course", title: "Atual", state: "enrollment_open",
      payload: { summary: "Atual", category: "Ciências", tags: ["biologia"], objectives: ["Estudar células"], modality: "online", level: "introductory" } },
    { id: "paused-course", workspace_id: "workspace-1", workspace_name: "Instituição", kind: "course", title: "Pausado", state: "published", payload: { category: "Ciências" } },
    { id: "public-course", workspace_id: "workspace-2", workspace_name: "Instituição pública", kind: "course", title: "Ecologia", state: "published",
      payload: { summary: "Ecossistemas", description: "Não incluir texto extenso.", category: "Ciências", tags: ["ecologia"], objectives: ["Analisar ecossistemas"], modality: "online", format: "open", level: "intermediate" } },
    { id: "private-course", workspace_id: "workspace-2", workspace_name: "Instituição", kind: "course", title: "Rascunho", state: "draft", payload: { category: "Ciências" } },
  ];
  let query = "";
  const service = new ExtensionRecords({ async query(sql: string, values?: unknown[]) {
    query = sql;
    assert.deepEqual(values, [learnerId, ["approved", "enrolled", "active", "paused", "completed"]]);
    return [
      { enrollment_state: "active", course_id: "current-course", course_title: "Atual", course_payload: courses[0].payload },
      { enrollment_state: "paused", course_id: "paused-course", course_title: "Pausado", course_payload: courses[1].payload },
      { enrollment_state: "completed", course_id: "past-course", course_title: "Biologia", course_payload: { category: "Ciências", tags: ["biologia"], objectives: ["Estudar células"], modality: "online", level: "introductory", email: "private@example.test" } },
      { enrollment_state: "approved", course_id: "approved-course", course_title: "Aguardando", course_payload: { category: "Ciências" } },
    ];
  } } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async publicList(plugin: string, kind: string) { assert.equal(plugin, "suinda-learning"); assert.equal(kind, "course"); return courses; } });
  const context = await service.learnerRecommendationContext(learnerId);
  assert.match(query, /e\.payload->>'learner_user_id'=\$1/);
  assert.match(query, /e\.state=ANY\(\$2::text\[\]\)/);
  assert.match(query, /LIMIT 100/);
  assert.deepEqual(context.candidates.map((item) => item.id), ["public-course"]);
  assert.deepEqual(context.history, [{ title: "Atual", category: "Ciências", tags: ["biologia"], objectives: ["Estudar células"], modality: "online", level: "introductory" },
    { title: "Biologia", category: "Ciências", tags: ["biologia"], objectives: ["Estudar células"], modality: "online", level: "introductory" }]);
  assert.doesNotMatch(JSON.stringify(context.history), /private@example\.test|learnerId|enrollment_state|past-course/);
  assert.equal(context.candidates[0].payload.description, "Não incluir texto extenso.");
});

test("trilhas publicadas calculam progresso da matrícula própria e recomendam competências relacionadas", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000301";
  const workspaceId = "00000000-0000-4000-8000-000000000302";
  const completedCourseId = "00000000-0000-4000-8000-000000000303";
  const activeCourseId = "00000000-0000-4000-8000-000000000304";
  const completedEnrollmentId = "00000000-0000-4000-8000-000000000305";
  const activeEnrollmentId = "00000000-0000-4000-8000-000000000306";
  const pathId = "00000000-0000-4000-8000-000000000307";
  let progressSql = "";
  let call = 0;
  const enrollments = [
    { id: activeEnrollmentId, workspace_id: workspaceId, course_id: activeCourseId, course_revision: 1, enrollment_state: "active", course_title: "Curso atual", course_payload: { competencies: ["Planejar"] } },
    { id: completedEnrollmentId, workspace_id: workspaceId, course_id: completedCourseId, course_revision: 1, enrollment_state: "completed", course_title: "Curso anterior", course_payload: { competencies: ["Pesquisa"] } },
  ];
  const learningPath = { id: pathId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learning_path", state: "published", title: "Pesquisa e planejamento", payload: { description: "Percurso institucional", course_record_ids: [completedCourseId, activeCourseId], target_competencies: ["pesquisa", "síntese"], required_for_profiles: ["Docência"] } };
  const courses = [
    { id: completedCourseId, workspace_id: workspaceId, title: "Curso anterior", state: "completed", payload: { competencies: ["Pesquisa"] } },
    { id: activeCourseId, workspace_id: workspaceId, title: "Curso atual", state: "in_progress", payload: { competencies: ["Planejar"], skills: ["Organizar"] } },
  ];
  const service = new ExtensionRecords({ async query(sql: string) {
    call++;
    if (call === 1) return enrollments;
    if (call === 2) return [learningPath];
    if (call === 3) return [{ id: "profile-id", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_profile", revision: 1, payload: { custom_fields: { professional_profile: ["docência"] } } }];
    if (call === 4) return courses;
    if (call === 5) {
      progressSql = sql;
      return [{ enrollment_id: activeEnrollmentId, required_total: 2, required_completed: 1 }];
    }
    return [];
  } } as never, {} as never, learningRegistry(), new DocumentScanner());
  const result = await service.learnerPaths(learnerId);
  assert.match(progressSql, /p\.payload->>'learner_user_id'=e\.payload->>'learner_user_id'/);
  assert.match(progressSql, /l\.payload->>'required' IS DISTINCT FROM 'false'/);
  assert.deepEqual(result.paths, [{
    id: pathId, title: learningPath.title, description: "Percurso institucional", target_competencies: ["pesquisa", "síntese"],
    progress_percent: 75, completed_courses: 1, course_count: 2, required: true,
    recommendation_reason: "Obrigatória para o seu perfil profissional nesta instituição.",
    courses: [
      { id: completedCourseId, title: "Curso anterior", state: "completed", enrollment_id: completedEnrollmentId,
        enrollment_state: "completed", progress_percent: 100, href: `/suinda/learning/${completedEnrollmentId}`, competencies: ["Pesquisa"], skills: [] },
      { id: activeCourseId, title: "Curso atual", state: "in_progress", enrollment_id: activeEnrollmentId,
        enrollment_state: "active", progress_percent: 50, href: `/suinda/learning/${activeEnrollmentId}`, competencies: ["Planejar"], skills: ["Organizar"] },
    ],
  }]);
  const route = "/extensions/suinda-learning/me/learning-paths";
  assert.equal(suindaPlugin.handlesRoute?.(route), true);
  assert.equal(suindaPlugin.routePermission?.(route, "GET"), null);
});

test("trilhas do aluno incluem matrícula após mil e caminhos além dos antigos cortes", async () => {
  const workspaceId = randomUUID();
  const learnerId = randomUUID();
  const targetCourseId = randomUUID();
  const targetEnrollmentId = randomUUID();
  const enrollments = Array.from({ length: 1000 }, (_, index) => ({ id: randomUUID(), workspace_id: workspaceId,
    course_id: randomUUID(), course_revision: 1, enrollment_state: "active", course_title: `Histórico ${index}`, course_payload: {} }));
  enrollments.push({ id: targetEnrollmentId, workspace_id: workspaceId, course_id: targetCourseId,
    course_revision: 1, enrollment_state: "active", course_title: "Curso da última matrícula", course_payload: {} });
  const paths = Array.from({ length: 21 }, (_, index) => ({ id: randomUUID(), workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "learning_path", state: "published", title: `Trilha ${String(index + 1).padStart(2, "0")}`,
    payload: { course_record_ids: [targetCourseId], required_for_profiles: [] } }));
  let call = 0;
  const db = { async query(sql: string) {
    call++;
    if (call === 1) { assert.doesNotMatch(sql, /LIMIT\s+1000/i); return enrollments; }
    if (call === 2) { assert.doesNotMatch(sql, /LIMIT\s+200/i); return paths; }
    if (call === 3) return [];
    if (call === 4) return [{ id: targetCourseId, workspace_id: workspaceId, title: "Curso da última matrícula", state: "published", payload: {} }];
    if (call === 5) return [{ enrollment_id: targetEnrollmentId, required_total: 0, required_completed: 0 }];
    return [];
  } };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());
  const result = await service.learnerPaths(learnerId);
  assert.equal(result.paths.length, 21);
  assert.ok(result.paths.every((path) => path.courses[0]?.enrollment_id === targetEnrollmentId));
});

test("trilhas obrigatórias não aparecem fora do perfil profissional correspondente", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000312";
  const courseId = "00000000-0000-4000-8000-000000000313";
  let call = 0;
  let selectedProfiles: string[] = ["Gestão"];
  const service = new ExtensionRecords({ async query() {
    call++;
    if (call === 1) return [{ id: "enrollment", workspace_id: workspaceId, course_id: courseId, course_revision: 1, enrollment_state: "active", course_title: "Curso", course_payload: {} }];
    if (call === 2) return [{ id: "path", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learning_path", state: "published", title: "Trilha docente", payload: { required_for_profiles: ["Docência"], course_record_ids: [courseId] } }];
    if (call === 3) return [{ id: "profile", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_profile", revision: 1, payload: { custom_fields: { professional_profile: selectedProfiles } } }];
    if (call === 4) return [{ id: courseId, workspace_id: workspaceId, title: "Curso", state: "in_progress", payload: {} }];
    if (call === 5) return [{ enrollment_id: "enrollment", required_total: 1, required_completed: 0 }];
    return [];
  } } as never, {} as never, learningRegistry(), new DocumentScanner());
  assert.deepEqual(await service.learnerPaths("learner"), { paths: [], profile_selection_required: false });
  call = 0;
  selectedProfiles = [];
  assert.deepEqual(await service.learnerPaths("learner"), { paths: [], profile_selection_required: true });
});

test("recomendações ficam vazias quando a pessoa não tem histórico acadêmico", async () => {
  const service = new ExtensionRecords({ async query() { return []; } } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async publicCourses() { return [{ id: "candidate", title: "Curso aberto", workspace_name: "Instituição", state: "published", payload: { category: "Tecnologia" } }]; } });
  assert.deepEqual(await service.learnerRecommendations("learner-without-history"), { recommendations: [] });
});

test("PDF dos relatórios inclui os blocos agregados sem dados pessoais de alunos", async () => {
  const route = "/extensions/suinda-learning/me/reports.pdf";
  const ledgerRoute = "/extensions/suinda-learning/me/finance-ledger.csv";
  if (!suindaPlugin.handlesRoute) throw new Error("O plugin precisa declarar as rotas que atende.");
  assert.equal(suindaPlugin.handlesRoute(route), true);
  assert.equal(suindaPlugin.handlesRoute(ledgerRoute), true);
  if (!suindaPlugin.routePermission) throw new Error("O plugin precisa delegar a autorização desta rota ao serviço acadêmico.");
  assert.equal(suindaPlugin.routePermission(route, "GET"), null);
  assert.equal(suindaPlugin.routePermission(ledgerRoute, "GET"), null);
  const pdf = await createAcademicReportPdf({ generated_at: "2030-01-01T12:00:00.000Z", range: { from: "2030-01-01", to: "2030-01-31" }, workspace_count: 1,
    totals: { courses: 1, applications_started: 3, applications_submitted: 2, converted_enrollments: 2, enrollment_conversion_percent: 66.7, distinct_learners: 2, active_learners: 2, completed: 1, withdrawn: 0, rejected: 0,
      eligible_completions: 1, failed_completions: 0, failure_rate_percent: 0, taught_hours: 1, taught_sessions: 1, validated_practice_hours: 2,
      completion_rate_percent: 33.3, average_grade: 80, attendance_percent: 90, attended_hours: 9, scheduled_hours: 10, sessions_held: 2, certificates_issued: 1 },
    courses: [{ workspace_name: "Instituição", title: "Curso agregado", state: "in_progress", applications_started: 3, applications_submitted: 2, converted_enrollments: 2, enrollment_conversion_percent: 66.7, distinct_learners: 2, active_learners: 2,
      eligible_completions: 1, failed_completions: 0, failure_rate_percent: 0, taught_hours: 1, taught_sessions: 1, validated_practice_hours: 2,
      completed: 1, withdrawn: 0, rejected: 0, completion_rate_percent: 33.3, average_grade: 80, attendance_percent: 90, attended_hours: 9, scheduled_hours: 10, sessions_held: 2, certificates_issued: 1 }],
    monthly_trend: [{ month: "2030-01", applications_started: 3, applications_submitted: 2, completed: 1, withdrawn: 0 }], cohort_attrition: [], cohort_occupancy: [],
    teaching_workload: [], teacher_evaluations: [], most_sought_courses: [], financial_by_cohort: [], referral_origins: [], unit_summary: [], unit_financial: [], financial: { by_course: [] } });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(pdf.subarray(-6).toString(), "%%EOF\n");
});

test("configuração e fila do provedor delegam autorização financeira ao escopo do serviço", () => {
  const provider = "/extensions/suinda-learning/workspaces/11111111-1111-4111-8111-111111111111/payment-provider";
  const reviews = "/extensions/suinda-learning/workspaces/11111111-1111-4111-8111-111111111111/payment-reviews";
  const reconcile = `${reviews}/22222222-2222-4222-8222-222222222222/reconcile`;
  assert.equal(suindaPlugin.handlesRoute?.(provider), true);
  assert.equal(suindaPlugin.handlesRoute?.(reviews), true);
  assert.equal(suindaPlugin.handlesRoute?.(reconcile), true);
  assert.equal(suindaPlugin.routePermission?.(provider, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(provider, "PUT"), null);
  assert.equal(suindaPlugin.routePermission?.(reviews, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(reconcile, "POST"), null);
});

test("reposição pode ocorrer em outra turma somente no mesmo curso e revisão curricular", async () => {
  const courseId = "00000000-0000-4000-8000-000000000002";
  const sourceCohortId = "00000000-0000-4000-8000-000000000003";
  const targetCohortId = "00000000-0000-4000-8000-000000000004";
  const enrollmentRecord = { id: "enrollment", pluginId: "suinda-learning", kind: "enrollment", state: "active", revision: 1,
    payload: { learner_user_id: "learner", course_record_id: courseId, course_revision: 3, cohort_record_id: sourceCohortId } };
  const original = { id: "original", pluginId: "suinda-learning", kind: "session", state: "completed", revision: 1,
    payload: { cohort_record_id: sourceCohortId } };
  const sourceCohort = { id: sourceCohortId, pluginId: "suinda-learning", kind: "cohort", payload: { course_record_id: courseId, course_revision: 3 } };
  const targetCohort = { id: targetCohortId, pluginId: "suinda-learning", kind: "cohort", payload: { course_record_id: courseId, course_revision: 3 } };
  const replacement = { id: "replacement", pluginId: "suinda-learning", kind: "session", state: "scheduled", revision: 1,
    payload: { cohort_record_id: targetCohortId, session_type: "makeup", replacement_session_record_id: original.id } };
  const records = new Map([enrollmentRecord, original, sourceCohort, targetCohort, replacement].map((record) => [record.id, record]));
  const context = { async resolveLatestRecord(id: string) { return records.get(id) || null; } } as never;
  const payload = { enrollment_record_id: enrollmentRecord.id, learner_user_id: "learner",
    original_session_record_id: original.id, replacement_session_record_id: replacement.id };

  assert.deepEqual(await suindaRecordKinds.makeup_request.validate!(payload, context), []);
  records.set(targetCohortId, { ...targetCohort, payload: { ...targetCohort.payload, course_revision: 4 } });
  assert.ok((await suindaRecordKinds.makeup_request.validate!(payload, context)).some((issue) => issue.code === "makeup_request_session_invalid"));
});

test("a aprovação de reposição aguarda quitação da taxa configurada", async () => {
  const request = suindaRecordKinds.makeup_request;
  const context = { resolveLatestRecord: async () => null } as never;
  const pending = await request.availableTransitions!("submitted", { fee_status: "pending" }, context);
  const paid = await request.availableTransitions!("submitted", { fee_status: "paid" }, context);
  const waived = await request.availableTransitions!("submitted", { fee_status: "waived" }, context);
  assert.equal(pending.includes("approved"), false);
  assert.equal(paid.includes("approved"), true);
  assert.equal(waived.includes("approved"), true);
});

test("cupons aplicam descontos percentuais/fixos em centavos e restringem o envio pelo endpoint próprio", async () => {
  assert.deepEqual(calculateEnrollmentCouponAmounts(199.99, "percent", 15), { discount_amount: 30, amount_due: 169.99 });
  assert.deepEqual(calculateEnrollmentCouponAmounts(49.95, "fixed", 70), { discount_amount: 49.95, amount_due: 0 });
  assert.deepEqual(calculateEnrollmentCouponAmounts(49.95, "percent", 150), { discount_amount: 49.95, amount_due: 0 });
  const coupon = suindaRecordKinds.enrollment_coupon;
  assert.equal(coupon.uniqueFields?.includes("code"), true);
  const invalidPercent = await coupon.validate!({ discount_type: "percent", discount_value: 100.01 }, {} as never);
  assert.ok(invalidPercent.some((issue) => issue.code === "coupon.discount_percent.invalid"));
  const missingAgreementPartner = await coupon.validate!({ discount_context: "institutional_agreement", discount_type: "percent", discount_value: 10 }, {} as never);
  assert.ok(missingAgreementPartner.some((issue) => issue.code === "coupon.partner.required"));
  assert.ok(suindaRecordKinds.enrollment.immutablePayloadFieldsAfterInitial?.includes("discount_context_snapshot"));
  assert.ok(suindaRecordKinds.enrollment.immutablePayloadFieldsAfterInitial?.includes("discount_partner_snapshot"));
  const ownerContext = { actorId: "learner", async hasWorkspacePermission() { return false; }, async hasGlobalPermission() { return false; } } as never;
  assert.equal(await enrollment.authorizeTransition!("application_draft", "submitted", { learner_user_id: "learner" }, ownerContext), false);
});

test("agendamento de comunicados aceita canais habilitados e exige turma válida", async () => {
  const cohort = { pluginId: "suinda-learning", kind: "cohort", state: "active", payload: { instructor_ids: [], tutor_ids: [] } };
  const context = {
    actorId: "manager",
    async resolveLatestRecord(recordId: string) { return recordId === cohortId ? cohort : null; },
    async hasWorkspacePermission(permission: string) { return permission === "plugin.suinda-learning.manage"; },
    async hasGlobalPermission() { return false; },
  } as never;
  const scheduledAt = new Date(Date.now() + 60_000).toISOString();
  const email = { channel: "email", audience_type: "cohort", audience_record_id: cohortId, scheduled_at: scheduledAt };
  assert.equal(await suindaRecordKinds.announcement.authorizeTransition!("draft", "scheduled", email, context), true);
  assert.equal(await suindaRecordKinds.announcement.authorizeTransition!("draft", "sent", email, context), false);
  assert.equal(await suindaRecordKinds.announcement.authorizeTransition!("draft", "scheduled", { ...email, channel: "whatsapp" }, context), false);
  assert.equal(await suindaRecordKinds.announcement.authorizeTransition!("draft", "scheduled", { ...email, audience_record_id: "missing" }, context), false);
});

test("gestor de unidade pode importar alunos e enviar comunicados somente à turma autorizada", async () => {
  const unitManagerId = "00000000-0000-4000-8000-000000000159";
  const workspaceId = "00000000-0000-4000-8000-000000000162";
  const courseId = "00000000-0000-4000-8000-000000000163";
  const cohort = { id: cohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma da unidade", state: "enrolling", revision: 1,
    payload: { course_record_id: courseId, institution_unit_record_id: "00000000-0000-4000-8000-000000000160" } };
  const otherCohort = { ...cohort, id: "00000000-0000-4000-8000-000000000164", title: "Outra unidade", payload: { ...cohort.payload, institution_unit_record_id: "00000000-0000-4000-8000-000000000165" } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "enrollment_open", revision: 1, payload: {} };
  const service = new ExtensionRecords({ async one(sql: string, args: unknown[]) { return sql.includes("kind='cohort'") ? args[0] === otherCohort.id ? otherCohort : cohort : course; } } as never,
    { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  (service as unknown as { unitRecordAccess: { canManageRecord(user: string, recordId: string): Promise<boolean>; canReadRecord(user: string, recordId: string): Promise<boolean> } }).unitRecordAccess = {
    async canManageRecord(user, recordId) { return user === unitManagerId && recordId === cohort.id; },
    async canReadRecord(user, recordId) { return user === unitManagerId && recordId === cohort.id; },
  };
  const records = service as unknown as { enrollmentImportContext(id: string, user: string, mode?: "read" | "manage"): Promise<{ cohort: typeof cohort; course: typeof course }> };
  assert.equal((await records.enrollmentImportContext(cohort.id, unitManagerId)).cohort.id, cohort.id);
  assert.equal((await records.enrollmentImportContext(cohort.id, unitManagerId, "read")).cohort.id, cohort.id);
  await assert.rejects(records.enrollmentImportContext(otherCohort.id, unitManagerId), /gestão acadêmica ou atribuição docente/);
  await assert.rejects(records.enrollmentImportContext(cohort.id, "00000000-0000-4000-8000-000000000161"), /gestão acadêmica ou atribuição docente/);
});

test("importação CSV aborta se o grant da unidade for revogado após bloquear turma e curso", async () => {
  const managerId = randomUUID();
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const cohort = { id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma",
    state: "enrolling", revision: 1, payload: { course_record_id: courseId, course_revision: 1, capacity: 10 } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso",
    state: "enrollment_open", revision: 1, payload: { format: "cohort", instructor_ids: [] } };
  let unitChecks = 0;
  let inserts = 0;
  const db = { async one(sql: string) { return sql.includes("kind='cohort'") ? cohort : course; } };
  const access = { async has() { return false; }, async audit() {} };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  const client = { async query(sql: string) {
    if (sql.includes("kind='cohort' FOR UPDATE")) return { rows: [cohort] };
    if (sql.includes("kind='course' FOR SHARE")) return { rows: [course] };
    if (sql.includes("INSERT INTO extension_records")) inserts++;
    return { rows: [] };
  } };
  Object.assign(service, {
    unitRecordAccess: { async canManageRecord() { unitChecks++; return unitChecks === 1; } },
    async mutation(...args: unknown[]) { return (args[5] as (tx: unknown) => Promise<unknown>)(client); },
  });

  await assert.rejects(service.importEnrollmentCsv(cohort.id, managerId, {
    operation_key: randomUUID(), csv: "email,nome\naluno@example.test,Aluno",
  }), /revogada antes da importação/);
  assert.equal(unitChecks, 2);
  assert.equal(inserts, 0);
});

test("comunicado unitário não é enviado se o grant for revogado após o lock da turma", async () => {
  const managerId = randomUUID();
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const cohort = { id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma",
    state: "active", revision: 1, payload: { course_record_id: courseId, course_revision: 1, institution_unit_record_id: randomUUID() } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso",
    state: "in_progress", revision: 1, payload: {} };
  let unitChecks = 0;
  let inserts = 0;
  const client = { async query(sql: string) {
    if (sql.includes("kind='cohort' FOR SHARE")) return { rows: [cohort] };
    if (sql.includes("kind='course' FOR SHARE")) return { rows: [course] };
    if (sql.includes("INSERT INTO extension_records")) inserts++;
    return { rows: [] };
  } };
  const service = new ExtensionRecords({ async query() { return []; } } as never,
    { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    unitRecordAccess: { async canManageRecord() { unitChecks++; return unitChecks === 1; } },
    async enrollmentImportContext() { return { cohort, course }; },
    async mutation(...args: unknown[]) { return (args[5] as (tx: unknown) => Promise<unknown>)(client); },
  });

  await assert.rejects(service.sendTeachingAnnouncement(cohort.id, managerId, {
    operation_key: randomUUID(), title: "Aviso", body: "Comunicado para a turma.",
  }), /revogada antes do envio/);
  assert.equal(unitChecks, 2);
  assert.equal(inserts, 0);
});

test("comunicado por e-mail cria notificação Orbit deduplicável por matrícula e desativa recibo de leitura", async () => {
  const teacherId = "00000000-0000-4000-8000-000000000152";
  const enrollmentId = "00000000-0000-4000-8000-000000000153";
  const announcementId = "00000000-0000-4000-8000-000000000154";
  const cohort = { id: cohortId, workspace_id: "00000000-0000-4000-8000-000000000155", title: "Turma A", state: "active" };
  const announcement = { id: announcementId, workspace_id: cohort.workspace_id, plugin_id: "suinda-learning", kind: "announcement",
    title: "Mudança de sala", state: "sent", revision: 1, created_at: new Date().toISOString(),
    payload: { channel: "email", audience_type: "cohort", audience_record_id: cohortId, body: "A aula será na sala 2.", sent_at: new Date().toISOString() },
    learner_user_id: "00000000-0000-4000-8000-000000000156", enrollment_id: enrollmentId };
  const published: unknown[][] = [];
  let mutationInput: Record<string, unknown> | null = null;
  const service = new ExtensionRecords({ async query(sql: string) {
    assert.match(sql, /DISTINCT ON \(a\.id,e\.payload->>'learner_user_id'\)/);
    return [announcement];
  } } as never, {} as never, learningRegistry(), new DocumentScanner(), {
    async publish(...args: unknown[]) { published.push(args); return { id: "notification" }; },
  } as never);
  Object.assign(service, {
    async enrollmentImportContext() { return { cohort }; },
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, input: Record<string, unknown>) {
      mutationInput = input;
      return { announcement_id: announcementId, title: announcement.title, cohort_id: cohortId, channel: "email", state: "sent", scheduled_at: null, sent_at: new Date().toISOString() };
    },
  });
  await assert.rejects(service.sendTeachingAnnouncement(cohortId, teacherId, {
    operation_key: "00000000-0000-4000-8000-000000000157", title: "Mudança de sala", body: "A aula será na sala 2.",
    channel: "email", requires_read_confirmation: true,
  }), /somente para comunicados internos/);
  await service.sendTeachingAnnouncement(cohortId, teacherId, {
    operation_key: "00000000-0000-4000-8000-000000000158", title: "Mudança de sala", body: "A aula será na sala 2.",
    channel: "email", requires_read_confirmation: false,
  });
  assert.equal((mutationInput as Record<string, unknown> | null)?.channel, "email");
  assert.equal((mutationInput as Record<string, unknown> | null)?.requires_read_confirmation, false);
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], ["suinda-learning", announcement.learner_user_id, {
    workspaceId: cohort.workspace_id, kind: "announcement", title: "Mudança de sala", body: "A aula será na sala 2.",
    targetUrl: `/suinda/learning/${enrollmentId}?announcement=${announcementId}`,
  }]);
});

test("comunicado por e-mail percorre os destinatários após mil sem duplicar matrículas", async () => {
  const announcementId = "00000000-0000-4000-8000-000000000159";
  const workspaceId = "00000000-0000-4000-8000-000000000160";
  const recipients = Array.from({ length: 1001 }, (_, index) => ({
    id: announcementId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "announcement",
    title: "Aviso de turma", state: "sent", revision: 1, payload: { body: "Atualização importante." },
    learner_user_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    enrollment_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }));
  const cursors: Array<{ announcementId: string | null; learnerId: string | null }> = [];
  let published = 0;
  const db = { async query(sql: string, values: unknown[] = []) {
    assert.match(sql, /DISTINCT ON \(a\.id,e\.payload->>'learner_user_id'\)/);
    assert.match(sql, /e\.payload->>'learner_user_id'>\$3::text/);
    const cursorAnnouncementId = values[1] as string | null;
    const cursorLearnerId = values[2] as string | null;
    cursors.push({ announcementId: cursorAnnouncementId, learnerId: cursorLearnerId });
    return recipients.filter((recipient) => !cursorAnnouncementId || recipient.id > cursorAnnouncementId
      || recipient.id === cursorAnnouncementId && recipient.learner_user_id > cursorLearnerId!)
      .slice(0, Number(values[3]));
  } };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner(), {
    async publish() { published++; return { id: `notification-${published}` }; },
  } as never);

  await (service as unknown as { dispatchEmailAnnouncements(id?: string): Promise<void> }).dispatchEmailAnnouncements(announcementId);

  assert.equal(published, 1001);
  assert.deepEqual(cursors, [
    { announcementId: null, learnerId: null },
    { announcementId, learnerId: recipients[999]!.learner_user_id },
  ]);
});

test("catálogo de bolsas mantém todos os programas elegíveis após cem opções", async () => {
  const courseId = "00000000-0000-4000-8000-000000000161";
  const workspaceId = "00000000-0000-4000-8000-000000000162";
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course",
    title: "Curso", state: "published", revision: 1, payload: {} };
  const programs = Array.from({ length: 101 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "scholarship", title: `Programa ${String(index + 1).padStart(3, "0")}`,
    state: "open", revision: 1, workspace_name: "Instituição", sort_title: `programa ${String(index + 1).padStart(3, "0")}`,
    payload: { course_record_ids: [courseId], discount_percent: 20 },
  }));
  const cursors: Array<{ title: string | null; id: string | null }> = [];
  const db = {
    async one(sql: string) { assert.match(sql, /kind='course'/); return course; },
    async query(sql: string, values: unknown[] = []) {
      assert.match(sql, /p\.payload->'course_record_ids' @> jsonb_build_array/);
      assert.match(sql, /ORDER BY lower\(p\.title\),p\.id LIMIT \$5/);
      const title = values[2] as string | null;
      const id = values[3] as string | null;
      cursors.push({ title, id });
      return programs.filter((program) => title === null || program.sort_title > title
        || program.sort_title === title && program.id > id!).slice(0, Number(values[4]));
    },
  };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());

  const result = await service.listScholarshipPrograms(randomUUID(), courseId);

  assert.equal(result.length, 101);
  assert.equal(result.at(-1)?.id, programs.at(-1)?.id);
  assert.deepEqual(cursors, [
    { title: null, id: null },
    { title: "programa 100", id: programs[99]!.id },
  ]);
});

test("modelos de comunicado são versionados e exigem permissão de publicação", async () => {
  const template = suindaRecordKinds.announcement_template;
  assert.equal(template.resourceScoped, true);
  assert.deepEqual(template.schema.required, ["title", "body"]);
  assert.deepEqual(template.transitions, { draft: ["published", "archived"], published: ["draft", "archived"], archived: [] });
  const base = {
    async hasWorkspacePermission(permission: string) {
      return permission === "plugin.suinda-learning.write" || permission === "plugin.suinda-learning.publish";
    },
    async hasGlobalPermission() { return false; },
  } as never;
  assert.equal(await template.authorizeCreate!("teacher", { title: "Aviso", body: "Texto" }, base), true);
  assert.equal(await template.authorizeTransition!("draft", "published", { title: "Aviso", body: "Texto" }, base), true);
  const writerOnly = {
    async hasWorkspacePermission(permission: string) { return permission === "plugin.suinda-learning.write"; },
    async hasGlobalPermission() { return false; },
  } as never;
  assert.equal(await template.authorizeTransition!("draft", "published", { title: "Aviso", body: "Texto" }, writerOnly), false);
  assert.ok((await template.validate!({ title: "  ", body: "Texto" }, {} as never)).some((issue) => issue.code === "announcement_template.title_required"));
});

test("modelos disponíveis são publicados e limitados ao workspace da turma atribuída", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000271";
  const templateId = "00000000-0000-4000-8000-000000000272";
  let sql = "";
  const service = new ExtensionRecords({
    async query(statement: string, values?: unknown[]) {
      sql = statement;
      assert.deepEqual(values, [workspaceId, null, null, 200]);
      return [{ id: templateId, revision: 3, name: "Mudança de horário", announcement_title: "Aula amanhã", body: "A aula começa às 9h." }];
    },
  } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async enrollmentImportContext() { return { cohort: { workspace_id: workspaceId } }; } });
  assert.deepEqual(await service.teachingAnnouncementTemplates(cohortId, "teacher"), {
    templates: [{ id: templateId, revision: 3, name: "Mudança de horário", title: "Aula amanhã", body: "A aula começa às 9h." }],
  });
  assert.match(sql, /workspace_id=\$1 AND plugin_id='suinda-learning' AND kind='announcement_template' AND state='published'/);
  const route = `/extensions/suinda-learning/me/teaching/cohorts/${cohortId}/announcement-templates`;
  assert.equal(suindaPlugin.handlesRoute?.(route), true);
  assert.equal(suindaPlugin.routePermission?.(route, "GET"), null);
  assert.equal(suindaPlugin.routePermission?.(`/extensions/suinda-learning/me/teaching/cohorts/${cohortId}/announcements`, "POST"), null);
});

test("catálogo de modelos de comunicado percorre todos os itens após duzentos", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000281";
  const records = Array.from({ length: 201 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    revision: 1, name: `Modelo ${String(index + 1).padStart(3, "0")}`,
    announcement_title: `Comunicado ${index + 1}`, body: `Texto ${index + 1}`,
    sort_name: `modelo ${String(index + 1).padStart(3, "0")}`,
  }));
  const cursors: Array<{ name: string | null; id: string | null }> = [];
  const service = new ExtensionRecords({
    async query(statement: string, values: unknown[] = []) {
      assert.match(statement, /kind='announcement_template' AND state='published'/);
      assert.match(statement, /ORDER BY lower\(title\),id LIMIT \$4/);
      assert.deepEqual(values[0], workspaceId);
      const name = values[1] as string | null;
      const id = values[2] as string | null;
      cursors.push({ name, id });
      return records.filter((record) => name === null || record.sort_name > name
        || record.sort_name === name && record.id > id!).slice(0, Number(values[3]));
    },
  } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async enrollmentImportContext() { return { cohort: { workspace_id: workspaceId } }; } });

  const result = await service.teachingAnnouncementTemplates(cohortId, "teacher");

  assert.equal(result.templates.length, 201);
  assert.equal(result.templates.at(-1)?.id, records.at(-1)?.id);
  assert.deepEqual(cursors, [
    { name: null, id: null },
    { name: "modelo 200", id: records[199]!.id },
  ]);
});

test("envio de comunicado usa somente modelo publicado do workspace e registra sua revisão", async () => {
  const teacherId = "00000000-0000-4000-8000-000000000273";
  const workspaceId = "00000000-0000-4000-8000-000000000274";
  const courseId = "00000000-0000-4000-8000-000000000280";
  const templateId = "00000000-0000-4000-8000-000000000275";
  const announcementId = "00000000-0000-4000-8000-000000000276";
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", revision: 4,
    payload: { instructor_ids: [teacherId] } };
  const cohort = { id: cohortId, workspace_id: workspaceId, title: "Turma A", state: "active",
    payload: { course_record_id: courseId, course_revision: 4, instructor_ids: [], tutor_ids: [] } };
  const template = { id: templateId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "announcement_template",
    title: "Mudança de horário", state: "published", revision: 4, payload: { title: "Mudança de horário", body: "A aula começa às 9h." } };
  let insertedPayload: Record<string, unknown> | null = null;
  const client = {
    async query(statement: string, values: unknown[] = []) {
      if (statement.includes("kind='cohort' FOR SHARE")) return { rows: [cohort] };
      if (statement.includes("kind='course' FOR SHARE")) return { rows: [course] };
      if (statement.includes("kind='announcement_template'")) {
        assert.deepEqual(values, [templateId, workspaceId]);
        return { rows: [template] };
      }
      if (statement.includes("INSERT INTO extension_records")) {
        insertedPayload = JSON.parse(String(values[3])) as Record<string, unknown>;
        return { rows: [{ id: announcementId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "announcement",
          title: values[1], state: values[2], revision: 1, payload: insertedPayload }] };
      }
      return { rows: [] };
    },
  };
  const service = new ExtensionRecords({ async query() { return []; } } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async enrollmentImportContext() { return { cohort, course }; },
    async mutation(...args: unknown[]) {
      const callback = args[5] as (tx: unknown) => Promise<unknown>;
      return callback(client);
    },
    async payload(_tx: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async snapshot(_tx: unknown, record: Record<string, unknown>) { return record; },
  });
  const response = await service.sendTeachingAnnouncement(cohortId, teacherId, {
    operation_key: "00000000-0000-4000-8000-000000000277", template_record_id: templateId, channel: "internal",
  });
  const savedPayload = insertedPayload as Record<string, unknown> | null;
  assert.ok(savedPayload);
  assert.equal(savedPayload.audience_record_id, cohortId);
  assert.equal(savedPayload.body, "A aula começa às 9h.");
  assert.equal(savedPayload.channel, "internal");
  assert.match(String(savedPayload.sent_at), /^\d{4}-\d\d-\d\dT/);
  assert.equal(savedPayload.requires_read_confirmation, false);
  assert.equal(savedPayload.template_record_id, templateId);
  assert.equal(savedPayload.template_revision, 4);
  assert.equal((response as { title: string }).title, "Mudança de horário");
  assert.equal((response as { template_record_id: string }).template_record_id, templateId);
  assert.equal((response as { template_revision: number }).template_revision, 4);

  const channelCalls: unknown[][] = [];
  Object.assign(service, { whatsappAnnouncements: {
    isEnabled() { return true; }, async assertReady(workspace: string) { channelCalls.push(["ready", workspace]); },
    async dispatch(workspace: string, announcement: string) { channelCalls.push(["dispatch", workspace, announcement]); },
  } });
  const whatsapp = await service.sendTeachingAnnouncement(cohortId, teacherId, {
    operation_key: "00000000-0000-4000-8000-000000000281", template_record_id: templateId, channel: "whatsapp",
  });
  assert.equal((whatsapp as { channel: string }).channel, "whatsapp");
  assert.deepEqual(channelCalls, [["ready", workspaceId], ["dispatch", workspaceId, announcementId]]);

  const unpublished = { ...template, state: "draft" };
  Object.assign(service, {
    async mutation(...args: unknown[]) {
      const callback = args[5] as (tx: unknown) => Promise<unknown>;
      const draftClient = { ...client, async query(statement: string, values: unknown[] = []) {
        if (statement.includes("kind='announcement_template'")) return { rows: [unpublished] };
        return client.query(statement, values);
      } };
      return callback(draftClient);
    },
  });
  await assert.rejects(service.sendTeachingAnnouncement(cohortId, teacherId, {
    operation_key: "00000000-0000-4000-8000-000000000278", template_record_id: templateId,
  }), /não publicado neste workspace/);

  const foreignTemplate = { ...template, workspace_id: "00000000-0000-4000-8000-000000000279" };
  Object.assign(service, {
    async mutation(...args: unknown[]) {
      const callback = args[5] as (tx: unknown) => Promise<unknown>;
      const foreignClient = { ...client, async query(statement: string, values: unknown[] = []) {
        if (statement.includes("kind='announcement_template'")) return { rows: [foreignTemplate] };
        return client.query(statement, values);
      } };
      return callback(foreignClient);
    },
  });
  await assert.rejects(service.sendTeachingAnnouncement(cohortId, teacherId, {
    operation_key: "00000000-0000-4000-8000-000000000280", template_record_id: templateId,
  }), /não publicado neste workspace/);
});

test("envio de inscrição reserva cupom concorrente e grava o valor líquido versionado", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000141";
  const workspaceId = "00000000-0000-4000-8000-000000000142";
  const enrollmentId = "00000000-0000-4000-8000-000000000143";
  const courseId = "00000000-0000-4000-8000-000000000144";
  const couponId = "00000000-0000-4000-8000-000000000145";
  const application = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Inscrição",
    state: "application_draft", revision: 2, payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 5,
      payment_status: "pending", coupon_code: "SAVE20" } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso pago",
    state: "enrollment_open", revision: 5, payload: { format: "open", price_amount: 100, currency: "BRL" } };
  const coupon = { id: couponId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment_coupon", title: "SAVE20",
    state: "published", revision: 1, payload: { code: "SAVE20", discount_context: "institutional_agreement", partner_name: "Instituto Exemplo", discount_type: "percent", discount_value: 20, max_redemptions: 1 } };
  async function attempt(used: number) {
    let savedPayload: Record<string, unknown> | null = null;
    const client = { async query(sql: string) {
      if (sql.includes("kind='course'") && sql.includes("FOR SHARE")) return { rows: [course] };
      if (sql.includes("kind='enrollment_coupon'")) return { rows: [coupon] };
      if (sql.includes("COUNT(*)::int AS count") && sql.includes("coupon_record_id")) return { rows: [{ count: used }] };
      return { rows: [] };
    } };
    const records = new ExtensionRecords({ async one() { return { workspace_id: workspaceId }; } } as never,
      { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
    Object.assign(records, {
      async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
      async lock() { return application; },
      async payload(_client: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
      async save(_client: unknown, _record: unknown, _actor: string, _title: string, payload: Record<string, unknown>, state: string) {
        savedPayload = payload; return { ...application, payload, state, revision: 3 };
      },
    });
    const response = await records.submitOwnEnrollment(enrollmentId, learnerId, { operation_key: "00000000-0000-4000-8000-000000000146", expected_revision: 2 });
    return { response, payload: savedPayload };
  }
  const { response, payload } = await attempt(0);
  assert.equal(response.discount_amount, 20);
  assert.equal(response.amount_due, 80);
  assert.equal((payload as Record<string, unknown> | null)?.coupon_record_id, couponId);
  assert.equal((payload as Record<string, unknown> | null)?.discount_context_snapshot, "institutional_agreement");
  assert.equal((payload as Record<string, unknown> | null)?.discount_partner_snapshot, "Instituto Exemplo");
  await assert.rejects(attempt(1), /limite de utilizações/);
  coupon.payload.partner_name = "";
  await assert.rejects(attempt(0), /instituição ou associação conveniada/);
});

test("políticas de envio exigem regra válida, permitem turma pública e bloqueiam vínculo corporativo", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000157";
  const workspaceId = "00000000-0000-4000-8000-000000000158";
  const enrollmentId = "00000000-0000-4000-8000-000000000159";
  const courseId = "00000000-0000-4000-8000-000000000160";
  const cohortId = "00000000-0000-4000-8000-000000000161";
  const application = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Inscrição",
    state: "application_draft", revision: 1, payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 1,
      cohort_record_id: cohortId, cohort_revision: 1, payment_status: "not_required" } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso",
    state: "enrollment_open", revision: 1, payload: { format: "cohort", price_amount: 0, currency: "BRL" } };
  const cohort = { id: cohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma",
    state: "enrolling", revision: 1, payload: { course_record_id: courseId, course_revision: 1 } };

  async function attempt(options: { links?: Array<{ id: string }>; linkState?: string; malformed?: boolean; child?: "enabled" | "disabled" | "missing" | "without-policy" }) {
    let saved = false;
    const client = { async query(sql: string, values: unknown[] = []) {
      if (sql.includes("kind='course'") && sql.includes("FOR SHARE")) return { rows: [course] };
      if (sql.includes("kind='cohort'") && sql.includes("FOR SHARE")) return { rows: [cohort] };
      if (sql.includes("payload @> $5::jsonb") && values[1] === "suinda-corporate")
        return options.malformed ? { rows: undefined } : { rows: values[3] === (options.linkState || "active") ? options.links || [] : [] };
      return { rows: [] };
    } };
    const registry = learningRegistry();
    if (options.child !== "missing") {
      registry.register(options.child === "without-policy" ? { ...suindaCorporatePlugin,
        recordAccessPolicies: [{ targetPluginId: "suinda-learning", targetKind: "enrollment", enforceWhenDisabled: true }] } : suindaCorporatePlugin);
      if (options.child === "disabled") registry.setEnabled("suinda-corporate", false);
    }
    const service = new ExtensionRecords({ async one() { return { workspace_id: workspaceId }; } } as never,
      { async has() { return false; }, async audit() {} } as never, registry, new DocumentScanner());
    Object.assign(service, {
      async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (tx: never) => Promise<unknown>) { return callback(client as never); },
      async lock() { return application; },
      async payload(_tx: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
      async save(_tx: unknown, _record: unknown, _actor: string, _title: string, payload: Record<string, unknown>, state: string) {
        saved = true; return { ...application, payload, state, revision: 2 };
      },
    });
    const result = await service.submitOwnEnrollment(enrollmentId, learnerId, {
      operation_key: "00000000-0000-4000-8000-000000000162", expected_revision: 1,
    });
    return { result, saved };
  }

  const publicEnrollment = await attempt({ links: [] });
  assert.equal(publicEnrollment.saved, true);
  assert.equal(publicEnrollment.result.state, "submitted");
  await assert.rejects(attempt({ links: [{ id: "corporate-link" }] }), /turma é corporativa/);
  await assert.rejects(attempt({ links: [{ id: "closed-corporate-link" }], linkState: "closed" }), /turma é corporativa/);
  await assert.rejects(attempt({ links: [{ id: "corporate-link" }], child: "disabled" }), /turma é corporativa/);
  await assert.rejects(attempt({ malformed: true }), /turma é corporativa|modalidade da turma/);
  await assert.rejects(attempt({ child: "missing" }), /Não foi possível verificar as regras de autoinscrição/);
  await assert.rejects(attempt({ child: "without-policy" }), /Não foi possível verificar as regras de autoinscrição/);
});

test("coorte corporativa continua fora do catálogo público com o plugin corporativo suspenso", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000163";
  const cohort = { id: "00000000-0000-4000-8000-000000000164", workspace_id: workspaceId, plugin_id: "suinda-learning",
    kind: "cohort", title: "Turma", state: "enrolling", revision: 1, payload: {} };
  const registry = learningRegistry();
  registry.register(suindaCorporatePlugin);
  registry.setEnabled("suinda-corporate", false);
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("payload @> $5::jsonb") && values[1] === "suinda-corporate" && values[3] === "active")
      return [{ id: "corporate-link", pluginId: "suinda-corporate", kind: "corporate_cohort", state: "active", revision: 1, payload: {} }];
    return [];
  } };
  const records = new ExtensionRecords(db as never, { async has() { return false; } } as never, registry, new DocumentScanner());
  const applyPolicies = (records as unknown as { applyPublicRecordPolicies(plugin: string, kind: string, rows: typeof cohort[], workspace: string): Promise<typeof cohort[]> }).applyPublicRecordPolicies.bind(records);
  assert.deepEqual(await applyPolicies("suinda-learning", "cohort", [cohort], workspaceId), []);
});

test("envio de inscrição exige referências válidas e matrícula concluída nos pré-requisitos do curso", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000151";
  const workspaceId = "00000000-0000-4000-8000-000000000152";
  const enrollmentId = "00000000-0000-4000-8000-000000000153";
  const courseId = "00000000-0000-4000-8000-000000000154";
  const prerequisiteId = "00000000-0000-4000-8000-000000000155";
  const application = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Inscrição",
    state: "application_draft", revision: 2, payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 5,
      payment_status: "not_required" } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso",
    state: "enrollment_open", revision: 5, payload: { format: "open", price_amount: 0, prerequisite_course_ids: [prerequisiteId] } };
  let saved = false;
  let prerequisiteCourseLock = "";
  let completedEnrollmentLock = "";
  async function attempt(options: { validPrerequisite?: boolean; completed?: boolean; prerequisites?: string[]; currentCourseId?: string } = {}) {
    saved = false;
    prerequisiteCourseLock = "";
    completedEnrollmentLock = "";
    const ids = options.prerequisites || [prerequisiteId];
    const currentCourse = { ...course, id: options.currentCourseId || courseId, payload: { ...course.payload, prerequisite_course_ids: ids } };
    const client = { async query(sql: string) {
      if (sql.includes("kind='course'") && sql.includes("FOR SHARE") && !sql.includes("id::text=ANY")) return { rows: [currentCourse] };
      if (sql.includes("id::text=ANY($1::text[])")) {
        prerequisiteCourseLock = sql;
        return { rows: options.validPrerequisite === false ? [] : ids.map((id) => ({ id })) };
      }
      if (sql.includes("kind='enrollment'") && sql.includes("FOR SHARE")) {
        completedEnrollmentLock = sql;
        return { rows: options.completed === false ? [] : [{ course_record_id: prerequisiteId }] };
      }
      return { rows: [] };
    } };
    const records = new ExtensionRecords({ async one() { return { workspace_id: workspaceId }; } } as never,
      { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
    Object.assign(records, {
      async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
      async lock() { return application; },
      async payload(_client: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
      async save(_client: unknown, _record: unknown, _actor: string, _title: string, payload: Record<string, unknown>, state: string) {
        saved = true; return { ...application, payload, state, revision: 3 };
      },
    });
    const result = await records.submitOwnEnrollment(enrollmentId, learnerId, {
      operation_key: "00000000-0000-4000-8000-000000000156", expected_revision: 2,
    });
    return result;
  }

  const success = await attempt();
  assert.equal(success.state, "submitted");
  assert.equal(saved, true);
  assert.match(prerequisiteCourseLock, /FOR SHARE/);
  assert.match(prerequisiteCourseLock, /workspace_id=\$2/);
  assert.match(completedEnrollmentLock, /state='completed'[\s\S]*FOR SHARE/);
  assert.match(completedEnrollmentLock, /workspace_id=\$1[\s\S]*payload->>'learner_user_id'=\$2/);
  await assert.rejects(attempt({ completed: false }), /Conclua todos os cursos pré-requisitos/);
  assert.equal(saved, false);
  await assert.rejects(attempt({ prerequisites: [prerequisiteId, prerequisiteId] }), /inválidas ou duplicadas/);
  await assert.rejects(attempt({ prerequisites: [courseId], currentCourseId: courseId }), /si mesmo/);
  await assert.rejects(attempt({ validPrerequisite: false }), /não existem como cursos deste workspace/);
});

function learningRegistry() {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.register(suindaPlugin);
  return registry;
}

test("certificados só podem ser emitidos após conclusão e frequência mínima da revisão matriculada", async () => {
  const enrollmentId = "00000000-0000-4000-8000-000000000010";
  const courseId = "00000000-0000-4000-8000-000000000011";
  const cohortRecordId = "00000000-0000-4000-8000-000000000012";
  const sessionId = "00000000-0000-4000-8000-000000000013";
  let minutesAttended = 30;
  const context: RecordValidationContext = {
    resolveRecord: async () => ({ id: courseId, pluginId: "suinda-learning", kind: "course", state: "completed", revision: 2, payload: { attendance_min_percent: 75 } }),
    resolveLatestRecord: async (id) => id === enrollmentId
      ? { id, pluginId: "suinda-learning", kind: "enrollment", state: "completed", revision: 2, payload: { course_record_id: courseId, course_revision: 2, cohort_record_id: cohortRecordId, learner_user_id: "learner" } }
      : null,
    listLatestRecords: async (_plugin, kind) => kind === "session"
      ? [{ id: sessionId, pluginId: "suinda-learning", kind, state: "completed", revision: 1, payload: { starts_at: "2020-01-01T10:00:00Z", ends_at: "2020-01-01T11:00:00Z" } }]
      : kind === "attendance"
        ? [{ id: "attendance", pluginId: "suinda-learning", kind, state: "recorded", revision: 1, payload: { session_record_id: sessionId, minutes_attended: minutesAttended } }]
        : [],
  };
  const certificate = suindaRecordKinds.certificate;
  const payload = { enrollment_record_id: enrollmentId, learner_user_id: "learner", certificate_code: "TEST-001", workload_hours: 1 };
  assert.deepEqual(certificate.transitions.draft, ["issued", "canceled"]);
  await assert.rejects(Promise.resolve().then(() => certificate.prepareTransition!("draft", "issued", payload, context)), /abaixo do mínimo/);
  minutesAttended = 45;
  const issued = await certificate.prepareTransition!("draft", "issued", payload, context);
  assert.equal(typeof issued.issued_at, "string");
  assert.match(String(issued.certificate_code), /^SUINDA-[0-9a-f-]{36}$/i);
});

test("certificado de participação exige escopo e gestão, preservando matrícula vigente e data própria", async () => {
  const enrollmentId = "00000000-0000-4000-8000-000000000020";
  let manager = false;
  const context: RecordValidationContext = {
    actorId: "manager",
    resolveLatestRecord: async (recordId) => recordId === enrollmentId
      ? { id: enrollmentId, pluginId: "suinda-learning", kind: "enrollment", state: "active", revision: 2, payload: { learner_user_id: "learner" } }
      : null,
    resolveRecord: async () => null,
    hasWorkspacePermission: async (permission) => permission === "plugin.suinda-learning.manage" && manager,
  };
  const certificate = suindaRecordKinds.certificate;
  const payload = { enrollment_record_id: enrollmentId, learner_user_id: "learner", certificate_kind: "participation", participation_scope: "Módulo introdutório", completed_at: "2026-10-15T12:00:00.000Z", workload_hours: 8 };
  await assert.rejects(Promise.resolve().then(() => certificate.prepareTransition!("draft", "issued", payload, context)), /gestão acadêmica/);
  manager = true;
  assert.deepEqual(await certificate.validate!(payload, context), []);
  const issued = await certificate.prepareTransition!("draft", "issued", payload, context);
  assert.equal(issued.certificate_kind, "participation");
  assert.equal(issued.completed_at, payload.completed_at);
  assert.equal(typeof issued.issued_at, "string");
  assert.match(String(issued.certificate_code), /^SUINDA-[0-9a-f-]{36}$/i);
  assert.ok((await certificate.validate!({ ...payload, participation_scope: " " }, context)).some((issue) => issue.code === "certificate_participation_scope_required"));
});

test("certificado intermediário só valida marco da revisão da matrícula depois das aulas selecionadas", async () => {
  const enrollmentId = "00000000-0000-4000-8000-000000000111";
  const courseId = "00000000-0000-4000-8000-000000000112";
  const moduleId = "00000000-0000-4000-8000-000000000113";
  const lessonId = "00000000-0000-4000-8000-000000000114";
  const context: RecordValidationContext = {
    resolveLatestRecord: async (recordId) => recordId === enrollmentId
      ? { id: enrollmentId, pluginId: "suinda-learning", kind: "enrollment", state: "active", revision: 2, payload: { learner_user_id: "learner", course_record_id: courseId, course_revision: 4 } }
      : recordId === lessonId ? { id: lessonId, pluginId: "suinda-learning", kind: "lesson", state: "published", revision: 1, payload: { module_record_id: moduleId } }
        : recordId === moduleId ? { id: moduleId, pluginId: "suinda-learning", kind: "module", state: "published", revision: 1, payload: { course_record_id: courseId, course_version: 7 } } : null,
    resolveRecord: async (recordId, revision) => recordId === courseId && revision === 4
      ? { id: courseId, pluginId: "suinda-learning", kind: "course", state: "in_progress", revision: 4, payload: { version: 7, intermediate_certificate_milestones: [{ milestone_key: "primeira-etapa", milestone_title: "Primeira etapa", required_lesson_ids: [lessonId] }] } } : null,
    listLatestRecords: async (_plugin, _kind, match) => match.enrollment_record_id === enrollmentId
      ? [{ id: "progress", pluginId: "suinda-learning", kind: "lesson_progress", state: "completed", revision: 1, payload: { learner_user_id: "learner", lesson_record_id: lessonId } }] : [],
  };
  const certificate = suindaRecordKinds.certificate;
  const payload = { enrollment_record_id: enrollmentId, learner_user_id: "learner", certificate_kind: "milestone",
    milestone_key: "primeira-etapa", milestone_title: "Primeira etapa", participation_scope: "Aula 1",
    milestone_lesson_titles: ["Aula introdutória"], workload_hours: 1 };
  assert.deepEqual(await certificate.validate!(payload, context), []);
  const incomplete = { ...context, async listLatestRecords() { return []; } };
  assert.ok((await certificate.validate!(payload, incomplete as never)).some((issue) => issue.code === "certificate_milestone_lessons_incomplete"));
  assert.ok((await certificate.validate!({ ...payload, milestone_title: "Outra etapa" }, context)).some((issue) => issue.code === "certificate_milestone_not_configured"));
});

test("retomada da aprendizagem é criada pelo servidor e pertence ao aluno indicado", async () => {
  const bookmark = suindaRecordKinds.learning_bookmark;
  const context: RecordValidationContext = { resolveRecord: async () => null };
  assert.equal(bookmark.serverCreated, true);
  assert.equal(bookmark.uniqueFields?.includes("bookmark_key"), true);
  assert.equal(await bookmark.authorizeRecord!("learner", "write", "saved", { learner_user_id: "learner" }, context), true);
  assert.equal(await bookmark.authorizeRecord!("other", "read", "saved", { learner_user_id: "learner" }, context), false);
  const issues = await bookmark.validate!({ learner_user_id: "other" }, { ...context, actorId: "learner" } as never);
  assert.ok(issues.some((issue) => issue.code === "learning_bookmark_owner_invalid"));
});

test("documento acadêmico fica ligado à matrícula e só aluno ou equipe acadêmica autorizada pode ler", async () => {
  const definition = suindaRecordKinds.learner_document;
  const enrollmentId = "00000000-0000-4000-8000-000000000201";
  const payload = { enrollment_record_id: enrollmentId, learner_user_id: "learner", category: "education", file_name: "historico.pdf", mime_type: "application/pdf", size_bytes: 100, sha256: "a".repeat(64), scan_status: "clean" };
  const context = {
    actorId: "learner",
    async resolveLatestRecord(id: string) { return id === enrollmentId ? { id, pluginId: "suinda-learning", kind: "enrollment", state: "active", revision: 1, payload: { learner_user_id: "learner" } } : null; },
    async hasWorkspacePermission(permission: string) { return permission === "plugin.suinda-learning.manage"; },
  };
  assert.equal(definition.serverCreated, true);
  assert.deepEqual(await definition.validate!(payload, context as never), []);
  assert.equal(await definition.authorizeRecord!("learner", "read", "submitted", payload, context as never), true);
  assert.equal(await definition.authorizeRecord!("other", "read", "submitted", payload, context as never), true);
  assert.equal(await definition.authorizeAttachment!("other", "read", "submitted", payload, context as never), true);
  const readOnlyContext = { ...context, async hasWorkspacePermission(permission: string) { return permission === "plugin.suinda-learning.read"; } };
  const forged = await definition.validate!(payload, { ...readOnlyContext, actorId: "other" } as never);
  assert.deepEqual(forged.map((issue) => issue.code), ["learner_document_owner_invalid"]);
  assert.equal(await definition.authorizeRecord!("other", "read", "submitted", payload, readOnlyContext as never), false);
  assert.equal(await definition.authorizeAttachment!("other", "read", "submitted", payload, readOnlyContext as never), false);
});

test("materiais de aula podem ser baixados pela equipe atribuída sem expor rascunhos a outros usuários", async () => {
  const definition = suindaRecordKinds.lesson;
  const moduleId = "00000000-0000-4000-8000-000000000231";
  const courseId = "00000000-0000-4000-8000-000000000232";
  const teacherId = "00000000-0000-4000-8000-000000000233";
  const cohortTeacherId = "00000000-0000-4000-8000-000000000234";
  const moduleRecord = { id: moduleId, pluginId: "suinda-learning", kind: "module", state: "draft", payload: { course_record_id: courseId } };
  const courseRecord = { id: courseId, pluginId: "suinda-learning", kind: "course", state: "draft", payload: { instructor_ids: [teacherId], tutor_ids: [] } };
  const cohortRecord = { id: "cohort", pluginId: "suinda-learning", kind: "cohort", state: "active", payload: { course_record_id: courseId, tutor_ids: [cohortTeacherId] } };
  const context = (actor: string) => ({
    async hasWorkspacePermission() { return false; }, async hasGlobalPermission() { return false; },
    async resolveLatestRecord(id: string) { return id === moduleId ? moduleRecord : id === courseId ? courseRecord : null; },
    async listLatestRecords(_plugin: string, kind: string) { return kind === "cohort" ? [cohortRecord] : []; },
    actorId: actor,
  });
  const draftPayload = { module_record_id: moduleId, downloadable: false };
  assert.equal(await definition.authorizeAttachment!(teacherId, "read", "draft", draftPayload, context(teacherId) as never), true);
  assert.equal(await definition.authorizeAttachment!(cohortTeacherId, "read", "scheduled", draftPayload, context(cohortTeacherId) as never), true);
  assert.equal(await definition.authorizeAttachment!("unassigned", "read", "draft", draftPayload, context("unassigned") as never), false);
  const learner = "learner";
  const learnerContext = {
    ...context(learner),
    async resolveLatestRecord(id: string) {
      if (id === moduleId) return { ...moduleRecord, state: "published", payload: { course_record_id: courseId, course_revision: 1, course_version: 1 } };
      if (id === courseId) return { ...courseRecord, revision: 1, payload: { ...courseRecord.payload, version: 1 } };
      return null;
    },
    async resolveRecord() { return { id: courseId, pluginId: "suinda-learning", kind: "course", state: "published", revision: 1, payload: { version: 1 } }; },
    async listLatestRecords(_plugin: string, kind: string) { return kind === "enrollment" ? [{ id: "enrollment", pluginId: "suinda-learning", kind, state: "active", revision: 1, payload: { learner_user_id: learner, course_record_id: courseId, course_revision: 1, payment_status: "paid" } }] : []; },
  };
  assert.equal(await definition.authorizeAttachment!(learner, "read", "published", { module_record_id: moduleId, downloadable: true }, learnerContext as never), true);
  assert.equal(await definition.authorizeAttachment!(learner, "read", "published", { module_record_id: moduleId, downloadable: false }, learnerContext as never), false);
});

test("ações de acessibilidade são de autoria da aula e declaram escopo unitário", () => {
  const path = "/extensions/suinda-learning/me/teaching/lessons/00000000-0000-4000-8000-000000000001/materials/00000000-0000-4000-8000-000000000002/alt-text";
  assert.equal(suindaPlugin.handlesRoute?.(path), true);
  assert.equal(suindaPlugin.routePermission?.(path, "POST"), "plugin.suinda-learning.write");
  const remediationPath = "/extensions/suinda-learning/me/teaching/lessons/00000000-0000-4000-8000-000000000001/accessibility";
  assert.equal(suindaPlugin.handlesRoute?.(remediationPath), true);
  assert.equal(suindaPlugin.routePermission?.(remediationPath, "POST"), "plugin.suinda-learning.write");
});

test("anexo de imagem da aula exige, armazena e devolve uma descrição alternativa por revisão", async () => {
  const lessonId = "00000000-0000-4000-8000-000000000235";
  const workspaceId = "00000000-0000-4000-8000-000000000236";
  const lesson = { id: lessonId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "lesson", title: "Galeria", state: "draft", revision: 2, payload: { module_record_id: "module", content_type: "gallery" } };
  const stored: Array<{ alt_text?: string; mime_type: string }> = [];
  const client = { async query(sql: string) {
    if (sql.includes("SELECT * FROM extension_records")) return { rows: [lesson] };
    return { rows: [] };
  } };
  const service = new ExtensionRecords({ async one() { return lesson; } } as never,
    { async has() { return true; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
    async storeRecordAttachments(_client: unknown, _recordId: string, _revision: number, _user: string, files: Array<{ alt_text?: string; mime_type: string }>) { stored.push(...files); },
  });
  const body = { operation_key: "00000000-0000-4000-8000-000000000237", expected_revision: 2, file_name: "aula.png", mime_type: "image/png",
    data_base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64") };
  await assert.rejects(service.uploadLessonMaterial(lessonId, "teacher", body), /Descreva a imagem/);
  await assert.rejects(service.uploadLessonMaterial(lessonId, "teacher", { ...body, alt_text: "\u200b\u2069" }), /Descreva a imagem/);
  assert.equal(stored.length, 0);
  await service.uploadLessonMaterial(lessonId, "teacher", { ...body, alt_text: "🧑‍🚀" });
  await service.uploadLessonMaterial(lessonId, "teacher", { ...body, alt_text: "Mapa com a localização da sala prática" });
  assert.deepEqual(stored.map((file) => file.alt_text), ["🧑‍🚀", "Mapa com a localização da sala prática"]);
  assert.equal(stored[0].mime_type, "image/png");
});

test("PDF com revisão de acessibilidade confirmada exige desmarcar antes de incluir outro arquivo", async () => {
  const lesson = {
    id: "00000000-0000-4000-8000-000000000258", workspace_id: "00000000-0000-4000-8000-000000000259",
    plugin_id: "suinda-learning", kind: "lesson", title: "Apostila", state: "draft", revision: 2,
    payload: { module_record_id: "module", content_type: "pdf", document_accessibility_reviewed: true },
  };
  let scans = 0;
  const service = new ExtensionRecords({ async one() { return lesson; } } as never,
    { async has() { return true; }, async audit() {} } as never, learningRegistry(), {
      async scan() { scans++; return "clean"; },
    } as never);
  await assert.rejects(service.uploadLessonMaterial(lesson.id, "teacher", {
    operation_key: "00000000-0000-4000-8000-000000000260", expected_revision: lesson.revision,
    file_name: "apostila.pdf", mime_type: "application/pdf", data_base64: Buffer.from("%PDF-1.4\\n", "ascii").toString("base64"),
  }), /Desmarque e salve a revisão de acessibilidade/);
  assert.equal(scans, 0, "the changed document must not enter storage or scanning under a stale review");
});

test("corrigir descrição de imagem publicada cria revisão e preserva os demais anexos", async () => {
  const lessonId = "00000000-0000-4000-8000-000000000245";
  const workspaceId = "00000000-0000-4000-8000-000000000246";
  const attachmentId = "00000000-0000-4000-8000-000000000247";
  const lesson = { id: lessonId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "lesson", title: "Galeria", state: "published", revision: 4, payload: { module_record_id: "module", content_type: "gallery" } };
  const saved = { ...lesson, revision: 5 };
  const carried: unknown[][] = [];
  const client = { async query(sql: string) {
    if (sql.includes("SELECT id,mime_type FROM extension_record_attachments")) return { rows: [{ id: attachmentId, mime_type: "image/png" }] };
    return { rows: [] };
  } };
  const service = new ExtensionRecords({ async one(sql: string) { return sql.includes("extension_record_attachments") ? { id: attachmentId, mime_type: "image/png" } : lesson; } } as never,
    { async has() { return true; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async assertLessonTeamAccess() {},
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
    async lock() { return lesson; },
    async save(_client: unknown, current: typeof lesson, _user: string, _title: string, _payload: unknown, state: string, reason: string) {
      assert.equal(current.state, "published"); assert.equal(state, "published");
      assert.equal(reason, "Correção da descrição alternativa de imagem para acessibilidade.");
      return saved;
    },
    async carryRecordAttachments(...args: unknown[]) { carried.push(args); return new Map([[attachmentId, "00000000-0000-4000-8000-000000000248"]]); },
  });
  await assert.rejects(service.updateLessonMaterialAltText(lessonId, attachmentId, "teacher", {
    operation_key: "00000000-0000-4000-8000-000000000248", expected_revision: 4, alt_text: "\u200b\u2069",
  }), /Informe uma descrição alternativa/);
  assert.equal(carried.length, 0);
  const result = await service.updateLessonMaterialAltText(lessonId, attachmentId, "teacher", {
    operation_key: "00000000-0000-4000-8000-000000000249", expected_revision: 4, alt_text: "Mapa acessível da sala prática",
  });
  assert.deepEqual(result, { lesson_id: lessonId, revision: 5, attachment_id: "00000000-0000-4000-8000-000000000248", alt_text: "Mapa acessível da sala prática" });
  assert.deepEqual(carried[0]?.slice(0, 4), [client, lessonId, 4, 5]);
  assert.deepEqual(carried[0]?.[4], { attachmentId, altText: "Mapa acessível da sala prática" });
});

test("remediar acessibilidade de vídeo publicado mantém publicação somente após validar transcrição e legenda", async () => {
  const lessonId = "00000000-0000-4000-8000-000000000250";
  const workspaceId = "00000000-0000-4000-8000-000000000251";
  const moduleId = "00000000-0000-4000-8000-000000000252";
  const lesson = { id: lessonId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "lesson", title: "Vídeo legado", state: "published", revision: 4, payload: {
    module_record_id: moduleId, position: 1, content_type: "video", content_url: "https://media.example/video.mp4", transcript: "", transcript_reviewed: false,
    captions_vtt: "", captions_language: "", captions_label: "", captions_reviewed: false, required: true, downloadable: false,
  } };
  const module = { id: moduleId, pluginId: "suinda-learning", kind: "module", state: "published", revision: 1, payload: {} };
  const savedPayloads: Array<Record<string, unknown>> = [];
  const client = { async query() { return { rows: [] }; } };
  const service = new ExtensionRecords({ async one() { return lesson; } } as never,
    { async has() { return true; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async assertLessonTeamAccess() {},
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
    async lock() { return lesson; },
    validationContext() { return { resolveLatestRecord: async (recordId: string) => recordId === moduleId ? module : null }; },
    async save(_client: unknown, current: typeof lesson, _user: string, _title: string, payload: Record<string, unknown>, state: string, reason: string) {
      assert.equal(state, "published");
      assert.equal(reason, "Correção de acessibilidade em conteúdo publicado.");
      savedPayloads.push(payload);
      return { ...current, payload, state, revision: 5 };
    },
    async carryRecordAttachments() { return new Map(); },
  });
  await assert.rejects(service.remediatePublishedLessonAccessibility(lessonId, "teacher", {
    operation_key: "00000000-0000-4000-8000-000000000253", expected_revision: 4, transcript: "Transcrição revisada.",
  }), /Inclua uma faixa de legendas WebVTT/);
  assert.equal(savedPayloads.length, 0);
  await assert.rejects(service.remediatePublishedLessonAccessibility(lessonId, "teacher", {
    operation_key: "00000000-0000-4000-8000-000000000255", expected_revision: 4, transcript: "Transcrição revisada.",
    captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFala revisada.", captions_language: "pt-BR", captions_label: "Português (Brasil)",
  }), /confirme a revisão humana antes de publicar/);
  assert.equal(savedPayloads.length, 0, "changing transcript content invalidates the previous human review");
  await assert.rejects(service.remediatePublishedLessonAccessibility(lessonId, "teacher", {
    operation_key: "00000000-0000-4000-8000-000000000256", expected_revision: 4, transcript: "Transcrição revisada.", transcript_reviewed: true,
    captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFala revisada.", captions_language: "pt-BR", captions_label: "Português (Brasil)",
  }), /Confira cada legenda/);
  assert.equal(savedPayloads.length, 0, "a transcript approval does not substitute for caption review");
  lesson.payload.transcript = "Transcrição revisada.";
  lesson.payload.transcript_reviewed = true;
  lesson.payload.captions_vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nLegenda anterior.";
  lesson.payload.captions_reviewed = true;
  await assert.rejects(service.remediatePublishedLessonAccessibility(lessonId, "teacher", {
    operation_key: "00000000-0000-4000-8000-000000000257", expected_revision: 4,
    captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nLegenda atualizada.", captions_language: "pt-BR", captions_label: "Português (Brasil)",
  }), /Confira cada legenda/);
  assert.equal(savedPayloads.length, 0, "editing WebVTT invalidates its prior human review");
  const result = await service.remediatePublishedLessonAccessibility(lessonId, "teacher", {
    operation_key: "00000000-0000-4000-8000-000000000254", expected_revision: 4, transcript: "Transcrição revisada.",
    transcript_reviewed: true, captions_reviewed: true,
    captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFala revisada.", captions_language: "pt-BR", captions_label: "Português (Brasil)",
  });
  assert.equal(result.revision, 5);
  assert.equal(result.state, "published");
  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0]?.transcript, "Transcrição revisada.");
});

test("a publicação de áudio e vídeo valida transcrição e legendas conforme o player", async () => {
  const definition = suindaRecordKinds.lesson!;
  const moduleId = "00000000-0000-4000-8000-000000000238";
  const context: RecordValidationContext = {
    transition: { from: "draft", to: "published" },
    async resolveRecord() { return null; },
    async resolveLatestRecord(recordId: string) { return recordId === moduleId ? { id: moduleId, pluginId: "suinda-learning", kind: "module", state: "draft", revision: 1, payload: {} } : null; },
  };
  const video = { module_record_id: moduleId, content_type: "video", content_url: "https://cdn.example/aula.mp4", transcript: "Descrição falada da aula." };
  const missingTrack = await definition.validate!(video, context);
  assert.ok(missingTrack.some((issue) => issue.code === "lesson.accessibility_material_missing" && issue.path === "captions_vtt"));
  const accessibleVideo = await definition.validate!({ ...video, transcript_reviewed: true, captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nOlá.\n", captions_language: "pt-BR", captions_label: "Português" }, context);
  assert.ok(accessibleVideo.some((issue) => issue.code === "lesson.accessibility_material_missing" && issue.path === "captions_reviewed"));
  const reviewedVideo = await definition.validate!({ ...video, transcript_reviewed: true, captions_reviewed: true, captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nOlá.\n", captions_language: "pt-BR", captions_label: "Português" }, context);
  assert.deepEqual(reviewedVideo, []);
  const standardWebVtt = await definition.validate!({ ...video, transcript_reviewed: true, captions_reviewed: true,
    captions_vtt: "WEBVTT - Português (Brasil)\nKind: captions\nLanguage: pt-BR\n\nrevisao-1\n00:00:00.000 --> 00:00:02.000 line:90% position:50%,center size:100% align:center\nOlá.\n\nNOTE Revisão editorial\nConfirmada pela equipe.\n\nrevisao-2\n00:00:02.000 --> 00:00:04.000 align:end\nAté logo.\n",
    captions_language: "pt-BR", captions_label: "Português" }, context);
  assert.deepEqual(standardWebVtt, [], "válido com título, IDs de cue, settings e comentário NOTE");
  const invalidWebVttSetting = await definition.validate!({ ...video, captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000 position:120%\nOlá.\n",
    captions_language: "pt-BR", captions_label: "Português" }, context);
  assert.ok(invalidWebVttSetting.some((issue) => issue.code === "lesson.captions_invalid"));
  const mismatchedWebVttLanguage = await definition.validate!({ ...video, captions_vtt: "WEBVTT\nLanguage: en\n\n00:00:00.000 --> 00:00:02.000\nHello.\n",
    captions_language: "pt-BR", captions_label: "Português" }, context);
  assert.ok(mismatchedWebVttLanguage.some((issue) => issue.path === "captions_language"));
  const unsafeTrack = await definition.validate!({ ...video, captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<script>alert(1)</script>\n", captions_language: "pt-BR", captions_label: "Português" }, context);
  assert.ok(unsafeTrack.some((issue) => issue.code === "lesson.captions_invalid" && issue.path === "captions_vtt"));
  const outOfOrderTrack = await definition.validate!({ ...video,
    captions_vtt: "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nSegundo trecho.\n\n00:00:01.000 --> 00:00:03.000\nPrimeiro trecho.\n",
    captions_language: "pt-BR", captions_label: "Português" }, context);
  assert.ok(outOfOrderTrack.some((issue) => issue.code === "lesson.captions_invalid" && issue.path === "captions_vtt"));
  const providerVideo = { module_record_id: moduleId, content_type: "video", content_url: "https://youtu.be/AbCdEf12345", transcript: "Transcrição do vídeo externo.", transcript_reviewed: true };
  const unconfirmedProviderCaptions = await definition.validate!(providerVideo, context);
  assert.ok(unconfirmedProviderCaptions.some((issue) => issue.code === "lesson.accessibility_material_missing" && issue.path === "provider_captions_confirmed"));
  const providerCaptionsUnreviewed = await definition.validate!({ ...providerVideo, provider_captions_confirmed: true }, context);
  assert.ok(providerCaptionsUnreviewed.some((issue) => issue.code === "lesson.accessibility_material_missing" && issue.path === "captions_reviewed"));
  assert.deepEqual(await definition.validate!({ ...providerVideo, provider_captions_confirmed: true, captions_reviewed: true }, context), []);
  const invalidProviderConfirmation = await definition.validate!({ ...video, provider_captions_confirmed: true }, context);
  assert.ok(invalidProviderConfirmation.some((issue) => issue.code === "lesson.provider_captions_invalid"));
  const missingTranscript = await definition.validate!({ module_record_id: moduleId, content_type: "audio", content_url: "https://cdn.example/aula.mp3" }, context);
  assert.ok(missingTranscript.some((issue) => issue.code === "lesson.accessibility_material_missing" && issue.path === "transcript"));
  assert.deepEqual(await definition.validate!({ module_record_id: moduleId, content_type: "audio", content_url: "https://cdn.example/aula.mp3", transcript: "Transcrição do áudio.", transcript_reviewed: true }, context), []);
  const unreviewedTranscript = await definition.validate!({ ...video, captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nOlá.\n", captions_language: "pt-BR", captions_label: "Português" }, context);
  assert.ok(unreviewedTranscript.some((issue) => issue.code === "lesson.accessibility_material_missing" && issue.path === "transcript_reviewed"));
  const draftContext = { ...context, transition: undefined };
  assert.deepEqual(await definition.validate!({ module_record_id: moduleId, content_type: "audio" }, draftContext), []);
  const missingMarkdownAlt = await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "Uma figura: ![ ](https://example.test/figura.png)" }, context);
  assert.ok(missingMarkdownAlt.some((issue) => issue.code === "lesson.markdown_image_alt_missing" && issue.path === "body_markdown"));
  assert.deepEqual(await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "Uma figura: ![Mapa das etapas](https://example.test/figura.png)" }, context), []);
  const missingMarkdownLinkName = await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "[](https://example.test/material)" }, context);
  assert.ok(missingMarkdownLinkName.some((issue) => issue.code === "lesson.markdown_link_name_missing" && issue.path === "body_markdown"));
  const genericMarkdownLinkName = await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "[Clique aqui](https://example.test/material)" }, context);
  assert.deepEqual(genericMarkdownLinkName, [{ severity: "warning", code: "lesson.markdown_link_name_generic", path: "body_markdown",
    message: "1 link usa um rótulo genérico; torne o texto mais específico ou confira se o contexto imediato deixa o destino claro." }]);
  const genericMarkdownAlt = await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "![Imagem](https://example.test/figura.png)" }, context);
  assert.deepEqual(genericMarkdownAlt, [{ severity: "warning", code: "lesson.markdown_image_alt_generic", path: "body_markdown",
    message: "1 imagem no texto usa texto alternativo genérico; descreva o conteúdo ou a finalidade da imagem." }]);
  const decorativeMarkdownImage = await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "![](https://example.test/decorative.png)" }, context);
  assert.deepEqual(decorativeMarkdownImage, [{ severity: "warning", code: "lesson.markdown_image_decorative_alt", path: "body_markdown",
    message: "1 imagem está marcada como decorativa com alt vazio; confirme que não acrescenta informação necessária ao conteúdo." }]);
  assert.deepEqual(await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "[Material complementar](https://example.test/material)" }, context), []);
  assert.deepEqual(await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "# Aula\n\n### Atividade" }, context), [
    { severity: "warning", code: "lesson.markdown_heading_order", path: "body_markdown", message: "1 título(s) saltam um nível na hierarquia; confira se as seções refletem a estrutura do conteúdo." },
  ]);
  const missingTableHeading = await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "|  | Prazo |\n| --- | --- |\n| Aula | Hoje |" }, context);
  assert.ok(missingTableHeading.some((issue) => issue.severity === "error" && issue.code === "lesson.markdown_table_header_missing" && issue.path === "body_markdown"));
  assert.deepEqual(await definition.validate!({ module_record_id: moduleId, content_type: "article",
    body_markdown: "| Etapa | Prazo |\n| --- | --- |\n| Aula | Hoje |" }, context), []);
  const missingDocumentReview = await definition.validate!({ module_record_id: moduleId, content_type: "pdf" }, context);
  assert.ok(missingDocumentReview.some((issue) => issue.severity === "error" && issue.path === "document_accessibility_reviewed"));
  assert.deepEqual(await definition.validate!({ module_record_id: moduleId, content_type: "presentation", document_accessibility_reviewed: true }, context), []);
  const attachedPdfContext: RecordValidationContext = { ...context, async listCurrentRecordAttachments() { return [{ mime_type: "application/pdf" }]; } };
  const attachedPdfWithoutReview = await definition.validate!({ module_record_id: moduleId, content_type: "article" }, attachedPdfContext);
  assert.ok(attachedPdfWithoutReview.some((issue) => issue.severity === "error" && issue.path === "document_accessibility_reviewed"));
  assert.deepEqual(await definition.validate!({ module_record_id: moduleId, content_type: "article", document_accessibility_reviewed: true }, attachedPdfContext), []);
});

test("upload da biblioteca cria registro versionado e anexo validado na mesma operação", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000202";
  const enrollmentId = "00000000-0000-4000-8000-000000000203";
  const workspaceId = "00000000-0000-4000-8000-000000000204";
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId } };
  const db = { async one() { return enrollmentRecord; } };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  const fileData = Buffer.from("%PDF-1.4\n", "ascii");
  const stored: Array<{ id: string; scan_status: string; data: Buffer }> = [];
  const client = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT e.* FROM extension_records e JOIN workspaces")) return { rows: [enrollmentRecord] };
    if (sql.includes("INSERT INTO extension_records")) return { rows: [{ id: "00000000-0000-4000-8000-000000000205", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document", title: values[1], state: "submitted", revision: 1, payload: JSON.parse(String(values[2])) }] };
    return { rows: [] };
  } };
  Object.assign(records, {
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
    async payload(_client: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async snapshot(_client: unknown, record: unknown) { return record; },
    async storeRecordAttachments(_client: unknown, _recordId: string, _revision: number, _user: string, attachments: Array<{ id: string; scan_status: string; data: Buffer }>) { stored.push(...attachments); },
  });
  const result = await records.uploadLearnerDocument(enrollmentId, learnerId, {
    operation_key: "00000000-0000-4000-8000-000000000206", title: "Histórico escolar", category: "education",
    file_name: "historico.pdf", mime_type: "application/pdf", data_base64: fileData.toString("base64"),
  });
  assert.deepEqual(result, { document_id: "00000000-0000-4000-8000-000000000205", revision: 1, title: "Histórico escolar", state: "submitted" });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].data.toString(), fileData.toString());
  assert.equal(stored[0].scan_status, "not_configured");
});

test("documento aprovado pode receber atualização antecipada uma vez na janela de vencimento", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000218";
  const enrollmentId = "00000000-0000-4000-8000-000000000219";
  const documentId = "00000000-0000-4000-8000-000000000220";
  const workspaceId = "00000000-0000-4000-8000-000000000221";
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId } };
  const prior = { id: documentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document", title: "Identificação", state: "approved", revision: 2,
    payload: { learner_user_id: learnerId, enrollment_record_id: enrollmentId, category: "identity", expires_at: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }, renewable: true };
  const renewal: { payload?: Record<string, unknown> } = {};
  const fileData = Buffer.from("%PDF-1.4\n", "ascii");
  const client = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT e.* FROM extension_records e JOIN workspaces")) return { rows: [enrollmentRecord] };
    if (sql.includes("SELECT *, (state=ANY")) { assert.match(sql, /current_date\+30/); return { rows: [prior] }; }
    if (sql.includes("SELECT id FROM extension_records") && sql.includes("renews_document_id"))
      return { rows: renewal.payload ? [{ id: "renewal-1" }] : [] };
    if (sql.includes("INSERT INTO extension_records")) {
      renewal.payload = JSON.parse(String(values[2]));
      return { rows: [{ id: "renewal-1", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document", title: values[1], state: "submitted", revision: 1, payload: renewal.payload }] };
    }
    return { rows: [] };
  } };
  const db = { async one() { return enrollmentRecord; } };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(records, {
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
    async payload(_client: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async snapshot(_client: unknown, record: unknown) { return record; },
    async storeRecordAttachments() {},
  });
  const body = { title: "Documento de identidade", category: "identity", renews_document_id: documentId,
    file_name: "identidade.pdf", mime_type: "application/pdf", data_base64: fileData.toString("base64") };
  const result = await records.uploadLearnerDocument(enrollmentId, learnerId, { ...body, operation_key: "00000000-0000-4000-8000-000000000222" });
  assert.equal(result.state, "submitted");
  assert.equal(renewal.payload?.renews_document_id, documentId);
  await assert.rejects(records.uploadLearnerDocument(enrollmentId, learnerId, { ...body, operation_key: "00000000-0000-4000-8000-000000000223" }), /Já existe uma atualização enviada ou aprovada/);
});

test("revisão de documento exige coordenação, motivo para devolução e grava versão", async () => {
  const managerId = "00000000-0000-4000-8000-000000000207";
  const documentId = "00000000-0000-4000-8000-000000000208";
  const workspaceId = "00000000-0000-4000-8000-000000000209";
  const current = { id: documentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document", title: "Comprovante", state: "submitted", revision: 1, payload: { learner_user_id: "learner", enrollment_record_id: "00000000-0000-4000-8000-000000000210", category: "education", file_name: "doc.pdf", mime_type: "application/pdf", size_bytes: 1, sha256: "a".repeat(64), scan_status: "clean" } };
  const db = { async one() { return { workspace_id: workspaceId }; } };
  const records = new ExtensionRecords(db as never, { async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(records, {
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback({ async query() { return { rows: [] }; } } as never); },
    async lock(_client: unknown, _id: string, expectedRevision: number) { assert.equal(expectedRevision, 1); return current; },
    async save(_client: unknown, record: typeof current, _user: string, _title: string, payload: Record<string, unknown>, state: string) { return { ...record, state, revision: 2, payload }; },
  });
  const result = await records.reviewLearnerDocument(documentId, managerId, {
    operation_key: "00000000-0000-4000-8000-000000000211", expected_revision: 1, decision: "rejected", review_notes: "Envie uma versão legível.",
  });
  assert.equal(result.revision, 2);
  assert.equal(result.state, "rejected");
  await assert.rejects(records.reviewLearnerDocument(documentId, managerId, {
    operation_key: "00000000-0000-4000-8000-000000000212", expected_revision: 1, decision: "rejected",
  }), /Descreva o que precisa ser atualizado/);
});

test("justificativa de falta é privada, exige encontro da matrícula e deixa anexo só para titular/coordenação", async () => {
  const definition = suindaRecordKinds.attendance_justification;
  const enrollmentId = "00000000-0000-4000-8000-000000000231";
  const sessionId = "00000000-0000-4000-8000-000000000232";
  const payload = { enrollment_record_id: enrollmentId, session_record_id: sessionId, learner_user_id: "learner",
    request_key: `${enrollmentId}:${sessionId}`, reason: "Atendimento médico", file_name: "atestado.pdf", mime_type: "application/pdf",
    size_bytes: 100, sha256: "a".repeat(64), scan_status: "clean" };
  const context = {
    actorId: "learner",
    async resolveLatestRecord(id: string) {
      if (id === enrollmentId) return { id, pluginId: "suinda-learning", kind: "enrollment", state: "active", revision: 1, payload: { learner_user_id: "learner", cohort_record_id: cohortId } };
      if (id === sessionId) return { id, pluginId: "suinda-learning", kind: "session", state: "completed", revision: 1, payload: { cohort_record_id: cohortId } };
      return null;
    },
    async hasWorkspacePermission(permission: string) { return permission === "plugin.suinda-learning.manage"; },
  };
  assert.equal(definition.serverCreated, true);
  assert.equal(definition.uniqueFields?.includes("request_key"), true);
  assert.deepEqual(await definition.validate!(payload, context as never), []);
  assert.deepEqual((await definition.validate!(payload, { ...context, actorId: "another-student" } as never)).map((issue) => issue.code), ["attendance_justification_owner_invalid"]);
  assert.equal(await definition.authorizeAttachment!("learner", "read", "submitted", payload, context as never), true);
  assert.equal(await definition.authorizeAttachment!("other", "read", "submitted", payload, { ...context, async hasWorkspacePermission() { return false; } } as never), false);
  const access = new AccessService({} as never);
  access.bindPlugins([suindaPlugin]);
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/enrollments/${enrollmentId}/attendance-justifications`, "GET"), "plugin.suinda-learning.read");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/enrollments/${enrollmentId}/sessions/${sessionId}/attendance-justifications`, "POST"), "plugin.suinda-learning.read");
  assert.equal(access.pluginPermission("/extensions/suinda-learning/me/teaching/attendance-justifications/00000000-0000-4000-8000-000000000233/review", "POST"), "plugin.suinda-learning.manage");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/teaching/sessions/${sessionId}/attendance/zoom-sync`, "POST"), "plugin.suinda-learning.write");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/teaching/sessions/${sessionId}/attendance/google-meet-sync`, "POST"), "plugin.suinda-learning.write");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/teaching/sessions/${sessionId}/attendance/teams-sync`, "POST"), "plugin.suinda-learning.write");
});

test("aprovação da justificativa registra falta justificada na chamada", async () => {
  const managerId = "00000000-0000-4000-8000-000000000241";
  const learnerId = "00000000-0000-4000-8000-000000000242";
  const workspaceId = "00000000-0000-4000-8000-000000000243";
  const enrollmentId = "00000000-0000-4000-8000-000000000244";
  const sessionId = "00000000-0000-4000-8000-000000000245";
  const justificationId = "00000000-0000-4000-8000-000000000246";
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId, cohort_record_id: cohortId, course_record_id: "00000000-0000-4000-8000-000000000138", course_revision: 1 } };
  const sessionRecord = { id: sessionId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Encontro", state: "completed", revision: 1, payload: { cohort_record_id: cohortId, ends_at: "2020-01-02T12:00:00Z" } };
  const current = { id: justificationId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "attendance_justification", title: "Justificativa", state: "submitted", revision: 1,
    payload: { enrollment_record_id: enrollmentId, session_record_id: sessionId, learner_user_id: learnerId, request_key: `${enrollmentId}:${sessionId}`, reason: "Consulta médica", file_name: "atestado.pdf", mime_type: "application/pdf", size_bytes: 100, sha256: "a".repeat(64), scan_status: "clean" } };
  const resolved = [enrollmentRecord, sessionRecord].map((record) => ({ id: record.id, pluginId: record.plugin_id, kind: record.kind, state: record.state, revision: record.revision, payload: record.payload }));
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const client = { async query(sql: string, args: unknown[] = []) {
    statements.push({ sql, args });
    if (sql.includes("kind='enrollment' FOR UPDATE")) return { rows: [enrollmentRecord] };
    if (sql.includes("kind='session' AND state='completed' FOR SHARE")) return { rows: [sessionRecord] };
    if (sql.includes("attendance_key")) return { rows: [] };
    if (sql.includes("SELECT r.id,r.plugin_id AS")) return { rows: [resolved.find((record) => record.id === args[0])].filter(Boolean) };
    if (sql.includes("INSERT INTO extension_records") && sql.includes("'attendance'")) return { rows: [{ id: "00000000-0000-4000-8000-000000000247", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "attendance", title: "Frequência", state: "recorded", revision: 1, payload: JSON.parse(String(args[2])) }] };
    return { rows: [] };
  } };
  const service = new ExtensionRecords({ async one() { return { workspace_id: workspaceId }; } } as never,
    { async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
    async lock(_client: unknown, _id: string, revision: number) { assert.equal(revision, 1); return current; },
    async payload(_client: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async snapshot(_client: unknown, record: unknown) { return record; },
    async save(_client: unknown, record: typeof current, _user: string, _title: string, payload: Record<string, unknown>, state: string) { return { ...record, state, revision: 2, payload }; },
  });
  const result = await service.reviewAttendanceJustification(justificationId, managerId, {
    operation_key: "00000000-0000-4000-8000-000000000248", expected_revision: 1, decision: "approved",
  });
  assert.deepEqual(result, { justification_id: justificationId, revision: 2, state: "approved", attendance_record_id: "00000000-0000-4000-8000-000000000247" });
  const attendanceInsert = statements.find((statement) => statement.sql.includes("INSERT INTO extension_records") && statement.sql.includes("'attendance'"));
  const attendancePayload = JSON.parse(String(attendanceInsert?.args[2]));
  assert.equal(attendancePayload.status, "justified");
  assert.equal(attendancePayload.minutes_attended, 0);
  assert.equal(attendancePayload.justification_record_id, justificationId);
  assert.ok(statements.some((statement) => statement.args[1] === "suinda-learning.attendance-justification.approved"));
});

test("check-in QR verifica geofence, precisão e não persiste coordenadas", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000251";
  const workspaceId = "00000000-0000-4000-8000-000000000252";
  const sessionId = "00000000-0000-4000-8000-000000000253";
  const roomId = "00000000-0000-4000-8000-000000000254";
  const currentCohortId = "00000000-0000-4000-8000-000000000255";
  const enrollmentId = "00000000-0000-4000-8000-000000000256";
  const courseId = "00000000-0000-4000-8000-000000000257";
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-geolocation-secret";
  try {
    const now = Date.now();
    const session = { id: sessionId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Aula presencial",
      state: "live", revision: 1, payload: { starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 3_600_000).toISOString(),
        modality: "in_person", room_record_id: roomId, cohort_record_id: currentCohortId } };
    const room = { id: roomId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "room", title: "Sala A", state: "active", revision: 1,
      payload: { geolocation_required: true, latitude: -8.05, longitude: -34.9, geofence_radius_meters: 100 } };
    const currentCohort = { id: currentCohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma A",
      state: "active", revision: 1, payload: { course_record_id: courseId, course_revision: 1 } };
    const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula",
      state: "active", revision: 1, payload: { learner_user_id: learnerId, cohort_record_id: currentCohortId, course_record_id: courseId,
        course_revision: 1, payment_status: "not_required", amount_due: 0 } };
    const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "in_progress",
      revision: 1, payload: { price_amount: 0 } };
    const resolved = [session, enrollmentRecord].map((record) => ({ id: record.id, pluginId: record.plugin_id, kind: record.kind,
      state: record.state, revision: record.revision, payload: record.payload }));

    async function attempt(latitude: number, longitude: number, accuracy: number, trace?: { insertCount: number }) {
      let insertCount = 0;
      let insertedPayload: Record<string, unknown> | null = null;
      const nonce = randomUUID();
      const expiresAt = Date.now() + 60_000;
      const geolocationBit = "1";
      const signature = createHmac("sha256", process.env.JWT_SECRET!)
        .update(`suinda-checkin:${sessionId}:${expiresAt}:${nonce}:${geolocationBit}`).digest("hex");
      const token = `${expiresAt}.${nonce}.${geolocationBit}.${signature}`;
      const client = { async query(sql: string, values: unknown[] = []) {
        if (sql.includes("kind='session'") && sql.includes("FOR SHARE")) return { rows: [session] };
        if (sql.includes("kind='room'") && sql.includes("FOR SHARE")) return { rows: [room] };
        if (sql.includes("kind='cohort'") && sql.includes("FOR SHARE")) return { rows: [currentCohort] };
        if (sql.includes("kind='enrollment'") && sql.includes("FOR UPDATE")) return { rows: [enrollmentRecord] };
        if (sql.includes("kind='course'") && sql.includes("FOR SHARE")) return { rows: [course] };
        if (sql.includes("attendance_key")) return { rows: [] };
        if (sql.includes("SELECT r.id,r.plugin_id AS")) return { rows: resolved.filter((record) => record.id === values[0]) };
        if (sql.includes("INSERT INTO extension_records") && sql.includes("'attendance'")) {
          insertCount++;
          if (trace) trace.insertCount++;
          insertedPayload = JSON.parse(String(values[2]));
          return { rows: [{ id: "00000000-0000-4000-8000-000000000258", workspace_id: workspaceId, plugin_id: "suinda-learning",
            kind: "attendance", title: "Frequência", state: "recorded", revision: 1, payload: insertedPayload }] };
        }
        return { rows: [] };
      } };
      const service = new ExtensionRecords({ async one() { return session; } } as never, {} as never, learningRegistry(), new DocumentScanner());
      Object.assign(service, {
        async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
        async payload(_client: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
        async snapshot(_client: unknown, record: unknown) { return record; },
      });
      const result = await service.checkinByQr(learnerId, { operation_key: randomUUID(), session_id: sessionId, token,
        latitude, longitude, accuracy_meters: accuracy });
      return { result, insertedPayload, insertCount };
    }

    const accepted = await attempt(-8.05, -34.9, 10);
    assert.equal(accepted.result.geolocation_verified, true);
    assert.equal(accepted.insertCount, 1);
    const acceptedPayload = accepted.insertedPayload as Record<string, unknown> | null;
    assert.ok(acceptedPayload);
    assert.equal(acceptedPayload.checkin_method, "geolocation");
    assert.equal(acceptedPayload.geolocation_verified, true);
    for (const field of ["latitude", "longitude", "accuracy_meters"])
      assert.equal(field in acceptedPayload, false, `${field} must not be persisted`);
    assert.doesNotMatch(JSON.stringify(acceptedPayload), /-8\.05|-34\.9|accuracy_meters/);

    for (const [latitude, longitude, accuracy] of [[-8.04, -34.9, 10], [-8.05, -34.9, 101]]) {
      const trace = { insertCount: 0 };
      await assert.rejects(attempt(latitude, longitude, accuracy, trace), /posição com precisão suficiente|fora do raio permitido/);
      assert.equal(trace.insertCount, 0);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("checklist documental respeita categorias exigidas na revisão da matrícula e validade aprovada", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000221";
  const enrollmentId = "00000000-0000-4000-8000-000000000222";
  const courseId = "00000000-0000-4000-8000-000000000223";
  const workspaceId = "00000000-0000-4000-8000-000000000224";
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 4 } };
  const records = [
    { id: "doc-identity", revision: 2, title: "Identidade", state: "approved", created_at: "2026-01-01", payload: { category: "identity", expires_at: "2099-01-01" } },
    { id: "doc-education", revision: 1, title: "Diploma", state: "submitted", created_at: "2026-01-02", payload: { category: "education" } },
    { id: "doc-expired", revision: 1, title: "Comprovante antigo", state: "approved", created_at: "2026-01-03", payload: { category: "payment", expires_at: "2000-01-01" } },
  ].map((record) => ({ ...record, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document" }));
  const db = {
    async one(sql: string) { return sql.includes("extension_record_versions") ? { payload: { required_document_categories: ["identity", "education", "payment", "enrollment"] } } : enrollmentRecord; },
    async query(sql: string) { return sql.includes("kind='learner_document'") ? records : []; },
  };
  const service = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  const response = await service.learnerDocuments(enrollmentId, learnerId);
  assert.deepEqual(response.checklist.map((item) => [item.category, item.status]), [
    ["identity", "complete"], ["education", "pending"], ["payment", "expired"], ["enrollment", "missing"],
  ]);
  assert.equal(response.course_revision, 4);
  assert.equal(response.documents.length, 3);
});

test("biblioteca do aluno pagina todo o histórico documental e usa registros antigos no checklist", async () => {
  const learnerId = randomUUID();
  const enrollmentId = randomUUID();
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula", state: "active", revision: 1,
    payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 1 } };
  const records = Array.from({ length: 501 }, (_, index) => ({
    id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document",
    title: `Documento ${index + 1}`, state: index === 500 ? "approved" : "rejected", revision: 1,
    created_at: new Date(Date.UTC(2026, 0, 1) + (500 - index) * 1000).toISOString(),
    payload: { learner_user_id: learnerId, enrollment_record_id: enrollmentId,
      ...(index === 500 ? { category: "identity", expires_at: "2099-01-01" } : { category: "other" }) },
  }));
  const pageCursors: Array<[string | null, string | null]> = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM extension_records e JOIN workspaces")) return enrollmentRecord;
      if (sql.includes("FROM extension_record_versions v JOIN extension_records c")) return { payload: { required_document_categories: ["identity"] } };
      return null;
    },
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("kind='learner_document'")) {
        assert.match(sql, /\(created_at,id\)<\(\$4::timestamptz,\$5::uuid\)/);
        const createdAt = values[3] as string | null;
        const cursorId = values[4] as string | null;
        pageCursors.push([createdAt, cursorId]);
        const start = cursorId ? records.findIndex((record) => record.id === cursorId) + 1 : 0;
        return records.slice(start, start + Number(values[5]));
      }
      return [];
    },
  };
  const audited: string[] = [];
  const service = new ExtensionRecords(db as never, { async audit(_actor: string, _action: string, target: string) { audited.push(target); } } as never,
    learningRegistry(), new DocumentScanner());

  const result = await service.learnerDocuments(enrollmentId, learnerId);

  assert.equal(result.documents.length, 501);
  assert.equal(result.documents.at(-1)?.id, records.at(-1)?.id);
  assert.deepEqual(result.checklist.map((item) => [item.category, item.status, item.document_id]), [["identity", "complete", records[500]!.id]]);
  assert.equal(audited.length, 501);
  assert.equal(pageCursors.length, 3);
  assert.deepEqual(pageCursors[0], [null, null]);
  assert.deepEqual(pageCursors[1], [records[199]!.created_at, records[199]!.id]);
  assert.deepEqual(pageCursors[2], [records[399]!.created_at, records[399]!.id]);
});

test("transferência de matrícula exige turma ativa do mesmo curso e revisão com vaga", () => {
  const current = { state: "active", payload: { course_record_id: "course-1", course_revision: 3 } } as const;
  const target = { state: "enrolling", payload: { course_record_id: "course-1", course_revision: 3, capacity: 10 } } as const;
  assert.equal(enrollmentTransferIssue(current, target, 9), null);
  assert.match(enrollmentTransferIssue(current, { ...target, state: "closed" }, 0) || "", /não está aceitando/);
  assert.match(enrollmentTransferIssue(current, { ...target, payload: { ...target.payload, course_record_id: "course-2" } }, 0) || "", /mesmo curso/);
  assert.match(enrollmentTransferIssue(current, { ...target, payload: { ...target.payload, course_revision: 2 } }, 0) || "", /mesmo curso/);
  assert.match(enrollmentTransferIssue(current, target, 10) || "", /capacidade/);
  assert.match(enrollmentTransferIssue({ ...current, state: "withdrawn" }, target, 0) || "", /matrículas vigentes/);
  assert.equal(enrollment.immutablePayloadFieldsAfterInitial?.includes("cohort_record_id"), true);
});

test("transferência por grant de unidade exige gestão na origem e no destino", async () => {
  const userId = "00000000-0000-4000-8000-000000000131";
  const workspaceId = "00000000-0000-4000-8000-000000000132";
  const courseId = "00000000-0000-4000-8000-000000000133";
  const sourceCohortId = "00000000-0000-4000-8000-000000000134";
  const targetCohortId = "00000000-0000-4000-8000-000000000135";
  const enrollmentId = "00000000-0000-4000-8000-000000000136";
  const sourceUnitId = "00000000-0000-4000-8000-000000000137";
  const targetUnitId = "00000000-0000-4000-8000-000000000138";
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", revision: 1, title: "Curso",
    payload: { instructor_ids: [] } };
  const sourceCohort = { id: sourceCohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", revision: 1,
    title: "Origem", state: "active", payload: { course_record_id: courseId, course_revision: 1, institution_unit_record_id: sourceUnitId, instructor_ids: [], tutor_ids: [] } };
  const targetCohort = { id: targetCohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", revision: 2,
    title: "Destino", state: "enrolling", payload: { course_record_id: courseId, course_revision: 1, institution_unit_record_id: targetUnitId, capacity: 10, instructor_ids: [], tutor_ids: [] } };
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", revision: 1,
    title: "Matrícula", state: "active", payload: { course_record_id: courseId, course_revision: 1, cohort_record_id: sourceCohortId,
      institution_unit_record_id: sourceUnitId } };
  const client = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("kind='cohort'")) return { rows: [values[0] === sourceCohortId ? sourceCohort : targetCohort] };
    if (sql.includes("kind='course'")) return { rows: [course] };
    if (sql.includes("COUNT(*)::text AS count")) return { rows: [{ count: "0" }] };
    return { rows: [] };
  } };
  async function attempt(managedRecords: Set<string>) {
    const records = new ExtensionRecords({ async one() { return { workspace_id: workspaceId }; } } as never,
      { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
    Object.assign(records, {
      async mutation(_plugin: string, _workspace: string, _actor: string, _key: unknown, _input: unknown,
        callback: (transaction: never) => Promise<unknown>) { return callback(client as never); },
      async lock() { return enrollmentRecord; },
      async save(_transaction: unknown, current: typeof enrollmentRecord, _actor: string, _title: string, payload: Record<string, unknown>) {
        return { ...current, revision: 2, payload };
      },
    });
    (records as unknown as { unitRecordAccess: { canManageRecord(actor: string, recordId: string): Promise<boolean> } }).unitRecordAccess = {
      async canManageRecord(actor, recordId) { assert.equal(actor, userId); return managedRecords.has(recordId); },
    };
    return records.transferEnrollment(enrollmentId, userId, { operation_key: "00000000-0000-4000-8000-000000000139",
      expected_revision: 1, target_cohort_id: targetCohortId, reason: "Solicitação acadêmica" });
  }
  await assert.rejects(attempt(new Set([enrollmentId])), /gestão das duas unidades/);
  const moved = await attempt(new Set([enrollmentId, targetCohortId]));
  assert.equal(moved.target_cohort_id, targetCohortId);
  assert.equal(moved.state, "active");
});

test("importação CSV valida cabeçalho, contas por linha, aspas e duplicidades", () => {
  assert.deepEqual(parseEnrollmentCsv("email\r\nANA@example.test\r\n\"ana.two@example.test\""), [
    { line: 2, email: "ana@example.test" },
    { line: 3, email: "ana.two@example.test" },
  ]);
  assert.deepEqual(parseEnrollmentCsv("email\nAna@example.test\nana@example.test\nsem-email"), [
    { line: 2, email: "ana@example.test" },
    { line: 3, email: "ana@example.test", issue: "Este e-mail aparece mais de uma vez no arquivo." },
    { line: 4, email: "sem-email", issue: "Informe um endereço de e-mail válido." },
  ]);
  assert.deepEqual(parseCsvRecords('email\n"ana, silva@example.test"'), [
    { line: 1, values: ["email"] }, { line: 2, values: ["ana, silva@example.test"] },
  ]);
  assert.deepEqual(parseCsvRecords("email;nome\nana@example.test;Ana"), [
    { line: 1, values: ["email", "nome"] }, { line: 2, values: ["ana@example.test", "Ana"] },
  ]);
  assert.throws(() => parseEnrollmentCsv("name\nAna"), /coluna obrigatória/);
  assert.throws(() => parseEnrollmentCsv('email\n"ana@example.test'), /aspas não foram fechadas/);
});

test("PDF do certificado inclui QR de validação e código de autenticidade", async () => {
  const pdf = await createCertificatePdf({
    learnerName: "João da Silva",
    courseTitle: "Formação em práticas clínicas",
    certificateCode: "SUINDA-00000000-0000-4000-8000-000000000001",
    workloadHours: 40,
    issuedAt: "2026-10-22T12:00:00.000Z",
    signerNames: ["Coordenação acadêmica"],
    validationUrl: "http://localhost:3003/suinda/certificates/SUINDA-00000000-0000-4000-8000-000000000001",
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 3000);
  assert.ok(pdf.includes(Buffer.from("/Subtype /Image")), "PDF deve embutir a imagem QR da URL de validação");
});

test("PDF permite representar participação parcial com escopo e data de conclusão próprios", async () => {
  const pdf = await createCertificatePdf({
    learnerName: "João da Silva",
    courseTitle: "Formação em práticas clínicas",
    certificateCode: "SUINDA-00000000-0000-4000-8000-000000000009",
    workloadHours: 8,
    issuedAt: "2026-10-22T12:00:00.000Z",
    completedAt: "2026-10-15T12:00:00.000Z",
    signerNames: ["Coordenação acadêmica"],
    certificateKind: "participation",
    participationScope: "Módulos introdutórios e atividade prática supervisionada",
    validationUrl: "http://localhost:3003/suinda/certificates/SUINDA-00000000-0000-4000-8000-000000000009",
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 3000);
  assert.ok(pdf.includes(Buffer.from("/Subtype /Image")), "certificado parcial também deve carregar QR de validação");
  await assert.rejects(() => createCertificatePdf({
    learnerName: "João da Silva", courseTitle: "Formação", certificateCode: "SUINDA-TESTE",
    workloadHours: 8, issuedAt: "2026-10-22T12:00:00.000Z", signerNames: [],
    certificateKind: "participation",
  }), /descrever as atividades abrangidas/);
});

test("PDF de marco intermediário identifica o marco e as aulas cobertas", async () => {
  const pdf = await createCertificatePdf({
    learnerName: "João da Silva", courseTitle: "Formação em práticas clínicas",
    certificateCode: "SUINDA-00000000-0000-4000-8000-000000000010", workloadHours: 2,
    issuedAt: "2026-10-22T12:00:00.000Z", signerNames: ["Coordenação acadêmica"],
    certificateKind: "milestone", milestoneTitle: "Fundamentos", participationScope: "Aula 1, Aula 2",
    validationUrl: "http://localhost:3003/suinda/certificates/SUINDA-00000000-0000-4000-8000-000000000010",
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 2500);
  await assert.rejects(() => createCertificatePdf({
    learnerName: "João da Silva", courseTitle: "Formação", certificateCode: "SUINDA-TESTE",
    workloadHours: 1, issuedAt: "2026-10-22T12:00:00.000Z", signerNames: [], certificateKind: "milestone",
  }), /identificar o marco e as aulas abrangidas/);
});

test("validação pública revela apenas o certificado explicitamente publicado", async () => {
  const certificateCode = "SUINDA-00000000-0000-4000-8000-000000000002";
  const db = {
    async one(_sql: string, values: unknown[]) {
      if (values[0] === certificateCode) return { state: "issued", certificate_code: certificateCode, certificate_kind: "participation", participation_scope: "Módulos introdutórios", completed_at: "2026-09-30T12:00:00Z", learner_name: "Ana Exemplo", course_title: "Curso público", workload_hours: 12, workspace_id: "00000000-0000-4000-8000-000000000003", course_record_id: "00000000-0000-4000-8000-000000000004", course_revision: 1, issued_at: "2026-10-01T12:00:00Z", expires_at: null, signer_names: ["Coordenação"] };
      return null;
    },
  };
  const registry = learningRegistry();
  const service = new ExtensionRecords(db as never, {} as never, registry, new DocumentScanner());
  const result = await service.publicCertificate(certificateCode);
  assert.equal(result.authentic, true);
  assert.equal(result.certificate_kind, "participation");
  assert.equal(result.participation_scope, "Módulos introdutórios");
  assert.equal(result.completed_at, "2026-09-30T12:00:00Z");
  assert.equal(result.learner_name, "Ana Exemplo");
  assert.equal(result.course_title, "Curso público");
  assert.equal("learner_user_id" in result, false);
  const hidden = new ExtensionRecords({ async one() { return null; } } as never, {} as never, registry, new DocumentScanner());
  await assert.rejects(hidden.publicCertificate(certificateCode), /Certificado não encontrado/);
  await assert.rejects(service.publicCertificate("SUINDA-inválido"), /Certificado não encontrado/);
});

test("anexos da entrega ficam com o aluno e docentes atribuídos ao curso ou turma", async () => {
  const courseId = "00000000-0000-4000-8000-000000000131";
  const cohortId = "00000000-0000-4000-8000-000000000132";
  const assessmentId = "00000000-0000-4000-8000-000000000133";
  const learnerId = "00000000-0000-4000-8000-000000000134";
  const courseTeacherId = "00000000-0000-4000-8000-000000000135";
  const cohortTutorId = "00000000-0000-4000-8000-000000000136";
  const records = [
    { id: assessmentId, pluginId: "suinda-learning", kind: "assessment", state: "published", revision: 1, payload: { course_record_id: courseId, cohort_record_id: cohortId } },
    { id: courseId, pluginId: "suinda-learning", kind: "course", state: "published", revision: 1, payload: { instructor_ids: [courseTeacherId] } },
    { id: cohortId, pluginId: "suinda-learning", kind: "cohort", state: "active", revision: 1, payload: { tutor_ids: [cohortTutorId] } },
  ];
  const context: RecordValidationContext = {
    resolveRecord: async () => null,
    listLatestRecords: async (_plugin, kind) => records.filter((record) => record.kind === kind),
  };
  const authorize = suindaRecordKinds.submission.authorizeAttachment!;
  const payload = { assessment_record_id: assessmentId, learner_user_id: learnerId };
  assert.equal(await authorize(learnerId, "upload", "submitted", payload, context), true);
  assert.equal(await authorize(learnerId, "read", "completed", payload, context), true);
  assert.equal(await authorize(courseTeacherId, "read", "submitted", payload, context), true);
  assert.equal(await authorize(cohortTutorId, "read", "submitted", payload, context), true);
  assert.equal(await authorize("00000000-0000-4000-8000-000000000137", "read", "submitted", payload, context), false);
  assert.equal(await authorize(courseTeacherId, "upload", "submitted", payload, context), false);
});

function capacityContext(capacity: number, occupied: number): RecordValidationContext {
  return {
    resolveRecord: async () => null,
    resolveLatestRecord: async (id) => id === cohortId
      ? { id, pluginId: "suinda-learning", kind: "cohort", state: "enrolling", revision: 1, payload: { capacity } }
      : null,
    countLatestRecordsMatchingPayload: async (_plugin, _kind, state) => state === "active" ? occupied : 0,
    nextLatestRecordOrdinal: async () => 1,
  };
}

function openEnrollmentContext(coursePayload: Record<string, unknown>, withCohort = false): RecordValidationContext {
  const course = { id: cohortId, pluginId: "suinda-learning", kind: "course", state: "enrollment_open", revision: 2, payload: coursePayload };
  const cohort = { id: "00000000-0000-4000-8000-000000000002", pluginId: "suinda-learning", kind: "cohort", state: "enrolling", revision: 1, payload: { course_record_id: cohortId, course_revision: 2 } };
  return {
    resolveRecord: async () => course,
    resolveLatestRecord: async (id) => id === cohortId ? course : withCohort && id === cohort.id ? cohort : null,
    hasWorkspacePermission: async () => false,
  };
}

test("não permite aprovar uma matrícula quando a turma atingiu a capacidade", async () => {
  const next = await enrollment.availableTransitions!("submitted", { cohort_record_id: cohortId }, capacityContext(1, 1));
  assert.equal(next.includes("approved"), false);
  assert.equal(next.includes("waitlisted"), true);
});

test("permite aprovar matrícula enquanto há vaga na turma", async () => {
  const next = await enrollment.availableTransitions!("submitted", { cohort_record_id: cohortId }, capacityContext(2, 1));
  assert.equal(next.includes("approved"), true);
  assert.equal(next.includes("waitlisted"), true);
});

test("turma sem limite positivo não bloqueia matrícula por capacidade", async () => {
  const next = await enrollment.availableTransitions!("submitted", { cohort_record_id: cohortId }, capacityContext(0, 500));
  assert.equal(next.includes("approved"), true);
});

test("lista de espera calcula a próxima posição dentro do curso ou turma", async () => {
  const context = capacityContext(3, 0);
  context.nextLatestRecordOrdinal = async () => 5;
  const prepared = await enrollment.prepareTransition!("submitted", "waitlisted", {
    course_record_id: cohortId,
    cohort_record_id: cohortId,
  }, context);
  assert.equal(prepared.waitlist_position, 5);
});

test("validador aceita autoinscrição gratuita aberta e vinculada a turma selecionada", async () => {
  const payload = { course_record_id: cohortId, course_revision: 2, learner_user_id: "learner", institution_referral: "Instituto de exemplo" };
  assert.ok(enrollment.immutablePayloadFieldsAfterInitial?.includes("institution_referral"));
  const openIssues = await enrollment.validate!(payload, openEnrollmentContext({ format: "open", price_amount: 0 }));
  assert.deepEqual(openIssues, []);
  const cohortIdSelected = "00000000-0000-4000-8000-000000000002";
  const cohortPayload = { ...payload, cohort_record_id: cohortIdSelected };
  const cohortIssues = await enrollment.validate!(cohortPayload, openEnrollmentContext({ format: "cohort", price_amount: 0 }, true));
  assert.deepEqual(cohortIssues, []);
});

test("preço da turma substitui o preço do curso ao validar a inscrição", async () => {
  const payload = { course_record_id: cohortId, course_revision: 2, cohort_record_id: "00000000-0000-4000-8000-000000000002", cohort_revision: 1, learner_user_id: "learner" };
  const context = openEnrollmentContext({ format: "cohort", price_amount: 100 }, true);
  context.resolveRecord = async (id) => id === payload.cohort_record_id
    ? { id, pluginId: "suinda-learning", kind: "cohort", state: "enrolling", revision: 1,
      payload: { course_record_id: cohortId, course_revision: 2, price_amount: 0 } }
    : { id: cohortId, pluginId: "suinda-learning", kind: "course", state: "enrollment_open", revision: 2, payload: { format: "cohort", price_amount: 100 } };
  assert.deepEqual(await enrollment.validate!(payload, context), []);
  const paidCohortContext = { ...context, resolveRecord: async (id: string) => id === payload.cohort_record_id
    ? { id, pluginId: "suinda-learning", kind: "cohort", state: "enrolling", revision: 1,
      payload: { course_record_id: cohortId, course_revision: 2, price_amount: 50 } }
    : { id: cohortId, pluginId: "suinda-learning", kind: "course", state: "enrollment_open", revision: 2, payload: { format: "cohort", price_amount: 100 } } };
  const issues = await enrollment.validate!(payload, paidCohortContext);
  assert.ok(issues.some((issue) => issue.code === "payment_required"));
});

test("validador não aceita inscrição paga sem confirmação nem matrícula por turma ausente", async () => {
  const payload = { course_record_id: cohortId, course_revision: 2, learner_user_id: "learner" };
  const paidIssues = await enrollment.validate!(payload, openEnrollmentContext({ format: "open", price_amount: 50 }));
  assert.ok(paidIssues.some((issue) => issue.code === "payment_required"));
  const cohortIssues = await enrollment.validate!(payload, openEnrollmentContext({ format: "cohort", price_amount: 0 }));
  assert.ok(cohortIssues.some((issue) => issue.code === "cohort_required"));
});

test("módulos fixam a versão curricular e conclusões de aula são criadas só pelo plugin", async () => {
  const courseContext: RecordValidationContext = {
    resolveRecord: async () => null,
    resolveLatestRecord: async () => ({ id: cohortId, pluginId: "suinda-learning", kind: "course", state: "enrollment_open", revision: 7, payload: { version: 2 } }),
  };
  assert.deepEqual(await suindaRecordKinds.module.validate!({ course_record_id: cohortId, course_version: 2, position: 1 }, courseContext), []);
  const issues = await suindaRecordKinds.module.validate!({ course_record_id: cohortId, course_version: 1, position: 1 }, courseContext);
  assert.ok(issues.some((issue) => issue.code === "curriculum_version_mismatch"));
  assert.equal(suindaRecordKinds.lesson_progress.serverCreated, true);
});

test("validador de progresso exige matrícula ativa do aluno e chave exata", async () => {
  const enrollmentId = "00000000-0000-4000-8000-000000000071";
  const lessonId = "00000000-0000-4000-8000-000000000072";
  const learnerId = "00000000-0000-4000-8000-000000000073";
  const context: RecordValidationContext = {
    actorId: learnerId,
    resolveRecord: async () => null,
    resolveLatestRecord: async (id) => id === enrollmentId
      ? { id, pluginId: "suinda-learning", kind: "enrollment", state: "active", revision: 1, payload: { learner_user_id: learnerId } }
      : id === lessonId
        ? { id, pluginId: "suinda-learning", kind: "lesson", state: "published", revision: 1, payload: {} }
        : null,
  };
  const payload = {
    enrollment_record_id: enrollmentId, lesson_record_id: lessonId, learner_user_id: learnerId,
    progress_key: `${enrollmentId}:${lessonId}`, completed_at: "2030-01-01T12:00:00Z",
  };
  assert.deepEqual(await suindaRecordKinds.lesson_progress.validate!(payload, context), []);
  const forged = await suindaRecordKinds.lesson_progress.validate!({ ...payload, learner_user_id: "other", progress_key: "forged" }, context);
  assert.ok(forged.some((issue) => issue.code === "learning_owner_mismatch"));
  assert.ok(forged.some((issue) => issue.code === "learning_progress_key_mismatch"));
  context.resolveLatestRecord = async (id) => id === enrollmentId
    ? { id, pluginId: "suinda-learning", kind: "enrollment", state: "submitted", revision: 1, payload: { learner_user_id: learnerId } }
    : { id, pluginId: "suinda-learning", kind: "lesson", state: "published", revision: 1, payload: {} };
  const inactive = await suindaRecordKinds.lesson_progress.validate!(payload, context);
  assert.ok(inactive.some((issue) => issue.code === "learning_enrollment_inactive"));
});

test("avaliação objetiva valida gabarito, sorteio por tentativa e não expõe o banco antes da sessão", async () => {
  const question = { id: "q1", type: "single_choice", prompt: "Qual é a resposta?", points: 2,
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct_option_ids: ["b"] };
  assert.deepEqual(await suindaRecordKinds.assessment.validate!({ question_set: [question] }, { resolveRecord: async () => null }), []);
  const invalidQuestion = await suindaRecordKinds.assessment.validate!({ question_set: [{ ...question, correct_option_ids: ["missing"] }] }, { resolveRecord: async () => null });
  assert.ok(invalidQuestion.some((issue) => issue.code === "assessment_correct_options_invalid"));
  const essayQuestion = { id: "essay-1", type: "essay", prompt: "Explique o conceito com suas palavras.", points: 5, max_length: 5000 };
  assert.deepEqual(await suindaRecordKinds.assessment.validate!({ question_set: [essayQuestion] }, { resolveRecord: async () => null }), []);
  const invalidEssayLength = await suindaRecordKinds.assessment.validate!({ question_set: [{ ...essayQuestion, max_length: 5 }] }, { resolveRecord: async () => null });
  assert.ok(invalidEssayLength.some((issue) => issue.code === "assessment_question_max_length_invalid"));
  const oversizedSample = await suindaRecordKinds.assessment.validate!({ question_set: [question], questions_per_attempt: 2 }, { resolveRecord: async () => null });
  assert.ok(oversizedSample.some((issue) => issue.code === "assessment_question_sample_too_large"));
  const questionBank = [question, { ...question, id: "q2" }, { ...question, id: "q3" }];
  const sampledIds = assessmentQuestionOrder(questionBank, 2, false);
  assert.equal(sampledIds.length, 2);
  assert.equal(new Set(sampledIds).size, 2);
  assert.ok(sampledIds.every((id) => questionBank.some((item) => item.id === id)));
  assert.equal(assessmentQuestionOrder(questionBank, 0, false).length, 3);
  const emptyQuizTransitions = await suindaRecordKinds.assessment.availableTransitions!("draft", { assessment_type: "quiz", question_set: [] }, { resolveRecord: async () => null });
  assert.equal(emptyQuizTransitions.includes("published"), false);

  const learnerId = "00000000-0000-4000-8000-000000000081";
  const enrollmentId = "00000000-0000-4000-8000-000000000082";
  const assessmentId = "00000000-0000-4000-8000-000000000083";
  const courseId = "00000000-0000-4000-8000-000000000085";
  const enrollmentRecord = { id: enrollmentId, workspace_id: "00000000-0000-4000-8000-000000000084", plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 1 } };
  const assessments = Array.from({ length: 301 }, (_, index) => ({
    id: index === 0 ? assessmentId : randomUUID(), title: `Prova ${String(index).padStart(3, "0")}`, state: "published",
    payload: { course_record_id: courseId, instructions: "Responda", max_attempts: 2, passing_score: 70, question_set: [question] },
  }));
  let assessmentQuery = "";
  const db = {
    async one(sql: string) { return sql.includes("JOIN extension_record_versions") ? { payload: { price_amount: 0 } } : enrollmentRecord; },
    async query(sql: string) {
      if (sql.includes("kind='assessment'")) { assessmentQuery = sql; return assessments; }
      return [];
    },
  };
  const registry = learningRegistry();
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, registry, new DocumentScanner());
  const result = await records.learnerAssessments(enrollmentId, learnerId);
  assert.equal(result.length, 301);
  assert.equal(result.at(-1)?.id, assessments.at(-1)?.id);
  assert.doesNotMatch(assessmentQuery, /LIMIT\s+300/i);
  assert.equal(result[0].available, true);
  assert.deepEqual(result[0].payload.question_set, []);
  assert.equal(suindaRecordKinds.assessment_attempt.serverCreated, true);
  assert.equal(await suindaRecordKinds.assessment_session.authorizeRecord!("learner", "read", "started", { learner_user_id: "learner" }, { resolveRecord: async () => null, hasWorkspacePermission: async () => false }), false);
  assert.equal(await suindaRecordKinds.assessment.authorizeRecord!(learnerId, "read", "published", {}, { resolveRecord: async () => null, hasWorkspacePermission: async () => false }), false);
});

test("submissão objetiva corrige no servidor, é idempotente e respeita o limite de tentativas", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000091";
  const enrollmentId = "00000000-0000-4000-8000-000000000092";
  const assessmentId = "00000000-0000-4000-8000-000000000093";
  const workspaceId = "00000000-0000-4000-8000-000000000094";
  const courseId = "00000000-0000-4000-8000-000000000095";
  const question = { id: "q1", type: "single_choice", prompt: "Escolha", points: 1, options: [{ id: "yes", text: "Sim" }, { id: "no", text: "Não" }], correct_option_ids: ["yes"] };
  const secondQuestion = { ...question, id: "q2", prompt: "Outra escolha", correct_option_ids: ["no"] };
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 1 } };
  const assessmentRecord = { id: assessmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment", title: "Quiz", state: "published", revision: 1, payload: { course_record_id: courseId, assessment_type: "quiz", max_attempts: 2, passing_score: 70, time_limit_minutes: 1, questions_per_attempt: 1, randomize_questions: true, randomize_options: true, question_set: [question, secondQuestion] } };
  const sessions: Array<{ id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> }> = [];
  const attempts: Array<{ id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> }> = [];
  const db = {
    async one(sql: string, values: unknown[]) {
      if (sql.includes("JOIN extension_record_versions")) return { payload: { price_amount: 0 } };
      if (sql.includes("kind='assessment_session'") && sql.includes("payload->>'operation_id'")) return sessions.find((session) => session.payload.operation_id === values[1]) || null;
      if (sql.includes("kind='assessment_session'")) return sessions.find((session) => session.id === values[0]) || null;
      if (sql.includes("kind='assessment'")) return assessmentRecord;
      if (sql.includes("kind='assessment_attempt'") && sql.includes("payload->>'operation_id'")) return attempts.find((attempt) => attempt.payload.operation_id === values[1]) || null;
      return enrollmentRecord;
    },
    async query(sql: string) {
      if (sql.includes("kind='assessment'")) return [assessmentRecord];
      if (sql.includes("kind='assessment_session'")) return sessions;
      if (sql.includes("kind='assessment_attempt'")) return attempts;
      return [];
    },
  };
  const registry = learningRegistry();
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, registry, new DocumentScanner());
  let nextAttemptId = 0;
  records.createGenerated = async (_plugin, workspace, _user, body) => {
    const payload = body.payload as Record<string, unknown>;
    const recordId = `00000000-0000-4000-8000-${String(++nextAttemptId).padStart(12, "0")}`;
    const record = { id: recordId, workspace_id: workspace, plugin_id: "suinda-learning", kind: String(body.kind), title: String(body.title), state: String(body.kind) === "assessment_session" ? "started" : "completed", revision: 1, payload };
    (String(body.kind) === "assessment_session" ? sessions : attempts).push(record);
    return record as never;
  };
  const firstStartKey = "00000000-0000-4000-8000-000000000096";
  const firstSession = await records.startAssessment(enrollmentId, assessmentId, learnerId, { operation_key: firstStartKey });
  assert.equal(firstSession.attempt_number, 1);
  assert.ok(Date.parse(String(firstSession.expires_at)) > Date.now());
  const replayedStart = await records.startAssessment(enrollmentId, assessmentId, learnerId, { operation_key: firstStartKey });
  assert.equal(replayedStart.session_id, firstSession.session_id);
  assert.equal(replayedStart.replayed, true);
  assert.equal((sessions[0].payload.question_order as string[]).length, 1);
  assert.equal((await records.learnerAssessments(enrollmentId, learnerId))[0].payload.question_set.length, 1);
  const originalExpiry = sessions[0].payload.expires_at;
  sessions[0].payload.expires_at = "2000-01-01T00:00:00.000Z";
  await assert.rejects(records.submitAssessment(enrollmentId, assessmentId, learnerId, {
    operation_key: "00000000-0000-4000-8000-000000000100", session_id: firstSession.session_id,
    answers: [],
  }), /tempo da avaliação expirou/);
  sessions[0].payload.expires_at = originalExpiry;
  const firstQuestionId = (sessions[0].payload.question_order as string[])[0];
  const firstCorrectOption = firstQuestionId === "q1" ? "yes" : "no";
  const firstWrongOption = firstQuestionId === "q1" ? "no" : "yes";
  const firstKey = "00000000-0000-4000-8000-000000000101";
  await assert.rejects(records.submitAssessment(enrollmentId, assessmentId, learnerId, {
    operation_key: "00000000-0000-4000-8000-000000000105", session_id: firstSession.session_id,
    answers: [{ question_id: firstQuestionId === "q1" ? "q2" : "q1", selected_option_ids: ["yes"] }],
  }), /respostas não correspondem/i);
  const firstBody = { operation_key: firstKey, session_id: firstSession.session_id, answers: [{ question_id: firstQuestionId, selected_option_ids: [firstCorrectOption] }] };
  assert.deepEqual(await records.submitAssessment(enrollmentId, assessmentId, learnerId, firstBody), { ok: true, attempt_number: 1, score: 100, passed: true, grading_status: "completed" });
  assert.deepEqual(await records.submitAssessment(enrollmentId, assessmentId, learnerId, firstBody), { ok: true, attempt_number: 1, score: 100, passed: true, grading_status: "completed", replayed: true });
  await assert.rejects(records.submitAssessment(enrollmentId, assessmentId, learnerId, { ...firstBody, answers: [{ question_id: firstQuestionId, selected_option_ids: [firstWrongOption] }] }), /chave de operação já foi usada/);
  const secondStart = await records.startAssessment(enrollmentId, assessmentId, learnerId, { operation_key: "00000000-0000-4000-8000-000000000102" });
  assert.equal(secondStart.attempt_number, 2);
  const secondQuestionId = (sessions[1].payload.question_order as string[])[0];
  const secondWrongOption = secondQuestionId === "q1" ? "no" : "yes";
  const secondKey = "00000000-0000-4000-8000-000000000103";
  assert.deepEqual(await records.submitAssessment(enrollmentId, assessmentId, learnerId, { operation_key: secondKey, session_id: secondStart.session_id, answers: [{ question_id: secondQuestionId, selected_option_ids: [secondWrongOption] }] }), { ok: true, attempt_number: 2, score: 0, passed: false, grading_status: "completed" });
  await assert.rejects(records.startAssessment(enrollmentId, assessmentId, learnerId, { operation_key: "00000000-0000-4000-8000-000000000104" }), /não está aberta/);
});

test("questão discursiva fica pendente e aguarda nota docente sem expor gabarito", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000191";
  const enrollmentId = "00000000-0000-4000-8000-000000000192";
  const assessmentId = "00000000-0000-4000-8000-000000000193";
  const workspaceId = "00000000-0000-4000-8000-000000000194";
  const courseId = "00000000-0000-4000-8000-000000000195";
  const question = { id: "essay", type: "essay", prompt: "Explique sua resposta.", points: 10, max_length: 5000, rubric: "Clareza e evidências" };
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 1 } };
  const assessmentRecord = { id: assessmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment", title: "Prova discursiva", state: "published", revision: 1, payload: { course_record_id: courseId, assessment_type: "exam", max_attempts: 1, passing_score: 70, questions_per_attempt: 0, randomize_questions: false, question_set: [question] } };
  const sessions: Array<{ id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> }> = [];
  const attempts: Array<{ id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> }> = [];
  const db = {
    async one(sql: string, values: unknown[]) {
      if (sql.includes("JOIN extension_record_versions")) return { payload: { price_amount: 0 } };
      if (sql.includes("kind='assessment_session'") && sql.includes("payload->>'operation_id'")) return sessions.find((record) => record.payload.operation_id === values[1]) || null;
      if (sql.includes("kind='assessment_session'")) return sessions.find((record) => record.id === values[0]) || null;
      if (sql.includes("kind='assessment_attempt'") && sql.includes("payload->>'operation_id'")) return attempts.find((record) => record.payload.operation_id === values[1]) || null;
      if (sql.includes("kind='assessment'")) return assessmentRecord;
      return enrollmentRecord;
    },
    async query(sql: string) {
      if (sql.includes("kind='assessment'")) return [assessmentRecord];
      if (sql.includes("kind='assessment_session'")) return sessions;
      if (sql.includes("kind='assessment_attempt'")) return attempts;
      return [];
    },
  };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  let nextId = 0;
  records.createGenerated = async (_plugin, workspace, _user, body) => {
    const record = { id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`, workspace_id: workspace,
      plugin_id: "suinda-learning", kind: String(body.kind), title: String(body.title), state: String(body.initial_state || (body.kind === "assessment_session" ? "started" : "submitted")), revision: 1,
      payload: body.payload as Record<string, unknown> };
    (body.kind === "assessment_session" ? sessions : attempts).push(record);
    return record as never;
  };
  const session = await records.startAssessment(enrollmentId, assessmentId, learnerId, { operation_key: "00000000-0000-4000-8000-000000000196" });
  const result = await records.submitAssessment(enrollmentId, assessmentId, learnerId, { operation_key: "00000000-0000-4000-8000-000000000197", session_id: session.session_id,
    answers: [{ question_id: "essay", answer: "Minha explicação com evidências." }] });
  assert.deepEqual(result, { ok: true, attempt_number: 1, score: undefined, passed: undefined, grading_status: "pending" });
  assert.equal(attempts[0].state, "submitted");
  assert.equal(attempts[0].payload.grading_status, "pending");
  const savedAnswers = attempts[0].payload.answers as Array<Record<string, unknown>>;
  assert.equal(savedAnswers[0].answer, "Minha explicação com evidências.");
  assert.equal(Object.hasOwn(savedAnswers[0], "correct_option_ids"), false);
});

test("correção discursiva valida docente e calcula nota sobre questões objetivas e manuais", async () => {
  const teacherId = "00000000-0000-4000-8000-000000000201";
  const unitManagerId = "00000000-0000-4000-8000-000000000213";
  const workspaceId = "00000000-0000-4000-8000-000000000202";
  const courseId = "00000000-0000-4000-8000-000000000203";
  const assessmentId = "00000000-0000-4000-8000-000000000204";
  const attemptId = "00000000-0000-4000-8000-000000000205";
  const attempt = { id: attemptId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment_attempt", title: "Tentativa 1", state: "submitted", revision: 1,
    payload: { assessment_record_id: assessmentId, session_record_id: "00000000-0000-4000-8000-000000000206", enrollment_record_id: "00000000-0000-4000-8000-000000000207",
      learner_user_id: "00000000-0000-4000-8000-000000000208", attempt_number: 1, attempt_key: "attempt:1", operation_id: "00000000-0000-4000-8000-000000000209",
      request_hash: "a".repeat(64), submitted_at: "2030-01-01T12:00:00.000Z", passing_score: 70, grading_status: "pending",
      answers: [{ question_id: "objective", question_type: "single_choice", prompt: "Objetiva", points: 10, selected_option_ids: ["correct"], earned_points: 5 },
        { question_id: "essay", question_type: "essay", prompt: "Discursiva", points: 10, answer: "Resposta" }] } };
  const assessment = { id: assessmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment", title: "Avaliação", state: "published", revision: 3, payload: { course_record_id: courseId, assessment_type: "exam", passing_score: 70 } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "published", revision: 1, payload: { instructor_ids: [teacherId] } };
  const db = { async one() { return { workspace_id: workspaceId }; } };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { canManageRecord(user: string, recordId: string): Promise<boolean> } }).unitRecordAccess = {
    async canManageRecord(user, recordId) { return user === unitManagerId && recordId === attemptId; },
  };
  const internals = records as unknown as {
    mutation: (plugin: string, workspace: string, user: string, key: unknown, input: unknown, callback: (client: never) => Promise<unknown>) => Promise<unknown>;
    lock: (client: never, recordId: string, revision: number) => Promise<typeof attempt>;
    save: (client: never, current: typeof attempt, user: string, title: string, payload: Record<string, unknown>, state: string, reason: string) => Promise<typeof attempt>;
  };
  internals.mutation = async (_plugin, _workspace, _user, _key, _input, callback) => callback({ async query(sql: string) {
    if (sql.includes("kind='assessment'")) return { rows: [assessment] };
    if (sql.includes("kind='course'")) return { rows: [course] };
    return { rows: [] };
  } } as never);
  internals.lock = async (_client, recordId, revision) => {
    assert.equal(recordId, attemptId); assert.equal(revision, 1); return attempt;
  };
  internals.save = async (_client, current, _user, _title, payload, state) => {
    Object.assign(current, { payload, state, revision: current.revision + 1 }); return current;
  };
  await assert.rejects(records.gradeAssessmentAttempt(attemptId, "00000000-0000-4000-8000-000000000211", { operation_key: "00000000-0000-4000-8000-000000000212", expected_revision: 1,
    question_grades: [{ question_id: "essay", score: 10 }] }), /não está atribuída/);
  const result = await records.gradeAssessmentAttempt(attemptId, unitManagerId, { operation_key: "00000000-0000-4000-8000-000000000210", expected_revision: 1,
    question_grades: [{ question_id: "essay", score: 8, feedback: "Boa justificativa." }], feedback: "Resultado geral." });
  assert.deepEqual(result, { attempt_id: attemptId, revision: 3, score: 65, passed: false, graded_at: (attempt.payload as Record<string, unknown>).graded_at });
  const gradedAnswers = attempt.payload.answers as Array<Record<string, unknown>>;
  assert.equal(gradedAnswers[1].score, 8);
  assert.equal(gradedAnswers[1].feedback, "Boa justificativa.");
  assert.equal(attempt.payload.grading_status, "completed");
});

test("correção de entrega em grupo exige grant em cada matrícula e unidade efetiva", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000261";
  const courseId = "00000000-0000-4000-8000-000000000262";
  const assessmentId = "00000000-0000-4000-8000-000000000263";
  const submissionId = "00000000-0000-4000-8000-000000000264";
  const learners = ["00000000-0000-4000-8000-000000000265", "00000000-0000-4000-8000-000000000266"];
  const enrollments = learners.map((learnerId, index) => ({ id: `00000000-0000-4000-8000-00000000026${7 + index}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1,
    payload: { learner_user_id: learnerId, course_record_id: courseId } }));
  const submission = { id: submissionId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "submission", title: "Entrega em grupo", state: "submitted", revision: 1,
    payload: { assessment_record_id: assessmentId, learner_user_id: learners[0], group_member_user_ids: learners, rubric_snapshot: [], version: 1 } };
  const assessment = { id: assessmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment", title: "Atividade", state: "published", revision: 1,
    payload: { course_record_id: courseId, assessment_type: "assignment" } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "published", revision: 1, payload: {} };
  const records = new ExtensionRecords({ async one() { return { workspace_id: workspaceId }; } } as never,
    { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  let granted = new Set([enrollments[0]!.id]);
  (records as unknown as { unitRecordAccess: { canManageRecord(actor: string, recordId: string): Promise<boolean> } }).unitRecordAccess = {
    async canManageRecord(_actor, recordId) { return granted.has(recordId); },
  };
  const internals = records as unknown as {
    mutation: (plugin: string, workspace: string, user: string, key: unknown, input: unknown, callback: (client: never) => Promise<unknown>) => Promise<unknown>;
    lock: (client: never, recordId: string, revision: number) => Promise<typeof submission>;
    save: (client: never, current: typeof submission, user: string, title: string, payload: Record<string, unknown>, state: string) => Promise<typeof submission>;
  };
  internals.mutation = async (_plugin, _workspace, _user, _key, _input, callback) => callback({ async query(sql: string) {
    if (sql.includes("kind='assessment'")) return { rows: [assessment] };
    if (sql.includes("kind='course'")) return { rows: [course] };
    if (sql.includes("kind='cohort'")) return { rows: [] };
    if (sql.includes("kind='enrollment'")) return { rows: enrollments };
    return { rows: [] };
  } } as never);
  internals.lock = async (_client, recordId, revision) => { assert.equal(recordId, submissionId); assert.equal(revision, 1); return submission; };
  internals.save = async (_client, current, _user, _title, payload, state) => {
    Object.assign(current, { payload, state, revision: current.revision + 1 }); return current;
  };
  const grade = (key: string) => records.gradeTeachingSubmission(submissionId, "unit-manager", {
    operation_key: key, expected_revision: 1, score: 90, final_state: "completed",
  });
  await assert.rejects(grade("00000000-0000-4000-8000-000000000269"), /todas as unidades das pessoas do grupo/);
  granted = new Set(enrollments.map((entry) => entry.id));
  const result = await grade("00000000-0000-4000-8000-000000000270");
  assert.equal(result.state, "completed");
});

test("prática supervisionada percorre envio, devolução, reenvio e validação limitada às horas declaradas", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000221";
  const teacherId = "00000000-0000-4000-8000-000000000222";
  const enrollmentId = "00000000-0000-4000-8000-000000000223";
  const practiceId = "00000000-0000-4000-8000-000000000224";
  const workspaceId = "00000000-0000-4000-8000-000000000225";
  const courseId = "00000000-0000-4000-8000-000000000226";
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId, course_record_id: courseId } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "published", revision: 1, payload: { instructor_ids: [teacherId] } };
  type TestPractice = { id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> };
  const practice: TestPractice = { id: practiceId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "practice", title: "Prática supervisionada", state: "in_progress", revision: 1,
    payload: { enrollment_record_id: enrollmentId, learner_user_id: learnerId, supervisor_user_id: teacherId,
      scheduled_at: "2030-01-01T12:00:00.000Z", activity_description: "Atendimento supervisionado", hours_claimed: 0,
      hours_validated: 0, validation_outcome: "pending" } };
  const db = { async one(sql: string) { return sql.includes("SELECT workspace_id") ? { workspace_id: workspaceId } : practice; } };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  const internals = records as unknown as {
    mutation: (plugin: string, workspace: string, user: string, key: unknown, input: unknown, callback: (client: never) => Promise<unknown>) => Promise<unknown>;
    lock: (client: never, recordId: string, revision: number) => Promise<TestPractice>;
    save: (client: never, current: TestPractice, user: string, title: string, payload: Record<string, unknown>, state: string, reason: string) => Promise<TestPractice>;
  };
  internals.mutation = async (_plugin, _workspace, _user, _key, _input, callback) => callback({ async query(sql: string) {
    if (sql.includes("kind='enrollment'")) return { rows: [enrollmentRecord] };
    if (sql.includes("kind='course'")) return { rows: [course] };
    return { rows: [] };
  } } as never);
  internals.lock = async (_client, recordId, revision) => { assert.equal(recordId, practiceId); assert.equal(revision, practice.revision); return practice; };
  internals.save = async (_client, current, _user, _title, payload, state) => {
    Object.assign(current, { payload, state, revision: current.revision + 1 }); return current;
  };
  const submit = (revision: number, key: string) => records.submitSupervisedPractice(enrollmentId, practiceId, learnerId,
    { operation_key: key, expected_revision: revision, hours_claimed: 8, completion_notes: "Acompanhei três atendimentos." });
  await submit(1, "00000000-0000-4000-8000-000000000227");
  assert.equal(practice.state, "submitted");
  await records.reviewSupervisedPractice(practiceId, teacherId, { operation_key: "00000000-0000-4000-8000-000000000228", expected_revision: 2,
    decision: "rejected", feedback: "Inclua a reflexão técnica." });
  assert.equal(practice.state, "needs_correction");
  await submit(3, "00000000-0000-4000-8000-000000000229");
  assert.equal(practice.state, "submitted");
  await assert.rejects(records.reviewSupervisedPractice(practiceId, teacherId, { operation_key: "00000000-0000-4000-8000-000000000230", expected_revision: 4,
    decision: "approved", hours_validated: 9 }), /não podem exceder/);
  const result = await records.reviewSupervisedPractice(practiceId, teacherId, { operation_key: "00000000-0000-4000-8000-000000000231", expected_revision: 4,
    decision: "approved", hours_validated: 7, feedback: "Prática validada." });
  assert.equal(practice.state, "validated");
  assert.equal(practice.payload.hours_validated, 7);
  assert.deepEqual(result, { practice_id: practiceId, revision: 5, state: "validated", hours_validated: 7, validation_outcome: "approved", reviewed_at: practice.payload.reviewed_at });
});

test("atividade individual registra atraso no servidor e impede envio duplicado", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000121";
  const enrollmentId = "00000000-0000-4000-8000-000000000122";
  const assessmentId = "00000000-0000-4000-8000-000000000123";
  const workspaceId = "00000000-0000-4000-8000-000000000124";
  const courseId = "00000000-0000-4000-8000-000000000125";
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 1 } };
  const assessmentRecord = { id: assessmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment", title: "Reflexão", state: "published", revision: 1, payload: { course_record_id: courseId, assessment_type: "assignment", due_at: "2020-01-01T00:00:00.000Z", group_submission: false } };
  const submissions: Array<{ id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> }> = [];
  const storedAttachments: unknown[][] = [];
  const db = {
    pool: { async connect() { return {
      async query(sql: string, values: unknown[] = []) {
        if (sql.includes("kind='enrollment'")) return { rows: [enrollmentRecord] };
        if (sql.includes("kind='assessment'")) return { rows: [assessmentRecord] };
        if (sql.includes("SELECT plugin_id,kind FROM extension_records")) return { rows: [{ plugin_id: "suinda-learning", kind: "submission" }] };
        if (sql.includes("INSERT INTO extension_record_attachments")) { storedAttachments.push(values); return { rows: [] }; }
        if (sql.includes("INSERT INTO extension_records")) {
          const row = { id: "00000000-0000-4000-8000-000000000126", workspace_id: values[0], plugin_id: "suinda-learning", kind: "submission", title: values[1], state: values[2], revision: 1, payload: JSON.parse(String(values[3])) };
          submissions.push(row as never);
          return { rows: [row] };
        }
        if (sql.includes("kind='submission'") && sql.includes("payload->>'assessment_record_id'")) return { rows: submissions };
        return { rows: [] };
      }, release() {},
    }; } },
    async one(sql: string) {
      if (sql.includes("kind='assessment'")) return assessmentRecord;
      return enrollmentRecord;
    },
    async query() { return []; },
  };
  const registry = learningRegistry();
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async hasScoped() { return false; }, async audit() {} } as never, registry, new DocumentScanner());
  const priorEncryptionKey = process.env.ORBIT_DATA_ENCRYPTION_KEY;
  process.env.ORBIT_DATA_ENCRYPTION_KEY = "suinda-attachment-test-key-with-adequate-entropy";
  let result: Awaited<ReturnType<typeof records.submitLearningAssignment>>;
  try {
    result = await records.submitLearningAssignment(enrollmentId, assessmentId, learnerId, {
      operation_key: "00000000-0000-4000-8000-000000000127", answer: "Resposta do aluno; o prazo não veio do navegador.",
      attachments: [{ file_name: "resposta.txt", mime_type: "text/plain", data_base64: "UmVzcG9zdGE=" }],
    });
  } finally {
    if (priorEncryptionKey === undefined) delete process.env.ORBIT_DATA_ENCRYPTION_KEY;
    else process.env.ORBIT_DATA_ENCRYPTION_KEY = priorEncryptionKey;
  }
  assert.equal(result.state, "late");
  assert.equal(result.late, true);
  assert.equal(typeof submissions[0].payload.submitted_at, "string");
  assert.equal(storedAttachments.length, 1);
  assert.equal(storedAttachments[0][1], submissions[0].id);
  assert.equal(storedAttachments[0][2], submissions[0].revision);
  assert.equal(storedAttachments[0][3], "resposta.txt");
  assert.equal(isProtectedAttachmentEnvelope(storedAttachments[0][8] as Buffer), true);
  assert.deepEqual(submissions[0].payload.files, [storedAttachments[0][0]]);
  await assert.rejects(records.submitLearningAssignment(enrollmentId, assessmentId, learnerId, {
    operation_key: "00000000-0000-4000-8000-000000000128", answer: "Segunda entrega não autorizada.",
  }), /já foi enviada/);
});

test("pedido de reposição reserva apenas vaga futura e rejeita capacidade esgotada", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000131";
  const enrollmentId = "00000000-0000-4000-8000-000000000132";
  const originalId = "00000000-0000-4000-8000-000000000133";
  const workspaceId = "00000000-0000-4000-8000-000000000134";
  const slotId = "00000000-0000-4000-8000-000000000135";
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId, cohort_record_id: cohortId, course_record_id: "00000000-0000-4000-8000-000000000138", course_revision: 1 } };
  const original = { id: originalId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Encontro perdido", state: "completed", revision: 1, payload: { cohort_record_id: cohortId, ends_at: "2026-01-01T12:00:00Z" } };
  const slot = { id: slotId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Reposição", state: "scheduled", revision: 1, payload: { cohort_record_id: cohortId, session_type: "makeup", replacement_session_record_id: originalId, makeup_capacity: 1, starts_at: "2099-01-01T12:00:00Z" } };
  const operationKey = "00000000-0000-4000-8000-000000000136";
  async function submitWithReservations(reserved: number) {
    const insertedPayloads: Array<Record<string, unknown>> = [];
    const client = { async query(sql: string, values: unknown[] = []) {
      if (sql.includes("kind='session'") && sql.includes("state='completed'")) return { rows: [original] };
      if (sql.includes("kind='attendance'")) return { rows: [{ state: "recorded", payload: { status: "absent", minutes_attended: 0 } }] };
      if (sql.includes("kind='attendance_justification'")) return { rows: [] };
      if (sql.includes("kind='session'") && sql.includes("state='scheduled'")) return { rows: [slot] };
      if (sql.includes("COUNT(*)::int AS count")) return { rows: [{ count: reserved }] };
      if (sql.includes("kind='makeup_request'")) return { rows: [] };
      if (sql.includes("INSERT INTO extension_records") && sql.includes("'makeup_request'")) {
        const payload = JSON.parse(String(values[2])) as Record<string, unknown>;
        insertedPayloads.push(payload);
        return { rows: [{ id: "00000000-0000-4000-8000-000000000137", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "makeup_request", title: values[1], state: "submitted", revision: 1, payload }] };
      }
      return { rows: [] };
    } };
    const db = { async one(sql: string) { return sql.includes("kind='enrollment'") ? enrollmentRecord : sql.includes("extension_record_versions") ? { payload: { makeup_fee_amount: 0, currency: "BRL" } } : original; } };
    const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
    Object.assign(records, {
      async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (client: never) => Promise<unknown>) { return callback(client as never); },
      async lock() { return enrollmentRecord; },
      async payload(_client: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
      async snapshot(_client: unknown, record: unknown) { return record; },
    });
    const result = await records.submitMakeupRequest(enrollmentId, originalId, learnerId, {
      operation_key: operationKey, reason: "Solicito reposição", replacement_session_id: slotId,
    });
    return { result, insertedPayload: insertedPayloads[0] };
  }
  const booked = await submitWithReservations(0);
  assert.equal(booked.insertedPayload?.replacement_session_record_id, slotId);
  assert.equal(booked.result.state, "submitted");
  await assert.rejects(submitWithReservations(1), /Todas as vagas deste horário/);
});

test("painel docente agrega somente cursos, turmas, encontros e alunos atribuídos à unidade", async () => {
  const teacherId = "00000000-0000-4000-8000-000000000111";
  const courseId = "00000000-0000-4000-8000-000000000112";
  const cohortId = "00000000-0000-4000-8000-000000000113";
  const unitId = "00000000-0000-4000-8000-000000000120";
  const unitBId = "00000000-0000-4000-8000-000000000121";
  const cohortBId = "00000000-0000-4000-8000-000000000122";
  const course = { id: courseId, workspace_id: "00000000-0000-4000-8000-000000000114", plugin_id: "suinda-learning", kind: "course", title: "Curso da unidade", state: "in_progress", revision: 1, payload: { institution_unit_record_id: unitId, modality: "online" } };
  const cohort = { id: cohortId, workspace_id: course.workspace_id, plugin_id: "suinda-learning", kind: "cohort", title: "Turma da unidade", state: "active", revision: 1, payload: { course_record_id: courseId, institution_unit_record_id: unitId, starts_at: "2030-01-01T12:00:00Z", ends_at: "2030-02-01T12:00:00Z", capacity: 20 } };
  const cohortB = { ...cohort, id: cohortBId, title: "Turma da outra unidade", payload: { ...cohort.payload, institution_unit_record_id: unitBId } };
  const session = { id: "00000000-0000-4000-8000-000000000115", workspace_id: course.workspace_id, plugin_id: "suinda-learning", kind: "session", title: "Encontro 1", state: "scheduled", revision: 1, payload: { cohort_record_id: cohortId, instructor_user_id: teacherId, starts_at: "2030-01-02T12:00:00Z", ends_at: "2030-01-02T13:00:00Z", modality: "online" } };
  const module = { id: "00000000-0000-4000-8000-000000000118", workspace_id: course.workspace_id, plugin_id: "suinda-learning", kind: "module", title: "Módulo 1", state: "published", revision: 1, payload: { course_record_id: courseId } };
  const lesson = { id: "00000000-0000-4000-8000-000000000119", workspace_id: course.workspace_id, plugin_id: "suinda-learning", kind: "lesson", title: "Aula atribuída", state: "published", revision: 2, payload: { module_record_id: module.id, content_type: "video", content_url: "https://media.example/video.mp4", body_markdown: "[](https://example.test/material)", transcript: "Transcrição revisada", transcript_reviewed: true, captions_vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFala revisada.\n" } };
  const learner = { id: "00000000-0000-4000-8000-000000000116", workspace_id: course.workspace_id, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1, learner_name: "Aluna Exemplo", payload: { learner_user_id: "00000000-0000-4000-8000-000000000117", course_record_id: courseId, cohort_record_id: cohortId, attendance_percent: 90 } };
  const attendanceRecords = Array.from({ length: 1001 }, (_, index) => ({
    id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, workspace_id: course.workspace_id,
    plugin_id: "suinda-learning", kind: "attendance", title: `Frequência ${index + 1}`, state: "recorded", revision: 1,
    payload: { session_record_id: session.id, enrollment_record_id: learner.id, learner_user_id: learner.payload.learner_user_id,
      status: "present", minutes_attended: 60 },
  }));
  const makeupRequests = Array.from({ length: 1001 }, (_, index) => ({
    id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, workspace_id: course.workspace_id,
    plugin_id: "suinda-learning", kind: "makeup_request", title: `Reposição ${index + 1}`, state: "scheduled", revision: 1,
    learner_name: `Aluno ${index + 1}`, enrollment_revision: 1, enrollment_title: "Matrícula", enrollment_state: "active",
    original_session_title: "Encontro original", source_cohort_title: "Turma da unidade", source_cohort_code: "A",
    payload: { replacement_session_record_id: session.id, original_session_record_id: session.id,
      enrollment_record_id: learner.id, learner_user_id: learner.payload.learner_user_id },
  }));
  const announcements = Array.from({ length: 201 }, (_, index) => ({
    id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: course.workspace_id, plugin_id: "suinda-learning", kind: "announcement", title: `Aviso ${index + 1}`,
    state: "sent", revision: 1,
    payload: { audience_type: "cohort", audience_record_id: cohortId, requires_read_confirmation: true,
      channel: "internal", sent_at: "2030-01-01T12:00:00.000Z" },
  }));
  const announcementCursors: Array<{ sentAt: string | null; id: string | null }> = [];
  const directUnitOverride = { ...learner, id: "00000000-0000-4000-8000-000000000123", learner_name: "Matrícula com unidade direta B", payload: { ...learner.payload, institution_unit_record_id: unitBId } };
  const cohortBEnrollment = { ...learner, id: "00000000-0000-4000-8000-000000000124", learner_name: "Matrícula da turma B", payload: { ...learner.payload, cohort_record_id: cohortBId } };
  const audits: string[] = [];
  const reviewQueueSql: string[] = [];
  const attendanceScopeSql: string[] = [];
  const db = { async query(sql: string, values: unknown[]) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    if (sql.includes("r.kind='course'")) {
      assert.match(sql, /instructor_ids/); assert.match(sql, /tutor_ids/);
      assert.match(sql, /institution_unit_record_id/);
      assert.match(sql, /r\.updated_at<\$4::timestamptz/);
      assert.match(sql, /ORDER BY r\.updated_at DESC,r\.id LIMIT \$6/);
      assert.deepEqual(values.slice(0, 3), [teacherId, [], [unitId]]); return [course];
    }
    if (sql.includes("kind='module'")) { assert.deepEqual(values, [[courseId], null, null, 1000]); return [module]; }
    if (sql.includes("kind='lesson'")) { assert.deepEqual(values, [[module.id], null, 2000]); return [lesson]; }
    if (sql.includes("FROM extension_record_attachments f JOIN extension_records l")) {
      assert.deepEqual(values, [[lesson.id], [lesson.revision]]);
      assert.match(sql, /f\.alt_text/);
      return [{ record_id: lesson.id, revision: lesson.revision, id: "attachment-1", file_name: "aula.pdf", mime_type: "application/pdf", size_bytes: 1024, scan_status: "clean", alt_text: null }];
    }
    if (sql.includes("r.kind='cohort'")) {
      assert.deepEqual(values, [teacherId, [], [], [unitId], null, 300]);
      return [cohort];
    }
    if (sql.includes("r.kind='session'")) {
      assert.deepEqual(values, [teacherId, [cohortId], [], null, 500]);
      return [session];
    }
    if (sql.includes("r.kind='makeup_request'") && sql.includes("target.id=ANY($1::uuid[])")) {
      attendanceScopeSql.push(sql);
      return /LIMIT\s+1000/i.test(sql) ? makeupRequests.slice(0, 1000) : makeupRequests;
    }
    if (sql.includes("WHERE r.plugin_id='suinda-learning' AND r.kind='attendance'")) {
      attendanceScopeSql.push(sql);
      return /LIMIT\s+1000/i.test(sql) ? attendanceRecords.slice(0, 1000) : attendanceRecords;
    }
    if (sql.includes("SELECT e.*,u.name AS learner_name FROM extension_records e")) {
      reviewQueueSql.push(sql);
      const cohortUnit = new Map([[cohortId, unitId], [cohortBId, unitBId]]);
      const effectiveUnit = (record: { payload: Record<string, unknown> }) => record.payload.institution_unit_record_id || cohortUnit.get(String(record.payload.cohort_record_id)) || course.payload.institution_unit_record_id;
      return [learner, directUnitOverride, cohortBEnrollment].filter((record) => effectiveUnit(record) === unitId);
    }
    if (sql.includes("kind='announcement'")) {
      const sentAt = values[1] as string | null;
      const cursorId = values[2] as string | null;
      announcementCursors.push({ sentAt, id: cursorId });
      assert.match(sql, /audience_record_id'=ANY\(\$1::text\[\]\)/);
      assert.match(sql, /ORDER BY COALESCE\(NULLIF\(payload->>'sent_at'/);
      return announcements.filter((item) => sentAt === null || item.payload.sent_at < sentAt
        || item.payload.sent_at === sentAt && item.id < cursorId!).sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, Number(values[3])).map((item) => ({ ...item, page_sent_at: item.payload.sent_at }));
    }
    if (sql.includes("kind='announcement_read_receipt'")) return [];
    if (sql.includes("kind='submission'")) { reviewQueueSql.push(sql); return []; }
    if (sql.includes("kind='assessment_attempt'")) { reviewQueueSql.push(sql); return []; }
    if (sql.includes("kind='learner_document'")) { reviewQueueSql.push(sql); return []; }
    if (sql.includes("kind='attendance_justification'")) { reviewQueueSql.push(sql); return []; }
    if (sql.includes("kind='makeup_request'") && sql.includes("fee_status")) { reviewQueueSql.push(sql); return []; }
    if (sql.includes("p.kind='practice'")) { reviewQueueSql.push(sql); return []; }
    return [];
  } };
  const registry = learningRegistry();
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async hasScoped() { return false; }, async audit(_actor: string, action: string, target: string) { assert.ok(["suinda-learning.teaching.read", "suinda-learning.announcement.receipts.read"].includes(action)); audits.push(target); } } as never, registry, new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, teacherId); return [{ workspace_id: course.workspace_id, id: unitId }]; },
  };
  const dashboard = await records.teachingDashboard(teacherId);
  assert.equal(dashboard.courses[0].id, courseId);
  assert.equal(dashboard.lesson_materials[0].lesson_id, lesson.id);
  assert.equal(dashboard.lesson_materials[0].workspace_id, course.workspace_id);
  assert.equal(dashboard.lesson_materials[0].attachments[0].file_name, "aula.pdf");
  assert.deepEqual(dashboard.lesson_materials[0].accessibility_gaps.map((gap: { code: string }) => gap.code), ["document_accessibility_review_missing", "captions_invalid", "captions_review_missing", "markdown_link_name_missing"]);
  assert.match(dashboard.lesson_materials[0].accessibility_gaps.find((gap: { code: string }) => gap.code === "captions_invalid")?.message||'', /idioma das legendas/i);
  assert.equal(dashboard.cohorts[0].id, cohortId);
  assert.equal(dashboard.sessions[0].upcoming, true);
  assert.equal(dashboard.roster[0].learner_name, "Aluna Exemplo");
  assert.equal(dashboard.counts.active_learners, 1);
  assert.equal(dashboard.attendance.length, 1001);
  assert.equal(dashboard.attendance.at(-1)?.id, attendanceRecords.at(-1)?.id);
  assert.equal(dashboard.makeup_attendees.length, 1001);
  assert.equal(dashboard.makeup_attendees.at(-1)?.request_id, makeupRequests.at(-1)?.id);
  assert.equal(dashboard.announcement_receipts.length, 201);
  assert.equal(dashboard.announcement_receipts.at(-1)?.id, announcements[0]?.id);
  assert.deepEqual(announcementCursors, [
    { sentAt: null, id: null },
    { sentAt: "2030-01-01T12:00:00.000Z", id: announcements[1]!.id },
  ]);
  assert.doesNotMatch(attendanceScopeSql[0] || "", /LIMIT\s+1000/i);
  assert.doesNotMatch(attendanceScopeSql[1] || "", /LIMIT\s+1000/i);
  assert.equal(reviewQueueSql.length, 7);
  for (const sql of reviewQueueSql.filter((query) => !query.includes("kind='submission'"))) {
    assert.match(sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
  }
  const submissionSql = reviewQueueSql.find((query) => query.includes("kind='submission'"));
  assert.ok(submissionSql);
  assert.match(submissionSql, /jsonb_array_elements_text/);
  assert.match(submissionSql, /resolved_count=submission_scope\.member_count/);
  assert.match(submissionSql, /submission_scope\.unit_count=1/);
  assert.equal(attendanceScopeSql.length, 2);
  for (const sql of attendanceScopeSql) {
    assert.match(sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
    assert.match(sql, /ANY\(\$1::uuid\[\]\)/);
    assert.match(sql, /ANY\(\$5::text\[\]\)/);
  }
  assert.match(attendanceScopeSql.find((sql) => sql.includes("target.id=ANY")) || "", /src\.id=ANY\(\$1::uuid\[\]\)/);
  assert.ok(cohortB.payload.institution_unit_record_id !== unitId);
  assert.equal(directUnitOverride.payload.institution_unit_record_id, unitBId);
  const auditedIds = new Set(audits);
  assert.equal(attendanceRecords.filter((record) => auditedIds.has(record.id)).length, 1001);
  assert.equal(makeupRequests.filter((record) => auditedIds.has(record.id)).length, 1001);
});

test("lista e contagem do painel docente incluem todas as matrículas autorizadas após mil alunos", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const unitId = randomUUID();
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso",
    state: "published", revision: 1, updated_at: "2026-01-01T00:00:00.000Z", payload: { institution_unit_record_id: unitId } };
  const roster = Array.from({ length: 1001 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: `Matrícula ${index + 1}`,
    state: "active", revision: 1, learner_name: `Aluno ${String(index + 1).padStart(4, "0")}`,
    payload: { learner_user_id: randomUUID(), course_record_id: courseId, institution_unit_record_id: unitId },
  }));
  const rosterCursors: Array<{ name: string | null; id: string | null }> = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    if (sql.includes("r.kind='course'")) return [course];
    if (sql.includes("SELECT e.*,u.name AS learner_name FROM extension_records e")) {
      const name = values[5] as string | null;
      const id = values[6] as string | null;
      rosterCursors.push({ name, id });
      return roster.filter((entry) => name === null || entry.learner_name > name
        || entry.learner_name === name && entry.id > id!).slice(0, Number(values[7]));
    }
    return [];
  } };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async hasScoped() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitId }]; },
  };

  const dashboard = await records.teachingDashboard(userId);

  assert.equal(dashboard.roster.length, 1001);
  assert.equal(dashboard.roster.at(-1)?.id, roster.at(-1)?.id);
  assert.equal(dashboard.counts.active_learners, 1001);
  assert.deepEqual(rosterCursors, [{ name: null, id: null }, { name: "Aluno 1000", id: roster[999]!.id }]);
});

test("fila de contrapartidas do painel administrativo pagina todos os workspaces sob autorização e cursor estável", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const row = (index: number, state: string, updated: string) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "scholarship_counterparty", title: `Contrapartida ${index}`,
    state, revision: 1, created_by: userId, updated_by: userId, updated_at: updated,
    queue_updated_at: updated,
    learner_name: `Aluno ${index}`, program_title: "Programa", course_title: "Curso", enrollment_title: `Matrícula ${index}`,
    payload: { requirement_text: `Exigência ${index}`, evidence_text: "Comprovante entregue" },
  });
  const records = [
    row(1, "submitted", "2026-10-24T12:00:00.000Z"),
    row(2, "submitted", "2026-10-23T12:00:00.000Z"),
    row(3, "revision_requested", "2026-10-24T13:00:00.000Z"),
  ];
  const pageCalls: Array<{ args: unknown[]; sql: string }> = [];
  const audited: string[] = [];
  const db = { async query(sql: string, args: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return args[0] ? [] : [{ id: workspaceId }];
    if (sql.includes("kind='scholarship_counterparty'")) {
      pageCalls.push({ sql, args });
      const rank = args[3] == null ? -1 : Number(args[3]);
      const cursorDate = args[4] == null ? null : String(args[4]);
      const cursorId = args[5] == null ? null : String(args[5]);
      const eligible = records.filter((record) => {
        const itemRank = record.state === "submitted" ? 0 : record.state === "revision_requested" ? 1 : 2;
        return rank < 0 || itemRank > rank || itemRank === rank
          && (record.updated_at < cursorDate! || record.updated_at === cursorDate && record.id > cursorId!);
      });
      return eligible.slice(0, Number(args[6]));
    }
    return [];
  } };
  const access = { async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) {
    return scopeType === "workspace" && scopeId === workspaceId;
  }, async audit(_user: string, _action: string, target: string) { audited.push(target); } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());

  const first = await service.teachingScholarshipCounterparties(userId, undefined, 2);
  assert.deepEqual(first.items.map((item) => item.id), [records[0]!.id, records[1]!.id]);
  assert.ok(first.next_cursor);
  const second = await service.teachingScholarshipCounterparties(userId, first.next_cursor, 2);
  assert.deepEqual(second.items.map((item) => item.id), [records[2]!.id]);
  assert.equal(second.next_cursor, null);
  assert.equal(pageCalls.length, 2);
  assert.match(pageCalls[0]!.sql, /LIMIT \$7/);
  assert.equal(pageCalls[0]!.args[6], 3);
  assert.equal(pageCalls[1]!.args[3], 0);
  assert.equal(pageCalls[1]!.args[4], records[1]!.updated_at);
  assert.equal(pageCalls[1]!.args[5], records[1]!.id);
  assert.deepEqual(audited, records.map((record) => record.id));
  await assert.rejects(() => service.teachingScholarshipCounterparties(userId, "invalid", 2), /Cursor inválido/);
});

test("filas de documentos e práticas do painel docente percorrem todas as páginas da unidade", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const unitId = randomUUID();
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso",
    state: "published", revision: 1, updated_at: "2026-01-01T00:00:00.000Z", payload: { institution_unit_record_id: unitId } };
  const documents = Array.from({ length: 301 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document", title: `Documento ${index + 1}`,
    state: "submitted", revision: 1, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    learner_name: `Aluno ${index + 1}`, course_title: "Curso", payload: { learner_user_id: randomUUID() },
  }));
  const practices = Array.from({ length: 501 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "practice", title: `Prática ${index + 1}`,
    state: "submitted", revision: 1, payload: { submitted_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() },
    learner_name: `Aluno ${index + 1}`, course_title: "Curso",
  }));
  const justifications = Array.from({ length: 301 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "attendance_justification", title: `Justificativa ${index + 1}`,
    state: "submitted", revision: 1, created_at: new Date(Date.UTC(2026, 1, 1, 0, 0, index)).toISOString(),
    learner_name: `Aluno ${index + 1}`, course_title: "Curso", session_title: "Encontro", payload: {},
  }));
  const makeupFees = Array.from({ length: 301 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "makeup_request", title: `Taxa ${index + 1}`,
    state: "approved", revision: 1, created_at: new Date(Date.UTC(2026, 2, 1, 0, 0, index)).toISOString(), amount_paid: 0,
    learner_name: `Aluno ${index + 1}`, course_title: "Curso", session_title: "Encontro", payload: { fee_amount: 50, fee_currency: "BRL" },
  }));
  const documentCursors: Array<{ created_at: string | null; id: string | null }> = [];
  const justificationCursors: Array<{ created_at: string | null; id: string | null }> = [];
  const makeupFeeCursors: Array<{ created_at: string | null; id: string | null }> = [];
  const practiceCursors: Array<string | null> = [];
  const db = {
    async one() { return { count: 0 }; },
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT id FROM workspaces")) return [];
      if (sql.includes("r.kind='course'")) return [course];
      if (sql.includes("d.kind='learner_document'")) {
        assert.match(sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
        assert.match(sql, /ANY\(\$3::text\[\]\)/);
        const createdAt = values[5] as string | null;
        const recordId = values[6] as string | null;
        documentCursors.push({ created_at: createdAt, id: recordId });
        return documents.filter((document) => createdAt === null || document.created_at > createdAt
          || document.created_at === createdAt && document.id > recordId!).slice(0, Number(values[7]));
      }
      if (sql.includes("j.kind='attendance_justification'")) {
        assert.match(sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
        const createdAt = values[5] as string | null;
        const recordId = values[6] as string | null;
        justificationCursors.push({ created_at: createdAt, id: recordId });
        return justifications.filter((record) => createdAt === null || record.created_at > createdAt
          || record.created_at === createdAt && record.id > recordId!).slice(0, Number(values[7]));
      }
      if (sql.includes("r.kind='makeup_request'") && sql.includes("fee_status")) {
        assert.match(sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
        const createdAt = values[5] as string | null;
        const recordId = values[6] as string | null;
        makeupFeeCursors.push({ created_at: createdAt, id: recordId });
        return makeupFees.filter((record) => createdAt === null || record.created_at > createdAt
          || record.created_at === createdAt && record.id > recordId!).slice(0, Number(values[7]));
      }
      if (sql.includes("p.kind='practice' AND p.state='submitted'")) {
        assert.match(sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
        assert.match(sql, /ANY\(\$5::text\[\]\)/);
        const cursor = values[5] as string | null;
        practiceCursors.push(cursor);
        return practices.filter((practice) => cursor === null || practice.id > cursor).slice(0, Number(values[6]));
      }
      return [];
    },
  };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async hasScoped() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitId }]; },
  };

  const dashboard = await records.teachingDashboard(userId);

  assert.equal(dashboard.pending_documents.length, 301);
  assert.equal(dashboard.pending_documents.at(-1)?.id, documents.at(-1)?.id);
  assert.equal(dashboard.pending_justifications.length, 301);
  assert.equal(dashboard.pending_justifications.at(-1)?.id, justifications.at(-1)?.id);
  assert.equal(dashboard.pending_makeup_fees.length, 301);
  assert.equal(dashboard.pending_makeup_fees.at(-1)?.id, makeupFees.at(-1)?.id);
  assert.equal(dashboard.pending_practices.length, 501);
  assert.equal(dashboard.pending_practices.at(-1)?.id, practices.at(-1)?.id);
  assert.equal(dashboard.counts.documents_to_review, 301);
  assert.equal(dashboard.counts.attendance_justifications_to_review, 301);
  assert.equal(dashboard.counts.practices_to_review, 501);
  assert.deepEqual(justificationCursors, [
    { created_at: null, id: null }, { created_at: justifications[299]!.created_at, id: justifications[299]!.id },
  ]);
  assert.deepEqual(makeupFeeCursors, [
    { created_at: null, id: null }, { created_at: makeupFees[299]!.created_at, id: makeupFees[299]!.id },
  ]);
  assert.deepEqual(documentCursors, [
    { created_at: null, id: null }, { created_at: documents[299]!.created_at, id: documents[299]!.id },
  ]);
  assert.deepEqual(practiceCursors, [null, practices[499]!.id]);
});

test("painel docente pagina módulos e materiais além dos limites antigos", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const unitId = randomUUID();
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso",
    state: "published", revision: 1, updated_at: "2026-01-01T00:00:00.000Z", payload: { institution_unit_record_id: unitId } };
  const modules = Array.from({ length: 1001 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "module", title: `Módulo ${index + 1}`,
    state: "published", revision: 1, updated_at: "2026-01-01T00:00:00.000Z", payload: { course_record_id: courseId },
  }));
  const lessons = Array.from({ length: 2001 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "lesson", title: `Aula ${index + 1}`,
    state: "published", revision: 1, payload: { module_record_id: modules[0]!.id, content_type: "text" },
  }));
  const moduleCursors: Array<string | null> = [];
  const lessonCursors: Array<string | null> = [];
  const db = { async one() { return { count: 0 }; }, async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    if (sql.includes("r.kind='course'")) return [course];
    if (sql.includes("m.kind='module'")) {
      const cursorAt = values[1] as string | null;
      const cursorId = values[2] as string | null;
      moduleCursors.push(cursorId);
      return modules.filter((item) => cursorAt === null || item.updated_at > cursorAt
        || item.updated_at === cursorAt && item.id > cursorId!).slice(0, Number(values[3]));
    }
    if (sql.includes("l.kind='lesson'")) {
      const cursor = values[1] as string | null;
      lessonCursors.push(cursor);
      return lessons.filter((item) => cursor === null || item.id > cursor).slice(0, Number(values[2]));
    }
    return [];
  } };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async hasScoped() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitId }]; },
  };

  const dashboard = await records.teachingDashboard(userId);

  assert.equal(dashboard.lesson_materials.length, 2001);
  assert.equal(dashboard.lesson_materials.at(-1)?.lesson_id, lessons.at(-1)?.id);
  assert.deepEqual(moduleCursors, [null, modules[999]!.id]);
  assert.deepEqual(lessonCursors, [null, lessons[1999]!.id]);
});

test("painel docente considera workspaces autorizados depois do milésimo", async () => {
  const userId = randomUUID();
  const workspaces = Array.from({ length: 1001 }, () => ({ id: randomUUID() })).sort((a, b) => a.id.localeCompare(b.id));
  const lastWorkspaceId = workspaces.at(-1)!.id;
  const workspaceCursors: Array<string | null> = [];
  let observedManagedWorkspaceIds: string[] | undefined;
  const db = {
    async one() { return { count: 0 }; },
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT id FROM workspaces")) {
        assert.match(sql, /id>\$1::uuid/);
        const cursor = values[0] as string | null;
        workspaceCursors.push(cursor);
        return workspaces.filter((workspace) => cursor === null || workspace.id > cursor).slice(0, Number(values[1]));
      }
      if (sql.includes("r.kind='course'")) {
        observedManagedWorkspaceIds = values[1] as string[];
        return [];
      }
      return [];
    },
  };
  const records = new ExtensionRecords(db as never, {
    async has(_user: string, _permission: string, _type: string, scopeId: string) { return scopeId === lastWorkspaceId; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return []; },
  };

  await records.teachingDashboard(userId);

  assert.deepEqual(observedManagedWorkspaceIds, [lastWorkspaceId]);
  assert.deepEqual(workspaceCursors, [null, workspaces[999]!.id]);
});

test("aluno consulta encontros concluídos anteriores ao bloco mais recente de 300", async () => {
  const userId = randomUUID();
  const enrollmentId = randomUUID();
  const workspaceId = randomUUID();
  const cohortId = randomUUID();
  const courseId = randomUUID();
  const enrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula", state: "completed", revision: 1,
    payload: { learner_user_id: userId, cohort_record_id: cohortId, course_record_id: courseId, course_revision: 1 } };
  const sessions = Array.from({ length: 301 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: `Encontro ${index + 1}`,
    state: "completed", revision: 1,
    payload: { starts_at: new Date(Date.UTC(2025, 0, index + 1)).toISOString(), ends_at: "2025-12-01T12:00:00.000Z" },
  }));
  const sessionCursors: Array<string | null> = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("kind='enrollment'")) return enrollment;
      if (sql.includes("extension_record_versions")) return { payload: { attendance_justification_deadline_days: 0 } };
      return null;
    },
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("s.kind='session' AND s.state='completed'")) {
        const cursor = values[4] as string | null;
        sessionCursors.push(cursor);
        return sessions.filter((session) => cursor === null || session.id > cursor).slice(0, Number(values[5]));
      }
      return [];
    },
  };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());

  const result = await records.learnerAttendanceJustifications(enrollmentId, userId);

  assert.equal(result.sessions.length, 301);
  assert.equal(result.sessions[0]?.id, sessions.at(-1)?.id);
  assert.equal(result.sessions.at(-1)?.id, sessions[0]?.id);
  assert.deepEqual(sessionCursors, [null, sessions[199]!.id]);
});

test("painel docente pagina todos os cursos autorizados além do primeiro bloco de 200", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const unitId = randomUUID();
  const courses = Array.from({ length: 201 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(900000000000 - index).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: `Curso ${index + 1}`,
    state: "published", revision: 1,
    updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 201 - index)).toISOString(),
    payload: { institution_unit_record_id: unitId },
  }));
  const coursePageCalls: unknown[][] = [];
  const db = { async one() { return { count: 0 }; }, async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    if (sql.includes("r.kind='course'")) {
      coursePageCalls.push(values);
      const cursorAt = values[3] as string | null;
      const cursorId = values[4] as string | null;
      const afterCursor = cursorAt === null ? courses : courses.filter((course) =>
        course.updated_at < cursorAt || course.updated_at === cursorAt && course.id > cursorId!,
      );
      return afterCursor.slice(0, Number(values[5]));
    }
    return [];
  } };
  const records = new ExtensionRecords(db as never, {
    async has() { return false; }, async hasScoped(_user: string, _permission: string, _type: string, scopeId: string) { return scopeId === unitId; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitId }]; },
  };
  const dashboard = await records.teachingDashboard(userId);
  assert.equal(dashboard.courses.length, 201);
  assert.equal(dashboard.courses.at(-1)?.id, courses.at(-1)?.id);
  assert.equal(coursePageCalls.length, 2);
  assert.equal(coursePageCalls[0]?.[3], null);
  assert.equal(coursePageCalls[1]?.[3], courses[199]?.updated_at);
  assert.equal(coursePageCalls[1]?.[4], courses[199]?.id);
});

test("painel docente pagina todas as turmas e sessões autorizadas além dos limites antigos", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const unitId = randomUUID();
  const cohorts = Array.from({ length: 301 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: `Turma ${index + 1}`,
    state: "active", revision: 1, payload: { institution_unit_record_id: unitId, starts_at: "2026-01-01T00:00:00.000Z" },
  }));
  const sessions = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: `Encontro ${index + 1}`,
    state: "scheduled", revision: 1, payload: { cohort_record_id: cohorts[index % cohorts.length]!.id, starts_at: "2026-01-01T00:00:00.000Z" },
  }));
  const cohortCursors: Array<string | null> = [];
  const sessionCursors: Array<string | null> = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    if (sql.includes("r.kind='course'")) return [];
    if (sql.includes("r.kind='cohort'")) {
      const cursor = values[4] as string | null;
      cohortCursors.push(cursor);
      return cohorts.filter((item) => cursor === null || item.id > cursor).slice(0, Number(values[5]));
    }
    if (sql.includes("r.kind='session'")) {
      const cursor = values[3] as string | null;
      sessionCursors.push(cursor);
      return sessions.filter((item) => cursor === null || item.id > cursor).slice(0, Number(values[4]));
    }
    return [];
  } };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async hasScoped() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitId }]; },
  };

  const dashboard = await records.teachingDashboard(userId);

  assert.equal(dashboard.cohorts.length, 301);
  assert.equal(dashboard.sessions.length, 501);
  assert.deepEqual(cohortCursors, [null, cohorts[299]!.id]);
  assert.deepEqual(sessionCursors, [null, sessions[499]!.id]);
});

test("painel docente pagina todas as entregas e avaliações pendentes sem perder a ordem por envio", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const courseId = randomUUID();
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso atribuído",
    state: "published", revision: 1, updated_at: "2026-01-01T00:00:00.000Z", payload: { instructor_ids: [userId], tutor_ids: [] } };
  const submissions = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "submission", title: `Entrega ${index + 1}`,
    state: "submitted", revision: 1, payload: { assessment_record_id: randomUUID(), submitted_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 501 - index)).toISOString() },
    assessment_title: "Atividade", assessment_rubric: [],
  }));
  const attempts = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
    workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment_attempt", title: `Tentativa ${index + 1}`,
    state: "submitted", revision: 1, payload: { submitted_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 501 - index)).toISOString() },
    assessment_title: "Avaliação", learner_name: "Estudante",
  }));
  const submissionCursors: Array<string | null> = [];
  const attemptCursors: Array<string | null> = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    if (sql.includes("r.kind='course'")) return [course];
    if (sql.includes("s.kind='submission'")) {
      const cursor = values[5] as string | null;
      submissionCursors.push(cursor);
      return submissions.filter((record) => cursor === null || record.id > cursor).slice(0, Number(values[6]));
    }
    if (sql.includes("t.kind='assessment_attempt'")) {
      const cursor = values[5] as string | null;
      attemptCursors.push(cursor);
      return attempts.filter((record) => cursor === null || record.id > cursor).slice(0, Number(values[6]));
    }
    return [];
  } };
  const records = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());

  const dashboard = await records.teachingDashboard(userId);

  assert.equal(dashboard.submissions.length, 501);
  assert.equal(dashboard.assessment_attempts.length, 501);
  assert.equal(dashboard.submissions[0]?.id, submissions[500]?.id);
  assert.equal(dashboard.assessment_attempts[0]?.id, attempts[500]?.id);
  assert.deepEqual(submissionCursors, [null, submissions[499]!.id]);
  assert.deepEqual(attemptCursors, [null, attempts[499]!.id]);
});

test("fila docente mantém acesso integral do gestor de workspace", async () => {
  const userId = "00000000-0000-4000-8000-000000000131";
  const workspaceId = "00000000-0000-4000-8000-000000000132";
  const unitAId = "00000000-0000-4000-8000-000000000135";
  const unitBId = "00000000-0000-4000-8000-000000000136";
  const courseId = "00000000-0000-4000-8000-000000000133";
  const cohortId = "00000000-0000-4000-8000-000000000134";
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "active", revision: 1, payload: { instructor_ids: [], tutor_ids: [] } };
  const cohort = { id: cohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma", state: "active", revision: 1, payload: { course_record_id: courseId } };
  const queues: Array<{ sql: string; values: unknown[] }> = [];
  const db = { async one() { return { count: 0 }; }, async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceId }];
    if (sql.includes("r.kind='course'")) return [course];
    if (sql.includes("r.kind='cohort'")) return [cohort];
    if (sql.includes("kind='submission'") || sql.includes("kind='assessment_attempt'") || sql.includes("kind='learner_document'")
      || sql.includes("kind='attendance_justification'") || sql.includes("kind='makeup_request'") && sql.includes("fee_status") || sql.includes("p.kind='practice'")
      || sql.includes("target.id=ANY($1::uuid[])") || sql.includes("WHERE r.plugin_id='suinda-learning' AND r.kind='attendance'")
      || sql.includes("SELECT e.*,u.name AS learner_name FROM extension_records e")) queues.push({ sql, values });
    return [];
  } };
  const records = new ExtensionRecords(db as never, { async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitAId }, { workspace_id: workspaceId, id: unitBId }]; },
  };
  await records.teachingDashboard(userId);
  assert.ok(queues.length >= 7);
  for (const { sql, values } of queues) {
    assert.ok(sql.includes("workspace_id=ANY"));
    assert.ok(values.some((value) => Array.isArray(value) && value.includes(workspaceId)));
  }
});

test("resumo operacional de gestores unitários filtra avaliações e vencimentos por pares workspace/unidade", async () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const unitAId = randomUUID();
  const unitBId = randomUUID();
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const assessments = Array.from({ length: 11 }, (_, index) => ({ id: randomUUID(), workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "assessment", title: `Prova ${index + 1}`, state: "published", revision: 1,
    payload: { course_record_id: randomUUID(), due_at: `2030-02-${String(index + 1).padStart(2, "0")}T12:00:00Z` }, course_title: "Curso A" }));
  const documents = Array.from({ length: 101 }, (_, index) => ({ id: randomUUID(), workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "learner_document", title: `Documento ${index + 1}`, state: "approved", revision: 1,
    learner_name: "Aluna A", course_title: "Curso A", expires_on: `2030-02-${String(index % 28 + 1).padStart(2, "0")}`,
    total_count: 101, payload: { category: "license" } }));
  const db = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceId }];
      if (sql.includes("FROM extension_records a") && sql.includes("a.kind='assessment'")
        && sql.includes("unnest($2::uuid[],$3::text[])")) {
        queries.push({ sql, values });
        assert.deepEqual(values, [[workspaceId], [workspaceId, workspaceId], [unitAId, unitBId]]);
        assert.match(sql, /COALESCE\(NULLIF\(a\.payload->>'institution_unit_record_id'/);
        return assessments;
      }
      if (sql.includes("FROM extension_records d") && sql.includes("COUNT(*) OVER()::int AS total_count")) {
        queries.push({ sql, values });
        assert.deepEqual(values, [[workspaceId], [workspaceId, workspaceId], [unitAId, unitBId]]);
        assert.match(sql, /COALESCE\(\s*NULLIF\(e\.payload->>'institution_unit_record_id'/);
        return documents;
      }
      if (sql.includes("FROM latest_attempts t")) {
        queries.push({ sql, values });
        assert.deepEqual(values.slice(0, 3), [[workspaceId, workspaceId], [workspaceId, workspaceId], [unitAId, unitBId]]);
        assert.match(sql, /unit_scope\.workspace_id=e\.workspace_id/);
        return [];
      }
      return [];
    },
    async one(sql: string, values: unknown[] = []) {
      if (sql.includes("COUNT(*)::int AS count FROM extension_records a")) {
        queries.push({ sql, values });
        assert.deepEqual(values, [[workspaceId], [workspaceId, workspaceId], [unitAId, unitBId]]);
        return { count: 11 };
      }
      return { count: 0 };
    },
  };
  const access = {
    async has() { return false; },
    async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeType === "extension_record" && (scopeId === unitAId || scopeId === unitBId);
    },
    async audit() {},
  };
  const records = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitAId }, { workspace_id: workspaceId, id: unitBId }]; },
  };

  const dashboard = await records.teachingDashboard(userId);

  assert.equal(queries.length, 4);
  assert.ok(dashboard.unit_operations_summary);
  assert.deepEqual(dashboard.unit_operations_summary!.counts, { upcoming_assessments: 11, documents_expiring: 101, assessment_risks: 0, near_capacity_cohorts: 0 });
  assert.equal(dashboard.unit_operations_summary!.upcoming_assessments.length, 10);
  assert.ok(dashboard.unit_operations_summary!.upcoming_assessments_next_cursor);
  assert.equal(dashboard.unit_operations_summary!.documents_expiring.length, 100);
  assert.ok(dashboard.unit_operations_summary!.documents_expiring_next_cursor);
  assert.deepEqual(dashboard.unit_operations_summary!.assessment_risks, []);
  assert.equal(dashboard.unit_operations_summary!.assessment_risks_next_cursor, null);
  assert.deepEqual(dashboard.unit_operations_summary!.near_capacity_cohorts, []);
  assert.equal(dashboard.admin_summary, undefined);
});

test("listas unitárias de avaliações e documentos usam cursor e preservam o escopo workspace/unidade", async () => {
  const userId = randomUUID(); const workspaceId = randomUUID(); const unitId = randomUUID();
  const assessmentRows = [1, 2].map((index) => ({ id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment",
    title: `Avaliação ${index}`, state: "published", revision: 1, payload: { due_at: `2030-02-0${index}T12:00:00.000Z` }, course_title: "Curso" }));
  const documentRows = [1, 2].map((index) => ({ id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document",
    title: `Documento ${index}`, state: "approved", revision: 1, payload: { category: "registro" }, learner_name: `Pessoa ${index}`,
    course_title: "Curso", expires_on: `2030-02-0${index}` }));
  const pageQueries: Array<{ sql: string; values: unknown[] }> = [];
  const audited: string[] = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    pageQueries.push({ sql, values });
    assert.deepEqual(values.slice(0, 3), [[workspaceId], [workspaceId], [unitId]]);
    const rows = sql.includes("a.kind='assessment'") ? assessmentRows : documentRows;
    return values[3] ? rows.slice(1) : rows;
  } };
  const access = { async has() { return false; }, async hasScoped(_user: string, permission: string, type: string, scope: string) {
    return permission === "plugin.suinda-learning.manage" && type === "extension_record" && scope === unitId;
  }, async audit(_user: string, _action: string, target: string) { audited.push(target); } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  (service as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitId }]; },
  };

  const firstAssessments = await service.teachingUnitOperations(userId, "assessment", undefined, 1);
  assert.equal(firstAssessments.items.length, 1);
  assert.ok(firstAssessments.next_cursor);
  const secondAssessments = await service.teachingUnitOperations(userId, "assessment", firstAssessments.next_cursor!, 1);
  assert.equal((secondAssessments.items[0] as { id: string } | undefined)?.id, assessmentRows[1]?.id);
  const firstDocuments = await service.teachingUnitOperations(userId, "document", undefined, 1);
  assert.equal(firstDocuments.items.length, 1);
  assert.ok(firstDocuments.next_cursor);
  const secondDocuments = await service.teachingUnitOperations(userId, "document", firstDocuments.next_cursor!, 1);
  assert.equal((secondDocuments.items[0] as { id: string } | undefined)?.id, documentRows[1]?.id);
  assert.equal(pageQueries.length, 4);
  assert.ok(pageQueries.every(({ sql }) => sql.includes("unnest($2::uuid[],$3::text[])") && sql.includes("LIMIT $6")));
  assert.deepEqual(audited.sort(), [...assessmentRows.map((row) => row.id), ...documentRows.map((row) => row.id)].sort());
});

test("riscos de nota do painel unitário paginam por matrícula/avaliação e usam a unidade efetiva", async () => {
  const userId = randomUUID(); const workspaceId = randomUUID(); const unitId = randomUUID();
  const rows = Array.from({ length: 3 }, (_, index) => ({
    enrollment_id: randomUUID(), assessment_id: randomUUID(), learner_name: `Pessoa ${index + 1}`, course_title: "Curso",
    assessment_title: `Avaliação ${index + 1}`, score: 3, passing_score: 7, attempt_number: 2, max_attempts: 2, total_count: 3,
  })).sort((a, b) => a.enrollment_id.localeCompare(b.enrollment_id) || a.assessment_id.localeCompare(b.assessment_id));
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const audited: string[] = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    queries.push({ sql, values });
    assert.deepEqual(values.slice(0, 3), [[workspaceId], [workspaceId], [unitId]]);
    const cursorEnrollment = values[3] as string | null;
    const cursorAssessment = values[4] as string | null;
    const start = cursorEnrollment ? rows.findIndex((row) => row.enrollment_id === cursorEnrollment && row.assessment_id === cursorAssessment) + 1 : 0;
    return rows.slice(start, start + Number(values[5]));
  } };
  const access = { async has() { return false; }, async hasScoped(_user: string, permission: string, type: string, scope: string) {
    return permission === "plugin.suinda-learning.manage" && type === "extension_record" && scope === unitId;
  }, async audit(_user: string, _action: string, target: string) { audited.push(target); } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  (service as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitId }]; },
  };

  const first = await service.teachingUnitOperations(userId, "risk", undefined, 1);
  const firstRisk = first as { items: Array<{ assessment_id: string }>; next_cursor: string | null };
  assert.equal(firstRisk.items.length, 1);
  assert.equal(firstRisk.items[0]?.assessment_id, rows[0]?.assessment_id);
  assert.ok(firstRisk.next_cursor);
  const second = await service.teachingUnitOperations(userId, "risk", firstRisk.next_cursor!, 1);
  const secondRisk = second as { items: Array<{ assessment_id: string }>; next_cursor: string | null };
  assert.equal(secondRisk.items[0]?.assessment_id, rows[1]?.assessment_id);
  assert.ok(secondRisk.next_cursor);
  const third = await service.teachingUnitOperations(userId, "risk", secondRisk.next_cursor!, 1);
  const thirdRisk = third as { items: Array<{ assessment_id: string }>; next_cursor: string | null };
  assert.equal(thirdRisk.items[0]?.assessment_id, rows[2]?.assessment_id);
  assert.equal(thirdRisk.next_cursor, null);
  assert.equal(queries.length, 3);
  assert.ok(queries.every(({ sql }) => sql.includes("unit_scope.workspace_id=e.workspace_id")
    && sql.includes("NULLIF(e.payload->>'institution_unit_record_id','')") && sql.includes("ORDER BY e.id,a.id LIMIT $6")));
  assert.deepEqual(audited.sort(), rows.map((row) => row.enrollment_id).sort());
});

test("turmas próximas da lotação paginam com cursor estável e filtram unidades autorizadas", async () => {
  const userId = randomUUID(); const workspaceId = randomUUID(); const unitId = randomUUID();
  const rows = [
    { id: randomUUID(), title: "Turma A", state: "active", occupied: 9, capacity: 10, course_record_id: randomUUID(), capacity_ratio: "0.9" },
    { id: randomUUID(), title: "Turma B", state: "enrolling", occupied: 8, capacity: 10, course_record_id: randomUUID(), capacity_ratio: "0.8" },
    { id: randomUUID(), title: "Turma C", state: "active", occupied: 4, capacity: 5, course_record_id: randomUUID(), capacity_ratio: "0.8" },
  ];
  const queries: Array<{ sql: string; values: unknown[] }> = []; const audited: string[] = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [];
    queries.push({ sql, values });
    assert.deepEqual(values.slice(0, 3), [[], [workspaceId], [unitId]]);
    assert.match(sql, /c\.plugin_id='suinda-learning' AND c\.kind='cohort'/);
    assert.match(sql, /unit_scope\.workspace_id=c\.workspace_id/);
    const ratio = values[3] as string | null; const title = values[4] as string | null; const recordId = values[5] as string | null;
    const start = ratio === null ? 0 : rows.findIndex((row) => row.capacity_ratio === ratio && row.title === title && row.id === recordId) + 1;
    return rows.slice(start, start + Number(values[6]));
  } };
  const access = { async has() { return false; }, async hasScoped(_user: string, permission: string, type: string, scope: string) {
    return permission === "plugin.suinda-learning.manage" && type === "extension_record" && scope === unitId;
  }, async audit(_user: string, _action: string, target: string) { audited.push(target); } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  (service as unknown as { unitRecordAccess: { authorizedUnits(user: string): Promise<Array<{ workspace_id: string; id: string }>> } }).unitRecordAccess = {
    async authorizedUnits(user) { assert.equal(user, userId); return [{ workspace_id: workspaceId, id: unitId }]; },
  };

  const first = await service.teachingUnitOperations(userId, "capacity", undefined, 1);
  const firstPage = first as { items: Array<{ id: string }>; next_cursor: string | null };
  assert.equal(firstPage.items[0]?.id, rows[0]?.id);
  assert.ok(firstPage.next_cursor);
  const second = await service.teachingUnitOperations(userId, "capacity", firstPage.next_cursor!, 1);
  const secondPage = second as { items: Array<{ id: string }>; next_cursor: string | null };
  assert.equal(secondPage.items[0]?.id, rows[1]?.id);
  assert.ok(secondPage.next_cursor);
  const third = await service.teachingUnitOperations(userId, "capacity", secondPage.next_cursor!, 1);
  const thirdPage = third as { items: Array<{ id: string }>; next_cursor: string | null };
  assert.equal(thirdPage.items[0]?.id, rows[2]?.id);
  assert.equal(thirdPage.next_cursor, null);
  assert.equal(queries.length, 3);
  assert.deepEqual(audited, rows.map((row) => row.id));
});

test("agendador de aula online percorre os alunos elegíveis mesmo sem consulta à central", async () => {
  const userIds = Array.from({ length: 501 }, () => randomUUID()).sort();
  let page = 0; const visited: string[] = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    assert.match(sql, /s\.payload->>'starts_at'.*INTERVAL '15 minutes'/s);
    assert.match(sql, /academic_reminders_enabled/);
    assert.match(sql, /meeting_url/);
    assert.match(sql, /e\.state=ANY\(ARRAY\['enrolled','active'\]\)/);
    assert.deepEqual(values, [page === 0 ? null : userIds[499]]);
    assert.match(sql, /ORDER BY u\.id LIMIT 500/);
    page += 1;
    return page === 1 ? userIds.slice(0, 500).map((user_id) => ({ user_id })) : userIds.slice(500).map((user_id) => ({ user_id }));
  } };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async reminders(user: string) { visited.push(user); } });

  await (service as unknown as { reconcileLiveSessionReminderUsers(): Promise<void> }).reconcileLiveSessionReminderUsers();

  assert.deepEqual(visited, userIds);
  assert.equal(page, 2);
});

test("worker de matrícula percorre todas as aprovações com pagamento regular sem teto por lote", async () => {
  const candidates = Array.from({ length: 101 }, (_, index) => ({ id: randomUUID(), workspace_id: randomUUID(), revision: index + 1,
    plugin_id: "suinda-learning", kind: "enrollment", title: `Inscrição ${index + 1}`, state: "approved", payload: {} }))
    .sort((a, b) => a.id.localeCompare(b.id));
  let page = 0; const processed: string[] = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    assert.match(sql, /e\.state='approved'/);
    assert.match(sql, /amount_due/);
    assert.match(sql, /payment_status'=ANY\(ARRAY\['paid','waived'\]\)/);
    assert.match(sql, /ORDER BY e\.id LIMIT 100/);
    assert.deepEqual(values, [page === 0 ? null : candidates[99]?.id]);
    page += 1;
    return page === 1 ? candidates.slice(0, 100) : candidates.slice(100);
  } };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { async promoteApprovedEligibleEnrollment(candidate: { id: string }, actor: string) {
    assert.equal(actor, "system-actor"); processed.push(candidate.id);
  } });

  await (service as unknown as { promoteApprovedEligibleEnrollments(actor: string): Promise<void> })
    .promoteApprovedEligibleEnrollments("system-actor");

  assert.equal(page, 2);
  assert.deepEqual(processed, candidates.map(({ id: candidateId }) => candidateId));
});

test("filas globais de avaliação e documentos percorrem todas as páginas de workspaces geridos", async () => {
  const workspaceId = randomUUID();
  const assessmentRows = Array.from({ length: 11 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "assessment", title: `Avaliação ${index + 1}`, state: "published", revision: 1,
    payload: { due_at: `2026-11-${String(index + 1).padStart(2, "0")}T12:00:00.000Z` }, course_title: "Curso",
  }));
  const documentRows = Array.from({ length: 101 }, (_, index) => ({
    id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`, workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "learner_document", title: `Documento ${index + 1}`, state: "approved", revision: 1,
    payload: { expires_at: `2026-11-${String((index % 28) + 1).padStart(2, "0")}`, category: "id" },
    learner_name: `Pessoa ${index + 1}`, course_title: "Curso", expires_on: `2026-11-${String((index % 28) + 1).padStart(2, "0")}`,
  })).sort((a, b) => a.expires_on.localeCompare(b.expires_on) || a.id.localeCompare(b.id));
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const audited: string[] = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceId }];
    queries.push({ sql, values });
    assert.deepEqual(values[0], [workspaceId]);
    const rows = sql.includes("a.kind='assessment'") ? assessmentRows : documentRows;
    const cursorDate = values[1] as string | null;
    const cursorId = values[2] as string | null;
    const start = cursorId ? rows.findIndex((row) => {
      const date = "expires_on" in row ? row.expires_on : row.payload.due_at;
      return date === cursorDate && row.id === cursorId;
    }) + 1 : 0;
    return rows.slice(start, start + Number(values[3]));
  } };
  const access = { async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; },
    async audit(_user: string, _action: string, target: string) { audited.push(target); } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());

  const firstAssessments = await service.teachingAdminOperations("manager", "assessment", undefined, 10);
  assert.equal(firstAssessments.items.length, 10);
  assert.ok(firstAssessments.next_cursor);
  const finalAssessment = await service.teachingAdminOperations("manager", "assessment", firstAssessments.next_cursor!, 10);
  assert.equal(finalAssessment.items.length, 1);
  assert.equal(finalAssessment.next_cursor, null);

  const firstDocuments = await service.teachingAdminOperations("manager", "document", undefined, 100);
  assert.equal(firstDocuments.items.length, 100);
  assert.ok(firstDocuments.next_cursor);
  const finalDocument = await service.teachingAdminOperations("manager", "document", firstDocuments.next_cursor!, 100);
  assert.equal(finalDocument.items.length, 1);
  assert.equal(finalDocument.next_cursor, null);
  assert.equal(queries.length, 4);
  assert.ok(queries.filter(({ sql }) => sql.includes("a.kind='assessment'")).every(({ sql }) => sql.includes("a.workspace_id=ANY($1::uuid[])") && sql.includes("LIMIT $4")));
  assert.ok(queries.filter(({ sql }) => sql.includes("d.kind='learner_document'")).every(({ sql }) => sql.includes("d.workspace_id=ANY($1::uuid[])") && sql.includes("LIMIT $4")));
  assert.equal(audited.length, 112);
});

test("filas administrativas globais recusam quem não administra workspaces", async () => {
  const workspaceId = randomUUID();
  const db = { async query(sql: string) { return sql.includes("SELECT id FROM workspaces") ? [{ id: workspaceId }] : []; } };
  const service = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  await assert.rejects(service.teachingAdminOperations("unit-only", "assessment"), /gestão do workspace/);
});

test("riscos do painel administrativo paginam por matrícula/avaliação e só incluem workspaces autorizados", async () => {
  const userId = randomUUID(); const workspaceId = randomUUID();
  const rows = Array.from({ length: 3 }, (_, index) => ({
    enrollment_id: randomUUID(), assessment_id: randomUUID(), learner_name: `Pessoa ${index + 1}`, course_title: "Curso",
    assessment_title: `Avaliação ${index + 1}`, score: 3, passing_score: 7, attempt_number: 2, max_attempts: 2,
  })).sort((a, b) => a.enrollment_id.localeCompare(b.enrollment_id) || a.assessment_id.localeCompare(b.assessment_id));
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const audited: string[] = [];
  const db = { async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceId }];
    queries.push({ sql, values });
    assert.deepEqual(values[0], [workspaceId]);
    const cursorEnrollment = values[1] as string | null;
    const cursorAssessment = values[2] as string | null;
    const start = cursorEnrollment ? rows.findIndex((row) => row.enrollment_id === cursorEnrollment && row.assessment_id === cursorAssessment) + 1 : 0;
    return rows.slice(start, start + Number(values[3]));
  } };
  const access = { async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; },
    async audit(_user: string, _action: string, target: string) { audited.push(target); } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());

  const first = await service.teachingAdminAssessmentRisks(userId, undefined, 1);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0]?.assessment_id, rows[0]?.assessment_id);
  assert.ok(first.next_cursor);
  const second = await service.teachingAdminAssessmentRisks(userId, first.next_cursor!, 1);
  assert.equal(second.items[0]?.assessment_id, rows[1]?.assessment_id);
  assert.ok(second.next_cursor);
  const third = await service.teachingAdminAssessmentRisks(userId, second.next_cursor!, 1);
  assert.equal(third.items[0]?.assessment_id, rows[2]?.assessment_id);
  assert.equal(third.next_cursor, null);
  assert.equal(queries.length, 3);
  assert.ok(queries.every(({ sql }) => sql.includes("t.workspace_id=ANY($1::uuid[])") && sql.includes("ORDER BY e.id,a.id LIMIT $4")));
  assert.deepEqual(audited.sort(), rows.map((row) => row.enrollment_id).sort());
});

test("consulta docente da comunidade filtra tópicos por atribuição da turma exata", async () => {
  const userId = "00000000-0000-4000-8000-000000000121";
  const workspaceId = "00000000-0000-4000-8000-000000000122";
  const courseId = "00000000-0000-4000-8000-000000000123";
  const cohortAId = "00000000-0000-4000-8000-000000000124";
  const cohortBId = "00000000-0000-4000-8000-000000000125";
  const enrollmentAId = "00000000-0000-4000-8000-000000000126";
  const enrollmentBId = "00000000-0000-4000-8000-000000000127";
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", revision: 1,
    payload: { instructor_ids: [], tutor_ids: [] } };
  const cohorts = new Map([
    [cohortAId, { id: cohortAId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", revision: 1,
      payload: { course_record_id: courseId, course_revision: 1, instructor_user_id: userId, instructor_ids: [], tutor_ids: [] } }],
    [cohortBId, { id: cohortBId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", revision: 1,
      payload: { course_record_id: courseId, course_revision: 1, instructor_user_id: "other-teacher", instructor_ids: [], tutor_ids: [] } }],
  ]);
  const enrollments = new Map([
    [enrollmentAId, { id: enrollmentAId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", revision: 1,
      payload: { course_record_id: courseId, course_revision: 1, cohort_record_id: cohortAId } }],
    [enrollmentBId, { id: enrollmentBId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", revision: 1,
      payload: { course_record_id: courseId, course_revision: 1, cohort_record_id: cohortBId } }],
  ]);
  const threadA = { id: "00000000-0000-4000-8000-000000000128", revision: 1, title: "Da turma atribuída", state: "open",
    created_at: "2026-01-01T00:00:00Z", pinned: false, payload: { enrollment_record_id: enrollmentAId, course_revision: 1, thread_type: "question", body: "Pergunta A" } };
  const threadB = { ...threadA, id: "00000000-0000-4000-8000-000000000129", title: "Da outra turma",
    payload: { enrollment_record_id: enrollmentBId, course_revision: 1, thread_type: "question", body: "Pergunta B" } };
  const audits: string[] = [];
  const db = {
    async one(sql: string, values: unknown[] = []) {
      if (sql.includes("kind='course'")) return course;
      if (sql.includes("kind='enrollment'")) return enrollments.get(String(values[0])) || null;
      if (sql.includes("kind='cohort'")) return cohorts.get(String(values[0])) || null;
      return null;
    },
    async query(sql: string) { return sql.includes("SELECT t.*") ? [threadA, threadB] : []; },
  };
  const access = { async has() { return false; }, async audit(_actor: string, _action: string, target: string) { audits.push(target); } };
  const records = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  (records as unknown as { unitRecordAccess: { canManageRecord(user: string, recordId: string): Promise<boolean> } }).unitRecordAccess = {
    async canManageRecord() { return false; },
  };
  const visible = await records.teachingCommunityThreads(courseId, userId);
  assert.deepEqual(visible.map((thread) => thread.id), [threadA.id]);
  assert.deepEqual(audits, [threadA.id]);
});

test("docente atribuído cria Meet e salva o link numa nova revisão do encontro", async () => {
  const userId = "00000000-0000-4000-8000-000000000901";
  const workspaceId = "00000000-0000-4000-8000-000000000902";
  const sessionId = "00000000-0000-4000-8000-000000000903";
  const sourceId = "00000000-0000-4000-8000-000000000904";
  const calendarConnectionId = "00000000-0000-4000-8000-000000000910";
  const operationKey = "00000000-0000-4000-8000-000000000905";
  const session = { id: sessionId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Aula online", state: "scheduled", revision: 4,
    payload: { cohort_record_id: "00000000-0000-4000-8000-000000000906", instructor_user_id: "00000000-0000-4000-8000-000000000914", modality: "online", starts_at: "2099-05-01T10:00:00Z", ends_at: "2099-05-01T11:00:00Z", meeting_url: null } };
  const cohort = { id: session.payload.cohort_record_id, title: "Turma A", payload: { course_record_id: "00000000-0000-4000-8000-000000000907" } };
  const course = { id: cohort.payload.course_record_id, title: "Curso de exemplo", payload: {} };
  const saved: Array<{ payload: Record<string, unknown>; revision: number }> = [];
  const calls: Array<{ owner: string; source: string; body: Record<string, unknown> }> = [];
  let sourceProvider = "google_calendar";
  let conferenceProvider = "google_meet";
  let meetingUrl = "https://meet.google.com/abc-defg-hij";
  const client = { async query(sql: string) {
    if (sql.includes("kind='cohort'")) return { rows: [cohort] };
    if (sql.includes("kind='course'")) return { rows: [course] };
    return { rows: [] };
  } };
  const db = { async one(sql: string) {
    if (sql.includes("SELECT workspace_id FROM extension_records")) return { workspace_id: workspaceId };
    if (sql.includes("FROM calendar_sources")) return { provider_id: sourceProvider, connection_id: calendarConnectionId, capabilities: { create: true } };
    if (sql.includes("plugin_id='zoom'")) return sourceProvider === "zoom" ? { id: sourceId } : null;
    return null;
  } };
  const access = { async has() { return false; } };
  const calendar = { async create(owner: string, source: string, body: Record<string, unknown>) {
    calls.push({ owner, source, body });
    return { id: "calendar-item", conference: { provider: conferenceProvider, joinUrl: meetingUrl } };
  } };
  const zoomCalls: Array<{ owner: string; source: string; input: Record<string, unknown>; operationKey: string }> = [];
  const zoom = { async create(owner: string, source: string, input: Record<string, unknown>, operationKey: string) {
    zoomCalls.push({ owner, source, input, operationKey });
    return { id: "zoom-1", topic: "Suindá · Aula online", start_time: "2099-05-01T10:00:00Z", duration: 60, join_url: meetingUrl };
  } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner(), undefined, undefined, undefined, calendar as never, zoom as never) as unknown as {
    createSessionMeeting(session: string, user: string, body: Record<string, unknown>): Promise<{ revision: number; meeting_url: string; reused: boolean }>;
  };
  Object.assign(service, {
    unitRecordAccess: { async canManageRecord(actor: string, recordId: string) { return actor === userId && recordId === sessionId; } },
    assertAvailable() {},
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (connection: unknown) => Promise<unknown>) { return callback(client); },
    async lock(_connection: unknown, recordId: string, revision: number) { assert.equal(recordId, sessionId); assert.equal(revision, 4); return session; },
    async payload(_connection: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async save(_connection: unknown, record: typeof session, actor: string, _title: string, payload: Record<string, unknown>) {
      assert.equal(actor, userId); saved.push({ payload, revision: record.revision + 1 }); return { ...record, revision: record.revision + 1, payload };
    },
  });
  const result = await service.createSessionMeeting(sessionId, userId, {
    operation_key: operationKey, source_id: sourceId, expected_revision: 4,
  });
  assert.equal(result.revision, 5);
  assert.equal(result.meeting_url, "https://meet.google.com/abc-defg-hij");
  assert.equal(result.reused, false);
  assert.equal(saved[0].payload.meeting_provider, "google_meet");
  assert.equal(saved[0].payload.meeting_url, result.meeting_url);
  assert.equal(saved[0].payload.meeting_connection_id, calendarConnectionId);
  assert.equal(saved[0].payload.meeting_owner_user_id, userId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].owner, userId);
  assert.equal(calls[0].source, sourceId);
  assert.equal(calls[0].body.operation_key, operationKey);
  assert.equal(calls[0].body.visibility, "private");
  sourceProvider = "outlook_calendar";
  conferenceProvider = "microsoft_teams";
  meetingUrl = "https://teams.microsoft.com/l/meetup-join/example";
  const teams = await service.createSessionMeeting(sessionId, userId, {
    operation_key: "00000000-0000-4000-8000-000000000908", source_id: sourceId, expected_revision: 4,
  });
  assert.equal(teams.meeting_url, meetingUrl);
  assert.equal(saved.at(-1)?.payload.meeting_provider, "teams");
  sourceProvider = "zoom";
  meetingUrl = "https://us06web.zoom.us/j/123456";
  const zoomMeeting = await service.createSessionMeeting(sessionId, userId, {
    operation_key: "00000000-0000-4000-8000-000000000909", source_id: sourceId, expected_revision: 4,
  });
  assert.equal(zoomMeeting.meeting_url, meetingUrl);
  assert.equal(saved.at(-1)?.payload.meeting_provider, "zoom");
  assert.equal(zoomCalls.at(-1)?.owner, userId);
  assert.equal(zoomCalls.at(-1)?.source, sourceId);
});

test("docente reconcilia reunião Zoom existente sem recriá-la e salva o link auditado", async () => {
  const userId = "00000000-0000-4000-8000-000000000911";
  const workspaceId = "00000000-0000-4000-8000-000000000912";
  const sessionId = "00000000-0000-4000-8000-000000000913";
  const sourceId = "00000000-0000-4000-8000-000000000914";
  const operationKey = "00000000-0000-4000-8000-000000000915";
  const cohortId = "00000000-0000-4000-8000-000000000916";
  const courseId = "00000000-0000-4000-8000-000000000917";
  const session = { id: sessionId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Aula online", state: "scheduled", revision: 4,
    payload: { cohort_record_id: cohortId, instructor_user_id: userId, modality: "online", starts_at: "2099-05-01T10:00:00Z", ends_at: "2099-05-01T11:00:00Z", meeting_url: null } };
  const cohort = { id: cohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", payload: { course_record_id: courseId, instructor_ids: [userId] } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", payload: {} };
  const saved: Array<{ payload: Record<string, unknown>; revision: number }> = [];
  const zoomCalls: Array<{ owner: string; source: string; operationKey: string; meetingId: string; expected: Record<string, unknown> }> = [];
  const client = { async query(sql: string) {
    if (sql.includes("kind='cohort'")) return { rows: [cohort] };
    if (sql.includes("kind='course'")) return { rows: [course] };
    return { rows: [] };
  } };
  const db = { async one(sql: string) {
    if (sql.includes("SELECT workspace_id FROM extension_records")) return { workspace_id: workspaceId };
    if (sql.includes("plugin_id='zoom'")) return { id: sourceId };
    return null;
  } };
  const access = { async has() { return false; } };
  const zoom = { async reconcile(owner: string, source: string, key: string, meetingId: string, expected: Record<string, unknown>) {
    zoomCalls.push({ owner, source, operationKey: key, meetingId, expected });
    return { id: meetingId, topic: "Suindá · Aula online", start_time: "2099-05-01T10:00:00Z", duration: 60, join_url: "https://us06web.zoom.us/j/123456" };
  } };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner(), undefined, undefined, undefined, undefined, zoom as never) as unknown as {
    reconcileSessionZoomMeeting(session: string, user: string, body: Record<string, unknown>): Promise<{ revision: number; meeting_url: string; reused: boolean }>;
  };
  Object.assign(service, {
    assertAvailable() {},
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (connection: unknown) => Promise<unknown>) { return callback(client); },
    async lock(_connection: unknown, recordId: string, revision: number) { assert.equal(recordId, sessionId); assert.equal(revision, 4); return session; },
    async payload(_connection: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async save(_connection: unknown, record: typeof session, actor: string, _title: string, payload: Record<string, unknown>) {
      assert.equal(actor, userId); saved.push({ payload, revision: record.revision + 1 }); return { ...record, revision: record.revision + 1, payload };
    },
  });
  const result = await service.reconcileSessionZoomMeeting(sessionId, userId, {
    operation_key: operationKey, source_id: sourceId, expected_revision: 4, meeting_id: "1234567890123",
  });
  assert.equal(result.revision, 5);
  assert.equal(result.meeting_url, "https://us06web.zoom.us/j/123456");
  assert.equal(result.reused, false);
  assert.equal(zoomCalls.length, 1);
  assert.equal(zoomCalls[0].meetingId, "1234567890123");
  assert.deepEqual(zoomCalls[0].expected, { topic: "Suindá · Aula online", start: new Date("2099-05-01T10:00:00Z"), end: new Date("2099-05-01T11:00:00Z") });
  assert.equal(saved[0].payload.meeting_provider, "zoom");
  assert.equal(saved[0].payload.meeting_url, result.meeting_url);
  assert.equal(saved[0].payload.zoom_meeting_id, "1234567890123");
  assert.equal(saved[0].payload.zoom_connection_id, sourceId);
  assert.equal(saved[0].payload.zoom_owner_user_id, userId);
});

test("presença Zoom exige e-mail exato e matrícula única, respeita a janela e encaminha ambiguidades para revisão", () => {
  const start = Date.parse("2030-01-01T10:00:00Z"), end = Date.parse("2030-01-01T11:00:00Z");
  const result = reconcileZoomParticipantMinutes([
    { id: "enrollment-1", email: "aluna@example.test" },
    { id: "enrollment-2", email: "dup@example.test" },
    { id: "enrollment-3", email: "dup@example.test" },
  ], [
    { user_email: "aluna@example.test", join_time: "2030-01-01T10:10:00Z", leave_time: "2030-01-01T10:40:00Z" },
    { user_email: "other@example.test", name: "Aluna" } as never,
    { user_email: "dup@example.test", join_time: "2030-01-01T10:00:00Z", leave_time: "2030-01-01T10:20:00Z" },
    { user_email: "aluna@example.test", join_time: "2030-01-01T08:00:00Z", leave_time: "2030-01-01T09:00:00Z" },
    { user_email: "aluna@example.test", join_time: "2030-01-01T10:50:00Z", leave_time: "2030-01-01T12:00:00Z" },
  ], start, end);
  assert.equal(result.minutesByEnrollment.get("enrollment-1"), 40);
  assert.equal(result.minutesByEnrollment.has("enrollment-2"), false);
  assert.equal(result.reviewRequired, 3);
});

test("presença Meet e Teams soma intervalos, limita a janela e não associa identidades ambíguas", () => {
  const start = Date.parse("2030-01-01T10:00:00Z"), end = Date.parse("2030-01-01T11:00:00Z");
  const result = reconcileRemoteParticipantMinutes([
    { id: "enrollment-1", email: "student@example.test" },
    { id: "enrollment-2", email: "duplicate@example.test" },
    { id: "enrollment-3", email: "duplicate@example.test" },
  ], [
    { email: "STUDENT@example.test", intervals: [
      { joinedAt: "2030-01-01T09:50:00Z", leftAt: "2030-01-01T10:15:00Z" },
      { joinedAt: "2030-01-01T10:45:00Z", leftAt: "2030-01-01T11:10:00Z" },
    ] },
    { email: "unknown@example.test", intervals: [{ joinedAt: "2030-01-01T10:00:00Z", leftAt: "2030-01-01T10:30:00Z" }] },
    { email: "duplicate@example.test", intervals: [{ joinedAt: "2030-01-01T10:00:00Z", leftAt: "2030-01-01T10:30:00Z" }] },
    { email: null, intervals: [{ joinedAt: "2030-01-01T10:00:00Z", leftAt: "2030-01-01T10:30:00Z" }] },
  ], start, end);
  assert.equal(result.minutesByEnrollment.get("enrollment-1"), 30);
  assert.equal(result.minutesByEnrollment.has("enrollment-2"), false);
  assert.equal(result.reviewRequired, 3);
});

test("Google Meet importa frequência vinculada à conta e à sessão, uma vez", async () => {
  const workspaceId = randomUUID(), sessionId = randomUUID(), cohortId = randomUUID(), courseId = randomUUID();
  const enrollmentId = randomUUID(), teacherId = randomUUID(), connectionId = randomUUID();
  const now = Date.now(), starts = new Date(now - 3_600_000).toISOString(), ends = new Date(now - 1_800_000).toISOString();
  const session = { id: sessionId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Meet turma", state: "completed", revision: 2,
    payload: { cohort_record_id: cohortId, instructor_user_id: teacherId, modality: "online", starts_at: starts, ends_at: ends,
      meeting_provider: "google_meet", meeting_url: "https://meet.google.com/abc-defg-hij", meeting_connection_id: connectionId, meeting_owner_user_id: teacherId } };
  const cohort = { id: cohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma", state: "active", revision: 1, payload: { course_record_id: courseId, course_revision: 1 } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "published", revision: 1, payload: { instructor_user_id: teacherId } };
  const enrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1,
    email: "student@example.test", payload: { learner_user_id: randomUUID(), cohort_record_id: cohortId, course_revision: 1 } };
  const oldFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/conferenceRecords?") ) return Response.json({ conferenceRecords: [{ name: "conferenceRecords/conf-1", space: { meetingCode: "abc-defg-hij" }, startTime: starts, endTime: ends }] });
    if (url.endsWith("/conferenceRecords/conf-1")) return Response.json({ name: "conferenceRecords/conf-1", startTime: starts, endTime: ends });
    if (url.endsWith("/conferenceRecords/conf-1/participants?pageSize=250")) return Response.json({ participants: [{ name: "conferenceRecords/conf-1/participants/participant-1", signedinUser: { email: "STUDENT@example.test" } }] });
    if (url.endsWith("/conferenceRecords/conf-1/participants/participant-1/participantSessions?pageSize=250"))
      return Response.json({ participantSessions: [{ startTime: new Date(Date.parse(starts) + 60_000).toISOString(), endTime: new Date(Date.parse(ends) - 60_000).toISOString() }] });
    throw new Error(`Unexpected Meet API request: ${url}`);
  };
  const attendanceState: { current: Record<string, unknown> | null } = { current: null };
  let audits = 0;
  const client = { async query(sql: string, params: unknown[] = []) {
    if (sql.includes("integration_connections")) return { rows: [{ id: connectionId }] };
    if (sql.includes("kind='cohort'")) return { rows: [cohort] };
    if (sql.includes("kind='course'")) return { rows: [course] };
    if (sql.includes("kind='enrollment'")) return { rows: [enrollment] };
    if (sql.includes("payload->>'attendance_key'")) return { rows: attendanceState.current ? [{ id: "attendance-1", payload: attendanceState.current }] : [] };
    if (sql.includes("INSERT INTO extension_records") && sql.includes("'attendance'")) { attendanceState.current = JSON.parse(String(params[2])); return { rows: [{ id: "attendance-1" }] }; }
    if (sql.includes("access_audit")) { audits++; return { rows: [] }; }
    return { rows: [] };
  } };
  try {
    const service = new ExtensionRecords({ async one(sql: string) { return sql.includes("kind='session'") ? session : null; } } as never,
      { async has() { return true; } } as never, learningRegistry(), new DocumentScanner(), undefined, undefined, undefined, undefined, undefined, undefined,
      { async token() { return "google-token"; } } as never) as unknown as {
        syncRemoteAttendance(session: string, provider: "google_meet", actor: string, body: Record<string, unknown>): Promise<{ recorded: number; preserved: number; review_required: number }>;
      };
    Object.assign(service, {
      assertAvailable() {},
      async mutation(_plugin: string, _workspace: string, _actor: string, _key: unknown, _input: unknown, callback: (conn: never) => Promise<unknown>) { return callback(client as never); },
      async lock(_conn: unknown, _id: string, revision: number) { assert.equal(revision, 2); return session; },
      async payload(_conn: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    });
    const first = await service.syncRemoteAttendance(sessionId, "google_meet", teacherId, { operation_key: randomUUID(), expected_revision: 2 });
    assert.deepEqual(first, { session_id: sessionId, report_id: "conferenceRecords/conf-1", recorded: 1, preserved: 0, review_required: 0, participants: 1 });
    assert.equal(attendanceState.current?.minutes_attended, 28);
    assert.equal(attendanceState.current?.checkin_method, "online");
    attendanceState.current = { ...attendanceState.current!, status: "late", minutes_attended: 12, checkin_method: "teacher" };
    const second = await service.syncRemoteAttendance(sessionId, "google_meet", teacherId, { operation_key: randomUUID(), expected_revision: 2 });
    assert.equal(second.recorded, 0);
    assert.equal(second.preserved, 1);
    assert.equal(attendanceState.current!.status, "late");
    assert.equal(attendanceState.current!.minutes_attended, 12);
    assert.equal(audits, 2);
  } finally { global.fetch = oldFetch; }
});

test("sincronização Zoom cria presença uma vez e preserva chamada manual existente", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000920";
  const sessionId = "00000000-0000-4000-8000-000000000921";
  const cohortId = "00000000-0000-4000-8000-000000000922";
  const courseId = "00000000-0000-4000-8000-000000000923";
  const enrollmentId = "00000000-0000-4000-8000-000000000924";
  const teacherId = "00000000-0000-4000-8000-000000000925";
  const unassignedId = "00000000-0000-4000-8000-000000000928";
  const sessionInstructorId = "00000000-0000-4000-8000-000000000929";
  const connectionId = "00000000-0000-4000-8000-000000000926";
  const now = Date.now();
  const session = { id: sessionId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Zoom turma",
    state: "completed", revision: 2, payload: { cohort_record_id: cohortId, instructor_user_id: sessionInstructorId, modality: "online",
      starts_at: new Date(now - 3_600_000).toISOString(), ends_at: new Date(now - 1_800_000).toISOString(), meeting_provider: "zoom",
      zoom_meeting_id: "1234567890", zoom_connection_id: connectionId, zoom_owner_user_id: teacherId } };
  const cohort = { id: cohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma", state: "active", revision: 1,
    payload: { course_record_id: courseId, course_revision: 1 } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "published", revision: 1, payload: { instructor_user_id: teacherId } };
  const learnerId = "00000000-0000-4000-8000-000000000927";
  const enrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula", state: "active", revision: 1,
    email: "student@example.test", payload: { learner_user_id: learnerId, cohort_record_id: cohortId, course_revision: 1 } };
  const attendanceState: { current: Record<string, unknown> | null } = { current: null };
  let audits = 0;
  const client = { async query(sql: string, params: unknown[] = []) {
    if (sql.includes("integration_connections")) return { rows: [{ id: connectionId }] };
    if (sql.includes("kind='cohort'")) return { rows: [cohort] };
    if (sql.includes("kind='course'")) return { rows: [course] };
    if (sql.includes("kind='enrollment'")) return { rows: [enrollment] };
    if (sql.includes("payload->>'attendance_key'")) return { rows: attendanceState.current ? [{ id: "attendance-record", payload: attendanceState.current }] : [] };
    if (sql.includes("INSERT INTO extension_records") && sql.includes("'attendance'")) {
      attendanceState.current = JSON.parse(String(params[2])); return { rows: [{ id: "attendance-record" }] };
    }
    if (sql.includes("access_audit")) { audits++; return { rows: [] }; }
    return { rows: [] };
  } };
  const report = { details: { id: 1234567890, topic: "Suindá · Zoom turma", start_time: session.payload.starts_at, duration: 30 },
    participants: [{ user_email: "student@example.test", join_time: session.payload.starts_at, leave_time: session.payload.ends_at }] };
  let mutationOpen = false;
  let reportReads = 0;
  let forceLockConflict = false;
  let permissionGranted = false;
  let revokePermissionDuringFetch = false;
  const db = { async one(sql: string) { return sql.includes("integration_connections") ? { id: connectionId } : session; } };
  const service = new ExtensionRecords(db as never, { async has() { return permissionGranted; } } as never, learningRegistry(), new DocumentScanner(),
    undefined, undefined, undefined, undefined, { async pastParticipants() { assert.equal(mutationOpen, false); reportReads++; if (revokePermissionDuringFetch) permissionGranted = false; return report; } } as never) as unknown as {
      syncZoomAttendance(session: string, actor: string, body: Record<string, unknown>): Promise<{ recorded: number; preserved: number }>;
    };
  Object.assign(service, {
    assertAvailable() {},
    async mutation(_plugin: string, _workspace: string, _actor: string, _key: unknown, _input: unknown, callback: (conn: never) => Promise<unknown>) {
      mutationOpen = true; try { return await callback(client as never); } finally { mutationOpen = false; }
    },
    async lock(_conn: unknown, _id: string, revision: number) { assert.equal(revision, 2); if (forceLockConflict) throw new Error("revision conflict"); return session; },
    async payload(_conn: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
  });
  const first = await service.syncZoomAttendance(sessionId, teacherId, { operation_key: randomUUID(), expected_revision: 2 });
  assert.deepEqual(first, { session_id: sessionId, recorded: 1, preserved: 0, review_required: 0, participants: 1 });
  assert.equal(attendanceState.current!.checkin_method, "online");
  attendanceState.current = { ...attendanceState.current!, checkin_method: "teacher", status: "late", minutes_attended: 12 };
  const second = await service.syncZoomAttendance(sessionId, teacherId, { operation_key: randomUUID(), expected_revision: 2 });
  assert.equal(second.recorded, 0);
  assert.equal(second.preserved, 1);
  assert.equal(attendanceState.current!.status, "late");
  assert.equal(attendanceState.current!.minutes_attended, 12);
  assert.equal(audits, 2);
  permissionGranted = true;
  revokePermissionDuringFetch = true;
  await assert.rejects(() => service.syncZoomAttendance(sessionId, unassignedId, { operation_key: randomUUID(), expected_revision: 2 }),
    (error: unknown) => error instanceof Error && error.message.includes("não está atribuído"));
  assert.equal(attendanceState.current!.status, "late");
  permissionGranted = false;
  revokePermissionDuringFetch = false;
  await assert.rejects(() => service.syncZoomAttendance(sessionId, teacherId, { operation_key: randomUUID(), expected_revision: 1 }));
  assert.equal(reportReads, 3);
  forceLockConflict = true;
  await assert.rejects(() => service.syncZoomAttendance(sessionId, teacherId, { operation_key: randomUUID(), expected_revision: 2 }));
  assert.equal(attendanceState.current!.status, "late");
  forceLockConflict = false;
  report.details.topic = "Outra reunião";
  await assert.rejects(() => service.syncZoomAttendance(sessionId, teacherId, { operation_key: randomUUID(), expected_revision: 2 }));
  assert.equal(attendanceState.current!.status, "late");
});

test("iCalendar do aluno inclui encontros, prazos, práticas e eventos acadêmicos das próprias matrículas", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000221";
  const session = { id: "session-1", title: "Encontro seguro", state: "scheduled", payload: { starts_at: "2099-05-01T10:00:00Z", ends_at: "2099-05-01T11:00:00Z", modality: "in_person", location: "Sala 2" } };
  const assessment = { id: "assessment-1", title: "Prova final", payload: { due_at: "2099-05-04T23:59:00Z" }, course_title: "Curso de exemplo" };
  const practice = { id: "practice-1", title: "Prática clínica", payload: { scheduled_at: "2099-05-05T14:00:00Z", activity_description: "Atividade supervisionada", location: "Laboratório" } };
  const academicEvent = { id: "academic-event-1", title: "Recesso de inverno", payload: { event_type: "recess", starts_at: "2099-07-01T00:00:00Z", ends_at: "2099-07-08T00:00:00Z", all_day: true, description: "Pausa das atividades letivas", location: "Campus central" }, course_title: "Curso de exemplo", cohort_code: "T-7" };
  const db = { async query(sql: string) {
    if (sql.includes("kind='session'")) return [session];
    if (sql.includes("kind='assessment'")) return [assessment];
    if (sql.includes("kind='practice'")) return [practice];
    if (sql.includes("kind='academic_calendar_event'")) return [academicEvent];
    return [];
  } };
  const audited: string[] = [];
  const records = new ExtensionRecords(db as never, { async audit(_actor: string, action: string, target: string) { assert.equal(action, "suinda-learning.calendar.export"); audited.push(target); } } as never, learningRegistry(), new DocumentScanner());
  const calendar = await records.learnerCalendar(learnerId);
  assert.match(calendar, /SUMMARY:Encontro seguro/);
  assert.match(calendar, /SUMMARY:Prazo: Prova final/);
  assert.match(calendar, /DTSTART;VALUE=DATE:20990504/);
  assert.match(calendar, /SUMMARY:Prática: Prática clínica/);
  assert.match(calendar, /LOCATION:Laboratório/);
  assert.match(calendar, /DTSTART;VALUE=DATE:20990701/);
  assert.match(calendar, /DTEND;VALUE=DATE:20990708/);
  assert.match(calendar, /SUMMARY:Recesso: Recesso de inverno/);
  assert.match(calendar.replace(/\r\n /g, ""), /DESCRIPTION:Curso: Curso de exemplo\\nTurma: T-7\\nPausa das atividades letivas/);
  assert.match(calendar, /LOCATION:Campus central/);
  assert.deepEqual(audited.sort(), ["academic-event-1", "assessment-1", "practice-1", "session-1"]);
});

test("iCalendar do aluno pagina todos os tipos de evento após mil registros mantendo o filtro de matrícula", async () => {
  const learnerId = randomUUID();
  const ids = (prefix: string) => Array.from({ length: 1001 }, (_, index) =>
    `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const sessions = ids("00000000").map((id, index) => ({ id, title: `Encontro ${index + 1}`, state: "scheduled",
    payload: { starts_at: "2099-05-01T10:00:00Z", ends_at: "2099-05-01T11:00:00Z" }, course_title: "Curso" }));
  const assessments = ids("10000000").map((id, index) => ({ id, title: `Avaliação ${index + 1}`,
    payload: { due_at: "2099-05-04T23:59:00Z" }, course_title: "Curso" }));
  const practices = ids("20000000").map((id, index) => ({ id, title: `Prática ${index + 1}`,
    payload: { scheduled_at: "2099-05-05T14:00:00Z" } }));
  const academicEvents = ids("30000000").map((id, index) => ({ id, title: `Evento ${index + 1}`,
    payload: { event_type: "holiday", starts_at: "2099-07-01T00:00:00Z", ends_at: "2099-07-02T00:00:00Z", all_day: true },
    course_title: null, cohort_code: null }));
  const pageCursors: Record<string, Array<string | null>> = { sessions: [], assessments: [], practices: [], academicEvents: [] };
  const db = { async query(sql: string, values: unknown[] = []) {
    const cursor = values[2] as string | null;
    const limit = Number(values[3]);
    const paged = <T extends { id: string }>(key: keyof typeof pageCursors, records: T[]) => {
      assert.match(sql, /e\.payload->>'learner_user_id'=\$1/);
      pageCursors[key].push(cursor);
      return records.filter((record) => cursor === null || record.id > cursor).slice(0, limit);
    };
    if (sql.includes("s.kind='session'")) return paged("sessions", sessions);
    if (sql.includes("a.kind='assessment'")) return paged("assessments", assessments);
    if (sql.includes("p.kind='practice'")) return paged("practices", practices);
    if (sql.includes("a.kind='academic_calendar_event'")) return paged("academicEvents", academicEvents);
    return [];
  } };
  const audited: string[] = [];
  const records = new ExtensionRecords(db as never, { async audit(_actor: string, action: string, target: string) {
    assert.equal(action, "suinda-learning.calendar.export"); audited.push(target);
  } } as never, learningRegistry(), new DocumentScanner());

  const calendar = await records.learnerCalendar(learnerId);

  assert.match(calendar, new RegExp(`UID:${sessions.at(-1)!.id}@suinda`));
  assert.match(calendar, new RegExp(`UID:${assessments.at(-1)!.id}@suinda-assessment`));
  assert.match(calendar, new RegExp(`UID:${practices.at(-1)!.id}@suinda-practice`));
  assert.match(calendar, new RegExp(`UID:${academicEvents.at(-1)!.id}@suinda-academic-event`));
  assert.deepEqual(pageCursors.sessions, [null, sessions[999]!.id]);
  assert.deepEqual(pageCursors.assessments, [null, assessments[999]!.id]);
  assert.deepEqual(pageCursors.practices, [null, practices[999]!.id]);
  assert.deepEqual(pageCursors.academicEvents, [null, academicEvents[999]!.id]);
  assert.equal(audited.length, 4004);
});

test("catálogo público expõe apenas campos autorizados de cursos publicados", async () => {
  const registry = learningRegistry();
  const db = {
    async query(sql: string, values: unknown[]) {
      assert.match(sql, /w\.archived_at IS NULL/);
      assert.doesNotMatch(sql, /(?:WHERE|AND)\s+(?:r\.)?workspace_id\s*=/i);
      assert.deepEqual(values, ["suinda-learning", "course", suindaRecordKinds.course.publicRead?.states]);
      return ["workspace-1", "workspace-2"].map((workspaceId, index) => ({
        id: `record-${index + 1}`, workspace_id: workspaceId, workspace_name: `Instituto ${index + 1}`, plugin_id: "suinda-learning",
        kind: "course", title: `Curso aberto ${index + 1}`, state: "enrollment_open", revision: 2,
        payload: { summary: "Introdução", instructor_ids: ["private-user"], capacity: 20 },
      }));
    },
  };
  const records = new ExtensionRecords(db as never, {} as never, registry, new DocumentScanner());
  const courses = await records.publicList("suinda-learning", "course");
  assert.equal(courses.length, 2);
  assert.deepEqual(courses[0].payload, { summary: "Introdução", capacity: 20 });
  assert.deepEqual(courses.map((course) => course.workspace_name), ["Instituto 1", "Instituto 2"]);
});

test("detalhe público retorna apenas a projeção publicada e oculta cursos indisponíveis", async () => {
  const registry = learningRegistry();
  const recordId = "00000000-0000-4000-8000-000000000099";
  const db = {
    async one(sql: string, values: unknown[]) {
      assert.match(sql, /r\.state=ANY\(\$4::text\[\]\)/);
      assert.deepEqual(values, [recordId, "suinda-learning", "course", suindaRecordKinds.course.publicRead?.states]);
      return {
        id: recordId, workspace_id: "workspace-1", workspace_name: "Instituto", plugin_id: "suinda-learning",
        kind: "course", title: "Curso publicado", state: "published", revision: 3,
        payload: { summary: "Visão pública", instructor_ids: ["private-user"], capacity: 20 },
      };
    },
  };
  const records = new ExtensionRecords(db as never, {} as never, registry, new DocumentScanner());
  const course = await records.publicDetail("suinda-learning", "course", recordId);
  assert.deepEqual(course.payload, { summary: "Visão pública", capacity: 20 });
  assert.equal(course.id, recordId);
});

test("detalhe público mostra nomes de pré-requisitos visíveis no mesmo workspace e omite IDs", async () => {
  const courseId = "00000000-0000-4000-8000-000000000091";
  const workspaceId = "00000000-0000-4000-8000-000000000092";
  const visiblePrerequisiteId = "00000000-0000-4000-8000-000000000093";
  const hiddenPrerequisiteId = "00000000-0000-4000-8000-000000000094";
  const rawCourse = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course",
    title: "Curso aberto", state: "enrollment_open", revision: 2,
    payload: { prerequisite_course_ids: [visiblePrerequisiteId, hiddenPrerequisiteId] } };
  let prerequisiteSql = "";
  const db = {
    async one() { return rawCourse; },
    async query(sql: string, values: unknown[]) {
      prerequisiteSql = sql;
      assert.deepEqual(values, [workspaceId, [visiblePrerequisiteId, hiddenPrerequisiteId], courseId,
        ["published", "enrollment_open", "in_progress", "closed", "completed"]]);
      return [{ id: visiblePrerequisiteId, title: "Fundamentos" }];
    },
  };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async publicDetail() { return { id: courseId, workspace_id: workspaceId, title: rawCourse.title, state: rawCourse.state,
      revision: rawCourse.revision, payload: { prerequisite_course_ids: [visiblePrerequisiteId, hiddenPrerequisiteId] } }; },
    async publicCourseStaff() { return new Map(); },
    async publicCourses() { return []; },
    async courseWorkloadHours() { return 0; },
  });
  const result = await service.publicCourse(courseId);
  assert.deepEqual(result.payload.prerequisite_courses, ["Fundamentos"]);
  assert.equal("prerequisite_course_ids" in result.payload, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${visiblePrerequisiteId}|${hiddenPrerequisiteId}`));
  assert.match(prerequisiteSql, /c\.workspace_id=\$1/);
  assert.match(prerequisiteSql, /c\.state=ANY\(\$4::text\[\]\)/);
  assert.match(prerequisiteSql, /JOIN workspaces w ON w\.id=c\.workspace_id AND w\.archived_at IS NULL/);
  const courseProperties = suindaRecordKinds.course.schema.properties as Record<string, { title?: string }>;
  assert.equal(courseProperties.prerequisite_course_ids.title, "Cursos pré-requisitos verificáveis");
});

test("validadores de inscrição podem conferir referências públicas sem receber campos privados", async () => {
  const recordId = "00000000-0000-4000-8000-000000000098";
  const workspaceId = "00000000-0000-4000-8000-000000000097";
  let state = "enrollment_open";
  const db = {
    async one() { return { id: workspaceId }; },
    async query(sql: string) {
      assert.match(sql, /FROM extension_records r JOIN extension_record_versions/);
      return [{ id: recordId, pluginId: "suinda-learning", kind: "course", state, revision: 4, payload: { capacity: 12, format: "open", private_field: "secret" } }];
    },
  };
  const access = {
    async has() { return false; },
    async require() { throw new Error("denied"); },
  };
  const registry = learningRegistry();
  const records = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  const context = (records as unknown as { validationContext(workspace: string, user: string): RecordValidationContext }).validationContext(workspaceId, "learner");
  const publicCourse = await context.resolveLatestRecord!(recordId);
  assert.deepEqual(publicCourse?.payload, { capacity: 12, format: "open" });
  state = "draft";
  assert.equal(await context.resolveLatestRecord!(recordId), null);
});

test("turmas públicas ficam limitadas ao workspace e à revisão do curso e ocultam links privados", async () => {
  const courseId = "00000000-0000-4000-8000-000000000096";
  const workspaceId = "00000000-0000-4000-8000-000000000095";
  const db = {
    async one(sql: string, values: unknown[]) {
      assert.match(sql, /r\.revision,w\.name/);
      assert.deepEqual(values, [courseId, "suinda-learning", "course", suindaRecordKinds.course.publicRead?.states]);
      return { workspace_id: workspaceId, revision: 3, workspace_name: "Instituto" };
    },
    async query(sql: string, values: unknown[]) {
      assert.match(sql, /payload->>\$7=\(\$8::integer\)::text/);
      assert.match(sql, /AS seats_remaining/);
      assert.deepEqual(values, [workspaceId, "suinda-learning", "cohort", suindaRecordKinds.cohort.publicRead?.states, "course_record_id", courseId, "course_revision", 3, "capacity", "enrollment", ["approved", "enrolled", "active", "paused"], "cohort_record_id"]);
      return [{ id: "cohort-1", workspace_id: workspaceId, kind: "cohort", title: "Turma de maio", state: "enrolling", revision: 1, seats_remaining: 7, payload: { code: "MAI-01", capacity: 20, meeting_url: "https://private.test", course_revision: 3 } }];
    },
  };
  const registry = learningRegistry();
  const records = new ExtensionRecords(db as never, {} as never, registry, new DocumentScanner());
  const cohorts = await records.publicRelatedList("suinda-learning", "course", courseId, "cohort", "course_record_id");
  assert.equal(cohorts.length, 1);
  assert.deepEqual(cohorts[0].payload, { code: "MAI-01", capacity: 20, course_revision: 3, seats_remaining: 7 });
});

test("painel pessoal lista somente matrículas do próprio aluno e registra leitura auditável", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000094";
  const enrollmentId = "00000000-0000-4000-8000-000000000093";
  const record = {
    id: enrollmentId, workspace_id: "00000000-0000-4000-8000-000000000092", plugin_id: "suinda-learning", kind: "enrollment",
    title: "Inscrição · Curso", state: "submitted", revision: 1, payload: { learner_user_id: learnerId, course_record_id: cohortId },
  };
  const audited: unknown[][] = [];
  const db = {
    async one(sql: string, values: unknown[]) {
      assert.match(sql, /SELECT workspace_id,state,payload FROM extension_records/);
      assert.deepEqual(values, [enrollmentId, "suinda-learning", "enrollment"]);
      return { workspace_id: record.workspace_id, state: record.state, payload: record.payload };
    },
    async query(sql: string, values: unknown[]) {
      assert.match(sql, /payload->>\$3=\$4/);
      assert.deepEqual(values, ["suinda-learning", "enrollment", "learner_user_id", learnerId]);
      return [record];
    },
  };
  const access = { async audit(...args: unknown[]) { audited.push(args); }, async has() { return false; } };
  const registry = learningRegistry();
  const records = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  const own = await records.mine("suinda-learning", "enrollment", learnerId);
  assert.deepEqual(own.map((item) => item.id), [enrollmentId]);
  assert.deepEqual(audited, [[learnerId, "suinda-learning.record.read", enrollmentId, { type: "extension_record", id: enrollmentId }]]);
  await assert.rejects(records.mine("suinda-learning", "course", learnerId), /não possui registros pessoais/);
});

test("painel do aluno agrega calendário, pendências, avisos e certificado sem misturar matrículas de terceiros", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000141";
  const otherLearnerId = "00000000-0000-4000-8000-000000000142";
  const workspaceId = "00000000-0000-4000-8000-000000000143";
  const courseId = "00000000-0000-4000-8000-000000000144";
  const cohortId = "00000000-0000-4000-8000-000000000145";
  const enrollmentId = "00000000-0000-4000-8000-000000000146";
  const otherEnrollmentId = "00000000-0000-4000-8000-000000000147";
  const assessmentId = "00000000-0000-4000-8000-000000000148";
  const enrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Minha turma", state: "active", revision: 1, payload: { learner_user_id: learnerId, course_record_id: courseId, cohort_record_id: cohortId } };
  const otherEnrollment = { ...enrollment, id: otherEnrollmentId, title: "Matrícula de outra pessoa", payload: { ...enrollment.payload, learner_user_id: otherLearnerId } };
  const session = { id: "00000000-0000-4000-8000-000000000149", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Aula próxima", state: "scheduled", revision: 1, payload: { cohort_record_id: cohortId, starts_at: "2030-01-02T12:00:00Z", modality: "online", meeting_url: "https://example.test/meeting" } };
  const certificate = { id: "00000000-0000-4000-8000-000000000150", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "certificate", title: "Certificado", state: "issued", revision: 1, payload: { learner_user_id: learnerId, enrollment_record_id: enrollmentId, certificate_code: "S-2026-001" } };
  const assignment = { id: assessmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "assessment", title: "Atividade pendente", state: "published", revision: 1, payload: { course_record_id: courseId, cohort_record_id: cohortId, assessment_type: "assignment", due_at: "2030-01-03T12:00:00Z" }, submission_state: null };
  const announcement = (suffix: number, payload: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`, workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "announcement", title: `Aviso ${suffix}`, state: "sent", revision: 1,
    payload: { audience_type: "cohort", audience_record_id: cohortId, body: `Leia o material ${suffix}.`,
      sent_at: `2030-01-${String(suffix <= 153 ? suffix - 131 : suffix - 153).padStart(2, "0")}T12:00:00Z`, ...payload },
  });
  const announcements = [
    announcement(151), announcement(152), announcement(153),
    announcement(154, { requires_read_confirmation: true }), announcement(155, { requires_read_confirmation: true }),
    announcement(156, { requires_read_confirmation: true }),
    announcement(157, { audience_record_id: "00000000-0000-4000-8000-000000000999", requires_read_confirmation: true }),
  ];
  const readReceipt = { id: "00000000-0000-4000-8000-000000000158", workspace_id: workspaceId, plugin_id: "suinda-learning",
    kind: "announcement_read_receipt", title: "Leitura confirmada", state: "recorded", revision: 1,
    payload: { learner_user_id: learnerId, enrollment_record_id: enrollmentId, announcement_record_id: announcements[5].id, read_at: "2030-01-20T12:00:00Z" } };
  const db = {
    async one(sql: string) { return sql.includes("FROM extension_records") ? enrollment : null; },
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("payload->>$3=$4")) { assert.deepEqual(values, ["suinda-learning", "enrollment", "learner_user_id", learnerId]); return [enrollment, otherEnrollment]; }
      if (sql.includes("JOIN extension_records c ON c.id::text=e.payload->>'cohort_record_id'")) return [session];
      if (sql.includes("kind='certificate'")) return [certificate];
      if (sql.includes("LEFT JOIN LATERAL")) return [assignment];
      if (sql.includes("WITH learner_enrollments AS")) {
        assert.match(sql, /FROM extension_records WHERE id=ANY\(\$1::uuid\[\]\).*kind='enrollment'/s);
        assert.match(sql, /NOT EXISTS/);
        assert.deepEqual(values, [[enrollmentId], learnerId]);
        return announcements;
      }
      if (sql.includes("kind='announcement_read_receipt'")) return [readReceipt];
      return [];
    },
  };
  const registry = learningRegistry();
  const service = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never, registry, new DocumentScanner());
  const dashboard = await service.learnerDashboard(learnerId);
  assert.equal(dashboard.length, 1);
  assert.equal(dashboard[0].id, enrollmentId);
  assert.equal(dashboard[0].dashboard.next_sessions[0].id, session.id);
  assert.equal(dashboard[0].dashboard.pending_assignments[0].id, assessmentId);
  assert.equal(dashboard[0].dashboard.certificate?.certificate_code, "S-2026-001");
  assert.deepEqual(dashboard[0].dashboard.announcements.map((item: { id: string }) => item.id),
    [announcements[2].id, announcements[1].id, announcements[0].id, announcements[4].id, announcements[3].id]);
  assert.equal(dashboard[0].dashboard.announcements.find((item: { id: string }) => item.id === announcements[3].id)?.read_at, null);
  assert.equal(dashboard[0].dashboard.announcements.some((item: { id: string }) => item.id === announcements[5].id), false);
  assert.equal(dashboard[0].dashboard.announcements.some((item: { id: string }) => item.id === announcements[6].id), false);
});

test("painel do aluno preserva próximos encontros e atividades depois das primeiras 500 linhas globais", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000401";
  const workspaceId = "00000000-0000-4000-8000-000000000402";
  const courseAId = "00000000-0000-4000-8000-000000000403";
  const courseBId = "00000000-0000-4000-8000-000000000404";
  const cohortAId = "00000000-0000-4000-8000-000000000405";
  const cohortBId = "00000000-0000-4000-8000-000000000406";
  const enrollmentAId = "00000000-0000-4000-8000-000000000407";
  const enrollmentBId = "00000000-0000-4000-8000-000000000408";
  const enrollments = [
    { id: enrollmentAId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Turma A", state: "submitted", revision: 1,
      payload: { learner_user_id: learnerId, course_record_id: courseAId, cohort_record_id: cohortAId } },
    { id: enrollmentBId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Turma B", state: "submitted", revision: 1,
      payload: { learner_user_id: learnerId, course_record_id: courseBId, cohort_record_id: cohortBId } },
  ];
  const sessions = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(410 + index).padStart(12, "0")}`, workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "session", title: `Encontro ${index + 1}`, state: "scheduled", revision: 1,
    payload: { cohort_record_id: index === 500 ? cohortBId : cohortAId, starts_at: `2030-01-${String(Math.floor(index / 24) + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00Z`, ends_at: "2030-12-31T23:59:00Z", modality: "online" },
  }));
  const assessments = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`, workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "assessment", title: `Atividade ${index + 1}`, state: "published", revision: 1,
    payload: { course_record_id: index === 500 ? courseBId : courseAId, cohort_record_id: index === 500 ? cohortBId : cohortAId,
      assessment_type: "assignment", due_at: `2030-01-${String(Math.floor(index / 24) + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00Z` }, submission_state: null,
  }));
  const db = {
    async one(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT workspace_id,state,payload FROM extension_records")) {
        const record = enrollments.find((entry) => entry.id === values[0]);
        return record ? { workspace_id: record.workspace_id, state: record.state, payload: record.payload } : null;
      }
      return null;
    },
    async query(sql: string) {
      if (sql.includes("payload->>$3=$4")) return enrollments;
      if (sql.includes("JOIN extension_records c ON c.id::text=e.payload->>'cohort_record_id'")) {
        assert.doesNotMatch(sql, /LIMIT\s+500/i);
        return sessions;
      }
      if (sql.includes("LEFT JOIN LATERAL") && sql.includes("kind='assessment'")) {
        assert.doesNotMatch(sql, /LIMIT\s+500/i);
        return assessments;
      }
      if (sql.includes("JOIN extension_records a ON a.id::text=e.payload->>'course_record_id'")) return [];
      if (sql.includes("kind='announcement_read_receipt'")) return [];
      if (sql.includes("WITH learner_enrollments AS")) return [];
      if (sql.includes("kind='payment_entry'")) return [];
      if (sql.includes("suinda_financial_agreements")) return [];
      return [];
    },
  };
  const service = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  const dashboard = await service.learnerDashboard(learnerId);
  assert.equal(dashboard.length, 2);
  assert.equal(dashboard.find((entry) => entry.id === enrollmentBId)!.dashboard.next_sessions[0]!.id, sessions[500]!.id);
  assert.equal(dashboard.find((entry) => entry.id === enrollmentBId)!.dashboard.pending_assignments[0]!.id, assessments[500]!.id);
});

test("área de aprendizagem libera a próxima aula após concluir pré-requisito e filtra matrícula de terceiros", async () => {
  const learnerId = "00000000-0000-4000-8000-000000000091";
  const enrollmentId = "00000000-0000-4000-8000-000000000090";
  const courseId = "00000000-0000-4000-8000-000000000089";
  const moduleId = "00000000-0000-4000-8000-000000000088";
  const unitId = "00000000-0000-4000-8000-000000000082";
  const firstLessonId = "00000000-0000-4000-8000-000000000087";
  const secondLessonId = "00000000-0000-4000-8000-000000000086";
  const sessionOneId = "00000000-0000-4000-8000-000000000084";
  const sessionTwoId = "00000000-0000-4000-8000-000000000083";
  const recordedSessionId = "00000000-0000-4000-8000-000000000081";
  let firstLessonCompleted = false;
  const enrollmentRecord = {
    id: enrollmentId, workspace_id: "00000000-0000-4000-8000-000000000085", plugin_id: "suinda-learning", kind: "enrollment",
    title: "Inscrição · Curso", state: "active", revision: 2,
    payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 3, cohort_record_id: cohortId, payment_status: "not_required" },
  };
  const module = { id: moduleId, workspace_id: enrollmentRecord.workspace_id, plugin_id: "suinda-learning", kind: "module", title: "Módulo 1", state: "published", revision: 1, payload: { course_record_id: courseId, course_revision: 3, position: 1, sequential: true, competencies: ["Investigar"], skills: ["Análise"] } };
  const unit = { id: unitId, workspace_id: enrollmentRecord.workspace_id, plugin_id: "suinda-learning", kind: "learning_unit", title: "Unidade 1", state: "published", revision: 1, payload: { module_record_id: moduleId, position: 1, competencies: ["Relacionar conceitos"], skills: ["Síntese"] } };
  const lessons = [
    { id: firstLessonId, workspace_id: enrollmentRecord.workspace_id, plugin_id: "suinda-learning", kind: "lesson", title: "Aula 1", state: "published", revision: 1, payload: { module_record_id: moduleId, unit_record_id: unitId, position: 1, content_type: "article", required: true, competencies: ["Aplicar método"], body_markdown: "Primeira aula" } },
    { id: secondLessonId, workspace_id: enrollmentRecord.workspace_id, plugin_id: "suinda-learning", kind: "lesson", title: "Aula 2", state: "published", revision: 1, payload: { module_record_id: moduleId, unit_record_id: unitId, position: 2, content_type: "video", content_url: "https://youtu.be/AbCdEf12345", provider_captions_confirmed: true, transcript: "Transcrição revisada", required: true, skills: ["Produzir análise"], prerequisites: [firstLessonId], body_markdown: "Segunda aula" } },
  ];
  const extraLessons = Array.from({ length: 999 }, (_, index) => ({ id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: enrollmentRecord.workspace_id, plugin_id: "suinda-learning", kind: "lesson", title: `Aula adicional ${index + 1}`,
    state: "published", revision: 1, payload: { module_record_id: moduleId, unit_record_id: unitId, position: index + 3, content_type: "article", required: true } }));
  const attendanceSessions = [
    { id: sessionOneId, state: "completed", payload: { starts_at: "2025-01-01T10:00:00Z", ends_at: "2025-01-01T11:00:00Z" }, attendance_payload: { status: "late", minutes_attended: 45 } },
    { id: sessionTwoId, state: "completed", payload: { starts_at: "2025-01-02T10:00:00Z", ends_at: "2025-01-02T11:00:00Z" }, attendance_payload: { status: "absent", minutes_attended: 0 } },
    ...Array.from({ length: 999 }, (_, index) => ({ id: randomUUID(), state: "completed", payload: {
      starts_at: new Date(Date.UTC(2025, 1, 1 + index)).toISOString(), ends_at: new Date(Date.UTC(2025, 1, 1 + index, 1)).toISOString(),
    }, attendance_payload: { status: "absent", minutes_attended: 0 } })),
  ];
  const learningSql: string[] = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("suinda_practice_credit_ledger")) return { credited_hours: 2.25 };
      if (sql.includes("JOIN extension_record_versions")) return { title: "Curso", state: "enrollment_open", revision: 3, payload: { description: "Resumo", price_amount: 0, competencies: ["Compreender"], skills: ["Pesquisar"] } };
      return enrollmentRecord;
    },
    async query(sql: string) {
      learningSql.push(sql);
      if (sql.includes("s.state=ANY(ARRAY['scheduled','live','completed'])")) return [
        { id: recordedSessionId, title: "Aula gravada", state: "completed", payload: { modality: "online", starts_at: "2025-01-03T10:00:00Z", recording_url: "https://media.example.org/recording" } },
      ];
      if (sql.includes("s.kind='session'")) return attendanceSessions;
      if (sql.includes("kind='module'")) return [module];
      if (sql.includes("kind='lesson_progress'")) return firstLessonCompleted ? [{ payload: { lesson_record_id: firstLessonId } }] : [];
      if (sql.startsWith("SELECT * FROM extension_records") && sql.includes("kind='learning_unit'")) return [unit];
      if (sql.includes("l.kind='lesson'")) return [...lessons, ...extraLessons];
      return [];
    },
  };
  const access = { async has() { return false; }, async audit() {} };
  const registry = learningRegistry();
  const records = new ExtensionRecords(db as never, access as never, registry, new DocumentScanner());
  const locked = await records.learnerLearning(enrollmentId, learnerId);
  assert.equal(locked.live_sessions[0].recording_url, "https://media.example.org/recording");
  assert.equal(locked.live_sessions[0].meeting_url, null);
  assert.deepEqual(locked.attendance, {
    percent: 0.07, minimum_percent: 75, attended_minutes: 45, scheduled_minutes: 60060,
    sessions_present: 1, sessions_absent: 1000, sessions_unmarked: 0, meets_minimum: false,
  });
  assert.equal(locked.modules[0].lessons[0].available, true);
  assert.deepEqual(locked.course.payload.competencies, ["Compreender"]);
  assert.deepEqual(locked.modules[0].payload.skills, ["Análise"]);
  assert.deepEqual(locked.modules[0].units[0].payload.competencies, ["Relacionar conceitos"]);
  assert.deepEqual(locked.modules[0].lessons[0].payload.competencies, ["Aplicar método"]);
  assert.equal(locked.modules[0].lessons[1].available, false);
  assert.equal(locked.modules[0].lessons.length, 1001);
  assert.equal(locked.modules[0].lessons.at(-1)?.id, extraLessons.at(-1)?.id);
  assert.doesNotMatch(learningSql.find((sql) => sql.includes("s.kind='session'"))!, /LIMIT\s+1000/i);
  assert.doesNotMatch(learningSql.find((sql) => sql.includes("l.kind='lesson'"))!, /LIMIT\s+1000/i);
  assert.equal("body_markdown" in locked.modules[0].lessons[1].payload, false);
  firstLessonCompleted = true;
  const unlocked = await records.learnerLearning(enrollmentId, learnerId);
  assert.deepEqual(unlocked.workload_progress, {
    attended_class_hours: 0.75, validated_practice_hours: 0, credited_practice_hours: 2.25, completed_hours: 3,
  });
  assert.equal(unlocked.modules[0].lessons[1].available, true);
  assert.equal(unlocked.modules[0].lessons[1].payload.provider_captions_confirmed, true);
  assert.equal(unlocked.modules[0].lessons[1].payload.transcript, "Transcrição revisada");
  assert.equal(unlocked.modules[0].lessons[1].payload.body_markdown, "Segunda aula");
  assert.deepEqual(unlocked.modules[0].lessons[1].payload.skills, ["Produzir análise"]);
  assert.deepEqual(unlocked.modules[0].progress, { required_total: 1001, required_completed: 1, percent: 0 });
  assert.equal(unlocked.progress.percent, 0);
  await assert.rejects(records.learnerLearning(enrollmentId, "another-student"), /Matrícula não encontrada/);
});

test("alerta de frequência mede minutos de encontros encerrados na revisão matriculada", () => {
  const enrollment = { id: "enrollment", state: "active", payload: { learner_user_id: "learner", course_record_id: "course", course_revision: 3, cohort_record_id: "cohort" } };
  const cohort = { id: "cohort", payload: { course_record_id: "course", course_revision: 3 } };
  const course = { payload: { attendance_min_percent: 75 } };
  const sessions = [
    { id: "session-one", state: "completed", payload: { cohort_record_id: "cohort", starts_at: "2030-01-01T10:00:00Z", ends_at: "2030-01-01T11:00:00Z" } },
    { id: "session-two", state: "completed", payload: { cohort_record_id: "cohort", starts_at: "2030-01-02T10:00:00Z", ends_at: "2030-01-02T11:00:00Z" } },
    { id: "future", state: "scheduled", payload: { cohort_record_id: "cohort", starts_at: "2030-01-04T10:00:00Z", ends_at: "2030-01-04T11:00:00Z" } },
  ];
  const attendance = [{ payload: { enrollment_record_id: "enrollment", session_record_id: "session-one", status: "late", minutes_attended: 30 } }];
  assert.deepEqual(attendanceRiskPercent(enrollment, cohort, course, sessions, attendance, Date.parse("2030-01-03T00:00:00Z")), {
    percent: 25, minimum_percent: 75, attended_minutes: 30, scheduled_minutes: 120,
  });
  assert.equal(attendanceRiskPercent({ ...enrollment, payload: { ...enrollment.payload, course_revision: 2 } }, cohort, course, sessions, attendance, Date.parse("2030-01-03T00:00:00Z")), null);
});

test("lembretes cobrem atividades com prazo e feriados/recessos dentro das preferências do aluno", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000811";
  const enrollmentId = "00000000-0000-4000-8000-000000000812";
  const assignmentId = "00000000-0000-4000-8000-000000000813";
  const eventId = "00000000-0000-4000-8000-000000000814";
  const dueAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const eventStart = new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString();
  const db = { async query(sql: string) {
    if (sql.includes("academic_reminders_enabled")) return [{ workspace_id: workspaceId, enabled: true,
      session_minutes: "1440", deadline_hours: "24", document_days: "7" }];
    if (sql.includes("a.payload->>'assessment_type' AS assessment_type")) return [{ workspace_id: workspaceId, enrollment_id: enrollmentId,
      item_id: assignmentId, title: "Trabalho final", assessment_type: "assignment", due_at: dueAt }];
    if (sql.includes("kind='academic_calendar_event'")) return [{ workspace_id: workspaceId, enrollment_id: enrollmentId,
      item_id: eventId, title: "Recesso acadêmico", event_type: "recess", due_at: eventStart }];
    if (sql.includes("kind='enrollment'")) return [];
    if (sql.includes("kind='session'")) return [];
    return [];
  } };
  const published: Array<{ kind: string; title: string; targetUrl: string | null }> = [];
  const notifications = { async publish(_plugin: string, _user: string, input: { kind: string; title: string; targetUrl?: string | null }) {
    published.push({ kind: input.kind, title: input.title, targetUrl: input.targetUrl || null });
  } };
  const service = new ExtensionRecords(db as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner(), notifications as never);
  await service.reminders("learner");
  assert.deepEqual(published, [
    { kind: "academic_reminder", title: "Atividade com prazo próximo", targetUrl: `/suinda/learning/${enrollmentId}/assessments?assessment=${assignmentId}` },
    { kind: "academic_reminder", title: "Recesso acadêmico próximo", targetUrl: `/calendar?suinda_event=${eventId}` },
  ]);
});

test("lembretes incluem todas as sessões, atividades, eventos, documentos e matrículas com pesquisa", async () => {
  const workspaceId = randomUUID();
  const enrollmentId = randomUUID();
  const dueAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const documentDueAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sessions = Array.from({ length: 201 }, (_, index) => ({ workspace_id: workspaceId, enrollment_id: enrollmentId,
    item_id: randomUUID(), title: `Encontro ${index + 1}`, due_at: dueAt, modality: "in_person", has_meeting_link: false }));
  const assessments = Array.from({ length: 201 }, (_, index) => ({ workspace_id: workspaceId, enrollment_id: enrollmentId,
    item_id: randomUUID(), title: `Atividade ${index + 1}`, assessment_type: "assignment", due_at: dueAt }));
  const events = Array.from({ length: 201 }, (_, index) => ({ workspace_id: workspaceId, enrollment_id: enrollmentId,
    item_id: randomUUID(), title: `Evento ${index + 1}`, event_type: "holiday", due_at: dueAt }));
  const documents = Array.from({ length: 201 }, (_, index) => ({ workspace_id: workspaceId, enrollment_id: enrollmentId,
    item_id: randomUUID(), title: `Documento ${index + 1}`, due_at: documentDueAt }));
  const surveyEnrollments = Array.from({ length: 101 }, () => ({ id: randomUUID(), workspace_id: workspaceId }));
  const queries: string[] = [];
  const db = { async query(sql: string) {
    queries.push(sql);
    if (sql.includes("academic_reminders_enabled")) return [{ workspace_id: workspaceId, enabled: true,
      session_minutes: "1440", deadline_hours: "24", document_days: "7" }];
    if (sql.includes("s.payload->>'modality' AS modality")) return sessions;
    if (sql.includes("a.payload->>'assessment_type' AS assessment_type")) return assessments;
    if (sql.includes("kind='academic_calendar_event'")) return events;
    if (sql.includes("d.kind='learner_document'")) return documents;
    if (sql.includes("JOIN extension_records survey")) return surveyEnrollments;
    if (sql.includes("suinda_survey_reminder_policies")) return [];
    return [];
  } };
  const published: Array<{ title: string; targetUrl: string | null }> = [];
  const notifications = { async publish(_plugin: string, _user: string, input: { title: string; targetUrl?: string | null }) {
    published.push({ title: input.title, targetUrl: input.targetUrl || null });
  } };
  const service = new ExtensionRecords(db as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner(), notifications as never);
  let surveyEnrollmentCalls = 0;
  Object.assign(service, { async learnerSurveys() { surveyEnrollmentCalls++; return { surveys: [] }; } });

  await service.reminders("learner");

  assert.equal(published.length, 804);
  assert.equal(published.filter((item) => item.title === "Encontro acadêmico próximo").length, 201);
  assert.equal(published.filter((item) => item.title === "Atividade com prazo próximo").length, 201);
  assert.equal(published.filter((item) => item.title === "Feriado acadêmico próximo").length, 201);
  assert.equal(published.filter((item) => item.title === "Documento acadêmico perto do vencimento").length, 201);
  assert.equal(surveyEnrollmentCalls, 101);
  for (const sql of queries) assert.doesNotMatch(sql, /LIMIT\s+(?:100|200)\b/i);
});

test("alerta de frequência dos lembretes inclui matrículas autorizadas após a quinhentésima", async () => {
  const workspaceId = randomUUID();
  const makeId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const enrollmentData = Array.from({ length: 501 }, (_, index) => ({
    enrollment: { id: makeId(1000 + index), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
      title: `Matrícula ${index}`, state: "active", revision: 1,
      payload: { learner_user_id: "learner", cohort_record_id: makeId(2000 + index), course_record_id: makeId(3000 + index),
        course_revision: 1, payment_status: "paid" } },
    cohort: { id: makeId(2000 + index), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: `Turma ${index}`,
      state: "published", revision: 1, payload: { course_record_id: makeId(3000 + index), course_revision: 1 } },
    course: { id: makeId(3000 + index), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: `Curso ${index}`,
      state: "published", revision: 1, payload: {} },
    session: { id: makeId(4000 + index), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "session", title: "Aula",
      state: "completed", revision: 1, payload: { cohort_record_id: makeId(2000 + index), starts_at: new Date(Date.now() - 120_000).toISOString(),
        ends_at: new Date(Date.now() - 60_000).toISOString() } },
    attendance: index < 500 ? { id: makeId(5000 + index), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "attendance",
      title: "Presença", state: "recorded", revision: 1,
      payload: { enrollment_record_id: makeId(1000 + index), session_record_id: makeId(4000 + index), minutes_attended: 1 } } : null,
  }));
  const queries: string[] = [];
  const db = { async query(sql: string) {
    queries.push(sql);
    if (sql.includes("academic_reminders_enabled")) return [];
    if (sql.includes("kind='enrollment'") && sql.includes("NULLIF(payload->>'cohort_record_id'")) return enrollmentData.map((entry) => entry.enrollment);
    if (sql.includes("kind='cohort' AND id=ANY")) return enrollmentData.map((entry) => entry.cohort);
    if (sql.includes("kind='course' AND id=ANY")) return enrollmentData.map((entry) => entry.course);
    if (sql.includes("FROM extension_record_versions")) return enrollmentData.map((entry) => ({
      record_id: entry.course.id, revision: 1, payload: { attendance_min_percent: 100 },
    }));
    if (sql.includes("kind='session'") && sql.includes("cohort_record_id'=ANY")) return enrollmentData.map((entry) => entry.session);
    if (sql.includes("kind='attendance'") && sql.includes("enrollment_record_id'=ANY")) return enrollmentData.flatMap((entry) => entry.attendance ? [entry.attendance] : []);
    return [];
  } };
  const published: Array<{ kind: string; targetUrl: string | null }> = [];
  const notifications = { async publish(_plugin: string, _user: string, input: { kind: string; targetUrl?: string | null }) {
    published.push({ kind: input.kind, targetUrl: input.targetUrl || null });
  } };
  const service = new ExtensionRecords(db as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner(), notifications as never);

  await service.reminders("learner");

  assert.deepEqual(published, [{ kind: "attendance_risk", targetUrl: `/suinda/learning/${makeId(1500)}/attendance?reminder=attendance-risk&session=${makeId(4500)}` }]);
  const enrollmentQuery = queries.find((sql) => sql.includes("NULLIF(payload->>'cohort_record_id'")) || "";
  assert.doesNotMatch(enrollmentQuery, /LIMIT\s+500\b/i);
});

test("cálculo de risco dos lembretes não corta encontros ou presenças após três mil", async () => {
  const workspaceId = randomUUID();
  const enrollmentId = randomUUID();
  const cohortId = randomUUID();
  const courseId = randomUUID();
  const makeId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const enrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment", title: "Matrícula",
    state: "active", revision: 1, payload: { learner_user_id: "learner", cohort_record_id: cohortId, course_record_id: courseId, course_revision: 1, payment_status: "paid" } };
  const cohort = { id: cohortId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", title: "Turma", state: "published", revision: 1,
    payload: { course_record_id: courseId, course_revision: 1 } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "published", revision: 1, payload: {} };
  async function evaluate(attendanceSessionIndexes: number[], longSessionIndex: number, expectedRisks: number) {
    const now = Date.now();
    const sessions = Array.from({ length: 3001 }, (_, index) => {
      const duration = index === longSessionIndex ? 60 * 60 * 1000 : 60_000;
      return { id: makeId(10000 + index), workspace_id: workspaceId,
        plugin_id: "suinda-learning", kind: "session", title: `Encontro ${index}`, state: "completed", revision: 1,
        payload: { cohort_record_id: cohortId, starts_at: new Date(now - duration - 60_000).toISOString(),
          ends_at: new Date(now - 60_000).toISOString() } };
    });
    const attendance = attendanceSessionIndexes.map((sessionIndex, index) => ({
      id: makeId(20000 + index), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "attendance", title: "Presença",
      state: "recorded", revision: 1, payload: { enrollment_record_id: enrollmentId, session_record_id: sessions[sessionIndex]!.id,
        minutes_attended: (Date.parse(String(sessions[sessionIndex]!.payload.ends_at)) - Date.parse(String(sessions[sessionIndex]!.payload.starts_at))) / 60_000 },
    }));
    const queries: string[] = [];
    const db = { async query(sql: string) {
      queries.push(sql);
      if (sql.includes("academic_reminders_enabled")) return [];
      if (sql.includes("kind='enrollment'") && sql.includes("NULLIF(payload->>'cohort_record_id'")) return [enrollment];
      if (sql.includes("kind='cohort' AND id=ANY")) return [cohort];
      if (sql.includes("kind='course' AND id=ANY")) return [course];
      if (sql.includes("FROM extension_record_versions")) return [{ record_id: courseId, revision: 1, payload: { attendance_min_percent: 100 } }];
      if (sql.includes("kind='session'") && sql.includes("cohort_record_id'=ANY"))
        return /LIMIT\s+3000/i.test(sql) ? sessions.slice(0, 3000) : sessions;
      if (sql.includes("kind='attendance'") && sql.includes("enrollment_record_id'=ANY"))
        return /LIMIT\s+3000/i.test(sql) ? attendance.slice(0, 3000) : attendance;
      return [];
    } };
    const published: Array<{ kind: string }> = [];
    const notifications = { async publish(_plugin: string, _user: string, input: { kind: string }) { published.push({ kind: input.kind }); } };
    const service = new ExtensionRecords(db as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner(), notifications as never);
    await service.reminders("learner");
    assert.equal(published.filter((item) => item.kind === "attendance_risk").length, expectedRisks);
    assert.doesNotMatch(queries.find((sql) => sql.includes("kind='session'") && sql.includes("cohort_record_id'=ANY")) || "", /LIMIT\s+3000/i);
    assert.doesNotMatch(queries.find((sql) => sql.includes("kind='attendance'") && sql.includes("enrollment_record_id'=ANY")) || "", /LIMIT\s+3000/i);
  }

  await evaluate(Array.from({ length: 3000 }, (_, index) => index), 3000, 1);
  await evaluate([...Array.from({ length: 3000 }, (_, index) => index + 1), 0], 0, 0);
});

test("relatórios agregam novos indicadores no intervalo e turma sem expor alunos", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000801";
  const courseId = "00000000-0000-4000-8000-000000000802";
  const unitId = "00000000-0000-4000-8000-000000000803";
  const course = { workspace_id: workspaceId, workspace_name: "Instituição", course_id: courseId, title: "Curso", state: "published",
    applications_started: 4, applications_submitted: 3, converted_enrollments: 2, distinct_learners: 2, active_learners: 1, completed: 1, withdrawn: 1, rejected: 0 };
  const reportQueries: Array<{ sql: string; args: unknown[] }> = [];
  const reportOneQueries: string[] = [];
  const db = { async one(sql: string) {
    reportOneQueries.push(sql);
    if (sql.includes("SELECT workspace_id FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning'")) return { workspace_id: workspaceId };
    if (sql.includes("COUNT(DISTINCT e.payload->>'learner_user_id')::int AS total")) return { total: 3 };
    return null;
  }, async query(sql: string, args: unknown[] = []) {
    reportQueries.push({ sql, args });
    if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceId }];
    if (sql.includes("SELECT DISTINCT r.workspace_id,r.id,role.permissions FROM extension_records r")) return [{ workspace_id: workspaceId, id: unitId, permissions: ["plugin.suinda-learning.manage"] }];
    if (sql.includes("u.id AS unit_record_id")) return [{ workspace_id: workspaceId, workspace_name: "Instituição", unit_record_id: unitId, unit_name: "Campus Recife", unit_code: "REC", courses: "2", enrollments: "4", distinct_learners: "3", active_learners: "2", completed: "1", withdrawn: "1" }];
    if (sql.includes("WITH report_scope_enrollments AS")) return [{ courses: 2, applications_started: 4, applications_submitted: 3,
      converted_enrollments: 2, distinct_learners: 3, active_learners: 2, completed: 1, withdrawn: 1, rejected: 0,
      eligible_completions: 2, failed_completions: 1, average_grade: "87.50", graded_items: 2, certificates_issued: 1,
      attended_minutes: "90", scheduled_minutes: "120", sessions_held: 1, taught_hours: "1.50", taught_sessions: 1,
      validated_practice_hours: "2.25" }];
    if (sql.includes("WITH scoped_enrollments AS")) return [{ workspace_id: workspaceId, workspace_name: "Instituição", unit_record_id: unitId,
      unit_name: "Campus Recife", currency: "BRL", collected_in_period: 125, payment_count: 1, scholarship_credit_in_period: 0,
      outstanding_balance: 20, pending_enrollments: 0, overdue_enrollments: 1, overdue_balance: 20 }];
    if (sql.includes("COUNT(e.id)::int AS applications_started")) return [course];
    if (sql.includes("COUNT(DISTINCT e.payload->>'learner_user_id')::int AS total")) return [{ total: 3 }];
    if (sql.includes("eligible_completions")) return [{ course_id: courseId, eligible_completions: 2, failed_completions: 1 }];
    if (sql.includes("AS taught_hours") && sql.includes("COUNT(DISTINCT s.id)::int AS taught_sessions")) return [{ course_id: courseId, taught_hours: "1.5", taught_sessions: 1 }];
    if (sql.includes("AS validated_practice_hours")) return [{ course_id: courseId, validated_practice_hours: "2.25" }];
    if (sql.includes("e.plugin_id='suinda-teacher-evaluation'")) return [{ workspace_id: workspaceId, workspace_name: "Instituição",
      course_id: courseId, course_title: "Curso", teacher_user_id: "00000000-0000-4000-8000-000000000804", teacher_name: "Docente",
      validated_evaluations: 2, response_count: 12, weighted_score: 4.25 }];
    if (sql.includes("generate_series(date_trunc('month'")) return [{ month: "2026-01", applications_started: "4", applications_submitted: "3", completed: "1", withdrawn: "1" }];
    if (sql.includes("AS admitted") && sql.includes("AS withdrawn")) return [{ workspace_id: workspaceId, course_id: courseId, cohort_record_id: cohortId, cohort_code: "TURMA-01", admitted: "4", withdrawn: "1" }];
    if (sql.includes("AS occupied") && sql.includes("AS capacity")) return [{ workspace_id: workspaceId, course_id: courseId, cohort_record_id: cohortId, cohort_code: "TURMA-01", state: "active", capacity: 10, occupied: 4 }];
    if (sql.includes("scholarship_credit_in_period")) return [{ workspace_id: workspaceId, course_id: courseId, cohort_record_id: cohortId, unit_record_id: unitId, cohort_code: "TURMA-01", currency: "BRL", collected_in_period: 125, payment_count: 1, scholarship_credit_in_period: 0 }];
    if (sql.includes("AS principal") && sql.includes("AS covered_amount")) return [{ workspace_id: workspaceId, course_id: courseId,
      cohort_record_id: cohortId, currency: "BRL", principal: 120, covered_amount: 100,
      submitted_at: "2020-01-01T00:00:00.000Z", created_at: "2020-01-01T00:00:00.000Z",
      installment_count: 1, first_due_days: 0, interval_days: 30 }];
    if (sql.includes("AS balance") && sql.includes("pending_count")) return [{ workspace_id: workspaceId, course_id: courseId,
      currency: "BRL", balance: 20, pending_count: 1, overdue_count: 0 }];
    if (sql.includes("AS outstanding_balance") && sql.includes("AS cohort_record_id")) return [{ workspace_id: workspaceId, course_id: courseId, cohort_record_id: cohortId, cohort_code: "TURMA-01", currency: "BRL", outstanding_balance: 20, pending_enrollments: 1, overdue_enrollments: 0 }];
    return [];
  } };
  const audited: string[] = [];
  const service = new ExtensionRecords(db as never, {
    async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; },
    async audit(_user: string, _action: string, target: string) { audited.push(target); },
  } as never, learningRegistry(), new DocumentScanner());
  const report = await service.academicReports("manager", "2026-01-01", "2026-01-31");
  assert.equal(report.unit_scope, false);
  assert.deepEqual(report.unit_summary, [{ workspace_id: workspaceId, workspace_name: "Instituição", unit_record_id: unitId, unit_name: "Campus Recife", unit_code: "REC", courses: 2, enrollments: 4, distinct_learners: 3, active_learners: 2, completed: 1, withdrawn: 1 }]);
  const unitQuery = reportQueries.find(({ sql }) => sql.includes("u.id AS unit_record_id"));
  assert.ok(unitQuery);
  assert.match(unitQuery.sql, /w\.id=ANY\(\$1::uuid\[\]\)/);
  assert.deepEqual(unitQuery.args, [[workspaceId], "2026-01-01", "2026-01-31", null, [workspaceId]]);
  assert.deepEqual(report.monthly_trend, [{ month: "2026-01", applications_started: 4, applications_submitted: 3, completed: 1, withdrawn: 1 }]);
  assert.deepEqual(report.cohort_attrition, [{ workspace_id: workspaceId, workspace_name: "Instituição", course_id: courseId,
    course_title: "Curso", cohort_record_id: cohortId, cohort_code: "TURMA-01", admitted: 4, withdrawn: 1, attrition_percent: 25 }]);
  assert.equal(report.totals.distinct_learners, 3, "o total distinto não soma alunos repetidos entre cursos");
  assert.equal(report.courses[0].converted_enrollments, 2);
  assert.equal(report.courses[0].enrollment_conversion_percent, 50);
  assert.equal(report.totals.enrollment_conversion_percent, 50);
  const conversionSql = reportQueries.find(({ sql }) => sql.includes("AS converted_enrollments"))?.sql || "";
  assert.match(conversionSql, /admitted_version\.state=ANY\(ARRAY\['enrolled','active','paused','completed','failed'\]\)/);
  assert.doesNotMatch(conversionSql, /state=ANY\(ARRAY\['approved','enrolled','active','paused','completed','failed','withdrawn'\]\)\)::int AS converted_enrollments/);
  assert.deepEqual(report.cohort_occupancy, [{ workspace_id: workspaceId, workspace_name: "Instituição", course_id: courseId,
    course_title: "Curso", cohort_record_id: cohortId, cohort_code: "TURMA-01", state: "active", capacity: 10, occupied: 4, available: 6, occupancy_percent: 40 }]);
  assert.equal(report.totals.eligible_completions, 2);
  assert.equal(report.totals.failed_completions, 1);
  assert.equal(report.totals.failure_rate_percent, 50);
  assert.equal(report.totals.taught_hours, 1.5);
  assert.equal(report.totals.taught_sessions, 1);
  assert.equal(report.totals.validated_practice_hours, 2.25);
  assert.deepEqual(report.teacher_evaluations, [{ workspace_id: workspaceId, workspace_name: "Instituição", course_id: courseId,
    course_title: "Curso", teacher_user_id: "00000000-0000-4000-8000-000000000804", teacher_name: "Docente",
    validated_evaluations: 2, response_count: 12, weighted_score: 4.25 }]);
  const teacherEvaluationQuery = reportQueries.find(({ sql }) => sql.includes("e.plugin_id='suinda-teacher-evaluation'"));
  assert.ok(teacherEvaluationQuery);
  assert.match(teacherEvaluationQuery.sql, /e\.state='validated'/);
  assert.match(teacherEvaluationQuery.sql, /validated_at/);
  assert.match(teacherEvaluationQuery.sql, /aggregate_response_count/);
  assert.deepEqual(teacherEvaluationQuery.args, [[workspaceId], "2026-01-01", "2026-01-31", [courseId]]);
  assert.deepEqual(report.most_sought_courses.map((row) => row.course_id), [courseId]);
  assert.deepEqual(report.financial_by_cohort, [{ workspace_id: workspaceId, workspace_name: "Instituição", course_id: courseId,
    course_title: "Curso", cohort_record_id: cohortId, unit_record_id: unitId, cohort_code: "TURMA-01", currency: "BRL", collected_in_period: 125,
    payment_count: 1, scholarship_credit_in_period: 0, outstanding_balance: 20, pending_enrollments: 0,
    overdue_enrollments: 1, overdue_balance: 20 }]);
  assert.deepEqual(report.unit_financial, [{ workspace_id: workspaceId, workspace_name: "Instituição", unit_record_id: unitId, unit_name: "Campus Recife", currency: "BRL", collected_in_period: 125, payment_count: 1, scholarship_credit_in_period: 0, outstanding_balance: 20, pending_enrollments: 0, overdue_enrollments: 1, overdue_balance: 20 }]);
  assert.equal(report.financial.by_course[0].pending_enrollments, 0);
  assert.equal(report.financial.by_course[0].overdue_enrollments, 1);
  assert.equal(report.financial.by_course[0].overdue_balance, 20);
  assert.deepEqual(audited, [workspaceId]);
  assert.equal(JSON.stringify(report).includes("learner_user_id"), false);
  assert.equal(JSON.stringify(report).includes("learner-1"), false);
  const metricQueries = reportQueries.filter(({ sql }) => sql.includes("eligible_completions")
    || sql.includes("AS taught_hours") || sql.includes("AS validated_practice_hours")
    || sql.includes("COUNT(DISTINCT e.payload->>'learner_user_id')::int AS total")
    || sql.includes("AS collected_in_period") && sql.includes("AS cohort_record_id")
    || sql.includes("AS outstanding_balance") && sql.includes("AS cohort_record_id"));
  assert.ok(metricQueries.length >= 6);
  for (const { sql, args } of metricQueries) {
    assert.match(sql, /workspace_id=ANY\(\$1::uuid\[\]\)/);
    assert.deepEqual(args[0], [workspaceId]);
    assert.equal(args[1], "2026-01-01");
    assert.equal(args[2], "2026-01-31");
  }
  const beforeUnitQueries = reportQueries.length;
  const unitReport = await service.academicReports("manager", "2026-01-01", "2026-01-31", unitId);
  assert.deepEqual(unitReport.teacher_evaluations, [], "o relatório de unidade não revela avaliações nominais de docentes");
  assert.equal(unitReport.unit_scope, true);
  assert.deepEqual(unitReport.courses, [], "relatório de unidade não inclui detalhamento não filtrado por curso");
  assert.deepEqual(unitReport.financial_by_cohort, [], "relatório de unidade não inclui saldos detalhados fora do agrupamento seguro");
  assert.equal(unitReport.unit_summary.length, 1);
  assert.equal(unitReport.unit_summary[0].unit_record_id, unitId);
  const unitQueries = reportQueries.slice(beforeUnitQueries);
  const unitFinancialQueries = unitQueries.filter(({ sql }) => sql.includes("WITH scoped_enrollments AS"));
  assert.equal(unitFinancialQueries.length, 1);
  assert.match(unitFinancialQueries[0].sql, /COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id',''\),NULLIF\(ch\.payload->>'institution_unit_record_id',''\),/);
  assert.match(unitFinancialQueries[0].sql, /=ANY\(\$4::text\[\]\)/);
  assert.equal(unitFinancialQueries[0].args[3] instanceof Array, true);
  const unitAcademicQuery = unitQueries.find(({ sql }) => sql.includes("WITH report_scope_enrollments AS"));
  assert.ok(unitAcademicQuery);
  assert.match(unitAcademicQuery.sql, /e\.workspace_id=ANY\(\$5::uuid\[\]\) OR COALESCE\(NULLIF\(e\.payload->>'institution_unit_record_id'/);
  assert.match(unitAcademicQuery.sql, /s\.workspace_id=ANY\(\$5::uuid\[\]\) OR COALESCE\(NULLIF\(s\.payload->>'institution_unit_record_id'/);
  assert.match(unitAcademicQuery.sql, /co\.kind='cohort' AND co\.payload->>'course_record_id'=c\.id::text/);
  assert.match(unitAcademicQuery.sql, /JOIN report_scope_enrollments e ON e\.id::text=t\.payload->>'enrollment_record_id'/);
  assert.match(unitAcademicQuery.sql, /NULLIF\(assessment_co\.payload->>'institution_unit_record_id',''\)/);
  assert.match(unitAcademicQuery.sql, /p\.workspace_id=ANY\(\$5::uuid\[\]\) OR COALESCE\(NULLIF\(p\.payload->>'institution_unit_record_id',''\),e\.unit_record_id\)=ANY\(\$4::text\[\]\)/);
  assert.match(unitAcademicQuery.sql, /JOIN report_scope_enrollments e\s+ON e\.id::text=cert\.payload->>'enrollment_record_id'/);
  assert.deepEqual(unitAcademicQuery.args, [[workspaceId], "2026-01-01", "2026-01-31", [unitId], []]);
  assert.equal(unitQueries.some(({ sql }) => sql.includes("COUNT(e.id)::int AS applications_started")), false,
    "relatório unitário não executa as agregações amplas do workspace");
  assert.deepEqual(unitReport.unit_financial[0], { workspace_id: workspaceId, workspace_name: "Instituição", unit_record_id: unitId,
    unit_name: "Campus Recife", currency: "BRL", collected_in_period: 125, payment_count: 1, scholarship_credit_in_period: 0,
    outstanding_balance: 20, pending_enrollments: 0, overdue_enrollments: 1, overdue_balance: 20 });
  assert.equal(unitReport.totals.distinct_learners, 3);
  assert.equal(unitReport.totals.applications_started, 4);
  assert.equal(unitReport.totals.enrollment_conversion_percent, 50);
  assert.equal(unitReport.totals.average_grade, 87.5);
  assert.equal(unitReport.totals.attendance_percent, 75);
  assert.equal(unitReport.totals.certificates_issued, 1);
  assert.equal(unitReport.totals.taught_hours, 1.5);
  assert.equal(unitReport.totals.validated_practice_hours, 2.25);
  assert.deepEqual(audited, [workspaceId, unitId]);
  const scopedAudited: string[] = [];
  const scopedService = new ExtensionRecords(db as never, {
    async has() { return false; },
    async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeType === "extension_record" && scopeId === unitId;
    },
    async audit(_user: string, _action: string, target: string) { scopedAudited.push(target); },
  } as never, learningRegistry(), new DocumentScanner());
  const scopedReport = await scopedService.academicReports("unit-manager", "2026-01-01", "2026-01-31");
  assert.equal(scopedReport.unit_scope, true);
  assert.deepEqual(scopedReport.courses, []);
  assert.deepEqual(scopedReport.financial_by_cohort, []);
  assert.deepEqual(scopedReport.unit_summary.map((row) => row.unit_record_id), [unitId]);
  assert.deepEqual(scopedAudited, [unitId]);
  const readerDb = { ...db, async query(sql: string, args: unknown[] = []) {
    const rows = await db.query(sql, args);
    return sql.includes("SELECT DISTINCT r.workspace_id,r.id,role.permissions FROM extension_records r")
      ? [{ workspace_id: workspaceId, id: unitId, permissions: ["plugin.suinda-learning.manage", "plugin.suinda-learning.read"] }] : rows;
  } };
  const readerService = new ExtensionRecords(readerDb as never, {
    async has() { return false; },
    async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
      return permission === "plugin.suinda-learning.read" && scopeType === "extension_record" && scopeId === unitId;
    },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  const readerReport = await readerService.academicReports("unit-reader", "2026-01-01", "2026-01-31");
  assert.equal(readerReport.unit_scope, true);
  assert.deepEqual(readerReport.courses, []);
  assert.deepEqual(readerReport.unit_summary.map((row) => row.unit_record_id), [unitId]);
  const scopedUnitQuery = [...reportQueries].reverse().find(({ sql, args }) => sql.includes("u.id AS unit_record_id") && args[3] !== null);
  assert.deepEqual(scopedUnitQuery?.args[3], [unitId]);
  const deniedService = new ExtensionRecords(db as never, {
    async has() { return false; }, async hasScoped() { return false; }, async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  await assert.rejects(deniedService.academicReports("intruder", "2026-01-01", "2026-01-31", unitId), /permissão de gestão/);
});

test("relatórios não truncam workspaces, unidades, cursos nem tabelas agrupadas após os tetos antigos", async () => {
  const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const workspaces = Array.from({ length: 1001 }, (_, index) => ({ id: uuid(index + 1) }));
  const unitSummary = Array.from({ length: 5001 }, (_, index) => ({
    workspace_id: workspaces[index % workspaces.length]!.id, workspace_name: `Instituição ${index % workspaces.length}`,
    unit_record_id: uuid(10000 + index), unit_name: `Unidade ${index}`, unit_code: `U${index}`,
    courses: 1, enrollments: 2, distinct_learners: 2, active_learners: 1, completed: 0, withdrawn: 0,
  }));
  const courses = Array.from({ length: 1001 }, (_, index) => ({
    workspace_id: workspaces[index % workspaces.length]!.id, workspace_name: `Instituição ${index % workspaces.length}`,
    course_id: uuid(20000 + index), title: `Curso ${index}`, state: "published", applications_started: 1,
    applications_submitted: 1, converted_enrollments: 1, active_learners: 1, distinct_learners: 1,
    completed: 0, withdrawn: 0, rejected: 0,
  }));
  const teachingWorkload = Array.from({ length: 2001 }, (_, index) => ({
    workspace_id: courses[index % courses.length]!.workspace_id, workspace_name: courses[index % courses.length]!.workspace_name,
    course_id: courses[index % courses.length]!.course_id, course_title: courses[index % courses.length]!.title,
    teacher_user_id: uuid(30000 + index), teacher_name: `Docente ${index}`, sessions_taught: 1,
    scheduled_hours: "1", taught_hours: "1", graded_items: 1,
  }));
  const attrition = Array.from({ length: 2001 }, (_, index) => ({
    workspace_id: courses[index % courses.length]!.workspace_id, course_id: courses[index % courses.length]!.course_id,
    cohort_record_id: uuid(40000 + index), cohort_code: `T${index}`, admitted: 2, withdrawn: 1,
  }));
  const occupancy = Array.from({ length: 2001 }, (_, index) => ({
    workspace_id: courses[index % courses.length]!.workspace_id, course_id: courses[index % courses.length]!.course_id,
    cohort_record_id: uuid(50000 + index), cohort_code: `T${index}`, state: "active", capacity: 10, occupied: 1,
  }));
  const referralOrigins = Array.from({ length: 1001 }, (_, index) => ({
    workspace_id: courses[index % courses.length]!.workspace_id, workspace_name: courses[index % courses.length]!.workspace_name,
    course_id: courses[index % courses.length]!.course_id, course_title: courses[index % courses.length]!.title,
    institution_referral: `Indicação ${index}`, applications: 1,
  }));
  const reportQueries: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async one() { return null; },
    async query(sql: string, args: unknown[] = []) {
      reportQueries.push({ sql, args });
      if (sql.startsWith("SELECT id FROM workspaces WHERE archived_at IS NULL ORDER BY id")) return workspaces;
      if (sql.startsWith("SELECT w.id AS workspace_id,w.name AS workspace_name,u.id AS unit_record_id")) return unitSummary;
      if (sql.includes("GROUP BY c.workspace_id,w.name,c.id,c.title,c.state ORDER BY w.name,c.title,c.id")) return courses;
      if (sql.includes("WITH assigned_sessions AS (")) return teachingWorkload;
      if (sql.includes("AS admitted") && sql.includes("AS withdrawn")) return attrition;
      if (sql.includes("AS occupied") && sql.includes("AS capacity")) return occupancy;
      if (sql.includes("institution_referral") && sql.includes("AS applications")) return referralOrigins;
      if (sql.includes("COUNT(DISTINCT e.payload->>'learner_user_id')::int AS total")) return [{ total: 4000 }];
      return [];
    },
  };
  const service = new ExtensionRecords(db as never, {
    async has(_user: string, permission: string) { return permission === "plugin.suinda-learning.manage"; }, async audit() {},
  } as never, learningRegistry(), new DocumentScanner());

  const report = await service.academicReports("global-manager", "2026-01-01", "2026-01-31");

  assert.equal(report.workspace_count, 1001);
  assert.equal(report.unit_summary.length, 5001);
  assert.equal(report.courses.length, 1001);
  assert.equal(report.totals.courses, 1001);
  assert.equal(report.teaching_workload.length, 2001);
  assert.equal(report.cohort_attrition.length, 2001);
  assert.equal(report.cohort_occupancy.length, 2001);
  assert.equal(report.referral_origins.length, 1001);
  assert.equal(report.courses.at(-1)?.course_id, courses.at(-1)?.course_id);
  assert.equal(report.teaching_workload.at(-1)?.teacher_user_id, teachingWorkload.at(-1)?.teacher_user_id);
  for (const { sql } of reportQueries.filter(({ sql }) => sql.startsWith("SELECT id FROM workspaces")
    || sql.startsWith("SELECT w.id AS workspace_id,w.name AS workspace_name,u.id AS unit_record_id")
    || sql.includes("GROUP BY c.workspace_id,w.name,c.id,c.title,c.state ORDER BY w.name,c.title,c.id")
    || sql.includes("WITH assigned_sessions AS (") || sql.includes("AS admitted") && sql.includes("AS withdrawn")
    || sql.includes("AS occupied") && sql.includes("AS capacity")
    || sql.includes("institution_referral") && sql.includes("AS applications"))) assert.doesNotMatch(sql, /\bLIMIT\s+(?:1000|2000|5000)\b/i);
});

test("relatório unitário considera grants autorizados depois do antigo limite de 2.000", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000821";
  const unitIds = Array.from({ length: 2001 }, (_, index) => `00000000-0000-4000-8000-${String(index + 10000).padStart(12, "0")}`);
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async one() { return null; },
    async query(sql: string, args: unknown[] = []) {
      queries.push({ sql, args });
      if (sql.startsWith("SELECT id FROM workspaces")) return [{ id: workspaceId }];
      if (sql.includes("SELECT DISTINCT r.workspace_id,r.id,role.permissions FROM extension_records r"))
        return unitIds.map((id) => ({ workspace_id: workspaceId, id, permissions: ["plugin.suinda-learning.manage"] }));
      if (sql.startsWith("SELECT w.id AS workspace_id,w.name AS workspace_name,u.id AS unit_record_id")) return [{
        workspace_id: workspaceId, workspace_name: "Instituição", unit_record_id: unitIds.at(-1), unit_name: "Unidade 2000",
        unit_code: "U2000", courses: 1, enrollments: 1, distinct_learners: 1, active_learners: 1, completed: 0, withdrawn: 0,
      }];
      return [];
    },
  };
  const service = new ExtensionRecords(db as never, {
    async has() { return false; },
    async hasScoped(_user: string, _permission: string, _scope: string, unitId: string) { return unitId === unitIds.at(-1); },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());

  const report = await service.academicReports("unit-manager", "2026-01-01", "2026-01-31");

  assert.equal(report.unit_scope, true);
  assert.deepEqual(report.unit_summary.map((row) => row.unit_record_id), [unitIds.at(-1)]);
  const candidatesQuery = queries.find(({ sql }) => sql.includes("SELECT DISTINCT r.workspace_id,r.id,role.permissions FROM extension_records r"));
  assert.ok(candidatesQuery);
  assert.doesNotMatch(candidatesQuery.sql, /\bLIMIT\s+(?:1000|2000|5000)\b/i);
  const summaryQuery = queries.find(({ sql }) => sql.startsWith("SELECT w.id AS workspace_id,w.name AS workspace_name,u.id AS unit_record_id"));
  assert.deepEqual(summaryQuery?.args[3], [unitIds.at(-1)]);
});

test("relatório com permissões mistas agrega workspaces geridos e filtra os demais por unidade", async () => {
  const unitWorkspace = "00000000-0000-4000-8000-000000000811";
  const managedWorkspace = "00000000-0000-4000-8000-000000000812";
  const unitId = "00000000-0000-4000-8000-000000000813";
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async one(sql: string) { if (sql.includes("COUNT(DISTINCT e.payload->>'learner_user_id')::int AS total")) return { total: 0 }; return null; },
    async query(sql: string, args: unknown[] = []) {
      queries.push({ sql, args });
      if (sql.includes("SELECT id FROM workspaces")) return [{ id: unitWorkspace }, { id: managedWorkspace }];
      if (sql.includes("SELECT DISTINCT r.workspace_id,r.id,role.permissions FROM extension_records r"))
        return [{ workspace_id: unitWorkspace, id: unitId, permissions: ["plugin.suinda-learning.manage"] }];
      if (sql.includes("u.id AS unit_record_id")) return [
        { workspace_id: unitWorkspace, workspace_name: "Unidade", unit_record_id: unitId, unit_name: "Campus", courses: 1, enrollments: 1, distinct_learners: 1, active_learners: 1, completed: 0, withdrawn: 0 },
        { workspace_id: managedWorkspace, workspace_name: "Workspace", unit_record_id: null, unit_name: "Sem unidade", courses: 2, enrollments: 3, distinct_learners: 2, active_learners: 2, completed: 1, withdrawn: 0 },
      ];
      return [];
    },
  };
  const service = new ExtensionRecords(db as never, {
    async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) {
      return scopeType === "workspace" && scopeId === managedWorkspace;
    },
    async hasScoped(_user: string, _permission: string, scopeType: string, scopeId: string) {
      return scopeType === "extension_record" && scopeId === unitId;
    },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  const report = await service.academicReports("mixed-manager", "2026-01-01", "2026-01-31");
  assert.equal(report.unit_scope, true);
  assert.equal(report.unit_summary.length, 2);
  const summaryQuery = queries.find(({ sql }) => sql.includes("u.id AS unit_record_id"));
  assert.deepEqual(summaryQuery?.args[3], [unitId]);
  assert.deepEqual(summaryQuery?.args[4], [managedWorkspace]);
  const financialQuery = queries.find(({ sql }) => sql.includes("WITH scoped_enrollments AS"));
  assert.deepEqual(financialQuery?.args[3], [unitId]);
  assert.deepEqual(financialQuery?.args[4], [managedWorkspace]);
  assert.equal(queries.some(({ sql }) => sql.includes("COUNT(e.id)::int AS applications_started")), false);
  assert.deepEqual(report.courses, []);
});

test("duplicação e reordenação curricular por grant unitário exigem gestão de todas as unidades do curso", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000831";
  const courseId = "00000000-0000-4000-8000-000000000832";
  const unitA = "00000000-0000-4000-8000-000000000833";
  const unitB = "00000000-0000-4000-8000-000000000834";
  const db = {
    async one(sql: string) {
      if (sql.includes("SELECT c.* FROM extension_records c JOIN workspaces"))
        return { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", state: "published", revision: 1, payload: {} };
      return null;
    },
    async query(sql: string) {
      assert.match(sql, /WITH course_units AS/);
      return [{ unit_id: unitA }, { unit_id: unitB }];
    },
  };
  const access = {
    async has() { return false; },
    async hasScoped(_user: string, _permission: string, _type: string, scopeId: string) { return scopeId === unitA; },
    async audit() {},
  };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  await assert.rejects(service.duplicateCourse(courseId, "manager", {
    operation_key: "00000000-0000-4000-8000-000000000835", expected_revision: 1, new_code: "C-2", new_title: "Novo curso",
  }), /gestão de todas as unidades/);
  const canManageEveryCourseUnit = (service as unknown as { canManageEveryCourseUnit: (user: string, course: string, workspace: string) => Promise<boolean> }).canManageEveryCourseUnit;
  assert.equal(await canManageEveryCourseUnit.call(service, "manager", courseId, workspaceId), false);
  assert.equal(suindaPlugin.handlesRoute?.(`/extensions/suinda-learning/courses/${courseId}/duplicate`), true);
  assert.equal(suindaPlugin.routePermission?.(`/extensions/suinda-learning/courses/${courseId}/duplicate`, "POST"), null);
});

test("duplicação de curso revalida e bloqueia grants de unidade revogados dentro da transação", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000841";
  const courseId = "00000000-0000-4000-8000-000000000842";
  const unitA = "00000000-0000-4000-8000-000000000843";
  const unitB = "00000000-0000-4000-8000-000000000844";
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", state: "published", revision: 1, payload: {} };
  const db = {
    async one(sql: string) { return sql.includes("SELECT c.* FROM extension_records c JOIN workspaces") ? course : null; },
    async query(sql: string) {
      if (sql.includes("WITH course_units AS")) return [{ unit_id: unitA }, { unit_id: unitB }];
      return [];
    },
  };
  const events: string[] = [];
  const client = { async query(sql: string) {
    events.push(sql);
    if (sql.includes("FROM extension_records WHERE id=$1 FOR UPDATE")) return { rows: [course] };
    if (sql.includes("WITH course_units AS")) return { rows: [{ unit_id: unitA }, { unit_id: unitB }] };
    if (sql.includes("FROM access_grants g JOIN access_roles role")) return { rows: [{ unit_id: unitA }] };
    return { rows: [] };
  } };
  const service = new ExtensionRecords(db as never, {
    async has() { return false; },
    async hasScoped() { return true; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  (service as unknown as { mutation: (...args: unknown[]) => Promise<unknown> }).mutation = async (...args: unknown[]) => {
    const callback = args[5] as (transaction: never) => Promise<unknown>;
    return callback(client as never);
  };

  await assert.rejects(service.duplicateCourse(courseId, "manager", {
    operation_key: "00000000-0000-4000-8000-000000000845", expected_revision: 1, new_code: "C-2", new_title: "Novo curso",
  }), /gestão de uma ou mais unidades foi revogada/);
  const courseLock = events.findIndex((sql) => sql.includes("FROM extension_records WHERE id=$1 FOR UPDATE"));
  const scopeCheck = events.findIndex((sql) => sql.includes("WITH course_units AS"));
  const grantCheck = events.findIndex((sql) => sql.includes("FROM access_grants g JOIN access_roles role"));
  assert.ok(courseLock >= 0 && scopeCheck > courseLock && grantCheck > scopeCheck);
  assert.equal(events.some((sql) => sql.startsWith("INSERT INTO extension_records")), false);
});

test("reordenação curricular revalida grants de todas as unidades depois de bloquear os itens", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000851";
  const courseId = "00000000-0000-4000-8000-000000000852";
  const moduleId = "00000000-0000-4000-8000-000000000853";
  const unitA = "00000000-0000-4000-8000-000000000854";
  const unitB = "00000000-0000-4000-8000-000000000855";
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", state: "published", revision: 1, payload: {} };
  const module = { id: moduleId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "module", state: "draft", revision: 1,
    payload: { course_record_id: courseId, position: 2 } };
  const db = {
    async one(sql: string) { return sql.includes("FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning' AND kind=$2") ? course : null; },
    async query(sql: string) {
      if (sql.includes("WITH course_units AS")) return [{ unit_id: unitA }, { unit_id: unitB }];
      if (sql.includes("kind='cohort'")) return [];
      if (sql.includes("ORDER BY NULLIF(payload->>'position','')::numeric,id LIMIT $7")) return [module];
      return [];
    },
  };
  const events: string[] = [];
  const client = { async query(sql: string, args: unknown[] = []) {
    events.push(sql);
    if (sql.includes("FROM extension_records WHERE id=$1 FOR UPDATE"))
      return { rows: [args[0] === courseId ? course : module] };
    if (sql.includes("SELECT id FROM extension_records WHERE workspace_id=$1")) return { rows: [{ id: moduleId }] };
    if (sql.includes("WITH course_units AS")) return { rows: [{ unit_id: unitA }, { unit_id: unitB }] };
    if (sql.includes("FROM access_grants g JOIN access_roles role")) return { rows: [{ unit_id: unitA }] };
    return { rows: [] };
  } };
  const service = new ExtensionRecords(db as never, {
    async has() { return false; },
    async hasScoped() { return true; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());
  (service as unknown as { mutation: (...args: unknown[]) => Promise<unknown> }).mutation = async (...args: unknown[]) => {
    const callback = args[5] as (transaction: never) => Promise<unknown>;
    return callback(client as never);
  };

  await assert.rejects(service.reorderCurriculum("course", courseId, "manager", {
    operation_key: "00000000-0000-4000-8000-000000000856", items: [{ id: moduleId, expected_revision: 1 }],
  }), /gestão de uma ou mais unidades foi revogada/);
  const locks = events.flatMap((sql, index) => sql.includes("FROM extension_records WHERE id=$1 FOR UPDATE") ? [index] : []);
  const grantCheck = events.findIndex((sql) => sql.includes("FROM access_grants g JOIN access_roles role"));
  assert.equal(locks.length, 2);
  assert.ok(grantCheck > locks[1]);
  assert.equal(events.some((sql) => sql.startsWith("UPDATE extension_records")), false);
});

test("exportação do ledger separa workspace autorizado de grants unitários sem ampliar escopo", async () => {
  const workspaceA = "00000000-0000-4000-8000-000000000901";
  const workspaceB = "00000000-0000-4000-8000-000000000902";
  const unitB = "00000000-0000-4000-8000-000000000903";
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const audits: string[] = [];
  const db = {
    async one(sql: string) {
      if (sql.includes("SELECT workspace_id FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning'")) return { workspace_id: workspaceB };
      return null;
    },
    async query(sql: string, args: unknown[] = []) {
      queries.push({ sql, args });
      if (sql.includes("SELECT id FROM workspaces")) return [{ id: workspaceA }, { id: workspaceB }];
      if (sql.includes("SELECT DISTINCT r.workspace_id,r.id FROM extension_records r")) return [{ workspace_id: workspaceB, id: unitB }];
      return [];
    },
  };
  const service = new ExtensionRecords(db as never, {
    async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) {
      return scopeType === "workspace" && scopeId === workspaceA;
    },
    async hasScoped(_user: string, _permission: string, _scopeType: string, scopeId: string) { return scopeId === unitB; },
    async audit(_user: string, _action: string, target: string) { audits.push(target); },
  } as never, learningRegistry(), new DocumentScanner());

  const file = await service.financialLedgerCsv("manager", "2026-10-01", "2026-10-24");
  assert.equal(file.count, 0);
  assert.ok(file.csv.startsWith("\uFEFF"));
  const query = queries.find(({ sql }) => sql.includes("FROM extension_records p"));
  assert.ok(query);
  assert.deepEqual(query.args[0], [workspaceA, workspaceB]);
  assert.deepEqual(query.args[3], [workspaceA]);
  assert.deepEqual(query.args[4], [unitB]);
  assert.equal(query.args[5], null);
  assert.match(query.sql, /p\.workspace_id=ANY\(\$4::uuid\[\]\) OR COALESCE[\s\S]*=ANY\(\$5::text\[\]\)/);
  assert.doesNotMatch(query.sql, /learner_user_id|users u|notes/);
  assert.deepEqual(audits, ["2026-10-01:2026-10-24; workspaces=1; units=1; unit=all; rows=0"]);

  queries.length = 0;
  await service.financialLedgerCsv("manager", "2026-10-01", "2026-10-24", unitB);
  const unitQuery = queries.find(({ sql }) => sql.includes("FROM extension_records p"));
  assert.ok(unitQuery);
  assert.deepEqual(unitQuery.args[3], []);
  assert.deepEqual(unitQuery.args[4], [unitB]);
  assert.deepEqual(unitQuery.args[5], [unitB]);

  queries.length = 0;
  const workspaceRows = await service.financialLedgerRows("manager", "2026-10-01", "2026-10-24", undefined, workspaceB);
  assert.deepEqual(workspaceRows.rows, []);
  const workspaceQuery = queries.find(({ sql }) => sql.includes("FROM extension_records p"));
  assert.ok(workspaceQuery);
  assert.deepEqual(workspaceQuery.args[0], [workspaceB]);
  assert.deepEqual(workspaceQuery.args[3], []);
  assert.deepEqual(workspaceQuery.args[4], [unitB]);
  queries.length = 0;
  await assert.rejects(service.financialLedgerRows("manager", "2026-10-01", "2026-10-24", undefined,
    "00000000-0000-4000-8000-000000000899"), /fora do escopo financeiro/);
  assert.equal(queries.some(({ sql }) => sql.includes("FROM extension_records p")), false);
});

test("exportação financeira encontra grants válidos além dos limites antigos de workspaces e unidades", async () => {
  const workspaces = Array.from({ length: 1_001 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }));
  const lastWorkspace = workspaces.at(-1)!.id;
  const units = Array.from({ length: 2_001 }, (_, index) => ({
    workspace_id: lastWorkspace,
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }));
  const lastUnit = units.at(-1)!.id;
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async query(sql: string, args: unknown[] = []) {
      queries.push({ sql, args });
      if (sql.includes("SELECT id FROM workspaces")) return workspaces;
      if (sql.includes("SELECT DISTINCT r.workspace_id,r.id FROM extension_records r")) return units;
      return [];
    },
    async one() { return null; },
  };
  const service = new ExtensionRecords(db as never, {
    async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) {
      return scopeType === "workspace" && scopeId === lastWorkspace;
    },
    async hasScoped(_user: string, _permission: string, _scopeType: string, scopeId: string) { return scopeId === lastUnit; },
    async audit() {},
  } as never, learningRegistry(), new DocumentScanner());

  const result = await service.financialLedgerRows("manager", "2026-10-01", "2026-10-24");

  assert.equal(result.count, 0);
  const workspaceQuery = queries.find(({ sql }) => sql.includes("SELECT id FROM workspaces"))!;
  const unitQuery = queries.find(({ sql }) => sql.includes("SELECT DISTINCT r.workspace_id,r.id FROM extension_records r"))!;
  const ledgerQuery = queries.find(({ sql }) => sql.includes("FROM extension_records p"))!;
  assert.doesNotMatch(workspaceQuery.sql, /\bLIMIT\s+1000\b/i);
  assert.doesNotMatch(unitQuery.sql, /\bLIMIT\s+2000\b/i);
  assert.deepEqual(ledgerQuery.args[0], [lastWorkspace]);
  assert.deepEqual(ledgerQuery.args[4], [lastUnit]);
});

test("equipe da unidade limita funções ao escopo e revoga a sessão em transação", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000831";
  const unitId = "00000000-0000-4000-8000-000000000832";
  const userId = "00000000-0000-4000-8000-000000000833";
  const workspaceUsers = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
    name: `Pessoa ${String(index + 1).padStart(4, "0")}`, email: `unit${index + 1}@example.test`,
  }));
  const actions: string[] = [];
  const transactions: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async one(sql: string, args: unknown[] = []) {
      if (sql.includes("FROM extension_records r JOIN workspaces")) return { workspace_id: workspaceId };
      if (sql.includes("FROM users u JOIN workspace_members")) return { id: userId, is_root: false, disabled: false };
      if (sql.includes("FROM access_roles WHERE id=$1")) return { permissions: args[0] === "suinda_unit_reader"
        ? ["plugin.suinda-learning.read"] : ["plugin.suinda-learning.manage", "plugin.suinda-learning.read"] };
      return null;
    },
    async query(sql: string, args: unknown[] = []) {
      if (sql.includes("AS user_id")) return [{ user_id: userId, name: "Pessoa da unidade", email: "unit@example.test", role_id: "suinda_unit_manager", role_name: "Gestor" }];
      if (sql.includes("FROM workspace_members m JOIN users")) {
        assert.match(sql, /ORDER BY u\.name,u\.id LIMIT \$4/);
        const cursorName = args[1] as string | null;
        const cursorId = args[2] as string | null;
        return workspaceUsers.filter((candidate) => cursorName === null || candidate.name > cursorName
          || (candidate.name === cursorName && candidate.id > cursorId!)).slice(0, Number(args[3]));
      }
      if (sql.includes("FROM access_roles WHERE id=ANY")) return [
        { id: "suinda_unit_manager", name: "Gestor", permissions: ["plugin.suinda-learning.manage", "plugin.suinda-learning.read"] },
        { id: "suinda_unit_reader", name: "Leitor", permissions: ["plugin.suinda-learning.read"] },
      ];
      return [];
    },
    pool: { async connect() { return {
      async query(sql: string, args: unknown[] = []) {
        transactions.push({ sql, args });
        return { rows: sql.startsWith("DELETE FROM access_grants") ? [{ role_id: "suinda_unit_manager" }] : [] };
      }, release() {},
    }; } },
  };
  const access = {
    async has(_user: string, permission: string, scopeType: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeType === "workspace" && scopeId === workspaceId;
    },
    revoke(user: string) { actions.push(`revoke:${user}`); },
    async audit(_actor: string, action: string) { actions.push(`audit:${action}`); },
  };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  const team = await service.institutionUnitTeam("manager", workspaceId, unitId);
  assert.equal(team.users.length, 501);
  assert.equal(team.users.at(-1)?.id, workspaceUsers.at(-1)?.id);
  assert.equal(team.members.length, 1);
  assert.deepEqual(team.roles.map((role) => role.id), ["suinda_unit_manager", "suinda_unit_reader"]);
  await service.setInstitutionUnitMember("manager", workspaceId, unitId, { user_id: userId, role_id: "suinda_unit_reader" });
  await service.removeInstitutionUnitMember("manager", workspaceId, unitId, userId);
  const scopedInsert = transactions.find(({ sql }) => sql.startsWith("INSERT INTO access_grants"));
  assert.deepEqual(scopedInsert?.args, [userId, "suinda_unit_reader", unitId]);
  assert.equal(transactions.filter(({ sql }) => sql === "COMMIT").length, 2);
  assert.equal(transactions.filter(({ sql }) => sql === "ROLLBACK").length, 0);
  assert.deepEqual(actions, [
    "audit:suinda-learning.unit.team.read", "revoke:" + userId,
    "audit:suinda-learning.unit.team.updated", "revoke:" + userId,
    "audit:suinda-learning.unit.team.removed",
  ]);
});

test("a fila institucional de retenção pagina por cursor até o último registro", async () => {
  const workspaceId = randomUUID();
  const rows = Array.from({ length: 101 }, (_, index) => ({
    id: randomUUID(), kind: "learner_document", title: `Documento ${index + 1}`, state: "approved",
    created_at: "2020-01-01T00:00:00.000Z", due_at: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
    purpose_code: "academic_operations", data_categories: ["documento"], retention_description: "Prazo configurado", total_count: 101,
  }));
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db = { async query(sql: string, args: unknown[] = []) {
    queries.push({ sql, args });
    assert.match(sql, /evaluation_records AS/);
    assert.match(sql, /r\.kind=ANY\(ARRAY\['evaluation_policy','evaluation_cycle','evaluation_appeal'\]::text\[\]\)/);
    assert.match(sql, /MAX\(covered\.due_at\) AS due_at/);
    assert.match(sql, /HAVING MAX\(covered\.due_at\)<=now\(\)/);
    assert.match(sql, /array_agg\(DISTINCT categories\.category ORDER BY categories\.category\)/);
    assert.doesNotMatch(sql, /SELECT DISTINCT ON \(id\) id,kind,title,state,created_at,due_at/);
    assert.match(sql, /due_count AS \(SELECT COUNT\(\*\)::int AS total_count FROM due_records\)/);
    assert.match(sql, /due_records\.due_at,due_records\.id\)>/);
    return args[1] === null ? rows : [rows[100]!];
  } };
  const access = { async requireScoped() {}, async audit() {} };
  const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
  const first = await service.privacyRetentionCandidates(workspaceId, randomUUID());
  assert.equal(first.candidates.length, 100);
  assert.equal(first.total_count, 101);
  assert.equal(first.next_cursor, rows[99]!.id);
  assert.equal(queries[0]!.args[2], 101);
  const second = await service.privacyRetentionCandidates(workspaceId, randomUUID(), first.next_cursor!);
  assert.equal(second.candidates.length, 1);
  assert.equal(second.candidates[0]!.id, rows[100]!.id);
  assert.equal(second.total_count, 101);
  assert.equal(second.next_cursor, null);
  assert.equal(queries[1]!.args[1], rows[99]!.id);
});

test("a fila de retenção espera a finalidade de prazo mais longo e agrega metadados de todas as finalidades", async () => {
  const workspaceId = randomUUID();
  const recordId = randomUUID();
  const now = Date.now();
  const policyCoverage = [
    { purpose_code: "academic", due_at: new Date(now - 86_400_000).toISOString(), data_category: "documentos", retention_description: "Retenção acadêmica" },
    { purpose_code: "financial", due_at: new Date(now + 86_400_000).toISOString(), data_category: "documentos financeiros", retention_description: "Retenção financeira" },
  ];
  const queries: string[] = [];
  const db = { async query(sql: string) {
    queries.push(sql);
    assert.match(sql, /HAVING MAX\(covered\.due_at\)<=now\(\)/);
    assert.match(sql, /array_agg\(DISTINCT categories\.category ORDER BY categories\.category\)/);
    const latestDue = Math.max(...policyCoverage.map((policy) => Date.parse(policy.due_at)));
    if (latestDue > now) return [];
    return [{ id: recordId, kind: "learner_document", title: "Documento", state: "approved",
      created_at: new Date(now - 90 * 86_400_000).toISOString(), due_at: new Date(latestDue).toISOString(),
      purpose_code: policyCoverage.map((policy) => policy.purpose_code).sort().join(", "),
      data_categories: [...new Set(policyCoverage.map((policy) => policy.data_category))].sort(),
      retention_description: policyCoverage.map((policy) => policy.retention_description).sort().join(" · "), total_count: 1 }];
  } };
  const service = new ExtensionRecords(db as never, { async requireScoped() {}, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  const blockedCandidate = await service.privacyRetentionCandidates(workspaceId, randomUUID());
  assert.equal(blockedCandidate.total_count, 0, "the short academic period cannot make a record eligible while financial retention is active");

  policyCoverage[1]!.due_at = new Date(now - 2 * 86_400_000).toISOString();
  const dueCandidate = await service.privacyRetentionCandidates(workspaceId, randomUUID());
  assert.equal(dueCandidate.total_count, 1);
  assert.equal(dueCandidate.candidates[0]!.id, recordId);
  assert.equal(dueCandidate.candidates[0]!.purpose_code, "academic, financial");
  assert.deepEqual(dueCandidate.candidates[0]!.data_categories, ["documentos", "documentos financeiros"]);
  assert.equal(dueCandidate.candidates[0]!.retention_description, "Retenção acadêmica · Retenção financeira");
  assert.equal(queries.length, 2);
});

test("progresso de mídia não credita saltos e preserva o tempo assistido na pausa", async () => {
  const workspaceId = randomUUID();
  const enrollmentId = randomUUID();
  const lessonId = randomUUID();
  const learnerId = randomUUID();
  let stored: Record<string, unknown> | null = null;
  const client = { async query(sql: string, args: unknown[] = []) {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("kind='media_progress'")) return { rows: stored ? [stored] : [] };
    if (sql.startsWith("INSERT INTO extension_records")) {
      stored = { id: randomUUID(), workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "media_progress",
        title: String(args[1]), state: "saved", revision: 1, payload: JSON.parse(String(args[2])) as Record<string, unknown> };
      return { rows: [stored] };
    }
    return { rows: [] };
  } };
  const service = new ExtensionRecords({ async one() { return null; } } as never,
    { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    assertAvailable() {},
    async accessibleMediaLesson() {
      return { enrollment: { workspace_id: workspaceId }, lesson: { id: lessonId, title: "Vídeo", payload: { content_type: "video" } } };
    },
    async mutation(_plugin: string, _workspace: string, _actor: string, _key: unknown, _input: unknown,
      callback: (connection: never) => Promise<unknown>) { return callback(client as never); },
    async payload(_connection: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async snapshot(_connection: unknown, record: Record<string, unknown>) { stored = record; return record; },
    async save(_connection: unknown, current: Record<string, unknown>, _actor: string, _title: string,
      payload: Record<string, unknown>) {
      stored = { ...current, revision: Number(current.revision) + 1, payload };
      return stored;
    },
  });

  const progress = (position: number, playing: boolean) => service.saveMediaProgress(enrollmentId, lessonId, learnerId, {
    operation_key: randomUUID(), position_seconds: position, duration_seconds: 100, playing,
  });
  const initial = await progress(20, true);
  assert.deepEqual(initial, { position_seconds: 20, watched_seconds: 0, duration_seconds: 100, percent: 0 });

  stored!.payload = { ...(stored!.payload as Record<string, unknown>), heartbeat_at: new Date(Date.now() - 10_000).toISOString() };
  const advanced = await progress(25, true);
  assert.deepEqual(advanced, { position_seconds: 25, watched_seconds: 5, duration_seconds: 100, percent: 5 });

  stored!.payload = { ...(stored!.payload as Record<string, unknown>), heartbeat_at: new Date(Date.now() - 10_000).toISOString() };
  const seekedWhilePaused = await progress(90, false);
  assert.deepEqual(seekedWhilePaused, { position_seconds: 90, watched_seconds: 5, duration_seconds: 100, percent: 5 });
  await assert.rejects(progress(103, true), /posição ou duração da mídia está inválida/);
});

test("reembolso manual pode ser registrado para qualquer matrícula desistente, sem depender da origem CSV", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000821";
  const enrollmentId = "00000000-0000-4000-8000-000000000822";
  const learnerId = "00000000-0000-4000-8000-000000000823";
  const courseId = "00000000-0000-4000-8000-000000000824";
  const paymentId = "00000000-0000-4000-8000-000000000825";
  const enrollmentRecord = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula cancelada", state: "withdrawn", revision: 2,
    payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 1, payment_status: "paid" } };
  const paymentRecord = { id: paymentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "payment_entry",
    title: "PIX recebido", state: "recorded", revision: 1,
    payload: { enrollment_record_id: enrollmentId, learner_user_id: learnerId, course_record_id: courseId,
      course_revision: 1, amount: 100, currency: "BRL", payment_method: "pix" } };
  const refundPayloads: Array<Record<string, unknown>> = [];
  const insertedRefund = { id: "00000000-0000-4000-8000-000000000826", workspace_id: workspaceId,
    plugin_id: "suinda-learning", kind: "payment_entry", title: "Reembolso", state: "recorded", revision: 1, payload: {} };
  const client = { async query(sql: string, args: unknown[] = []) {
    if (sql.includes("kind='enrollment' FOR UPDATE")) return { rows: [enrollmentRecord] };
    if (sql.includes("kind='payment_entry' AND state='recorded' FOR UPDATE")) return { rows: [paymentRecord] };
    if (sql.includes("refund_of_payment_entry_id") && sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("SELECT r.id,r.plugin_id AS \"pluginId\"")) {
      const recordId = args[0];
      const record = recordId === enrollmentId ? enrollmentRecord : { ...paymentRecord, id: courseId, kind: "course", payload: { price_amount: 100, currency: "BRL" } };
      return { rows: [{ id: record.id, pluginId: record.plugin_id, kind: record.kind, state: record.state, revision: record.revision, payload: record.payload }] };
    }
    if (sql.includes("INSERT INTO extension_records")) {
      refundPayloads.push(JSON.parse(String(args[2])) as Record<string, unknown>);
      return { rows: [{ ...insertedRefund, payload: refundPayloads[0] }] };
    }
    if (sql.includes("refund_of_payment_entry_id") && sql.includes("SELECT * FROM extension_records")) return { rows: [] };
    if (sql.includes("payment_method' NOT IN ('scholarship','refund','waiver')")) return { rows: [paymentRecord] };
    if (sql.includes("COALESCE(SUM(NULLIF(payload->>'amount'")) return { rows: [{ total: "25" }] };
    return { rows: [] };
  } };
  const records = new ExtensionRecords({ async one() { return { workspace_id: workspaceId }; } } as never,
    { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(records, {
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown,
      callback: (connection: never) => Promise<unknown>) { return callback(client as never); },
    async snapshot(_connection: unknown, record: unknown) { return record; },
  });
  (records as unknown as { unitRecordAccess: { canManageRecord(actor: string, recordId: string): Promise<boolean> } }).unitRecordAccess = {
    async canManageRecord(actor, recordId) { return actor === "coordinator" && recordId === enrollmentId; },
  };
  const result = await records.recordEnrollmentRefund(enrollmentId, "coordinator", {
    operation_key: "00000000-0000-4000-8000-000000000827", payment_entry_id: paymentId, amount: 25,
  });
  assert.equal(result.amount_refundable, 75);
  assert.equal(result.payment_status, "paid");
  assert.equal(refundPayloads[0].refund_of_payment_entry_id, paymentId);
  assert.equal(refundPayloads[0].amount, 25);
  enrollmentRecord.state = "active";
  await assert.rejects(records.recordEnrollmentRefund(enrollmentId, "coordinator", {
    operation_key: "00000000-0000-4000-8000-000000000828", payment_entry_id: paymentId, amount: 25,
  }), /Somente matrículas canceladas ou desistentes/);
});

test("gestão de unidade pode registrar taxa da reposição da matrícula e o grant é revalidado após o lock", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000831";
  const requestId = "00000000-0000-4000-8000-000000000832";
  const enrollmentId = "00000000-0000-4000-8000-000000000833";
  const learnerId = "00000000-0000-4000-8000-000000000834";
  const header = { workspace_id: workspaceId, enrollment_record_id: enrollmentId };
  const db = { async one() { return header; } };
  let mutationStarted = false;
  const accessible = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  Object.assign(accessible, {
    unitRecordAccess: { async canManageRecord(_actor: string, recordId: string) { return recordId === enrollmentId; } },
    async mutation() { mutationStarted = true; return "authorized"; },
  });
  assert.equal(await accessible.recordMakeupFee(requestId, "unit-manager", {
    operation_key: "00000000-0000-4000-8000-000000000835", expected_revision: 1, entry_type: "payment", amount: 10, payment_method: "pix",
  }), "authorized");
  assert.equal(mutationStarted, true);

  const request = { id: requestId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "makeup_request",
    title: "Reposição", state: "submitted", revision: 1,
    payload: { enrollment_record_id: enrollmentId, learner_user_id: learnerId, fee_amount: 20, fee_currency: "BRL" } };
  const enrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula", state: "active", revision: 1, payload: { learner_user_id: learnerId } };
  let unitChecks = 0;
  const statements: string[] = [];
  const client = { async query(sql: string) {
    statements.push(sql);
    if (sql.includes("kind='makeup_request' FOR UPDATE")) return { rows: [request] };
    if (sql.includes("kind='enrollment' FOR SHARE")) return { rows: [enrollment] };
    return { rows: [] };
  } };
  const revocation = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
    learningRegistry(), new DocumentScanner());
  Object.assign(revocation, {
    unitRecordAccess: { async canManageRecord(_actor: string, recordId: string) { unitChecks++; return recordId === enrollmentId && unitChecks === 1; } },
    async mutation(_plugin: string, _workspace: string, _actor: string, _key: unknown, _input: unknown,
      callback: (connection: never) => Promise<unknown>) { return callback(client as never); },
  });
  await assert.rejects(revocation.recordMakeupFee(requestId, "unit-manager", {
    operation_key: "00000000-0000-4000-8000-000000000836", expected_revision: 1, entry_type: "payment", amount: 10, payment_method: "pix",
  }), /gestão na unidade efetiva/);
  assert.equal(unitChecks, 2);
  assert.equal(statements.some((sql) => sql.includes("kind='makeup_fee_entry'")), false,
    "revoked unit access stops before reading or inserting the payment ledger");
});

test("lançamentos financeiros da matrícula revalidam o grant unitário depois de bloquear o alvo", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000841";
  const enrollmentId = "00000000-0000-4000-8000-000000000842";
  const learnerId = "00000000-0000-4000-8000-000000000843";
  const enrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula", state: "withdrawn", revision: 1,
    payload: { learner_user_id: learnerId, payment_status: "pending", course_record_id: cohortId, course_revision: 1 } };
  const cases = [
    { name: "payment", run: (service: ExtensionRecords) => service.recordEnrollmentPayment(enrollmentId, "unit-manager", {
      operation_key: "00000000-0000-4000-8000-000000000844", amount: 10, payment_method: "pix",
    }) },
    { name: "refund", run: (service: ExtensionRecords) => service.recordEnrollmentRefund(enrollmentId, "unit-manager", {
      operation_key: "00000000-0000-4000-8000-000000000845", payment_entry_id: cohortId, amount: 10,
    }) },
    { name: "financial cancellation", run: (service: ExtensionRecords) => service.recordEnrollmentFinancialCancellation(enrollmentId, "unit-manager", {
      operation_key: "00000000-0000-4000-8000-000000000846", notes: "Decisão institucional registrada.",
    }) },
  ];
  for (const operation of cases) {
    let grantChecks = 0;
    const statements: string[] = [];
    const db = { async one() { return { workspace_id: workspaceId }; } };
    const client = { async query(sql: string) { statements.push(sql); return { rows: [enrollment] }; } };
    const service = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
      learningRegistry(), new DocumentScanner());
    Object.assign(service, {
      unitRecordAccess: { async canManageRecord() { grantChecks++; return grantChecks === 1; } },
      async mutation(_plugin: string, _workspace: string, _actor: string, _key: unknown, _input: unknown,
        callback: (connection: never) => Promise<unknown>) { return callback(client as never); },
    });
    await assert.rejects(operation.run(service), /gestão na unidade efetiva/, operation.name);
    assert.equal(grantChecks, 2, `${operation.name} checks before and after the row lock`);
    assert.equal(statements.length, 1, `${operation.name} stops before reading or writing ledger entries`);
  }
});

test("revisões de bolsas, documentos e justificativas revalidam o grant unitário após o lock", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000851";
  const targets = [
    { id: "00000000-0000-4000-8000-000000000852", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "scholarship_application", state: "submitted", revision: 1, payload: {} },
    { id: "00000000-0000-4000-8000-000000000853", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "scholarship_counterparty", state: "submitted", revision: 1, payload: {} },
    { id: "00000000-0000-4000-8000-000000000854", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "learner_document", state: "submitted", revision: 1, payload: {} },
    { id: "00000000-0000-4000-8000-000000000855", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "attendance_justification", state: "submitted", revision: 1, payload: {} },
  ];
  const cases = [
    { target: targets[0]!, error: "gestão na unidade efetiva", run: (service: ExtensionRecords, targetId: string) => service.reviewScholarshipApplication(targetId, "unit-manager", {
      operation_key: "00000000-0000-4000-8000-000000000856", action: "review",
    }) },
    { target: targets[1]!, error: "gestão na unidade efetiva", run: (service: ExtensionRecords, targetId: string) => service.reviewScholarshipCounterparty(targetId, "unit-manager", {
      operation_key: "00000000-0000-4000-8000-000000000857", expected_revision: 1, action: "accept",
    }) },
    { target: targets[2]!, error: "unidade efetiva", run: (service: ExtensionRecords, targetId: string) => service.reviewLearnerDocument(targetId, "unit-manager", {
      operation_key: "00000000-0000-4000-8000-000000000858", expected_revision: 1, decision: "approved",
    }) },
    { target: targets[3]!, error: "unidade efetiva", run: (service: ExtensionRecords, targetId: string) => service.reviewAttendanceJustification(targetId, "unit-manager", {
      operation_key: "00000000-0000-4000-8000-000000000859", expected_revision: 1, decision: "approved",
    }) },
  ];
  for (const item of cases) {
    let grantChecks = 0;
    const db = { async one() { return { workspace_id: workspaceId, enrollment_id: cohortId, learner_user_id: "learner", payload: {} }; } };
    const client = { async query() { return { rows: [item.target] }; } };
    const service = new ExtensionRecords(db as never, { async has() { return false; }, async audit() {} } as never,
      learningRegistry(), new DocumentScanner());
    Object.assign(service, {
      unitRecordAccess: { async canManageRecord() { grantChecks++; return grantChecks === 1; } },
      async mutation(_plugin: string, _workspace: string, _actor: string, _key: unknown, _input: unknown,
        callback: (connection: never) => Promise<unknown>) { return callback(client as never); },
      async lock() { return item.target; },
    });
    await assert.rejects(item.run(service, item.target.id), new RegExp(item.error));
    assert.equal(grantChecks, 2, `${item.target.kind} checks the unit grant before and after locking the target`);
  }
});

test("saldo financeiro de matrícula cancelada é baixado com motivo e trilha imutável", async () => {
  const workspaceId = "00000000-0000-4000-8000-000000000821";
  const enrollmentId = "00000000-0000-4000-8000-000000000822";
  const learnerId = "00000000-0000-4000-8000-000000000823";
  const courseId = "00000000-0000-4000-8000-000000000824";
  const waiverId = "00000000-0000-4000-8000-000000000825";
  const enrollment: { id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown> } = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
    title: "Matrícula cancelada", state: "withdrawn", revision: 2,
    payload: { learner_user_id: learnerId, course_record_id: courseId, course_revision: 1, payment_status: "pending", amount_due: 100 } };
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "published", revision: 1,
    payload: {}, version_payload: { price_amount: 100, currency: "BRL" } };
  const priorPayment = { id: "00000000-0000-4000-8000-000000000826", workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "payment_entry",
    title: "PIX", state: "recorded", revision: 1, payload: { enrollment_record_id: enrollmentId, learner_user_id: learnerId, course_record_id: courseId,
      course_revision: 1, amount: 25, currency: "BRL", payment_method: "pix" } };
  const waiverPayload: { current: Record<string, unknown> | null } = { current: null };
  const client = { async query(sql: string, args: unknown[] = []) {
    if (sql.includes("kind='enrollment' FOR UPDATE")) return { rows: [enrollment] };
    if (sql.includes("kind='course' FOR SHARE OF r")) return { rows: [course] };
    if (sql.includes("kind='payment_entry'") && sql.includes("FOR UPDATE")) return { rows: [priorPayment] };
    if (sql.includes("SELECT r.id,r.plugin_id AS \"pluginId\"")) {
      const recordId = args[0]; const record = recordId === enrollmentId ? enrollment : course;
      return { rows: [{ id: record.id, pluginId: record.plugin_id, kind: record.kind, state: record.state, revision: record.revision, payload: record.payload }] };
    }
    if (sql.includes("INSERT INTO extension_records")) {
      waiverPayload.current = JSON.parse(String(args[2])) as Record<string, unknown>;
      return { rows: [{ id: waiverId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "payment_entry", title: "Saldo cancelado", state: "recorded", revision: 1, payload: waiverPayload.current }] };
    }
    return { rows: [] };
  } };
  const records = new ExtensionRecords({ async one() { return { workspace_id: workspaceId }; } } as never,
    { async has() { return false; }, async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(records, {
    async mutation(_plugin: string, _workspace: string, _user: string, _key: unknown, _input: unknown, callback: (connection: never) => Promise<unknown>) { return callback(client as never); },
    async snapshot(_connection: unknown, record: unknown) { return record; },
    async payload(_client: unknown, _plugin: string, _kind: string, payload: Record<string, unknown>) { return payload; },
    async save(_client: unknown, record: typeof enrollment, _user: string, _title: string, payload: Record<string, unknown>) {
      enrollment.payload = payload; enrollment.revision += 1; return enrollment;
    },
  });
  (records as unknown as { unitRecordAccess: { canManageRecord(actor: string, recordId: string): Promise<boolean> } }).unitRecordAccess = {
    async canManageRecord(actor, recordId) { return actor === "coordinator" && recordId === enrollmentId; },
  };
  const result = await records.recordEnrollmentFinancialCancellation(enrollmentId, "coordinator", {
    operation_key: "00000000-0000-4000-8000-000000000827", notes: "Matrícula encerrada; saldo dispensado conforme decisão institucional.",
  });
  assert.equal(result.amount_cancelled, 75);
  assert.equal(result.payment_status, "waived");
  assert.equal(enrollment.payload.payment_status, "waived");
  assert.equal(waiverPayload.current?.payment_method, "waiver");
  assert.equal(waiverPayload.current?.amount, 75);
  assert.match(String(waiverPayload.current?.notes), /decisão institucional/);
  enrollment.state = "active";
  await assert.rejects(records.recordEnrollmentFinancialCancellation(enrollmentId, "coordinator", {
    operation_key: "00000000-0000-4000-8000-000000000828", notes: "Teste",
  }), /após cancelar ou registrar a desistência/);
});

test("catálogo Suindá permite consulta anônima somente por GET", async () => {
  const access = new AccessService({} as never);
  access.bindPlugins([suindaPlugin]);
  const guard = new AccessGuard(access, {} as never);
  assert.equal(access.pluginPermission("/public/suinda/courses", "GET"), null);
  assert.equal(access.pluginPermission(`/public/suinda/courses/${cohortId}`, "GET"), null);
  assert.equal(access.pluginPermission(`/public/suinda/courses/${cohortId}/cohorts`, "GET"), null);
  const publicCertificatePath = "/public/suinda/certificates/SUINDA-00000000-0000-4000-8000-000000000001";
  assert.equal(access.pluginPermission(publicCertificatePath, "GET"), null);
  assert.equal(access.pluginPermission("/public/suinda/courses", "POST"), "plugin.suinda-learning.write");
  assert.equal(access.pluginPermission("/extensions/suinda-learning/me/favorites", "GET"), "plugin.suinda-learning.read");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/favorites/${cohortId}`, "POST"), "plugin.suinda-learning.read");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/favorites/${cohortId}`, "DELETE"), "plugin.suinda-learning.read");
  assert.equal(access.pluginPermission("/extensions/suinda-learning/me/favorites/not-an-id", "POST"), undefined);
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/enrollments/${cohortId}/practices/${cohortId}/submit`, "POST"), "plugin.suinda-learning.read");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/teaching/practices/${cohortId}/review`, "POST"), "plugin.suinda-learning.write");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/teaching/makeup-requests/${cohortId}/fee`, "POST"), "plugin.suinda-learning.manage");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/teaching/enrollments/${cohortId}/payments`, "POST"), "plugin.suinda-learning.manage");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/teaching/enrollments/${cohortId}/refunds`, "POST"), "plugin.suinda-learning.manage");
  assert.equal(access.pluginPermission(`/extensions/suinda-learning/me/teaching/enrollments/${cohortId}/financial-cancellations`, "POST"), "plugin.suinda-learning.manage");
  const context = (method: string, path = "/public/suinda/courses") => ({ switchToHttp: () => ({ getRequest: () => ({
    path, method, headers: {},
  }) }) });
  assert.equal(await guard.canActivate(context("GET") as never), true);
  assert.equal(await guard.canActivate(context("GET", publicCertificatePath) as never), true);
  await assert.rejects(() => guard.canActivate(context("POST") as never), /Faça login para continuar/);
});

test("catálogo público publica o menor e o maior preço das turmas abertas", async () => {
  const courseId = "00000000-0000-4000-8000-000000000321";
  const workspaceId = "00000000-0000-4000-8000-000000000322";
  const course = { id: courseId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "course", revision: 4,
    title: "Curso por turma", state: "enrollment_open", payload: { format: "cohort", currency: "BRL", price_amount: 80 } };
  const publicCourse = { ...course, workspace_name: "Instituição", instructors: [], payload: { ...course.payload } };
  const cohorts = [80, 500].map((price, index) => ({
    id: `cohort-${index}`, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "cohort", state: "enrolling",
    payload: { course_record_id: courseId, course_revision: 4, price_amount: price },
  }));
  const service = new ExtensionRecords({ async query() { return [course]; } } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async publicList(_pluginId: string, kind: string) { return kind === "course" ? [publicCourse] : cohorts; },
    async publicCourseStaff() { return new Map(); },
    async courseWorkloadHours() { return 12; },
  });
  const [result] = await service.publicCourses();
  assert.equal(result.payload.price_from_amount, 80);
  assert.equal(result.payload.price_to_amount, 500);
  assert.equal(result.payload.has_free_cohort, false);
  assert.equal(result.payload.has_paid_cohort, true);
});

test("marketplace público reúne cursos de workspaces distintos mantendo a instituição de origem", async () => {
  const courses = ["workspace-a", "workspace-b"].map((workspaceId, index) => ({
    id: `course-${index}`, workspace_id: workspaceId, workspace_name: `Instituição ${index + 1}`, plugin_id: "suinda-learning",
    kind: "course", revision: 1, title: `Curso ${index + 1}`, state: "enrollment_open",
    payload: { format: "open", price_amount: 50, currency: "BRL" },
  }));
  const service = new ExtensionRecords({ async query() { return courses; } } as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    async publicList(_pluginId: string, kind: string) { return kind === "course" ? courses : []; },
    async publicCourseStaff() { return new Map(); },
    async courseWorkloadHours() { return 10; },
  });
  const marketplace = await service.publicCourses();
  assert.deepEqual(marketplace.map((course) => [course.id, course.workspace_id, course.workspace_name]), [
    ["course-0", "workspace-a", "Instituição 1"], ["course-1", "workspace-b", "Instituição 2"],
  ]);
});

test("projeções de pesquisas anônimas ocultam a contagem exata abaixo de cinco respostas", async () => {
  const surveyId = "00000000-0000-4000-8000-000000000301";
  const survey = { id: surveyId, workspace_id: cohortId, plugin_id: "suinda-learning", kind: "survey", title: "Avaliação anônima",
    state: "closed", payload: { anonymous: true, questions: [{ id: "q1", label: "Nota", type: "rating" }] } };
  const responses = Array.from({ length: 4 }, (_, index) => ({
    id: `response-${index}`, workspace_id: cohortId, plugin_id: "suinda-learning", kind: "survey_response",
    payload: { survey_record_id: surveyId, answers: [{ question_id: "q1", value: index + 1 }] },
  }));
  const service = new ExtensionRecords({
    async one() { return survey; },
    async query(sql: string) {
      if (sql.includes("kind='survey_response'")) return responses;
      if (sql.includes("kind='survey'")) return [survey];
      return [];
    },
  } as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { assertAvailable() {}, async canRecord() { return true; } });

  const direct = await service.surveyResults(surveyId, "teacher");
  assert.equal(direct.anonymous, true);
  assert.equal(direct.suppressed, true);
  assert.equal(direct.response_count, null);
  assert.equal(direct.response_count_label, "Menos de 5");
  assert.deepEqual(direct.results, []);
  assert.equal(JSON.stringify(direct).includes('"response_count":4'), false);

  const listing = await service.teachingSurveys("teacher");
  assert.equal(listing.surveys[0].results.suppressed, true);
  assert.equal(listing.surveys[0].results.response_count, null);
  assert.equal(listing.surveys[0].results.response_count_label, "Menos de 5");
  assert.equal(JSON.stringify(listing).includes('"response_count":4'), false);
});

test("a pessoa docente avaliada acessa somente resultados agregados anônimos e respeita a amostra configurada", async () => {
  const surveyId = "00000000-0000-4000-8000-000000000302";
  const survey = { id: surveyId, workspace_id: cohortId, plugin_id: "suinda-learning", kind: "survey", title: "Avaliação anônima",
    state: "closed", payload: { anonymous: true, target_type: "teacher", target_record_id: "teacher-1", minimum_anonymous_responses: 7,
      questions: [{ id: "q1", label: "Nota", type: "rating" }] } };
  const responses = Array.from({ length: 6 }, (_, index) => ({
    id: `teacher-response-${index}`, workspace_id: cohortId, plugin_id: "suinda-learning", kind: "survey_response",
    payload: { survey_record_id: surveyId, learner_user_id: `learner-${index}`, answers: [{ question_id: "q1", value: 4 }] },
  }));
  const service = new ExtensionRecords({
    async one() { return survey; },
    async query(sql: string) { return sql.includes("kind='survey_response'") ? responses : []; },
  } as never, { async audit() {} } as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, { assertAvailable() {}, async canRecord() { return false; }, async manageableSurveyUnits() { return []; } });

  const results = await service.surveyResults(surveyId, "teacher-1");
  assert.equal(results.suppressed, true);
  assert.equal(results.response_count, null);
  assert.equal(results.response_count_label, "Menos de 7");
  assert.deepEqual(results.results, []);

  survey.payload.minimum_anonymous_responses = 5;
  const visible = await service.surveyResults(surveyId, "teacher-1");
  assert.equal(visible.suppressed, false);
  assert.equal(visible.response_count, 6);
  assert.deepEqual(visible.suggestions, []);
});

test("teaching survey list paginates past inaccessible installation-wide rows to find older authorized surveys", async () => {
  const records = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(1000 - index).padStart(12, "0")}`,
    workspace_id: "00000000-0000-4000-8000-000000000399", plugin_id: "suinda-learning", kind: "survey",
    title: `Survey ${index}`, state: "closed", revision: 1, payload: { anonymous: true, target_type: "cohort" },
    created_by: "owner", updated_by: "owner", created_at: new Date(Date.UTC(2026, 0, 2) - index * 1000).toISOString(),
    cursor_created_at: new Date(Date.UTC(2026, 0, 2) - index * 1000).toISOString(),
  }));
  const visibleId = records[500]!.id;
  const queries: unknown[][] = [];
  const db = { async query(_sql: string, args: unknown[]) {
    queries.push(args);
    const cursorId = args[1] as string | null;
    const start = cursorId ? records.findIndex((record) => record.id === cursorId) + 1 : 0;
    return records.slice(start, start + Number(args[2]));
  } };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    assertAvailable() {},
    async canRecord(_user: string, _plugin: string, _kind: string, recordId: string) { return recordId === visibleId; },
    async manageableSurveyUnits() { return []; },
    async surveyResults(surveyId: string) { return { survey_id: surveyId, anonymous: true, response_count: null, suppressed: true, results: [] }; },
  });

  const result = await service.teachingSurveys("unit-manager");
  assert.equal(queries.length, 10);
  assert.equal(result.surveys.length, 1);
  assert.equal(result.surveys[0]?.id, visibleId);
  assert.deepEqual(queries[0]?.slice(0, 2), [null, null]);
  assert.deepEqual(queries[9]?.slice(0, 2), [records[458]!.cursor_created_at, records[458]!.id]);
});

test("teaching survey catalog uses stable keyset pages and does not return an unbounded result set", async () => {
  const records = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(2000 - index).padStart(12, "0")}`,
    workspace_id: "00000000-0000-4000-8000-000000000398", plugin_id: "suinda-learning", kind: "survey",
    title: `Pesquisa ${index + 1}`, state: "closed", revision: 1, payload: { anonymous: true, target_type: "cohort" },
    created_at: new Date(Date.UTC(2026, 0, 2) - index * 1000).toISOString(),
    cursor_created_at: new Date(Date.UTC(2026, 0, 2) - index * 1000).toISOString(),
  }));
  const queries: unknown[][] = [];
  const db = { async query(_sql: string, args: unknown[]) {
    queries.push(args);
    const cursorId = args[1] as string | null;
    const start = cursorId ? records.findIndex((record) => record.id === cursorId) + 1 : 0;
    return records.slice(start, start + Number(args[2]));
  } };
  const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());
  Object.assign(service, {
    assertAvailable() {},
    async canRecord() { return true; },
    async surveyResults(surveyId: string) { return { survey_id: surveyId, anonymous: true, response_count: 5, suppressed: false, results: [] }; },
  });

  const first = await service.teachingSurveys("teacher", undefined, 100);
  assert.equal(first.surveys.length, 100);
  assert.equal(first.surveys.at(-1)?.id, records[99]?.id);
  assert.ok(first.next_cursor);
  const second = await service.teachingSurveys("teacher", first.next_cursor!, 100);
  assert.equal(second.surveys.length, 100);
  assert.equal(second.surveys.at(-1)?.id, records[199]?.id);
  assert.ok(second.next_cursor);
  assert.equal(new Set([...first.surveys, ...second.surveys].map((survey) => survey.id)).size, 200);
  assert.equal(queries.length, 4);
  assert.deepEqual(queries[1]?.slice(0, 2), [records[99]!.cursor_created_at, records[99]!.id]);
});

test("avaliação docente só aparece ao aluno quando a pessoa avaliada ensinou no curso ou na turma da matrícula", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-teacher-survey-eligibility-secret";
  try {
    const workspaceId = "00000000-0000-4000-8000-000000000411";
    const enrollmentId = "00000000-0000-4000-8000-000000000412";
    const courseId = "00000000-0000-4000-8000-000000000413";
    const cohortId = "00000000-0000-4000-8000-000000000414";
    const courseTeacherId = "00000000-0000-4000-8000-000000000415";
    const cohortTeacherId = "00000000-0000-4000-8000-000000000416";
    const unrelatedTeacherId = "00000000-0000-4000-8000-000000000417";
    const survey = (target: string) => ({ id: `00000000-0000-4000-8000-${target}`, workspace_id: workspaceId,
      plugin_id: "suinda-learning", kind: "survey", title: "Avaliação docente", state: "open",
      payload: { target_type: "teacher", target_record_id: target, anonymous: true, questions: [{ type: "rating", label: "Avaliação" }] } });
    const surveys = [survey(courseTeacherId), survey(cohortTeacherId), survey(unrelatedTeacherId)];
    const enrollment = { id: enrollmentId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "enrollment",
      state: "completed", payload: { course_record_id: courseId, course_revision: 3, cohort_record_id: cohortId, learner_user_id: "00000000-0000-4000-8000-000000000418" } };
    const queries: string[] = [];
    const lookups: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      async one(sql: string, args: unknown[] = []) {
        lookups.push({ sql, args });
        if (sql.includes("kind='enrollment'")) return enrollment;
        if (sql.includes("extension_record_versions")) return { payload: { instructor_ids: [courseTeacherId] } };
        if (sql.includes("kind='cohort'")) return { id: cohortId, payload: { instructor_user_id: cohortTeacherId, instructor_ids: [] } };
        return null;
      },
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("kind='survey'")) return surveys;
        return [];
      },
    };
    const service = new ExtensionRecords(db as never, {} as never, learningRegistry(), new DocumentScanner());
    Object.assign(service, { assertAvailable() {}, async canRecord() { return true; } });

    const result = await service.learnerSurveys(enrollmentId, "00000000-0000-4000-8000-000000000418");

    assert.deepEqual(result.surveys.map((item) => item.id), [surveys[0]!.id, surveys[1]!.id]);
    assert.ok(lookups.some((lookup) => lookup.sql.includes("extension_record_versions") && lookup.args[1] === 3));
    assert.ok(lookups.some((lookup) => lookup.sql.includes("kind='cohort'") && lookup.args[0] === cohortId));
    assert.equal(queries.length, 3);
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});

test("resultados de pesquisas anônimas por unidade usam chaves opacas e suprimem grupos locais menores que cinco", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-survey-unit-response-key-secret";
  try {
    const workspaceId = "00000000-0000-4000-8000-000000000331";
    const surveyId = "00000000-0000-4000-8000-000000000332";
    const courseId = "00000000-0000-4000-8000-000000000333";
    const unitA = "00000000-0000-4000-8000-000000000334";
    const unitB = "00000000-0000-4000-8000-000000000335";
    const localEnrollments = Array.from({ length: 5 }, (_, index) => `00000000-0000-4000-8000-00000000034${index}`);
    const remoteEnrollments = Array.from({ length: 4 }, (_, index) => `00000000-0000-4000-8000-00000000035${index}`);
    const survey = { id: surveyId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "survey", title: "Pesquisa por curso",
      state: "closed", payload: { target_type: "course", target_record_id: courseId, anonymous: true,
        questions: [{ id: "q1", label: "Nota", type: "rating" }] } };
    const keyFor = (enrollmentId: string) => createHmac("sha256", process.env.JWT_SECRET!).update(`${surveyId}:${enrollmentId}`).digest("hex");
    const allResponseRows = [...localEnrollments, ...remoteEnrollments].map((enrollmentId, index) => ({
      id: `response-${index}`, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "survey_response",
      payload: { survey_record_id: surveyId, response_key: keyFor(enrollmentId), answers: [{ question_id: "q1", value: index < 5 ? index + 1 : 10 }] },
    }));
    let scopedResponseKeys: string[] = [];
    const db = {
      async one() { return survey; },
      async query(sql: string, args: unknown[] = []) {
        if (sql.includes("SELECT e.id::text AS id")) {
          assert.deepEqual(args[1], [unitA]);
          const cursor = args[4] as string | null;
          return localEnrollments.filter((id) => cursor === null || id > cursor).slice(0, Math.min(4, Number(args[5]))).map((id) => ({ id }));
        }
        if (sql.includes("response_unit_record_id'=ANY($3::text[])")) return [];
        if (sql.includes("response_key'=ANY($3::text[])")) {
          scopedResponseKeys = args[2] as string[];
          return allResponseRows.filter((row) => scopedResponseKeys.includes(row.payload.response_key));
        }
        return [];
      },
    };
    const access = { async audit() {}, async hasScoped(_user: string, _permission: string, _type: string, scope: string) { return scope === unitA; } };
    const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
    Object.assign(service, {
      assertAvailable() {}, async canRecord() { return false; },
      unitRecordAccess: { async authorizedUnits() { return [{ id: unitA, workspace_id: workspaceId }, { id: unitB, workspace_id: workspaceId }]; } },
    });

    const hidden = await service.surveyResults(surveyId, "unit-manager");
    assert.equal(scopedResponseKeys.length, 4);
    assert.equal(hidden.response_count, null);
    assert.equal(hidden.response_count_label, "Menos de 5");
    assert.equal(hidden.suppressed, true);
    assert.deepEqual(hidden.results, []);

    const infrastructureSurvey = { ...survey, payload: { ...survey.payload, target_type: "infrastructure", target_record_id: workspaceId } };
    (db as unknown as { one: (sql: string, args?: unknown[]) => Promise<unknown> }).one = async () => infrastructureSurvey;
    await assert.rejects(() => service.surveyResults(surveyId, "unit-manager"), /Pesquisa não encontrada/);
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});

test("resultados unitários de avaliação docente incluem docentes atribuídos à revisão matriculada ou à turma", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-teacher-survey-unit-scope-secret";
  try {
    const workspaceId = "00000000-0000-4000-8000-000000000421";
    const surveyId = "00000000-0000-4000-8000-000000000422";
    const teacherId = "00000000-0000-4000-8000-000000000423";
    const unitId = "00000000-0000-4000-8000-000000000424";
    const enrollmentId = "00000000-0000-4000-8000-000000000425";
    const survey = { id: surveyId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "survey", title: "Avaliação docente",
      state: "closed", payload: { target_type: "teacher", target_record_id: teacherId, anonymous: true,
        questions: [{ id: "q1", label: "Avaliação", type: "rating" }] } };
    let enrollmentQuery = "";
    let enrollmentArgs: unknown[] = [];
    const db = {
      async one() { return survey; },
      async query(sql: string, args: unknown[] = []) {
        if (sql.includes("SELECT e.id::text AS id")) {
          enrollmentQuery = sql;
          enrollmentArgs = args;
          return [{ id: enrollmentId }];
        }
        return [];
      },
    };
    const access = { async audit() {}, async hasScoped(_user: string, _permission: string, _type: string, scope: string) { return scope === unitId; } };
    const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
    Object.assign(service, {
      assertAvailable() {}, async canRecord() { return false; },
      unitRecordAccess: { async authorizedUnits() { return [{ id: unitId, workspace_id: workspaceId }]; } },
    });

    const results = await service.surveyResults(surveyId, "unit-manager");

    assert.equal(results.suppressed, true);
    assert.match(enrollmentQuery, /cv\.revision=NULLIF\(e\.payload->>'course_revision',''\)::int/);
    assert.match(enrollmentQuery, /co\.payload->'instructor_ids'/);
    assert.match(enrollmentQuery, /co\.payload->>'instructor_user_id'/);
    assert.deepEqual(enrollmentArgs.slice(1, 4), [[unitId], "teacher", teacherId]);
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});

test("resultados de pesquisa por unidade percorrem mais de vinte mil matrículas sem omissão", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-survey-unit-response-key-secret";
  try {
    const workspaceId = "00000000-0000-4000-8000-000000000391";
    const surveyId = "00000000-0000-4000-8000-000000000392";
    const courseId = "00000000-0000-4000-8000-000000000393";
    const unitId = "00000000-0000-4000-8000-000000000394";
    const enrollments = Array.from({ length: 20_001 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    const survey = { id: surveyId, workspace_id: workspaceId, plugin_id: "suinda-learning", kind: "survey", title: "Pesquisa por unidade",
      state: "closed", payload: { target_type: "course", target_record_id: courseId, anonymous: true,
        questions: [{ id: "q1", label: "Nota", type: "rating" }] } };
    const keyFor = (enrollmentId: string) => createHmac("sha256", process.env.JWT_SECRET!).update(`${surveyId}:${enrollmentId}`).digest("hex");
    const responseByKey = new Map(enrollments.map((enrollmentId, index) => [keyFor(enrollmentId), {
      id: `response-${index}`, payload: { survey_record_id: surveyId, response_key: keyFor(enrollmentId), answers: [{ question_id: "q1", value: 5 }] },
    }]));
    const enrollmentCursors: Array<string | null> = [];
    let enrollmentQuery = "";
    const db = {
      async one() { return survey; },
      async query(sql: string, args: unknown[] = []) {
        if (sql.includes("SELECT e.id::text AS id")) {
          enrollmentQuery = sql;
          assert.deepEqual(args[1], [unitId]);
          const cursor = args[4] as string | null;
          enrollmentCursors.push(cursor);
          return enrollments.filter((id) => cursor === null || id > cursor).slice(0, Number(args[5])).map((id) => ({ id }));
        }
        if (sql.includes("response_unit_record_id'=ANY($3::text[])")) return [];
        if (sql.includes("response_key'=ANY($3::text[])")) {
          return (args[2] as string[]).flatMap((key) => {
            const row = responseByKey.get(key);
            return row ? [row] : [];
          });
        }
        return [];
      },
    };
    const access = { async audit() {}, async hasScoped(_user: string, _permission: string, _type: string, scope: string) { return scope === unitId; } };
    const service = new ExtensionRecords(db as never, access as never, learningRegistry(), new DocumentScanner());
    Object.assign(service, {
      assertAvailable() {}, async canRecord() { return false; },
      unitRecordAccess: { async authorizedUnits() { return [{ id: unitId, workspace_id: workspaceId }]; } },
    });

    const result = await service.surveyResults(surveyId, "unit-manager");

    assert.equal(result.suppressed, false);
    assert.equal(result.response_count, 20_001);
    assert.equal(result.results[0]?.responses, 20_001);
    assert.equal(enrollmentCursors.length, 21);
    assert.equal(enrollmentCursors.at(-1), enrollments[19_999]);
    assert.match(enrollmentQuery, /LEFT JOIN extension_record_versions cv/);
    assert.match(enrollmentQuery, /cv\.payload->'instructor_ids'/);
    assert.match(enrollmentQuery, /co\.payload->>'instructor_user_id'/);
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
