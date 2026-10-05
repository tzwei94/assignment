# Banking API k6 tests

Stress-test this project's authenticated balance, deposit, and withdrawal routes. The mixed workload reads a balance every iteration and deposits then withdraws the same amount every fifth iteration. It obtains a JWT through Basic login and refreshes it before expiration. Account creation and transfers are outside the API contract.

## CPU autoscaling demo

Set `WORKLOAD=cpu` in the project `.env` to target authenticated `POST /demo/cpu` instead of the account routes. Keep `BASE_URL` as the origin (`https://bnk-api.tzwei.me`); the launcher selects `cpu-demo.js`, which adds `/demo/cpu`. The existing username and password obtain a normal JWT. This workload hashes data in a bounded worker and performs no banking transactions.

The project demo settings are `CPU_WORK_MS=500`, `CPU_RATE=4`, `CPU_DURATION_SECONDS=300`, and `CPU_MAX_VUS=8`: four requests per second for five minutes, with one readiness monitor included in the VU limit. These match the existing CPU harness ceilings. CPU `stress` selects this sustained load profile rather than the banking ramp; `smoke` makes one request, and `soak` is unsupported. Banking `RATE`, `STRESS_RATES`, and VU settings are ignored for this workload. Use `CPU_*` variables to adjust it.

```sh
# Validate the deployment with one small CPU request first.
CPU_WORK_MS=50 ENV_FILE=.env ./run.sh smoke

# Run the configured CPU scaling demo.
ENV_FILE=.env ./run.sh stress
```

The five-minute hold exceeds the CPU alarm's three-minute evaluation window, but task startup and readiness add time. This is a bounded starting configuration, not a guarantee of scaling. Watch service-average CPU, desired/running tasks and readiness. Expected `cpu_demo_busy` HTTP 429 responses are reported separately; sustained rejections at 50% or more, unexpected errors, or degraded readiness stop the run. A 404 abort means the CPU endpoint is absent or disabled in the deployed app. Results use the usual per-run JSON report, excluding setup tokens. See [CPU endpoint behavior and metrics](CPU-DEMO.md).

## Quick start

Requires k6. On macOS:

```sh
brew install k6
cd /path/to/assignment/k6
mkdir -p "$HOME/.private/banking-api"
cp -n .env.example "$HOME/.private/banking-api/k6.env"
chmod 600 "$HOME/.private/banking-api/k6.env"
```

Edit that private file locally: set `BASE_URL`, `TOKEN_USERNAME`, and `TOKEN_PASSWORD`. The deployed review target documented by the project is `https://bnk-api.tzwei.me`; use `http://localhost:8080` for local startup. A Docker deployment may use another assigned host port. Use the same Basic credentials as Postman; no JWT signing key is needed.

```sh
export ENV_FILE="$HOME/.private/banking-api/k6.env"
./run.sh smoke
./run.sh load
./run.sh stress
./run.sh soak
```

Run the smoke check first. The private template selects `WORKLOAD=mixed` and `ALLOW_WRITES=true`. A mixed run changes account data and adds permanent operation records. Completed pairs return the balance to its starting value, but failed or interrupted pairs can leave it changed. Use synthetic accounts dedicated to the test. The harness checks final balances and reports unfinished pairs; it does not delete records or automatically repair balances.

Alternatively, copy `.env.example` to `.env` in this directory. `run.sh` reads `.env` unless `ENV_FILE` is specified. Config files use shell assignment syntax and are sourced; quote values and use only files you control. Explicit environment variables override file values, and the profile argument overrides `PROFILE`. Without a config file, the script defaults to a local, read-only smoke test and requires credentials from the environment.

## Workloads and profiles

| Workload | Requests |
|---|---|
| `mixed` | One balance GET every iteration; a deposit and withdrawal every `WRITE_EVERY` iterations (default 5), each for SGD 0.01. Requires `ALLOW_WRITES=true`. |
| `balance` | One authenticated balance GET per iteration; no writes. |
| `cpu` | Authenticated `POST /demo/cpu`; CPU settings and sustained-load profile described above. |

