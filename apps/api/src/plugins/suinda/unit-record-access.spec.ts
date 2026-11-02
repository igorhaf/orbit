import assert from "node:assert/strict";
import test from "node:test";
import type { AccessRequestContext } from "../../access/access";
import { SuindaUnitRecordAccess } from "./unit-record-access";

const workspace = "00000000-0000-4000-8000-000000000001";
const course = "00000000-0000-4000-8000-000000000002";
const unit = "00000000-0000-4000-8000-000000000003";
const secondEnrollment = "00000000-0000-4000-8000-000000000004";
const secondUnit = "00000000-0000-4000-8000-000000000005";

test("accessibility audit collection authorizes unit grants beyond the legacy 2,000-unit cap", async () => {
  let requestProvider!: (user: string, permission: string, type: string, scope: string, request: AccessRequestContext) => Promise<boolean | null>;
  const candidates = Array.from({ length: 251 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }));
  const pageArgs: unknown[][] = [];
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(provider: typeof requestProvider) { requestProvider = provider; },
    async hasScoped(_user: string, permission: string, _type: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeId === candidates[250]!.id;
    },
  };
  const db = { async query(_sql: string, args: unknown[] = []) {
    pageArgs.push(args);
    const after = String(args[1] || "");
    return candidates.filter((candidate) => candidate.id > after).slice(0, 250);
  } };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  const allowed = await requestProvider("unit-manager", "plugin.suinda-learning.read", "workspace", "*", {
    path: "/extensions/suinda-learning/me/teaching/accessibility-audit/courses", method: "GET", params: {},
  });
  assert.equal(allowed, true);
  assert.equal(pageArgs.length, 2);
  assert.equal(pageArgs[1]![1], candidates[249]!.id);
});

test("unit dashboard scope includes only exact active read or manage grants", async () => {
  const secondWorkspace = "00000000-0000-4000-8000-000000000006";
  const access = {
    registerRecordPermissionProvider() {}, registerRequestPermissionProvider() {},
    async hasScoped(_user: string, permission: string, _scopeType: string, scopeId: string) {
      return scopeId === unit && permission === "plugin.suinda-learning.read"
        || scopeId === secondUnit && permission === "plugin.suinda-learning.manage";
    },
  };
  const db = { async query() { return [
    { id: unit, workspace_id: workspace }, { id: secondUnit, workspace_id: secondWorkspace },
    { id: course, workspace_id: workspace },
  ]; } };
  const policy = new SuindaUnitRecordAccess(db as never, access as never);
  assert.deepEqual(await policy.authorizedUnits("user-a"), [
    { id: unit, workspace_id: workspace }, { id: secondUnit, workspace_id: secondWorkspace },
  ]);
});

test("unit assessment, document, and risk queues require an exact management grant before applying their unit filters", async () => {
  let requestProvider!: (user: string, permission: string, type: string, scope: string, request: AccessRequestContext) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(provider: typeof requestProvider) { requestProvider = provider; },
    async hasScoped(user: string, permission: string, type: string, scopeId: string) {
      return user === "unit-manager" && permission === "plugin.suinda-learning.manage" && type === "extension_record" && scopeId === unit;
    },
  };
  const db = { async query() { return [{ id: unit, workspace_id: workspace }]; } };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  for (const queue of ["assessment", "document", "risk", "capacity"]) {
    const request = { path: `/extensions/suinda-learning/me/teaching/unit-operations/${queue}`, method: "GET", params: {} };
    const allowed = await requestProvider("unit-manager", "plugin.suinda-learning.read", "workspace", "*", request);
    assert.equal(allowed, true, `${queue} queue should reach the service with a unit management grant`);
    assert.equal(await requestProvider("reader", "plugin.suinda-learning.read", "workspace", "*", request), null,
      `${queue} queue should reject a unit grant without management permission`);
  }
});

test("read-only unit grant reaches the filtered teaching dashboard GET but not writes", async () => {
  let requestProvider!: (user: string, permission: string, type: string, scope: string, request: AccessRequestContext) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(provider: typeof requestProvider) { requestProvider = provider; },
    async hasScoped(_user: string, permission: string, _type: string, scopeId: string) {
      return permission === "plugin.suinda-learning.read" && scopeId === unit;
    },
  };
  const db = { async query() { return [{ id: unit, workspace_id: workspace }]; } };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  const read = await requestProvider("reader", "plugin.suinda-learning.read", "workspace", "*", {
    path: "/extensions/suinda-learning/me/teaching/?cursor=next", method: "GET", params: {},
  });
  const write = await requestProvider("reader", "plugin.suinda-learning.write", "workspace", "*", {
    path: "/extensions/suinda-learning/me/teaching", method: "POST", params: {},
  });
  assert.equal(read, true);
  assert.equal(write, null);
});

