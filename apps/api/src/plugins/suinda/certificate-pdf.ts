import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export type CertificatePdfInput = {
  learnerName: string;
  courseTitle: string;
  certificateCode: string;
  workloadHours: number;
  issuedAt: string;
  signerNames: string[];
  validationUrl?: string;
  template?: Partial<CertificatePdfTemplate>;
  /** Marks a participation certificate whose scope was explicitly approved by the issuer. */
  certificateKind?: "completion" | "participation" | "milestone";
  /** Human-readable activities/modules covered by a partial participation certificate. */
  participationScope?: string;
  /** Name of an explicitly configured curricular milestone. */
  milestoneTitle?: string;
  /** Academic completion date; distinct from the issuance date. */
  completedAt?: string;
};

export type CertificatePdfTemplate = {
  organization_name: string;
  certificate_title: string;
  opening_text: string;
  completion_text: string;
  signers_label: string;
  footer_text: string;
  accent_color: string;
  border_color: string;
};
const defaultTemplate: CertificatePdfTemplate = {
  organization_name: "SUINDÁ · FORMAÇÃO", certificate_title: "CERTIFICADO", opening_text: "Certificamos que",
  completion_text: "concluiu o curso", signers_label: "Responsáveis acadêmicos",
  footer_text: "Certificado verificável pela plataforma Suindá", accent_color: "#123442", border_color: "#59c8d2",
};
function safeColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export async function createCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  const certificateKind = input.certificateKind ?? "completion";
  const participationScope = input.participationScope?.trim();
  const milestoneTitle = input.milestoneTitle?.trim();
  if (certificateKind === "participation" && !participationScope) {
    throw new Error("O certificado de participação precisa descrever as atividades abrangidas.");
  }
  if (certificateKind === "milestone" && (!milestoneTitle || !participationScope)) {
    throw new Error("O certificado intermediário precisa identificar o marco e as aulas abrangidas.");
  }
  if (input.completedAt && !Number.isFinite(Date.parse(input.completedAt))) {
    throw new Error("A data de conclusão do certificado é inválida.");
  }
  const qr = input.validationUrl
    ? await QRCode.toBuffer(input.validationUrl, { type: "png", errorCorrectionLevel: "Q", margin: 1, width: 240 })
    : null;
  const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: `Certificado ${input.certificateCode}`, Author: "Suindá" } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const width = document.page.width;
  const height = document.page.height;
  const template = { ...defaultTemplate, ...input.template };
  const accent = safeColor(template.accent_color, defaultTemplate.accent_color);
  const border = safeColor(template.border_color, defaultTemplate.border_color);
  document.rect(22, 22, width - 44, height - 44).lineWidth(2).strokeColor(border).stroke();
  document.rect(31, 31, width - 62, height - 62).lineWidth(0.7).strokeColor(accent).stroke();
  document.fillColor(accent).font("Helvetica-Bold").fontSize(15).text(template.organization_name, 60, 62, { width: width - 120, align: "center", characterSpacing: 2, ellipsis: true });
  const certificateTitle = certificateKind === "participation" && template.certificate_title === defaultTemplate.certificate_title
    ? "CERTIFICADO DE PARTICIPAÇÃO"
    : certificateKind === "milestone" && template.certificate_title === defaultTemplate.certificate_title
      ? "CERTIFICADO DE MARCO DE APRENDIZAGEM"
    : template.certificate_title;
  document.fillColor(accent).font("Helvetica-Bold").fontSize(certificateTitle.length > 24 ? 27 : 34).text(certificateTitle, 60, 111, { width: width - 120, align: "center", ellipsis: true });
  document.fillColor("#43515a").font("Helvetica").fontSize(16).text(template.opening_text, 70, 181, { width: width - 140, align: "center", ellipsis: true });
  document.fillColor("#101c24").font("Helvetica-Bold").fontSize(28).text(input.learnerName, 62, 216, { width: width - 124, align: "center", height: 40, ellipsis: true });
  document.moveTo(180, 261).lineTo(width - 180, 261).lineWidth(0.8).strokeColor("#59c8d2").stroke();
  const completionText = certificateKind === "participation" ? "participou das atividades de"
    : certificateKind === "milestone" ? "concluiu o marco intermediário do curso" : template.completion_text;
  document.fillColor("#43515a").font("Helvetica").fontSize(15).text(completionText, 70, 281, { width: width - 140, align: "center", ellipsis: true });
  document.fillColor(accent).font("Helvetica-Bold").fontSize(22).text(input.courseTitle, 82, 311, { width: width - 164, align: "center", height: 56, ellipsis: true });
  if (certificateKind === "participation" || certificateKind === "milestone") {
    const detail = certificateKind === "milestone" ? `${milestoneTitle} · Aulas: ${participationScope}` : participationScope!;
    document.fillColor("#43515a").font("Helvetica").fontSize(10).text(detail, 82, 366, { width: width - 164, align: "center", height: 28, ellipsis: true });
  }
  document.fillColor("#43515a").font("Helvetica").fontSize(13).text(`Carga horária: ${input.workloadHours} horas`, 70, certificateKind === "participation" || certificateKind === "milestone" ? 400 : 378, { width: width - 140, align: "center" });
  const issued = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Recife" }).format(new Date(input.issuedAt));
  const completed = input.completedAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Recife" }).format(new Date(input.completedAt))
    : null;
  document.fillColor("#43515a").font("Helvetica").fontSize(12).text(completed ? `Concluído em ${completed} · emitido em ${issued}` : `Emitido em ${issued}`, 55, 425, { width: 390, align: "center" });
  document.fillColor(accent).font("Helvetica-Bold").fontSize(10).text(input.certificateCode, 55, 451, { width: 390, align: "center" });
  const signers = input.signerNames.length ? input.signerNames.slice(0, 3) : ["Equipe acadêmica Suindá"];
  const signerText = signers.join(" · ");
  document.fillColor("#43515a").font("Helvetica").fontSize(9).text(template.signers_label, 55, 476, { width: 390, align: "center", ellipsis: true });
  document.fontSize(10).text(signerText, 55, 492, { width: 390, align: "center", ellipsis: true });
  document.fontSize(8).text(template.footer_text, 55, 537, { width: width - 110, align: "center", ellipsis: true });
  if (qr) {
    document.image(qr, width - 153, height - 163, { width: 96, height: 96 });
    document.fillColor("#43515a").font("Helvetica").fontSize(8).text("Validar certificado", width - 182, height - 59, { width: 154, align: "center" });
  }
  document.end();
  return result;
}
