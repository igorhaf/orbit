import assert from "node:assert/strict";
import test from "node:test";
import { SafdoulasReportingController, dashboardCsv, dashboardPerspectives, processSearchProjection, safdoulasReportingPlugin, summarizeSafdoulasDashboard } from "./reporting.plugin";

const workspaceId = "00000000-0000-4000-8000-000000000099";

test("dashboard counts only authorized source records and minimizes returned fields", () => {
  const summary = summarizeSafdoulasDashboard({
    "safdoulas-processes": [
      { id: "one", kind: "accreditation_process", state: "triage", payload: { institution_name: "Privado" } },
      { id: "two", kind: "accreditation_process", state: "review", payload: { institution_name: "Outro" } },
    ],
    "safdoulas-diligences": [
      { id: "d1", kind: "diligence", state: "requested", payload: { due_at: "2030-01-01T00:00:00.000Z" } },
      { id: "d2", kind: "diligence", state: "closed", payload: { due_at: "2020-01-01T00:00:00.000Z" } },
    ],
    "safdoulas-accreditation": [
      { id: "g1", kind: "accreditation_grant", state: "active", payload: { valid_from: "2029-01-01", valid_until: "2031-01-01" } },
    ],
  }, [], new Date("2030-02-01T12:00:00.000Z"));
  assert.equal(summary.metrics.find((metric) => metric.key === "visible_processes")?.value, 2);
  assert.equal(summary.metrics.find((metric) => metric.key === "triage")?.value, 1);
  assert.equal(summary.metrics.find((metric) => metric.key === "diligences_overdue")?.value, 1);
  assert.equal(summary.metrics.find((metric) => metric.key === "accreditations_active")?.value, 1);
  assert.equal(JSON.stringify(summary).includes("Privado"), false);
  assert.equal(summary.disabled_plugins.length, 0);
});

test("dashboard marks record-list caps and reports modules disabled independently", () => {
  const records = Array.from({ length: 100 }, (_, index) => ({ id: String(index), kind: "accreditation_process", state: "received", payload: {} }));
  const summary = summarizeSafdoulasDashboard({ "safdoulas-processes": records }, ["safdoulas-assessments"]);
  assert.equal(summary.partial, true);
  assert.equal(summary.sources.find((source) => source.plugin_id === "safdoulas-processes")?.possibly_truncated, true);
  assert.ok(summary.disabled_plugins.includes("safdoulas-assessments"));
  assert.equal(safdoulasReportingPlugin.dependencies?.includes("safdoulas-assessments"), false);
});

test("process filters use only authorized institution and course records and never return their internal search text", () => {
  const processes = [{ id: "p1", kind: "accreditation_process", state: "review", payload: {
    protocol_number: "SAF-2030-0042", process_type: "course_accreditation", opened_at: "2030-03-04T00:00:00.000Z",
    provider_record_id: "provider-visible", course_record_id: "course-visible",
  } }];
  const providers = [{ id: "provider-visible", kind: "education_provider", state: "active", payload: { display_name: "Coletivo Aurora", state: "PE" } }];
  const courses = [{ id: "course-visible", kind: "course", state: "active", payload: { name: "Formação de Doulas", modalities: ["hybrid"] } }];
  const visible = processSearchProjection(processes, providers, courses, { q: "aurora", region: "PE", modality: "hybrid", from: "2030-03-01" });
  assert.equal(visible.total, 1);
  assert.equal(visible.rows[0].reference_label, "Coletivo Aurora · Formação de Doulas");
  assert.deepEqual(visible.options.modalities, ["hybrid"]);
  assert.equal(JSON.stringify(visible).includes("search_text"), false);
  const blinded = processSearchProjection(processes, [], [], { q: "aurora" });
  assert.equal(blinded.total, 0);
  assert.equal(blinded.rows.length, 0);
  const byProtocol = processSearchProjection(processes, [], [], { q: "SAF-2030-0042" });
  assert.equal(byProtocol.total, 1);
  assert.equal(byProtocol.rows[0].reference_label, "Protocolo SAF-2030-0042");
});

