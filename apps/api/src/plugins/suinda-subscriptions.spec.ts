import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type { RecordValidationContext } from "./contract";
import { PluginRegistry } from "../execution/registries";
import { SUINDA_SUBSCRIPTIONS_PLUGIN_ID, SuindaSubscriptionsService, subscriptionAvailableModules, subscriptionTransition, suindaSubscriptionRecordKinds, suindaSubscriptionsPlugin, validateSubscriptionPlan } from "./suinda-subscriptions";

const workspaceId = "00000000-0000-4000-8000-000000000101";
const planId = "00000000-0000-4000-8000-000000000102";
const courseId = "00000000-0000-4000-8000-000000000103";

test("plugin filho declara somente suas rotas, permissões e registros de assinatura", () => {
  const registry = new PluginRegistry();
  registry.register({ id: "suinda-learning", name: "Suindá", version: "1.0.0" });
  registry.register(suindaSubscriptionsPlugin);
  assert.equal(suindaSubscriptionsPlugin.parentPlugin, "suinda-learning");
  assert.deepEqual(suindaSubscriptionsPlugin.dependencies, ["suinda-learning"]);
  assert.equal(registry.getById(SUINDA_SUBSCRIPTIONS_PLUGIN_ID).id, "suinda-subscriptions");
  assert.equal(suindaSubscriptionsPlugin.handlesRoute?.(`/extensions/suinda-subscriptions/workspaces/${workspaceId}/plans`), true);
  assert.equal(suindaSubscriptionsPlugin.handlesRoute?.(`/extensions/suinda-subscriptions/workspaces/${workspaceId}/content/${courseId}`), true);
  assert.equal(suindaSubscriptionsPlugin.handlesRoute?.(`/extensions/suinda-subscriptions/workspaces/${workspaceId}/subscriptions/${planId}/lessons/${courseId}/complete`), true);
  assert.equal(suindaSubscriptionsPlugin.handlesRoute?.("/extensions/suinda-learning/me/learning"), false);
  assert.equal(suindaSubscriptionsPlugin.routePermission?.("/extensions/suinda-subscriptions/me/subscriptions", "GET"), null);
  assert.deepEqual(Object.keys(suindaSubscriptionRecordKinds).sort(), ["subscription", "subscription_plan"]);
});

test("planos exigem um snapshot válido e limitado de preço, recorrência e cursos", () => {
  assert.deepEqual(validateSubscriptionPlan({ name: "Plano anual", billing_interval: "year", price_amount: 120, currency: "brl", course_record_ids: [courseId] }), {
    name: "Plano anual", billing_interval: "year", price_amount: 120, currency: "BRL", course_record_ids: [courseId],
  });
  for (const patch of [
    { billing_interval: "weekly" }, { price_amount: -1 }, { price_amount: 12.345 }, { currency: "BR" },
    { course_record_ids: [] }, { course_record_ids: [courseId, courseId] }, { name: "  " },
  ]) assert.throws(() => validateSubscriptionPlan({ name: "Plano", billing_interval: "month", price_amount: 10, currency: "BRL", course_record_ids: [courseId], ...patch }));
  const definition = suindaSubscriptionRecordKinds.subscription_plan;
  assert.equal(definition.initial, "draft");
  assert.deepEqual(definition.transitions.draft, ["published", "archived"]);
  assert.equal(definition.immutablePayloadFieldsAfterInitial?.includes("course_record_ids"), true);
});

test("validação de plano aceita apenas cursos Suindá encontrados no workspace atual", async () => {
  const validate = suindaSubscriptionRecordKinds.subscription_plan.validate!;
  const payload = { name: "Plano", billing_interval: "month", price_amount: 25, currency: "BRL", course_record_ids: [courseId] };
  const valid = await validate(payload, { async resolveLatestRecord(id: string) {
    return id === courseId ? { id, pluginId: "suinda-learning", kind: "course", state: "enrollment_open", revision: 1, payload: {} } : null;
  } } as unknown as RecordValidationContext);
  assert.deepEqual(valid, []);
  const outsideWorkspace = await validate(payload, { async resolveLatestRecord() { return null; } } as unknown as RecordValidationContext);
  assert.ok(outsideWorkspace.some((issue) => issue.path === "course_record_ids"));
  const wrongDomain = await validate(payload, { async resolveLatestRecord(id: string) {
    return { id, pluginId: "suinda-learning", kind: "lesson", state: "published", revision: 1, payload: {} };
  } } as unknown as RecordValidationContext);
  assert.ok(wrongDomain.some((issue) => issue.path === "course_record_ids"));
});

