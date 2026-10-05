#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
override_names=()
override_values=()
for variable in BASE_URL TOKEN_USERNAME TOKEN_PASSWORD CPU_PROFILE CPU_WORK_MS CPU_RATE CPU_MAX_VUS CPU_DURATION_SECONDS SUMMARY_PATH \
  K6_WEB_DASHBOARD K6_WEB_DASHBOARD_OPEN K6_WEB_DASHBOARD_HOST K6_WEB_DASHBOARD_PORT K6_WEB_DASHBOARD_PERIOD K6_WEB_DASHBOARD_EXPORT; do
  if declare -p "$variable" >/dev/null 2>&1; then
    override_names+=("$variable")
    override_values+=("${!variable}")
  fi
done
if [[ -n "${ENV_FILE:-}" ]]; then
  [[ -f "$ENV_FILE" ]] || { printf 'ENV_FILE does not exist\n' >&2; exit 2; }
  # Use only your existing, trusted private configuration; shell files can execute code.
  set -a
  source "$ENV_FILE"
  set +a
fi
for ((index = 0; index < ${#override_names[@]}; index++)); do
  export "${override_names[$index]}=${override_values[$index]}"
done
export CPU_PROFILE="${1:-${CPU_PROFILE:-smoke}}"
case "$CPU_PROFILE" in smoke|load) ;; *) printf 'Usage: %s [smoke|load]\n' "$0" >&2; exit 2 ;; esac
# Isolate JSON and status reports even when dashboard HTML export is disabled.
if [[ -z "${SUMMARY_PATH:-}" ]]; then
  mkdir -p reports
  report_directory="$(mktemp -d "reports/cpu-${CPU_PROFILE}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
  export SUMMARY_PATH="$PWD/$report_directory/summary.json"
fi
if [[ "${K6_WEB_DASHBOARD_EXPORT:-}" == 'report.html' ]]; then
  export K6_WEB_DASHBOARD_EXPORT="$(dirname -- "$SUMMARY_PATH")/report.html"
fi
exec k6 run cpu-demo.js