| Profile | Default load |
|---|---|
| `smoke` | 1 virtual user, 5 iterations. Includes one mutation pair in mixed mode. |
| `load` | 10 iterations/second for 5 minutes. |
| `stress` | Targets 10 → 25 → 50 → 100 iterations/second. Each step ramps for 30 seconds and holds for 1 minute, then ramps to zero for 30 seconds (6.5 minutes total). |
| `soak` | 10 iterations/second for 30 minutes, exercising token refresh beyond the API's 15-minute lifetime. |

This profile table describes banking workloads. CPU uses its separate bounded profiles above.

Rates mean **iterations per second**, not requests per second. Default mixed traffic averages 1.4 banking requests per iteration: 10 iterations/second means approximately 14 requests/second, excluding login and preflight traffic. `WRITE_EVERY=1` executes all three requests every iteration. Failed reads or deposits stop that iteration, so observed request volume can be lower.

Load, stress, and soak use arrival-rate executors: they start iterations independently of response time. k6 allocates virtual users to sustain the requested rate. There is no extra sleep in the request loop. Defaults reserve 20 users and allow up to 200. Each profile allows 30 seconds for in-flight iterations to finish.

```sh
# More frequent writes and a shorter constant-load run.
RATE=25 DURATION=2m WRITE_EVERY=1 ./run.sh load

# Smaller stress steps.
STRESS_RATES=5,10,20 RAMP_DURATION=15s HOLD_DURATION=30s ./run.sh stress

# Read-only testing.
WORKLOAD=balance ALLOW_WRITES=false ./run.sh stress

# Adjust the user allocation and latency threshold.
PRE_ALLOCATED_VUS=50 MAX_VUS=300 P95_MS=750 ./run.sh stress
```

## Accounts and database contention

`ACCOUNT_IDS` defaults to Alice's seeded synthetic account, `00000000-0000-0000-0000-000000000001`. Every configured account must exist and belong to the server-selected token subject (normally `alice`); another owner's account returns 404. Setup checks readiness, obtains a token, and validates every account before generating load.

Mutations acquire a PostgreSQL row lock. Testing one account therefore measures contention on that account, as well as API and database capacity. To distribute writes, prepare more synthetic accounts through your existing database provisioning process and supply their UUIDs:

```sh
ACCOUNT_IDS='00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002' ./run.sh stress
```

The example's second account must be provisioned first. Users are assigned accounts by virtual-user ID, so use enough virtual users to cover the supplied IDs. The harness creates unique, contract-valid idempotency keys for each mutation. It does not repeatedly hit a cached operation or retry ambiguous writes. Interrupted requests or external account activity can cause final-balance verification to fail; investigate before starting another mixed run.

## Results

The configured env files enable the built-in k6 web dashboard and automatically open it at `http://127.0.0.1:5665`. The dashboard stays on this computer. Both launchers pass these settings through to k6; `run-cpu.sh` requires an explicit `ENV_FILE` as before.

`K6_WEB_DASHBOARD_EXPORT=report.html` selects a separate HTML report beside each run's JSON summary, under `reports/<profile>-<UTC timestamp>-<suffix>/` (`cpu-<profile>-...` for the separate CPU launcher). Existing reports are preserved. An explicit custom export path is honored; `K6_WEB_DASHBOARD_EXPORT=''` disables HTML export. Explicit dashboard variables override env-file values, so `K6_WEB_DASHBOARD=false` disables the dashboard and `K6_WEB_DASHBOARD_OPEN=false` suppresses automatic browser opening.

