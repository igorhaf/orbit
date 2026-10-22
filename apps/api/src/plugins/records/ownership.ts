import type { RecordKindContribution, RecordValidationContext } from "../contract";

async function owns(actor: string, context: RecordValidationContext) {
  return Boolean(context.recordId && await context.isRecordOwner?.(context.recordId, actor));
}

export function ownedRecordAccess(plugin: string): NonNullable<RecordKindContribution["authorizeRecord"]> {
  return async (actor, action, state, _payload, context) => {
    if (await owns(actor, context)) return action === "read" || state === "draft" && Boolean(await context.hasPermission?.(`plugin.${plugin}.write`));
    return Boolean(context.recordId && await context.hasPermissionOnResource?.(`plugin.${plugin}.${action}`, context.recordId));
  };
}

/** Submission data is private even when the published form is shared. */
export const formAccess: Pick<RecordKindContribution, "resourceScoped" | "managePermission" | "authorizeRecord" | "authorizeCreate"> = {
  resourceScoped: true,
  managePermission: "plugin.forms.manage",
  authorizeCreate: async (_actor, _payload, context) => Boolean(await context.hasWorkspacePermission?.("plugin.forms.write")),
  authorizeRecord: async (actor, action, state, _payload, context) => {
    if (action === "read" && state === "published" && await context.hasWorkspacePermission?.("plugin.forms.read")) return true;
    if (await owns(actor, context)) return action === "read" || state === "draft" && Boolean(await context.hasPermission?.("plugin.forms.write"));
    return Boolean(context.recordId && await context.hasPermissionOnResource?.(`plugin.forms.${action}`, context.recordId));
  },
};

export const submissionAccess: Pick<RecordKindContribution, "resourceScoped" | "managePermission" | "authorizeRecord" | "authorizeCreate"> = {
  resourceScoped: true,
  managePermission: "plugin.forms.manage",
  authorizeCreate: async (_actor, payload, context) => {
    if (!await context.hasWorkspacePermission?.("plugin.forms.write")) return false;
    const form = typeof payload.form_id === "string" && Number.isInteger(payload.form_revision)
      ? await context.resolveRecord(payload.form_id, Number(payload.form_revision)) : null;
    return form?.pluginId === "forms" && form.kind === "form" && form.state === "published";
  },
  authorizeRecord: async (actor, action, state, _payload, context) => {
    if (await owns(actor, context)) return action === "read" || state === "draft" && Boolean(await context.hasPermission?.("plugin.forms.write"));
    return Boolean(context.recordId && await context.hasPermissionOnResource?.(`plugin.forms.${action}`, context.recordId));
  },
};

/** File publication remains subject to scanning and independent anonymization review. */
export const documentAccess: Pick<RecordKindContribution, "authorizeRecord"> = {
  authorizeRecord: ownedRecordAccess("documents"),
};
