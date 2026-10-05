#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# ENV_FILE may point to a private configuration outside this repository.
# Explicit environment values take precedence over values in the file.
override_names=()
override_values=()
for variable in BASE_URL TOKEN_USERNAME TOKEN_PASSWORD ACCOUNT_IDS CURRENCY WORKLOAD ALLOW_WRITES \
  WRITE_EVERY AMOUNT RATE PRE_ALLOCATED_VUS MAX_VUS STRESS_RATES RAMP_DURATION HOLD_DURATION \
  P95_MS ERROR_RATE REQUEST_TIMEOUT DURATION PROFILE SMOKE_ITERATIONS K6_BIN SUMMARY_PATH \
  CPU_WORK_MS CPU_RATE CPU_MAX_VUS CPU_DURATION_SECONDS \
  K6_WEB_DASHBOARD K6_WEB_DASHBOARD_OPEN K6_WEB_DASHBOARD_HOST K6_WEB_DASHBOARD_PORT K6_WEB_DASHBOARD_PERIOD K6_WEB_DASHBOARD_EXPORT; do
  if declare -p "$variable" >/dev/null 2>&1; then
    override_names+=("$variable")
    override_values+=("${!variable}")
  fi
done
if [[ -f "${ENV_FILE:-.env}" ]]; then
  set -a
  source "${ENV_FILE:-.env}"
  set +a
fi
for ((index = 0; index < ${#override_names[@]}; index++)); do
  export "${override_names[$index]}=${override_values[$index]}"
done
unset override_names override_values
export PROFILE="${1:-${PROFILE:-smoke}}"
case "$PROFILE" in
  smoke|load|stress|soak) ;;
  *) printf 'Usage: %s [smoke|load|stress|soak]\n' "$0" >&2; exit 2 ;;
esac
script='banking.js'
if [[ "${WORKLOAD:-balance}" == 'cpu' ]]; then
  case "$PROFILE" in
    smoke) export CPU_PROFILE='smoke' ;;
    load|stress) export CPU_PROFILE='load' ;;
    soak) printf 'CPU workload supports smoke, load, or stress (bounded sustained load); soak exceeds its five-minute limit.\n' >&2; exit 2 ;;
  esac
  script='cpu-demo.js'
fi
if ! command -v "${K6_BIN:-k6}" >/dev/null 2>&1; then
  printf 'k6 is required. Install it with brew install k6 or set K6_BIN.\n' >&2
  exit 2
fi
if [[ -z "${SUMMARY_PATH:-}" ]]; then
  mkdir -p reports
  report_directory="$(mktemp -d "reports/${PROFILE}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
  export SUMMARY_PATH="$PWD/$report_directory/summary.json"
fi
# Keep the default HTML report alongside this run's JSON summary.
if [[ "${K6_WEB_DASHBOARD_EXPORT:-}" == 'report.html' ]]; then
  export K6_WEB_DASHBOARD_EXPORT="$(dirname -- "$SUMMARY_PATH")/report.html"
fi
printf 'Workload: %s. Profile: %s. Results: %s\n' "${WORKLOAD:-balance}" "$PROFILE" "$SUMMARY_PATH"
exec "${K6_BIN:-k6}" run "$script"
