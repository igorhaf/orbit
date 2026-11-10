import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import {
  buildNegotiationTerms,
  buildFormalAgreementInstallments,
  financialSnapshotMatches,
  SuindaFinancialNegotiationService,
  institutionNegotiationDecision,
  learnerNegotiationDecision,
  suindaFinancialNegotiationPlugin,
} from "./suinda-financial-negotiation";
import { PluginRegistry } from "../execution/registries";

const now = Date.parse("2026-10-24T12:00:00.000Z");
const validTerms = {
  requested_total_amount: 500,
  installment_count: 5,
  first_due_on: "2026-11-01",
  interval_days: 30,
};

function assertHttpFailure(run: () => unknown, status: number) {
  assert.throws(run, (error: unknown) => error instanceof HttpException && error.getStatus() === status);
}

test("builds bounded terms using the enrollment currency and balance snapshot", () => {
  assert.deepEqual(buildNegotiationTerms(validTerms, 800, "BRL", now), {
    requested_total_amount: 500,
    currency: "BRL",
    installment_count: 5,
    first_due_on: "2026-11-01",
    interval_days: 30,
    current_balance_snapshot: 800,
    payment_count_snapshot: 0,
    enrollment_state_snapshot: "",
    course_revision_snapshot: 0,
    enrollment_revision_snapshot: 0,
  });
});

test("rejects proposals above the balance, invalid installment counts, and distant/invalid dates", () => {
  assertHttpFailure(() => buildNegotiationTerms({ ...validTerms, requested_total_amount: 800.01 }, 800, "BRL", now), 409);
  assertHttpFailure(() => buildNegotiationTerms({ ...validTerms, installment_count: 25 }, 800, "BRL", now), 400);
  assertHttpFailure(() => buildNegotiationTerms({ ...validTerms, first_due_on: "2026-02-30" }, 800, "BRL", now), 400);
  assertHttpFailure(() => buildNegotiationTerms({ ...validTerms, first_due_on: "2027-02-01" }, 800, "BRL", now), 400);
});

test("institution decisions require a pending institution proposal", () => {
  assert.deepEqual(institutionNegotiationDecision("counteroffer", "pending_institution"), {
    status: "pending_student", eventType: "counterproposal",
  });
  assert.deepEqual(institutionNegotiationDecision("approve_draft", "pending_institution"), {
    status: "pending_student", eventType: "institution_accepted_draft",
  });
  assertHttpFailure(() => institutionNegotiationDecision("counteroffer", "pending_student"), 409);
});

test("learner can accept or decline a reviewed draft, or withdraw a pending request", () => {
  assert.deepEqual(learnerNegotiationDecision("accept_draft", "pending_student"), {
    status: "agreed_formalized", eventType: "learner_accepted_and_formalized",
  });
  assert.deepEqual(learnerNegotiationDecision("withdraw", "pending_institution"), {
    status: "withdrawn", eventType: "learner_withdrew",
  });
  assertHttpFailure(() => learnerNegotiationDecision("accept_draft", "pending_institution"), 409);
});

test("formal agreement installments conserve cents and stale snapshots cannot be accepted", () => {
  const terms = buildNegotiationTerms({ ...validTerms, requested_total_amount: 500.02 }, 800, "BRL", now,
    { paymentCount: 2, enrollmentState: "active", courseRevision: 3, enrollmentRevision: 8 });
  const installments = buildFormalAgreementInstallments(terms);
  assert.deepEqual(installments.map((row) => row.amount), [100.01, 100.01, 100, 100, 100]);
  assert.equal(installments.reduce((sum, row) => sum + Math.round(row.amount * 100), 0), 50002);
  assert.equal(installments[0].due_on, "2026-11-01");
  const snapshot = { enrollment: {}, course: {}, balance: 800, currency: "BRL", payment_count: 2,
    enrollment_state: "active", course_revision: 3, enrollment_revision: 8 };
  assert.equal(financialSnapshotMatches(terms, snapshot, now), true);
  assert.equal(financialSnapshotMatches(terms, { ...snapshot, balance: 799.99 }, now), false);
  assert.equal(financialSnapshotMatches(terms, { ...snapshot, payment_count: 3 }, now), false);
  assert.equal(financialSnapshotMatches(terms, { ...snapshot, course_revision: 4 }, now), false);
  assert.equal(financialSnapshotMatches(terms, { ...snapshot, enrollment_revision: 9 }, now), false);
  assert.equal(financialSnapshotMatches(terms, snapshot, Date.parse("2027-01-01T00:00:00.000Z")), false);
});

