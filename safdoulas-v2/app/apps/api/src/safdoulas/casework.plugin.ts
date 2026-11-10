import { Controller, Get, Post, Body, HttpException, Inject, Param, Req, Res } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Response } from "express";
import { AccessService, type AccessRequest, id } from "../access/access";
import { Db } from "../db";
import { PluginRegistry } from "../execution/registries";
import type { PluginDefinition } from "../plugins/contract";
import { ExtensionRecords } from "../plugins/records/records.service";
import {RecordCardsService} from "../plugins/record-cards/record-cards.plugin";
import {accreditationJourney} from "./course-board";
export {accreditationJourney} from "./course-board";
import { checkCourseRequirements } from "./course-requirements";
import { curriculumValidationIssues } from "./curriculum-validation";

export const safdoulasCaseworkPlugin: PluginDefinition = {
  id: "safdoulas-casework", name: "Central de acreditação SAFDOULAS", version: "1.0.0", scope: "workspace",
  description: "Reúne a jornada, as evidências, a conferência de requisitos e o dossiê de cada processo, respeitando os acessos de cada plugin.",
  dependencies: ["safdoulas-processes", "process-board", "record-cards"],
  handlesRoute: (path) => /^\/safdoulas\/casework\/(workspaces|processes)\/[a-fA-F0-9-]{36}(\/(?:dossier\.json|boards))?$/.test(path),
  routePermission: () => null,
  contributions: { boardCreators:[{id:"safdoulas-course",name:"Novo quadro de curso",href:"/safdoulas/courses/new",permission:"plugin.safdoulas-processes.write"}], navigation: [{ id: "safdoulas-casework", href: "/safdoulas/processes", label: "Cursos em acreditação" , permission: "plugin.process-board.read", group: { id: "accreditation", label: "Acreditação" }, section: {"id": "overview", "label": "Acompanhamento", "order": 0}, order: 0}] },
};



type Snapshot = { id: string; workspace_id: string; plugin_id: string; kind: string; title: string; state: string; revision: number; payload: Record<string, unknown>; next_states?: string[] };

/** A record appears under one phase; grouping never creates another business record. */
export function accreditationStageGroups(process: Snapshot, records: Snapshot[]) {
  const decisionDocuments = new Set(records.flatMap(record => [record.payload.signed_document_record_id, record.payload.delivery_evidence_record_id, record.payload.acknowledgement_evidence_record_id]).filter((id): id is string => typeof id === "string"));
  const blindedDocuments = new Set(records.map(record => record.payload.blinded_document_record_id).filter((id): id is string => typeof id === "string"));
  const phase = (record: Snapshot): string => {
    if (["appeal", "appeal_decision", "appeal_review_vote"].includes(record.kind)) return "appeal";
    if (record.plugin_id === "safdoulas-accreditation") return ["condition_follow_up", "renewal_request", "post_accreditation_change", "seal_occurrence"].includes(record.kind) ? "monitoring" : "decision";
    if (record.kind === "case_communication") return record.payload.decision_record_id ? "decision" : "diligence";
    if (record.plugin_id === "safdoulas-diligences") return "diligence";
    if (record.plugin_id === "safdoulas-decisions") return "deliberation";
    if (record.plugin_id === "safdoulas-triage") return "triage";
    if (["safdoulas-blinding", "safdoulas-assessments"].includes(record.plugin_id) || blindedDocuments.has(record.id)) return "review";
    if (decisionDocuments.has(record.id)) return "decision";
    return "draft";
  };
  return accreditationJourney.map(stage => ({ id: stage.key, name: stage.label, description: stage.description, current: stage.key === process.state,
    optional: ["diligence", "appeal", "monitoring"].includes(stage.key), records: records.filter(record => phase(record) === stage.key) }));
}

