import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { privacyAccountScopeIssue, privacyAccountSharedIdentityIssue, privacyAttachmentBelongsToSubject, privacyCategoryDecisionGaps, privacyIdentityChallengeIsUsable, privacyMappingKey, privacyPathExists, privacyPathIsAllowedForErasure, privacyPathIsRedactableLeaf, privacyRecordOwnership, privacyRelatedRecordIds } from "./suinda.service";
import { suindaPlugin } from "./suinda.plugin";

const now = Date.parse("2026-10-23T12:00:00Z");
const validChallenge = () => ({ consumed_at: null, email_verified: true, disabled: false, is_root: false,
  challenge_session_version: 4, session_version: 4, attempts: 0, expires_at: new Date(now + 60_000) });

test("OTP exige titular verificado, ativo, não ROOT, sessão atual, validade e uso único", () => {
  assert.equal(privacyIdentityChallengeIsUsable(validChallenge(), now), true);
  for (const change of [
    { consumed_at: new Date(now) }, { email_verified: false }, { disabled: true }, { is_root: true },
    { challenge_session_version: 3 }, { attempts: 5 }, { expires_at: new Date(now) },
  ]) assert.equal(privacyIdentityChallengeIsUsable({ ...validChallenge(), ...change }, now), false);
});

test("cada categoria solicitada precisa de decisão aprovada", () => {
  assert.deepEqual(privacyCategoryDecisionGaps(["acadêmico", "cadastro", "anexos"], [
    { category: "acadêmico", decision: "approved" }, { category: "cadastro", decision: "denied" },
  ]), { missing: ["anexos"], denied: ["cadastro", "anexos"] });
  assert.deepEqual(privacyCategoryDecisionGaps(["cadastro"], [{ category: "cadastro", decision: "approved" }]), { missing: [], denied: [] });
});

test("anonimização da conta exige escopo explícito de perfil e bloqueia mapa de conta em outros escopos", () => {
  assert.equal(privacyAccountScopeIssue("account_profile", ["name", "email"]), null);
  assert.match(String(privacyAccountScopeIssue("account_profile", ["name"])), /e-mail da conta/);
  assert.match(String(privacyAccountScopeIssue("account_profile", [])), /nome da conta/);
  assert.match(String(privacyAccountScopeIssue("academic_record", ["name"])), /escopo de perfil acadêmico/);
  assert.equal(privacyAccountScopeIssue("academic_record", []), null);
});

test("anonimização global falha fechada quando a conta tem outro papel ou identidade Orbit", () => {
  assert.equal(privacyAccountSharedIdentityIssue(false), null);
  assert.match(String(privacyAccountSharedIdentityIssue(true)), /outros papéis, workspaces ou identidades Orbit/);
});

test("mapa de eliminação mantém plugins separados e registros filhos seguem a titularidade docente", () => {
  assert.equal(privacyMappingKey(undefined, "evaluation_cycle"), "suinda-learning:evaluation_cycle");
  assert.equal(privacyMappingKey("suinda-teacher-evaluation", "evaluation_cycle"), "suinda-teacher-evaluation:evaluation_cycle");
  assert.equal(privacyPathIsAllowedForErasure(["teacher_user_id"]), false);
  const subject = "teacher-a";
  const records = [
    { id: "cycle-a", plugin_id: "suinda-teacher-evaluation", kind: "evaluation_cycle", payload: { teacher_user_id: subject } },
    { id: "appeal-a", plugin_id: "suinda-teacher-evaluation", kind: "evaluation_appeal", payload: { teacher_user_id: subject, cycle_record_id: "cycle-a" } },
    { id: "appeal-b", plugin_id: "suinda-teacher-evaluation", kind: "evaluation_appeal", payload: { teacher_user_id: "teacher-b", cycle_record_id: "cycle-a" } },
    { id: "policy", plugin_id: "suinda-teacher-evaluation", kind: "evaluation_policy", payload: { approved_by_user_id: subject } },
  ];
  assert.deepEqual([...privacyRelatedRecordIds(subject, records, [])].sort(), ["appeal-a", "appeal-b", "cycle-a"].sort());
  assert.equal(privacyRecordOwnership(subject, [records[0]!.payload]), "owned");
  assert.equal(privacyRecordOwnership(subject, [records[2]!.payload]), "other");
});

test("schema de pedido de privacidade aceita categorias solicitadas sem exigir a propriedade em outros direitos", () => {
  const schema = suindaPlugin.contributions?.recordKinds?.learner_privacy_request?.schema as {
    properties?: Record<string, { type?: string; maxItems?: number }>;
    required?: string[];
  };
  assert.equal(schema.properties?.requested_categories?.type, "array");
  assert.equal(schema.properties?.requested_categories?.maxItems, 30);
  assert.equal(schema.required?.includes("requested_categories"), false);
});

