import assert from "node:assert/strict";
import test from "node:test";
import type { RecordValidationContext, ResolvedRecordReference } from "./contract";
import { PluginRegistry } from "../execution/registries";
import { suindaCorporatePlugin, suindaCorporateRecordKinds, SuindaCorporateService } from "./suinda-corporate";
import { suindaPlugin } from "./suinda/suinda.plugin";
import { SuindaLearningService } from "./suinda/suinda.service";

const workspace = "00000000-0000-4000-8000-000000000101";
const companyId = "00000000-0000-4000-8000-000000000102";
const contractId = "00000000-0000-4000-8000-000000000103";
const courseId = "00000000-0000-4000-8000-000000000104";
const cohortId = "00000000-0000-4000-8000-000000000105";

test("plugin corporativo é um filho opcional e declara tipos de registro próprios", () => {
  const registry = new PluginRegistry();
  registry.register(suindaPlugin);
  registry.register(suindaCorporatePlugin);
  registry.setEnabled("suinda-learning", false);
  assert.equal(suindaCorporatePlugin.parentPlugin, "suinda-learning");
  assert.deepEqual(suindaCorporatePlugin.dependencies, ["suinda-learning"]);
  assert.equal(registry.isEnabled("suinda-corporate"), false);
  assert.deepEqual(Object.keys(suindaCorporateRecordKinds), ["corporate_company", "corporate_course", "corporate_cohort"]);
  assert.equal(suindaCorporateRecordKinds.corporate_company.sensitiveFields?.includes("tax_id_last4"), true);
});

test("contrato corporativo fixa preço, moeda, curso e revisão no mesmo workspace", async () => {
  const course: ResolvedRecordReference = { id: courseId, pluginId: "suinda-learning", kind: "course", state: "enrollment_open", revision: 4,
    payload: { price_amount: 1250, currency: "BRL" } };
  const company: ResolvedRecordReference = { id: companyId, pluginId: "suinda-corporate", kind: "corporate_company", state: "active", revision: 1, payload: {} };
  const context = { resolveRecord: async (id: string, revision: number) => id === courseId && revision === 4 ? course : id === companyId && revision === 1 ? company : null,
    resolveLatestRecord: async (id: string) => id === companyId ? company : null } as unknown as RecordValidationContext;
  const valid = await suindaCorporateRecordKinds.corporate_course.validate!({ company_record_id: companyId, course_record_id: courseId,
    course_revision: 4, agreed_price_amount: 1250, currency: "BRL" }, context);
  assert.deepEqual(valid, []);
  const alteredPrice = await suindaCorporateRecordKinds.corporate_course.validate!({ company_record_id: companyId, course_record_id: courseId,
    course_revision: 4, agreed_price_amount: 1000, currency: "BRL" }, context);
  assert.ok(alteredPrice.some((item) => item.path === "agreed_price_amount"));
  const foreignCompany = await suindaCorporateRecordKinds.corporate_course.validate!({ company_record_id: companyId, course_record_id: courseId,
    course_revision: 4, agreed_price_amount: 1250, currency: "BRL" }, { ...context, resolveLatestRecord: async () => null } as unknown as RecordValidationContext);
  assert.ok(foreignCompany.some((item) => item.path === "company_record_id"));
});

test("turma corporativa só pode vincular curso e revisão do contrato ativo", async () => {
  const contract: ResolvedRecordReference = { id: contractId, pluginId: "suinda-corporate", kind: "corporate_course", state: "active", revision: 1,
    payload: { course_record_id: courseId, course_revision: 4 } };
  const cohort: ResolvedRecordReference = { id: cohortId, pluginId: "suinda-learning", kind: "cohort", state: "enrolling", revision: 2,
    payload: { course_record_id: courseId, course_revision: 4 } };
  const context = { resolveRecord: async (id: string, revision: number) => id === contractId && revision === 1 ? contract : id === cohortId && revision === 2 ? cohort : null,
    listLatestRecords: async () => [] } as unknown as RecordValidationContext;
  const payload = { corporate_course_record_id: contractId, corporate_course_revision: 1, cohort_record_id: cohortId, cohort_revision: 2, access_mode: "closed_corporate" };
  assert.deepEqual(await suindaCorporateRecordKinds.corporate_cohort.validate!(payload, context), []);
  const mismatched = await suindaCorporateRecordKinds.corporate_cohort.validate!(payload, { ...context, resolveRecord: async (id: string, revision: number) => id === contractId ? contract : id === cohortId && revision === 2 ? { ...cohort, payload: { course_record_id: courseId, course_revision: 3 } } : null } as unknown as RecordValidationContext);
  assert.ok(mismatched.some((item) => item.path === "cohort_record_id"));
});