function acceptanceHarness() {
  const caseId = "00000000-0000-4000-8000-000000000901";
  const workspaceId = "00000000-0000-4000-8000-000000000902";
  const enrollmentId = "00000000-0000-4000-8000-000000000903";
  const learnerId = "00000000-0000-4000-8000-000000000904";
  const terms = buildNegotiationTerms(validTerms, 800, "BRL", now,
    { paymentCount: 0, enrollmentState: "active", courseRevision: 1, enrollmentRevision: 8 });
  const negotiationCase = { id: caseId, workspace_id: workspaceId, enrollment_id: enrollmentId, learner_user_id: learnerId,
    request_type: "negotiation" as const, status: "pending_student" as "pending_student" | "agreed_formalized",
    latest_terms: terms, revision: 2, created_at: "2026-10-24T12:00:00.000Z", updated_at: "2026-10-24T12:00:00.000Z" };
  const events: Array<Record<string, unknown>> = [{ sequence: 1, event_type: "requested" }, { sequence: 2, event_type: "institution_accepted_draft" }];
  const agreements: unknown[] = [];
  const installmentRows: unknown[][] = [];
  const payments = [{ id: "existing-payment-ledger-row", amount: 50 }];
  const locks = new Map<string, Promise<void>>();
  async function acquire(key: string) {
    const previous = locks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    locks.set(key, previous.then(() => current)); await previous;
    return release;
  }
  const db = { pool: { async connect() {
    let releaseCase: (() => void) | undefined;
    return { async query(sql: string, values: unknown[] = []) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
        if (sql !== "BEGIN") { releaseCase?.(); releaseCase = undefined; }
        return { rows: [] };
      }
      if (sql.includes("FROM suinda_financial_negotiation_cases WHERE id=$1 AND learner_user_id=$2 FOR UPDATE")) {
        releaseCase = await acquire(`case:${caseId}`); return { rows: [negotiationCase] };
      }
      if (sql.includes("FROM suinda_financial_negotiation_events WHERE case_id=$1 AND operation_key=$2"))
        return { rows: events.some((event) => event.operation_key === values[1]) ? [{ id: "duplicate" }] : [] };
      if (sql.includes("FROM extension_records WHERE id=$1 AND workspace_id=$2") && sql.includes("FOR UPDATE")) return { rows: [{ id: enrollmentId }] };
      if (sql.includes("SELECT e.payload AS enrollment")) return { rows: [{ enrollment: { amount_due: 800 }, enrollment_state: "active",
        enrollment_revision: 8, course_revision: 1, course: { price_amount: 800, currency: "BRL" }, paid: "0", payment_count: 0 }] };
      if (sql.includes("SELECT COALESCE(MAX(revision),0)::int AS revision FROM suinda_financial_agreements")) return { rows: [{ revision: agreements.length }] };
      if (sql.includes("INSERT INTO suinda_financial_agreements")) {
        const agreement = { revision: values[4], effective_at: "2026-10-24T12:00:00.000Z" }; agreements.push(agreement); return { rows: [agreement] };
      }
      if (sql.includes("INSERT INTO suinda_financial_agreement_installments")) { installmentRows.push(values); return { rows: [] }; }
      if (sql.includes("UPDATE suinda_financial_negotiation_cases SET status=$3")) {
        negotiationCase.status = values[2] as typeof negotiationCase.status; negotiationCase.revision += 1; return { rows: [negotiationCase] };
      }
      if (sql.includes("INSERT INTO suinda_financial_negotiation_events")) {
        events.push({ sequence: values[2], event_type: values[4], operation_key: values[7] }); return { rows: [] };
      }
      if (sql.includes("INSERT INTO access_audit")) return { rows: [] };
      if (sql.includes("SELECT * FROM suinda_financial_negotiation_cases WHERE id=$1 AND workspace_id=$2")) return { rows: [negotiationCase] };
      if (sql.includes("SELECT sequence,event_type,terms,notes,actor_id,created_at FROM suinda_financial_negotiation_events")) return { rows: events };
      throw new Error(`Unexpected SQL in acceptance harness: ${sql}`);
    }, release() {} };
  } } };
  const registry = new PluginRegistry();
  registry.register({ id: "suinda-learning", name: "Suinda Learning", version: "1.0.0" } as never);
  registry.register(suindaFinancialNegotiationPlugin);
  const service = new SuindaFinancialNegotiationService(db as never, {} as never, registry);
  return { service, caseId, learnerId, agreements, installmentRows, payments, negotiationCase };
}