test("curriculum clone and reorder routes require management in every linked unit", async () => {
  let requestProvider!: (user: string, permission: string, type: string, scope: string, request: AccessRequestContext) => Promise<boolean | null>;
  const unitGrants = new Set([unit, secondUnit]);
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(provider: typeof requestProvider) { requestProvider = provider; },
    async hasScoped(_user: string, _permission: string, _type: string, scopeId: string) { return unitGrants.has(scopeId); },
  };
  const db = {
    async one(sql: string) {
      if (sql.includes("SELECT workspace_id,id AS course_id")) return { workspace_id: workspace, course_id: course };
      if (sql.includes("CASE WHEN p.kind='course'")) return { workspace_id: workspace, course_id: course };
      if (sql.includes("SELECT id FROM extension_records WHERE id=$1 AND workspace_id=$2")) return { id: course };
      return null;
    },
    async query(sql: string) {
      if (sql.includes("WITH course_units AS")) return [{ id: unit }, { id: secondUnit }];
      return [];
    },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  const clonePath = `/extensions/suinda-learning/courses/${course}/duplicate`;
  const reorderPath = `/extensions/suinda-learning/curriculum/module/${course}/reorder`;
  const decision = (path: string) => requestProvider("manager", "plugin.suinda-learning.write", "workspace", workspace, {
    path, method: "POST", params: { id: course, parentKind: "module", parentId: course },
  });

  assert.equal(await decision(clonePath), true);
  assert.equal(await decision(reorderPath), true);
  unitGrants.delete(secondUnit);
  assert.equal(await decision(clonePath), null);
  assert.equal(await decision(reorderPath), null);
});

test("authorized unit lookup does not omit valid grants after 2,000 candidates", async () => {
  const candidates = Array.from({ length: 2_001 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspace_id: workspace,
  }));
  const last = candidates.at(-1)!;
  let candidateSql = "";
  const access = {
    registerRecordPermissionProvider() {}, registerRequestPermissionProvider() {},
    async hasScoped(_user: string, permission: string, _scopeType: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeId === last.id;
    },
  };
  const db = { async query(sql: string) { candidateSql = sql; return candidates; } };
  const policy = new SuindaUnitRecordAccess(db as never, access as never);

  assert.deepEqual(await policy.authorizedUnits("unit-manager"), [last]);
  assert.doesNotMatch(candidateSql, /\bLIMIT\s+2000\b/i);
});

test("record access resolves the academic unit and checks its exact grant", async () => {
  let provider!: (user: string, plugin: string, kind: string, recordId: string, action: string) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider(callback: typeof provider) { provider = callback; },
    registerRequestPermissionProvider() {},
    async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
      return ["plugin.suinda-learning.manage", "plugin.suinda-learning.read"].includes(permission) && scopeType === "extension_record" && scopeId === unit;
    },
  };
  const db = {
    async one(sql: string) {
      if (sql.includes("kind='institution_unit'")) return { id: unit };
      return { id: course, workspace_id: workspace, kind: "course", payload: { institution_unit_record_id: unit } };
    },
    async query() { return [{ id: unit, workspace_id: workspace, kind: "institution_unit", payload: {} }]; },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();

  assert.equal(await provider("user-a", "other-plugin", "course", course, "read"), null);
  assert.equal(await provider("user-a", "suinda-learning", "course", course, "write"), true);
  assert.equal(await provider("user-a", "suinda-learning", "course", course, "read"), true);
});

test("writing shared lesson records requires grants for the course and every active cohort unit", async () => {
  const lessonId = "00000000-0000-4000-8000-000000000007";
  const moduleId = "00000000-0000-4000-8000-000000000008";
  const grantedUnits = new Set([unit]);
  let unitScopeSql = "";
  let provider!: (user: string, plugin: string, kind: string, recordId: string, action: string) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider(callback: typeof provider) { provider = callback; },
    registerRequestPermissionProvider() {},
    async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
      return grantedUnits.has(scopeId) && scopeType === "extension_record"
        && ["plugin.suinda-learning.read", "plugin.suinda-learning.manage"].includes(permission);
    },
  };
  const db = {
    async one(sql: string, args: unknown[] = []) {
      if (sql.includes("FROM access_grants")) return grantedUnits.has(String(args[1])) ? { one: 1 } : null;
      if (sql.includes("kind='module'")) return { id: moduleId, workspace_id: workspace, kind: "module",
        payload: { course_record_id: course, course_revision: 4 } };
      return { id: lessonId, workspace_id: workspace, kind: "lesson", payload: { module_record_id: moduleId } };
    },
    async query(sql: string) { unitScopeSql = sql; return [{ id: unit }, { id: secondUnit }]; },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  assert.equal(await provider("manager-a", "suinda-learning", "lesson", lessonId, "write"), false,
    "unit A can read shared lesson material but cannot change content also used by unit B");
  assert.equal(await provider("manager-a", "suinda-learning", "lesson", lessonId, "read"), true);
  grantedUnits.add(secondUnit);
  assert.equal(await provider("manager-a", "suinda-learning", "lesson", lessonId, "write"), true);
  assert.match(unitScopeSql, /co\.payload->>'course_revision'=\$3::text/);
  assert.match(unitScopeSql, /co\.state NOT IN \('archived','canceled'\)/);
});