test("estados não permitem ativação por aluno nem reativação de assinatura cancelada", () => {
  assert.deepEqual(subscriptionTransition("pending_payment", "active"), { from: "pending_payment", to: "active" });
  assert.deepEqual(subscriptionTransition("active", "canceled"), { from: "active", to: "canceled" });
  assert.throws(() => subscriptionTransition("canceled", "active"), (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  assert.throws(() => subscriptionTransition("pending_payment", "expired"), (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
});

test("leitor não revela módulos/aulas bloqueados por pré-requisitos, sequência ou data", () => {
  const moduleA = { id: "module-a", title: "A", state: "published", revision: 1,
    payload: { position: 1, sequential: true, prerequisite_module_ids: [] } };
  const moduleB = { id: "module-b", title: "B", state: "published", revision: 1,
    payload: { position: 2, prerequisite_module_ids: ["module-a"] } };
  const lessons = [
    { id: "lesson-a1", module_record_id: "module-a", title: "A1", state: "published", revision: 1, payload: { position: 1, required: true } },
    { id: "lesson-a2", module_record_id: "module-a", title: "A2", state: "published", revision: 1, payload: { position: 2, required: true, prerequisites: ["lesson-a1"] } },
    { id: "lesson-b1", module_record_id: "module-b", title: "B1", state: "published", revision: 1, payload: { position: 1, required: true } },
    { id: "lesson-future", module_record_id: "module-a", title: "Futuro", state: "published", revision: 1, payload: { position: 3, required: false, release_at: "2035-01-01T00:00:00.000Z" } },
  ];
  const initiallyAvailable = subscriptionAvailableModules([moduleA, moduleB], lessons, new Set(), Date.parse("2030-01-01T00:00:00Z"));
  assert.deepEqual(initiallyAvailable.map((module) => module.id), ["module-a"]);
  assert.deepEqual(initiallyAvailable[0].lessons.map((lesson) => lesson.id), ["lesson-a1"]);
  const afterFirst = subscriptionAvailableModules([moduleA, moduleB], lessons, new Set(["lesson-a1"]), Date.parse("2030-01-01T00:00:00Z"));
  assert.deepEqual(afterFirst[0].lessons.map((lesson) => lesson.id), ["lesson-a1", "lesson-a2"]);
  assert.deepEqual(afterFirst.map((module) => module.id), ["module-a"]);
  const afterModule = subscriptionAvailableModules([moduleA, moduleB], lessons, new Set(["lesson-a1", "lesson-a2"]), Date.parse("2030-01-01T00:00:00Z"));
  assert.deepEqual(afterModule.map((module) => module.id), ["module-a", "module-b"]);
  assert.equal(JSON.stringify(afterModule).includes("lesson-future"), false);
  const cycle = subscriptionAvailableModules([
    { ...moduleA, payload: { position: 1, prerequisite_module_ids: ["module-b"] } },
    { ...moduleB, payload: { position: 2, prerequisite_module_ids: ["module-a"] } },
  ], lessons, new Set());
  assert.deepEqual(cycle, []);
});

test("módulo desligado falha fechado antes de consultar dados", async () => {
  let queryCount = 0;
  const registry = { isEnabled(id: string) { return id !== SUINDA_SUBSCRIPTIONS_PLUGIN_ID; } };
  const service = new SuindaSubscriptionsService({ async query() { queryCount++; return []; } } as never, {} as never, registry as never);
  await assert.rejects(() => service.listMine("00000000-0000-4000-8000-000000000104"), /desativado/);
  assert.equal(queryCount, 0);
});

test("aluno sem membership pode consultar planos publicados sem ler escopos de outro workspace", async () => {
  const queries: unknown[][] = [];
  const access = { async has() { return false; }, async audit() {} };
  const db = { async one(_sql: string, values: unknown[]) { assert.deepEqual(values, [workspaceId]); return { id: workspaceId }; },
    async query(sql: string, values: unknown[]) { queries.push([sql, values]); return [{ id: planId, workspace_id: workspaceId, title: "Plano", state: "published", revision: 2,
      payload: { name: "Plano anual", billing_interval: "year", price_amount: 120, currency: "BRL", course_record_ids: [courseId], secret_internal: "não exibir" } }]; } };
  const registry = { isEnabled() { return true; } };
  const service = new SuindaSubscriptionsService(db as never, access as never, registry as never);
  const rows = await service.listPlans(workspaceId, "00000000-0000-4000-8000-000000000104");
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0][1], [workspaceId, SUINDA_SUBSCRIPTIONS_PLUGIN_ID]);
  assert.equal(rows.length, 1);
  assert.equal("secret_internal" in rows[0].payload, false);
});

test("assinatura ativa abre árvore publicada sem criar nem exigir matrícula ou pagamento avulso", async () => {
  const moduleId = "00000000-0000-4000-8000-000000000105";
  const lessonId = "00000000-0000-4000-8000-000000000106";
  const audits: unknown[][] = [];
  const queries: string[] = [];
  const course = { id: courseId, workspace_id: workspaceId, title: "Curso", state: "published", revision: 3, payload: { version: 2, description: "Descrição", price_amount: 150, objectives: ["Aprender"], secret: "oculto" } };
  function serviceWith(options: { enabled?: boolean; entitled?: boolean; course?: typeof course | null; modules?: unknown[] } = {}) {
    const db = {
      async one(sql: string, values: unknown[]) {
        if (sql.includes("FROM workspaces")) return { id: workspaceId };
        if (sql.includes("FROM extension_records r JOIN extension_record_versions")) {
          assert.deepEqual(values, [courseId, workspaceId]);
          assert.match(sql, /r\.workspace_id=\$2/);
          return options.course === undefined ? course : options.course;
        }
        if (sql.includes("FROM suinda_subscriptions s")) {
          assert.match(sql, /s\.state='active'/);
          assert.match(sql, /s\.ends_at>now\(\)/);
          assert.deepEqual(values, [workspaceId, "learner", SUINDA_SUBSCRIPTIONS_PLUGIN_ID, courseId]);
          return { allowed: options.entitled ?? true };
        }
        throw new Error(`Unexpected read query: ${sql}`);
      },
      async query(sql: string, values: unknown[]) {
        queries.push(sql);
        assert.doesNotMatch(sql, /payment_entry|kind='enrollment'|suinda_subscriptions/);
        if (sql.includes("kind='module'")) {
          assert.deepEqual(values, [workspaceId, courseId, "2"]);
          return options.modules ?? [{ id: moduleId, title: "Módulo 1", state: "published", revision: 4, payload: { position: 1, summary: "Resumo", private_field: "oculto" } }];
        }
        if (sql.includes("kind='lesson'")) {
          assert.match(sql, /v\.state='published'/);
          return [{ id: lessonId, title: "Aula 1", state: "published", revision: 5,
            module_record_id: moduleId, payload: { position: 1, content_type: "article", body_markdown: "Texto da aula", content_url: "https://media.example/aula.mp4", attachments: [{ data: "segredo" }], downloadable: true } }];
        }
        if (sql.includes("suinda_subscription_lesson_progress")) return [];
        if (sql.includes("FROM unnest")) return [{ id: "00000000-0000-4000-8000-000000000111", record_id: lessonId, revision: 5,
          file_name: "aula.pdf", mime_type: "application/pdf", size_bytes: 100, sha256: "a".repeat(64), alt_text: "" }];
        throw new Error(`Unexpected list query: ${sql}`);
      },
    };
    const access = { async audit(...args: unknown[]) { audits.push(args); } };
    const registry = { isEnabled() { return options.enabled ?? true; } };
    return new SuindaSubscriptionsService(db as never, access as never, registry as never);
  }
  const tree = await serviceWith().content(workspaceId, courseId, "learner");
  assert.equal(tree.id, courseId);
  assert.deepEqual(tree.payload, { description: "Descrição", objectives: ["Aprender"] });
  assert.equal(tree.modules[0].id, moduleId);
  assert.deepEqual(tree.modules[0].payload, { position: 1, summary: "Resumo" });
  assert.equal(tree.modules[0].lessons[0].id, lessonId);
  assert.deepEqual(tree.modules[0].lessons[0].payload, { position: 1, content_type: "article", body_markdown: "Texto da aula", content_url: "https://media.example/aula.mp4",
    downloadable: true, attachments: [{ id: "00000000-0000-4000-8000-000000000111", record_id: lessonId, revision: 5, file_name: "aula.pdf",
      mime_type: "application/pdf", size_bytes: 100, sha256: "a".repeat(64), alt_text: "" }] });
  assert.equal(JSON.stringify(tree).includes("segredo"), false);
  assert.equal(JSON.stringify(tree).includes("payment"), false);
  assert.equal(queries.length, 4);
  assert.ok(audits.some((event) => event[1] === "suinda.subscriptions.content_accessed"));
});

test("cancelamento e expiração negam o conteúdo pela condição de entitlement", async () => {
  for (const state of ["canceled", "expired"] as const) {
    await assert.rejects(() => {
      const service = (() => {
        const db = {
          async one(sql: string) {
            if (sql.includes("FROM workspaces")) return { id: workspaceId };
            if (sql.includes("FROM extension_records r JOIN extension_record_versions")) return { id: courseId, workspace_id: workspaceId, title: "Curso", state: "enrollment_open", revision: 1, payload: { version: 1 } };
            if (sql.includes("FROM suinda_subscriptions s")) { assert.match(sql, /s\.state='active'.*s\.ends_at>now\(\)/s); return { allowed: false }; }
            throw new Error(`Unexpected SQL for ${state}: ${sql}`);
          },
        };
        return new SuindaSubscriptionsService(db as never, {} as never, { isEnabled() { return true; } } as never);
      })();
      return service.content(workspaceId, courseId, "learner");
    }, /assinatura não inclui/);
  }
});

test("workspace cruzado, curso não publicado e plugin desligado não entregam conteúdo", async () => {
  const workspaceMismatch = new SuindaSubscriptionsService({
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
  } as never, {} as never, { isEnabled() { return true; } } as never);
  await assert.rejects(() => workspaceMismatch.content(workspaceId, courseId, "learner"), /Curso publicado não encontrado/);

  const draftCourse = new SuindaSubscriptionsService({
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : { id: courseId, workspace_id: workspaceId, title: "Rascunho", state: "draft", revision: 1, payload: {} }; },
  } as never, {} as never, { isEnabled() { return true; } } as never);
  await assert.rejects(() => draftCourse.content(workspaceId, courseId, "learner"), /Curso publicado não encontrado/);

  let reads = 0;
  const disabled = new SuindaSubscriptionsService({ async one() { reads++; return null; } } as never, {} as never,
    { isEnabled() { return false; } } as never);
  await assert.rejects(() => disabled.content(workspaceId, courseId, "learner"), /desativado/);
  assert.equal(reads, 0);
});

test("conclusão idempotente grava progresso próprio da assinatura, sem tocar em matrículas", async () => {
  const subscriptionId = "00000000-0000-4000-8000-000000000107";
  const lessonId = "00000000-0000-4000-8000-000000000108";
  const moduleId = "00000000-0000-4000-8000-000000000109";
  const operationKey = "00000000-0000-4000-8000-000000000110";
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const audits: unknown[][] = [];
  const course = { id: courseId, workspace_id: workspaceId, title: "Curso", state: "published", revision: 1, payload: { version: 1 } };
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM workspaces")) return { id: workspaceId };
      if (sql.includes("SELECT c.id AS course_id")) return { course_id: courseId, course_version: 1 };
      if (sql.includes("FROM suinda_subscriptions s")) return { allowed: true };
      if (sql.includes("FROM extension_records r JOIN extension_record_versions")) return course;
      throw new Error(`Unexpected read: ${sql}`);
    },
    async query(sql: string) {
      if (sql.includes("kind='module'")) return [{ id: moduleId, title: "Módulo", state: "published", revision: 1, payload: { course_version: 1, position: 1 } }];
      if (sql.includes("kind='lesson'")) return [{ id: lessonId, title: "Aula", state: "published", revision: 1, module_record_id: moduleId, payload: { position: 1, required: true } }];
      if (sql.includes("suinda_subscription_lesson_progress")) return [];
      if (sql.includes("FROM unnest")) return [];
      throw new Error(`Unexpected list: ${sql}`);
    },
    pool: { async connect() { return {
      async query(sql: string, values: unknown[] = []) {
        writes.push({ sql, values });
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FOR UPDATE OF s")) return { rows: [{ id: subscriptionId, workspace_id: workspaceId, user_id: "learner", state: "active" }] };
        if (sql.includes("SELECT lesson_record_id FROM suinda_subscription_lesson_progress")) return { rows: [] };
        if (sql.includes("INSERT INTO suinda_subscription_lesson_progress")) return { rows: [{ id: "progress-id" }] };
        throw new Error(`Unexpected transaction query: ${sql}`);
      }, release() {},
    }; } },
  };
  const service = new SuindaSubscriptionsService(db as never, { async audit(...args: unknown[]) { audits.push(args); } } as never,
    { isEnabled() { return true; } } as never);
  const result = await service.completeLesson(workspaceId, subscriptionId, lessonId, "learner", operationKey);
  assert.deepEqual(result, { ok: true, lesson_record_id: lessonId, already_completed: false });
  const insert = writes.find((row) => row.sql.includes("INSERT INTO suinda_subscription_lesson_progress"));
  assert.ok(insert);
  assert.deepEqual(insert.values, [workspaceId, subscriptionId, "learner", courseId, 1, lessonId, operationKey]);
  assert.equal(writes.some((row) => /payment_entry|kind='enrollment'|plugin_id='suinda-learning'/.test(row.sql)), false);
  assert.ok(audits.some((event) => event[1] === "suinda.subscriptions.lesson_completed"));
});

