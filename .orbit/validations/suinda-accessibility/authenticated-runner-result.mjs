export function hasAuthenticatedAccessibilityFailures(summary) {
  return Boolean(summary.browser_fatal_error)
    || (summary.escaped_api_requests?.length ?? 0) > 0
    || (summary.routes_with_errors?.length ?? 0) > 0
    || (summary.runtime_errors?.length ?? 0) > 0
    || Object.keys(summary.axe_violations_by_rule ?? {}).length > 0
    || (summary.semantic_failures?.length ?? 0) > 0
    || (summary.responsive_failures?.length ?? 0) > 0
    || (summary.first_focus_failures?.length ?? 0) > 0
    || (summary.atspi_failures?.length ?? 0) > 0
    || (summary.keyboard_sequence_failures?.length ?? 0) > 0
    || (summary.keyboard_interaction_failures?.length ?? 0) > 0
    || (summary.role_access_failures?.length ?? 0) > 0;
}
