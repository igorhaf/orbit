import type { PluginDefinition } from "./contract";

export const suindaWhatsAppPlugin: PluginDefinition = {
  id: "suinda-whatsapp",
  name: "WhatsApp para Suindá",
  version: "1.0.0",
  description: "Canal opcional de notificações educacionais por modelos aprovados no WhatsApp Cloud API.",
  dependencies: ["suinda-learning"],
  handlesRoute: (path) => /^\/extensions\/suinda-whatsapp\/workspaces\/[0-9a-f-]{36}\/(?:configuration|consent|deliveries)$/.test(path),
  routePermission: () => null,
  capabilities: [
    { id: "manage", name: "Configurar WhatsApp institucional", permissions: ["plugin.suinda-whatsapp.manage"] },
    { id: "consent", name: "Gerenciar consentimento próprio do WhatsApp", permissions: ["plugin.suinda-whatsapp.consent"] },
  ],
};
