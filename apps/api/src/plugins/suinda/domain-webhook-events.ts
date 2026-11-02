type DomainRecord = { plugin_id: string; kind: string; state: string; revision: number; payload: Record<string, unknown> };

export function suindaDomainWebhookEvents(record: DomainRecord, previousState?: string): string[] {
  if (record.plugin_id !== "suinda-learning") return [];
  const enteredState = (state: string) => record.state === state
    && (record.revision === 1 || previousState !== undefined && previousState !== state);
  if (record.kind === "enrollment" && enteredState("completed")) return ["suinda-learning.enrollment.completed"];
  if (record.kind === "payment_entry" && enteredState("recorded")) {
    if (record.payload.payment_method === "refund") return ["suinda-learning.payment.refunded"];
    if (!["scholarship", "waiver"].includes(String(record.payload.payment_method))) return ["suinda-learning.payment.recorded"];
  }
  if (record.kind === "certificate") {
    if (enteredState("issued")) return ["suinda-learning.certificate.issued"];
    if (record.state === "revoked" && previousState === "issued") return ["suinda-learning.certificate.revoked"];
  }
  return [];
}
