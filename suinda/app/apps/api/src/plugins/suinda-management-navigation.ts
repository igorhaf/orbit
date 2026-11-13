import type { PluginDefinition } from "./contract";

const group = { id: "suinda-management", label: "Gestão acadêmica", order: 70 };

/** Adds one product-specific navigation group over the original child-module routes. */
export const suindaManagementNavigationPlugin: PluginDefinition = {
  id: "suinda-management-navigation",
  name: "Suindá · Gestão da plataforma",
  version: "1.0.0",
  description: "Agrupa os atalhos de contratos corporativos, assinaturas, afiliados e avaliação docente.",
  parentPlugin: "suinda-learning",
  dependencies: [
    "suinda-learning",
    "suinda-corporate",
    "suinda-subscriptions",
    "suinda-affiliates",
    "suinda-teacher-evaluation",
  ],
  contributions: {
    navigation: [
      {
        id: "suinda-corporate",
        label: "Contratos corporativos",
        href: "/suinda/corporate",
        permission: "plugin.suinda-corporate.read",
        order: 75,
        group,
      },
      {
        id: "suinda-subscriptions",
        label: "Assinaturas",
        href: "/suinda/subscriptions",
        permission: "plugin.suinda-subscriptions.read",
        order: 76,
        group,
      },
      {
        id: "suinda-affiliates",
        label: "Afiliados e comissões",
        href: "/suinda/affiliates",
        permission: "plugin.suinda-affiliates.manage",
        order: 77,
        group,
      },
      {
        id: "suinda-teacher-evaluation",
        label: "Avaliação docente",
        href: "/extensions/suinda-teacher-evaluation",
        permission: "plugin.suinda-teacher-evaluation.manage",
        order: 78,
        group,
      },
    ],
  },
};
