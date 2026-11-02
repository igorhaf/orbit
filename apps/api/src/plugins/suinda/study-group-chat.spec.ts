import assert from "node:assert/strict";
import test from "node:test";
import type { RecordValidationContext } from "../contract";
import { suindaPlugin } from "./suinda.plugin";

const kinds = suindaPlugin.contributions?.recordKinds;
const chat = kinds?.study_group_message;
const actor = "learner-a";
const group = { id: "group-1", pluginId: "suinda-learning", kind: "study_group", state: "open", revision: 1,
  payload: { course_record_id: "course-1", course_revision: 2, owner_user_id: "owner", enrollment_record_id: "enrollment-owner" } };
const enrollment = { id: "enrollment-a", pluginId: "suinda-learning", kind: "enrollment", state: "active", revision: 1,
  payload: { learner_user_id: actor, course_record_id: "course-1", course_revision: 2 } };
const course = { id: "course-1", pluginId: "suinda-learning", kind: "course", state: "published", revision: 2, payload: { price_amount: 0 } };
const membership = { id: "member-a", pluginId: "suinda-learning", kind: "study_group_member", state: "active", revision: 1,
  payload: { group_record_id: group.id, learner_user_id: actor, enrollment_record_id: enrollment.id } };

function context(membershipState: "active" | "left", groupState: "open" | "closed" = "open", currentActor = actor) {
  const groupRecord = { ...group, state: groupState };
  const enrollmentRecord = { ...enrollment, payload: { ...enrollment.payload, learner_user_id: currentActor } };
  const memberRecord = { ...membership, state: membershipState, payload: { ...membership.payload, learner_user_id: currentActor } };
  const records = new Map<string, { id: string; pluginId: string; kind: string; state: string; revision: number; payload: Record<string, unknown> }>([
    [group.id, groupRecord], [enrollment.id, enrollmentRecord], [course.id, course],
  ]);
  return {
    resolveRecord: async (recordId: string) => records.get(recordId) || null,
    resolveLatestRecord: async (recordId: string) => records.get(recordId) || null,
    listLatestRecords: async (_plugin: string, kind: string, match: Record<string, string>, state?: string) =>
      kind === "study_group_member" && state === "active" && membershipState === "active"
        && match.group_record_id === group.id && match.learner_user_id === currentActor && match.enrollment_record_id === enrollment.id
        ? [memberRecord] : [],
  } as unknown as RecordValidationContext;
}

test("mensagens de grupo são registros privados, somente leitura e server-created", () => {
  assert.equal(chat?.serverCreated, true);
  assert.equal(chat?.resourceScoped, true);
  assert.deepEqual(chat?.transitions, { sent: [] });
  assert.deepEqual(chat?.uniqueFields, ["message_key"]);
  const schema = chat?.schema as { properties?: Record<string, { maxLength?: number }> };
  assert.equal(schema.properties?.body?.maxLength, 4000);
  assert.equal(schema.properties?.sent_at, undefined);
});

test("apenas integrantes atuais podem criar e ler; quem saiu perde leitura e grupos fechados ficam somente leitura", async () => {
  assert.equal(await chat?.authorizeCreate?.(actor, { group_record_id: group.id, enrollment_record_id: enrollment.id,
    sender_user_id: actor }, context("active")), true);
  assert.equal(await chat?.authorizeRecord?.(actor, "read", "sent", { group_record_id: group.id,
    enrollment_record_id: enrollment.id }, context("active")), true);
  assert.equal(await chat?.authorizeCreate?.(actor, { group_record_id: group.id, enrollment_record_id: enrollment.id,
    sender_user_id: actor }, context("left")), false);
  assert.equal(await chat?.authorizeRecord?.(actor, "read", "sent", { group_record_id: group.id,
    enrollment_record_id: enrollment.id }, context("left")), false);
  assert.equal(await chat?.authorizeCreate?.(actor, { group_record_id: group.id, enrollment_record_id: enrollment.id,
    sender_user_id: actor }, context("active", "closed")), false);
  assert.equal(await chat?.authorizeRecord?.(actor, "read", "sent", { group_record_id: group.id,
    enrollment_record_id: enrollment.id }, context("active", "closed")), true);
  const secondLearner = "learner-b";
  assert.equal(await chat?.authorizeCreate?.(secondLearner, { group_record_id: group.id, enrollment_record_id: enrollment.id,
    sender_user_id: secondLearner }, context("active", "open", secondLearner)), true);
  assert.equal(await chat?.authorizeRecord?.(secondLearner, "read", "sent", { group_record_id: group.id,
    enrollment_record_id: enrollment.id }, context("active", "open", secondLearner)), true);
});
