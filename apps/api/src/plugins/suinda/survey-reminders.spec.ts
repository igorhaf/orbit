import assert from "node:assert/strict";
import test from "node:test";
import { suindaPlugin } from "./suinda.plugin";
import { isSurveyReminderInterval, surveyReminderIsDue } from "./survey-reminders";

test("survey reminder policy accepts only supported hour intervals", () => {
  for (const interval of [1, 6, 12, 24, 48]) assert.equal(isSurveyReminderInterval(interval), true);
  for (const interval of [0, 2, 72, "24", null, 24.5]) assert.equal(isSurveyReminderInterval(interval), false);
});

test("survey reminder is due only inside the configured window and before closing", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");
  assert.equal(surveyReminderIsDue("2026-10-23T18:00:00.000Z", 6, now), true);
  assert.equal(surveyReminderIsDue("2026-10-23T18:00:01.000Z", 6, now), false);
  assert.equal(surveyReminderIsDue("2026-10-23T11:59:59.000Z", 6, now), false);
  assert.equal(surveyReminderIsDue("not-a-date", 6, now), false);
  assert.equal(surveyReminderIsDue("2026-10-24T00:00:00.000Z", 72, now), false);
});

test("survey reminder policy reads are scoped to plugin readers and writes require managers", () => {
  const path = "/extensions/suinda-learning/workspaces/00000000-0000-4000-8000-000000000001/survey-reminder-policy";
  assert.equal(suindaPlugin.routePermission?.(path, "GET"), "plugin.suinda-learning.read");
  assert.equal(suindaPlugin.routePermission?.(path, "PUT"), "plugin.suinda-learning.manage");
});
