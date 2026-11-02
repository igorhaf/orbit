import assert from "node:assert/strict";
import test from "node:test";
import { hasAuthenticatedAccessibilityFailures } from "./authenticated-runner-result.mjs";

const clean = {
  browser_fatal_error: null,
  escaped_api_requests: [],
  routes_with_errors: [],
  runtime_errors: [],
  axe_violations_by_rule: {},
  semantic_failures: [],
  responsive_failures: [],
  first_focus_failures: [],
  atspi_failures: [],
  keyboard_sequence_failures: [],
  keyboard_interaction_failures: [],
  role_access_failures: [],
};

test("passes a clean synthetic authenticated accessibility report", () => {
  assert.equal(hasAuthenticatedAccessibilityFailures(clean), false);
});

for (const [field, value] of [
  ["browser_fatal_error", "browser failed"],
  ["escaped_api_requests", [{ endpoint: "GET /api/private" }]],
  ["routes_with_errors", [{ route: "/suinda/profile", status: 500 }]],
  ["runtime_errors", [{ route: "/suinda/profile", message: "render failed" }]],
  ["axe_violations_by_rule", { "button-name": 1 }],
  ["semantic_failures", [{ route: "/suinda/profile", h1_count: 0 }]],
  ["responsive_failures", [{ route: "/suinda/learning/test", viewport_width: 320, document_width: 390 }]],
  ["first_focus_failures", [{ route: "/suinda/profile", reason: "no indicator" }]],
  ["atspi_failures", [{ route: "/suinda/profile", report: { expected_heading_seen: false } }]],
  ["keyboard_sequence_failures", [{ route: "/suinda/learning/test", reverse_matches: false }]],
  ["keyboard_interaction_failures", [{ route: "/suinda/learning/test", message: "Escape did not restore focus" }]],
  ["role_access_failures", [{ route: "/suinda", profile: "learner", expected_management_visible: false, actual_management_visible: true }]],
]) {
  test(`fails when ${field} contains a finding`, () => {
    assert.equal(hasAuthenticatedAccessibilityFailures({ ...clean, [field]: value }), true);
  });
}