test("records without an institution unit fall through to the normal authorization policy", async () => {
  let provider!: (user: string, plugin: string, kind: string, recordId: string, action: string) => Promise<boolean | null>;
  const access = { registerRecordPermissionProvider(callback: typeof provider) { provider = callback; }, registerRequestPermissionProvider() {}, async hasScoped() { return false; } };
  const db = { async one() { return { id: course, workspace_id: workspace, kind: "course", payload: {} }; }, async query() { return []; } };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  assert.equal(await provider("user-a", "suinda-learning", "course", course, "read"), null);
});

test("a workspace administrator without a unit grant retains the normal access path", async () => {
  let provider!: (user: string, plugin: string, kind: string, recordId: string, action: string) => Promise<boolean | null>;
  const access = { registerRecordPermissionProvider(callback: typeof provider) { provider = callback; }, registerRequestPermissionProvider() {}, async hasScoped() { return false; } };
  const db = {
    async one(sql: string) {
      if (sql.includes("access_grants")) return null;
      if (sql.includes("kind='institution_unit'")) return { id: unit };
      return { id: course, workspace_id: workspace, kind: "course", payload: { institution_unit_record_id: unit } };
    },
    async query() { return [{ id: unit, workspace_id: workspace, kind: "institution_unit", payload: {} }]; },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  assert.equal(await provider("user-a", "suinda-learning", "course", course, "write"), null);
});

test("a targeted Suindá route can use only the referenced record's unit grant", async () => {
  let provider!: (user: string, permission: string, type: string, scope: string, request: { path: string; method: string; params?: Record<string, string>; body?: Record<string, unknown> }) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
    async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
      return ["plugin.suinda-learning.manage", "plugin.suinda-learning.read"].includes(permission)
        && scopeType === "extension_record" && scopeId === unit;
    },
  };
  const db = {
    async one(sql: string) {
      if (sql.includes("kind='institution_unit'")) return { id: unit };
      return { id: course, workspace_id: workspace, kind: "course", payload: { institution_unit_record_id: unit } };
    },
    async query(sql: string, args: unknown[]) {
      if (sql.startsWith("SELECT id FROM extension_records")) return (args[0] as string[]).includes(course) ? [{ id: course }] : [];
      return [{ id: unit, workspace_id: workspace, kind: "institution_unit", payload: {} }];
    },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  assert.equal(await provider("user-a", "plugin.suinda-learning.manage", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/submissions/${course}/grade`, method: "POST", params: { submissionId: course },
  }), true);
  for (const suffix of ["", "/attendance", "/attendance/zoom-sync", "/meeting-room", "/meeting-room/reconcile", "/checkin-code"])
    assert.equal(await provider("user-a", suffix === "/checkin-code" ? "plugin.suinda-learning.read" : "plugin.suinda-learning.manage", "workspace", workspace, {
      path: `/extensions/suinda-learning/me/teaching/sessions/${course}${suffix}`, method: suffix === "/checkin-code" ? "GET" : "POST", params: { sessionId: course },
    }), true, `${suffix || "session"} is scoped to the session in the route`);
  for (const path of ["import/preview", "import", "announcements"]) assert.equal(await provider("user-a", "plugin.suinda-learning.manage", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/cohorts/${course}/${path}`, method: "POST", params: { cohortId: course },
  }), true, `${path} is scoped to the cohort in the route`);
  assert.equal(await provider("user-a", "plugin.suinda-learning.read", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/cohorts/${course}/announcement-templates`, method: "GET", params: { cohortId: course },
  }), true, "reading announcement templates is scoped to the cohort in the route");
  assert.equal(await provider("user-a", "plugin.suinda-learning.manage", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/lessons/${course}/materials/${course}/alt-text`, method: "POST", params: { lessonId: course, attachmentId: course },
  }), true, "correcting a lesson image is scoped to the lesson ID, not an ID from the request body");
  for (const method of ["GET", "POST"]) assert.equal(await provider("user-a", method === "GET" ? "plugin.suinda-learning.read" : "plugin.suinda-learning.write", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/lessons/${course}/materials`, method, params: { lessonId: course },
  }), true, `lesson material ${method === "GET" ? "listing" : "upload"} uses the lesson unit grant`);
  assert.equal(await provider("user-a", "plugin.suinda-learning.write", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/lessons/${course}/accessibility`, method: "POST", params: { lessonId: course },
  }), true, "published media remediation is scoped to the exact lesson");
  for (const suffix of ["", "/apply"]) assert.equal(await provider("user-a", "plugin.suinda-learning.write", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/lessons/${course}/transcription${suffix}`, method: "POST", params: { lessonId: course },
  }), true, `lesson transcription${suffix} is scoped to the exact lesson`);
  assert.equal(await provider("user-a", "plugin.suinda-learning.write", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/enrollments/${course}/transfer`, method: "POST", params: { enrollmentId: course },
  }), true, "transfer target scope is gated first by its source enrollment; service checks the destination unit separately");
  for (const action of ["payments", "refunds", "financial-cancellations"]) assert.equal(
    await provider("user-a", "plugin.suinda-learning.manage", "workspace", workspace, {
      path: `/extensions/suinda-learning/me/teaching/enrollments/${course}/${action}`, method: "POST", params: { enrollmentId: course },
    }), true, `${action} is scoped to the enrollment in the route`,
  );
  assert.equal(await provider("user-a", "plugin.suinda-learning.manage", "workspace", workspace, {
    path: "/extensions/suinda-learning/workspaces/" + workspace + "/payment-provider", method: "PUT",
  }), null);
});