export function dossierManifest(process: Snapshot, snapshots: Snapshot[], generatedAt = new Date().toISOString()) {
  const content = { format: "safdoulas-accreditation-dossier-v1", purpose: "Dossiê documental de acreditação institucional para conferência e encaminhamento externo pelo responsável.",
    authority: "FENADOULASBR", scope: "A acreditação institucional não substitui autorização ou reconhecimento estatal; este arquivo não comprova protocolo ou aprovação pelo MEC.",
    generated_at: generatedAt, process, records: snapshots };
  return { ...content, sha256: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
}

@Controller("safdoulas/casework")
export class SafdoulasCaseworkController {
  constructor(@Inject(ExtensionRecords) private readonly records: ExtensionRecords,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(Db) private readonly db: Db,
    @Inject(RecordCardsService) private readonly cards: RecordCardsService) {}

  private async enabled(user: string) {
    if (!this.plugins.isEnabled("safdoulas-casework")) throw new HttpException("A central de acreditação ou sua dependência está desativada.", 409);
    await this.access.require(user, "views.structured.use");
    await this.access.require(user, "plugin.process-board.read");
  }

  @Get("workspaces/:workspaceId")
  async list(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    const user = String(req.orbitActor);
    await this.enabled(user);
    const processes = await this.records.list("safdoulas-processes", id(workspaceId), user);
    const groups = [];
    for (const process of processes) {
      let displayTitle = process.title;
      if (typeof process.payload.course_record_id === "string" && typeof process.payload.course_revision === "number") {
        try { const course = await this.records.versionSnapshot("safdoulas-registry", process.payload.course_record_id, process.payload.course_revision, user); displayTitle = String(course.payload.name || displayTitle); }
        catch (error) { if (!(error instanceof HttpException) || ![403,404,409].includes(error.getStatus())) throw error; }
      }
      groups.push({ ...process, display_title: displayTitle });
    }
    return { processes: groups, journey: accreditationJourney };
  }

  @Get("workspaces/:workspaceId/boards")
  async boardOptions(@Req() req:AccessRequest,@Param("workspaceId") workspaceId:string){
    const user=String(req.orbitActor);await this.enabled(user);await this.access.require(user,"plugin.record-cards.write");await this.access.require(user,"plugin.safdoulas-processes.write");
    const courses=(await this.records.list("safdoulas-registry",id(workspaceId),user)).filter(record=>record.kind==="course"&&record.state==="active");
    const rules=(await this.records.list("safdoulas-governance",workspaceId,user)).filter(record=>record.kind==="accreditation_ruleset"&&record.state==="active");
    return{courses:courses.map(record=>({id:record.id,title:String(record.payload.name||record.title)})),rules:rules.map(record=>({id:record.id,title:record.title,revision:record.revision}))};
  }
  @Post("workspaces/:workspaceId/boards")
  async createBoard(@Req() req:AccessRequest,@Param("workspaceId") workspaceId:string,@Body() body:{course_id:string;ruleset_id:string;operation_key:string}){
    const user=String(req.orbitActor);await this.enabled(user);await this.access.require(user,"plugin.record-cards.write");
    if(!body||Object.keys(body).some(key=>!["course_id","ruleset_id","operation_key"].includes(key)))throw new HttpException("Campos fora do escopo de criação de quadro.",400);
    const workspace=id(workspaceId),courseId=id(body.course_id),rulesId=id(body.ruleset_id),operation=id(body.operation_key);
    const course=await this.records.detail("safdoulas-registry",courseId,user),rules=await this.records.detail("safdoulas-governance",rulesId,user);
    if(course.workspace_id!==workspace||rules.workspace_id!==workspace||course.kind!=="course"||course.state!=="active"||rules.kind!=="accreditation_ruleset"||rules.state!=="active")throw new HttpException("Selecione um curso e regras ativos deste espaço.",409);
    const provider=await this.records.detail("safdoulas-registry",String(course.payload.provider_record_id),user);
    const lock=await this.db.pool.connect(),lockKey=`course-board:${workspace}:${courseId}`;
    try{
      await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[lockKey]);
      const existing=await this.db.one<{id:string}>("SELECT id FROM extension_records WHERE workspace_id=$1 AND plugin_id='safdoulas-processes' AND kind='accreditation_process' AND payload->>'course_record_id'=$2 AND state NOT IN ('closed','cancelled') ORDER BY created_at LIMIT 1",[workspace,courseId]);
      if(existing)return this.cards.card("safdoulas-processes",existing.id,user,true);
      const payload:Record<string,unknown>={process_type:"course_accreditation",protocol_number:null,ruleset_record_id:rules.id,ruleset_revision:rules.revision,provider_record_id:provider.id,provider_revision:provider.revision,course_record_id:course.id,course_revision:course.revision,document_snapshots:[],opened_at:new Date().toISOString(),notes:"Acompanhamento da acreditação deste curso; documentos e decisões seguem o fluxo formal."};
      for(const prefix of ["curriculum","offering","application_submission","triage_review","preliminary_diligence_response","blinding_policy","evaluation_consolidation","institutional_decision","appeal","appeal_decision"]){payload[`${prefix}_record_id`]=null;payload[`${prefix}_revision`]=null;}
      const record=await this.records.create("safdoulas-processes",workspace,user,{kind:"accreditation_process",title:`Acreditação · ${String(course.payload.name||course.title)}`.slice(0,240),payload,operation_key:operation});
      return await this.cards.card("safdoulas-processes",record.id,user,true);
    }finally{await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[lockKey]);lock.release();}
  }

  private async folder(recordId: string, user: string) {
    await this.enabled(user);
    const process = await this.records.detail("safdoulas-processes", id(recordId), user) as Snapshot;
    if (process.kind !== "accreditation_process") throw new HttpException("Registro não é um processo de acreditação.", 404);
    const candidates = await this.db.query<{ id: string; plugin_id: string; kind: string; payload: Record<string, unknown> }>(
      `SELECT id,plugin_id,kind,payload FROM extension_records WHERE workspace_id=$1 AND
       (payload->>'process_record_id'=$2 OR payload->>'grant_record_id' IN
          (SELECT id::text FROM extension_records WHERE workspace_id=$1 AND plugin_id='safdoulas-accreditation' AND payload->>'process_record_id'=$2)
        OR payload->>'diligence_record_id' IN
          (SELECT id::text FROM extension_records WHERE workspace_id=$1 AND plugin_id='safdoulas-diligences' AND kind='diligence' AND payload->>'process_record_id'=$2))
       ORDER BY updated_at DESC LIMIT 501`, [process.workspace_id, process.id]);
    if (candidates.length > 500) throw new HttpException("Este processo excede 500 registros relacionados; refine a consulta antes de exportar.", 409);
    const snapshots: Snapshot[] = [];
    for (const document of (process.payload.document_snapshots as Array<{ record_id: string; revision: number }>) || []) {
      try { snapshots.push(await this.records.versionSnapshot("documents", document.record_id, document.revision, user) as Snapshot); }
      catch (error) { if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) throw error; }
    }
    for (const candidate of candidates) {
      if (!this.plugins.isEnabled(candidate.plugin_id)) continue;
      try { snapshots.push(await this.records.versionSnapshot(candidate.plugin_id, candidate.id,
        (await this.records.detail(candidate.plugin_id, candidate.id, user)).revision, user) as Snapshot); }
      catch (error) { if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) throw error; }
    }
    // Freeze direct references, even if the current registration has changed since submission.
    for (const [field, plugin] of [["ruleset", "safdoulas-governance"], ["provider", "safdoulas-registry"], ["course", "safdoulas-registry"], ["curriculum", "safdoulas-registry"], ["offering", "safdoulas-registry"], ["application_submission", "forms"], ["blinding_policy", "safdoulas-governance"]] as const) {
      const referenceId = process.payload[`${field}_record_id`], revision = process.payload[`${field}_revision`];
      if (typeof referenceId !== "string" || typeof revision !== "number") continue;
      try { snapshots.push(await this.records.versionSnapshot(plugin, referenceId, revision, user) as Snapshot); }
      catch (error) { if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) throw error; }
    }
    const unique = [...new Map(snapshots.map((item) => [`${item.id}:${item.revision}`, item])).values()];
    const course = unique.find((item) => item.id === process.payload.course_record_id);
    const rules = unique.find((item) => item.id === process.payload.ruleset_record_id);
    const curriculum = unique.find((item) => item.id === process.payload.curriculum_record_id);
    return { process, records: unique, journey: accreditationJourney, stage_groups: accreditationStageGroups(process, unique),
      available_plugins: this.plugins.list().filter((plugin) => this.plugins.isEnabled(plugin.id)).map((plugin) => plugin.id),
      consistency_issues: curriculum ? await curriculumValidationIssues(curriculum.payload, { resolveRecord: async (recordId, revision) => {
        const target = await this.db.one<{ plugin_id: string }>("SELECT plugin_id FROM extension_records WHERE id=$1 AND workspace_id=$2", [recordId, process.workspace_id]);
        if (!target || !this.plugins.isEnabled(target.plugin_id)) return null;
        try { const value = await this.records.versionSnapshot(target.plugin_id, recordId, revision, user); return { ...value, pluginId: value.plugin_id }; }
        catch (error) { if (error instanceof HttpException && [403, 404].includes(error.getStatus())) return null; throw error; }
      } }) : [],
      requirement_checks: course && rules ? await checkCourseRequirements(course.payload, rules.payload, async (id, revision) => {
        try { return (await this.records.versionSnapshot("safdoulas-registry", id, revision, user)).payload; }
        catch (error) { if (error instanceof HttpException && [403, 404].includes(error.getStatus())) return null; throw error; }
      }, curriculum?.payload) : [] };
  }

  @Get("processes/:recordId")
  async detail(@Req() req: AccessRequest, @Param("recordId") recordId: string) {
    const result = await this.folder(recordId, String(req.orbitActor));
    await this.access.audit(String(req.orbitActor), "safdoulas.process.folder.read", recordId, { type: "extension_record", id: recordId });
    return result;
  }

  @Get("processes/:recordId/dossier.json")
  async export(@Req() req: AccessRequest, @Param("recordId") recordId: string, @Res({ passthrough: true }) response: Response) {
    const user = String(req.orbitActor);
    await this.access.require(user, "plugin.safdoulas-reporting.export");
    const { process, records } = await this.folder(recordId, user);
    const manifest = dossierManifest(process, records);
    await this.access.audit(user, "safdoulas.process.dossier.exported", manifest.sha256, { type: "extension_record", id: recordId });
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="safdoulas-dossie-${process.id}.json"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return manifest;
  }
}
