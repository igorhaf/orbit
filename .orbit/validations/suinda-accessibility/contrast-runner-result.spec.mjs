import assert from "node:assert/strict";
import test from "node:test";
import { getContrastRunnerFailures } from "./contrast-runner-result.mjs";

const clean = {
  routes: 2,
  viewports_per_route: 2,
  modes: ["authenticated-synthetic"],
  route_viewports_completed: 4,
  violations: [],
  non_text_violations: [],
  unresolved: [],
  route_errors: [],
  hover_state_errors: [],
  focus_coverage_errors: [],
  interaction_state_failures: [],
  interaction_state_unresolved: [],
  keyboard_interaction_checks: [{ passed: true }],
  blocked_non_get_requests: 0,
};

test("accepts a complete contrast report with no findings", () => {
  assert.deepEqual(getContrastRunnerFailures(clean), []);
});

for (const field of [
  "violations", "non_text_violations", "unresolved", "route_errors", "hover_state_errors",
  "focus_coverage_errors", "interaction_state_failures", "interaction_state_unresolved",
]) {
  test(`fails when ${field} has findings`, () => {
    assert.ok(getContrastRunnerFailures({ ...clean, [field]: [{ reason: "synthetic finding" }] })
      .some((finding) => finding.field === field));
  });
}

test("fails when route and viewport coverage is incomplete", () => {
  assert.ok(getContrastRunnerFailures({ ...clean, route_viewports_completed: 3 })
    .some((finding) => finding.field === "route_viewports_completed"));
});

test("fails on escaped writes and failed directed keyboard checks", () => {
  const findings = getContrastRunnerFailures({ ...clean, blocked_non_get_requests: 1,
    keyboard_interaction_checks: [{ passed: false }] });
  assert.ok(findings.some((finding) => finding.field === "blocked_non_get_requests"));
  assert.ok(findings.some((finding) => finding.field === "keyboard_interaction_checks"));
});