test("practice-credit cross-unit requests require manage grants on both enrollment units", async () => {
  const unitA = unit;
  const unitB = secondUnit;
  const sourceId = "00000000-0000-4000-8000-000000000201";
  const targetId = "00000000-0000-4000-8000-000000000202";
  const requestId = "00000000-0000-4000-8000-000000000203";
  const makeProvider = (managed: string[]) => {
    let provider!: (user: string, permission: string, type: string, scope: string, request: { path: string; method: string; params?: Record<string, string> }) => Promise<boolean | null>;
    const records = new Map([
      [sourceId, { id: sourceId, workspace_id: workspace, kind: "enrollment", payload: { institution_unit_record_id: unitA } }],
      [targetId, { id: targetId, workspace_id: workspace, kind: "enrollment", payload: { institution_unit_record_id: unitB } }],
    ]);
    const access = {
      registerRecordPermissionProvider() {},
      registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
      async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
        return permission === "plugin.suinda-learning.manage" && scopeType === "extension_record" && managed.includes(scopeId);
      },
    };
    const db = {
      async one(sql: string, args: unknown[] = []) {
        if (sql.includes("FROM suinda_practice_credit_requests")) return { source_enrollment_id: sourceId, target_enrollment_id: targetId };
        if (sql.includes("FROM access_grants")) return managed.includes(String(args[1])) ? { id: 1 } : null;
        if (sql.includes("kind='institution_unit'")) return { id: args[0] };
        if (sql.includes("FROM extension_records WHERE id=$1")) return records.get(String(args[0])) || null;
        return null;
      },
      async query(sql: string) {
        if (sql.includes("SELECT DISTINCT r.workspace_id,r.id")) return managed.map((id) => ({ id, workspace_id: workspace }));
        return [];
      },
    };
    new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
    return { call: (method: string, path: string, params: Record<string, string>) => provider("unit-manager", "plugin.suinda-learning.manage", "workspace", workspace,
      { method, path, params }) };
  };

  const reviewPath = `/extensions/suinda-learning/workspaces/${workspace}/practice-credit-requests/${requestId}/review`;
  assert.equal(await makeProvider([unitA]).call("POST", reviewPath, { workspaceId: workspace, requestId }), false,
    "management on only one side of a cross-unit request is insufficient");
  assert.equal(await makeProvider([unitA, unitB]).call("POST", reviewPath, { workspaceId: workspace, requestId }), true);
  assert.equal(await makeProvider([unitA]).call("GET", `/extensions/suinda-learning/workspaces/${workspace}/practice-credit-requests`, { workspaceId: workspace }), true,
    "the route can open only because the service subsequently filters both request sides");
});

