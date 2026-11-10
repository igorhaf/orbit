import assert from "node:assert/strict";
import test from "node:test";
import { postAgreementCoverage, projectStoredAgreementSchedule, summarizeStoredAgreementArrears } from "./suinda.service";

const now = Date.parse("2026-10-24T12:00:00.000Z");
const schedule = [
  { installment_number: 1, amount: 100, due_on: "2026-10-01" },
  { installment_number: 2, amount: 100, due_on: "2026-11-01" },
];

test("formal schedule projection uses immutable installment rows and current coverage", () => {
  const projected = projectStoredAgreementSchedule(schedule, 25, "BRL", now);
  assert.deepEqual(projected.map(({ number, amount, covered_amount, status }) => ({ number, amount, covered_amount, status })), [
    { number: 1, amount: 100, covered_amount: 25, status: "partial" },
    { number: 2, amount: 100, covered_amount: 0, status: "upcoming" },
  ]);
});

test("only payment entries dated on or after the active revision effective time cover its schedule", () => {
  const coverage = postAgreementCoverage([
    { paid_at: "2026-10-01T12:00:00.000Z", payment_method: "manual", amount: 100 },
    { paid_at: "2026-10-25T12:00:00.000Z", payment_method: "manual", amount: 75 },
    { paid_at: "2026-10-26T12:00:00.000Z", payment_method: "refund", amount: 25 },
  ], "2026-10-24T12:00:00.000Z");
  assert.equal(coverage, 50);
  assert.equal(summarizeStoredAgreementArrears(schedule, coverage, "BRL", now).overdue_balance, 50);
  assert.equal(postAgreementCoverage([{ paid_at: "invalid", amount: 100 }], "2026-10-24T12:00:00.000Z"), 0);
});
