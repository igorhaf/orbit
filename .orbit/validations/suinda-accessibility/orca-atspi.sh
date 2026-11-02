#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
test_dir="$(mktemp -d /tmp/suinda-orca-atspi-XXXXXX)"
trap 'rm -rf "$test_dir"' EXIT

xvfb-run -a dbus-run-session -- bash -c '
  set -euo pipefail
  test_dir="$1"
  repo_root="$2"
  mkdir -p "$test_dir/config/speech-dispatcher" "$test_dir/orca"
  cat > "$test_dir/config/speech-dispatcher/speechd.conf" <<"EOF"
LogLevel 5
AddModule "dummy" "sd_dummy" ""
DefaultModule "dummy"
EOF
  export XDG_CONFIG_HOME="$test_dir/config" TMPDIR="$test_dir" GTK_MODULES="gail:atk-bridge"
  cd "$repo_root"
  orca --user-prefs "$test_dir/orca" --speech-system speechdispatcherfactory \
    --debug-file="$test_dir/orca.log" >"$test_dir/orca.out" 2>&1 &
  orca_pid=$!
  cleanup() {
    kill -TERM "$orca_pid" 2>/dev/null || true
    wait "$orca_pid" 2>/dev/null || true
  }
  trap cleanup EXIT
  sleep 1
  if ! kill -0 "$orca_pid" 2>/dev/null; then cat "$test_dir/orca.out"; exit 1; fi
  if [[ "${SUINDA_ORCA_AUTHENTICATED:-0}" == "1" ]]; then
    export SUINDA_AUTH_A11Y_ATSPI=1
    if [[ "${SUINDA_ORCA_AUTH_ALL_ROUTES:-0}" == "1" ]]; then
      unset SUINDA_AUTH_A11Y_ROUTES
    else
      export SUINDA_AUTH_A11Y_ROUTES="${SUINDA_ORCA_AUTH_ROUTES:-/suinda,/suinda/profile,/suinda/learning/00000000-0000-4000-8000-000000000303}"
    fi
    set +e
    node .orbit/validations/suinda-accessibility/authenticated-routes.browser.mjs >"$test_dir/authenticated-report.json" 2>&1
    test_code=$?
    set -e
    jq '\''{routes_requested, route_viewports, routes_covered: ([.results[].route] | unique), api_requests_intercepted, generic_fixture_fallback_requests, atspi_failures, axe_violations_by_rule, responsive_failures, runtime_errors, unnamed_controls: [.results[] | select((.atspi_tree.unnamed_interactive_controls // []) | length > 0) | {route, viewport, controls: .atspi_tree.unnamed_interactive_controls}], heading_failures: [.results[] | select(.atspi_tree.expected_heading_seen != true) | {route, viewport, atspi_tree}], skip_link_focus_failures: [.results[] | select(.atspi_tree.focused_accessible_object.focused != true or .atspi_tree.focused_accessible_object.name != "Ir para o conteúdo principal") | {route, viewport, atspi_tree}]} '\'' "$test_dir/authenticated-report.json"
    if [[ "$test_code" -ne 0 ]]; then exit "$test_code"; fi
  else
    node .orbit/validations/suinda-accessibility/atspi-tree.browser.mjs
  fi
  sleep 0.2
  cleanup
  trap - EXIT
  if [[ "${SUINDA_ORCA_AUTHENTICATED:-0}" == "1" ]]; then
    grep -Fq "SPEECH OUTPUT:" "$test_dir/orca.log" || {
      echo "Orca não registrou nenhuma fala da navegação autenticada." >&2; exit 1;
    }
  else
    grep -Fq "SPEECH OUTPUT: '\''Página: Termos de uso e aviso de privacidade'\''" "$test_dir/orca.log" || {
      echo "Orca não registrou a leitura do título acessível." >&2; exit 1;
    }
  fi
  grep -Fq "BRAILLE LINE:  '\''Ir para o conteúdo principal'\''" "$test_dir/orca.log" || {
    echo "Orca não refletiu no fluxo braille o link focado." >&2; exit 1;
  }
  echo "Orca leu o título e reportou o link de salto focado via AT-SPI."
' _ "$test_dir" "$repo_root"
