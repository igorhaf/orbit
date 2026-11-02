import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AccessRequest } from "../access/access";
import { AccessService } from "../access/access";
import { Db } from "../db";
import type { PluginDefinition } from "./contract";
import { PluginRegistry } from "../execution/registries";

const PLUGIN_ID = "suinda-financial-negotiation";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type CaseStatus = "pending_institution" | "pending_student" | "agreed_draft" | "agreed_formalized" | "declined" | "withdrawn";
type Terms = { requested_total_amount: number; currency: string; installment_count: number; first_due_on: string; interval_days: number;
  current_balance_snapshot: number; payment_count_snapshot: number; enrollment_state_snapshot: string; course_revision_snapshot: number;
  enrollment_revision_snapshot: number };
type CaseRow = { id: string; workspace_id: string; enrollment_id: string; learner_user_id: string; request_type: "negotiation" | "renegotiation";
  status: CaseStatus; latest_terms: Terms; revision: number; created_at: string; updated_at: string };
type FinancialSnapshot = { enrollment: Record<string, unknown>; course: Record<string, unknown>; balance: number; currency: string;
  payment_count: number; enrollment_state: string; course_revision: number; enrollment_revision: number };

function fail(message: string, status = 400): never { throw new HttpException({ message }, status); }
function validId(value: unknown, label = "Identificador") {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} inválido.`);
  return value;
}
function only(input: unknown, allowed: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Dados financeiros inválidos.");
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail("A solicitação contém campos desconhecidos.");
  return input as Record<string, unknown>;
}
function amount(value: unknown, label = "Valor negociado") {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000_000) fail(`${label} deve ser maior que zero e não exceder 10.000.000.`);
  return Math.round(parsed * 100) / 100;
}

type CaseCursor = { created_at: string; id: string };
function parseCasePage(cursorInput?: string, requestedLimit?: string | number) {
  const limit = requestedLimit === undefined ? 50 : Number(requestedLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("O limite deve estar entre 1 e 100.");
  let cursor: CaseCursor | null = null;
  if (cursorInput) {
    try {
      const decoded = JSON.parse(Buffer.from(cursorInput, "base64url").toString("utf8")) as Record<string, unknown>;
      const date = typeof decoded.created_at === "string" ? new Date(decoded.created_at) : null;
      if (typeof decoded.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(decoded.created_at)
        || !date || !Number.isFinite(date.getTime()) || `${date.toISOString().slice(0, 23)}Z` !== decoded.created_at.slice(0, 23) + "Z"
        || typeof decoded.id !== "string" || !ID.test(decoded.id)) throw new Error("invalid cursor");
      cursor = { created_at: decoded.created_at, id: decoded.id };
    } catch { fail("Cursor da fila financeira inválido."); }
  }
  return { cursor, limit };
}

function caseCursor(row: CaseRow & { _cursor_created_at: string }) {
  return Buffer.from(JSON.stringify({ created_at: row._cursor_created_at, id: row.id }), "utf8").toString("base64url");
}

export function buildNegotiationTerms(input: Record<string, unknown>, balance: number, currency: string, now = Date.now(),
  snapshot: { paymentCount?: number; enrollmentState?: string; courseRevision?: number; enrollmentRevision?: number } = {}): Terms {
  const requested = amount(input.requested_total_amount);
  if (requested > balance + 0.005) fail("O valor proposto não pode superar o saldo em aberto atual.", 409);
  const installmentCount = Number(input.installment_count);
  const intervalDays = Number(input.interval_days);
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 24) fail("A proposta deve conter de 1 a 24 parcelas.");
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) fail("O intervalo deve ficar entre 1 e 365 dias.");
  if (typeof input.first_due_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.first_due_on)) fail("Informe o vencimento da primeira parcela em AAAA-MM-DD.");
  const due = new Date(`${input.first_due_on}T12:00:00.000Z`);
  if (!Number.isFinite(due.getTime()) || due.toISOString().slice(0, 10) !== input.first_due_on
    || due.getTime() < now - 86_400_000 || due.getTime() > now + 90 * 86_400_000) {
    fail("O primeiro vencimento deve estar entre hoje e 90 dias.");
  }
  return { requested_total_amount: requested, currency, installment_count: installmentCount, first_due_on: input.first_due_on,
    interval_days: intervalDays, current_balance_snapshot: Math.round(balance * 100) / 100,
    payment_count_snapshot: snapshot.paymentCount ?? 0, enrollment_state_snapshot: snapshot.enrollmentState ?? "",
    course_revision_snapshot: snapshot.courseRevision ?? 0, enrollment_revision_snapshot: snapshot.enrollmentRevision ?? 0 };
}
export function financialSnapshotMatches(terms: Terms, snapshot: FinancialSnapshot, now = Date.now()) {
  const firstDue = Date.parse(`${terms.first_due_on}T12:00:00.000Z`);
  return Math.abs(snapshot.balance - terms.current_balance_snapshot) <= 0.005
    && snapshot.payment_count === terms.payment_count_snapshot
    && snapshot.enrollment_state === terms.enrollment_state_snapshot
    && snapshot.course_revision === terms.course_revision_snapshot
    && snapshot.enrollment_revision === terms.enrollment_revision_snapshot
    && terms.requested_total_amount <= snapshot.balance + 0.005
    && terms.currency === snapshot.currency
    && Number.isFinite(firstDue) && firstDue >= now - 86_400_000 && firstDue <= now + 90 * 86_400_000;
}
export function buildFormalAgreementInstallments(terms: Terms) {
  const cents = Math.round(terms.requested_total_amount * 100);
  const base = Math.floor(cents / terms.installment_count);
  const remainder = cents % terms.installment_count;
  const firstDue = Date.parse(`${terms.first_due_on}T12:00:00.000Z`);
  return Array.from({ length: terms.installment_count }, (_, index) => ({
    installment_number: index + 1,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
    currency: terms.currency,
    due_on: new Date(firstDue + index * terms.interval_days * 86_400_000).toISOString().slice(0, 10),
  }));
}

export function institutionNegotiationDecision(action: unknown, currentStatus: CaseStatus) {
  if (currentStatus !== "pending_institution") fail("A proposta não está aguardando a instituição.", 409);
  if (action === "approve_draft") return { status: "pending_student" as const, eventType: "institution_accepted_draft" };
  if (action === "counteroffer") return { status: "pending_student" as const, eventType: "counterproposal" };
  if (action === "decline") return { status: "declined" as const, eventType: "institution_declined" };
  fail("Ação institucional inválida.");
}

export function learnerNegotiationDecision(action: unknown, currentStatus: CaseStatus) {
  if (action === "accept_draft" && currentStatus === "pending_student") return { status: "agreed_formalized" as const, eventType: "learner_accepted_and_formalized" };
  if (action === "decline" && currentStatus === "pending_student") return { status: "declined" as const, eventType: "learner_declined" };
  if (action === "withdraw" && currentStatus === "pending_institution") return { status: "withdrawn" as const, eventType: "learner_withdrew" };
  fail("Esta ação não está disponível para o estado atual da proposta.", 409);
}

export const suindaFinancialNegotiationPlugin: PluginDefinition = {
  id: PLUGIN_ID,
  name: "Suindá · Negociação financeira",
  version: "1.0.0",
  description: "Propostas financeiras auditáveis e isoladas do ledger de pagamentos do Suindá.",
  scope: "workspace",
  parentPlugin: "suinda-learning",
  dependencies: ["suinda-learning"],
  capabilities: [
    { id: "read", name: "Consultar propostas financeiras", permissions: [`plugin.${PLUGIN_ID}.read`] },
    { id: "write", name: "Registrar propostas financeiras", permissions: [`plugin.${PLUGIN_ID}.write`] },
  ],
  handlesRoute: (path) => /^\/extensions\/suinda-financial-negotiation\/(?:me\/(?:cases|enrollments\/[0-9a-f-]{36}\/cases|cases\/[0-9a-f-]{36}\/respond)|workspaces\/[0-9a-f-]{36}\/cases(?:\/[0-9a-f-]{36}\/respond)?)$/.test(path),
  routePermission: () => null,
};

@Injectable()
export class SuindaFinancialNegotiationService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly registry: PluginRegistry) {}

  private assertAvailable() {
    if (!this.registry.isEnabled(PLUGIN_ID)) fail("O plugin de negociação financeira está desativado.", 503);
  }

  private async manager(userId: string, workspaceId: string) {
    const workspace = validId(workspaceId, "Workspace");
    const exists = await this.db.one<{ id: string }>("SELECT id FROM workspaces WHERE id=$1", [workspace]);
    if (!exists) fail("Workspace não encontrado.", 404);
    if (!await this.access.has(userId, "plugin.suinda-learning.manage", "workspace", workspace)
      && !await this.access.has(userId, "plugin.suinda-learning.manage")) {
      await this.access.audit(userId, "access.denied", `${PLUGIN_ID}.workspace.read`, { type: "workspace", id: workspace });
      fail("A gestão financeira deste workspace não está autorizada.", 403);
    }
    return workspace;
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.db.pool.connect();
    try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async snapshot(client: PoolClient, workspaceId: string, enrollmentId: string, learnerId: string, requestType: string): Promise<FinancialSnapshot> {
    const row = (await client.query<{ enrollment: Record<string, unknown>; enrollment_state: string; course: Record<string, unknown>; paid: string;
      payment_count: number; course_revision: number; enrollment_revision: number }>(
      `SELECT e.payload AS enrollment,e.state AS enrollment_state,e.revision AS enrollment_revision,
         COALESCE(NULLIF(e.payload->>'course_revision','')::int,cv.revision) AS course_revision,cv.payload AS course,
         COALESCE(SUM(CASE WHEN p.payload->>'payment_method'='refund' THEN -1 ELSE 1 END * NULLIF(p.payload->>'amount','')::numeric),0)::text AS paid,
         COUNT(p.id)::int AS payment_count
       FROM extension_records e
       JOIN extension_records c ON c.id::text=e.payload->>'course_record_id' AND c.workspace_id=e.workspace_id
         AND c.plugin_id='suinda-learning' AND c.kind='course'
       JOIN extension_record_versions cv ON cv.record_id=c.id AND cv.revision=COALESCE(NULLIF(e.payload->>'course_revision','')::int,c.revision)
       LEFT JOIN extension_records p ON p.workspace_id=e.workspace_id AND p.plugin_id='suinda-learning' AND p.kind='payment_entry'
         AND p.state='recorded' AND p.payload->>'enrollment_record_id'=e.id::text
       WHERE e.id=$1 AND e.workspace_id=$2 AND e.plugin_id='suinda-learning' AND e.kind='enrollment'
         AND e.payload->>'learner_user_id'=$3
       GROUP BY e.id,cv.record_id,cv.revision,cv.payload`, [enrollmentId, workspaceId, learnerId],
    )).rows[0];
    if (!row) fail("Matrícula não encontrada neste workspace.", 404);
    const enrollment = row.enrollment;
    const state = String(row.enrollment_state || "");
    if (!["submitted", "approved", "enrolled", "active", "paused"].includes(state)) {
      fail("A matrícula não está em um estado financeiro elegível.", 409);
    }
    const base = Number(enrollment.amount_due ?? row.course.price_amount ?? 0);
    const balance = Math.max(0, Math.round((base - Number(row.paid || 0)) * 100) / 100);
    if (!Number.isFinite(balance) || balance <= 0.005) fail("A matrícula não possui saldo em aberto para negociar.", 409);
    const currency = String(row.course.currency || enrollment.amount_due_currency || "BRL").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) fail("A moeda da matrícula não é válida.", 409);
    if (requestType === "renegotiation" && Number(row.course.installment_count || 1) <= 1 && row.payment_count === 0) {
      fail("Renegociação de parcelas exige parcelamento anterior ou baixa financeira registrada.", 409);
    }
    return { enrollment, course: row.course, balance, currency, payment_count: row.payment_count,
      enrollment_state: state, course_revision: row.course_revision, enrollment_revision: row.enrollment_revision };
  }

  private normalizeTerms(input: Record<string, unknown>, snapshot: FinancialSnapshot) {
    return buildNegotiationTerms(input, snapshot.balance, snapshot.currency, Date.now(), {
      paymentCount: snapshot.payment_count, enrollmentState: snapshot.enrollment_state,
      courseRevision: snapshot.course_revision, enrollmentRevision: snapshot.enrollment_revision,
    });
  }

  private async appendEvent(client: PoolClient, args: { caseId: string; workspaceId: string; actorId: string; operationKey: string;
    eventType: string; terms: Terms; notes?: string | null; sequence: number }) {
    await client.query(
      `INSERT INTO suinda_financial_negotiation_events(case_id,workspace_id,sequence,actor_id,event_type,terms,notes,operation_key)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [args.caseId, args.workspaceId, args.sequence, args.actorId, args.eventType, JSON.stringify(args.terms), args.notes || null, args.operationKey],
    );
    await client.query(
      "INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,'workspace',$4)",
      [args.actorId, `${PLUGIN_ID}.${args.eventType}`, args.caseId, args.workspaceId],
    );
  }

  async request(enrollmentId: string, userId: string, input: unknown) {
    this.assertAvailable();
    const body = only(input, ["operation_key", "request_type", "requested_total_amount", "installment_count", "first_due_on", "interval_days", "notes"]);
    const operationKey = validId(body.operation_key, "Chave de operação");
    const target = validId(enrollmentId, "Matrícula");
    const requestType = body.request_type;
    if (requestType !== "negotiation" && requestType !== "renegotiation") fail("Tipo de proposta inválido.");
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : "";
    return this.transaction(async (client) => {
      const prior = (await client.query<CaseRow>(
        `SELECT c.* FROM suinda_financial_negotiation_cases c JOIN suinda_financial_negotiation_events e ON e.case_id=c.id
         WHERE c.workspace_id IN (SELECT workspace_id FROM extension_records WHERE id=$1 AND kind='enrollment')
           AND e.actor_id=$2 AND e.operation_key=$3 AND e.event_type='requested' LIMIT 1`, [target, userId, operationKey],
      )).rows[0];
      if (prior) return this.detail(client, prior.id, prior.workspace_id);
      const header = (await client.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM extension_records WHERE id=$1 AND plugin_id='suinda-learning' AND kind='enrollment' AND payload->>'learner_user_id'=$2 FOR UPDATE",
        [target, userId],
      )).rows[0];
      if (!header) fail("Matrícula não encontrada.", 404);
      const snapshot = await this.snapshot(client, header.workspace_id, target, userId, requestType);
      const terms = this.normalizeTerms(body, snapshot);
      const open = (await client.query<{ id: string }>(
        `SELECT id FROM suinda_financial_negotiation_cases WHERE workspace_id=$1 AND enrollment_id=$2
         AND status IN ('pending_institution','pending_student') LIMIT 1 FOR UPDATE`, [header.workspace_id, target],
      )).rows[0];
      if (open) fail("Já existe uma proposta financeira aguardando resposta nesta matrícula.", 409);
      const caseId = randomUUID();
      const inserted = (await client.query<CaseRow>(
        `INSERT INTO suinda_financial_negotiation_cases(id,workspace_id,enrollment_id,learner_user_id,request_type,status,latest_terms,revision)
         VALUES($1,$2,$3,$4,$5,'pending_institution',$6::jsonb,1) RETURNING *`,
        [caseId, header.workspace_id, target, userId, requestType, JSON.stringify(terms)],
      )).rows[0];
      await this.appendEvent(client, { caseId, workspaceId: header.workspace_id, actorId: userId, operationKey,
        eventType: "requested", terms, notes, sequence: 1 });
      return inserted;
    });
  }

  private async detail(client: PoolClient, caseId: string, workspaceId: string) {
    const row = (await client.query<CaseRow>("SELECT * FROM suinda_financial_negotiation_cases WHERE id=$1 AND workspace_id=$2", [caseId, workspaceId])).rows[0];
    if (!row) fail("Proposta não encontrada.", 404);
    const events = (await client.query("SELECT sequence,event_type,terms,notes,actor_id,created_at FROM suinda_financial_negotiation_events WHERE case_id=$1 AND workspace_id=$2 ORDER BY sequence", [caseId, workspaceId])).rows;
    return { ...row, events };
  }

  async ownCases(userId: string, enrollmentId?: string, cursorInput?: string, requestedLimit?: string | number, paginated = false) {
    this.assertAvailable();
    const { cursor, limit } = paginated ? parseCasePage(cursorInput, requestedLimit) : { cursor: null, limit: 0 };
    const params: unknown[] = [userId];
    const filter = enrollmentId ? " AND enrollment_id=$2" : "";
    if (enrollmentId) params.push(validId(enrollmentId, "Matrícula"));
    const total = await this.db.one<{ total: string | number }>(
      `SELECT count(*)::int AS total FROM suinda_financial_negotiation_cases WHERE learner_user_id=$1${filter}`, params);
    const cursorIndex = params.length + 1;
    const idIndex = params.length + 2;
    const limitIndex = params.length + 3;
    const rows = await this.db.query<CaseRow & { _cursor_created_at: string }>(
      `SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_created_at
       FROM suinda_financial_negotiation_cases WHERE learner_user_id=$1${filter}
       AND ($${cursorIndex}::timestamptz IS NULL OR (created_at,id)<($${cursorIndex}::timestamptz,$${idIndex}::uuid))
       ORDER BY created_at DESC,id DESC${paginated ? ` LIMIT $${limitIndex}` : ""}`,
      paginated ? [...params, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1] : [...params, null, null]);
    const hasMore = paginated && rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const result = [];
    for (const row of page) {
      const events = await this.db.query(`SELECT sequence,event_type,terms,notes,actor_id,created_at FROM suinda_financial_negotiation_events WHERE case_id=$1 AND workspace_id=$2 ORDER BY sequence`, [row.id, row.workspace_id]);
      result.push({ ...row, events });
    }
    return paginated ? { items: result, total: Number(total?.total || 0), has_more: hasMore,
      next_cursor: hasMore && page.length ? caseCursor(page[page.length - 1]) : null, limit } : result;
  }

  async workspaceCases(workspaceId: string, userId: string, cursorInput?: string, requestedLimit?: string | number, paginated = false) {
    this.assertAvailable();
    const { cursor, limit } = paginated ? parseCasePage(cursorInput, requestedLimit) : { cursor: null, limit: 0 };
    const workspace = await this.manager(userId, workspaceId);
    const total = await this.db.one<{ total: string | number }>(
      "SELECT count(*)::int AS total FROM suinda_financial_negotiation_cases WHERE workspace_id=$1", [workspace]);
    const rows = await this.db.query<CaseRow & { learner_name: string; _cursor_created_at: string }>(
      `SELECT c.*,u.name AS learner_name,to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_created_at
       FROM suinda_financial_negotiation_cases c
       JOIN users u ON u.id=c.learner_user_id WHERE c.workspace_id=$1
       AND ($2::timestamptz IS NULL OR (c.created_at,c.id)<($2::timestamptz,$3::uuid))
       ORDER BY c.created_at DESC,c.id DESC${paginated ? " LIMIT $4" : ""}`,
      paginated ? [workspace, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1] : [workspace, null, null]);
    const hasMore = paginated && rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return paginated ? { items: page, total: Number(total?.total || 0), has_more: hasMore,
      next_cursor: hasMore && page.length ? caseCursor(page[page.length - 1]) : null, limit } : page;
  }

  async respondAsInstitution(workspaceId: string, caseId: string, userId: string, input: unknown) {
    this.assertAvailable();
    const workspace = await this.manager(userId, workspaceId);
    const body = only(input, ["operation_key", "expected_revision", "action", "requested_total_amount", "installment_count", "first_due_on", "interval_days", "notes"]);
    const operationKey = validId(body.operation_key, "Chave de operação");
    const expected = Number(body.expected_revision);
    if (!Number.isInteger(expected) || expected < 1) fail("Informe a revisão exibida na proposta.");
    const action = body.action;
    if (!(["approve_draft", "counteroffer", "decline"] as unknown[]).includes(action)) fail("Ação institucional inválida.");
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : "";
    return this.transaction(async (client) => {
      const row = (await client.query<CaseRow>("SELECT * FROM suinda_financial_negotiation_cases WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [validId(caseId, "Proposta"), workspace])).rows[0];
      if (!row) fail("Proposta não encontrada neste workspace.", 404);
      if (await this.hasOperation(client, row.id, operationKey)) return this.detail(client, row.id, workspace);
      if (row.revision !== expected) fail("A proposta mudou. Atualize antes de responder.", 409);
      if (row.status !== "pending_institution") fail("A proposta não está aguardando a instituição.", 409);
      const snapshot = await this.snapshot(client, workspace, row.enrollment_id, row.learner_user_id, row.request_type);
      let terms = row.latest_terms;
      const decision = institutionNegotiationDecision(action, row.status);
      const status: CaseStatus = decision.status;
      const eventType = decision.eventType;
      if (action === "counteroffer") {
        terms = this.normalizeTerms(body, snapshot);
      }
      const updated = (await client.query<CaseRow>(
        `UPDATE suinda_financial_negotiation_cases SET status=$3,latest_terms=$4::jsonb,revision=revision+1,updated_at=now()
         WHERE id=$1 AND workspace_id=$2 RETURNING *`, [row.id, workspace, status, JSON.stringify(terms)])).rows[0];
      await this.appendEvent(client, { caseId: row.id, workspaceId: workspace, actorId: userId, operationKey, eventType, terms, notes, sequence: expected + 1 });
      return this.detail(client, updated.id, workspace);
    });
  }

  private async hasOperation(client: PoolClient, caseId: string, operationKey: string) {
    return Boolean((await client.query("SELECT id FROM suinda_financial_negotiation_events WHERE case_id=$1 AND operation_key=$2", [caseId, operationKey])).rows[0]);
  }

  async respondAsLearner(caseId: string, userId: string, input: unknown) {
    this.assertAvailable();
    const body = only(input, ["operation_key", "expected_revision", "action", "notes"]);
    const operationKey = validId(body.operation_key, "Chave de operação");
    const expected = Number(body.expected_revision);
    if (!Number.isInteger(expected) || expected < 1) fail("Informe a revisão exibida na proposta.");
    const action = body.action;
    if (!(["accept_draft", "decline", "withdraw"] as unknown[]).includes(action)) fail("Ação do aluno inválida.");
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : "";
    return this.transaction(async (client) => {
      const row = (await client.query<CaseRow>("SELECT * FROM suinda_financial_negotiation_cases WHERE id=$1 AND learner_user_id=$2 FOR UPDATE", [validId(caseId, "Proposta"), userId])).rows[0];
      if (!row) fail("Proposta não encontrada.", 404);
      if (await this.hasOperation(client, row.id, operationKey)) return this.detail(client, row.id, row.workspace_id);
      if (row.revision !== expected) fail("A proposta mudou. Atualize antes de responder.", 409);
      const decision = learnerNegotiationDecision(action, row.status);
      let agreement: { revision: number; effective_at: string } | null = null;
      if (action === "accept_draft") {
        const enrollment = (await client.query<{ id: string }>(
          `SELECT id FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id='suinda-learning'
           AND kind='enrollment' AND payload->>'learner_user_id'=$3 FOR UPDATE`, [row.enrollment_id, row.workspace_id, userId],
        )).rows[0];
        if (!enrollment) fail("A matrícula não está mais disponível para formalização.", 409);
        const snapshot = await this.snapshot(client, row.workspace_id, row.enrollment_id, userId, row.request_type);
        const terms = row.latest_terms;
        if (!financialSnapshotMatches(terms, snapshot)) {
          fail("O estado financeiro ou acadêmico mudou desde a proposta. Solicite uma proposta atualizada antes de aceitar.", 409);
        }
        const currentRevision = (await client.query<{ revision: number }>(
          "SELECT COALESCE(MAX(revision),0)::int AS revision FROM suinda_financial_agreements WHERE workspace_id=$1 AND enrollment_id=$2",
          [row.workspace_id, row.enrollment_id],
        )).rows[0]?.revision || 0;
        const revision = currentRevision + 1;
        const insertedAgreement = (await client.query<{ revision: number; effective_at: string }>(
          `INSERT INTO suinda_financial_agreements(workspace_id,enrollment_id,case_id,learner_user_id,revision,source_case_revision,
             amount,currency,installment_count,first_due_on,interval_days,terms_snapshot,effective_at,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12::jsonb,now(),$13)
           RETURNING revision,effective_at`,
          [row.workspace_id, row.enrollment_id, row.id, userId, revision, expected, terms.requested_total_amount,
            terms.currency, terms.installment_count, terms.first_due_on, terms.interval_days, JSON.stringify(terms), userId],
        )).rows[0];
        for (const installment of buildFormalAgreementInstallments(terms)) {
          await client.query(
            `INSERT INTO suinda_financial_agreement_installments(workspace_id,enrollment_id,agreement_revision,installment_number,
               amount,currency,due_on,source_case_id)
             VALUES($1,$2,$3,$4,$5,$6,$7::date,$8)`,
            [row.workspace_id, row.enrollment_id, revision, installment.installment_number, installment.amount,
              installment.currency, installment.due_on, row.id],
          );
        }
        agreement = insertedAgreement;
      }
      const updated = (await client.query<CaseRow>(
        `UPDATE suinda_financial_negotiation_cases SET status=$3,revision=revision+1,updated_at=now()
         WHERE id=$1 AND workspace_id=$2 RETURNING *`, [row.id, row.workspace_id, decision.status])).rows[0];
      await this.appendEvent(client, { caseId: row.id, workspaceId: row.workspace_id, actorId: userId, operationKey,
        eventType: decision.eventType, terms: row.latest_terms, notes, sequence: expected + 1 });
      return { ...await this.detail(client, updated.id, row.workspace_id), agreement };
    });
  }
}

@Controller("extensions/suinda-financial-negotiation")
export class SuindaFinancialNegotiationController {
  constructor(@Inject(SuindaFinancialNegotiationService) private readonly service: SuindaFinancialNegotiationService) {}
  @Get("me/cases") ownCases(@Req() req: AccessRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.service.ownCases(String(req.orbitUser), undefined, cursor, limit, cursor !== undefined || limit !== undefined);
  }
  @Get("me/enrollments/:enrollmentId/cases") ownEnrollmentCases(@Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string,
    @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.service.ownCases(String(req.orbitUser), enrollmentId, cursor, limit, cursor !== undefined || limit !== undefined);
  }
  @Post("me/enrollments/:enrollmentId/cases") request(@Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string, @Body() body: unknown) {
    return this.service.request(enrollmentId, String(req.orbitUser), body);
  }
  @Post("me/cases/:caseId/respond") learnerRespond(@Req() req: AccessRequest, @Param("caseId") caseId: string, @Body() body: unknown) {
    return this.service.respondAsLearner(caseId, String(req.orbitUser), body);
  }
  @Get("workspaces/:workspaceId/cases") workspaceCases(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
    @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.service.workspaceCases(workspaceId, String(req.orbitUser), cursor, limit, cursor !== undefined || limit !== undefined);
  }
  @Post("workspaces/:workspaceId/cases/:caseId/respond") institutionRespond(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
    @Param("caseId") caseId: string, @Body() body: unknown) {
    return this.service.respondAsInstitution(workspaceId, caseId, String(req.orbitUser), body);
  }
}
