import assert from "node:assert/strict";
import test from "node:test";
import { buildInstallmentSchedule, summarizeInstallmentArrears } from "./finance";

test("uses creation date for legacy enrollments without submission timestamp", () => {
  const schedule = buildInstallmentSchedule({
    principal: 100,
    installmentCount: 2,
    firstDueDays: 0,
    intervalDays: 30,
    createdAt: "2026-01-01T12:00:00.000Z",
    coveredAmount: 25,
    currency: "BRL",
    now: Date.parse("2026-01-15T00:00:00.000Z"),
  });

  assert.equal(schedule.length, 2);
  assert.equal(schedule[0].amount, 50);
  assert.equal(schedule[0].covered_amount, 25);
  assert.equal(schedule[0].status, "partial");
  assert.equal(schedule[0].due_at, "2026-01-01T12:00:00.000Z");
  assert.equal(schedule[1].due_at, "2026-01-31T12:00:00.000Z");
});

test("splits cents without losing value and applies credits to oldest installments", () => {
  const schedule = buildInstallmentSchedule({
    principal: 10,
    installmentCount: 3,
    firstDueDays: 10,
    intervalDays: 30,
    submittedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2025-12-01T00:00:00.000Z",
    coveredAmount: 3.34,
    currency: "BRL",
    now: Date.parse("2026-01-01T00:00:00.000Z"),
  });

  assert.deepEqual(schedule.map((item) => item.amount), [3.34, 3.33, 3.33]);
  assert.deepEqual(schedule.map((item) => item.covered_amount), [3.34, 0, 0]);
  assert.deepEqual(schedule.map((item) => item.status), ["paid", "upcoming", "upcoming"]);
  assert.equal(schedule.reduce((total, item) => total + item.amount, 0), 10);
  assert.equal(schedule[0].due_at, "2026-01-11T00:00:00.000Z");
});

test("does not fabricate a due date when both enrollment dates are invalid", () => {
  assert.deepEqual(buildInstallmentSchedule({
    principal: 10,
    installmentCount: 1,
    firstDueDays: 0,
    intervalDays: 30,
    submittedAt: "invalid",
    createdAt: null,
    coveredAmount: 0,
    currency: "BRL",
  }), []);
});

test("calculates arrears by due date and unpaid cents, including a partially covered installment", () => {
  const result = summarizeInstallmentArrears({
    principal: 100,
    installmentCount: 2,
    firstDueDays: 0,
    intervalDays: 30,
    submittedAt: "2026-01-01T00:00:00.000Z",
    coveredAmount: 40,
    currency: "BRL",
    now: Date.parse("2026-01-15T00:00:00.000Z"),
  });
  assert.deepEqual(result, {
    overdue_installment_count: 1,
    overdue_balance: 10,
    oldest_overdue_at: "2026-01-01T00:00:00.000Z",
  });
});

test("does not call future installments overdue even while the total balance remains", () => {
  assert.deepEqual(summarizeInstallmentArrears({
    principal: 120,
    installmentCount: 3,
    firstDueDays: 15,
    intervalDays: 30,
    submittedAt: "2026-01-01T00:00:00.000Z",
    coveredAmount: 0,
    currency: "BRL",
    now: Date.parse("2026-01-10T00:00:00.000Z"),
  }), { overdue_installment_count: 0, overdue_balance: 0, oldest_overdue_at: null });
});
