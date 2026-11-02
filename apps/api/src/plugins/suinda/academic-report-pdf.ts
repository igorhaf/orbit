import PDFDocument from "pdfkit";

export type AcademicReportPdfInput = {
  generated_at: string;
  range: { from: string; to: string };
  workspace_count: number;
  totals: Record<string, number | null>;
  courses: Array<Record<string, unknown>>;
  monthly_trend: Array<Record<string, unknown>>;
  cohort_attrition: Array<Record<string, unknown>>;
  cohort_occupancy: Array<Record<string, unknown>>;
  teaching_workload: Array<Record<string, unknown>>;
  teacher_evaluations: Array<Record<string, unknown>>;
  most_sought_courses: Array<Record<string, unknown>>;
  financial_by_cohort: Array<Record<string, unknown>>;
  unit_summary: Array<Record<string, unknown>>;
  unit_financial: Array<Record<string, unknown>>;
  referral_origins: Array<Record<string, unknown>>;
  financial: { by_course: Array<Record<string, unknown>> };
};

function value(input: unknown) {
  return input === null || input === undefined || input === "" ? "—" : String(input);
}

function percent(input: unknown) {
  return input === null || input === undefined ? "—" : `${input}%`;
}

function money(input: unknown, currency: unknown) {
  const amount = Number(input || 0);
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: String(currency || "BRL") }).format(amount); }
  catch { return `${amount.toFixed(2)} ${value(currency)}`; }
}

