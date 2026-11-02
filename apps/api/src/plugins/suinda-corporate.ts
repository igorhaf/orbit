import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req } from "@nestjs/common";
import type { AccessRequest } from "../access/access";
import { AccessService } from "../access/access";
import { Db } from "../db";
import type { PluginDefinition, RecordKindContribution, RecordValidationContext } from "./contract";
import { PluginRegistry } from "../execution/registries";
import type { Payload } from "./records/rules";
import { SuindaLearningService } from "./suinda/suinda.service";

export const SUINDA_CORPORATE_PLUGIN_ID = "suinda-corporate";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cohortEnrollmentLock = (cohortId: string) => `corporate-cohort-public-enrollment:${cohortId}`;
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object", properties, required, additionalProperties: false,
});
const textField = { type: "string", minLength: 1, maxLength: 200 };
const refField = { type: "string", pattern: ID.source };

function issue(path: string, message: string) {
  return [{ severity: "error" as const, code: "corporate_reference_invalid", path, message }];
}
async function corporateSelfEnrollmentPolicy(payload: Record<string, unknown>, context: RecordValidationContext) {
  if (typeof payload.cohort_record_id !== "string") return [];
  const cohortId = payload.cohort_record_id;
  try {
    const active = await context.listPolicyLinkedRecords?.(SUINDA_CORPORATE_PLUGIN_ID, "corporate_cohort",
      { cohort_record_id: cohortId }, "active", 1, cohortEnrollmentLock(cohortId));
    const closed = await context.listPolicyLinkedRecords?.(SUINDA_CORPORATE_PLUGIN_ID, "corporate_cohort",
      { cohort_record_id: cohortId }, "closed", 1, cohortEnrollmentLock(cohortId));
    if (!Array.isArray(active) || !Array.isArray(closed))
      return issue("cohort_record_id", "Não foi possível verificar a modalidade da turma; tente novamente.");
    return active.length || closed.length
      ? issue("cohort_record_id", "Esta turma é corporativa e não aceita autoinscrição pública.") : [];
  } catch {
    return issue("cohort_record_id", "Não foi possível verificar a modalidade da turma; tente novamente.");
  }
}
const corporateManagerPermission = `plugin.${SUINDA_CORPORATE_PLUGIN_ID}.manage`;
const corporateRecordScope: Pick<RecordKindContribution, "resourceScoped" | "managePermission" | "authorizeRecord" | "authorizeCreate"> = {
  resourceScoped: true,
  managePermission: corporateManagerPermission,
  authorizeRecord: async (_actor, _action, _state, _payload, context) => Boolean(await context.hasWorkspacePermission?.(corporateManagerPermission)),
  authorizeCreate: async (_actor, _payload, context) => Boolean(await context.hasWorkspacePermission?.(corporateManagerPermission)),
};
async function pinned(context: RecordValidationContext, recordId: unknown, revision: unknown) {
  if (typeof recordId !== "string" || !ID.test(recordId) || !Number.isInteger(Number(revision)) || Number(revision) < 1) return null;
  return context.resolveRecord(recordId, Number(revision));
}

