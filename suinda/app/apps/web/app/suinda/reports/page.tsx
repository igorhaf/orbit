"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileDown, FileSpreadsheet, RefreshCw } from "lucide-react";
import { api, apiBlob } from "@/lib/api";
import { createXlsx } from "@/lib/xlsx";
import { PaymentProviderSettings } from "@/plugins/suinda/PaymentProviderSettings";
import { PaymentReviewQueue } from "@/plugins/suinda/PaymentReviewQueue";
import { SuindaFinancialReconciliation } from "@/plugins/suinda/SuindaFinancialReconciliation";

type ReportCourse = {
  workspace_id: string; workspace_name: string; course_id: string; title: string; state: string;
  applications_started: number; applications_submitted: number; converted_enrollments: number; enrollment_conversion_percent: number | null;
  distinct_learners: number; active_learners: number; completed: number;
  withdrawn: number; rejected: number; completion_rate_percent: number | null; average_grade: number | null;
  eligible_completions: number; failed_completions: number; failure_rate_percent: number | null;
  graded_items: number; certificates_issued: number; attendance_percent: number | null;
  attended_hours: number; scheduled_hours: number; sessions_held: number; taught_hours: number; taught_sessions: number; validated_practice_hours: number;
};
type FinancialRow = {
  course_id: string; workspace_id: string; workspace_name: string; course_title: string; currency: string;
  collected_in_period: number; payment_count: number; scholarship_credit_in_period: number; outstanding_balance: number; pending_enrollments: number; overdue_enrollments: number; overdue_balance: number;
};
type ReferralOrigin = { workspace_id: string; workspace_name: string; course_id: string; course_title: string; institution_referral: string; applications: number };
type MonthlyTrend = { month: string; applications_started: number; applications_submitted: number; completed: number; withdrawn: number };
type CohortAttrition = { workspace_id: string; workspace_name: string; course_id: string; course_title: string; cohort_record_id: string | null; cohort_code: string; admitted: number; withdrawn: number; attrition_percent: number | null };
type TeachingWorkload = { workspace_id: string; workspace_name: string; course_id: string; course_title: string; teacher_user_id: string; teacher_name: string; sessions_taught: number; scheduled_hours: number; taught_hours: number; graded_items: number };
type TeacherEvaluation = { workspace_id: string; workspace_name: string; course_id: string; course_title: string; teacher_user_id: string; teacher_name: string; validated_evaluations: number; response_count: number; weighted_score: number };
type CohortFinancialRow = { workspace_id: string; workspace_name: string; course_id: string; course_title: string; cohort_record_id: string | null; cohort_code: string; currency: string; collected_in_period: number; payment_count: number; scholarship_credit_in_period: number; outstanding_balance: number; pending_enrollments: number; overdue_enrollments: number; overdue_balance: number };
type MostSoughtCourse = { workspace_id: string; workspace_name: string; course_id: string; course_title: string; applications_started: number; applications_submitted: number };
type CohortOccupancy = { workspace_id: string; workspace_name: string; course_id: string; course_title: string; cohort_record_id: string; cohort_code: string; state: string; capacity: number | null; occupied: number; available: number | null; occupancy_percent: number | null };
type UnitSummary = { workspace_id: string; workspace_name: string; unit_record_id: string | null; unit_name: string; unit_code: string | null; courses: number; enrollments: number; distinct_learners: number; active_learners: number; completed: number; withdrawn: number };
type UnitFinancial = { workspace_id: string; workspace_name: string; unit_record_id: string | null; unit_name: string; currency: string; collected_in_period: number; payment_count: number; scholarship_credit_in_period: number; outstanding_balance: number; pending_enrollments: number; overdue_enrollments: number; overdue_balance: number };
type UnitTeamMember = { user_id: string; name: string; email: string; role_id: string; role_name: string };
type UnitTeamState = { members: UnitTeamMember[]; users: { id: string; name: string; email: string }[]; roles: { id: string; name: string }[] };
type AcademicReport = {
  generated_at: string; range: { from: string; to: string }; workspace_count: number; unit_scope: boolean;
  totals: {
    courses: number; applications_started: number; applications_submitted: number; converted_enrollments: number; enrollment_conversion_percent: number | null; distinct_learners: number; active_learners: number;
    completed: number; withdrawn: number; rejected: number; completion_rate_percent: number | null;
    eligible_completions: number; failed_completions: number; failure_rate_percent: number | null;
    average_grade: number | null; certificates_issued: number; attendance_percent: number | null;
    attended_hours: number; scheduled_hours: number; sessions_held: number; taught_hours: number; taught_sessions: number; validated_practice_hours: number;
  };
  courses: ReportCourse[];
  cohort_occupancy: CohortOccupancy[];
  monthly_trend: MonthlyTrend[];
  cohort_attrition: CohortAttrition[];
  referral_origins: ReferralOrigin[];
  teaching_workload: TeachingWorkload[];
  teacher_evaluations: TeacherEvaluation[];
  most_sought_courses: MostSoughtCourse[];
  financial_by_cohort: CohortFinancialRow[];
  financial: { collected_in_period: FinancialRow[]; outstanding_current: FinancialRow[]; by_course: FinancialRow[] };
  unit_summary: UnitSummary[];
  unit_financial: UnitFinancial[];
};

