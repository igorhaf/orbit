import { Controller, HttpException, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { AccessRequest } from "../access/access";
import { AccessService } from "../access/access";
import { PluginRegistry } from "../execution/registries";
import { ExtensionRecords } from "../plugins/records/records.service";
import { accreditationDecisionOutcome } from "./accreditation.plugin";

type Snapshot = {
  id: string;
  workspace_id: string;
  plugin_id: string;
  kind: string;
  title: string;
  state: string;
  revision: number;
  payload: Record<string, unknown>;
};

function plainText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number"))
    return value.join(", ");
  return undefined;
}

function addNamespacedValues(target: Record<string, string>, namespace: string, value: Record<string, unknown>) {
  const visit = (prefix: string, item: unknown, depth: number) => {
    if (depth > 4 || !item || typeof item !== "object" || Array.isArray(item)) return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      const name = `${prefix}.${key}`;
      const scalar = plainText(child);
      if (scalar !== undefined) target[name] = scalar;
      else if (child && typeof child === "object" && !Array.isArray(child)) visit(name, child, depth + 1);
    }
  };
  visit(namespace, value, 0);
}

export function concessionTemplateValues(input: {
  grant: Snapshot;
  process: Snapshot;
  decision: Snapshot;
  provider: Snapshot;
  course?: Snapshot;
}): Record<string, string> {
  const { grant, process, decision, provider, course } = input;
  const values: Record<string, string> = {};
  addNamespacedValues(values, "grant", grant.payload);
  addNamespacedValues(values, "process", process.payload);
  addNamespacedValues(values, "decision", decision.payload);
  addNamespacedValues(values, "provider", provider.payload);
  if (course) addNamespacedValues(values, "course", course.payload);

  const scope = grant.payload.scope && typeof grant.payload.scope === "object"
    ? grant.payload.scope as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries({
    accreditation_number: grant.payload.accreditation_number,
    verification_code: grant.payload.verification_code,
    provider_name: scope.provider_name,
    course_name: scope.course_name,
    modality: scope.modality,
    accreditation_scope: scope.description,
    valid_from: grant.payload.valid_from,
    valid_until: grant.payload.valid_until,
    process_number: process.payload.protocol_number,
    decision_outcome: accreditationDecisionOutcome(decision),
  })) {
    const scalar = plainText(value);
    if (scalar !== undefined) values[key] = scalar;
  }
  return values;
}

export function fillConcessionTemplate(body: string, declaredVariables: string[], values: Record<string, string>): string {
  if (!Array.isArray(declaredVariables) || declaredVariables.some((item) => typeof item !== "string" || !/^[a-z][a-z0-9_.-]*$/.test(item)))
    throw new Error("A lista de variáveis do modelo contém uma chave inválida.");
  const declared = new Set(declaredVariables);
  const required = new Set([...body.matchAll(/\{\{\s*([a-z][a-z0-9_.-]*)\s*\}\}/g)].map((match) => match[1]));
  for (const variable of required) {
    if (!declared.has(variable)) throw new Error(`A variável {{${variable}}} não foi declarada no modelo aprovado.`);
    if (values[variable] === undefined || !values[variable].trim()) throw new Error(`Não há dado vinculado para preencher {{${variable}}}.`);
  }
  for (const variable of declared)
    if (values[variable] === undefined || !values[variable].trim()) throw new Error(`O modelo exige a variável {{${variable}}}, mas ela não está disponível nos registros vinculados.`);
  return body.replace(/\{\{\s*([a-z][a-z0-9_.-]*)\s*\}\}/g, (_match, key: string) => values[key]);
}

function markdownLine(line: string): { text: string; size: number; bold: boolean } {
  const heading = line.match(/^(#{1,3})\s+(.*)$/);
  const size = heading ? [18, 15, 13][heading[1].length - 1] : 11;
  let text = (heading?.[2] ?? line)
    .replace(/^\s*[-*+]\s+/, "• ")
    .replace(/^\s*\d+[.)]\s+/, "• ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]*>/g, "");
  if (text.startsWith("• ")) text = `- ${text.slice(2)}`;
  return { text, size, bold: Boolean(heading) };
}

function winAnsiSafe(value: string): string {
  return value.normalize("NFC").replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "-");
}

export async function renderConcessionPdf(markdown: string, options: { title?: string; notice?: string } = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(options.title || "Minuta de concessão de acreditação");
  document.setSubject("Documento gerado a partir de modelo aprovado; requer assinatura institucional.");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const addPage = () => {
    page = document.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    page.drawText(winAnsiSafe(options.notice || "MINUTA PARA ASSINATURA - NAO ASSINADA"), { x: margin, y: pageHeight - 26, size: 8, font: bold, color: rgb(0.45, 0.12, 0.12) });
    y -= 24;
  };
  page.drawText(winAnsiSafe(options.notice || "MINUTA PARA ASSINATURA - NAO ASSINADA"), { x: margin, y: pageHeight - 26, size: 8, font: bold, color: rgb(0.45, 0.12, 0.12) });
  y -= 28;
  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (!rawLine.trim()) {
      y -= 8;
      continue;
    }
    const style = markdownLine(rawLine);
    const font = style.bold ? bold : regular;
    const size = style.size;
    const safe = winAnsiSafe(style.text);
    const words = safe.split(/\s+/);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > contentWidth) {
        if (y < margin + size + 10) addPage();
        page.drawText(line, { x: margin, y, size, font, color: rgb(0.12, 0.12, 0.12) });
        y -= size + 5;
        line = word;
      } else line = next;
    }
    if (line) {
      if (y < margin + size + 10) addPage();
      page.drawText(line, { x: margin, y, size, font, color: rgb(0.12, 0.12, 0.12) });
      y -= size + 6;
    }
  }
  return document.save();
}