test("record scope follows the most specific enrollment unit before a shared course unit", async () => {
  const enrollment = "00000000-0000-4000-8000-000000000007";
  const submission = "00000000-0000-4000-8000-000000000008";
  const submissionRecord = { id: submission, workspace_id: workspace, kind: "submission", payload: {
    enrollment_record_id: enrollment, course_record_id: course,
  } };
  const enrollmentRecord = { id: enrollment, workspace_id: workspace, kind: "enrollment", payload: {
    institution_unit_record_id: secondUnit, course_record_id: course,
  } };
  let recordProvider!: (user: string, plugin: string, kind: string, recordId: string, action: string) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider(callback: typeof recordProvider) { recordProvider = callback; },
    registerRequestPermissionProvider() {},
    async hasScoped(_user: string, permission: string, _scopeType: string, scopeId: string) {
      return scopeId === secondUnit && permission === "plugin.suinda-learning.read";
    },
  };
  const db = {
    async one(sql: string, args: unknown[]) {
      if (sql.includes("access_grants")) return args[1] === secondUnit ? { exists: 1 } : null;
      if (sql.includes("kind='institution_unit'")) return args[0] === secondUnit ? { id: secondUnit } : null;
      return submissionRecord;
    },
    async query(_sql: string, args: unknown[]) {
      const ids = args[0] as string[];
      return ids.includes(enrollment) ? [enrollmentRecord] : [];
    },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  assert.equal(await recordProvider("user-a", "suinda-learning", "submission", submission, "read"), true);
});

test("a community report follows the target content unit, not the reporter unit", async () => {
  const reporterEnrollment = "00000000-0000-4000-8000-000000000009";
  const report = "00000000-0000-4000-8000-000000000010";
  const reportRecord = { id: report, workspace_id: workspace, kind: "community_report", payload: {
    enrollment_record_id: reporterEnrollment, target_enrollment_record_id: secondEnrollment, target_record_id: "00000000-0000-4000-8000-000000000011", target_kind: "discussion_thread",
  } };
  const legacyReport = { ...reportRecord, id: "00000000-0000-4000-8000-000000000012", payload: {
    enrollment_record_id: reporterEnrollment, target_record_id: "00000000-0000-4000-8000-000000000013", target_kind: "discussion_thread",
  } };
  const targetRecord = { id: secondEnrollment, workspace_id: workspace, kind: "enrollment", payload: { institution_unit_record_id: secondUnit } };
  let grantedUnit = secondUnit;
  let recordProvider!: (user: string, plugin: string, kind: string, recordId: string, action: string) => Promise<boolean | null>;
  let requestProvider!: (user: string, permission: string, type: string, scope: string, request: AccessRequestContext) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider(callback: typeof recordProvider) { recordProvider = callback; },
    registerRequestPermissionProvider(callback: typeof requestProvider) { requestProvider = callback; },
    async hasScoped(_user: string, permission: string, _scopeType: string, scopeId: string) {
      return scopeId === grantedUnit && permission === "plugin.suinda-learning.manage";
    },
  };
  const db = {
    async one(sql: string, args: unknown[]) {
      if (sql.includes("SELECT enrollment.id::text AS id")) return { id: secondEnrollment };
      if (sql.includes("SELECT id,workspace_id,kind,payload FROM extension_records")) {
        if (args[0] === legacyReport.id) return legacyReport;
        if (args[0] === secondEnrollment) return targetRecord;
        return reportRecord;
      }
      if (sql.includes("access_grants")) return args[1] === grantedUnit ? { exists: 1 } : null;
      if (sql.includes("kind='institution_unit'")) return args[0] === secondUnit ? { id: secondUnit } : null;
      return reportRecord;
    },
    async query(sql: string, args: unknown[] = []) {
      if (sql.includes("SELECT DISTINCT r.workspace_id,r.id")) return [{ id: secondUnit, workspace_id: workspace }];
      const ids = args[0] as string[];
      if (sql.includes("SELECT id FROM extension_records WHERE id=ANY")) {
        if (ids?.includes(legacyReport.id)) return [legacyReport];
        if (ids?.includes(report)) return [reportRecord];
      }
      return ids?.includes(secondEnrollment) ? [targetRecord] : [];
    },
  };
  const policy = new SuindaUnitRecordAccess(db as never, access as never);
  policy.onModuleInit();
  assert.equal(await policy.canManageRecord("unit-manager", report), true);
  assert.equal(await recordProvider("unit-manager", "suinda-learning", "community_report", report, "manage"), true);
  assert.equal(await requestProvider("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path: "/extensions/suinda-learning/me/teaching/community-reports", method: "GET",
  }), true, "the service can now return reports filtered to the target content unit");
  assert.equal(await requestProvider("unit-manager", "plugin.suinda-learning.write", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/community-reports/${report}/dismiss`, method: "POST", params: { reportId: report },
  }), true, "report review is scoped to the target enrollment rather than the reporter");
  assert.equal(await requestProvider("unit-manager", "plugin.suinda-learning.write", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/community-reports/${report}/dismiss`, method: "POST", body: { reportId: report },
  }), null, "a report ID in the body cannot grant access");
  assert.equal(await requestProvider("unit-manager", "plugin.suinda-learning.write", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/community-reports/${legacyReport.id}/dismiss`, method: "POST", params: { reportId: legacyReport.id },
  }), true, "legacy reports derive their scope from the reported content, not the reporter");
  grantedUnit = unit;
  assert.equal(await policy.canManageRecord("unit-manager", legacyReport.id), false,
    "a grant only in the reporter unit cannot authorize a report about content in another unit");
});

test("unit grants do not authorize operations that span a course's units", async () => {
  let provider!: (user: string, permission: string, type: string, scope: string, request: { path: string; method: string; params?: Record<string, string>; body?: Record<string, unknown> }) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
    async hasScoped() { return true; },
  };
  const db = {
    async one() { return { id: course, workspace_id: workspace, kind: "course", payload: { institution_unit_record_id: unit } }; },
    async query(sql: string, args: unknown[]) {
      if (sql.startsWith("SELECT id FROM extension_records")) return (args[0] as string[]).includes(course) ? [{ id: course }] : [];
      return [{ id: unit, workspace_id: workspace, kind: "institution_unit", payload: {} }];
    },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  const paths = [
    `/extensions/suinda-learning/courses/${course}/duplicate`,
    `/extensions/suinda-learning/curriculum/course/${course}/reorder`,
    `/extensions/suinda-learning/me/teaching/courses/${course}/community`,
  ];
  for (const path of paths) assert.equal(await provider("user-a", "plugin.suinda-learning.manage", "workspace", workspace, {
    path, method: "POST", body: { course_record_id: course },
  }), null, path);
  assert.equal(await provider("user-a", "plugin.suinda-learning.read", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/surveys/${course}/results`, method: "GET", params: { surveyId: course },
  }), true, "survey results may reach the service, which filters each response by opaque enrollment key before aggregation");
});