export async function createAcademicReportPdf(report: AcademicReportPdfInput): Promise<Buffer> {
  const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 42, bufferPages: true,
    info: { Title: `Relatórios acadêmicos ${report.range.from} a ${report.range.to}`, Author: "Suindá" } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const width = document.page.width - document.page.margins.left - document.page.margins.right;
  document.fillColor("#102a35").font("Helvetica-Bold").fontSize(18).text("Relatórios acadêmicos · Suindá");
  document.moveDown(0.25).fillColor("#405261").font("Helvetica").fontSize(9)
    .text(`Período: ${report.range.from} a ${report.range.to} · ${report.workspace_count} workspace(s) · Gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Recife" }).format(new Date(report.generated_at))}`);
  document.moveDown(0.8);

  const section = (title: string) => {
    if (document.y > document.page.height - 90) document.addPage();
    document.moveDown(0.35).fillColor("#0e7490").font("Helvetica-Bold").fontSize(12).text(title, { width });
    document.moveDown(0.2);
  };
  const row = (heading: string, detail: string) => {
    const content = `${heading}\n${detail}`;
    document.font("Helvetica").fontSize(8.5);
    const height = document.heightOfString(content, { width, lineGap: 2 });
    if (document.y + height + 9 > document.page.height - 44) document.addPage();
    document.fillColor("#172b36").font("Helvetica-Bold").fontSize(8.5).text(heading, { width, ellipsis: true });
    document.fillColor("#405261").font("Helvetica").fontSize(8).text(detail, { width, lineGap: 1 });
    document.moveDown(0.25);
  };
  const empty = (items: unknown[]) => { if (!items.length) row("Sem registros", "Não há dados disponíveis para este período."); };

  section("Resumo geral");
  const totals = report.totals;
  row("Indicadores", [
    `Cursos: ${value(totals.courses)} · Inscrições iniciadas/enviadas: ${value(totals.applications_started)}/${value(totals.applications_submitted)} · Matrículas convertidas: ${value(totals.converted_enrollments)} (${percent(totals.enrollment_conversion_percent)})`,
    `Alunos distintos no período: ${value(totals.distinct_learners)} · Alunos ativos: ${value(totals.active_learners)} · Concluintes: ${value(totals.completed)} · Desistências: ${value(totals.withdrawn)} · Recusadas: ${value(totals.rejected)}`,
    `Reprovação final: ${value(totals.failed_completions)}/${value(totals.eligible_completions)} matrículas com nota · Taxa: ${percent(totals.failure_rate_percent)}`,
    `Conclusão: ${percent(totals.completion_rate_percent)} · Nota média: ${percent(totals.average_grade)} · Frequência: ${percent(totals.attendance_percent)}`,
    `Horas frequentadas/previstas: ${value(totals.attended_hours)}/${value(totals.scheduled_hours)} · Encontros: ${value(totals.sessions_held)} · Certificados: ${value(totals.certificates_issued)}`,
    `Horas efetivamente ministradas: ${value(totals.taught_hours)} em ${value(totals.taught_sessions)} encontros concluídos · Horas práticas validadas: ${value(totals.validated_practice_hours)}`,
  ].join("\n"));

  section("Detalhamento por curso"); empty(report.courses);
  for (const course of report.courses) row(`${value(course.workspace_name)} · ${value(course.title)} · ${value(course.state)}`,
    `Inscrições: ${value(course.applications_started)} iniciadas / ${value(course.applications_submitted)} enviadas · Alunos distintos: ${value(course.distinct_learners)} · Ativos: ${value(course.active_learners)} · Concluintes: ${value(course.completed)} · Reprovados com nota: ${value(course.failed_completions)}/${value(course.eligible_completions)} (${percent(course.failure_rate_percent)}) · Desistências: ${value(course.withdrawn)} · Recusadas: ${value(course.rejected)} · Conclusão: ${percent(course.completion_rate_percent)} · Nota: ${percent(course.average_grade)} · Frequência: ${percent(course.attendance_percent)} · Horas frequentadas/previstas: ${value(course.attended_hours)}/${value(course.scheduled_hours)} · Encontros: ${value(course.sessions_held)} · Ministradas: ${value(course.taught_hours)} h em ${value(course.taught_sessions)} encontro(s) concluído(s) · Práticas validadas: ${value(course.validated_practice_hours)} h · Certificados: ${value(course.certificates_issued)}`);

  section("Indicadores por unidade"); empty(report.unit_summary);
  for (const unit of report.unit_summary) row(`${value(unit.workspace_name)} · ${value(unit.unit_name)}${unit.unit_code ? ` · ${value(unit.unit_code)}` : ""}`,
    `Cursos: ${value(unit.courses)} · Matrículas no período: ${value(unit.enrollments)} · Alunos distintos: ${value(unit.distinct_learners)} · Ativos: ${value(unit.active_learners)} · Concluídos: ${value(unit.completed)} · Desistências: ${value(unit.withdrawn)}`);

  section("Cursos mais procurados"); empty(report.most_sought_courses);
  for (const course of report.most_sought_courses) row(`${value(course.workspace_name)} · ${value(course.course_title)}`,
    `Inscrições iniciadas no período: ${value(course.applications_started)} · Enviadas: ${value(course.applications_submitted)}`);

  section("Evolução mensal"); empty(report.monthly_trend);
  for (const month of report.monthly_trend) row(value(month.month),
    `Iniciadas: ${value(month.applications_started)} · Enviadas: ${value(month.applications_submitted)} · Concluídas: ${value(month.completed)} · Desistências: ${value(month.withdrawn)}`);

  section("Evasão por turma"); empty(report.cohort_attrition);
  for (const cohort of report.cohort_attrition) row(`${value(cohort.workspace_name)} · ${value(cohort.course_title)} · Turma ${value(cohort.cohort_code)}`,
    `Admitidos: ${value(cohort.admitted)} · Desistências: ${value(cohort.withdrawn)} · Evasão: ${percent(cohort.attrition_percent)}`);

  section("Ocupação atual das turmas"); empty(report.cohort_occupancy);
  for (const cohort of report.cohort_occupancy) row(`${value(cohort.workspace_name)} · ${value(cohort.course_title)} · Turma ${value(cohort.cohort_code)} · ${value(cohort.state)}`,
    `Vagas ocupadas: ${value(cohort.occupied)} · Capacidade: ${cohort.capacity === null ? "Sem limite" : value(cohort.capacity)} · Disponíveis: ${value(cohort.available)} · Ocupação: ${percent(cohort.occupancy_percent)}`);

  section("Carga de trabalho docente"); empty(report.teaching_workload);
  for (const teacher of report.teaching_workload) row(`${value(teacher.workspace_name)} · ${value(teacher.course_title)} · ${value(teacher.teacher_name)}`,
    `Encontros concluídos: ${value(teacher.sessions_taught)} · Horas previstas: ${value(teacher.scheduled_hours)} · Horas ministradas em encontros concluídos: ${value(teacher.taught_hours)} · Itens corrigidos: ${value(teacher.graded_items)}`);

  section("Avaliações docentes validadas"); empty(report.teacher_evaluations);
  for (const teacher of report.teacher_evaluations) row(`${value(teacher.workspace_name)} · ${value(teacher.course_title)} · ${value(teacher.teacher_name)}`,
    `Nota ponderada validada: ${value(teacher.weighted_score)} / 5 · Ciclos validados: ${value(teacher.validated_evaluations)} · Respostas agregadas: ${value(teacher.response_count)}. Resultado agregado, sem respostas individuais.`);

  section("Indicações institucionais"); empty(report.referral_origins);
  for (const origin of report.referral_origins) row(`${value(origin.workspace_name)} · ${value(origin.course_title)}`,
    `Instituição indicada pelo candidato: ${value(origin.institution_referral)} · Inscrições: ${value(origin.applications)}`);

  section("Financeiro por curso"); empty(report.financial.by_course);
  for (const financial of report.financial.by_course) row(`${value(financial.workspace_name)} · ${value(financial.course_title)} · ${value(financial.currency)}`,
    `Recebido no período: ${money(financial.collected_in_period, financial.currency)} (${value(financial.payment_count)} baixa(s)) · Crédito de bolsa: ${money(financial.scholarship_credit_in_period, financial.currency)} · Saldo atual: ${money(financial.outstanding_balance, financial.currency)} · Matrículas pendentes: ${value(financial.pending_enrollments)} · Em atraso: ${value(financial.overdue_enrollments)} · Valor vencido: ${money(financial.overdue_balance, financial.currency)}`);

  section("Financeiro por turma"); empty(report.financial_by_cohort);
  for (const financial of report.financial_by_cohort) row(`${value(financial.workspace_name)} · ${value(financial.course_title)} · Turma ${value(financial.cohort_code)} · ${value(financial.currency)}`,
    `Recebido no período: ${money(financial.collected_in_period, financial.currency)} (${value(financial.payment_count)} baixa(s)) · Crédito de bolsa: ${money(financial.scholarship_credit_in_period, financial.currency)} · Saldo atual: ${money(financial.outstanding_balance, financial.currency)} · Matrículas pendentes: ${value(financial.pending_enrollments)} · Em atraso: ${value(financial.overdue_enrollments)} · Valor vencido: ${money(financial.overdue_balance, financial.currency)}`);

  section("Financeiro por unidade"); empty(report.unit_financial);
  for (const financial of report.unit_financial) row(`${value(financial.workspace_name)} · ${value(financial.unit_name)} · ${value(financial.currency)}`,
    `Recebido no período: ${money(financial.collected_in_period, financial.currency)} (${value(financial.payment_count)} baixa(s)) · Crédito de bolsa: ${money(financial.scholarship_credit_in_period, financial.currency)} · Saldo atual: ${money(financial.outstanding_balance, financial.currency)} · Matrículas pendentes: ${value(financial.pending_enrollments)} · Em atraso: ${value(financial.overdue_enrollments)} · Valor vencido: ${money(financial.overdue_balance, financial.currency)}`);

  const pages = document.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    document.switchToPage(index);
    document.fillColor("#64748b").font("Helvetica").fontSize(7)
      .text(`Suindá · Relatórios agregados · ${report.range.from} a ${report.range.to}`, 42, document.page.height - 27, { width: width * 0.75, lineBreak: false });
    document.text(`Página ${index + 1} de ${pages.count}`, document.page.width - 125, document.page.height - 27, { width: 83, align: "right", lineBreak: false });
  }
  document.end();
  return result;
}