test("materiais de aulas só são pré-visualizados pela assinatura ativa e download respeita a aula", async () => {
  const subscriptionId = "00000000-0000-4000-8000-000000000107";
  const lessonId = "00000000-0000-4000-8000-000000000108";
  const attachmentId = "00000000-0000-4000-8000-000000000109";
  const bytes = Buffer.from("pdf bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const reads: string[] = [];
  const db = { async one(sql: string) {
    reads.push(sql);
    if (sql.includes("SELECT EXISTS")) return { allowed: true };
    if (sql.includes("FROM extension_record_attachments")) return { data: bytes, sha256, file_name: "handout.pdf", mime_type: "application/pdf", size_bytes: bytes.length, scan_status: "clean" };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const audits: unknown[][] = [];
  const service = new SuindaSubscriptionsService(db as never, { async audit(...args: unknown[]) { audits.push(args); } } as never,
    { isEnabled() { return true; } } as never);
  service.content = async () => ({ modules: [{ lessons: [{ id: lessonId, revision: 3, payload: { downloadable: false, attachments: [
    { id: attachmentId, revision: 3, file_name: "handout.pdf", mime_type: "application/pdf", size_bytes: bytes.length, sha256, alt_text: "" },
  ] } }] }] }) as never;
  const preview = await service.attachment(workspaceId, subscriptionId, courseId, lessonId, 3, attachmentId, "learner");
  assert.deepEqual(preview.data, bytes);
  assert.equal(preview.mime_type, "application/pdf");
  assert.equal(reads.length, 2);
  await assert.rejects(() => service.attachment(workspaceId, subscriptionId, courseId, lessonId, 3, attachmentId, "learner", true), /download.*desativado/i);
  assert.equal(reads.length, 3);
  assert.ok(audits.some((event) => event[1] === "suinda.subscriptions.attachment_previewed"));
});