Close the dashboard tab after the test to let k6 exit. Very short smoke tests may not produce report graphs; k6 needs more than three dashboard aggregation periods. See the [k6 web dashboard documentation](https://grafana.com/docs/k6/latest/results-output/web-dashboard/).

Each script also writes **`status-report.html`** beside `summary.json` and prints the same response table in the terminal. It shows counts, percentages and requests/sec for HTTP 200, other 2xx, 3xx, 401, 403, 404, 429, other 4xx, 5xx, and network/request errors. The two 429 detail rows distinguish confirmed CPU busy responses from unexpected/other 429s. Only `POST /demo/cpu` responses with status 429 and parsed `code=cpu_demo_busy` count as confirmed busy; a matching body on an account, login or readiness request is still unexpected.

```sh
# Use the exact report path printed at the end of your run.
open "reports/<your-run-directory>/status-report.html"
```

The HTML report links to the built-in `report.html` when it is saved in the same directory. The status report covers **this test's requests only**, including readiness, authentication, workload and final checks. It does not include unrelated ALB traffic or determine whether a response originated in the ALB or application. All table percentages use recorded request attempts as the denominator; 429 detail rows are subsets of the total 429 row. Requests/sec uses the measured window from the first recorded request start to the last completion, including gaps. Missing or zero-length windows show no rate; missing status metrics are called out. HTTP 200 alone does not guarantee a valid response body.

Raw `http_req_failed` now includes CPU busy 429s rather than treating all 429s as HTTP success. For the CPU workload, the existing `cpu_unexpected_error_rate` and `cpu_rejection_rate` thresholds remain the acceptance gates: known busy responses are separate, but malformed bodies, unrelated 429s, authentication failures, network failures, health guards and latency/dropped-iteration failures still fail or abort as before. Always check the process exit status; a passing threshold summary alone does not certify a run that aborted in preflight. Reports contain aggregate metrics, not credentials, response bodies or request URLs.

`run.sh` writes a separate `reports/<profile>-<UTC timestamp>-<suffix>/summary.json` for each run. Reports and local `.env` files are ignored by Git. Console output shows completed iterations, thresholds, and per-endpoint p95/p99 latency. JSON includes the full aggregate metrics. Setup data, JWTs, and account UUID URL tags are excluded from this report. Keep HTTP debug logging disabled when using credentials.

Default pass conditions:

- Each banking endpoint: p95 below 500 ms and HTTP failure rate below 1%.
- Successful, schema-valid workflows: greater than 99%.
- Token request failures: below 1%.
- No dropped iterations.
- Mixed mode: no confirmed deposits left without a confirmed withdrawal; all final balances match their starting values.

Tune `P95_MS` and `ERROR_RATE` to your actual acceptance criteria. Stress testing intentionally seeks overload, so failed thresholds can identify a limit. A successful process exit is required: setup errors and failed thresholds return nonzero. `dropped_iterations` means the requested iteration rate was not achieved; check virtual-user allocation and load-generator resources as well as target latency.

The JSON summary aggregates the whole run. To locate the exact stress stage where degradation begins, correlate timestamps with the project's [Grafana dashboards](../docs/observability/README.md), watching latency, errors, Hikari pool usage, JVM/CPU, ECS tasks, and database load. The test does not automatically send k6 metrics into the project's existing dashboards. Optional timestamped k6 samples can be saved locally:

```sh
set -a
. "$ENV_FILE"
set +a
mkdir -p reports
PROFILE=stress SUMMARY_PATH=reports/stress-summary.json \
  k6 run --out json=reports/stress-samples.json banking.js
```

Direct `k6 run` honors environment variables without loading `.env`. It writes `summary.json` unless `SUMMARY_PATH` is specified. Raw samples can grow large during extended runs.

## Harness verification

Node.js 22+ and k6 are needed only for the harness tests. No npm dependencies are required:

```sh
npm test
# For a k6 binary outside PATH:
K6_BIN=/absolute/path/to/k6 npm test
```

The suite runs real k6 against a local HTTP fixture. It checks configuration rejection, read-only behavior, paired writes, unique keys, token refresh, stress stages, HTTP and response-schema failure thresholds, balance drift, report redaction, and launcher configuration precedence. This verifies the harness; it does not measure the deployed API's capacity.

See Grafana's [arrival-rate executor documentation](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-arrival-rate/) and [custom summary documentation](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/) for the k6 execution and reporting APIs used here.