test("team collections and credential files can reach the service with a unit management grant", async () => {
  let provider!: (user: string, permission: string, type: string, scope: string, request: { path: string; method: string; params?: Record<string, string> }) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
    async hasScoped(_user: string, permission: string, _scopeType: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeId === unit;
    },
  };
  const db = {
    async one(sql: string) {
      if (sql.includes("kind='staff_credential'")) return { workspace_id: workspace };
      if (sql.includes("kind='survey'")) return { workspace_id: workspace };
      return null;
    },
    async query(sql: string) {
      if (sql.includes("SELECT DISTINCT r.workspace_id,r.id")) return [{ id: unit, workspace_id: workspace }];
      return [];
    },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  assert.equal(await provider("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path: `/extensions/suinda-learning/workspaces/${workspace}/staff-directory`, method: "GET",
  }), true);
  assert.equal(await provider("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path: `/extensions/suinda-learning/workspaces/${workspace}/staff-credentials`, method: "GET",
  }), true);
  assert.equal(await provider("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path: "/extensions/suinda-learning/me/teaching/surveys", method: "GET",
  }), true);
  assert.equal(await provider("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/teaching/surveys/${course}/results`, method: "GET",
  }), true);
  assert.equal(await provider("unit-manager", "plugin.suinda-learning.read", "workspace", "00000000-0000-4000-8000-000000000099", {
    path: `/extensions/suinda-learning/staff-credentials/${course}/files/${secondEnrollment}`, method: "GET",
  }), true, "file scope is resolved from its credential record, not the request's ambient workspace");
});

