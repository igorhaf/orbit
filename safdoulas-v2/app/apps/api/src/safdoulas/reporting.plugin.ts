import { Controller, Get, HttpException, Inject, Param, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import type { AccessRequest, AccessService } from "../access/access";
import { AccessService as AccessServiceToken, id } from "../access/access";
import { ExtensionRecords } from "../plugins/records/records.service";
import { PluginRegistry } from "../execution/registries";
import type { PluginDefinition } from "../plugins/contract";
import { WorkspacesService } from "../workspaces/workspaces.plugin";

type ReportRecord = {
  id: string;
  kind: string;
  state: string;
  created_at?: string;
  payload: Record<string, unknown>;
};

const sources = [
  ["safdoulas-processes", "Processos", ["accreditation_process"]],
  ["safdoulas-triage", "Triagens", ["admissibility_review"]],
  ["safdoulas-assessments", "Avaliações", ["evaluation_assignment", "third_review_assignment", "individual_evaluation", "evaluation_consolidation"]],
  ["safdoulas-diligences", "Diligências", ["diligence", "diligence_response", "case_communication"]],
  ["safdoulas-decisions", "Decisões e recursos", ["institutional_decision", "appeal", "appeal_decision"]],
  ["safdoulas-accreditation", "Acreditações", ["accreditation_grant", "renewal_request", "condition_follow_up", "post_accreditation_change"]],
  ["safdoulas-accreditors", "Acreditadoras", ["application", "profile"]],
  ["safdoulas-registry", "Oferta formativa", ["education_provider", "course", "course_offering"]],
  ["deadlines", "Prazos e SLA", ["clock"]],
] as const;

const openDiligenceStates = new Set(["requested", "response_received", "under_review", "follow_up_requested"]);

export function summarizeSafdoulasDashboard(
  recordsByPlugin: Record<string, ReportRecord[]>,
  disabledPlugins: string[] = [],
  now = new Date(),
) {
  const all = (plugin: string, kind: string) => (recordsByPlugin[plugin] || []).filter((record) => record.kind === kind);
  const processes = all("safdoulas-processes", "accreditation_process");
  const diligences = all("safdoulas-diligences", "diligence");
  const assignments = all("safdoulas-assessments", "evaluation_assignment");
  const thirdAssignments = all("safdoulas-assessments", "third_review_assignment");
  const evaluations = all("safdoulas-assessments", "individual_evaluation");
  const decisions = all("safdoulas-decisions", "institutional_decision");
  const grants = all("safdoulas-accreditation", "accreditation_grant");
  const profiles = all("safdoulas-accreditors", "profile");
  const deadlines = all("deadlines", "clock");
  const today = now.toISOString().slice(0, 10);
  const processStates = Object.fromEntries([...new Set(processes.map((item) => item.state))].sort().map((state) => [
    state,
    processes.filter((item) => item.state === state).length,
  ]));
  const openDiligences = diligences.filter((item) => openDiligenceStates.has(item.state));
  const overdueDiligences = openDiligences.filter((item) => typeof item.payload.due_at === "string" && Date.parse(item.payload.due_at) < now.getTime());
  const runningDeadlines = deadlines.filter((item) => item.state === "running");
  const overdueDeadlines = runningDeadlines.filter((item) => typeof item.payload.due_at === "string" && Date.parse(item.payload.due_at) < now.getTime());
  const activeGrants = grants.filter((grant) => grant.state === "active"
    && typeof grant.payload.valid_from === "string" && grant.payload.valid_from <= today
    && typeof grant.payload.valid_until === "string" && grant.payload.valid_until > today);
  const currentProfiles = profiles.filter((profile) => profile.payload.profile_status === "active"
    && typeof profile.payload.valid_from === "string" && profile.payload.valid_from <= now.toISOString()
    && typeof profile.payload.valid_until === "string" && profile.payload.valid_until > now.toISOString());
  const pendingReviews = [...assignments, ...thirdAssignments].filter((item) => item.state === "assigned");
  const submittedEvaluations = evaluations.filter((item) => item.state === "submitted");
  const pendingDecisions = decisions.filter((item) => item.state === "draft");
  const metrics = [
    { key: "visible_processes", label: "Processos visíveis", value: processes.length },
    { key: "triage", label: "Em triagem", value: processes.filter((item) => item.state === "triage").length },
    { key: "reviews_pending", label: "Avaliações atribuídas", value: pendingReviews.length },
    { key: "evaluations_submitted", label: "Avaliações enviadas", value: submittedEvaluations.length },
    { key: "diligences_open", label: "Diligências abertas", value: openDiligences.length },
    { key: "diligences_overdue", label: "Diligências vencidas", value: overdueDiligences.length },
    { key: "deadlines_running", label: "Prazos em andamento", value: runningDeadlines.length },
    { key: "deadlines_overdue", label: "Prazos vencidos", value: overdueDeadlines.length },
    { key: "deadlines_paused", label: "Prazos pausados", value: deadlines.filter((item) => item.state === "paused").length },
    { key: "decisions_pending", label: "Decisões em rascunho", value: pendingDecisions.length },
    { key: "accreditations_active", label: "Acreditações vigentes", value: activeGrants.length },
    { key: "accreditors_current", label: "Acreditadoras habilitadas", value: currentProfiles.length },
  ];
  const sourceCounts = sources.map(([pluginId, label, kinds]) => {
    const records = recordsByPlugin[pluginId] || [];
    const visible = records.filter((record) => (kinds as readonly string[]).includes(record.kind));
    return { plugin_id: pluginId, label, count: visible.length, possibly_truncated: records.length >= 100 };
  });
  return {
    generated_at: now.toISOString(),
    metrics,
    process_states: processStates,
    sources: sourceCounts,
    disabled_plugins: disabledPlugins,
    partial: sourceCounts.some((source) => source.possibly_truncated),
  };
}

type DashboardSummary = ReturnType<typeof summarizeSafdoulasDashboard>;
type DashboardRole = "administration" | "accreditor" | "institution";

export function dashboardPerspectives(summary: DashboardSummary, roles: Record<DashboardRole, boolean>) {
  const metricByKey = new Map(summary.metrics.map((metric) => [metric.key, metric]));
  const select = (keys: string[]) => keys.flatMap((key) => metricByKey.has(key) ? [metricByKey.get(key)!] : []);
  const perspectives = [];
  if (roles.administration) perspectives.push({ id: "administration", label: "Administração", metrics: summary.metrics, process_states: summary.process_states });
  if (roles.accreditor) perspectives.push({
    id: "accreditor",
    label: "Acreditadora",
    metrics: select(["reviews_pending", "evaluations_submitted", "deadlines_running", "deadlines_overdue"]),
  });
  if (roles.institution) perspectives.push({
    id: "institution",
    label: "Instituição",
    metrics: select(["visible_processes", "diligences_open", "diligences_overdue", "decisions_pending", "accreditations_active"]),
    process_states: summary.process_states,
  });
  return perspectives;
}

export type ProcessSearchFilters = { q?: string; state?: string; type?: string; region?: string; modality?: string; from?: string; to?: string };

export function processSearchProjection(
  processes: ReportRecord[],
  providers: ReportRecord[],
  courses: ReportRecord[],
  filters: ProcessSearchFilters = {},
) {
  const providerById = new Map(providers.filter((item) => item.kind === "education_provider").map((item) => [item.id, item.payload]));
  const courseById = new Map(courses.filter((item) => item.kind === "course" || item.kind === "course_offering").map((item) => [item.id, item.payload]));
  const requested = {
    q: String(filters.q || "").trim().slice(0, 120).toLocaleLowerCase("pt-BR"),
    state: String(filters.state || "").trim(),
    type: String(filters.type || "").trim(),
    region: String(filters.region || "").trim().toLocaleUpperCase("pt-BR"),
    modality: String(filters.modality || "").trim(),
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(filters.from || "")) ? String(filters.from) : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(String(filters.to || "")) ? String(filters.to) : "",
  };
  const candidates = processes.filter((process) => process.kind === "accreditation_process").map((process) => {
    const provider = providerById.get(String(process.payload.provider_record_id));
    const course = courseById.get(String(process.payload.course_record_id)) || courseById.get(String(process.payload.offering_record_id));
    const modalities = typeof course?.modality === "string" ? [course.modality]
      : Array.isArray(course?.modalities) ? (course.modalities as unknown[]).filter((value): value is string => typeof value === "string") : [];
    const region = typeof provider?.state === "string" ? provider.state : "";
    const providerName = typeof provider?.display_name === "string" ? provider.display_name : "";
    const courseName = typeof course?.name === "string" ? course.name : typeof course?.cohort === "string" ? course.cohort : "";
    const openedAt = typeof process.payload.opened_at === "string" ? process.payload.opened_at : "";
    const protocol = typeof process.payload.protocol_number === "string" ? process.payload.protocol_number : "";
    const row = {
      id: process.id,
      protocol_number: protocol,
      state: process.state,
      process_type: String(process.payload.process_type || ""),
      opened_at: openedAt,
      reference_label: providerName && courseName ? `${providerName} · ${courseName}` : providerName || courseName || (protocol ? `Protocolo ${protocol}` : "Processo sem protocolo"),
      region,
      modalities,
    };
    const searchText = [protocol, process.state, process.payload.process_type, providerName, courseName].join(" ").toLocaleLowerCase("pt-BR");
    return { row, searchText };
  });
  const rows = candidates.map(({ row }) => row);
  const options = {
    states: [...new Set(rows.map((row) => row.state))].sort(),
    types: [...new Set(rows.map((row) => row.process_type).filter(Boolean))].sort(),
    regions: [...new Set(rows.map((row) => row.region).filter(Boolean))].sort(),
    modalities: [...new Set(rows.flatMap((row) => row.modalities))].sort(),
  };
  const filtered = candidates.filter(({ row, searchText }) => {
    const date = row.opened_at.slice(0, 10);
    return (!requested.q || searchText.includes(requested.q))
      && (!requested.state || row.state === requested.state)
      && (!requested.type || row.process_type === requested.type)
      && (!requested.region || row.region === requested.region)
      && (!requested.modality || row.modalities.includes(requested.modality))
      && (!requested.from || (date && date >= requested.from))
      && (!requested.to || (date && date <= requested.to));
  }).map(({ row }) => row)
    .sort((left, right) => right.opened_at.localeCompare(left.opened_at) || left.protocol_number.localeCompare(right.protocol_number));
  return { filters: requested, options, total: filtered.length, rows: filtered.slice(0, 100), truncated: filtered.length > 100 };
}