function day(date: Date) { return date.toISOString().slice(0, 10); }
function percentage(value: number | null) { return value === null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`; }
function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function currency(value: number, code: string) {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value); }
  catch { return `${value.toFixed(2)} ${code}`; }
}

export default function SuindaReportsPage() {
  const [from, setFrom] = useState(() => { const date = new Date(); date.setUTCFullYear(date.getUTCFullYear() - 1); return day(date); });
  const [to, setTo] = useState(() => day(new Date()));
  const [report, setReport] = useState<AcademicReport | null>(null);
  const [unitId, setUnitId] = useState("");
  const [availableUnits, setAvailableUnits] = useState<UnitSummary[]>([]);
  const [unitTeam, setUnitTeam] = useState<UnitTeamState | null>(null);
  const [unitTeamUser, setUnitTeamUser] = useState("");
  const [unitTeamRole, setUnitTeamRole] = useState("suinda_unit_reader");
  const [unitTeamError, setUnitTeamError] = useState("");
  const [unitTeamBusy, setUnitTeamBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingLedger, setExportingLedger] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ from, to });
      if (unitId) query.set("unit_id", unitId);
      const next = await api<AcademicReport>(`/extensions/suinda-learning/me/reports?${query.toString()}`);
      setReport(next);
      setAvailableUnits((current) => [...new Map([...current, ...next.unit_summary].map((unit) => [`${unit.workspace_id}:${unit.unit_record_id || "general"}`, unit])).values()]);
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os relatórios acadêmicos.");
    } finally { setLoading(false); }
  }, [from, to, unitId]);

  useEffect(() => { Promise.resolve().then(() => void load()); }, [load]);
  const selectedUnit = availableUnits.find((unit) => unit.unit_record_id === unitId);
  const selectedWorkspaceId = selectedUnit?.workspace_id;
  const selectedUnitRecordId = selectedUnit?.unit_record_id;
  const reloadUnitTeam = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedUnitRecordId) { setUnitTeam(null); return; }
    try {
      const result = await api<UnitTeamState & { workspace_id: string; unit_id: string }>(`/extensions/suinda-learning/workspaces/${selectedWorkspaceId}/units/${selectedUnitRecordId}/team`);
      setUnitTeam(result); setUnitTeamRole(result.roles.find((role) => role.id === "suinda_unit_reader")?.id || result.roles[0]?.id || ""); setUnitTeamError("");
    } catch (cause) { setUnitTeam(null); setUnitTeamError(cause instanceof Error ? cause.message : "Gestão da equipe indisponível para esta conta."); }
  }, [selectedWorkspaceId, selectedUnitRecordId]);
  useEffect(() => { Promise.resolve().then(() => void reloadUnitTeam()); }, [reloadUnitTeam]);
  async function saveUnitTeamMember() {
    if (!selectedUnit?.unit_record_id || !unitTeamUser || !unitTeamRole) return;
    setUnitTeamBusy(true); setUnitTeamError("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${selectedUnit.workspace_id}/units/${selectedUnit.unit_record_id}/team`, { method: "POST", body: JSON.stringify({ user_id: unitTeamUser, role_id: unitTeamRole }) });
      setUnitTeamUser(""); await reloadUnitTeam();
    } catch (cause) { setUnitTeamError(cause instanceof Error ? cause.message : "Não foi possível atualizar a equipe."); }
    finally { setUnitTeamBusy(false); }
  }
  async function removeUnitTeamMember(targetUserId: string) {
    if (!selectedUnit?.unit_record_id) return;
    setUnitTeamBusy(true); setUnitTeamError("");
    try {
      await api(`/extensions/suinda-learning/workspaces/${selectedUnit.workspace_id}/units/${selectedUnit.unit_record_id}/team/${targetUserId}`, { method: "DELETE" });
      await reloadUnitTeam();
    } catch (cause) { setUnitTeamError(cause instanceof Error ? cause.message : "Não foi possível remover a função."); }
    finally { setUnitTeamBusy(false); }
  }
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    root.dataset.theme = "dark";
    return () => { if (previousTheme) root.dataset.theme = previousTheme; else delete root.dataset.theme; };
  }, []);

  function exportCsv() {
    if (!report) return;
    const summaryHeaders = ["Indicador", "Valor"];
    const summaryRows = [["Alunos distintos", report.totals.distinct_learners], ["Conversão inscrição → matrícula (%)", report.totals.enrollment_conversion_percent],
      ["Matrículas convertidas", report.totals.converted_enrollments], ["Reprovação final (%)", report.totals.failure_rate_percent],
      ["Matrículas concluídas/reprovadas com nota final", report.totals.eligible_completions], ["Reprovadas com nota final", report.totals.failed_completions],
      ["Horas efetivamente ministradas", report.totals.taught_hours], ["Encontros concluídos", report.totals.taught_sessions],
      ["Horas práticas validadas", report.totals.validated_practice_hours]];
    const headers = ["Workspace", "Curso", "Estado", "Inscrições iniciadas", "Inscrições enviadas", "Matrículas convertidas", "Conversão inscrição → matrícula (%)", "Alunos distintos", "Alunos ativos", "Concluintes", "Reprovados com nota final", "Elegíveis à taxa de reprovação", "Reprovação (%)", "Desistências", "Recusadas", "Conclusão (%)", "Nota média (%)", "Avaliações corrigidas", "Frequência (%)", "Horas frequentadas", "Horas previstas", "Encontros realizados", "Horas ministradas", "Encontros concluídos", "Horas práticas validadas", "Certificados emitidos"];
    const rows = report.courses.map((course) => [course.workspace_name, course.title, course.state, course.applications_started,
      course.applications_submitted, course.converted_enrollments, course.enrollment_conversion_percent, course.distinct_learners, course.active_learners, course.completed, course.failed_completions, course.eligible_completions, course.failure_rate_percent, course.withdrawn, course.rejected,
      course.completion_rate_percent, course.average_grade, course.graded_items, course.attendance_percent,
      course.attended_hours, course.scheduled_hours, course.sessions_held, course.taught_hours, course.taught_sessions, course.validated_practice_hours, course.certificates_issued]);
    const financeHeaders = ["Workspace", "Curso", "Moeda", "Recebido no período", "Lançamentos", "Crédito de bolsa no período", "Saldo pendente atual", "Matrículas pendentes", "Matrículas em atraso", "Valor em atraso"];
    const financeRows = report.financial.by_course.map((line) => [line.workspace_name, line.course_title, line.currency,
      line.collected_in_period, line.payment_count, line.scholarship_credit_in_period, line.outstanding_balance, line.pending_enrollments, line.overdue_enrollments, line.overdue_balance]);
    const originHeaders = ["Workspace", "Curso", "Instituição indicada pelo candidato", "Inscrições"];
    const originRows = report.referral_origins.map((row) => [row.workspace_name, row.course_title, row.institution_referral, row.applications]);
    const trendHeaders = ["Mês", "Inscrições iniciadas", "Inscrições enviadas", "Conclusões", "Desistências"];
    const trendRows = report.monthly_trend.map((row) => [row.month, row.applications_started, row.applications_submitted, row.completed, row.withdrawn]);
    const attritionHeaders = ["Workspace", "Curso", "Turma", "Admitidos", "Desistências", "Evasão (%)"];
    const attritionRows = report.cohort_attrition.map((row) => [row.workspace_name, row.course_title, row.cohort_code, row.admitted, row.withdrawn, row.attrition_percent]);
    const occupancyHeaders = ["Workspace", "Curso", "Turma", "Estado", "Vagas ocupadas", "Capacidade", "Vagas disponíveis", "Ocupação (%)"];
    const occupancyRows = report.cohort_occupancy.map((row) => [row.workspace_name, row.course_title, row.cohort_code, row.state, row.occupied, row.capacity, row.available, row.occupancy_percent]);
    const workloadHeaders = ["Workspace", "Curso", "Docente", "Encontros atribuídos", "Horas previstas", "Itens corrigidos"];
    const workloadRows = report.teaching_workload.map((row) => [row.workspace_name, row.course_title, row.teacher_name, row.sessions_taught, row.scheduled_hours, row.taught_hours, row.graded_items]);
    const evaluationHeaders = ["Workspace", "Curso", "Docente", "Nota ponderada validada (0–5)", "Ciclos validados", "Respostas agregadas"];
    const evaluationRows = report.teacher_evaluations.map((row) => [row.workspace_name, row.course_title, row.teacher_name, row.weighted_score, row.validated_evaluations, row.response_count]);
    const soughtHeaders = ["Workspace", "Curso", "Inscrições iniciadas", "Inscrições enviadas"];
    const cohortFinanceHeaders = ["Workspace", "Curso", "Turma", "Moeda", "Recebido no período", "Baixas", "Crédito de bolsa", "Saldo atual", "Pendentes", "Matrículas em atraso", "Valor em atraso"];
    const cohortFinanceRows = report.financial_by_cohort.map((line) => [line.workspace_name, line.course_title, line.cohort_code, line.currency,
      line.collected_in_period, line.payment_count, line.scholarship_credit_in_period, line.outstanding_balance, line.pending_enrollments, line.overdue_enrollments, line.overdue_balance]);
    const unitHeaders = ["Workspace", "Unidade", "Código", "Cursos", "Matrículas no período", "Alunos distintos", "Ativos", "Concluídos", "Desistências"];
    const unitRows = report.unit_summary.map((row) => [row.workspace_name, row.unit_name, row.unit_code, row.courses, row.enrollments, row.distinct_learners, row.active_learners, row.completed, row.withdrawn]);
    const unitFinancialHeaders = ["Workspace", "Unidade", "Moeda", "Recebido no período", "Baixas", "Crédito de bolsa", "Saldo pendente", "Matrículas pendentes", "Matrículas em atraso", "Valor em atraso"];
    const unitFinancialRows = report.unit_financial.map((row) => [row.workspace_name, row.unit_name, row.currency, row.collected_in_period, row.payment_count, row.scholarship_credit_in_period, row.outstanding_balance, row.pending_enrollments, row.overdue_enrollments, row.overdue_balance]);
    const csv = [summaryHeaders, ...summaryRows, [], headers, ...rows, [], ["Cursos mais procurados no período"], soughtHeaders,
      ...report.most_sought_courses.map((row) => [row.workspace_name, row.course_title, row.applications_started, row.applications_submitted]),
      [], trendHeaders, ...trendRows, [], attritionHeaders, ...attritionRows, [], occupancyHeaders, ...occupancyRows, [], workloadHeaders,
      ["Workspace", "Curso", "Docente", "Encontros concluídos", "Horas previstas", "Horas ministradas", "Itens corrigidos"], ...workloadRows,
      [], ["Avaliações docentes validadas · somente agregados"], evaluationHeaders, ...evaluationRows,
      [], originHeaders, ...originRows, [], ["Indicadores por unidade"], unitHeaders, ...unitRows, [], ["Financeiro por unidade"], unitFinancialHeaders, ...unitFinancialRows, [], financeHeaders, ...financeRows, [], ["Financeiro por turma"], cohortFinanceHeaders, ...cohortFinanceRows].map((row) => row.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `suinda-relatorios-${report.range.from}-${report.range.to}.csv`;
    anchor.click(); URL.revokeObjectURL(url);
  }

  async function exportXlsx() {
    if (!report || exportingXlsx) return;
    setExportingXlsx(true);
    try {
      const occupancyHeaders = ["Workspace", "Curso", "Turma", "Estado", "Vagas ocupadas", "Capacidade", "Vagas disponíveis", "Ocupação (%)"];
      const occupancyRows = report.cohort_occupancy.map((row) => [row.workspace_name, row.course_title, row.cohort_code, row.state, row.occupied, row.capacity, row.available, row.occupancy_percent]);
      const courseHeaders = ["Workspace", "Curso", "Estado", "Inscrições iniciadas", "Inscrições enviadas", "Matrículas convertidas", "Conversão inscrição → matrícula (%)", "Alunos distintos", "Alunos ativos", "Concluintes", "Reprovados com nota final", "Elegíveis à taxa de reprovação", "Reprovação (%)", "Desistências", "Recusadas", "Conclusão (%)", "Nota média (%)", "Avaliações corrigidas", "Frequência (%)", "Horas frequentadas", "Horas previstas", "Encontros realizados", "Horas ministradas", "Encontros concluídos", "Horas práticas validadas", "Certificados emitidos"];
      const courses = report.courses.map((course) => [course.workspace_name, course.title, course.state, course.applications_started,
        course.applications_submitted, course.converted_enrollments, course.enrollment_conversion_percent, course.distinct_learners, course.active_learners, course.completed, course.failed_completions, course.eligible_completions, course.failure_rate_percent, course.withdrawn, course.rejected,
        course.completion_rate_percent, course.average_grade, course.graded_items, course.attendance_percent,
        course.attended_hours, course.scheduled_hours, course.sessions_held, course.taught_hours, course.taught_sessions, course.validated_practice_hours, course.certificates_issued]);
      const unitHeaders = ["Workspace", "Unidade", "Código", "Cursos", "Matrículas no período", "Alunos distintos", "Ativos", "Concluídos", "Desistências"];
      const unitRows = report.unit_summary.map((row) => [row.workspace_name, row.unit_name, row.unit_code, row.courses, row.enrollments, row.distinct_learners, row.active_learners, row.completed, row.withdrawn]);
      const unitFinancialHeaders = ["Workspace", "Unidade", "Moeda", "Recebido no período", "Baixas", "Crédito de bolsa", "Saldo pendente", "Matrículas pendentes", "Matrículas em atraso", "Valor em atraso"];
      const unitFinancialRows = report.unit_financial.map((row) => [row.workspace_name, row.unit_name, row.currency, row.collected_in_period, row.payment_count, row.scholarship_credit_in_period, row.outstanding_balance, row.pending_enrollments, row.overdue_enrollments, row.overdue_balance]);
      const sheets = [
        { name: "Resumo", rows: [["Indicador", "Valor"], ["Alunos distintos", report.totals.distinct_learners], ["Conversão inscrição → matrícula (%)", report.totals.enrollment_conversion_percent], ["Matrículas convertidas", report.totals.converted_enrollments], ["Reprovação final (%)", report.totals.failure_rate_percent], ["Matrículas concluídas/reprovadas com nota final", report.totals.eligible_completions], ["Reprovadas com nota final", report.totals.failed_completions], ["Horas efetivamente ministradas", report.totals.taught_hours], ["Encontros concluídos", report.totals.taught_sessions], ["Horas práticas validadas", report.totals.validated_practice_hours]] },
        { name: "Cursos", rows: [courseHeaders, ...courses] },
        { name: "Cursos procurados", rows: [["Workspace", "Curso", "Inscrições iniciadas", "Inscrições enviadas"], ...report.most_sought_courses.map((row) => [row.workspace_name, row.course_title, row.applications_started, row.applications_submitted])] },
        { name: "Evolução mensal", rows: [["Mês", "Inscrições iniciadas", "Inscrições enviadas", "Conclusões", "Desistências"], ...report.monthly_trend.map((row) => [row.month, row.applications_started, row.applications_submitted, row.completed, row.withdrawn])] },
        { name: "Evasão por turma", rows: [["Workspace", "Curso", "Turma", "Admitidos", "Desistências", "Evasão (%)"], ...report.cohort_attrition.map((row) => [row.workspace_name, row.course_title, row.cohort_code, row.admitted, row.withdrawn, row.attrition_percent])] },
        { name: "Ocupação por turma", rows: [occupancyHeaders, ...occupancyRows] },
        { name: "Unidades", rows: [unitHeaders, ...unitRows] },
        { name: "Financeiro por unidade", rows: [unitFinancialHeaders, ...unitFinancialRows] },
        { name: "Carga docente", rows: [["Workspace", "Curso", "Docente", "Encontros concluídos", "Horas previstas", "Horas ministradas", "Itens corrigidos"], ...report.teaching_workload.map((row) => [row.workspace_name, row.course_title, row.teacher_name, row.sessions_taught, row.scheduled_hours, row.taught_hours, row.graded_items])] },
        { name: "Avaliações docentes", rows: [["Workspace", "Curso", "Docente", "Nota ponderada validada (0–5)", "Ciclos validados", "Respostas agregadas"], ...report.teacher_evaluations.map((row) => [row.workspace_name, row.course_title, row.teacher_name, row.weighted_score, row.validated_evaluations, row.response_count])] },
        { name: "Indicações", rows: [["Workspace", "Curso", "Instituição indicada pelo candidato", "Inscrições"], ...report.referral_origins.map((row) => [row.workspace_name, row.course_title, row.institution_referral, row.applications])] },
        { name: "Financeiro", rows: [["Workspace", "Curso", "Moeda", "Recebido no período", "Lançamentos", "Crédito de bolsa no período", "Saldo pendente atual", "Matrículas pendentes", "Matrículas em atraso", "Valor em atraso"], ...report.financial.by_course.map((line) => [line.workspace_name, line.course_title, line.currency, line.collected_in_period, line.payment_count, line.scholarship_credit_in_period, line.outstanding_balance, line.pending_enrollments, line.overdue_enrollments, line.overdue_balance])] },
        { name: "Financeiro por turma", rows: [["Workspace", "Curso", "Turma", "Moeda", "Recebido no período", "Baixas", "Crédito de bolsa", "Saldo atual", "Pendentes", "Matrículas em atraso", "Valor em atraso"], ...report.financial_by_cohort.map((line) => [line.workspace_name, line.course_title, line.cohort_code, line.currency, line.collected_in_period, line.payment_count, line.scholarship_credit_in_period, line.outstanding_balance, line.pending_enrollments, line.overdue_enrollments, line.overdue_balance])] },
      ];
      const blob = await createXlsx(sheets);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `suinda-relatorios-${report.range.from}-${report.range.to}.xlsx`;
      anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? `Não foi possível gerar o XLSX: ${cause.message}` : "Não foi possível gerar o XLSX.");
    } finally { setExportingXlsx(false); }
  }

  async function exportPdf() {
    if (!report || exportingPdf) return;
    setExportingPdf(true); setError("");
    try {
      const query = new URLSearchParams({ from: report.range.from, to: report.range.to });
      if (unitId) query.set("unit_id", unitId);
      const blob = await apiBlob(`/extensions/suinda-learning/me/reports.pdf?${query.toString()}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `suinda-relatorios-${report.range.from}-${report.range.to}.pdf`;
      anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? `Não foi possível gerar o PDF: ${cause.message}` : "Não foi possível gerar o PDF.");
    } finally { setExportingPdf(false); }
  }

  async function exportLedger() {
    if (!report || exportingLedger) return;
    setExportingLedger(true); setError("");
    try {
      const query = new URLSearchParams({ from, to });
      if (unitId) query.set("unit_id", unitId);
      const blob = await apiBlob(`/extensions/suinda-learning/me/finance-ledger.csv?${query.toString()}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `suinda-lancamentos-${from}-${to}.csv`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? `Não foi possível exportar os lançamentos financeiros: ${cause.message}` : "Não foi possível exportar os lançamentos financeiros.");
    } finally { setExportingLedger(false); }
  }

  const totals = report?.totals;
  const cards = totals ? [
    ["Cursos no escopo", totals.courses], ["Inscrições iniciadas", totals.applications_started],
    ["Conversão inscrição → matrícula", `${totals.converted_enrollments} · ${percentage(totals.enrollment_conversion_percent)}`],
    ["Alunos distintos no período", totals.distinct_learners], ["Alunos ativos", totals.active_learners], ["Concluintes", totals.completed],
    ["Reprovação final", `${totals.failed_completions} / ${totals.eligible_completions} · ${percentage(totals.failure_rate_percent)}`],
    ["Conclusão sobre inscrições", percentage(totals.completion_rate_percent)], ["Nota média", percentage(totals.average_grade)],
    ["Frequência média", percentage(totals.attendance_percent)], ["Certificados emitidos", totals.certificates_issued],
    ["Horas frequentadas / previstas", `${totals.attended_hours} / ${totals.scheduled_hours}`], ["Encontros realizados", totals.sessions_held],
    ["Horas efetivamente ministradas", totals.taught_hours], ["Encontros concluídos", totals.taught_sessions],
    ["Horas práticas validadas", totals.validated_practice_hours],
  ] : [];

  return <main className="min-h-screen bg-[#1d2125] px-4 py-7 text-[#dee4ea] sm:px-7 lg:py-10"><div className="mx-auto max-w-7xl">
    <Link href="/suinda" className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-[#b6c2cf] hover:text-cyan-200"><ArrowLeft size={16} aria-hidden="true" /> Voltar ao painel</Link>
    <header className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(167,139,250,0.12),_transparent_45%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-5 sm:p-7">
      <div><p className="text-xs font-medium uppercase tracking-[.14em] text-violet-200">Suindá · coordenação</p><h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Relatórios acadêmicos</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#b6c2cf]">Indicadores agregados dos workspaces em que você tem permissão de gestão. O relatório não apresenta dados individuais de alunos; a seção docente identifica profissionais e resume a atividade registrada.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={exportCsv} disabled={!report || loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200/20 bg-violet-200/[0.07] px-3 text-sm text-violet-100 hover:bg-violet-200/10 disabled:opacity-50"><Download size={15} aria-hidden="true" /> Exportar CSV</button><button type="button" onClick={() => void exportLedger()} disabled={!report || loading || exportingLedger} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.07] px-3 text-sm text-emerald-100 hover:bg-emerald-200/10 disabled:opacity-50"><FileSpreadsheet size={15} aria-hidden="true" />{exportingLedger ? "Exportando lançamentos…" : "Lançamentos para conciliação"}</button><button type="button" onClick={() => void exportXlsx()} disabled={!report || loading || exportingXlsx} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.07] px-3 text-sm text-cyan-100 hover:bg-cyan-200/10 disabled:opacity-50"><FileSpreadsheet size={15} aria-hidden="true" />{exportingXlsx ? "Gerando XLSX…" : "Exportar XLSX"}</button><button type="button" onClick={() => void exportPdf()} disabled={!report || loading || exportingPdf} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200/20 bg-rose-200/[0.07] px-3 text-sm text-rose-100 hover:bg-rose-200/10 disabled:opacity-50"><FileDown size={15} aria-hidden="true" />{exportingPdf ? "Gerando PDF…" : "Exportar PDF"}</button></div>
    </header>
    <section className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-4" aria-label="Período do relatório">
      <label className="block text-xs text-[#b6c2cf]">De<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" /></label>
      <label className="block text-xs text-[#b6c2cf]">Até<input type="date" value={to} min={from} max={day(new Date())} onChange={(event) => setTo(event.target.value)} className="mt-1 min-h-10 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" /></label>
      <label className="block text-xs text-[#b6c2cf]">Unidade<select value={unitId} onChange={(event) => setUnitId(event.target.value)} className="mt-1 min-h-10 min-w-48 rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white"><option value="">Todas as unidades autorizadas</option>{availableUnits.filter((unit) => unit.unit_record_id).map((unit) => <option key={`${unit.workspace_id}:${unit.unit_record_id}`} value={unit.unit_record_id!}>{unit.workspace_name} · {unit.unit_name}</option>)}</select></label>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-200 px-3 text-sm font-semibold text-slate-950 disabled:opacity-50"><RefreshCw size={14} aria-hidden="true" /> Atualizar</button>
      {report && <p className="ml-auto text-xs text-[#9fadbc]">{report.workspace_count} workspaces · atualizado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(report.generated_at))}</p>}
    </section>
    {report && <SuindaFinancialReconciliation
      workspaces={[...new Map(report.unit_summary.map((unit) => [unit.workspace_id, { workspace_id: unit.workspace_id, workspace_name: unit.workspace_name }])).values()]}
      units={availableUnits}
      initialWorkspaceId={selectedUnit?.workspace_id || report.unit_summary[0]?.workspace_id}
      initialUnitId={unitId}
      requireUnit={report.unit_scope}
      periodFrom={from}
      periodTo={to}
    />}
    {report && <section className="mt-5 grid gap-3" aria-label="Gestão de pagamentos por instituição">{[...new Map(report.courses.map((course) => [course.workspace_id, course.workspace_name])).entries()].map(([workspaceId, workspaceName]) => <div key={workspaceId}><p className="mb-2 text-xs font-medium text-[#9fadbc]">{workspaceName}</p><div className="grid gap-3 xl:grid-cols-2"><PaymentProviderSettings workspaceId={workspaceId} /><PaymentReviewQueue workspaceId={workspaceId} /></div></div>)}</section>}
    {selectedUnit?.unit_record_id && <section className="mt-5 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5" aria-labelledby="unit-team-title">
      <h2 id="unit-team-title" className="text-lg font-semibold text-white">Equipe da unidade · {selectedUnit.unit_name}</h2>
      <p className="mt-1 text-sm text-[#9fadbc]">Atribua funções apenas a membros ativos deste workspace. A função vale somente para esta unidade e não concede acesso global.</p>
      {unitTeamError && <p role="alert" className="mt-3 rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{unitTeamError}</p>}
      {unitTeam && <>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-xs text-[#b6c2cf]">Membro do workspace<select value={unitTeamUser} onChange={(event) => setUnitTeamUser(event.target.value)} className="mt-1 min-h-10 min-w-56 rounded-lg border border-[#3b4754] bg-[#22282e] px-3 text-sm text-white"><option value="">Selecione uma pessoa</option>{unitTeam.users.filter((person) => !unitTeam.members.some((member) => member.user_id === person.id)).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select></label>
          <label className="block text-xs text-[#b6c2cf]">Função<select value={unitTeamRole} onChange={(event) => setUnitTeamRole(event.target.value)} className="mt-1 min-h-10 min-w-56 rounded-lg border border-[#3b4754] bg-[#22282e] px-3 text-sm text-white">{unitTeam.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <button type="button" disabled={unitTeamBusy || !unitTeamUser || !unitTeamRole} onClick={() => void saveUnitTeamMember()} className="min-h-10 rounded-lg bg-cyan-200 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">Atribuir função</button>
        </div>
        <ul className="mt-4 divide-y divide-white/[0.08]">{unitTeam.members.map((member) => <li key={`${member.user_id}:${member.role_id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span className="text-white">{member.name} <span className="text-[#9fadbc]">· {member.email} · {member.role_name}</span></span><button type="button" disabled={unitTeamBusy} onClick={() => void removeUnitTeamMember(member.user_id)} className="min-h-9 rounded-lg border border-rose-200/20 px-3 text-rose-100 hover:bg-rose-200/10 disabled:opacity-50">Remover da unidade</button></li>)}</ul>
        {!unitTeam.members.length && <p className="mt-3 text-sm text-[#9fadbc]">Nenhum membro recebeu função específica nesta unidade.</p>}
      </>}
    </section>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</p>}
    {loading && <p role="status" className="mt-5 text-sm text-[#9fadbc]">Calculando indicadores no escopo autorizado…</p>}
    {!loading && totals && <>
      {!report?.unit_scope && <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Indicadores agregados">{cards.map(([label, value]) => <article key={String(label)} className="rounded-xl border border-[#3b4754] bg-[#2c333a] p-4"><p className="text-xs text-[#9fadbc]">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p></article>)}</section>}
      {!report?.unit_scope && <>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="most-sought-title"><div className="border-b border-white/[0.08] p-5"><h2 id="most-sought-title" className="text-lg font-semibold text-white">Cursos mais procurados</h2><p className="mt-1 text-xs text-[#9fadbc]">Ordenados pelo número de inscrições iniciadas no intervalo; inscrições enviadas aparecem como contexto.</p></div>
        {report.most_sought_courses.length ? <div role="region" aria-label="Tabela de cursos mais procurados" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[640px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Inscrições iniciadas", "Enviadas"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.most_sought_courses.map((row) => <tr key={row.course_id} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{row.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{row.course_title}</th><td className="px-4 py-3">{row.applications_started}</td><td className="px-4 py-3">{row.applications_submitted}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhuma inscrição foi iniciada no intervalo.</p>}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="unit-summary-title"><div className="border-b border-white/[0.08] p-5"><h2 id="unit-summary-title" className="text-lg font-semibold text-white">Indicadores por unidade</h2><p className="mt-1 text-xs text-[#9fadbc]">Agregados das matrículas criadas no período, respeitando o workspace em que você tem permissão de gestão. “Sem unidade” reúne os registros gerais.</p></div>{report.unit_summary.length ? <div role="region" aria-label="Tabela de indicadores por unidade" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Unidade", "Código", "Cursos", "Matrículas", "Alunos distintos", "Ativos", "Concluídos", "Desistências"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.unit_summary.map((row) => <tr key={`${row.workspace_id}:${row.unit_record_id || "general"}`} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{row.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{row.unit_name}</th><td className="px-4 py-3">{row.unit_code || "—"}</td><td className="px-4 py-3">{row.courses}</td><td className="px-4 py-3">{row.enrollments}</td><td className="px-4 py-3">{row.distinct_learners}</td><td className="px-4 py-3">{row.active_learners}</td><td className="px-4 py-3">{row.completed}</td><td className="px-4 py-3">{row.withdrawn}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhuma unidade ou matrícula foi encontrada no escopo autorizado.</p>}</section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="unit-financial-title"><div className="border-b border-white/[0.08] p-5"><h2 id="unit-financial-title" className="text-lg font-semibold text-white">Financeiro por unidade</h2><p className="mt-1 text-xs text-[#9fadbc]">Valores agregados a partir do vínculo de unidade registrado em cada matrícula. Saldos pendentes são posições atuais; recebimentos seguem o intervalo escolhido.</p></div>{report.unit_financial.length ? <div role="region" aria-label="Tabela de financeiro por unidade" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[1000px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Unidade", "Moeda", "Recebido no período", "Baixas", "Crédito de bolsa", "Saldo atual", "Pendentes", "Em atraso", "Valor em atraso"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.unit_financial.map((row) => <tr key={`${row.workspace_id}:${row.unit_record_id || "general"}:${row.currency}`} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{row.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{row.unit_name}</th><td className="px-4 py-3">{row.currency}</td><td className="px-4 py-3">{currency(row.collected_in_period, row.currency)}</td><td className="px-4 py-3">{row.payment_count}</td><td className="px-4 py-3">{currency(row.scholarship_credit_in_period, row.currency)}</td><td className="px-4 py-3">{currency(row.outstanding_balance, row.currency)}</td><td className="px-4 py-3">{row.pending_enrollments}</td><td className="px-4 py-3">{row.overdue_enrollments}</td><td className="px-4 py-3">{currency(row.overdue_balance, row.currency)}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhum lançamento financeiro por unidade foi encontrado.</p>}</section>
      <section className="mt-5 rounded-2xl border border-[#3b4754] bg-[#2c333a] p-5" aria-labelledby="report-trend-title">
        <h2 id="report-trend-title" className="text-lg font-semibold text-white">Evolução mensal</h2>
        <p className="mt-1 text-xs text-[#9fadbc]">Eventos de inscrições e mudanças de estado registradas no histórico versionado durante o período.</p>
        {report.monthly_trend.length ? <>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#b6c2cf]">{[["Inscrições iniciadas", "#67e8f9"], ["Enviadas", "#a78bfa"], ["Conclusões", "#4ade80"], ["Desistências", "#fb7185"]].map(([label, color]) => <span key={label} className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>)}</div>
          <svg className="mt-4 h-64 w-full overflow-visible" viewBox="0 0 800 240" role="img" aria-labelledby="report-trend-svg-title report-trend-svg-desc" preserveAspectRatio="none">
            <title id="report-trend-svg-title">Tendência mensal das inscrições acadêmicas</title><desc id="report-trend-svg-desc">Compara inscrições iniciadas e enviadas, conclusões e desistências por mês.</desc>
            {[0, 1, 2, 3].map((line) => <line key={line} x1="36" x2="788" y1={24 + line * 58} y2={24 + line * 58} stroke="rgba(255,255,255,.09)" strokeDasharray="4 5" />)}
            {([["applications_started", "#67e8f9"], ["applications_submitted", "#a78bfa"], ["completed", "#4ade80"], ["withdrawn", "#fb7185"]] as const).map(([key, color]) => {
              const maxValue = Math.max(1, ...report.monthly_trend.flatMap((row) => [row.applications_started, row.applications_submitted, row.completed, row.withdrawn]));
              const points = report.monthly_trend.map((row, index) => `${report.monthly_trend.length === 1 ? 412 : 40 + index * 744 / (report.monthly_trend.length - 1)},${214 - Number(row[key]) / maxValue * 184}`).join(" ");
              return <g key={key}><polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{report.monthly_trend.map((row, index) => <circle key={`${key}:${row.month}`} cx={report.monthly_trend.length === 1 ? 412 : 40 + index * 744 / (report.monthly_trend.length - 1)} cy={214 - Number(row[key]) / maxValue * 184} r="3.5" fill={color}><title>{`${row.month}: ${row[key]}`}</title></circle>)}</g>;
            })}
          </svg>
          <div className="mt-1 flex justify-between text-[10px] text-[#b6c2cf]"><span>{report.monthly_trend[0].month}</span><span>{report.monthly_trend.at(-1)?.month}</span></div>
          <table className="sr-only"><caption>Dados da evolução mensal exibida no gráfico</caption><thead><tr><th scope="col">Mês</th><th scope="col">Inscrições iniciadas</th><th scope="col">Enviadas</th><th scope="col">Conclusões</th><th scope="col">Desistências</th></tr></thead><tbody>{report.monthly_trend.map((row) => <tr key={row.month}><th scope="row">{row.month}</th><td>{row.applications_started}</td><td>{row.applications_submitted}</td><td>{row.completed}</td><td>{row.withdrawn}</td></tr>)}</tbody></table>
        </> : <p className="mt-4 text-sm text-[#9fadbc]">Não há eventos no período selecionado.</p>}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="cohort-attrition-title"><div className="border-b border-white/[0.08] p-5"><h2 id="cohort-attrition-title" className="text-lg font-semibold text-white">Evasão por turma</h2><p className="mt-1 text-xs text-[#9fadbc]">Percentual de desistências entre matrículas admitidas no período, agrupadas pela turma vinculada. Registros sem turma aparecem separados.</p></div>
        {report.cohort_attrition.length ? <div role="region" aria-label="Tabela de evasão por turma" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[760px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Turma", "Admitidos", "Desistências", "Evasão"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.cohort_attrition.map((row) => <tr key={`${row.course_id}:${row.cohort_record_id || "open"}`} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{row.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{row.course_title}</th><td className="px-4 py-3">{row.cohort_code}</td><td className="px-4 py-3">{row.admitted}</td><td className="px-4 py-3">{row.withdrawn}</td><td className="px-4 py-3">{percentage(row.attrition_percent)}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhuma turma teve matrícula admitida neste período.</p>}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="course-report-title"><div className="border-b border-white/[0.08] p-5"><h2 id="course-report-title" className="text-lg font-semibold text-white">Detalhamento por curso</h2><p className="mt-1 text-xs text-[#9fadbc]">Alunos distintos contam pessoas com matrícula admitida no intervalo sem somar a mesma pessoa mais de uma vez no total geral. Reprovação considera somente matrículas concluídas ou reprovadas com nota final registrada; o estado reprovado é a fonte do resultado. Horas ministradas incluem apenas encontros concluídos com duração positiva; horas práticas incluem somente práticas validadas no período.</p></div>
        {report?.courses.length ? <div role="region" aria-label="Tabela de detalhamento por curso" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[1680px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Inscrições", "Enviadas", "Alunos distintos", "Ativos", "Concluídos", "Reprovados", "Elegíveis reprovação", "Reprovação", "Desistências", "Conclusão", "Nota média", "Frequência", "Horas frequentadas", "Horas previstas", "Encontros", "Horas ministradas", "Encontros concluídos", "Horas práticas validadas", "Certificados"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.courses.map((course) => <tr key={course.course_id} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{course.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{course.title}</th><td className="px-4 py-3">{course.applications_started}</td><td className="px-4 py-3">{course.applications_submitted}</td><td className="px-4 py-3">{course.distinct_learners}</td><td className="px-4 py-3">{course.active_learners}</td><td className="px-4 py-3">{course.completed}</td><td className="px-4 py-3">{course.failed_completions}</td><td className="px-4 py-3">{course.eligible_completions}</td><td className="px-4 py-3">{percentage(course.failure_rate_percent)}</td><td className="px-4 py-3">{course.withdrawn}</td><td className="px-4 py-3">{percentage(course.completion_rate_percent)}</td><td className="px-4 py-3">{percentage(course.average_grade)}</td><td className="px-4 py-3">{percentage(course.attendance_percent)}</td><td className="px-4 py-3">{course.attended_hours} h</td><td className="px-4 py-3">{course.scheduled_hours} h</td><td className="px-4 py-3">{course.sessions_held}</td><td className="px-4 py-3">{course.taught_hours} h</td><td className="px-4 py-3">{course.taught_sessions}</td><td className="px-4 py-3">{course.validated_practice_hours} h</td><td className="px-4 py-3">{course.certificates_issued}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhum curso foi encontrado nos workspaces autorizados.</p>}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="cohort-occupancy-title"><div className="border-b border-white/[0.08] p-5"><h2 id="cohort-occupancy-title" className="text-lg font-semibold text-white">Ocupação atual das turmas</h2><p className="mt-1 text-xs text-[#9fadbc]">Posição atual das turmas abertas, ativas ou encerradas. Contam vagas reservadas por matrículas aprovadas, matriculadas, ativas ou trancadas; turmas sem capacidade definida não têm percentual.</p></div>
        {report.cohort_occupancy.length ? <div role="region" aria-label="Tabela de ocupação atual das turmas" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[840px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Turma", "Estado", "Ocupadas", "Capacidade", "Disponíveis", "Ocupação"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.cohort_occupancy.map((row) => <tr key={row.cohort_record_id} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{row.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{row.course_title}</th><td className="px-4 py-3">{row.cohort_code}</td><td className="px-4 py-3">{row.state}</td><td className="px-4 py-3">{row.occupied}</td><td className="px-4 py-3">{row.capacity ?? "Sem limite"}</td><td className="px-4 py-3">{row.available ?? "—"}</td><td className="px-4 py-3">{percentage(row.occupancy_percent)}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhuma turma ativa ou com capacidade foi encontrada no escopo autorizado.</p>}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="teaching-workload-title"><div className="border-b border-white/[0.08] p-5"><h2 id="teaching-workload-title" className="text-lg font-semibold text-white">Carga de trabalho docente</h2><p className="mt-1 text-xs text-[#9fadbc]">Exibe atividade objetiva registrada: encontros vinculados, horas previstas, horas efetivamente ministradas somente em encontros concluídos e itens corrigidos. Horas podem ser atribuídas a mais de um docente quando o encontro é compartilhado. Não é uma avaliação qualitativa de desempenho.</p></div>
        {report.teaching_workload.length ? <div role="region" aria-label="Tabela de carga de trabalho docente" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Docente", "Encontros concluídos", "Horas previstas", "Horas ministradas", "Itens corrigidos"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.teaching_workload.map((row) => <tr key={`${row.course_id}:${row.teacher_user_id}`} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{row.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{row.course_title}</th><td className="px-4 py-3">{row.teacher_name}</td><td className="px-4 py-3">{row.sessions_taught}</td><td className="px-4 py-3">{row.scheduled_hours} h</td><td className="px-4 py-3">{row.taught_hours} h</td><td className="px-4 py-3">{row.graded_items}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhuma carga docente foi encontrada no período selecionado.</p>}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="teacher-evaluations-title"><div className="border-b border-white/[0.08] p-5"><h2 id="teacher-evaluations-title" className="text-lg font-semibold text-white">Avaliações docentes validadas</h2><p className="mt-1 text-xs text-[#9fadbc]">Mostra somente ciclos aprovados por revisão institucional independente, com amostra mínima. A nota combina os critérios pelos pesos aprovados; respostas individuais e texto livre nunca são exibidos. O resultado não automatiza consequência profissional.</p></div>
        {report.teacher_evaluations.length ? <div role="region" aria-label="Tabela de avaliações docentes validadas" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[760px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Docente", "Nota ponderada (0–5)", "Ciclos validados", "Respostas agregadas"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.teacher_evaluations.map((row) => <tr key={`${row.course_id}:${row.teacher_user_id}`} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{row.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{row.course_title}</th><td className="px-4 py-3">{row.teacher_name}</td><td className="px-4 py-3">{row.weighted_score.toFixed(2)}</td><td className="px-4 py-3">{row.validated_evaluations}</td><td className="px-4 py-3">{row.response_count}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">{report.unit_scope ? "Resultados nominais de avaliação docente não são exibidos em relatórios restritos à unidade." : "Não há ciclos de avaliação docente validados neste período."}</p>}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="referral-origin-title"><div className="border-b border-white/[0.08] p-5"><h2 id="referral-origin-title" className="text-lg font-semibold text-white">Indicações institucionais</h2><p className="mt-1 text-xs text-[#9fadbc]">Origem informada pelo candidato nas inscrições do período; os nomes não são verificados automaticamente.</p></div>{report.referral_origins.length ? <div role="region" aria-label="Tabela de indicações institucionais" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[720px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Instituição indicada", "Inscrições"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.referral_origins.map((origin, index) => <tr key={`${origin.course_id}:${origin.institution_referral}:${index}`} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{origin.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{origin.course_title}</th><td className="px-4 py-3">{origin.institution_referral}</td><td className="px-4 py-3">{origin.applications}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhuma indicação institucional informada neste período.</p>}</section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="financial-report-title"><div className="border-b border-white/[0.08] p-5"><h2 id="financial-report-title" className="text-lg font-semibold text-white">Receita e saldos pendentes</h2><p className="mt-1 text-xs text-[#9fadbc]">Recebimentos usam a data de baixa no período selecionado. O saldo pendente e o valor em atraso são posições atuais. A inadimplência é projetada por vencimento, parcelas e pagamentos/bolsas lançados, com créditos alocados às parcelas mais antigas.</p></div>
        {report.financial.by_course.length ? <div role="region" aria-label="Tabela de receita e saldos pendentes" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[1050px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Moeda", "Recebido no período", "Baixas", "Crédito de bolsa", "Saldo atual", "Pendentes", "Matrículas em atraso", "Valor em atraso"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.financial.by_course.map((line) => <tr key={`${line.course_id}:${line.currency}`} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{line.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{line.course_title}</th><td className="px-4 py-3">{line.currency}</td><td className="px-4 py-3">{currency(line.collected_in_period, line.currency)}</td><td className="px-4 py-3">{line.payment_count}</td><td className="px-4 py-3">{currency(line.scholarship_credit_in_period, line.currency)}</td><td className="px-4 py-3">{currency(line.outstanding_balance, line.currency)}</td><td className="px-4 py-3">{line.pending_enrollments}</td><td className="px-4 py-3">{line.overdue_enrollments}</td><td className="px-4 py-3">{currency(line.overdue_balance, line.currency)}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhum pagamento ou saldo pendente encontrado nos workspaces autorizados.</p>}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="cohort-financial-title"><div className="border-b border-white/[0.08] p-5"><h2 id="cohort-financial-title" className="text-lg font-semibold text-white">Receita e saldos por turma</h2><p className="mt-1 text-xs text-[#9fadbc]">Baixas seguem a data selecionada e são vinculadas à turma da matrícula. Saldos pendentes representam a posição atual. Matrículas sem turma aparecem como “Sem turma”.</p></div>
        {report.financial_by_cohort.length ? <div role="region" aria-label="Tabela de receita e saldos por turma" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[1100px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Workspace", "Curso", "Turma", "Moeda", "Recebido no período", "Baixas", "Crédito de bolsa", "Saldo atual", "Pendentes", "Matrículas em atraso", "Valor em atraso"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.financial_by_cohort.map((line) => <tr key={`${line.course_id}:${line.cohort_record_id || "open"}:${line.currency}`} className="text-[#b6c2cf]"><td className="px-4 py-3 text-[#9fadbc]">{line.workspace_name}</td><th scope="row" className="px-4 py-3 font-medium text-white">{line.course_title}</th><td className="px-4 py-3">{line.cohort_code}</td><td className="px-4 py-3">{line.currency}</td><td className="px-4 py-3">{currency(line.collected_in_period, line.currency)}</td><td className="px-4 py-3">{line.payment_count}</td><td className="px-4 py-3">{currency(line.scholarship_credit_in_period, line.currency)}</td><td className="px-4 py-3">{currency(line.outstanding_balance, line.currency)}</td><td className="px-4 py-3">{line.pending_enrollments}</td><td className="px-4 py-3">{line.overdue_enrollments}</td><td className="px-4 py-3">{currency(line.overdue_balance, line.currency)}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Nenhuma baixa ou saldo pendente por turma no período.</p>}
      </section>
      </>}
      {report?.unit_scope && <>
        <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="scoped-unit-summary-title"><div className="border-b border-white/[0.08] p-5"><h2 id="scoped-unit-summary-title" className="text-lg font-semibold text-white">Indicadores da unidade autorizada</h2><p className="mt-1 text-xs text-[#9fadbc]">Dados agregados das matrículas criadas entre {report.range.from} e {report.range.to}. Sem acesso a outras unidades ou a detalhes de alunos.</p></div><div role="region" aria-label="Tabela de indicadores da unidade autorizada" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[800px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Unidade", "Cursos", "Matrículas", "Alunos distintos", "Ativos", "Concluídos", "Desistências"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.unit_summary.map((row) => <tr key={`${row.workspace_id}:${row.unit_record_id || "general"}`} className="text-[#b6c2cf]"><th scope="row" className="px-4 py-3 font-medium text-white">{row.workspace_name} · {row.unit_name}</th><td className="px-4 py-3">{row.courses}</td><td className="px-4 py-3">{row.enrollments}</td><td className="px-4 py-3">{row.distinct_learners}</td><td className="px-4 py-3">{row.active_learners}</td><td className="px-4 py-3">{row.completed}</td><td className="px-4 py-3">{row.withdrawn}</td></tr>)}</tbody></table></div></section>
        <section className="mt-5 overflow-hidden rounded-2xl border border-[#3b4754] bg-[#2c333a]" aria-labelledby="scoped-unit-finance-title"><div className="border-b border-white/[0.08] p-5"><h2 id="scoped-unit-finance-title" className="text-lg font-semibold text-white">Financeiro da unidade autorizada</h2><p className="mt-1 text-xs text-[#9fadbc]">Agregado pela atribuição histórica da matrícula; valores de atraso e saldo são posições atuais.</p></div>{report.unit_financial.length ? <div role="region" aria-label="Tabela de financeiro da unidade autorizada" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-white/[0.03] text-[#9fadbc]"><tr>{["Unidade", "Moeda", "Recebido no período", "Baixas", "Crédito de bolsa", "Saldo atual", "Pendentes", "Em atraso", "Valor em atraso"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{report.unit_financial.map((row) => <tr key={`${row.workspace_id}:${row.unit_record_id || "general"}:${row.currency}`} className="text-[#b6c2cf]"><th scope="row" className="px-4 py-3 font-medium text-white">{row.workspace_name} · {row.unit_name}</th><td className="px-4 py-3">{row.currency}</td><td className="px-4 py-3">{currency(row.collected_in_period, row.currency)}</td><td className="px-4 py-3">{row.payment_count}</td><td className="px-4 py-3">{currency(row.scholarship_credit_in_period, row.currency)}</td><td className="px-4 py-3">{currency(row.outstanding_balance, row.currency)}</td><td className="px-4 py-3">{row.pending_enrollments}</td><td className="px-4 py-3">{row.overdue_enrollments}</td><td className="px-4 py-3">{currency(row.overdue_balance, row.currency)}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-[#9fadbc]">Não há lançamentos financeiros para esta unidade no período.</p>}</section>
      </>}
    </>}
  </div></main>;
}
