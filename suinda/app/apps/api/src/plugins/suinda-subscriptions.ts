import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Req, Res } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Response } from "express";
import type { PoolClient } from "pg";
import type { AccessRequest } from "../access/access";
import { AccessService } from "../access/access";
import { isProtectedAttachmentEnvelope, openProtectedAttachment } from "../data-protector";
import { Db } from "../db";
import { PluginRegistry } from "../execution/registries";
import type { PluginDefinition, RecordKindContribution } from "./contract";
import type { Payload } from "./records/rules";

export const SUINDA_SUBSCRIPTIONS_PLUGIN_ID = "suinda-subscriptions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string, status = 400): never => { throw new HttpException({ message }, status); };
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const uuidField = { type: "string", pattern: UUID.source };
const managerPermission = `plugin.${SUINDA_SUBSCRIPTIONS_PLUGIN_ID}.manage`;
const readerPermission = `plugin.${SUINDA_SUBSCRIPTIONS_PLUGIN_ID}.read`;

export type SubscriptionState = "pending_payment" | "active" | "past_due" | "canceled" | "expired";
const stateTransitions: Record<SubscriptionState, SubscriptionState[]> = {
  pending_payment: ["active", "canceled"], active: ["past_due", "canceled", "expired"],
  past_due: ["active", "canceled", "expired"], canceled: [], expired: [],
};

export function subscriptionTransition(from: SubscriptionState, to: SubscriptionState) {
  if (!stateTransitions[from]?.includes(to)) fail(`Transição de assinatura inválida: ${from} → ${to}.`, 409);
  return { from, to };
}

export function validateSubscriptionPlan(input: Payload) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const interval = input.billing_interval;
  const amount = Number(input.price_amount);
  const currency = typeof input.currency === "string" ? input.currency.toUpperCase() : "";
  const courseIds = input.course_record_ids;
  if (!name || name.length > 120) fail("Informe o nome do plano (até 120 caracteres).");
  if (!(["month", "quarter", "year"] as unknown[]).includes(interval)) fail("Use cobrança mensal, trimestral ou anual.");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 || Math.round(amount * 100) !== amount * 100) fail("O preço da assinatura deve ser positivo e ter até duas casas decimais.");
  if (!/^[A-Z]{3}$/.test(currency)) fail("Informe a moeda ISO 4217 do plano.");
  if (!Array.isArray(courseIds) || courseIds.length < 1 || courseIds.length > 100 || courseIds.some((item) => typeof item !== "string" || !UUID.test(item)) || new Set(courseIds).size !== courseIds.length) fail("Selecione de 1 a 100 cursos válidos, sem duplicação.");
  return { name, billing_interval: interval, price_amount: amount, currency, course_record_ids: courseIds as string[] };
}

const scope: Pick<RecordKindContribution, "resourceScoped" | "managePermission" | "authorizeRecord" | "authorizeCreate"> = {
  resourceScoped: true,
  managePermission: managerPermission,
  authorizeRecord: async (_actor, _action, _state, _payload, context) => Boolean(await context.hasWorkspacePermission?.(managerPermission)),
  authorizeCreate: async (_actor, _payload, context) => Boolean(await context.hasWorkspacePermission?.(managerPermission)),
};