export function dashboardCsv(summary: ReturnType<typeof summarizeSafdoulasDashboard>) {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const rows: Array<Array<string | number>> = [["Indicador", "Valor"], ...summary.metrics.map((metric) => [metric.label, metric.value])];
  rows.push(["Gerado em", summary.generated_at]);
  return `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}\r\n`;
}

export const safdoulasReportingPlugin: PluginDefinition = {
  id: "safdoulas-reporting",
  name: "Painéis e relatórios SAFDOULAS",
  version: "1.0.0",
  scope: "workspace",
  description: "Exibe indicadores agregados somente sobre registros que a pessoa autenticada pode consultar e permite exportar resumos auditados.",
  dependencies: ["versioned-records", "workspaces"],
  handlesRoute: (path) => /^\/safdoulas\/reports\/[a-fA-F0-9-]{36}\/(?:dashboard|export\.csv)$/.test(path),
  routePermission: (path) => path.endsWith("/export.csv") ? "plugin.safdoulas-reporting.export" : "plugin.safdoulas-reporting.read",
  capabilities: [
    { id: "read", name: "Consultar painéis SAFDOULAS", permissions: ["plugin.safdoulas-reporting.read"] },
    { id: "export", name: "Exportar relatórios SAFDOULAS", permissions: ["plugin.safdoulas-reporting.export"] },
  ],
  contributions: { navigation: [{ id: "safdoulas-reporting", label: "Painéis", href: "/safdoulas/reports" , permission: "plugin.safdoulas-reporting.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "overview", "label": "Acompanhamento", "order": 0}, order: 1}] },
};

@Controller("safdoulas/reports")
export class SafdoulasReportingController {
  constructor(
    @Inject(ExtensionRecords) private readonly records: ExtensionRecords,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
    @Inject(AccessServiceToken) private readonly access: AccessService,
  ) {}

  private async summary(workspaceId: string, userId: string, filters: ProcessSearchFilters = {}) {
    const workspace = id(workspaceId);
    if (!this.plugins.isEnabled("safdoulas-reporting")) throw new HttpException("O plugin de relatórios ou uma dependência está desativado.", 409);
    await this.workspaces.shared(userId, workspace);
    const available = sources.filter(([pluginId]) => this.plugins.isEnabled(pluginId));
    const recordsByPlugin: Record<string, ReportRecord[]> = {};
    for (const [pluginId] of available)
      recordsByPlugin[pluginId] = await this.records.list(pluginId, workspace, userId) as ReportRecord[];
    const disabled = sources.map(([pluginId]) => pluginId).filter((pluginId) => !this.plugins.isEnabled(pluginId));
    const summary = summarizeSafdoulasDashboard(recordsByPlugin, disabled);
    const [administration, accreditor, applicant, institutionRepresentative] = await Promise.all([
      this.access.has(userId, "plugin.safdoulas-reporting.manage", "workspace", workspace),
      this.access.has(userId, "plugin.safdoulas-processes.transition.evaluator", "workspace", workspace),
      this.access.has(userId, "plugin.safdoulas-processes.transition.applicant", "workspace", workspace),
      this.access.has(userId, "plugin.safdoulas-processes.transition.institution_representative", "workspace", workspace),
    ]);
    const registryRecords = recordsByPlugin["safdoulas-registry"] || [];
    const providers = registryRecords.filter((record) => record.kind === "education_provider");
    const courses = registryRecords.filter((record) => ["course", "course_offering"].includes(record.kind));
    return {
      ...summary,
      perspectives: dashboardPerspectives(summary, { administration, accreditor, institution: applicant || institutionRepresentative }),
      process_search: processSearchProjection(recordsByPlugin["safdoulas-processes"] || [], providers, courses, filters),
    };
  }

  @Get(":workspaceId/dashboard")
  async dashboard(@Req() request: AccessRequest, @Param("workspaceId") workspaceId: string, @Query() filters: ProcessSearchFilters) {
    const userId = String(request.orbitActor);
    await this.access.require(userId, "plugin.safdoulas-reporting.read");
    return this.summary(workspaceId, userId, filters);
  }

  @Get(":workspaceId/export.csv")
  async export(@Req() request: AccessRequest, @Param("workspaceId") workspaceId: string, @Res({ passthrough: true }) response: Response) {
    const userId = String(request.orbitActor);
    await this.access.require(userId, "plugin.safdoulas-reporting.export");
    const summary = await this.summary(workspaceId, userId);
    await this.access.audit(userId, "safdoulas.report.exported", workspaceId, { type: "workspace", id: workspaceId });
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="safdoulas-indicadores.csv"');
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return dashboardCsv(summary);
  }
}
