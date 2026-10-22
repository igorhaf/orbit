import type { RecordValidationContext, RecordValidationIssue } from "../plugins/contract";

type Activity = { activity_type?: string; modality?: string; hours?: number };
type Module = { code?: string; hours?: number; activities?: Activity[] };
type ScheduleEntry = { module_code?: string; hours?: number };
type ReferenceSnapshot = { pluginId: string; kind: string; state: string; payload: Record<string, unknown> };

const numeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const close = (left: number, right: number) => Math.abs(left - right) <= 0.01;
const hours = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const answerAtPath = (value: unknown, path: string): unknown => {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  if (!parts.length || parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) return undefined;
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (current && typeof current === "object" && Object.hasOwn(current, part)) current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
};

/** Reports arithmetic inconsistencies without imposing accreditation thresholds. */
export async function curriculumValidationIssues(payload: Record<string, unknown>, context: RecordValidationContext): Promise<RecordValidationIssue[]> {
  const modules = Array.isArray(payload.modules) ? payload.modules as Module[] : [];
  const schedule = Array.isArray(payload.schedule) ? payload.schedule as ScheduleEntry[] : [];
  const issues: RecordValidationIssue[] = [];
  const moduleCodes = new Set<string>();
  for (const [index, module] of modules.entries()) {
    if (typeof module.code === "string") {
      if (moduleCodes.has(module.code)) issues.push({ severity: "error", code: "duplicate_module_code", path: `modules[${index}].code`, message: `O código ${module.code} está repetido.` });
      moduleCodes.add(module.code);
    }
  }

  const moduleHours = modules.reduce((sum, module) => sum + (numeric(module.hours) ? module.hours : 0), 0);
  if (numeric(payload.total_hours) && modules.length && !close(payload.total_hours, moduleHours))
    issues.push({ severity: "warning", code: "curriculum_total_mismatch", path: "total_hours", message: `Total declarado: ${hours(payload.total_hours)} h; soma dos módulos: ${hours(moduleHours)} h.` });

  for (const [index, module] of modules.entries()) {
    const path = `modules[${index}]`;
    if (Array.isArray(module.activities) && module.activities.length && numeric(module.hours)) {
      const activityHours = module.activities.reduce((sum, activity) => sum + (numeric(activity.hours) ? activity.hours : 0), 0);
      if (!close(module.hours, activityHours))
        issues.push({ severity: "warning", code: "module_activity_hours_mismatch", path: `${path}.activities`, message: `Módulo ${module.code || index + 1}: ${hours(module.hours)} h declaradas; atividades somam ${hours(activityHours)} h.` });
    }
  }

  const scheduleByModule = new Map<string, number>();
  for (const [index, entry] of schedule.entries()) {
    if (typeof entry.module_code !== "string" || !moduleCodes.has(entry.module_code)) {
      issues.push({ severity: "error", code: "unknown_schedule_module", path: `schedule[${index}].module_code`, message: `O cronograma referencia o módulo inexistente ${String(entry.module_code || "(vazio)")}.` });
      continue;
    }
    scheduleByModule.set(entry.module_code, (scheduleByModule.get(entry.module_code) || 0) + (numeric(entry.hours) ? entry.hours : 0));
  }
  for (const [index, module] of modules.entries()) {
    const scheduled = module.code ? scheduleByModule.get(module.code) : undefined;
    if (scheduled !== undefined && numeric(module.hours) && !close(module.hours, scheduled))
      issues.push({ severity: "warning", code: "module_schedule_hours_mismatch", path: `modules[${index}].hours`, message: `Módulo ${module.code}: ${hours(module.hours)} h declaradas; cronograma soma ${hours(scheduled)} h.` });
  }
  const scheduledHours = schedule.reduce((sum, entry) => sum + (numeric(entry.hours) ? entry.hours : 0), 0);
  if (schedule.length && numeric(payload.total_hours) && !close(payload.total_hours, scheduledHours))
    issues.push({ severity: "warning", code: "schedule_total_mismatch", path: "schedule", message: `Total declarado: ${hours(payload.total_hours)} h; cronograma soma ${hours(scheduledHours)} h.` });

  const certificateId = payload.certificate_template_record_id;
  const certificateRevision = payload.certificate_template_revision;
  if (typeof certificateId === "string" && numeric(certificateRevision)) {
    const certificate = await context.resolveRecord(certificateId, certificateRevision) as ReferenceSnapshot | null;
    if (!certificate) {
      issues.push({ severity: "warning", code: "certificate_reference_unavailable", path: "certificate_template_record_id", message: "Não foi possível conferir a versão vinculada do certificado neste espaço ou com as permissões atuais." });
    } else if (certificate.pluginId !== "safdoulas-registry" || certificate.kind !== "course_certificate_model") {
      issues.push({ severity: "error", code: "invalid_certificate_reference", path: "certificate_template_record_id", message: "A referência deve apontar para um modelo de certificado do cadastro SAFDOULAS." });
    } else {
      if (certificate.state !== "active")
        issues.push({ severity: "warning", code: "inactive_certificate_reference", path: "certificate_template_record_id", message: `O modelo de certificado está no estado ${certificate.state}; confirme se esta versão pode ser usada.` });
      const declaredHours = certificate.payload.declared_hours;
      if (numeric(payload.total_hours) && numeric(declaredHours) && !close(payload.total_hours, declaredHours))
        issues.push({ severity: "warning", code: "certificate_hours_mismatch", path: "certificate_template_record_id", message: `Matriz: ${hours(payload.total_hours)} h; certificado: ${hours(declaredHours)} h.` });
      const documentId = certificate.payload.document_record_id;
      if (typeof documentId === "string") {
        const documentRevision = certificate.payload.document_revision;
        if (numeric(documentRevision)) {
          const document = await context.resolveRecord(documentId, documentRevision) as ReferenceSnapshot | null;
          if (!document || document.pluginId !== "documents" || document.kind !== "document")
            issues.push({ severity: "warning", code: "certificate_document_unavailable", path: "certificate_template_record_id", message: "O arquivo de referência do certificado não está acessível nesta versão." });
        } else {
          issues.push({ severity: "warning", code: "certificate_document_revision_missing", path: "certificate_template_record_id", message: "O modelo de certificado não fixa a versão do arquivo comprobatório." });
        }
      }
    }
  } else if ((certificateId !== undefined && certificateId !== null) || (certificateRevision !== undefined && certificateRevision !== null)) {
    issues.push({ severity: "error", code: "incomplete_certificate_reference", path: "certificate_template_record_id", message: "Informe o identificador e a versão do modelo de certificado juntos." });
  }

  const formId = payload.source_form_submission_record_id;
  const formRevision = payload.source_form_submission_revision;
  if (typeof formId === "string" && numeric(formRevision)) {
    const submission = await context.resolveRecord(formId, formRevision) as ReferenceSnapshot | null;
    if (!submission || submission.pluginId !== "forms" || submission.kind !== "submission")
      issues.push({ severity: "warning", code: "source_form_unavailable", path: "source_form_submission_record_id", message: "A submissão do formulário não está acessível nesta versão." });
    else if (!(["submitted", "completed"].includes(submission.state)))
      issues.push({ severity: "warning", code: "source_form_not_submitted", path: "source_form_submission_record_id", message: `O formulário de origem está no estado ${submission.state}; use uma versão enviada para análise.` });
    else {
      const path = payload.source_form_hours_path;
      if (typeof path !== "string" || !path.trim()) {
        issues.push({ severity: "warning", code: "source_form_hours_path_missing", path: "source_form_hours_path", message: "Informe o caminho do campo de carga horária nas respostas para comparar o formulário com a matriz." });
      } else if (numeric(payload.total_hours)) {
        const declared = answerAtPath(submission.payload.answers, path);
        const formHours = typeof declared === "number" ? declared : typeof declared === "string" && declared.trim() ? Number(declared.replace(",", ".")) : NaN;
        if (!Number.isFinite(formHours) || formHours < 0)
          issues.push({ severity: "warning", code: "source_form_hours_unavailable", path: "source_form_hours_path", message: `O campo ${path} não contém uma carga horária numérica acessível na submissão.` });
        else if (!close(payload.total_hours, formHours))
          issues.push({ severity: "warning", code: "form_hours_mismatch", path: "total_hours", message: `Matriz: ${hours(payload.total_hours)} h; formulário: ${hours(formHours)} h.` });
      }
    }
  } else if ((formId !== undefined && formId !== null) || (formRevision !== undefined && formRevision !== null)) {
    issues.push({ severity: "error", code: "incomplete_form_reference", path: "source_form_submission_record_id", message: "Informe o identificador e a versão do formulário juntos." });
  }

  const evidenceDocuments = Array.isArray(payload.evidence_documents) ? payload.evidence_documents as Array<{ record_id?: string; revision?: number }> : [];
  for (const [index, evidence] of evidenceDocuments.entries()) {
    const document = typeof evidence.record_id === "string" && numeric(evidence.revision)
      ? await context.resolveRecord(evidence.record_id, evidence.revision) as ReferenceSnapshot | null
      : null;
    if (!document || document.pluginId !== "documents" || document.kind !== "document")
      issues.push({ severity: "warning", code: "evidence_document_unavailable", path: `evidence_documents[${index}]`, message: "O documento comprobatório não está acessível nesta versão." });
  }

  return issues;
}
