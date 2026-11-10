import { Controller, Get, HttpException, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { Db } from "../db";
import { PluginRegistry } from "../execution/registries";
import type { PluginDefinition, RecordKindContribution, RecordValidationIssue } from "../plugins/contract";

type PortalRecord = { id: string; workspace_id: string; kind: string; state: string; payload: Record<string, unknown> };
const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const optionalText = (maxLength = 2000) => ({ type: "string", maxLength });
const optionalUrl = { type: "string", maxLength: 2048 };
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const safePortalUrl = (value: unknown) => {
  if (typeof value !== "string" || !value) return true;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
};

export function publicPortalProjection(records: PortalRecord[]) {
  const settings = records.filter((record) => record.kind === "portal_settings" && record.state === "published" && record.payload.primary === true
    && typeof record.payload.public_authorization_reference === "string" && Boolean(record.payload.public_authorization_reference.trim()));
  if (settings.length !== 1) return { available: false as const, settings: null, contents: [] };
  const [site] = settings;
  const data = site.payload;
  const settingsView = {
    organization_name: String(data.organization_name),
    description: String(data.description),
    contact_email: String(data.contact_email || ""),
    contact_url: String(data.contact_url || ""),
    help_url: String(data.help_url || ""),
    application_url: String(data.application_url || ""),
  };
  const contents = records.filter((record) => record.kind === "portal_content" && record.state === "published"
    && record.workspace_id === site.workspace_id
    && typeof record.payload.public_authorization_reference === "string" && Boolean(record.payload.public_authorization_reference.trim())
    && safePortalUrl(record.payload.url))
    .map((record) => ({
      id: record.id,
      section: String(record.payload.section),
      title: String(record.payload.title),
      summary: String(record.payload.summary || ""),
      body: String(record.payload.body || ""),
      url: String(record.payload.url || ""),
      source_reference: String(record.payload.source_reference || ""),
      order: Number(record.payload.order || 0),
    }))
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "pt-BR"));
  if (!safePortalUrl(settingsView.contact_url) || !safePortalUrl(settingsView.help_url) || !safePortalUrl(settingsView.application_url))
    return { available: false as const, settings: null, contents: [] };
  return { available: true as const, settings: settingsView, contents };
}

function publicationIssues(payload: Record<string, unknown>): RecordValidationIssue[] {
  const issues: RecordValidationIssue[] = [];
  if (typeof payload.public_authorization_reference !== "string" || !payload.public_authorization_reference.trim())
    issues.push({ severity: "error", code: "public_authorization_required", path: "public_authorization_reference", message: "Registre a referência da autorização institucional antes de publicar conteúdo no portal." });
  if (!safePortalUrl(payload.url) || !safePortalUrl(payload.contact_url) || !safePortalUrl(payload.help_url) || !safePortalUrl(payload.application_url))
    issues.push({ severity: "error", code: "unsafe_public_url", path: "url", message: "Links públicos devem usar HTTPS ou caminhos relativos seguros do próprio Orbit." });
  if (typeof payload.contact_email === "string" && payload.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact_email))
    issues.push({ severity: "error", code: "invalid_public_contact", path: "contact_email", message: "Informe um e-mail de contato válido ou deixe o campo vazio." });
  if (payload.section && !(typeof payload.body === "string" && payload.body.trim()) && !(typeof payload.url === "string" && payload.url.trim()))
    issues.push({ severity: "error", code: "public_content_empty", path: "body", message: "Conteúdo público precisa ter texto ou um link autorizado." });
  return issues;
}

const recordKinds: Record<string, RecordKindContribution> = {
  portal_settings: {
    label: "Configuração do portal público",
    schema: object({
      organization_name: text(240),
      primary: { type: "boolean" },
      description: text(2000),
      contact_email: optionalText(320),
      contact_url: optionalUrl,
      help_url: optionalUrl,
      application_url: optionalUrl,
      public_authorization_reference: text(500),
    }, ["organization_name", "primary", "description", "contact_email", "contact_url", "help_url", "public_authorization_reference"]),
    initial: "draft",
    transitions: { draft: ["approved", "withdrawn"], approved: ["draft", "published", "withdrawn"], published: ["withdrawn"], withdrawn: [] },
    immutable: ["published", "withdrawn"],
    resourceScoped: true,
    managePermission: "plugin.safdoulas-public-portal.manage",
    validate: publicationIssues,
    example: { organization_name: "FENADOULASBR", primary: true, description: "Informações públicas sobre acreditação e formação.", contact_email: "", contact_url: "", help_url: "", application_url: "", public_authorization_reference: "Referência de autorização institucional" },
  },
  portal_content: {
    label: "Conteúdo público",
    schema: object({
      section: { type: "string", enum: ["current_call", "rule", "guidance", "document", "help"] },
      title: text(500),
      summary: optionalText(2000),
      body: optionalText(30000),
      url: optionalUrl,
      source_reference: optionalText(500),
      order: { type: "integer", minimum: 0, maximum: 100000 },
      public_authorization_reference: text(500),
    }),
    initial: "draft",
    transitions: { draft: ["approved", "withdrawn"], approved: ["draft", "published", "withdrawn"], published: ["withdrawn"], withdrawn: [] },
    immutable: ["published", "withdrawn"],
    resourceScoped: true,
    managePermission: "plugin.safdoulas-public-portal.manage",
    validate: publicationIssues,
    example: { section: "guidance", title: "Como funciona a solicitação", summary: "Etapas e documentos necessários.", body: "Consulte o edital vigente e reúna os documentos listados antes de iniciar.", url: "", source_reference: "Edital vigente, seção 2", order: 10, public_authorization_reference: "Referência de autorização institucional" },
  },
};

export const safdoulasPublicPortalPlugin: PluginDefinition = {
  id: "safdoulas-public-portal",
  name: "Portal público SAFDOULAS",
  version: "1.0.0",
  scope: "workspace",
  description: "Publica editais, regras, orientações e links de solicitação somente após autorização institucional registrada.",
  dependencies: ["versioned-records", "workspaces"],
  handlesRoute: (path) => path === "/public/safdoulas/portal",
  routePermission: () => null,
  capabilities: [{ id: "manage", name: "Administrar conteúdo do portal público", permissions: ["plugin.safdoulas-public-portal.manage"] }],
  contributions: { navigation: [{ id: "safdoulas-public-portal", href: "/extensions/safdoulas-public-portal", label: "Portal público" , permission: "plugin.safdoulas-public-portal.manage", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "publication", "label": "Publicação e privacidade", "order": 3}, order: 0}], recordKinds },
};

@Controller("public/safdoulas")
export class SafdoulasPublicPortalController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(PluginRegistry) private readonly plugins: PluginRegistry) {}

  @Get("portal")
  async portal(@Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!this.plugins.isEnabled("safdoulas-public-portal")) throw new HttpException("O portal público está temporariamente indisponível.", 503);
    const records = await this.db.query<PortalRecord>(
      "SELECT id,workspace_id,kind,state,payload FROM extension_records WHERE plugin_id='safdoulas-public-portal' AND state='published' AND kind IN ('portal_settings','portal_content') ORDER BY updated_at DESC LIMIT 501",
    );
    if (records.length > 500) throw new HttpException("A publicação do portal precisa ser revisada antes de ficar disponível.", 503);
    return publicPortalProjection(records);
  }
}