test("mapeamento de path só considera propriedades existentes em objetos", () => {
  const payload = { learner: { contact: { phone: "redact" } }, evidence: [{ name: "file" }] };
  assert.equal(privacyPathExists(payload, ["learner", "contact", "phone"]), true);
  assert.equal(privacyPathExists(payload, ["learner", "contact", "email"]), false);
  assert.equal(privacyPathExists(payload, ["evidence", "0", "name"]), false);
  assert.equal(privacyPathExists(payload, ["evidence", "name"]), false);
});

test("eliminação aceita apenas folhas escalares e nunca remove um objeto inteiro", () => {
  const payload = { identity: { learner_user_id: "learner-id", email: "private" }, profile: { phone: "private" }, score: 0 };
  assert.equal(privacyPathIsRedactableLeaf(payload, ["profile", "phone"]), true);
  assert.equal(privacyPathIsRedactableLeaf(payload, ["score"]), true);
  assert.equal(privacyPathIsRedactableLeaf(payload, ["identity"]), false);
  assert.equal(privacyPathIsRedactableLeaf(payload, ["identity", "learner_user_id"]), true);
  assert.equal(privacyPathIsRedactableLeaf(payload, ["missing"]), false);
  assert.equal(privacyPathIsRedactableLeaf({ list: ["private"] }, ["list"]), false);
  assert.equal(privacyPathIsAllowedForErasure(["answer"]), true);
  assert.equal(privacyPathIsAllowedForErasure(["learner_user_id"]), false);
  assert.equal(privacyPathIsAllowedForErasure(["course_record_id"]), false);
  assert.equal(privacyPathIsAllowedForErasure(["score"]), false);
});

test("eliminação de anexos só aceita arquivos enviados pelo titular", () => {
  const subjectId = "11111111-1111-4111-8111-111111111111";
  assert.equal(privacyAttachmentBelongsToSubject(subjectId, subjectId), true);
  assert.equal(privacyAttachmentBelongsToSubject("22222222-2222-4222-8222-222222222222", subjectId), false);
  assert.equal(privacyAttachmentBelongsToSubject(subjectId.toUpperCase(), subjectId), true);
});

test("inventário de eliminação não atravessa curso/turma para alcançar matrícula e dados de outro aluno", () => {
  const subject = "learner-a";
  const other = "learner-b";
  const course = "course-record";
  const cohort = "cohort-record";
  const enrollmentA = "enrollment-a";
  const enrollmentB = "enrollment-b";
  const sharedThread = "thread-by-other";
  const records = [
    { id: course, payload: { instructor_ids: [subject] } },
    { id: cohort, payload: { course_record_id: course } },
    { id: enrollmentA, payload: { learner_user_id: subject, course_record_id: course, cohort_record_id: cohort } },
    { id: enrollmentB, payload: { learner_user_id: other, course_record_id: course, cohort_record_id: cohort } },
    { id: "attendance-a", payload: { enrollment_record_id: enrollmentA, learner_user_id: subject, status: "present" } },
    { id: "attendance-b", payload: { enrollment_record_id: enrollmentB, learner_user_id: other, status: "present" } },
    { id: sharedThread, payload: { enrollment_record_id: enrollmentA, author_user_id: other, body: "resposta compartilhada" } },
    { id: "reply-to-shared-thread", payload: { thread_record_id: sharedThread, body: "resposta anônima/sem titular" } },
  ];
  const related = privacyRelatedRecordIds(subject, records, []);
  assert.deepEqual([...related].sort(), ["attendance-a", enrollmentA, sharedThread].sort());
  assert.equal(privacyRecordOwnership(subject, [records[5]!.payload]), "other");
  assert.equal(privacyRecordOwnership(subject, [{ group_member_user_ids: [subject, other] }]), "shared");
  assert.equal(privacyRecordOwnership(subject, [{ enrollment_record_id: enrollmentA }]), "unowned");
});

test("migration de privacidade restringe alvos de conta a operações em execução e ao mapa aprovado", () => {
  const migration = readFileSync(resolve(__dirname, "../../../sql/migrations/194_suinda_privacy_account_guards.sql"), "utf8");
  assert.match(migration, /BEFORE INSERT ON suinda_privacy_account_targets/);
  assert.match(migration, /e\.state='executing' AND e\.subject_user_id=OLD\.id/);
  assert.match(migration, /Account redaction field is absent from the approved mapping/);
});