test("honorarium collection and payment routes defer to unit scope without trusting body IDs", async () => {
  let provider!: (user: string, permission: string, type: string, scope: string, request: { path: string; method: string; params?: Record<string, string>; body?: Record<string, unknown> }) => Promise<boolean | null>;
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
    async hasScoped(_user: string, permission: string, _scopeType: string, scopeId: string) {
      return permission === "plugin.suinda-learning.manage" && scopeId === unit;
    },
  };
  const db = {
    async one(sql: string) {
      if (sql.includes("suinda_staff_honorarium_ledger")) return { institution_unit_record_id: unit };
      return null;
    },
    async query(sql: string) {
      if (sql.includes("SELECT DISTINCT r.workspace_id,r.id")) return [{ id: unit, workspace_id: workspace }];
      return [];
    },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  const collection = `/extensions/suinda-learning/workspaces/${workspace}/staff-honoraria`;
  assert.equal(await provider("unit-manager", "plugin.suinda-learning.manage", "workspace", workspace, { path: collection, method: "GET" }), true);
  assert.equal(await provider("unit-manager", "plugin.suinda-learning.manage", "workspace", workspace, {
    path: collection, method: "POST", body: { institution_unit_record_id: secondUnit },
  }), true, "the route only opens the service; it does not authorize the body-supplied unit");
  assert.equal(await provider("unit-manager", "plugin.suinda-learning.manage", "workspace", workspace, {
    path: `${collection}/${course}/payments`, method: "POST",
  }), true);
});

test("paginated teaching management queues admit only unit managers to service-side scoped reads", async () => {
  const paths = [
    "/extensions/suinda-learning/me/teaching/scholarship-counterparties?cursor=next",
    "/extensions/suinda-learning/me/teaching/scholarship-applications?cursor=next",
    "/extensions/suinda-learning/me/teaching/financial-action-queue?queue=refund&cursor=next",
  ];
  const makeProvider = (canManage: boolean, canRead = true) => {
    let provider!: (user: string, permission: string, type: string, scope: string, request: AccessRequestContext) => Promise<boolean | null>;
    const access = {
      registerRecordPermissionProvider() {},
      registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
      async hasScoped(_user: string, permission: string, _scopeType: string, scopeId: string) {
        return scopeId === unit && (canRead && permission === "plugin.suinda-learning.read" || canManage && permission === "plugin.suinda-learning.manage");
      },
    };
    const db = { async query() { return [{ id: unit, workspace_id: workspace }]; } };
    new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
    return provider;
  };

  const manager = makeProvider(true);
  for (const path of paths) assert.equal(await manager("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path, method: "GET",
  }), true, "a unit manager reaches the service, which applies the exact unit filter before returning a page");

  const reader = makeProvider(false);
  for (const path of paths) assert.equal(await reader("unit-reader", "plugin.suinda-learning.read", "workspace", workspace, {
    path, method: "GET",
  }), null, "a read-only unit grant cannot access administrative queues");
  assert.equal(await manager("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path: paths[0]!, method: "POST",
  }), null, "the queue exception is read-only");

  const reportPaths = [
    "/extensions/suinda-learning/me/reports?from=2026-01-01",
    "/extensions/suinda-learning/me/reports.pdf?from=2026-01-01",
    "/extensions/suinda-learning/me/finance-ledger.csv?from=2026-01-01",
  ];
  const unitReader = makeProvider(false);
  for (const path of reportPaths) assert.equal(await unitReader("unit-reader", "plugin.suinda-learning.read", "workspace", workspace, {
    path, method: "GET",
  }), true, "the report/export services allow read grants and apply their own unit scope");
  const noUnitAccess = makeProvider(false, false);
  for (const path of reportPaths) assert.equal(await noUnitAccess("user-without-unit-grant", "plugin.suinda-learning.read", "workspace", workspace, {
    path, method: "GET",
  }), null, "the route does not grant report access without a unit read or manage scope");
});

test("teaching community collection opens only for a managed unit in the course workspace", async () => {
  const courseId = "00000000-0000-4000-8000-000000000081";
  const otherWorkspace = "00000000-0000-4000-8000-000000000082";
  const makeProvider = (unitWorkspace: string) => {
    let provider!: (user: string, permission: string, type: string, scope: string, request: AccessRequestContext) => Promise<boolean | null>;
    const access = {
      registerRecordPermissionProvider() {},
      registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
      async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
        return permission === "plugin.suinda-learning.manage" && scopeType === "extension_record" && scopeId === unit;
      },
    };
    const db = {
      async one(sql: string) { return sql.includes("kind='course'") ? { workspace_id: workspace } : null; },
      async query() { return [{ id: unit, workspace_id: unitWorkspace }]; },
    };
    new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
    return provider;
  };
  const path = `/extensions/suinda-learning/me/teaching/courses/${courseId}/community`;
  assert.equal(await makeProvider(workspace)("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path, method: "GET", params: { courseId },
  }), true, "the teaching service still filters each thread by its target enrollment unit");
  assert.equal(await makeProvider(otherWorkspace)("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, {
    path, method: "GET", params: { courseId },
  }), null, "a unit in another workspace cannot open this course collection");
});

