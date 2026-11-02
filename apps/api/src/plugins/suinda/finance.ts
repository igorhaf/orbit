export type InstallmentStatus = "upcoming" | "overdue" | "partial" | "paid";

export interface InstallmentProjection {
  number: number;
  amount: number;
  covered_amount: number;
  currency: string;
  due_at: string;
  status: InstallmentStatus;
}

/**
 * Build an informational equal-installment schedule. Receipts and scholarship
 * credits are allocated to the oldest installment first. Legacy/imported
 * enrollments may not have submitted_at, so their record creation date is the
 * stable fallback rather than silently hiding the whole schedule.
 */
export function buildInstallmentSchedule(input: {
  principal: number;
  installmentCount: number;
  firstDueDays: number;
  intervalDays: number;
  submittedAt?: string | null;
  createdAt?: string | null;
  coveredAmount: number;
  currency: string;
  now?: number;
}): InstallmentProjection[] {
  if (!Number.isFinite(input.principal) || !Number.isFinite(input.coveredAmount)) return [];
  const principalCents = Math.max(0, Math.round(input.principal * 100));
  if (principalCents <= 0) return [];
  const anchor = Date.parse(input.submittedAt || "") || Date.parse(input.createdAt || "");
  if (!Number.isFinite(anchor)) return [];

  const count = Math.max(1, Math.min(24, Math.trunc(input.installmentCount) || 1));
  const firstDueDays = Math.max(0, Math.min(90, Math.trunc(input.firstDueDays) || 0));
  const intervalDays = Math.max(1, Math.min(365, Math.trunc(input.intervalDays) || 30));
  const paidCents = Math.max(0, Math.round(input.coveredAmount * 100));
  const baseCents = Math.floor(principalCents / count);
  const remainder = principalCents % count;
  let remainingCoverage = paidCents;
  const firstDueAt = anchor + firstDueDays * 86_400_000;
  const now = input.now ?? Date.now();

  return Array.from({ length: count }, (_, index) => {
    const amountCents = baseCents + (index < remainder ? 1 : 0);
    const coveredCents = Math.min(remainingCoverage, amountCents);
    remainingCoverage -= coveredCents;
    const dueAt = new Date(firstDueAt + index * intervalDays * 86_400_000).toISOString();
    const status: InstallmentStatus = coveredCents >= amountCents ? "paid"
      : coveredCents > 0 ? "partial"
        : Date.parse(dueAt) < now ? "overdue" : "upcoming";
    return {
      number: index + 1,
      amount: amountCents / 100,
      covered_amount: coveredCents / 100,
      currency: input.currency,
      due_at: dueAt,
      status,
    };
  });
}

export function summarizeInstallmentArrears(input: Parameters<typeof buildInstallmentSchedule>[0]) {
  const now = input.now ?? Date.now();
  const overdue = buildInstallmentSchedule({ ...input, now })
    .filter((installment) => Date.parse(installment.due_at) < now)
    .map((installment) => ({
      due_at: installment.due_at,
      remaining_cents: Math.max(0, Math.round((installment.amount - installment.covered_amount) * 100)),
    }))
    .filter((installment) => installment.remaining_cents > 0);
  return {
    overdue_installment_count: overdue.length,
    overdue_balance: overdue.reduce((sum, installment) => sum + installment.remaining_cents, 0) / 100,
    oldest_overdue_at: overdue[0]?.due_at || null,
  };
}