test("turma corporativa fechada é ocultada do catálogo público e bloqueia autoinscrição", async () => {
  const enrollmentPolicy = suindaCorporatePlugin.recordAccessPolicies?.find((item) => item.targetKind === "enrollment");
  const cohortPolicy = suindaCorporatePlugin.recordAccessPolicies?.find((item) => item.targetKind === "cohort");
  assert.ok(enrollmentPolicy?.validateSelfServiceCreate && enrollmentPolicy.validateSelfServiceSubmit && enrollmentPolicy.enforceWhenDisabled);
  assert.ok(cohortPolicy?.isPubliclyAvailable && cohortPolicy.enforceWhenDisabled);
  const listCorporateLinks = async (_plugin: string, _kind: string, _match: Record<string, string>, state?: string) => state === "active"
    ? [{ id: "link", pluginId: "suinda-corporate", kind: "corporate_cohort", state: "active", revision: 1, payload: {} }] : [];
  const context = { listPolicyLinkedRecords: listCorporateLinks } as unknown as RecordValidationContext;
  const listed = await cohortPolicy.isPubliclyAvailable({ id: cohortId, pluginId: "suinda-learning", kind: "cohort", state: "enrolling", revision: 1, payload: {} }, context);
  assert.equal(listed, false);
  const issues = await enrollmentPolicy.validateSelfServiceCreate({ cohort_record_id: cohortId }, context);
  assert.ok(issues.some((item) => item.path === "cohort_record_id"));
  const submitIssues = await enrollmentPolicy.validateSelfServiceSubmit({ cohort_record_id: cohortId }, context);
  assert.ok(submitIssues.some((item) => item.path === "cohort_record_id"));
});

test("relatório corporativo exige read no workspace e emite projeção agregada sem dados pessoais", async () => {
  const audit: unknown[][] = [];
  const queryCalls: unknown[][] = [];
  const access = { async require(...args: unknown[]) { audit.push(args); }, async audit(...args: unknown[]) { audit.push(args); } };
  const registry = { isEnabled(id: string) { return id === "suinda-corporate"; } };
  const rows = [{ company_id: companyId, company_name: "Exemplo", contract_id: contractId, cohort_link_id: "link", cohort_id: cohortId,
    course_id: courseId, course_title: "Curso", cohort_title: "Turma", currency: "BRL", agreed_price_amount: "1250",
    enrollments: "12", active: "8", completed: "2", withdrawn: "2", distinct_learners: "12", total_cohorts: 1 }];
  const db = { async query(...args: unknown[]) { queryCalls.push(args); return rows; } };
  const service = new SuindaCorporateService(db as never, access as never, registry as never, {} as never);
  const result = await service.report(workspace, "manager");
  assert.equal(audit[0][1], "plugin.suinda-corporate.read");
  assert.equal(queryCalls.length, 1);
  assert.match(String(queryCalls[0][0]), /COUNT\(DISTINCT enrollment\.payload->>'learner_user_id'\)/);
  assert.match(String(queryCalls[0][0]), /COUNT\(\*\) OVER\(\)::int AS total_cohorts/);
  assert.match(String(queryCalls[0][0]), /LIMIT \$7/);
  assert.doesNotMatch(String(queryCalls[0][0]), /users\s+u|JOIN\s+users/i);
  assert.equal(result.cohorts[0].enrollments, 12);
  assert.equal(result.cohorts[0].distinct_learners, 12);
  assert.equal(result.total_cohorts, 1);
  assert.equal(result.next_cursor, null);
  assert.equal(JSON.stringify(result).includes("email"), false);
  assert.equal(JSON.stringify(result).includes("learner_user_id"), false);
});

