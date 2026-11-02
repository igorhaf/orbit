import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { AccessService, id, type AccessRequestContext } from "../../access/access";
import { Db } from "../../db";

type AcademicRecord = { id: string; workspace_id: string; kind: string; payload: Record<string, unknown> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACADEMIC_PARENT_FIELDS = new Set([
  "announcement_record_id", "assessment_record_id", "cohort_record_id", "coupon_record_id", "course_record_id",
  "enrollment_record_id", "target_enrollment_record_id", "group_record_id", "institution_unit_record_id", "justification_record_id",
  "lesson_record_id", "makeup_request_record_id", "module_record_id", "notice_record_id", "original_session_record_id",
  "post_record_id", "program_record_id", "replacement_session_record_id", "room_record_id", "session_record_id",
  "survey_record_id", "template_record_id", "term_record_id", "thread_record_id", "unit_record_id",
]);
/** A record has one effective academic scope: prefer its closest learner/cohort/session owner over a shared course. */
const ACADEMIC_PARENT_PRIORITY = [
  "target_enrollment_record_id", "enrollment_record_id", "cohort_record_id", "session_record_id", "original_session_record_id", "replacement_session_record_id",
  "makeup_request_record_id", "justification_record_id", "assessment_record_id", "lesson_record_id", "module_record_id",
  "program_record_id", "course_record_id", "term_record_id", "unit_record_id", "room_record_id", "thread_record_id",
  "post_record_id", "group_record_id", "announcement_record_id", "notice_record_id", "survey_record_id", "coupon_record_id",
  "template_record_id",
];
const RECORD_ROUTE_PARAMS = new Set([
  "id", "recordId", "courseId", "cohortId", "enrollmentId", "targetId", "parentId", "requestId", "assessmentId",
  "sessionId", "lessonId", "practiceId", "submissionId", "threadId", "postId", "noticeId", "announcementId",
  "groupId", "programId", "couponId", "termId", "justificationId", "roomId", "makeupRequestId", "surveyId",
  "attemptId", "documentId", "applicationId", "counterpartyId", "reportId", "connectionId", "providerSessionId",
]);

/** Only routes whose operation is bounded by the records named in the path may use a unit grant. */
const UNIT_SCOPED_TARGET_ROUTES: Array<{ methods: Set<string>; path: RegExp }> = [
  { methods: new Set(["GET"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/accessibility-audit\/courses\/?$/i },
  { methods: new Set(["GET"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/accessibility-audit\/courses\/[0-9a-f-]{36}\/lessons\/?$/i },
  { methods: new Set(["POST"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/community-reports\/[0-9a-f-]{36}\/(?:dismiss|remove)\/?$/i },
  { methods: new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: /^\/extensions\/suinda-learning\/me\/enrollments\/[0-9a-f-]+(?:\/(?:[a-z0-9-]+|[0-9a-f-]+)){0,8}\/?$/i },
  { methods: new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/sessions\/[0-9a-f-]+(?:\/(?:attendance(?:\/(?:zoom-sync|[a-z-]+-sync))?|meeting-room(?:\/reconcile)?|checkin-code))?\/?$/i },
  { methods: new Set(["GET", "POST"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]+\/materials\/?$/i },
  { methods: new Set(["POST"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/(?:submissions\/[0-9a-f-]+\/grade|assessment-attempts\/[0-9a-f-]+\/grade|practices\/[0-9a-f-]+\/review|documents\/[0-9a-f-]+\/review|attendance-justifications\/[0-9a-f-]+\/review|makeup-requests\/[0-9a-f-]+\/fee|scholarship-applications\/[0-9a-f-]+\/review|scholarship-counterparties\/[0-9a-f-]+\/(?:review|submission)|community\/threads\/[0-9a-f-]+\/(?:pin|unpin)|enrollments\/[0-9a-f-]+\/(?:payments|refunds|financial-cancellations|transfer))\/?$/i },
  { methods: new Set(["POST"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/cohorts\/[0-9a-f-]+\/(?:import(?:\/preview)?|announcements)\/?$/i },
  { methods: new Set(["GET"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/cohorts\/[0-9a-f-]+\/announcement-templates\/?$/i },
  { methods: new Set(["POST"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]+\/materials\/[0-9a-f-]+\/alt-text\/?$/i },
  { methods: new Set(["POST"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]+\/accessibility\/?$/i },
  { methods: new Set(["POST"]), path: /^\/extensions\/suinda-learning\/me\/teaching\/lessons\/[0-9a-f-]+\/transcription(?:\/apply)?\/?$/i },
  { methods: new Set(["GET"]), path: /^\/extensions\/suinda-learning\/(?:staff-credentials|scholarship-counterparties)\/[0-9a-f-]+\/files\/[0-9a-f-]+\/?$/i },
  { methods: new Set(["POST"]), path: /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]+\/practice-credit-requests\/[0-9a-f-]+\/review\/?$/i },
  { methods: new Set(["GET"]), path: /^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]+\/practice-credit-requests\/?$/i },
  { methods: new Set(["POST", "DELETE"]), path: /^\/extensions\/suinda-learning\/me\/favorites\/[0-9a-f-]+\/?$/i },
];
const UNIT_SCOPED_TEACHING_QUEUES = new Set([
  "/extensions/suinda-learning/me/teaching/scholarship-counterparties",
  "/extensions/suinda-learning/me/teaching/scholarship-applications",
  "/extensions/suinda-learning/me/teaching/financial-action-queue",
  "/extensions/suinda-learning/me/teaching/unit-operations/assessment",
  "/extensions/suinda-learning/me/teaching/unit-operations/document",
  "/extensions/suinda-learning/me/teaching/unit-operations/risk",
  "/extensions/suinda-learning/me/teaching/unit-operations/capacity",
]);
const UNIT_SCOPED_REPORT_ROUTES = new Set([
  "/extensions/suinda-learning/me/reports",
  "/extensions/suinda-learning/me/reports.pdf",
  "/extensions/suinda-learning/me/finance-ledger.csv",
]);
const UNIT_SCOPED_TEACHING_DASHBOARD = "/extensions/suinda-learning/me/teaching";

/** Child policy: resolve academic record ancestry and check the grant on the exact unit. */
@Injectable()
export class SuindaUnitRecordAccess implements OnModuleInit {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService) {}

  async authorizedUnits(user: string) {
    const candidates = await this.db.query<{ workspace_id: string; id: string }>(
      `SELECT DISTINCT r.workspace_id,r.id FROM extension_records r
       JOIN workspaces w ON w.id=r.workspace_id AND w.archived_at IS NULL
       JOIN access_grants g ON g.scope_type='extension_record' AND g.scope_id=r.id::text AND g.user_id=$1
       JOIN access_roles role ON role.id=g.role_id
       WHERE r.plugin_id='suinda-learning' AND r.kind='institution_unit'
         AND r.state=ANY(ARRAY['published','archived'])
         AND role.permissions && ARRAY['plugin.suinda-learning.manage','plugin.suinda-learning.read']::text[]
       ORDER BY r.workspace_id,r.id`, [user],
    );
    const allowed: Array<{ workspace_id: string; id: string }> = [];
    // Keep authorization I/O bounded without silently dropping legitimate grants in large institutions.
    for (let offset = 0; offset < candidates.length; offset += 100) {
      const batch = candidates.slice(offset, offset + 100);
      const decisions = await Promise.all(batch.map(async (unit) =>
        await this.access.hasScoped(user, "plugin.suinda-learning.read", "extension_record", unit.id)
          || await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id) ? unit : null,
      ));
      for (const unit of decisions) if (unit) allowed.push(unit);
    }
    return allowed;
  }

  async canManageRecord(user: string, recordId: string) {
    return await this.authorizeRecords(user, [id(recordId)], "plugin.suinda-learning.manage") === true;
  }

  async canManageAnyUnitRecord(user: string, recordId: string) {
    return await this.authorizeRecords(user, [id(recordId)], "plugin.suinda-learning.manage", true) === true;
  }

  async canReadRecord(user: string, recordId: string) {
    return await this.authorizeRecords(user, [id(recordId)], "plugin.suinda-learning.read") === true;
  }

  onModuleInit() {
    this.access.registerRecordPermissionProvider(async (user, plugin, _kind, recordId, action) => {
      if (plugin !== "suinda-learning") return null;
      const permission = action === "read" ? "plugin.suinda-learning.read" : "plugin.suinda-learning.manage";
      return this.authorizeRecords(user, [recordId], permission);
    });
    this.access.registerRequestPermissionProvider(async (user, permission, type, workspace, request) => {
      if (type !== "workspace" || !permission.startsWith("plugin.suinda-learning.") || !request.path.startsWith("/extensions/suinda-learning/")) return null;
      const path = request.path.split("?")[0].replace(/\/+$/, "") || "/";
      const staffCollection = path.match(/^\/extensions\/suinda-learning\/workspaces\/([0-9a-f-]{36})\/staff-(?:credentials|directory)$/i);
      const staffCredentialFile = path.match(/^\/extensions\/suinda-learning\/staff-credentials\/([0-9a-f-]{36})\/files\/[0-9a-f-]{36}$/i);
      if (request.method.toUpperCase() === "GET" && (staffCollection || staffCredentialFile)) {
        const credential = staffCredentialFile ? await this.db.one<{ workspace_id: string }>(
          "SELECT workspace_id FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning' AND kind='staff_credential' AND state<>'archived'",
          [id(staffCredentialFile[1])],
        ) : null;
        if (staffCredentialFile && !credential) return null;
        const targetWorkspace = staffCollection ? id(staffCollection[1]) : id(credential!.workspace_id);
        const units = (await this.authorizedUnits(user)).filter((unit) => unit.workspace_id === targetWorkspace);
        for (const unit of units)
          if (await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        return null;
      }
      const surveyResults = path.match(/^\/extensions\/suinda-learning\/me\/teaching\/surveys\/([0-9a-f-]{36})\/results$/i);
      const teachingSurveys = path === "/extensions/suinda-learning/me/teaching/surveys";
      if (request.method.toUpperCase() === "GET" && (surveyResults || teachingSurveys)) {
        const targetWorkspace = surveyResults
          ? (await this.db.one<{ workspace_id: string }>(
            "SELECT workspace_id FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning' AND kind='survey'",
            [id(surveyResults[1])],
          ))?.workspace_id
          : undefined;
        if (surveyResults && !targetWorkspace) return null;
        const units = (await this.authorizedUnits(user)).filter((unit) => !targetWorkspace || unit.workspace_id === targetWorkspace);
        for (const unit of units)
          if (await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        return null;
      }
      const teachingCommunityReports = path === "/extensions/suinda-learning/me/teaching/community-reports";
      if (request.method.toUpperCase() === "GET" && teachingCommunityReports) {
        const units = await this.authorizedUnits(user);
        for (const unit of units)
          if (await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        return null;
      }
      const teachingCommunityCourse = path.match(/^\/extensions\/suinda-learning\/me\/teaching\/courses\/([0-9a-f-]{36})\/community\/?$/i);
      if (request.method.toUpperCase() === "GET" && teachingCommunityCourse) {
        const course = await this.db.one<{ workspace_id: string }>(
          "SELECT workspace_id FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning' AND kind='course'",
          [id(teachingCommunityCourse[1])],
        );
        if (!course) return null;
        const units = (await this.authorizedUnits(user)).filter((unit) => unit.workspace_id === course.workspace_id);
        for (const unit of units)
          if (await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        return null;
      }
      if (request.method.toUpperCase() === "GET" && UNIT_SCOPED_TEACHING_QUEUES.has(path)) {
        // These paginated services resolve the full managed-unit scope and apply it in SQL
        // before projecting each queue item. This provider only allows the request through.
        const units = await this.authorizedUnits(user);
        for (const unit of units)
          if (await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        return null;
      }
      if (request.method.toUpperCase() === "GET" && UNIT_SCOPED_REPORT_ROUTES.has(path)) {
        // Reporting/export services independently authorize and filter every requested unit.
        const units = await this.authorizedUnits(user);
        for (const unit of units) {
          if (await this.access.hasScoped(user, "plugin.suinda-learning.read", "extension_record", unit.id)
            || await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        }
        return null;
      }
      if (request.method.toUpperCase() === "GET" && path === UNIT_SCOPED_TEACHING_DASHBOARD) {
        // The dashboard service scopes its records and administrative projections to these unit grants.
        const units = await this.authorizedUnits(user);
        for (const unit of units) {
          if (await this.access.hasScoped(user, "plugin.suinda-learning.read", "extension_record", unit.id)
            || await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        }
        return null;
      }
      const accessibilityAuditCourse = path.match(/^\/extensions\/suinda-learning\/me\/teaching\/accessibility-audit\/courses\/([0-9a-f-]{36})\/lessons$/i);
      const accessibilityAuditCollection = path === "/extensions/suinda-learning/me/teaching/accessibility-audit/courses";
      if (request.method.toUpperCase() === "GET" && (accessibilityAuditCourse || accessibilityAuditCollection)) {
        if (accessibilityAuditCourse) {
          const courseId = id(accessibilityAuditCourse[1]);
          const course = await this.db.one<{ workspace_id: string }>(
            "SELECT workspace_id FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning' AND kind='course'",
            [courseId],
          );
          if (!course) return null;
          const cohorts = await this.db.query<{ id: string }>(
            `SELECT id FROM extension_records WHERE workspace_id=$1 AND plugin_id='suinda-learning' AND kind='cohort'
             AND payload->>'course_record_id'=$2 AND state NOT IN ('archived','canceled') ORDER BY id`, [course.workspace_id, courseId],
          );
          for (const recordId of [courseId, ...cohorts.map((cohort) => cohort.id)]) {
            if (await this.authorizeRecords(user, [recordId], "plugin.suinda-learning.read", true)
              || await this.authorizeRecords(user, [recordId], "plugin.suinda-learning.manage", true)) return true;
          }
          return null;
        }
        let after: string | null = null;
        while (true) {
          const candidates: Array<{ id: string }> = await this.db.query<{ id: string }>(
            `SELECT DISTINCT r.id FROM extension_records r
             JOIN access_grants g ON g.scope_type='extension_record' AND g.scope_id=r.id::text AND g.user_id=$1
             WHERE r.plugin_id='suinda-learning' AND r.kind='institution_unit'
               AND r.state=ANY(ARRAY['published','archived']) AND ($2::uuid IS NULL OR r.id>$2::uuid)
             ORDER BY r.id LIMIT 250`, [user, after],
          );
          if (!candidates.length) return null;
          for (const candidate of candidates) {
            after = candidate.id;
            if (await this.access.hasScoped(user, "plugin.suinda-learning.read", "extension_record", candidate.id)
              || await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", candidate.id)) return true;
          }
          if (candidates.length < 250) return null;
        }
      }
      const staffHonorariaCollection = path.match(/^\/extensions\/suinda-learning\/workspaces\/([0-9a-f-]{36})\/staff-honoraria$/i);
      const staffHonorariumPayment = path.match(/^\/extensions\/suinda-learning\/workspaces\/([0-9a-f-]{36})\/staff-honoraria\/([0-9a-f-]{36})\/payments$/i);
      if (staffHonorariaCollection && ["GET", "POST"].includes(request.method.toUpperCase())) {
        const units = (await this.authorizedUnits(user)).filter((unit) => unit.workspace_id === id(staffHonorariaCollection[1]));
        for (const unit of units)
          if (await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        return null;
      }
      if (staffHonorariumPayment && request.method.toUpperCase() === "POST") {
        const honorarium = await this.db.one<{ institution_unit_record_id: string | null }>(
          "SELECT institution_unit_record_id FROM suinda_staff_honorarium_ledger WHERE id=$1 AND workspace_id=$2",
          [id(staffHonorariumPayment[2]), id(staffHonorariumPayment[1])],
        );
        if (!honorarium?.institution_unit_record_id) return null;
        return await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", honorarium.institution_unit_record_id) ? true : null;
      }
      const paymentReviewCollection = path.match(/^\/extensions\/suinda-learning\/workspaces\/([0-9a-f-]{36})\/payment-reviews\/?$/i);
      if (paymentReviewCollection && request.method.toUpperCase() === "GET") {
        const units = (await this.authorizedUnits(user)).filter((unit) => unit.workspace_id === id(paymentReviewCollection[1]));
        for (const unit of units)
          if (await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        return null;
      }
      const paymentReviewReconcile = path.match(/^\/extensions\/suinda-learning\/workspaces\/([0-9a-f-]{36})\/payment-reviews\/([0-9a-f-]{36})\/reconcile\/?$/i);
      if (paymentReviewReconcile && request.method.toUpperCase() === "POST") {
        const checkout = await this.db.one<{ enrollment_id: string }>(
          "SELECT enrollment_id FROM suinda_payment_checkouts WHERE id=$1 AND workspace_id=$2",
          [id(paymentReviewReconcile[2]), id(paymentReviewReconcile[1])],
        );
        if (!checkout) return null;
        return this.authorizeRecords(user, [checkout.enrollment_id], "plugin.suinda-learning.manage");
      }
      const duplicateCourse = path.match(/^\/extensions\/suinda-learning\/courses\/([0-9a-f-]{36})\/duplicate$/i);
      const reorderCurriculum = path.match(/^\/extensions\/suinda-learning\/curriculum\/(course|module|learning_unit)\/([0-9a-f-]{36})\/reorder$/i);
      if (request.method.toUpperCase() === "POST" && (duplicateCourse || reorderCurriculum)) {
        const parent = duplicateCourse
          ? await this.db.one<{ workspace_id: string; course_id: string }>(
            `SELECT workspace_id,id AS course_id FROM extension_records
             WHERE id=$1 AND plugin_id='suinda-learning' AND kind='course'`, [id(duplicateCourse[1])],
          )
          : await this.db.one<{ workspace_id: string; course_id: string }>(
            `SELECT p.workspace_id,CASE WHEN p.kind='course' THEN p.id::text
               WHEN p.kind='module' THEN p.payload->>'course_record_id' ELSE m.payload->>'course_record_id' END AS course_id
             FROM extension_records p LEFT JOIN extension_records m ON m.id::text=p.payload->>'module_record_id'
               AND m.workspace_id=p.workspace_id AND m.plugin_id='suinda-learning' AND m.kind='module'
             WHERE p.id=$1 AND p.plugin_id='suinda-learning' AND p.kind=$2 AND p.state<>'archived'`,
            [id(reorderCurriculum![2]), reorderCurriculum![1]],
          );
        if (!parent?.course_id) return null;
        const course = await this.db.one<{ id: string }>(
          "SELECT id FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id='suinda-learning' AND kind='course'",
          [id(parent.course_id), id(parent.workspace_id)],
        );
        if (!course) return null;
        return this.authorizeCourseUnits(user, course.id, parent.workspace_id);
      }
      if (!UNIT_SCOPED_TARGET_ROUTES.some((route) => route.methods.has(request.method.toUpperCase()) && route.path.test(path))) return null;
      const action = permission === "plugin.suinda-learning.read" ? "read" :
        ["plugin.suinda-learning.write", "plugin.suinda-learning.publish", "plugin.suinda-learning.manage"].includes(permission) ? "manage" : null;
      if (!action) return null;
      if (/^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]+\/practice-credit-requests\/?$/i.test(path)) {
        const units = (await this.authorizedUnits(user)).filter((unit) => unit.workspace_id === id(workspace));
        for (const unit of units)
          if (await this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)) return true;
        return null;
      }
      const creditRequest = path.match(/^\/extensions\/suinda-learning\/workspaces\/[0-9a-f-]+\/practice-credit-requests\/([0-9a-f-]+)\/review\/?$/i);
      if (creditRequest) {
        const row = await this.db.one<{ source_enrollment_id: string; target_enrollment_id: string }>(
          "SELECT source_enrollment_id::text,target_enrollment_id::text FROM suinda_practice_credit_requests WHERE id=$1 AND workspace_id=$2",
          [id(creditRequest[1]), id(workspace)],
        );
        if (!row) return null;
        return this.authorizeRecords(user, [row.source_enrollment_id, row.target_enrollment_id], "plugin.suinda-learning.manage");
      }
      const recordIds = await this.requestRecordIds(request, workspace);
      if (!recordIds.length) return null;
      return this.authorizeRecords(user, recordIds, action === "read" ? "plugin.suinda-learning.read" : "plugin.suinda-learning.manage");
    });
  }

  private async requestRecordIds(request: AccessRequestContext, workspace: string) {
    const candidates = new Set<string>();
    if (!request.params) return [];
    for (const [key, value] of Object.entries(request.params))
      if (RECORD_ROUTE_PARAMS.has(key) && UUID.test(value) && value.toLowerCase() !== workspace.toLowerCase()) candidates.add(value);
    if (!candidates.size) return [];
    const rows = await this.db.query<{ id: string }>(
      "SELECT id FROM extension_records WHERE id=ANY($1::uuid[]) AND workspace_id=$2 AND plugin_id='suinda-learning'",
      [[...candidates], id(workspace)],
    );
    return rows.map(({ id: recordId }) => recordId);
  }

  private async authorizeCourseUnits(user: string, courseId: string, workspaceId: string) {
    const units = await this.db.query<{ id: string }>(
      `WITH course_units AS (
         SELECT NULLIF(c.payload->>'institution_unit_record_id','') AS unit_id
         FROM extension_records c
         WHERE c.id=$1 AND c.workspace_id=$2 AND c.plugin_id='suinda-learning' AND c.kind='course'
         UNION
         SELECT COALESCE(NULLIF(co.payload->>'institution_unit_record_id',''),
           NULLIF(c.payload->>'institution_unit_record_id','')) AS unit_id
         FROM extension_records c JOIN extension_records co ON co.workspace_id=c.workspace_id
           AND co.plugin_id='suinda-learning' AND co.kind='cohort' AND co.payload->>'course_record_id'=c.id::text
         WHERE c.id=$1 AND c.workspace_id=$2 AND c.plugin_id='suinda-learning' AND c.kind='course'
           AND co.state NOT IN ('archived','canceled')
       )
       SELECT DISTINCT u.id FROM course_units s JOIN extension_records u ON u.id::text=s.unit_id
         AND u.workspace_id=$2 AND u.plugin_id='suinda-learning' AND u.kind='institution_unit'
         AND u.state=ANY(ARRAY['published','archived']) ORDER BY u.id`, [courseId, workspaceId],
    );
    if (!units.length) return null;
    const grants = await Promise.all(units.map((unit) =>
      this.access.hasScoped(user, "plugin.suinda-learning.manage", "extension_record", unit.id)));
    return grants.every(Boolean) ? true : null;
  }

  private async authorizeRecords(user: string, recordIds: string[], permission: string, anyUnit = false) {
    let foundGrant = false;
    let uncoveredRecord = false;
    for (const recordId of recordIds) {
      const unitIds = await this.unitAncestors(recordId);
      if (!unitIds.length) { uncoveredRecord = true; continue; }
      let recordHasGrant = false;
      let authorized = false;
      let allAuthorized = true;
      for (const unitId of unitIds) {
        const grant = await this.db.one("SELECT 1 FROM access_grants WHERE user_id=$1 AND scope_type='extension_record' AND scope_id=$2 LIMIT 1", [user, unitId]);
        if (!grant) { allAuthorized = false; continue; }
        recordHasGrant = true;
        foundGrant = true;
        if (await this.access.hasScoped(user, permission, "extension_record", unitId)) authorized = true;
        else allAuthorized = false;
      }
      if (permission === "plugin.suinda-learning.manage" && !anyUnit && unitIds.length > 1 && !allAuthorized) return false;
      if (recordHasGrant && !authorized) return false;
      if (!recordHasGrant) uncoveredRecord = true;
    }
    if (foundGrant && uncoveredRecord) return false;
    return foundGrant ? true : null;
  }

  private async unitAncestors(recordId: string): Promise<string[]> {
    const initial = await this.db.one<AcademicRecord>(
      "SELECT id,workspace_id,kind,payload FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning'",
      [id(recordId)],
    );
    if (!initial) return [];
    if (initial.kind === "community_report") {
      const targetEnrollment = await this.communityReportTargetEnrollment(initial.id);
      return targetEnrollment ? this.unitAncestors(targetEnrollment) : [];
    }
    if (initial.kind === "lesson") {
      const moduleRecordId = initial.payload.module_record_id;
      if (typeof moduleRecordId !== "string" || !UUID.test(moduleRecordId)) return [];
      const module = await this.db.one<AcademicRecord>(
        "SELECT id,workspace_id,kind,payload FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id='suinda-learning' AND kind='module'",
        [id(moduleRecordId), initial.workspace_id],
      );
      if (!module) return [];
      const revision = Number(module.payload.course_revision);
      const courseRecordId = module.payload.course_record_id;
      if (!Number.isInteger(revision) || revision < 1 || typeof courseRecordId !== "string" || !UUID.test(courseRecordId)) return [];
      const units = await this.db.query<{ id: string }>(
        `WITH effective_units AS (
           SELECT NULLIF(c.payload->>'institution_unit_record_id','') AS unit_id
           FROM extension_records c
           WHERE c.id=$1 AND c.workspace_id=$2 AND c.plugin_id='suinda-learning' AND c.kind='course'
           UNION
           SELECT COALESCE(NULLIF(co.payload->>'institution_unit_record_id',''),
             NULLIF(c.payload->>'institution_unit_record_id','')) AS unit_id
           FROM extension_records c JOIN extension_records co ON co.workspace_id=c.workspace_id
             AND co.plugin_id='suinda-learning' AND co.kind='cohort' AND co.payload->>'course_record_id'=c.id::text
             AND co.payload->>'course_revision'=$3::text
           WHERE c.id=$1 AND c.workspace_id=$2 AND c.plugin_id='suinda-learning' AND c.kind='course'
             AND co.state NOT IN ('archived','canceled')
         )
         SELECT DISTINCT u.id::text AS id FROM effective_units e
         JOIN extension_records u ON u.id::text=e.unit_id AND u.workspace_id=$2
           AND u.plugin_id='suinda-learning' AND u.kind='institution_unit'
           AND u.state=ANY(ARRAY['published','archived']) ORDER BY u.id`,
        [id(courseRecordId), initial.workspace_id, revision],
      );
      return units.map((unit) => unit.id);
    }
    const seen = new Set<string>([initial.id]);
    let current = initial;
    for (let depth = 0; depth < 7; depth++) {
      if (current.kind === "institution_unit") return [current.id];
      const explicitUnit = current.payload.institution_unit_record_id;
      if (typeof explicitUnit === "string" && UUID.test(explicitUnit)) {
        const unit = await this.db.one<{ id: string }>(
          "SELECT id FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id='suinda-learning' AND kind='institution_unit'",
          [id(explicitUnit), initial.workspace_id],
        );
        return unit ? [unit.id] : [];
      }
      const parentField = ACADEMIC_PARENT_PRIORITY.find((field) => {
        const value = current.payload[field];
        return ACADEMIC_PARENT_FIELDS.has(field) && typeof value === "string" && UUID.test(value) && !seen.has(value);
      });
      const parentId = parentField ? current.payload[parentField] as string : null;
      if (!parentId) return [];
      const related = await this.db.query<AcademicRecord>(
        "SELECT id,workspace_id,kind,payload FROM extension_records WHERE id=ANY($1::uuid[]) AND workspace_id=$2 AND plugin_id='suinda-learning'",
        [[parentId], initial.workspace_id],
      );
      current = related[0]!;
      if (!current) return [];
      seen.add(current.id);
    }
    return [];
  }

  private async communityReportTargetEnrollment(reportId: string) {
    const target = await this.db.one<{ id: string }>(
      `SELECT enrollment.id::text AS id
       FROM extension_records report
       JOIN extension_records content ON content.id::text=report.payload->>'target_record_id'
         AND content.workspace_id=report.workspace_id AND content.plugin_id='suinda-learning'
         AND content.kind=report.payload->>'target_kind'
       LEFT JOIN extension_records thread ON content.kind='discussion_reply'
         AND thread.id::text=content.payload->>'thread_record_id' AND thread.workspace_id=content.workspace_id
         AND thread.plugin_id='suinda-learning' AND thread.kind='discussion_thread'
       JOIN extension_records enrollment ON enrollment.id::text=COALESCE(
         NULLIF(content.payload->>'enrollment_record_id',''),NULLIF(thread.payload->>'enrollment_record_id',''),
         NULLIF(report.payload->>'target_enrollment_record_id',''))
         AND enrollment.workspace_id=report.workspace_id AND enrollment.plugin_id='suinda-learning' AND enrollment.kind='enrollment'
         AND enrollment.payload->>'course_record_id'=report.payload->>'course_record_id'
         AND enrollment.payload->>'course_revision'=report.payload->>'course_revision'
       WHERE report.id=$1 AND report.plugin_id='suinda-learning' AND report.kind='community_report'`,
      [id(reportId)],
    );
    return target?.id || null;
  }
}