test("concurrent bilateral acceptance creates one formal schedule revision and never writes payment ledger", async () => {
  const harness = acceptanceHarness();
  const beforePayments = structuredClone(harness.payments);
  const attempts = await Promise.allSettled([
    harness.service.respondAsLearner(harness.caseId, harness.learnerId,
      { operation_key: "00000000-0000-4000-8000-000000000911", expected_revision: 2, action: "accept_draft" }),
    harness.service.respondAsLearner(harness.caseId, harness.learnerId,
      { operation_key: "00000000-0000-4000-8000-000000000912", expected_revision: 2, action: "accept_draft" }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  assert.equal(harness.agreements.length, 1);
  assert.equal(harness.installmentRows.length, 5);
  assert.deepEqual(harness.payments, beforePayments);
  assert.equal(harness.negotiationCase.status, "agreed_formalized");
  assert.equal(harness.negotiationCase.revision, 3);
});

test("child plugin only handles its own routes and keeps access checks in the service", () => {
  assert.equal(suindaFinancialNegotiationPlugin.handlesRoute?.("/extensions/suinda-financial-negotiation/me/cases"), true);
  assert.equal(suindaFinancialNegotiationPlugin.handlesRoute?.("/extensions/suinda-financial-negotiation/workspaces/abc/cases"), false);
  assert.equal(suindaFinancialNegotiationPlugin.handlesRoute?.("/extensions/other/me/cases"), false);
  assert.equal(suindaFinancialNegotiationPlugin.routePermission?.("/extensions/suinda-financial-negotiation/me/cases", "GET"), null);
  assert.equal(suindaFinancialNegotiationPlugin.parentPlugin, "suinda-learning");
});

test("financial negotiation learner lists return stable cursor pages with a complete total", async () => {
  const rows = Array.from({ length: 4 }, (_, index) => {
    const created_at = `2026-10-2${4 - index}T12:00:00.000Z`;
    return { id: `00000000-0000-4000-8000-00000000090${index + 1}`,
      workspace_id: "00000000-0000-4000-8000-000000000902", created_at,
      _cursor_created_at: created_at.replace(".000Z", ".000000Z") };
  });
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async one(sql: string) { calls.push({ sql, params: [] }); return { total: 4 }; },
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("FROM suinda_financial_negotiation_cases")) {
        const cursorIndex = params[1] ? rows.findIndex((row) => String(params[1]).startsWith(row.created_at.slice(0, 19))) + 1 : 0;
        return rows.slice(cursorIndex, cursorIndex + Number(params.at(-1)));
      }
      return [];
    },
  };
  const registry = new PluginRegistry();
  registry.register({ id: "suinda-learning", name: "Suinda Learning", version: "1.0.0" } as never);
  registry.register(suindaFinancialNegotiationPlugin);
  const service = new SuindaFinancialNegotiationService(db as never, {} as never, registry);
  const first = await service.ownCases("learner", undefined, undefined, 2, true) as {
    items: Array<{ id: string }>; total: number; has_more: boolean; next_cursor: string | null;
  };
  assert.deepEqual(first.items.map((row) => row.id), rows.slice(0, 2).map((row) => row.id));
  assert.equal(first.total, 4);
  assert.equal(first.has_more, true);
  assert.ok(first.next_cursor);
  const cursorQuery = calls.find((call) => call.sql.includes("ORDER BY created_at DESC,id DESC"));
  assert.match(cursorQuery!.sql, /\(created_at,id\)</);
  const second = await service.ownCases("learner", undefined, first.next_cursor!, 2, true) as {
    items: Array<{ id: string }>; has_more: boolean; next_cursor: string | null;
  };
  assert.deepEqual(second.items.map((row) => row.id), rows.slice(2).map((row) => row.id));
  assert.equal(second.has_more, false);
  assert.equal(second.next_cursor, null);
});

test("financial negotiation pages reject malformed cursors and limits", async () => {
  const registry = new PluginRegistry();
  registry.register({ id: "suinda-learning", name: "Suinda Learning", version: "1.0.0" } as never);
  registry.register(suindaFinancialNegotiationPlugin);
  const service = new SuindaFinancialNegotiationService({ async query() { return []; } } as never, {} as never, registry);
  await assert.rejects(() => service.ownCases("learner", undefined, "not-a-cursor", undefined, true), /Cursor da fila financeira inválido/);
  await assert.rejects(() => service.ownCases("learner", undefined, undefined, 101, true), /limite deve estar entre 1 e 100/);
});
