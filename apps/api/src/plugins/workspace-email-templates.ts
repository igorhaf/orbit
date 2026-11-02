import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Put, Req } from "@nestjs/common";
import { AccessService } from "../access/access";
import type { AccessRequest } from "../access/access";
import { Db } from "../db";

export const WORKSPACE_EMAIL_TEMPLATE_KINDS = [
  "academic_reminder", "survey_reminder", "attendance_risk", "announcement", "scholarship_decision",
  "study_group_message", "alumni_reply", "community_connection", "community_message", "community_reply",
] as const;
export type WorkspaceEmailTemplateKind = typeof WORKSPACE_EMAIL_TEMPLATE_KINDS[number];
export const WORKSPACE_EMAIL_TEMPLATE_FIELDS = [
  "learner_name", "institution_name", "notification_title", "notification_body", "course_link", "product_name",
] as const;
export type WorkspaceEmailTemplateField = typeof WORKSPACE_EMAIL_TEMPLATE_FIELDS[number];
export type WorkspaceEmailTemplate = {
  kind: WorkspaceEmailTemplateKind;
  subject_template: string;
  body_template: string;
  enabled: boolean;
  updated_at?: string;
};

const allowedFields = new Set<string>(WORKSPACE_EMAIL_TEMPLATE_FIELDS);
const allowedKinds = new Set<string>(WORKSPACE_EMAIL_TEMPLATE_KINDS);
const tokenPattern = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function validateWorkspaceEmailTemplate(input: unknown): WorkspaceEmailTemplate {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpException({ message: "Modelo de e-mail inválido." }, 400);
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["kind", "subject_template", "body_template", "enabled"].includes(key))) {
    throw new HttpException({ message: "O modelo contém campos desconhecidos." }, 400);
  }
  if (typeof row.kind !== "string" || !allowedKinds.has(row.kind)) throw new HttpException({ message: "Tipo de e-mail educacional inválido." }, 400);
  if (typeof row.subject_template !== "string" || !row.subject_template.trim() || row.subject_template.length > 250 || /[\r\n]/.test(row.subject_template)) {
    throw new HttpException({ message: "O assunto deve conter até 250 caracteres e uma única linha." }, 400);
  }
  if (typeof row.body_template !== "string" || !row.body_template.trim() || row.body_template.length > 10000) {
    throw new HttpException({ message: "O corpo deve conter entre 1 e 10.000 caracteres." }, 400);
  }
  if (typeof row.enabled !== "boolean") throw new HttpException({ message: "Informe se o modelo está ativo." }, 400);
  for (const value of [row.subject_template, row.body_template]) {
    const tokens = [...value.matchAll(tokenPattern)];
    const stripped = value.replace(tokenPattern, "");
    if (stripped.includes("{{") || stripped.includes("}}") || tokens.some((match) => !allowedFields.has(match[1]))) {
      throw new HttpException({ message: "O modelo usa um campo não permitido. Consulte a lista de campos disponíveis." }, 400);
    }
  }
  return { kind: row.kind as WorkspaceEmailTemplateKind, subject_template: row.subject_template.trim(),
    body_template: row.body_template.trim(), enabled: row.enabled };
}

export function renderWorkspaceEmailTemplate(template: Pick<WorkspaceEmailTemplate, "subject_template" | "body_template">,
  values: Record<WorkspaceEmailTemplateField, string>) {
  const render = (source: string) => source.replace(tokenPattern, (_match, field: WorkspaceEmailTemplateField) => values[field] ?? "");
  const printable = (value: string) => Array.from(value, (character) => {
    const code = character.codePointAt(0) || 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  return { subject: printable(render(template.subject_template)).replace(/\s+/g, " ").trim().slice(0, 250),
    body: render(template.body_template).replaceAll("\u0000", "").slice(0, 12000) };
}

export function isWorkspaceEmailTemplateKind(value: string): value is WorkspaceEmailTemplateKind { return allowedKinds.has(value); }

@Injectable()
export class WorkspaceEmailTemplatesService {
  constructor(private readonly db: Db, private readonly access: AccessService) {}

  private async requireManager(workspaceId: string, userId: string) {
    const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId);
    if (!validId) throw new HttpException({ message: "Workspace inválido." }, 400);
    const workspace = await this.db.one<{ id: string }>("SELECT id FROM workspaces WHERE id=$1", [workspaceId]);
    if (!workspace) throw new HttpException({ message: "Workspace não encontrado." }, 404);
    if (!await this.access.has(userId, "plugin.suinda-learning.manage", "workspace", workspaceId)
      && !await this.access.has(userId, "plugin.suinda-learning.manage")) {
      throw new HttpException({ message: "A configuração de modelos exige gestão acadêmica neste workspace." }, 403);
    }
    return workspaceId;
  }

  async list(workspaceId: string, userId: string) {
    const workspace = await this.requireManager(workspaceId, userId);
    return this.db.query<WorkspaceEmailTemplate>(
      `SELECT kind,subject_template,body_template,enabled,updated_at FROM workspace_email_templates
       WHERE workspace_id=$1 AND plugin_id='suinda-learning' ORDER BY kind`, [workspace],
    );
  }

  async save(workspaceId: string, userId: string, input: unknown) {
    const workspace = await this.requireManager(workspaceId, userId);
    const template = validateWorkspaceEmailTemplate(input);
    const saved = await this.db.one<WorkspaceEmailTemplate>(
      `INSERT INTO workspace_email_templates(workspace_id,plugin_id,kind,subject_template,body_template,enabled,updated_by)
       VALUES($1,'suinda-learning',$2,$3,$4,$5,$6)
       ON CONFLICT(workspace_id,plugin_id,kind) DO UPDATE SET subject_template=EXCLUDED.subject_template,
        body_template=EXCLUDED.body_template,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING kind,subject_template,body_template,enabled,updated_at`,
      [workspace, template.kind, template.subject_template, template.body_template, template.enabled, userId],
    );
    await this.access.audit(userId, "suinda-learning.email-template.save", template.kind, { type: "workspace", id: workspace });
    return saved;
  }
}

@Controller("extensions/suinda-learning/workspaces/:workspaceId/email-templates")
export class WorkspaceEmailTemplatesController {
  constructor(@Inject(WorkspaceEmailTemplatesService) private readonly templates: WorkspaceEmailTemplatesService) {}
  @Get() list(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.templates.list(workspaceId, String(req.orbitUser));
  }
  @Put(":kind") save(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
    @Param("kind") kind: string, @Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body) || (body as Record<string, unknown>).kind !== kind) {
      throw new HttpException({ message: "O tipo informado no caminho e no modelo precisa coincidir." }, 400);
    }
    return this.templates.save(workspaceId, String(req.orbitUser), body);
  }
}