export const suindaSubscriptionRecordKinds: Record<string, RecordKindContribution> = {
  subscription_plan: {
    label: "Plano de assinatura",
    schema: schema({ name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 4000 },
      billing_interval: { type: "string", enum: ["month", "quarter", "year"] }, price_amount: { type: "number", minimum: 0.01, maximum: 1000000 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" }, course_record_ids: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: uuidField } },
    ["name", "billing_interval", "price_amount", "currency", "course_record_ids"]),
    initial: "draft", transitions: { draft: ["published", "archived"], published: ["paused", "archived"], paused: ["published", "archived"], archived: [] },
    stateLabels: { draft: "Rascunho", published: "Publicado", paused: "Pausado", archived: "Arquivado" },
    immutablePayloadFieldsAfterInitial: ["billing_interval", "price_amount", "currency", "course_record_ids"],
    example: { name: "Acesso anual", billing_interval: "year", price_amount: 120, currency: "BRL", course_record_ids: ["00000000-0000-4000-8000-000000000001"] },
    uniqueFields: ["name"], ...scope,
    validate: async (payload, context) => {
      const plan = validateSubscriptionPlan(payload);
      const courses = await Promise.all(plan.course_record_ids.map((id) => context.resolveLatestRecord?.(id)));
      return courses.every((course) => course?.pluginId === "suinda-learning" && course.kind === "course" && course.state !== "archived")
        ? [] : [{ severity: "error", code: "subscription_course_invalid", path: "course_record_ids", message: "Todos os cursos precisam existir neste workspace e não podem estar arquivados." }];
    },
  },
  subscription: {
    label: "Assinatura de aluno",
    schema: schema({ plan_record_id: uuidField, learner_user_id: uuidField, billing_interval: { type: "string", enum: ["month", "quarter", "year"] },
      price_amount: { type: "number", minimum: 0.01, maximum: 1000000 }, currency: { type: "string", pattern: "^[A-Z]{3}$" },
      external_payment_reference: { type: "string", maxLength: 200 }, started_at: { type: "string", format: "date-time" }, ends_at: { type: "string", format: "date-time" } },
    ["plan_record_id", "learner_user_id", "billing_interval", "price_amount", "currency"]),
    initial: "pending_payment", transitions: { pending_payment: ["active", "canceled"], active: ["past_due", "canceled", "expired"],
      past_due: ["active", "canceled", "expired"], canceled: [], expired: [] },
    stateLabels: { pending_payment: "Aguardando confirmação manual", active: "Ativa", past_due: "Pagamento em atraso", canceled: "Cancelada", expired: "Expirada" },
    immutable: ["plan_record_id", "learner_user_id"], serverCreated: true,
    example: { plan_record_id: "00000000-0000-4000-8000-000000000001", learner_user_id: "00000000-0000-4000-8000-000000000002", billing_interval: "month", price_amount: 39.9, currency: "BRL" },
    ...scope,
  },
};

export const suindaSubscriptionsPlugin: PluginDefinition = {
  id: SUINDA_SUBSCRIPTIONS_PLUGIN_ID, name: "Suindá · Planos e assinaturas", version: "1.0.0",
  description: "Planos de acesso a cursos, solicitações de assinatura, confirmação manual de recebimentos e consulta de conteúdo elegível.",
  scope: "workspace", parentPlugin: "suinda-learning", dependencies: ["suinda-learning"],
  handlesRoute: (path) => /^\/extensions\/suinda-subscriptions\/workspaces\/[0-9a-f-]{36}\/(?:plans|subscriptions(?:\/[0-9a-f-]{36}\/confirm)?|content\/[0-9a-f-]{36})$/.test(path)
    || /^\/extensions\/suinda-subscriptions\/me\/(?:subscriptions|plans\/[0-9a-f-]{36}\/subscribe|subscriptions\/[0-9a-f-]{36}\/cancel)$/.test(path)
    || /^\/extensions\/suinda-subscriptions\/workspaces\/[0-9a-f-]{36}\/subscriptions\/[0-9a-f-]{36}\/lessons\/[0-9a-f-]{36}\/complete$/.test(path),
  routePermission: () => null,
  capabilities: [
    { id: "read", name: "Consultar planos e assinaturas", permissions: [readerPermission] },
    { id: "manage", name: "Administrar planos e assinaturas", permissions: [managerPermission] },
  ],
  contributions: { navigation: [{ id: "suinda-subscriptions", label: "Assinaturas", href: "/suinda/subscriptions", permission: readerPermission, order: 76 }], recordKinds: suindaSubscriptionRecordKinds },
};

type Plan = { id: string; workspace_id: string; title: string; state: string; revision: number; payload: Payload };
type Subscription = { id: string; workspace_id: string; plan_record_id: string; user_id: string; state: SubscriptionState; billing_interval: string; price_amount: string; currency: string; external_payment_reference: string | null; starts_at: string | null; ends_at: string | null; created_at: string };
type SubscriptionContentRecord = { id: string; title: string; state: string; revision: number; payload: Payload };
type SubscriptionLesson = SubscriptionContentRecord & { module_record_id: string };
type SubscriptionAttachment = { id: string; record_id: string; revision: number; file_name: string; mime_type: string; size_bytes: number; sha256: string; alt_text: string };
const previewableAttachmentTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);

export function subscriptionAvailableModules(modules: SubscriptionContentRecord[], lessons: SubscriptionLesson[], completedLessonIds: Set<string>, now = Date.now()) {
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const lessonsByModule = new Map(modules.map((module) => [module.id, lessons.filter((lesson) => lesson.module_record_id === module.id)]));
  const moduleCompletionMemo = new Map<string, boolean>();
  const checkingModules = new Set<string>();
  const moduleCompleted = (moduleId: string): boolean => {
    const memo = moduleCompletionMemo.get(moduleId);
    if (memo !== undefined) return memo;
    const module = moduleById.get(moduleId);
    if (!module || checkingModules.has(moduleId)) return false;
    checkingModules.add(moduleId);
    const requiredLessons = (lessonsByModule.get(moduleId) || []).filter((lesson) => lesson.payload.required !== false);
    const prerequisites = Array.isArray(module.payload.prerequisite_module_ids)
      ? module.payload.prerequisite_module_ids.filter((value): value is string => typeof value === "string") : [];
    const result = prerequisites.every((id) => moduleCompleted(id)) && requiredLessons.every((lesson) => completedLessonIds.has(lesson.id));
    checkingModules.delete(moduleId);
    moduleCompletionMemo.set(moduleId, result);
    return result;
  };
  const sortedModules = [...modules].sort((a, b) => Number(a.payload.position || 0) - Number(b.payload.position || 0) || a.id.localeCompare(b.id));
  return sortedModules.flatMap((module) => {
    const prerequisiteModules = Array.isArray(module.payload.prerequisite_module_ids)
      ? module.payload.prerequisite_module_ids.filter((value): value is string => typeof value === "string") : [];
    const moduleUnlocked = prerequisiteModules.every((id) => moduleCompleted(id));
    const sortedLessons = [...(lessonsByModule.get(module.id) || [])].sort((a, b) => Number(a.payload.position || 0) - Number(b.payload.position || 0) || a.id.localeCompare(b.id));
    let previousRequiredCompleted = true;
    const visibleLessons = sortedLessons.flatMap((lesson) => {
      const completed = completedLessonIds.has(lesson.id);
      const required = lesson.payload.required !== false;
      const prerequisiteIds = Array.isArray(lesson.payload.prerequisites)
        ? lesson.payload.prerequisites.filter((value): value is string => typeof value === "string") : [];
      const releaseAt = typeof lesson.payload.release_at === "string" ? Date.parse(lesson.payload.release_at) : null;
      const released = lesson.state === "published" && (releaseAt === null || !Number.isFinite(releaseAt) || releaseAt <= now);
      const available = moduleUnlocked && released && prerequisiteIds.every((id) => completedLessonIds.has(id))
        && (module.payload.sequential === false || !required || previousRequiredCompleted);
      if (required && !completed) previousRequiredCompleted = false;
      return available || completed ? [{ ...lesson, completed, available }] : [];
    });
    if (!moduleUnlocked && !visibleLessons.length) return [];
    return [{ ...module, lessons: visibleLessons, available: moduleUnlocked }];
  });
}