test("relatório corporativo pagina além de 500 vínculos com cursor composto e mantém o total agregado", async () => {
  const audit: unknown[][] = [];
  const queryCalls: unknown[][] = [];
  const access = { async require() {}, async audit(...args: unknown[]) { audit.push(args); } };
  const registry = { isEnabled(id: string) { return id === "suinda-corporate"; } };
  const rows = Array.from({ length: 51 }, (_, index) => ({
    company_id: companyId, company_name: `Empresa ${String(Math.floor(index / 10)).padStart(2, "0")}`,
    contract_id: contractId, cohort_link_id: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
    cohort_id: cohortId, course_id: courseId, course_title: `Curso ${String(Math.floor(index / 5)).padStart(2, "0")}`,
    cohort_title: `Turma ${String(index).padStart(3, "0")}`, currency: "BRL", agreed_price_amount: "1250",
    enrollments: "12", active: "8", completed: "2", withdrawn: "2", distinct_learners: "12", total_cohorts: 501,
  }));
  const db = { async query(...args: unknown[]) { queryCalls.push(args); return rows; } };
  const service = new SuindaCorporateService(db as never, access as never, registry as never, {} as never);
  const result = await service.report(workspace, "manager", undefined, 50);
  assert.equal(queryCalls.length, 1);
  assert.equal((queryCalls[0][1] as unknown[])[6], 51);
  assert.match(String(queryCalls[0][0]), /\(company_name,course_title,cohort_title,cohort_link_id::uuid\)>/);
  assert.equal(result.cohorts.length, 50);
  assert.equal(result.total_cohorts, 501);
  assert.ok(result.next_cursor);
  const cursor = JSON.parse(Buffer.from(result.next_cursor!, "base64url").toString("utf8"));
  assert.deepEqual(cursor, { company_name: result.cohorts[49].company_name, course_title: result.cohorts[49].course_title,
    cohort_title: result.cohorts[49].cohort_title, cohort_link_id: result.cohorts[49].cohort_link_id });
  assert.equal(Object.hasOwn(result.cohorts[0], "total_cohorts"), false);
  assert.equal(JSON.stringify(result).includes("learner_user_id"), false);
  const nextPage = await service.report(workspace, "manager", result.next_cursor!, 50);
  const nextParams = queryCalls[1][1] as unknown[];
  assert.deepEqual(nextParams.slice(2, 6), [cursor.company_name, cursor.course_title, cursor.cohort_title, cursor.cohort_link_id]);
  assert.equal(nextPage.cohorts.length, 50);
  assert.equal(audit.length, 2);
});

test("relatório corporativo valida cursor e limite antes de consultar", async () => {
  let queried = false;
  const service = new SuindaCorporateService({ async query() { queried = true; return []; } } as never,
    { async require() {}, async audit() {} } as never, { isEnabled() { return true; } } as never, {} as never);
  await assert.rejects(() => service.report(workspace, "manager", "not-base64-json!"), /Cursor do relatório corporativo inválido/);
  await assert.rejects(() => service.report(workspace, "manager", undefined, 101), /limite deve estar entre 1 e 100/);
  assert.equal(queried, false);
});

test("relatório corporativo recusa workspace malformado antes de consultar dados", async () => {
  let queried = false;
  const service = new SuindaCorporateService({ async query() { queried = true; return []; } } as never,
    { async require() { throw new Error("should not authorize malformed id"); } } as never,
    { isEnabled() { return true; } } as never, {} as never);
  await assert.rejects(() => service.report("bad-id", "manager"), /Workspace inválido/);
  assert.equal(queried, false);
});

