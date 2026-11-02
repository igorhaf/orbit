import type { PluginDefinition } from "../contract";
import { suindaDomainWebhookEvents } from "./domain-webhook-events";

export const suindaDomainWebhooksPlugin: PluginDefinition = {
  id: "suinda-domain-webhooks",
  name: "Suindá · Eventos de integração",
  version: "1.0.0",
  description: "Publica eventos acadêmicos versionados e minimizados pela outbox compartilhada do Orbit.",
  parentPlugin: "suinda-learning",
  dependencies: ["suinda-learning", "webhooks"],
  scope: "workspace",
  recordEvents: {
    sourcePluginId: "suinda-learning",
    events: [
      { type: "suinda-learning.enrollment.completed", label: "Suindá · matrícula concluída", version: 1 },
      { type: "suinda-learning.payment.recorded", label: "Suindá · pagamento registrado", version: 1 },
      { type: "suinda-learning.payment.refunded", label: "Suindá · reembolso registrado", version: 1 },
      { type: "suinda-learning.certificate.issued", label: "Suindá · certificado emitido", version: 1 },
      { type: "suinda-learning.certificate.revoked", label: "Suindá · certificado revogado", version: 1 },
    ],
    onSnapshot: suindaDomainWebhookEvents,
  },
};