test("Mercado Pago review routes authorize unit managers against the checkout enrollment", async () => {
  const checkout = "00000000-0000-4000-8000-000000000091";
  const enrollmentId = "00000000-0000-4000-8000-000000000092";
  const makeProvider = (managedUnitId: string) => {
    let provider!: (user: string, permission: string, type: string, scope: string, request: AccessRequestContext) => Promise<boolean | null>;
    const access = {
      registerRecordPermissionProvider() {},
      registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
      async hasScoped(_user: string, permission: string, scopeType: string, scopeId: string) {
        return permission === "plugin.suinda-learning.manage" && scopeType === "extension_record" && scopeId === managedUnitId;
      },
    };
    const db = {
      async query(sql: string) {
        if (sql.includes("SELECT DISTINCT r.workspace_id,r.id")) return [{ id: managedUnitId,
          workspace_id: managedUnitId === unit ? workspace : "00000000-0000-4000-8000-000000000093" }];
        return [];
      },
      async one(sql: string, args: unknown[] = []) {
        if (sql.includes("FROM suinda_payment_checkouts")) return { enrollment_id: enrollmentId };
        if (sql.includes("SELECT id,workspace_id,kind,payload FROM extension_records")) return {
          id: enrollmentId, workspace_id: workspace, kind: "enrollment", payload: { institution_unit_record_id: unit },
        };
        if (sql.includes("kind='institution_unit'")) return args[0] === unit ? { id: unit } : null;
        if (sql.includes("FROM access_grants")) return args[1] === unit ? { exists: 1 } : null;
        return null;
      },
    };
    new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
    return provider;
  };
  const managed = makeProvider(unit);
  const queue = `/extensions/suinda-learning/workspaces/${workspace}/payment-reviews`;
  const reconcile = `${queue}/${checkout}/reconcile`;
  assert.equal(await managed("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, { path: queue, method: "GET" }), true,
    "the queue service filters checkouts by effective enrollment unit");
  assert.equal(await managed("unit-manager", "plugin.suinda-learning.write", "workspace", workspace, {
    path: reconcile, method: "POST", params: { workspaceId: workspace, checkoutId: checkout },
  }), true, "reconciliation entry is resolved to its enrollment before checking the unit grant");

  const unrelated = makeProvider(secondUnit);
  assert.equal(await unrelated("unit-manager", "plugin.suinda-learning.read", "workspace", workspace, { path: queue, method: "GET" }), null,
    "a managed unit from another workspace cannot open the queue");
  assert.equal(await unrelated("unit-manager", "plugin.suinda-learning.write", "workspace", workspace, {
    path: reconcile, method: "POST", params: { workspaceId: workspace, checkoutId: checkout },
  }), false, "a grant on another unit cannot reconcile the payment");
});

test("multi-record routes fail closed when their targets span units", async () => {
  let provider!: (user: string, permission: string, type: string, scope: string, request: { path: string; method: string; params?: Record<string, string> }) => Promise<boolean | null>;
  const records = new Map([
    [course, { id: course, workspace_id: workspace, kind: "course", payload: { institution_unit_record_id: unit } }],
    [secondEnrollment, { id: secondEnrollment, workspace_id: workspace, kind: "enrollment", payload: { institution_unit_record_id: secondUnit } }],
    [unit, { id: unit, workspace_id: workspace, kind: "institution_unit", payload: {} }],
    [secondUnit, { id: secondUnit, workspace_id: workspace, kind: "institution_unit", payload: {} }],
  ]);
  const access = {
    registerRecordPermissionProvider() {},
    registerRequestPermissionProvider(callback: typeof provider) { provider = callback; },
    async hasScoped(_user: string, _permission: string, _scopeType: string, scopeId: string) { return scopeId === unit; },
  };
  const db = {
    async one(sql: string, args: unknown[]) {
      if (sql.includes("access_grants")) return {};
      return records.get(String(args[0])) || null;
    },
    async query(sql: string, args: unknown[]) {
      const ids = args[0] as string[];
      if (sql.startsWith("SELECT id FROM extension_records")) return ids.filter((recordId) => records.has(recordId)).map((recordId) => ({ id: recordId }));
      return ids.filter((recordId) => recordId === unit || recordId === secondUnit).map((recordId) => ({
        id: recordId, workspace_id: workspace, kind: "institution_unit", payload: {},
      }));
    },
  };
  new SuindaUnitRecordAccess(db as never, access as never).onModuleInit();
  assert.equal(await provider("user-a", "plugin.suinda-learning.manage", "workspace", workspace, {
    path: `/extensions/suinda-learning/me/enrollments/${course}/lessons/${secondEnrollment}/complete`, method: "POST",
    params: { id: course, lessonId: secondEnrollment },
  }), false);
});