export const suindaCorporateRecordKinds: Record<string, RecordKindContribution> = {
  corporate_company: {
    label: "Empresa contratante", schema: schema({ legal_name: textField, display_name: textField,
      tax_id_last4: { type: "string", pattern: "^[0-9]{4}$" }, contact_reference: { type: "string", maxLength: 200 } }, ["legal_name", "display_name"]),
    initial: "active", transitions: { active: ["archived"], archived: [] }, stateLabels: { active: "Ativa", archived: "Arquivada" },
    immutable: ["legal_name", "tax_id_last4"], example: { legal_name: "Empresa Exemplo S.A.", display_name: "Empresa Exemplo" },
    uniqueFields: ["legal_name"], sensitiveFields: ["tax_id_last4", "contact_reference"], ...corporateRecordScope,
  },
  corporate_course: {
    label: "Contrato corporativo de curso", schema: schema({ company_record_id: refField, course_record_id: refField,
      course_revision: { type: "integer", minimum: 1 }, agreed_price_amount: { type: "number", minimum: 0, maximum: 10000000 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" }, contract_reference: { type: "string", maxLength: 120 } },
    ["company_record_id", "course_record_id", "course_revision", "agreed_price_amount", "currency"]),
    initial: "draft", transitions: { draft: ["active", "cancelled"], active: ["cancelled", "archived"], cancelled: [], archived: [] },
    stateLabels: { draft: "Rascunho", active: "Ativo", cancelled: "Cancelado", archived: "Arquivado" },
    immutablePayloadFieldsAfterInitial: ["company_record_id", "course_record_id", "course_revision", "agreed_price_amount", "currency"],
    example: { company_record_id: "uuid", course_record_id: "uuid", course_revision: 1, agreed_price_amount: 0, currency: "BRL" },
    uniqueFields: ["contract_reference"], ...corporateRecordScope,
    validate: async (payload, context) => {
      const company = typeof payload.company_record_id === "string" ? await context.resolveLatestRecord?.(payload.company_record_id) : null;
      if (!company || company.pluginId !== SUINDA_CORPORATE_PLUGIN_ID || company.kind !== "corporate_company" || company.state !== "active") return issue("company_record_id", "A empresa deve estar ativa neste workspace.");
      const course = await pinned(context, payload.course_record_id, payload.course_revision);
      if (!course || course.pluginId !== "suinda-learning" || course.kind !== "course" || course.state !== "enrollment_open") return issue("course_record_id", "O curso deve estar com inscrições abertas nesta revisão do Suindá.");
      const price = Number(course.payload.price_amount || 0);
      const currency = String(course.payload.currency || "BRL").toUpperCase();
      if (price !== Number(payload.agreed_price_amount) || currency !== payload.currency) return issue("agreed_price_amount", "O contrato deve refletir preço e moeda da revisão curricular selecionada.");
      return [];
    },
  },
  corporate_cohort: {
    label: "Turma corporativa", schema: schema({ corporate_course_record_id: refField, cohort_record_id: refField,
      corporate_course_revision: { type: "integer", minimum: 1 }, cohort_revision: { type: "integer", minimum: 1 }, access_mode: { type: "string", enum: ["closed_corporate"] },
      operation_reference: { type: "string", maxLength: 120 } }, ["corporate_course_record_id", "corporate_course_revision", "cohort_record_id", "cohort_revision", "access_mode"]),
    initial: "active", transitions: { active: ["closed", "archived"], closed: ["active", "archived"], archived: [] },
    stateLabels: { active: "Ativa", closed: "Encerrada", archived: "Arquivada" },
    immutablePayloadFieldsAfterInitial: ["corporate_course_record_id", "corporate_course_revision", "cohort_record_id", "cohort_revision", "access_mode"],
    example: { corporate_course_record_id: "uuid", corporate_course_revision: 2, cohort_record_id: "uuid", cohort_revision: 1, access_mode: "closed_corporate" },
    uniqueFields: ["cohort_record_id"], ...corporateRecordScope,
    validate: async (payload, context) => {
      const contract = await pinned(context, payload.corporate_course_record_id, payload.corporate_course_revision);
      if (!contract || contract.pluginId !== SUINDA_CORPORATE_PLUGIN_ID || contract.kind !== "corporate_course" || contract.state !== "active") return issue("corporate_course_record_id", "O contrato corporativo precisa estar ativo neste workspace.");
      const cohort = await pinned(context, payload.cohort_record_id, payload.cohort_revision);
      if (!cohort || cohort.pluginId !== "suinda-learning" || cohort.kind !== "cohort" || cohort.state !== "enrolling"
        || cohort.payload.course_record_id !== contract.payload.course_record_id
        || Number(cohort.payload.course_revision) !== Number(contract.payload.course_revision)) return issue("cohort_record_id", "A turma precisa corresponder ao curso e à revisão do contrato.");
      const enrollments = await context.listLatestRecords?.("suinda-learning", "enrollment",
        { cohort_record_id: cohort.id }, undefined, 1000, cohortEnrollmentLock(cohort.id));
      if (!enrollments) return issue("cohort_record_id", "Não foi possível verificar inscrições existentes; tente novamente.");
      if (enrollments.some((enrollment) => !["rejected", "withdrawn"].includes(enrollment.state)))
        return issue("cohort_record_id", "A turma já possui inscrições públicas e não pode ser convertida em turma corporativa fechada.");
      return [];
    },
  },
};

export const suindaCorporatePlugin: PluginDefinition = {
  id: SUINDA_CORPORATE_PLUGIN_ID, name: "Suindá · Contratos corporativos", version: "1.0.0",
  description: "Empresas contratantes, contratos de curso, turmas corporativas e relatórios agregados.",
  scope: "workspace", parentPlugin: "suinda-learning", dependencies: ["suinda-learning"],
  recordAccessPolicies: [{
    targetPluginId: "suinda-learning", targetKind: "enrollment",
    enforceWhenDisabled: true,
    policyReadTargets: [{ pluginId: SUINDA_CORPORATE_PLUGIN_ID, kind: "corporate_cohort" }],
    validateSelfServiceCreate: corporateSelfEnrollmentPolicy,
    validateSelfServiceSubmit: corporateSelfEnrollmentPolicy,
  }, {
    targetPluginId: "suinda-learning", targetKind: "cohort",
    enforceWhenDisabled: true,
    policyReadTargets: [{ pluginId: SUINDA_CORPORATE_PLUGIN_ID, kind: "corporate_cohort" }],
    isPubliclyAvailable: async (record, context) => {
      const active = await context.listPolicyLinkedRecords?.(SUINDA_CORPORATE_PLUGIN_ID, "corporate_cohort",
        { cohort_record_id: record.id }, "active", 1);
      const closed = await context.listPolicyLinkedRecords?.(SUINDA_CORPORATE_PLUGIN_ID, "corporate_cohort",
        { cohort_record_id: record.id }, "closed", 1);
      return Array.isArray(active) && Array.isArray(closed) && !active.length && !closed.length;
    },
  }],
  capabilities: [
    { id: "read", name: "Relatórios corporativos", permissions: [`plugin.${SUINDA_CORPORATE_PLUGIN_ID}.read`] },
    { id: "manage", name: "Administrar contratos corporativos", permissions: [`plugin.${SUINDA_CORPORATE_PLUGIN_ID}.manage`] },
  ],
  handlesRoute: (path) => /^\/extensions\/suinda-corporate\/workspaces\/[0-9a-f-]{36}\/(?:report|cohorts\/[0-9a-f-]{36}\/import)$/.test(path),
  routePermission: () => null,
  contributions: {
    navigation: [{ id: "suinda-corporate", label: "Contratos corporativos", href: "/suinda/corporate", permission: `plugin.${SUINDA_CORPORATE_PLUGIN_ID}.read`, order: 75 }],
    recordKinds: suindaCorporateRecordKinds,
  },
};

@Injectable()
export class SuindaCorporateService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly registry: PluginRegistry,
    @Inject(SuindaLearningService) private readonly learning: SuindaLearningService) {}

  async report(workspaceInput: string, user: string, cursorInput?: string, requestedLimit?: string | number) {
    if (!this.registry.isEnabled(SUINDA_CORPORATE_PLUGIN_ID)) throw new HttpException("O módulo corporativo está desativado.", 503);
    if (!ID.test(workspaceInput)) throw new HttpException("Workspace inválido.", 400);
    const limit = requestedLimit === undefined ? 50 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpException("O limite deve estar entre 1 e 100.", 400);
    let cursor: { company_name: string; course_title: string; cohort_title: string; cohort_link_id: string } | null = null;
    if (cursorInput) {
      try {
        const decoded = JSON.parse(Buffer.from(cursorInput, "base64url").toString("utf8")) as Record<string, unknown>;
        if (typeof decoded.company_name !== "string" || decoded.company_name.length > 200
          || typeof decoded.course_title !== "string" || decoded.course_title.length > 200
          || typeof decoded.cohort_title !== "string" || decoded.cohort_title.length > 200
          || typeof decoded.cohort_link_id !== "string" || !ID.test(decoded.cohort_link_id)) throw new Error("invalid cursor");
        cursor = { company_name: decoded.company_name, course_title: decoded.course_title,
          cohort_title: decoded.cohort_title, cohort_link_id: decoded.cohort_link_id };
      } catch { throw new HttpException("Cursor do relatório corporativo inválido.", 400); }
    }
    await this.access.require(user, `plugin.${SUINDA_CORPORATE_PLUGIN_ID}.read`, "workspace", workspaceInput);
    const rows = await this.db.query<{
      company_id: string; company_name: string; contract_id: string; cohort_link_id: string; cohort_id: string;
      course_id: string; course_title: string; cohort_title: string; currency: string; agreed_price_amount: string;
      enrollments: string; active: string; completed: string; withdrawn: string; distinct_learners: string; total_cohorts: string | number;
    }>(
      `WITH report_rows AS (
       SELECT company.id::text AS company_id,company.payload->>'display_name' AS company_name,
         contract.id::text AS contract_id,link.id::text AS cohort_link_id,cohort.id::text AS cohort_id,
         course.id::text AS course_id,course.title AS course_title,cohort.title AS cohort_title,
         contract.payload->>'currency' AS currency,contract.payload->>'agreed_price_amount' AS agreed_price_amount,
         COUNT(enrollment.id)::text AS enrollments,
         COUNT(enrollment.id) FILTER(WHERE enrollment.state=ANY(ARRAY['enrolled','active','paused']))::text AS active,
         COUNT(enrollment.id) FILTER(WHERE enrollment.state='completed')::text AS completed,
         COUNT(enrollment.id) FILTER(WHERE enrollment.state='withdrawn')::text AS withdrawn,
         COUNT(DISTINCT enrollment.payload->>'learner_user_id') FILTER(WHERE NULLIF(enrollment.payload->>'learner_user_id','') IS NOT NULL)::text AS distinct_learners
       FROM extension_records link
       JOIN extension_records company ON company.id::text=link.payload->>'company_record_id' AND company.workspace_id=link.workspace_id
         AND company.plugin_id=$2 AND company.kind='corporate_company' AND company.state='active'
       JOIN extension_records contract ON contract.id::text=link.payload->>'corporate_course_record_id' AND contract.workspace_id=link.workspace_id
         AND contract.plugin_id=$2 AND contract.kind='corporate_course' AND contract.state='active'
       JOIN extension_records cohort ON cohort.id::text=link.payload->>'cohort_record_id' AND cohort.workspace_id=link.workspace_id
         AND cohort.plugin_id='suinda-learning' AND cohort.kind='cohort'
       JOIN extension_records course ON course.id::text=contract.payload->>'course_record_id' AND course.workspace_id=link.workspace_id
         AND course.plugin_id='suinda-learning' AND course.kind='course'
       LEFT JOIN extension_records enrollment ON enrollment.workspace_id=link.workspace_id AND enrollment.plugin_id='suinda-learning'
         AND enrollment.kind='enrollment' AND enrollment.payload->>'cohort_record_id'=cohort.id::text
       WHERE link.workspace_id=$1 AND link.plugin_id=$2 AND link.kind='corporate_cohort' AND link.state='active'
       GROUP BY company.id,company.payload,contract.id,contract.payload,link.id,cohort.id,cohort.title,course.id,course.title
       ), counted_rows AS (
         SELECT report_rows.*,COUNT(*) OVER()::int AS total_cohorts FROM report_rows
       )
       SELECT * FROM counted_rows
       WHERE ($3::text IS NULL OR (company_name,course_title,cohort_title,cohort_link_id::uuid)>($3::text,$4::text,$5::text,$6::uuid))
       ORDER BY company_name,course_title,cohort_title,cohort_link_id::uuid LIMIT $7`,
      [workspaceInput, SUINDA_CORPORATE_PLUGIN_ID, cursor?.company_name ?? null, cursor?.course_title ?? null,
        cursor?.cohort_title ?? null, cursor?.cohort_link_id ?? null, limit + 1],
    );
    await this.access.audit(user, `${SUINDA_CORPORATE_PLUGIN_ID}.aggregate-report.read`, workspaceInput, { type: "workspace", id: workspaceInput });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ company_name: last.company_name,
      course_title: last.course_title, cohort_title: last.cohort_title, cohort_link_id: last.cohort_link_id }), "utf8").toString("base64url") : null;
    return { workspace_id: workspaceInput, generated_at: new Date().toISOString(), privacy: "aggregate_only",
      limit, total_cohorts: Number(rows[0]?.total_cohorts || 0), next_cursor: nextCursor,
      cohorts: page.map((row) => {
        const { total_cohorts, ...cohort } = row;
        void total_cohorts;
        return { ...cohort, enrollments: Number(row.enrollments), active: Number(row.active), completed: Number(row.completed),
          withdrawn: Number(row.withdrawn), distinct_learners: Number(row.distinct_learners), agreed_price_amount: Number(row.agreed_price_amount) };
      }) };
  }

  async importBatch(workspaceInput: string, cohortLinkId: string, user: string, body: Payload) {
    if (!this.registry.isEnabled(SUINDA_CORPORATE_PLUGIN_ID)) throw new HttpException("O módulo corporativo está desativado.", 503);
    if (!ID.test(workspaceInput) || !ID.test(cohortLinkId)) throw new HttpException("Workspace ou turma corporativa inválidos.", 400);
    await this.access.require(user, `plugin.${SUINDA_CORPORATE_PLUGIN_ID}.manage`, "workspace", workspaceInput);
    const link = await this.db.one<{ workspace_id: string; state: string; payload: Record<string, unknown> }>(
      "SELECT workspace_id,state,payload FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id=$3 AND kind='corporate_cohort'",
      [cohortLinkId, workspaceInput, SUINDA_CORPORATE_PLUGIN_ID],
    );
    if (!link || link.state !== "active") throw new HttpException("Turma corporativa não encontrada ou encerrada.", 404);
    return this.learning.importCorporateEnrollmentBatch(cohortLinkId, user, body);
  }
}

@Controller("extensions/suinda-corporate/workspaces/:workspaceId")
export class SuindaCorporateController {
  constructor(@Inject(SuindaCorporateService) private readonly corporate: SuindaCorporateService) {}
  @Get("report") report(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
    @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.corporate.report(workspaceId, String(req.orbitUser), cursor, limit);
  }
  @Post("cohorts/:cohortLinkId/import") importBatch(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
    @Param("cohortLinkId") cohortLinkId: string, @Body() body: Payload) {
    return this.corporate.importBatch(workspaceId, cohortLinkId, String(req.orbitUser), body);
  }
}