test("dashboard counts running, overdue, and paused generic deadline clocks", () => {
  const summary = summarizeSafdoulasDashboard({ deadlines: [
    { id: "running", kind: "clock", state: "running", payload: { due_at: "2030-01-01T00:00:00.000Z" } },
    { id: "paused", kind: "clock", state: "paused", payload: { due_at: "2020-01-01T00:00:00.000Z" } },
  ] }, [], new Date("2030-02-01T00:00:00.000Z"));
  assert.equal(summary.metrics.find((metric) => metric.key === "deadlines_running")?.value, 1);
  assert.equal(summary.metrics.find((metric) => metric.key === "deadlines_overdue")?.value, 1);
  assert.equal(summary.metrics.find((metric) => metric.key === "deadlines_paused")?.value, 1);
});

test("dashboard perspectives are limited to assigned institutional roles and use role-specific indicators", () => {
  const summary = summarizeSafdoulasDashboard({
    "safdoulas-processes": [{ id: "p1", kind: "accreditation_process", state: "triage", payload: {} }],
    "safdoulas-assessments": [{ id: "a1", kind: "evaluation_assignment", state: "assigned", payload: {} }],
    "safdoulas-diligences": [{ id: "d1", kind: "diligence", state: "requested", payload: {} }],
  });
  const views = dashboardPerspectives(summary, { administration: false, accreditor: true, institution: true });
  assert.deepEqual(views.map((view) => view.id), ["accreditor", "institution"]);
  assert.deepEqual(views[0].metrics.map((metric) => metric.key), ["reviews_pending", "evaluations_submitted", "deadlines_running", "deadlines_overdue"]);
  assert.ok(views[1].metrics.some((metric) => metric.key === "diligences_open"));
  assert.equal(views.some((view) => view.id === "administration"), false);
  const admin = dashboardPerspectives(summary, { administration: true, accreditor: false, institution: false });
  assert.equal(admin[0].metrics.length, summary.metrics.length);
  assert.deepEqual(admin[0].process_states, summary.process_states);
});

test("CSV export quotes cells, includes UTF-8 BOM, and exposes only summary metrics", () => {
  const summary = summarizeSafdoulasDashboard({});
  const csv = dashboardCsv(summary);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"Indicador","Valor"/);
  assert.match(csv, /"Acreditações vigentes","0"/);
  assert.equal(csv.includes("record_id"), false);
  assert.equal(safdoulasReportingPlugin.routePermission?.("/safdoulas/reports/id/export.csv", "GET"), "plugin.safdoulas-reporting.export");
});

test("report controller checks workspace membership, record visibility and export audit", async () => {
  const required: string[] = [];
  const listed: string[] = [];
  const audited: unknown[][] = [];
  const headers = new Map<string, string>();
  const records = { async list(plugin: string) { listed.push(plugin); return []; } };
  const plugins = { isEnabled(plugin: string) { return plugin !== "safdoulas-assessments"; } };
  const workspaces = { async shared(_user: string, workspace: string) { assert.equal(workspace, workspaceId); } };
  const access = {
    async require(_user: string, permission: string) { required.push(permission); },
    async has(_user: string, permission: string) { return permission === "plugin.safdoulas-reporting.manage"; },
    async audit(...args: unknown[]) { audited.push(args); },
  };
  const controller = new SafdoulasReportingController(records as never, plugins as never, workspaces as never, access as never);
  const request = { orbitActor: "actor-id" } as never;
  const result = await controller.dashboard(request, workspaceId, {});
  assert.deepEqual(required, ["plugin.safdoulas-reporting.read"]);
  assert.ok(listed.includes("safdoulas-processes"));
  assert.equal(listed.includes("safdoulas-assessments"), false);
  assert.ok(result.disabled_plugins.includes("safdoulas-assessments"));

  const response = { setHeader(name: string, value: string) { headers.set(name, value); } } as never;
  const csv = await controller.export(request, workspaceId, response);
  assert.equal(required[1], "plugin.safdoulas-reporting.export");
  assert.equal(audited[0][1], "safdoulas.report.exported");
  assert.equal(audited[0][2], workspaceId);
  assert.match(headers.get("Content-Type") || "", /text\/csv/);
  assert.match(String(csv), /Acreditações vigentes/);
});
