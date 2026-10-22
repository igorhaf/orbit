import {recordCardsPlugin} from "../plugins/record-cards/record-cards.plugin";
import { structuredViewPlugin } from "../plugins/board-views/board-view.plugins";
import { processBoardPlugin } from "../plugins/process-board/process-board.plugin";
import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { PluginRegistry } from "../execution/registries";
import { genericPlugins } from "../plugins/records/catalog";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { safdoulasPlugins } from "./suite";
import { safdoulasReferenceData } from "./reference-data";
import { checkCourseRequirements } from "./course-requirements";
import { curriculumValidationIssues } from "./curriculum-validation";
import { validate } from "../plugins/records/rules";
import { dossierManifest, accreditationStageGroups } from "./casework.plugin";
import { accreditationProcessTransitions, accreditationProcessValidationIssues } from "./processes.plugin";
import { diligenceResponseIssues } from "./diligences.plugin";
import { appealIssues } from "./decisions.plugin";

test("all thirteen supplied files are fingerprinted and the blank assessment matrix has nine dimensions and eighty criteria", () => {
  assert.equal(safdoulasReferenceData.sources.length, 13);
  assert.equal(safdoulasReferenceData.sources.filter((source) => source.example_only).length, 2);
  assert.equal(new Set(safdoulasReferenceData.sources.map((source) => source.reference)).size, 13);
  for (const source of safdoulasReferenceData.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
  const { matrix } = safdoulasReferenceData;
  assert.equal(matrix.dimensions.length, 9);
  assert.equal(matrix.dimensions.reduce((sum, dimension) => sum + dimension.criteria.length, 0), 80);
  const schema = genericPlugins.find((plugin) => plugin.id === "assessments")!.contributions!.recordKinds!.matrix.schema;
  assert.doesNotThrow(() => validate(schema, matrix));
  for (const dimension of matrix.dimensions) for (const criterion of dimension.criteria)
    assert.doesNotMatch(criterion.title, /X zz|Cordenação|SAF-CAP-2026/);
});

test("the accreditation suite is detached transitively and keeps disabled optional modules from disabling casework", () => {
  const registry = new PluginRegistry();
  for (const plugin of [workspacesPlugin, structuredViewPlugin, processBoardPlugin, recordCardsPlugin, ...genericPlugins, ...safdoulasPlugins]) registry.register(plugin);
  assert.equal(registry.isEnabled("safdoulas-casework"), true);
  registry.setEnabled("safdoulas-assessments", false);
  assert.equal(registry.isEnabled("safdoulas-casework"), true);
  registry.setEnabled("versioned-records", false);
  for (const plugin of safdoulasPlugins) assert.equal(registry.isEnabled(plugin.id), false, plugin.id);
  registry.setEnabled("versioned-records", true);
  assert.equal(registry.isEnabled("safdoulas-casework"), true);
  assert.equal(registry.isEnabled("safdoulas-assessments"), false);
});

test("the two blinded exercises produce inspectable arithmetic and teacher-composition findings without automatic decisions", async () => {
  const rules = { hour_parameters: [
    { code: "minimum_total_hours", label: "Horas", minimum: 120, unit: "h", source_reference: "Edital 02/2026, 11.4" },
    { code: "minimum_supervised_practice_percent", label: "Prática", minimum: 20, unit: "%" },
    { code: "minimum_teacher_doula_percent", label: "Docentes", minimum: 60, unit: "%" },
  ] };
  const members = new Map(Array.from({ length: 10 }, (_, index) => [String(index), {
    function: "teacher", doula: index < 7, primary_professional_area: index === 5 ? "nursing" : "other",
  }]));
  const course = { team_member_refs: [...members.keys()].map((id) => ({ record_id: id, revision: 1 })) };
  const first = await checkCourseRequirements(course, rules, async (id) => members.get(id) || null, {
    total_hours: 180, modules: [{ activities: [{ hours: 140, activity_type: "theoretical" }, { hours: 40, activity_type: "supervised_practice" }] }],
  });
  assert.equal(first.find((item) => item.code === "minimum_teacher_doula_percent")?.value, 60);
  assert.ok(first.every((item) => item.status === "met"));
  const second = await checkCourseRequirements(course, rules, async (id) => members.get(id) || null, {
    total_hours: 160, modules: [{ hours: 136, activities: [{ hours: 136, activity_type: "theoretical" }] }, { hours: 16, activities: [{ hours: 16, activity_type: "supervised_practice" }] }],
  });
  assert.equal(second.find((item) => item.code === "minimum_supervised_practice_percent")?.status, "attention");
  const arithmetic = await curriculumValidationIssues({ total_hours: 160, modules: [{ code: "total", hours: 152 }] }, { resolveRecord: async () => null });
  assert.equal(arithmetic[0]?.code, "curriculum_total_mismatch");
  const unknown = await checkCourseRequirements({}, { hour_parameters: [{ code: "qualitative_review", label: "Qualitativo", unit: "" }] }, async () => null);
  assert.equal(unknown[0].status, "missing");
});

test("a decided process can enter appeal only with its submitted appeal, without replacing the decision", async () => {
  const payload = { ruleset_record_id: "rules", ruleset_revision: 1, institutional_decision_record_id: "decision", institutional_decision_revision: 1, appeal_record_id: "appeal", appeal_revision: 2 };
  const context = { recordId: "process", resolveRecord: async (id: string) => id === "rules"
    ? { id, pluginId: "safdoulas-governance", kind: "accreditation_ruleset", state: "active", revision: 1, payload: { state_transitions: [{ from: "decision", to: "appeal", required_role: "secretariat" }], process_types: [], process_states: [] } }
    : { id, pluginId: "safdoulas-decisions", kind: "appeal", state: "submitted", revision: 2, payload: { process_record_id: "process", decision_record_id: "decision" } }, hasPermission: async () => true };
  assert.deepEqual(await accreditationProcessTransitions("decision", payload, context), ["appeal"]);
  assert.deepEqual(await accreditationProcessTransitions("decision", { ...payload, appeal_record_id: null }, context), []);
  const issues = await accreditationProcessValidationIssues({ ...payload, institutional_decision_record_id: "replacement" }, {
    ...context, resolveLatestRecord: async () => ({ id: "process", pluginId: "safdoulas-processes", kind: "accreditation_process", revision: 5, state: "decision", payload }),
  });
  assert.ok(issues.some((item) => item.code === "decided_process_field_frozen"));
});

test("second-round diligence accepts a response to the preserved follow-up request", async () => {
  const issues = await diligenceResponseIssues({ diligence_record_id: "diligence", diligence_revision: 4, respondent_user_id: "applicant", item_responses: [{ item_code: "A" }], evidence_refs: [] }, {
    actorId: "applicant", resolveRecord: async () => ({ id: "diligence", pluginId: "safdoulas-diligences", kind: "diligence", state: "follow_up_requested", revision: 4, payload: { respondent_user_id: "applicant", items: [{ code: "A", required: true }] } }),
  });
  assert.deepEqual(issues, []);
});

test("reviewing an appeal later does not require impersonating the appellant or reopening its expired filing window", async () => {
  const documents: Record<string, { kind: string; state: string; payload: Record<string, unknown> }> = {
    process: { kind: "accreditation_process", state: "decision", payload: { ruleset_record_id: "rules", ruleset_revision: 1 } },
    rules: { kind: "accreditation_ruleset", state: "active", payload: { decision_policy_record_id: "policy", decision_policy_revision: 1 } },
    policy: { kind: "decision_policy", state: "active", payload: { appeals_enabled: true, appeal_period_days: 30, appealable_outcomes: ["denied"] } },
    decision: { kind: "institutional_decision", state: "ratified", payload: { process_record_id: "process", outcome: "denied", decision_policy_record_id: "policy", decision_policy_revision: 1, appeal_deadline_at: "2020-01-01T00:00:00Z" } },
  };
  const issues = await appealIssues({ process_record_id: "process", process_revision: 1, decision_record_id: "decision", decision_revision: 1, appellant_user_id: "applicant" }, {
    actorId: "staff", recordId: "appeal", resolveLatestRecord: async () => ({ id: "appeal", pluginId: "safdoulas-decisions", kind: "appeal", state: "under_review", revision: 2, payload: {} }),
    resolveRecord: async (id) => documents[id] ? { id, pluginId: id === "process" ? "safdoulas-processes" : ["rules", "policy"].includes(id) ? "safdoulas-governance" : "safdoulas-decisions", revision: 1, ...documents[id] } : null,
  });
  assert.deepEqual(issues, []);
});

test("dossier manifests identify institutional accreditation and change their checksum when evidence changes", () => {
  const process = { id: "process", workspace_id: "workspace", plugin_id: "safdoulas-processes", kind: "accreditation_process", title: "Case", state: "decision", revision: 1, payload: {} };
  const first = dossierManifest(process, [], "2026-10-21T12:00:00Z");
  const second = dossierManifest({ ...process, revision: 2 }, [], "2026-10-21T12:00:00Z");
  assert.notEqual(first.sha256, second.sha256);
  assert.match(first.scope, /não comprova protocolo ou aprovação pelo MEC/);
});


test("a single process board groups each authorized record under one phase and does not make optional phases mandatory", () => {
  const record = (id:string,plugin_id:string,kind:string,payload:Record<string,unknown>={}) => ({id,plugin_id,kind,payload,title:id,state:"published",revision:1,workspace_id:"space"});
  const process = {...record("process","safdoulas-processes","accreditation_process"),state:"review"};
  const records = [record("triage","safdoulas-triage","admissibility_review"),record("assessment","safdoulas-assessments","individual_evaluation"),record("appeal","safdoulas-decisions","appeal"),record("grant","safdoulas-accreditation","accreditation_grant",{signed_document_record_id:"signed"}),record("signed","documents","document")];
  const stages=accreditationStageGroups(process,records);
  assert.equal(stages.filter(stage=>stage.current).length,1);
  assert.equal(stages.find(stage=>stage.current)?.id,"review");
  const ids=stages.flatMap(stage=>stage.records.map(record=>record.id));
  assert.equal(ids.length,records.length);assert.equal(new Set(ids).size,records.length);
  assert.equal(stages.find(stage=>stage.id==="appeal")?.optional,true);
  assert.ok(stages.find(stage=>stage.id==="decision")?.records.some(record=>record.id==="signed"));
});
