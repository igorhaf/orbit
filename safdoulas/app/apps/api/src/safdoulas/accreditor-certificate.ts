import { Controller, HttpException, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AccessService, type AccessRequest } from "../access/access";
import { PluginRegistry } from "../execution/registries";
import { ExtensionRecords } from "../plugins/records/records.service";
import { fillConcessionTemplate, renderConcessionPdf } from "./concession-document";

@Controller("safdoulas/accreditors")
export class SafdoulasAccreditorCertificateController {
  constructor(@Inject(ExtensionRecords) private readonly records: ExtensionRecords,
    @Inject(AccessService) private readonly access: AccessService, @Inject(PluginRegistry) private readonly plugins: PluginRegistry) {}

  @Post(":id/certificate-document")
  async generate(@Req() request: AccessRequest, @Param("id") recordId: string) {
    const actor = String(request.orbitActor);
    if (!this.plugins.isEnabled("safdoulas-accreditors")) throw new HttpException("O plugin de acreditadoras está desativado.", 409);
    await this.access.require(actor, "plugin.safdoulas-accreditors.manage");
    const profile = await this.records.detail("safdoulas-accreditors", recordId, actor);
    if (profile.kind !== "profile" || profile.state !== "active" || profile.payload.profile_status !== "active")
      throw new HttpException("A minuta exige uma habilitação ativa e homologada.", 409);
    const templates = (await this.records.list("safdoulas-governance", profile.workspace_id, actor))
      .filter((record) => record.kind === "approved_template" && record.state === "active" && record.payload.document_type === "certificado");
    if (templates.length !== 1) throw new HttpException("Configure um único modelo ativo de certificado de habilitação neste workspace.", 409);
    const [template] = templates;
    const holder = await this.access.account(String(profile.payload.user_id));
    const values = { accreditor_name: holder.name, credential_number: String(profile.payload.credential_number), valid_from: String(profile.payload.valid_from).slice(0, 10), valid_until: String(profile.payload.valid_until).slice(0, 10), training_completed_at: String(profile.payload.training_completed_at).slice(0, 10) };
    const content = fillConcessionTemplate(String(template.payload.body_markdown), template.payload.variables as string[], values);
    const pdf = await renderConcessionPdf(content, { title: "Minuta de certificado de habilitação de acreditadora" });
    const document = await this.records.upload(profile.workspace_id, actor, {
      title: `Minuta de habilitação ${values.credential_number}`, file_name: `habilitacao-${profile.id}.pdf`, mime_type: "application/pdf",
      variant: "original", data_base64: Buffer.from(pdf).toString("base64"), reason: "Minuta gerada após homologação; requer assinatura institucional.", operation_key: randomUUID(),
    });
    const generation = await this.records.createGenerated("safdoulas-accreditors", profile.workspace_id, actor, {
      kind: "certificate_generation", title: `Geração de certificado ${values.credential_number}`, operation_key: randomUUID(),
      payload: { profile_record_id: profile.id, profile_revision: profile.revision, template_record_id: template.id, template_revision: template.revision,
        document_record_id: document.id, document_revision: document.revision, generated_at: new Date().toISOString(), status: "unsigned_draft" },
    });
    return { ...generation, document_record_id: document.id, document_revision: document.revision, document_file_name: document.payload.file_name };
  }
}