function batchFixture(options: { missingAccount?: boolean; occupied?: number; unitManager?: boolean; revokeUnitGrant?: boolean } = {}) {
  const link = { id: "00000000-0000-4000-8000-000000000201", workspace_id: workspace, plugin_id: "suinda-corporate", kind: "corporate_cohort",
    title: "Turma empresa", state: "active", revision: 1, created_by: "manager", updated_by: "manager",
    payload: { corporate_course_record_id: "00000000-0000-4000-8000-000000000202", corporate_course_revision: 2,
      cohort_record_id: "00000000-0000-4000-8000-000000000203", cohort_revision: 1 } };
  const contract = { id: link.payload.corporate_course_record_id, workspace_id: workspace, plugin_id: "suinda-corporate", kind: "corporate_course",
    title: "Contrato", state: "active", revision: 2, created_by: "manager", updated_by: "manager",
    payload: { company_record_id: "00000000-0000-4000-8000-000000000204", course_record_id: "00000000-0000-4000-8000-000000000205", course_revision: 3, agreed_price_amount: 50, currency: "BRL" } };
  const cohort = { id: link.payload.cohort_record_id, workspace_id: workspace, plugin_id: "suinda-learning", kind: "cohort", title: "Turma", state: "enrolling", revision: 1, created_by: "manager", updated_by: "manager",
    payload: { course_record_id: contract.payload.course_record_id, course_revision: 3, capacity: 10, price_amount: 50,
      institution_unit_record_id: "00000000-0000-4000-8000-000000000207" } };
  const course = { id: contract.payload.course_record_id, workspace_id: workspace, plugin_id: "suinda-learning", kind: "course", title: "Curso", state: "enrollment_open", revision: 3, created_by: "manager", updated_by: "manager",
    payload: { format: "cohort", price_amount: 50, currency: "BRL" } };
  const company = { id: contract.payload.company_record_id, workspace_id: workspace, plugin_id: "suinda-corporate", kind: "corporate_company", title: "Empresa", state: "active", revision: 1, created_by: "manager", updated_by: "manager", payload: {} };
  const emails = ["a@example.test", "b@example.test"];
  const users = emails.slice(0, options.missingAccount ? 1 : 2).map((email, index) => ({ id: `00000000-0000-4000-8000-00000000020${6 + index}`,
    name: `Aluno ${index + 1}`, email, email_verified: true, disabled: false, is_root: false }));
  const inserted: Array<Record<string, unknown>> = [];
  let unitGrantChecks = 0;
  let committed = false;
  let rolledBack = false;
  const client = { async query(sql: string, params: unknown[] = []) {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("kind='corporate_cohort'")) return { rows: [link] };
    if (sql.includes("kind='corporate_course'")) return { rows: [contract] };
    if (sql.includes("kind='cohort' FOR UPDATE")) return { rows: [cohort] };
    if (sql.includes("kind='course' FOR SHARE")) return { rows: [course] };
    if (sql.includes("kind='corporate_company'")) return { rows: [company] };
    if (sql.includes("FROM users WHERE lower(email)")) return { rows: users };
    if (sql.includes("FROM access_roles")) return { rows: [{ id: "suinda_student" }] };
    if (sql.includes("kind='enrollment' AND payload->>'course_record_id'")) return { rows: [] };
    if (sql.includes("count(*)::text AS count")) return { rows: [{ count: String(options.occupied || 0) }] };
    if (sql.includes("INSERT INTO extension_records")) {
      const record = { id: `00000000-0000-4000-8000-00000000030${inserted.length}`, workspace_id: workspace, plugin_id: "suinda-learning",
        kind: "enrollment", title: params[1], state: "enrolled", revision: 1, payload: JSON.parse(String(params[2])), created_by: params[3], updated_by: params[3] };
      inserted.push(record); return { rows: [record] };
    }
    return { rows: [] };
  } };
  const service = Object.create(SuindaLearningService.prototype) as SuindaLearningService;
  Object.assign(service, {
    db: { async one() { return link; } }, access: {
      async has(user: string, permission: string) { return user === "manager" && permission === "plugin.suinda-corporate.manage"; },
      async audit() {},
    }, registry: { isEnabled() { return true; } },
    unitRecordAccess: { async canManageRecord(user: string, recordId: string) {
      unitGrantChecks++;
      return options.unitManager === true && user === "unit-manager" && recordId === cohort.id
        && (!options.revokeUnitGrant || unitGrantChecks === 1);
    } },
    assertAvailable() {}, enrollmentImportIssue() { return null; }, async payload(_client: unknown, _plugin: string, _kind: string, payload: unknown) { return payload; },
    async snapshot(_client: unknown, row: unknown) { return row; },
    async mutation(_plugin: string, _workspace: string, _user: string, _key: string, _input: unknown, callback: (transaction: never) => Promise<unknown>) {
      try { const result = await callback(client as never); committed = true; return result; }
      catch (error) { rolledBack = true; throw error; }
    },
  });
  return { service, inserted, get committed() { return committed; }, get rolledBack() { return rolledBack; },
    get unitGrantChecks() { return unitGrantChecks; }, emails };
}

