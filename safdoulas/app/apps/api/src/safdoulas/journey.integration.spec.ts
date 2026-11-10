import {FeaturesService} from "../features";
import {RecordCardsService} from "../plugins/record-cards/record-cards.plugin";
import {recordCardsPlugin} from "../plugins/record-cards/record-cards.plugin";
import { structuredViewPlugin } from "../plugins/board-views/board-view.plugins";
import { processBoardPlugin } from "../plugins/process-board/process-board.plugin";
import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Db } from "../db";
import { AccessService } from "../access/access";
import { PluginRegistry } from "../execution/registries";
import { workspacesPlugin, WorkspacesService } from "../workspaces/workspaces.plugin";
import { genericPlugins } from "../plugins/records/catalog";
import { ExtensionRecords, type ExtensionRecord } from "../plugins/records/records.service";
import { DocumentScanner } from "../plugins/records/documents";
import { safdoulasPlugins } from "./suite";
import { safdoulasReferenceData } from "./reference-data";
import { bootstrapSafdoulas } from "./bootstrap";
import { SafdoulasCaseworkController } from "./casework.plugin";
import { SafdoulasAccreditorCertificateController } from "./accreditor-certificate";

test("original sources, protocol, blinded independent review, collegiate decision and concession work in an isolated database", { timeout: 180000 }, async () => {
  const target = new URL(process.env.DATABASE_URL || "");
  assert.match(target.pathname, /^\/orbit_restore_tests_[a-f0-9]+$/);
  assert.equal(target.pathname.slice(1), process.env.ORBIT_TEST_ISOLATED_DATABASE);
  const directory = process.env.SAFDOULAS_SOURCES_DIR;
  assert.ok(directory, "Configure SAFDOULAS_SOURCES_DIR with the thirteen supplied documents.");
  const db = new Db();
  try {
    const actors = [randomUUID(), randomUUID()];
    for (const actor of actors) await db.query("INSERT INTO users(id,name,email,password_hash,is_root) VALUES($1,'Fictitious reviewer',$2,'not-a-login',true)", [actor, `${actor}@example.test`]);
    const registry = new PluginRegistry();
    for (const plugin of [workspacesPlugin, structuredViewPlugin, processBoardPlugin, recordCardsPlugin, ...genericPlugins, ...safdoulasPlugins]) registry.register(plugin);
    const access = new AccessService(db); access.registerPlugins(registry.list());
    const spaces = new WorkspacesService(db, access); spaces.onModuleInit();
    const workspace = await spaces.create(actors[0], { name: "Isolated accreditation journey" });
    const evaluators = [randomUUID(), randomUUID()];
    await db.query("INSERT INTO access_roles(id,name,permissions) VALUES('safdoulas_test_member','Isolated member',ARRAY['workspaces.read'])");
    for (const evaluator of evaluators) {
      await db.query("INSERT INTO users(id,name,email,password_hash,is_root) VALUES($1,'Fictitious accreditor',$2,'not-a-login',false)", [evaluator, `${evaluator}@example.test`]);
      await db.query("INSERT INTO workspace_members(workspace_id,user_id) VALUES($1,$2)", [workspace.id, evaluator]);
      await db.query("INSERT INTO access_grants(user_id,role_id) VALUES($1,'safdoulas_accreditor'),($1,'safdoulas_test_member')", [evaluator]);
    }
    const records = new ExtensionRecords(db, access, registry, new DocumentScanner()); records.onModuleInit();
    const sources = await Promise.all(safdoulasReferenceData.sources.map(async (source) => ({ file_name: source.file_name, data: await readFile(join(directory, source.file_name)) })));
    const setup = await bootstrapSafdoulas(db, records, workspace.id, actors[0], sources);
    const count = (await db.one<{ count: number }>("SELECT count(*)::int AS count FROM extension_records WHERE workspace_id=$1", [workspace.id]))!.count;
    await bootstrapSafdoulas(db, records, workspace.id, actors[0], sources);
    assert.equal((await db.one<{ count: number }>("SELECT count(*)::int AS count FROM extension_records WHERE workspace_id=$1", [workspace.id]))!.count, count, "setup must resume without duplicating records");
    const definition = (plugin: string, kind: string) => registry.getById(plugin).contributions!.recordKinds![kind];
    const create = (plugin: string, kind: string, payload: Record<string, unknown>, actor = actors[0]) => records.create(plugin, workspace.id, actor, { kind, title: `${kind} · integração`, payload, operation_key: randomUUID() });
    const transition = (record: ExtensionRecord, state: string, actor = actors[0]) => records.transition(record.plugin_id, record.id, actor, { state, expected_revision: record.revision, reason: "Isolated journey verification", operation_key: randomUUID() });
    const revise = (record: ExtensionRecord, patch: Record<string, unknown>) => records.version(record.plugin_id, record.id, actors[0], { title: record.title, payload: { ...record.payload, ...patch }, expected_revision: record.revision, reason: "Link preserved evidence", operation_key: randomUUID() });
    const upload = async (title: string, body: string, source?: ExtensionRecord) => records.upload(workspace.id, actors[0], {
      title, file_name: title + ".txt", mime_type: "text/plain", data_base64: Buffer.from(body).toString("base64"),
      variant: source ? "anonymized" : "original", ...(source ? { source_id: source.id, source_revision: source.revision } : {}), operation_key: randomUUID(),
    });
    const original = await transition(await upload("Course dossier", "Institution identity, course curriculum and evidence for the isolated test."), "published");
    const provider = await transition(await create("safdoulas-registry", "education_provider", { ...definition("safdoulas-registry", "education_provider").example }), "active");
    const course = await transition(await create("safdoulas-registry", "course", { ...definition("safdoulas-registry", "course").example, provider_record_id: provider.id }), "active");
    const curriculum = await transition(await create("safdoulas-registry", "curriculum", {
      ...definition("safdoulas-registry", "curriculum").example, course_record_id: course.id, total_hours: 180,
      modules: [{ code: "M1", name: "Synchronous learning", hours: 94, contents: ["Declared syllabus"], activities: [{ activity_type: "theoretical", modality: "online_synchronous", hours: 94 }] },
        { code: "M2", name: "Asynchronous learning", hours: 46, contents: ["Declared syllabus"], activities: [{ activity_type: "theoretical", modality: "online_asynchronous", hours: 46 }] },
        { code: "M3", name: "Supervised practice", hours: 40, contents: ["Declared practice"], activities: [{ activity_type: "supervised_practice", modality: "in_person", hours: 40 }] }],
    }), "active");
    const sourceForm = setup.records.course_form;
    const application = await transition(await create("forms", "submission", {
      form_id: sourceForm.id, form_revision: sourceForm.revision, answers: {
        responsible_name: "Fictitious representative", responsible_email: "representative@example.test", responsible_role: "Authorized representative",
        provider_record_id: provider.id, provider_revision: provider.revision, course_record_id: course.id, course_revision: course.revision,
        curriculum_record_id: curriculum.id, curriculum_revision: curriculum.revision, declared_hours: 180, modality: "hybrid",
        document_refs: [{ record_id: original.id, revision: original.revision, purpose: "Complete dossier" }],
        edital_read: true, information_true: true, privacy_accepted: true, rules_accepted: true, observations: "Integration test only",
      },
    }), "submitted");
    let process = await create("safdoulas-processes", "accreditation_process", {
      ...definition("safdoulas-processes", "accreditation_process").example,
      ruleset_record_id: setup.records.ruleset.id, ruleset_revision: setup.records.ruleset.revision,
      provider_record_id: provider.id, provider_revision: provider.revision, course_record_id: course.id, course_revision: course.revision,
      curriculum_record_id: curriculum.id, curriculum_revision: curriculum.revision,
      application_submission_record_id: application.id, application_submission_revision: application.revision,
      blinding_policy_record_id: setup.records.blinding_policy.id, blinding_policy_revision: setup.records.blinding_policy.revision,
      document_snapshots: [{ record_id: original.id, revision: original.revision }],
    });
    const nativeCards=new RecordCardsService(db,records,access,registry);nativeCards.install();
    const courseLink=await nativeCards.card("safdoulas-processes",process.id,actors[0],true);
    const inbox=new FeaturesService(db,undefined,access),originalPosition=await db.one('SELECT list_id,position FROM cards WHERE id=$1',[courseLink.card_id]);
    await inbox.assignToInbox(actors[0],{card_ids:[courseLink.card_id]});await inbox.assignToInbox(actors[0],{card_ids:[courseLink.card_id]});
    assert.deepEqual(await db.one('SELECT list_id,position FROM cards WHERE id=$1',[courseLink.card_id]),originalPosition);
    assert.ok((await inbox.assignedCards(actors[0])).some(card=>card.id===courseLink.card_id));
    registry.setEnabled('record-cards',false);assert.ok(!(await inbox.assignedCards(actors[0])).some(card=>card.id===courseLink.card_id));await assert.rejects(()=>inbox.assignToInbox(actors[0],{card_ids:[courseLink.card_id]}));registry.setEnabled('record-cards',true);
    const boardScope=await nativeCards.scope(courseLink.board_id,actors[0]);assert.equal(boardScope?.phases.length,9);assert.equal(boardScope?.templates.length,8);
    const operations=new SafdoulasCaseworkController(records,registry,access,db,nativeCards);
    const reused=await operations.createBoard({orbitActor:actors[0]} as never,workspace.id,{course_id:course.id,ruleset_id:setup.records.ruleset.id,operation_key:randomUUID()});assert.equal(reused.board_id,courseLink.board_id);
    const key=randomUUID(),task=await nativeCards.fromTemplate(courseLink.board_id,"working-group",actors[0],key);
    assert.equal((await nativeCards.fromTemplate(courseLink.board_id,"working-group",actors[0],key)).id,task.id);
    assert.equal((await db.one<{count:number}>("SELECT count(*)::int AS count FROM checklist_items WHERE card_id=$1",[task.id]))?.count,4);
    await assert.rejects(()=>nativeCards.fromTemplate(courseLink.board_id,"arbitrary",actors[0],randomUUID()),/fora do escopo/);
    process = await transition(process, "submitted"); assert.match(String(process.payload.protocol_number), /^SAF-\d{4}\/\d{4,}$/);
    process = await transition(process, "triage");
    const ruleSnapshot = await records.versionSnapshot("safdoulas-governance", setup.records.ruleset.id, setup.records.ruleset.revision, actors[0]);
    const requirements = ruleSnapshot.payload.admission_requirements as Array<{ code: string }>;
    const triage = await transition(await create("safdoulas-triage", "admissibility_review", {
      process_record_id: process.id, process_revision: process.revision, ruleset_record_id: setup.records.ruleset.id, ruleset_revision: setup.records.ruleset.revision,
      findings: requirements.map((item) => ({ requirement_code: item.code, outcome: "met", evidence: [{ record_id: original.id, revision: original.revision }] })), recommendation: "admissible", rationale: "All documents checked in isolated scenario",
    }), "completed");
    process = await transition(await revise(process, { triage_review_record_id: triage.id, triage_review_revision: triage.revision }), "review");
    let copy = await upload("Blinded dossier", "Coded institution. Curriculum, professional experience and educational evidence remain available.", original);
    const review = await transition(await create("documents", "review", { document_id: copy.id, document_revision: copy.revision, decision: "approved",
      checks: Object.fromEntries(["person_name", "institution_name", "cnpj", "contact", "visual_identity", "file_metadata"].map((code) => [code, true])), reason: "Independent review of every configured redaction category" }, actors[1]), "published", actors[1]);
    copy = await transition(copy, "published");
    const projection = await transition(await create("safdoulas-blinding", "blinded_projection", {
      process_record_id: process.id, process_revision: process.revision, original_document_record_id: original.id, original_document_revision: original.revision,
      blinded_document_record_id: copy.id, blinded_document_revision: copy.revision, document_review_record_id: review.id, document_review_revision: review.revision,
      blinding_policy_record_id: setup.records.blinding_policy.id, blinding_policy_revision: setup.records.blinding_policy.revision, reviewer_note: "Original preserved; independent review kept",
    }), "verified");
    const ethics = await transition(await create("terms", "term", { content: "Commitment to ethics, secrecy and impartiality", source_reference: "Supplied ethical commitment" }), "published");
    const profiles: ExtensionRecord[] = [];
    for (const actor of evaluators) {
      await records.accept(ethics.id, actor, { revision: ethics.revision, accepted: true, operation_key: randomUUID() });
      let candidate = await create("safdoulas-accreditors", "application", {
        ...definition("safdoulas-accreditors", "application").example, user_id: actor, source_submission_record_id: application.id, source_submission_revision: application.revision,
      });
      for (const state of ["submitted", "under_review", "approved"]) candidate = await transition(candidate, state);
      let profile = await create("safdoulas-accreditors", "profile", {
        ...definition("safdoulas-accreditors", "profile").example, user_id: actor, application_record_id: candidate.id, application_revision: candidate.revision,
        credential_number: `ACC-${actor}`, valid_from: "2026-01-01T00:00:00Z", valid_until: "2030-01-01T00:00:00Z",
        ethics_term_record_id: ethics.id, ethics_term_revision: ethics.revision, ethics_accepted_at: "2026-01-01T00:00:00Z", conflict_declaration_valid_until: "2030-01-01T00:00:00Z",
        training_completed_at: "2026-01-01T00:00:00Z", training_attestation_reference: "Verified attendance at alignment", affiliations: [],
      });
      profile = await transition(await transition(profile, "approved"), "active"); profiles.push(profile);
    }
    const certificate = await new SafdoulasAccreditorCertificateController(records, access, registry).generate({ orbitActor: actors[0] } as never, profiles[0].id);
    const certificateFile = await records.download(certificate.document_record_id, certificate.document_revision, actors[0]);
    assert.equal(certificateFile.data.subarray(0, 5).toString(), "%PDF-");
    const assignment = await transition(await create("safdoulas-assessments", "evaluation_assignment", {
      ...definition("safdoulas-assessments", "evaluation_assignment").example, process_record_id: process.id, process_revision: process.revision,
      matrix_record_id: setup.records.matrix.id, matrix_revision: setup.records.matrix.revision,
      blinded_projection_refs: [{ record_id: projection.id, revision: projection.revision }], evaluator_user_ids: evaluators,
      evaluator_profile_refs: profiles.map((profile, index) => ({ user_id: evaluators[index], record_id: profile.id, revision: profile.revision })),
    }), "assigned");
    const evaluations: ExtensionRecord[] = [];
    for (const actor of evaluators) evaluations.push(await transition(await create("safdoulas-assessments", "individual_evaluation", {
      ...definition("safdoulas-assessments", "individual_evaluation").example,
      assignment_record_id: assignment.id, assignment_revision: assignment.revision, process_record_id: process.id, process_revision: process.revision,
      matrix_record_id: setup.records.matrix.id, matrix_revision: setup.records.matrix.revision,
      evaluator_user_id: actor, evaluation_role: actor === evaluators[0] ? "first" : "second",
      answers: safdoulasReferenceData.matrix.dimensions.flatMap((dimension) => dimension.criteria.map((criterion) => ({ criterion_code: criterion.code, outcome: "A", justification: "Evidence reviewed in this fictitious case", evidence: [{ record_id: copy.id, revision: copy.revision }] }))),
    }, actor), "submitted", actor));
    await assert.rejects(() => records.detail("documents", original.id, evaluators[0]), /autorizado/);
    await assert.rejects(() => records.detail("safdoulas-assessments", evaluations[1].id, evaluators[0]), /autorizado/);
    const consolidation = await transition(await create("safdoulas-assessments", "evaluation_consolidation", {
      ...definition("safdoulas-assessments", "evaluation_consolidation").example,
      process_record_id: process.id, process_revision: process.revision, matrix_record_id: setup.records.matrix.id, matrix_revision: setup.records.matrix.revision,
      first_evaluation_record_id: evaluations[0].id, first_evaluation_revision: evaluations[0].revision,
      second_evaluation_record_id: evaluations[1].id, second_evaluation_revision: evaluations[1].revision, divergences: [],
    }), "completed");
    process = await transition(await revise(process, { evaluation_consolidation_record_id: consolidation.id, evaluation_consolidation_revision: consolidation.revision }), "deliberation");
    let decision = await create("safdoulas-decisions", "institutional_decision", {
      ...definition("safdoulas-decisions", "institutional_decision").example,
      process_record_id: process.id, process_revision: process.revision, evaluation_consolidation_record_id: consolidation.id, evaluation_consolidation_revision: consolidation.revision,
      decision_policy_record_id: setup.records.decision_policy.id, decision_policy_revision: setup.records.decision_policy.revision,
      outcome: "approved", vote_refs: [], signatory_user_ids: actors,
    });
    const votes = [];
    for (const actor of actors) votes.push(await transition(await create("safdoulas-decisions", "deliberation_vote", {
      decision_record_id: decision.id, decision_revision: decision.revision, process_record_id: process.id, voter_user_id: actor, position: "approve", rationale: "Independent collegiate vote", voted_at: null,
    }, actor), "submitted", actor));
    decision = await transition(await revise(decision, { vote_refs: votes.map((vote) => ({ record_id: vote.id, revision: vote.revision })) }), "ratified");
    process = await transition(await revise(process, { institutional_decision_record_id: decision.id, institutional_decision_revision: decision.revision }), "decision");
    const signed = await transition(await upload("Signed concession demonstration", "Fictitious signed document, not a real institutional signature."), "published");
    const sealManual = await db.one<ExtensionRecord>("SELECT * FROM extension_records WHERE workspace_id=$1 AND plugin_id='safdoulas-governance' AND payload->>'category'='manual_selo'", [workspace.id]);
    const seal = await transition(await transition(await create("safdoulas-accreditation", "seal_asset", {
      version: "isolated-demo", files: ["print", "digital"].map((format) => ({ format, document_record_id: original.id, document_revision: original.revision, checksum_sha256: original.payload.sha256 })),
      manual_record_id: sealManual!.id, manual_revision: sealManual!.revision, approval_reference: "Demo only", approved_at: new Date().toISOString(),
    }), "approved"), "active");
    const grant = await transition(await create("safdoulas-accreditation", "accreditation_grant", {
      ...definition("safdoulas-accreditation", "accreditation_grant").example,
      process_record_id: process.id, process_revision: process.revision, decision_record_id: decision.id, decision_revision: decision.revision,
      concession_template_record_id: setup.records.concession_template.id, concession_template_revision: setup.records.concession_template.revision,
      signed_document_record_id: signed.id, signed_document_revision: signed.revision,
      seal_asset_record_id: seal.id, seal_asset_revision: seal.revision, seal_version: "isolated-demo",
      scope: { provider_name: provider.payload.display_name, course_name: course.payload.name, modality: "hybrid", description: "Only the submitted course and offering", offering_codes: [] },
      valid_from: "2026-10-21", valid_until: "2028-10-21", condition_refs: [],
    }), "active");
    assert.match(String(grant.payload.verification_code), /^SAF-[A-F0-9]{32}$/);
    const otherCourse=await transition(await create("safdoulas-registry","course",{...course.payload,name:"Another isolated course"}),"active");
    const other=await operations.createBoard({orbitActor:actors[0]} as never,workspace.id,{course_id:otherCourse.id,ruleset_id:setup.records.ruleset.id,operation_key:randomUUID()});assert.notEqual(other.board_id,courseLink.board_id);
    assert.equal((await nativeCards.scope(other.board_id,actors[0]))?.phases.length,9);
    await assert.rejects(()=>operations.createBoard({orbitActor:actors[0]} as never,workspace.id,{course_id:otherCourse.id,ruleset_id:setup.records.ruleset.id,operation_key:randomUUID(),title:"Free board"} as never),/fora do escopo/);
    const casework = new SafdoulasCaseworkController(records, registry, access, db, new RecordCardsService(db,records,access,registry));
    const projected=await db.one<{phase_id:string}>("SELECT p.phase_id FROM cards c JOIN record_board_phases p ON p.list_id=c.list_id WHERE c.id=$1",[courseLink.card_id]);assert.equal(projected?.phase_id,"decision");
    const folder = await casework.detail({ orbitActor: actors[0] } as never, process.id);
    assert.equal(folder.process.state, "decision");
    assert.ok(folder.records.some((record) => record.id === grant.id));
    assert.equal(folder.requirement_checks.find((check) => check.code === "minimum_total_hours")?.value, 180);
    registry.setEnabled("safdoulas-processes", false);
    await assert.rejects(() => casework.detail({ orbitActor: actors[0] } as never, process.id), /desativada/);
  } finally { await db.pool.end(); }
});
