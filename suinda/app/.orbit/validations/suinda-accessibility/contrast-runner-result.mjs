export function getContrastRunnerFailures(summary) {
  const findings = [];
  const arrays = [
    "violations",
    "non_text_violations",
    "unresolved",
    "route_errors",
    "hover_state_errors",
    "focus_coverage_errors",
    "interaction_state_failures",
    "interaction_state_unresolved",
  ];
  for (const field of arrays) {
    const count = summary[field]?.length ?? 0;
    if (count > 0) findings.push({ field, count });
  }
  if ((summary.blocked_non_get_requests ?? 0) > 0) {
    findings.push({ field: "blocked_non_get_requests", count: summary.blocked_non_get_requests });
  }
  const failedKeyboardInteractions = (summary.keyboard_interaction_checks ?? []).filter((entry) => entry.passed !== true).length;
  if (failedKeyboardInteractions > 0) findings.push({ field: "keyboard_interaction_checks", count: failedKeyboardInteractions });

  const expectedRouteViewports = (summary.routes ?? 0) * (summary.viewports_per_route ?? 0) * (summary.modes?.length ?? 0);
  if (expectedRouteViewports > 0 && summary.route_viewports_completed !== expectedRouteViewports) {
    findings.push({ field: "route_viewports_completed", count: expectedRouteViewports - (summary.route_viewports_completed ?? 0),
      expected: expectedRouteViewports, actual: summary.route_viewports_completed ?? 0 });
  }
  return findings;
}