test("lote corporativo cria tudo ou nada e a resposta por linha não revela PII", async () => {
  const fixture = batchFixture();
  const result = await fixture.service.importCorporateEnrollmentBatch("00000000-0000-4000-8000-000000000201", "manager", {
    operation_key: "00000000-0000-4000-8000-000000000299", csv: "email,name\na@example.test,Aluno A\nb@example.test,Aluno B",
  }) as { created_count: number; rows: Array<Record<string, unknown>> };
  assert.equal(fixture.committed, true);
  assert.equal(fixture.inserted.length, 2);
  assert.equal(result.created_count, 2);
  assert.equal(JSON.stringify(result).includes("@example.test"), false);
  assert.equal(JSON.stringify(result).includes("Aluno A"), false);
  assert.ok(fixture.inserted.every((row) => (row.payload as Record<string, unknown>).payment_status === "pending"));
});

test("gestor de unidade importa somente para a turma corporativa da unidade autorizada", async () => {
  const fixture = batchFixture({ unitManager: true });
  const result = await fixture.service.importCorporateEnrollmentBatch("00000000-0000-4000-8000-000000000201", "unit-manager", {
    operation_key: "00000000-0000-4000-8000-000000000296", csv: "email,name\na@example.test,Aluno A\nb@example.test,Aluno B",
  }) as { created_count: number };
  assert.equal(result.created_count, 2);
  assert.equal(fixture.inserted.length, 2);
  assert.equal(fixture.unitGrantChecks, 2, "o grant é conferido antes e depois de obter o lock da turma");
  assert.ok(fixture.inserted.every((row) => (row.payload as Record<string, unknown>).institution_unit_record_id === "00000000-0000-4000-8000-000000000207"));
});

test("importação corporativa não aceita gestor sem grant no workspace nem na unidade da turma", async () => {
  const fixture = batchFixture();
  await assert.rejects(() => fixture.service.importCorporateEnrollmentBatch("00000000-0000-4000-8000-000000000201", "outsider", {
    operation_key: "00000000-0000-4000-8000-000000000294", csv: "email,name\na@example.test,Aluno A\nb@example.test,Aluno B",
  }), /gestão do workspace ou da unidade efetiva da turma/);
  assert.equal(fixture.inserted.length, 0);
  assert.equal(fixture.committed, false);
});

test("importação corporativa aborta sem escrita se o grant unitário for revogado durante a transação", async () => {
  const fixture = batchFixture({ unitManager: true, revokeUnitGrant: true });
  await assert.rejects(() => fixture.service.importCorporateEnrollmentBatch("00000000-0000-4000-8000-000000000201", "unit-manager", {
    operation_key: "00000000-0000-4000-8000-000000000295", csv: "email,name\na@example.test,Aluno A\nb@example.test,Aluno B",
  }), /unidade da turma foi revogada antes da importação/);
  assert.equal(fixture.unitGrantChecks, 2);
  assert.equal(fixture.rolledBack, true);
  assert.equal(fixture.inserted.length, 0);
});

test("lote corporativo aborta antes da primeira inserção se uma conta não estiver confirmada", async () => {
  const fixture = batchFixture({ missingAccount: true });
  await assert.rejects(() => fixture.service.importCorporateEnrollmentBatch("00000000-0000-4000-8000-000000000201", "manager", {
    operation_key: "00000000-0000-4000-8000-000000000298", csv: "email,name\na@example.test,Aluno A\nb@example.test,Aluno B",
  }), /contas existentes, ativas e com e-mail confirmado/);
  assert.equal(fixture.rolledBack, true);
  assert.equal(fixture.committed, false);
  assert.equal(fixture.inserted.length, 0);
});

test("lote corporativo com capacidade insuficiente não cria matrícula parcial", async () => {
  const fixture = batchFixture({ occupied: 9 });
  await assert.rejects(() => fixture.service.importCorporateEnrollmentBatch("00000000-0000-4000-8000-000000000201", "manager", {
    operation_key: "00000000-0000-4000-8000-000000000297", csv: "email,name\na@example.test,Aluno A\nb@example.test,Aluno B",
  }), /vagas suficientes para o lote inteiro/);
  assert.equal(fixture.rolledBack, true);
  assert.equal(fixture.inserted.length, 0);
});