@Controller("safdoulas/accreditation/grants")
export class SafdoulasConcessionDocumentController {
  constructor(
    @Inject(ExtensionRecords) private readonly records: ExtensionRecords,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
  ) {}

  @Post(":id/concession-document")
  async generate(@Req() req: AccessRequest, @Param("id") id: string) {
    const user = String(req.orbitUser);
    const pluginId = "safdoulas-accreditation";
    if (!this.plugins.isEnabled(pluginId)) throw new HttpException("O plugin de acreditação está suspenso.", 409);
    if (!await this.access.has(user, "plugin.safdoulas-accreditation.manage")) throw new HttpException("Apenas pessoas autorizadas a administrar a acreditação podem gerar a minuta.", 403);
    const grant = await this.records.versionSnapshot(pluginId, id, (await this.records.detail(pluginId, id, user)).revision, user) as Snapshot;
    if (grant.kind !== "accreditation_grant" || grant.state !== "draft") throw new HttpException("Gere a minuta enquanto a concessão estiver em rascunho.", 409);
    if (typeof grant.payload.signed_document_record_id === "string") throw new HttpException("Esta concessão já tem documento assinado vinculado.", 409);

    const process = await this.records.versionSnapshot("safdoulas-processes", String(grant.payload.process_record_id), Number(grant.payload.process_revision), user) as Snapshot;
    const decision = await this.records.versionSnapshot("safdoulas-decisions", String(grant.payload.decision_record_id), Number(grant.payload.decision_revision), user) as Snapshot;
    const template = await this.records.versionSnapshot("safdoulas-governance", String(grant.payload.concession_template_record_id), Number(grant.payload.concession_template_revision), user) as Snapshot;
    if (process.workspace_id !== grant.workspace_id || decision.workspace_id !== grant.workspace_id || template.workspace_id !== grant.workspace_id)
      throw new HttpException("As referências da concessão precisam pertencer ao mesmo workspace.", 409);
    if (process.kind !== "accreditation_process" || process.state !== "decision" || !["institutional_decision", "appeal_decision"].includes(decision.kind) || decision.state !== "ratified"
      || decision.payload.process_record_id !== process.id || !["approved", "approved_with_conditions"].includes(String(accreditationDecisionOutcome(decision)))
      || (process.payload.appeal_decision_record_id || process.payload.institutional_decision_record_id) !== decision.id)
      throw new HttpException("A minuta exige processo decidido e decisão ratificada de deferimento.", 409);
    if (template.kind !== "approved_template" || template.state !== "active" || template.payload.document_type !== "concessao")
      throw new HttpException("A minuta exige um modelo de concessão aprovado e ativo.", 409);

    const provider = await this.records.versionSnapshot("safdoulas-registry", String(process.payload.provider_record_id), Number(process.payload.provider_revision), user) as Snapshot;
    const course = typeof process.payload.course_record_id === "string" && typeof process.payload.course_revision === "number"
      ? await this.records.versionSnapshot("safdoulas-registry", process.payload.course_record_id, process.payload.course_revision, user) as Snapshot
      : undefined;
    if (provider.workspace_id !== grant.workspace_id || provider.kind !== "education_provider"
      || (course && (course.workspace_id !== grant.workspace_id || course.kind !== "course")))
      throw new HttpException("Os registros da instituição e do curso não correspondem ao processo.", 409);

    const body = String(template.payload.body_markdown || "");
    const variables = Array.isArray(template.payload.variables) ? template.payload.variables as string[] : [];
    const filled = fillConcessionTemplate(body, variables, concessionTemplateValues({ grant, process, decision, provider, course }));
    const pdf = await renderConcessionPdf(filled);
    const number = String(grant.payload.accreditation_number).replace(/[^A-Za-z0-9._-]/g, "-");
    const file = await this.records.upload(grant.workspace_id, user, {
      title: `Minuta de concessão ${number}`,
      file_name: `minuta-concessao-${number}.pdf`,
      mime_type: "application/pdf",
      data_base64: Buffer.from(pdf).toString("base64"),
      variant: "original",
      operation_key: randomUUID(),
      reason: "Minuta de concessão gerada a partir de modelo institucional aprovado; documento ainda não assinado.",
    }) as Snapshot;
    const generation = await this.records.createGenerated(pluginId, grant.workspace_id, user, {
      kind: "concession_document_generation",
      title: `Geração da minuta ${number}`,
      payload: {
        grant_record_id: grant.id, grant_revision: grant.revision,
        process_record_id: process.id, process_revision: process.revision,
        decision_record_id: decision.id, decision_revision: decision.revision,
        template_record_id: template.id, template_revision: template.revision,
        document_record_id: file.id, document_revision: file.revision,
        generated_at: new Date().toISOString(), status: "unsigned_draft",
      },
      operation_key: randomUUID(),
    }) as Snapshot;
    return { ...generation, document_record_id: file.id, document_revision: file.revision, document_file_name: file.payload.file_name };
  }
}