@Injectable()
export class SuindaSubscriptionsService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry) {}

  private available() { if (!this.plugins.isEnabled(SUINDA_SUBSCRIPTIONS_PLUGIN_ID)) fail("O módulo de assinaturas está desativado.", 503); }
  private async workspacePermission(user: string, workspace: string, permission: string) {
    if (!UUID.test(workspace)) fail("Workspace inválido.");
    const ok = await this.access.has(user, permission, "workspace", workspace)
      || (permission !== managerPermission && await this.access.has(user, "plugin.suinda-learning.read", "workspace", workspace))
      || (permission === managerPermission && await this.access.has(user, "plugin.suinda-learning.manage", "workspace", workspace));
    if (!ok) { await this.access.audit(user, "access.denied", `${SUINDA_SUBSCRIPTIONS_PLUGIN_ID}.${permission === managerPermission ? "manage" : "read"}`, { type: "workspace", id: workspace }); fail("Acesso ao workspace não autorizado.", 403); }
  }
  private async assertWorkspaceExists(workspace: string) {
    if (!UUID.test(workspace)) fail("Workspace inválido.");
    if (!await this.db.one<{ id: string }>("SELECT id FROM workspaces WHERE id=$1", [workspace])) fail("Workspace não encontrado.", 404);
  }
  private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.db.pool.connect();
    try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  private async plan(workspace: string, planId: string, client?: PoolClient): Promise<Plan> {
    if (!UUID.test(planId)) fail("Plano inválido.");
    const sql = `SELECT r.id,r.workspace_id,r.title,v.state,v.revision,v.payload FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id AND v.revision=r.revision WHERE r.id=$1 AND r.workspace_id=$2 AND r.plugin_id=$3 AND r.kind='subscription_plan'`;
    const row = client ? (await client.query<Plan>(sql, [planId, workspace, SUINDA_SUBSCRIPTIONS_PLUGIN_ID])).rows[0] : await this.db.one<Plan>(sql, [planId, workspace, SUINDA_SUBSCRIPTIONS_PLUGIN_ID]);
    if (!row) return fail("Plano não encontrado neste workspace.", 404);
    return row;
  }

  async listPlans(workspace: string, user: string) {
    this.available(); await this.assertWorkspaceExists(workspace);
    const plans = await this.db.query<Plan>(`SELECT r.id,r.workspace_id,r.title,v.state,v.revision,v.payload FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id AND v.revision=r.revision WHERE r.workspace_id=$1 AND r.plugin_id=$2 AND r.kind='subscription_plan' AND v.state='published' ORDER BY r.title,r.id`, [workspace, SUINDA_SUBSCRIPTIONS_PLUGIN_ID]);
    await this.access.audit(user, "suinda.subscriptions.public_plans_listed", "published-plans", { type: "workspace", id: workspace });
    return plans.map((plan) => ({ id: plan.id, title: plan.title, state: plan.state, revision: plan.revision,
      payload: Object.fromEntries(["name", "description", "billing_interval", "price_amount", "currency"]
        .filter((key) => key in plan.payload).map((key) => [key, plan.payload[key]])) }));
  }

  async listMine(user: string) {
    this.available();
    return this.db.query(`SELECT s.id,s.workspace_id,s.plan_record_id,CASE WHEN s.state='active' AND s.ends_at<=now() THEN 'expired' ELSE s.state END AS state,s.billing_interval,s.price_amount,s.currency,s.external_payment_reference,s.starts_at,s.ends_at,s.created_at,r.title AS plan_title,pv.payload->'course_record_ids' AS course_record_ids FROM suinda_subscriptions s JOIN extension_records r ON r.id=s.plan_record_id AND r.workspace_id=s.workspace_id JOIN extension_record_versions pv ON pv.record_id=r.id AND pv.revision=r.revision WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [user]);
  }

  async request(workspaceInput: string, planInput: string, user: string, operationKey: string) {
    this.available(); const workspace = workspaceInput; const planId = planInput;
    if (!UUID.test(workspace) || !UUID.test(planId) || !UUID.test(operationKey)) fail("Identificadores inválidos.");
    await this.assertWorkspaceExists(workspace);
    const created = await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`suinda-subscription:${workspace}:${planId}:${user}`]);
      const prior = (await client.query<Subscription>("SELECT * FROM suinda_subscriptions WHERE workspace_id=$1 AND plan_record_id=$2 AND user_id=$3 AND operation_key=$4", [workspace, planId, user, operationKey])).rows[0];
      if (prior) return prior;
      const plan = await this.plan(workspace, planId, client);
      if (plan.state !== "published") fail("Este plano não está disponível para novas assinaturas.", 409);
      const data = validateSubscriptionPlan(plan.payload);
      const expired = (await client.query<Subscription>("SELECT * FROM suinda_subscriptions WHERE workspace_id=$1 AND plan_record_id=$2 AND user_id=$3 AND state='active' AND ends_at<=now() FOR UPDATE", [workspace, planId, user])).rows;
      for (const subscription of expired) {
        await client.query("UPDATE suinda_subscriptions SET state='expired',updated_at=now() WHERE id=$1", [subscription.id]);
        const sequence = (await client.query<{ n: string }>("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM suinda_subscription_events WHERE subscription_id=$1", [subscription.id])).rows[0].n;
        await client.query("INSERT INTO suinda_subscription_events(subscription_id,sequence,event_type,actor_id,operation_key,details) VALUES($1,$2,'expired_by_term',$3,$4,'{}'::jsonb)", [subscription.id, sequence, user, operationKey]);
      }
      const result = await client.query<Subscription>(`INSERT INTO suinda_subscriptions(workspace_id,plan_record_id,user_id,state,billing_interval,price_amount,currency,operation_key)
        VALUES($1,$2,$3,'pending_payment',$4,$5,$6,$7) RETURNING *`, [workspace, planId, user, data.billing_interval, data.price_amount, data.currency, operationKey]);
      const item = result.rows[0];
      await client.query("INSERT INTO suinda_subscription_events(subscription_id,sequence,event_type,actor_id,operation_key,details) VALUES($1,1,'requested',$2,$3,$4::jsonb)", [item.id, user, operationKey, JSON.stringify({ plan_record_id: planId, price_amount: data.price_amount, currency: data.currency, billing_interval: data.billing_interval })]);
      return item;
    });
    await this.access.audit(user, "suinda.subscriptions.requested", created.id, { type: "workspace", id: workspace });
    return created;
  }

  async confirm(workspace: string, subscriptionId: string, user: string, input: Payload) {
    this.available(); if (!UUID.test(workspace) || !UUID.test(subscriptionId)) fail("Identificadores inválidos.");
    await this.workspacePermission(user, workspace, managerPermission);
    const reference = input.external_payment_reference;
    const paymentReference = typeof reference === "string" ? reference.trim() : "";
    const operationKey = input.operation_key;
    if (Object.keys(input).some((key) => !["external_payment_reference", "operation_key"].includes(key))) fail("Solicitação de confirmação inválida.");
    if (paymentReference.length < 1 || paymentReference.length > 200 || typeof operationKey !== "string" || !UUID.test(operationKey)) fail("Informe a referência do recebimento e uma chave de operação válida.");
    const result = await this.transaction(async (client) => {
      const row = (await client.query<Subscription>("SELECT * FROM suinda_subscriptions WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [subscriptionId, workspace])).rows[0];
      if (!row) return fail("Assinatura não encontrada neste workspace.", 404);
      const duplicate = (await client.query("SELECT 1 FROM suinda_subscription_events WHERE subscription_id=$1 AND operation_key=$2", [subscriptionId, operationKey])).rows.length > 0;
      if (duplicate) return row;
      subscriptionTransition(row.state, "active");
      const updated = (await client.query<Subscription>("UPDATE suinda_subscriptions SET state='active',external_payment_reference=$3,starts_at=now(),ends_at=now()+CASE billing_interval WHEN 'month' THEN interval '1 month' WHEN 'quarter' THEN interval '3 months' ELSE interval '1 year' END,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *", [subscriptionId, workspace, paymentReference])).rows[0];
      const seq = (await client.query<{ n: string }>("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM suinda_subscription_events WHERE subscription_id=$1", [subscriptionId])).rows[0].n;
      await client.query("INSERT INTO suinda_subscription_events(subscription_id,sequence,event_type,actor_id,operation_key,details) VALUES($1,$2,'manual_payment_confirmed',$3,$4,$5::jsonb)", [subscriptionId, seq, user, operationKey, JSON.stringify({ external_payment_reference: paymentReference })]);
      return updated;
    });
    await this.access.audit(user, "suinda.subscriptions.payment_confirmed_manually", result.id, { type: "workspace", id: workspace });
    return result;
  }

  async cancel(subscriptionId: string, user: string, operationKey: string) {
    this.available(); if (!UUID.test(subscriptionId) || !UUID.test(operationKey)) fail("Identificadores inválidos.");
    const result = await this.transaction(async (client) => {
      const row = (await client.query<Subscription>("SELECT * FROM suinda_subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE", [subscriptionId, user])).rows[0];
      if (!row) return fail("Assinatura não encontrada.", 404);
      const duplicate = (await client.query("SELECT 1 FROM suinda_subscription_events WHERE subscription_id=$1 AND operation_key=$2", [subscriptionId, operationKey])).rows.length > 0;
      if (duplicate) return row;
      subscriptionTransition(row.state, "canceled");
      const updated = (await client.query<Subscription>("UPDATE suinda_subscriptions SET state='canceled',updated_at=now() WHERE id=$1 RETURNING *", [subscriptionId])).rows[0];
      const seq = (await client.query<{ n: string }>("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM suinda_subscription_events WHERE subscription_id=$1", [subscriptionId])).rows[0].n;
      await client.query("INSERT INTO suinda_subscription_events(subscription_id,sequence,event_type,actor_id,operation_key,details) VALUES($1,$2,'canceled_by_subscriber',$3,$4,'{}'::jsonb)", [subscriptionId, seq, user, operationKey]);
      return updated;
    });
    await this.access.audit(user, "suinda.subscriptions.canceled", result.id, { type: "workspace", id: result.workspace_id });
    return result;
  }

  async content(workspace: string, courseId: string, user: string) {
    this.available(); if (!UUID.test(workspace) || !UUID.test(courseId)) fail("Identificadores inválidos.");
    await this.assertWorkspaceExists(workspace);
    const course = await this.db.one<SubscriptionContentRecord & { workspace_id: string }>(`SELECT r.id,r.workspace_id,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id AND v.revision=r.revision
      WHERE r.id=$1 AND r.workspace_id=$2 AND r.plugin_id='suinda-learning' AND r.kind='course'`, [courseId, workspace]);
    if (!course || !["published", "enrollment_open", "in_progress", "closed", "completed"].includes(course.state)) return fail("Curso publicado não encontrado neste workspace.", 404);
    const allowed = await this.db.one<{ allowed: boolean }>(`SELECT EXISTS(SELECT 1 FROM suinda_subscriptions s
      JOIN extension_records p ON p.id=s.plan_record_id AND p.workspace_id=s.workspace_id
      JOIN extension_record_versions pv ON pv.record_id=p.id AND pv.revision=p.revision
      WHERE s.workspace_id=$1 AND s.user_id=$2 AND s.state='active' AND s.starts_at<=now() AND s.ends_at>now() AND p.plugin_id=$3 AND p.kind='subscription_plan'
      AND pv.payload->'course_record_ids' ? $4) AS allowed`, [workspace, user, SUINDA_SUBSCRIPTIONS_PLUGIN_ID, course.id]);
    if (!allowed?.allowed) fail("Sua assinatura não inclui este conteúdo ou está inativa.", 403);
    // Assinatura concede acesso somente ao conteúdo educacional publicado deste curso. Não cria matrícula, não liquida nem substitui cobranças avulsas do fluxo normal.
    const modules = await this.db.query<SubscriptionContentRecord>(`SELECT r.id,r.title,v.state,v.revision,v.payload
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id AND v.revision=r.revision
      WHERE r.workspace_id=$1 AND r.plugin_id='suinda-learning' AND r.kind='module' AND v.state='published'
        AND v.payload->>'course_record_id'=$2 AND (v.payload->>'course_version' IS NULL OR v.payload->>'course_version'=$3)
      ORDER BY COALESCE(NULLIF(v.payload->>'position','')::int,0),r.title,r.id LIMIT 101`, [workspace, course.id, String(course.payload.version || "")]);
    if (modules.length > 100) fail("A estrutura deste curso excede o limite de 100 módulos para o leitor de assinatura.", 413);
    const moduleIds = modules.map((item) => item.id);
    const lessons = moduleIds.length ? await this.db.query<SubscriptionContentRecord & { module_record_id: string }>(`SELECT r.id,r.title,v.state,v.revision,v.payload,r.payload->>'module_record_id' AS module_record_id
      FROM extension_records r JOIN extension_record_versions v ON v.record_id=r.id AND v.revision=r.revision
      WHERE r.workspace_id=$1 AND r.plugin_id='suinda-learning' AND r.kind='lesson' AND v.state=ANY(ARRAY['published','scheduled'])
        AND v.payload->>'module_record_id'=ANY($2::text[])
        AND (v.payload->>'unit_record_id' IS NULL OR EXISTS (
          SELECT 1 FROM extension_records u JOIN extension_record_versions uv ON uv.record_id=u.id AND uv.revision=u.revision
          WHERE u.id::text=v.payload->>'unit_record_id' AND u.workspace_id=r.workspace_id AND u.plugin_id='suinda-learning' AND u.kind='learning_unit' AND uv.state='published'
        ))
      ORDER BY COALESCE(NULLIF(v.payload->>'position','')::int,0),r.title,r.id LIMIT 501`, [workspace, moduleIds]) : [];
    if (lessons.length > 500) fail("A estrutura deste curso excede o limite de 500 aulas para o leitor de assinatura.", 413);
    const progress = lessons.length ? await this.db.query<{ lesson_record_id: string }>(`SELECT lesson_record_id FROM suinda_subscription_lesson_progress
      WHERE workspace_id=$1 AND user_id=$2 AND course_record_id=$3 AND course_version=$4`, [workspace, user, course.id, Number(course.payload.version || 1)]) : [];
    const completed = new Set(progress.map((row) => row.lesson_record_id));
    const availableModules = subscriptionAvailableModules(modules, lessons, completed);
    const visibleLessons = availableModules.flatMap((module) => module.lessons);
    const lessonAttachments = visibleLessons.length ? await this.db.query<SubscriptionAttachment>(
      `SELECT a.id,a.record_id,a.revision,a.file_name,a.mime_type,a.size_bytes,a.sha256,a.alt_text
       FROM unnest($1::uuid[],$2::integer[]) expected(record_id,revision)
       JOIN extension_record_attachments a ON a.record_id=expected.record_id AND a.revision=expected.revision
       WHERE a.scan_status='clean' AND a.mime_type=ANY($3::text[])
       ORDER BY a.record_id,a.created_at,a.id LIMIT 2001`,
      [visibleLessons.map((lesson) => lesson.id), visibleLessons.map((lesson) => lesson.revision), [...previewableAttachmentTypes]],
    ) : [];
    if (lessonAttachments.length > 2000) fail("Este curso excede o limite de 2.000 materiais para o leitor de assinatura.", 413);
    const attachmentsByLesson = new Map<string, SubscriptionAttachment[]>();
    for (const attachment of lessonAttachments) {
      const key = `${attachment.record_id}:${attachment.revision}`;
      attachmentsByLesson.set(key, [...(attachmentsByLesson.get(key) || []), attachment]);
    }
    const projectPayload = (payload: Payload, fields: string[]) => Object.fromEntries(fields.filter((field) => field in payload).map((field) => [field, payload[field]]));
    const tree = {
      id: course.id, title: course.title, state: course.state, revision: course.revision,
      payload: projectPayload(course.payload, ["summary", "description", "category", "modality", "format", "level", "objectives", "competencies", "skills", "workload_mode", "workload_hours"]),
      modules: availableModules.map((module) => ({ id: module.id, title: module.title, state: module.state, revision: module.revision,
        payload: projectPayload(module.payload, ["position", "summary", "objectives", "competencies", "skills", "workload_hours"]),
        lessons: module.lessons.map((lesson) => ({ id: lesson.id, title: lesson.title, state: lesson.state, revision: lesson.revision, completed: lesson.completed,
          payload: { ...projectPayload(lesson.payload, ["position", "content_type", "content_url", "body_markdown", "transcript", "captions_vtt", "captions_language", "captions_label", "workload_minutes", "objectives", "competencies", "skills", "downloadable"]),
            attachments: attachmentsByLesson.get(`${lesson.id}:${lesson.revision}`) || [] } })) })),
    };
    if (Buffer.byteLength(JSON.stringify(tree), "utf8") > 3_000_000) fail("O conteúdo deste curso excede o limite de 3 MB para o leitor de assinatura.", 413);
    await this.access.audit(user, "suinda.subscriptions.content_accessed", `course:${course.id}`, { type: "workspace", id: workspace });
    return tree;
  }

  async attachment(workspace: string, subscriptionId: string, courseId: string, lessonId: string, revision: number,
    attachmentId: string, user: string, download = false) {
    this.available();
    if (![workspace, subscriptionId, courseId, lessonId, attachmentId].every((value) => UUID.test(value))
      || !Number.isInteger(revision) || revision < 1) fail("Identificadores ou revisão inválidos.");
    const entitled = await this.db.one<{ allowed: boolean }>(`SELECT EXISTS(SELECT 1 FROM suinda_subscriptions s
      JOIN extension_records p ON p.id=s.plan_record_id AND p.workspace_id=s.workspace_id
      JOIN extension_record_versions pv ON pv.record_id=p.id AND pv.revision=p.revision
      WHERE s.id=$1 AND s.workspace_id=$2 AND s.user_id=$3 AND s.state='active' AND s.starts_at<=now() AND s.ends_at>now()
        AND p.plugin_id=$4 AND p.kind='subscription_plan' AND pv.payload->'course_record_ids' ? $5) AS allowed`,
    [subscriptionId, workspace, user, SUINDA_SUBSCRIPTIONS_PLUGIN_ID, courseId]);
    if (!entitled?.allowed) fail("Uma assinatura ativa que inclui este curso é necessária.", 403);
    const tree = await this.content(workspace, courseId, user);
    const lesson = tree.modules.flatMap((module) => module.lessons).find((item) => item.id === lessonId && item.revision === revision) as
      { id: string; revision: number; payload: Payload & { downloadable?: boolean; attachments: SubscriptionAttachment[] } } | undefined;
    if (!lesson) return fail("Esta aula está bloqueada ou não pertence ao conteúdo publicado da assinatura.", 404);
    const metadata = lesson.payload.attachments.find((item) => item.id === attachmentId && item.revision === revision);
    if (!metadata || !previewableAttachmentTypes.has(metadata.mime_type)) return fail("Material indisponível para esta assinatura.", 404);
    if (download && lesson.payload.downloadable !== true) return fail("O download deste material está desativado pelo curso.", 403);
    const file = await this.db.one<{ data: Buffer; sha256: string; file_name: string; mime_type: string; size_bytes: number; scan_status: string }>(
      `SELECT data,sha256,file_name,mime_type,size_bytes,scan_status FROM extension_record_attachments
       WHERE record_id=$1 AND revision=$2 AND id=$3`, [lessonId, revision, attachmentId],
    );
    if (!file || file.scan_status !== "clean" || file.file_name !== metadata.file_name || file.mime_type !== metadata.mime_type
      || file.sha256 !== metadata.sha256 || file.size_bytes !== metadata.size_bytes
      || !previewableAttachmentTypes.has(file.mime_type)) return fail("Material não encontrado ou ainda não aprovado pelo scanner.", 404);
    const context = { pluginId: "suinda-learning", kind: "lesson", recordId: lessonId, revision,
      attachmentId, fileName: file.file_name, mimeType: file.mime_type, sha256: file.sha256 };
    const data = isProtectedAttachmentEnvelope(file.data) ? openProtectedAttachment(file.data, context) : file.data;
    if (data.length !== file.size_bytes || createHash("sha256").update(data).digest("hex") !== file.sha256)
      return fail("Material não encontrado ou com falha de integridade.", 404);
    await this.access.audit(user, download ? "suinda.subscriptions.attachment_downloaded" : "suinda.subscriptions.attachment_previewed",
      `${lessonId}:${attachmentId}`, { type: "workspace", id: workspace });
    return { data, file_name: file.file_name, mime_type: file.mime_type };
  }

  async completeLesson(workspace: string, subscriptionId: string, lessonId: string, user: string, operationKey: string) {
    this.available();
    if (![workspace, subscriptionId, lessonId, operationKey].every((value) => UUID.test(value))) fail("Identificadores inválidos.");
    await this.assertWorkspaceExists(workspace);
    const target = await this.db.one<{ course_id: string; course_version: number }>(`SELECT c.id AS course_id,COALESCE(NULLIF(cv.payload->>'version','')::int,1) AS course_version
      FROM extension_records l JOIN extension_record_versions lv ON lv.record_id=l.id AND lv.revision=l.revision
      JOIN extension_records m ON m.id::text=lv.payload->>'module_record_id' AND m.workspace_id=l.workspace_id AND m.plugin_id='suinda-learning' AND m.kind='module'
      JOIN extension_record_versions mv ON mv.record_id=m.id AND mv.revision=m.revision AND mv.state='published'
      JOIN extension_records c ON c.id::text=mv.payload->>'course_record_id' AND c.workspace_id=m.workspace_id AND c.plugin_id='suinda-learning' AND c.kind='course'
      JOIN extension_record_versions cv ON cv.record_id=c.id AND cv.revision=c.revision
      WHERE l.id=$1 AND l.workspace_id=$2 AND l.plugin_id='suinda-learning' AND l.kind='lesson' AND lv.state='published'
        AND cv.state=ANY(ARRAY['published','enrollment_open','in_progress','closed','completed'])
        AND COALESCE(NULLIF(mv.payload->>'course_version','')::int,0)=COALESCE(NULLIF(cv.payload->>'version','')::int,0)`, [lessonId, workspace]);
    if (!target) return fail("Aula publicada não encontrada neste workspace.", 404);
    const entitled = await this.db.one<{ allowed: boolean }>(`SELECT EXISTS(SELECT 1 FROM suinda_subscriptions s
      JOIN extension_records p ON p.id=s.plan_record_id AND p.workspace_id=s.workspace_id
      JOIN extension_record_versions pv ON pv.record_id=p.id AND pv.revision=p.revision
      WHERE s.id=$1 AND s.workspace_id=$2 AND s.user_id=$3 AND s.state='active' AND s.starts_at<=now() AND s.ends_at>now()
        AND pv.payload->'course_record_ids' ? $4) AS allowed`, [subscriptionId, workspace, user, target.course_id]);
    if (!entitled?.allowed) fail("Uma assinatura ativa que inclui este curso é necessária.", 403);
    const tree = await this.content(workspace, target.course_id, user);
    const visible = tree.modules.some((module) => module.lessons.some((lesson) => lesson.id === lessonId));
    if (!visible) fail("Esta aula ainda está bloqueada por pré-requisitos, sequência ou data de liberação.", 409);
    const result = await this.transaction(async (client) => {
      const locked = (await client.query<Subscription>(`SELECT s.* FROM suinda_subscriptions s JOIN extension_records p ON p.id=s.plan_record_id AND p.workspace_id=s.workspace_id
        JOIN extension_record_versions pv ON pv.record_id=p.id AND pv.revision=p.revision
        WHERE s.id=$1 AND s.workspace_id=$2 AND s.user_id=$3 AND s.state='active' AND s.starts_at<=now() AND s.ends_at>now()
          AND pv.payload->'course_record_ids' ? $4 FOR UPDATE OF s`, [subscriptionId, workspace, user, target.course_id])).rows[0];
      if (!locked) fail("A assinatura não está ativa ou não inclui este curso.", 403);
      const previous = (await client.query<{ lesson_record_id: string }>("SELECT lesson_record_id FROM suinda_subscription_lesson_progress WHERE subscription_id=$1 AND operation_key=$2", [subscriptionId, operationKey])).rows[0];
      if (previous && previous.lesson_record_id !== lessonId) fail("A chave de operação já foi usada para outra aula.", 409);
      if (previous) return { already_completed: true };
      const inserted = await client.query(`INSERT INTO suinda_subscription_lesson_progress(workspace_id,subscription_id,user_id,course_record_id,course_version,lesson_record_id,operation_key)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,user_id,course_record_id,course_version,lesson_record_id) DO NOTHING RETURNING id`,
      [workspace, subscriptionId, user, target.course_id, target.course_version, lessonId, operationKey]);
      return { already_completed: inserted.rows.length === 0 };
    });
    await this.access.audit(user, "suinda.subscriptions.lesson_completed", lessonId, { type: "workspace", id: workspace });
    return { ok: true, lesson_record_id: lessonId, ...result };
  }
}

@Controller("extensions/suinda-subscriptions")
export class SuindaSubscriptionsController {
  constructor(@Inject(SuindaSubscriptionsService) private readonly service: SuindaSubscriptionsService) {}
  @Get("workspaces/:workspaceId/plans") plans(@Req() req: AccessRequest, @Param("workspaceId") workspace: string) { return this.service.listPlans(workspace, String(req.orbitUser)); }
  @Get("me/subscriptions") mine(@Req() req: AccessRequest) { return this.service.listMine(String(req.orbitUser)); }
  @Post("me/plans/:planId/subscribe") request(@Req() req: AccessRequest, @Param("planId") planId: string, @Body() body: Payload) { return this.service.request(String(body.workspace_id || ""), planId, String(req.orbitUser), String(body.operation_key || "")); }
  @Post("workspaces/:workspaceId/subscriptions/:subscriptionId/confirm") confirm(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Param("subscriptionId") id: string, @Body() body: Payload) { return this.service.confirm(workspace, id, String(req.orbitUser), body); }
  @Post("me/subscriptions/:subscriptionId/cancel") cancel(@Req() req: AccessRequest, @Param("subscriptionId") id: string, @Body() body: Payload) { return this.service.cancel(id, String(req.orbitUser), String(body.operation_key || "")); }
  @Get("workspaces/:workspaceId/content/:recordId") content(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Param("recordId") id: string) { return this.service.content(workspace, id, String(req.orbitUser)); }
  @Get("workspaces/:workspaceId/subscriptions/:subscriptionId/courses/:courseId/lessons/:lessonId/attachments/:revision/:attachmentId/preview") async previewAttachment(
    @Req() req: AccessRequest, @Res() res: Response, @Param("workspaceId") workspace: string, @Param("subscriptionId") subscription: string,
    @Param("courseId") course: string, @Param("lessonId") lesson: string, @Param("revision") revision: string, @Param("attachmentId") attachment: string,
  ) {
    const file = await this.service.attachment(workspace, subscription, course, lesson, Number(revision), attachment, String(req.orbitUser));
    res.setHeader("Content-Type", file.mime_type); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin"); res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`); res.send(file.data);
  }
  @Get("workspaces/:workspaceId/subscriptions/:subscriptionId/courses/:courseId/lessons/:lessonId/attachments/:revision/:attachmentId/download") async downloadAttachment(
    @Req() req: AccessRequest, @Res() res: Response, @Param("workspaceId") workspace: string, @Param("subscriptionId") subscription: string,
    @Param("courseId") course: string, @Param("lessonId") lesson: string, @Param("revision") revision: string, @Param("attachmentId") attachment: string,
  ) {
    const file = await this.service.attachment(workspace, subscription, course, lesson, Number(revision), attachment, String(req.orbitUser), true);
    res.setHeader("Content-Type", file.mime_type); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`); res.send(file.data);
  }
  @Post("workspaces/:workspaceId/subscriptions/:subscriptionId/lessons/:lessonId/complete") completeLesson(
    @Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Param("subscriptionId") subscription: string,
    @Param("lessonId") lesson: string, @Body() body: Payload,
  ) { return this.service.completeLesson(workspace, subscription, lesson, String(req.orbitUser), String(body.operation_key || "")); }
}
