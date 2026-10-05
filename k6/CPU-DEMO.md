The CPU demo uses POST /demo/cpu with the app's normal JWT authentication. It performs fixed-size SHA-256 hashing only; it does not read accounts, write a ledger, contact external services, or send messages.

The endpoint accepts workMs from 50 through 500 (default 250), with a monotonic wall-clock deadline and at most 5,000,000 hashes. Each task permits one job, no queued jobs, and a 100 ms gap after completion/cancellation. Busy requests receive HTTP 429 and Retry-After: 1. The wall-clock limit includes scheduling delay; deadline/cancellation checks occur between batches of 256 hashes, so scheduling and a final batch can add small overshoot. The response includes elapsedMs, cpuMs, iterations, checksum and stopReason. CPU time can be lower than wall time because of CPU scheduling and contention. Unsupported thread CPU accounting reports zero.

To use the scripts, keep existing token credentials in your trusted project `.env` or private env file and select the live HTTPS origin. Set `WORKLOAD=cpu` in the project `.env` to use the normal launcher. No account IDs or write opt-in are needed. Do not use HTTP debug logging, which can expose authentication headers.

```sh
cd /Users/tzwei/workdir/assignment/k6
CPU_WORK_MS=50 ENV_FILE=.env ./run.sh smoke
```

This smoke command issues readiness/authentication checks, ONE 50 ms CPU request, and a final readiness check. The project `.env` configures 500 ms for the sustained demo; the explicit smoke override keeps this check small.

For the configured sustained demo, run:

```sh
ENV_FILE=.env ./run.sh stress
```

Load defaults to 4 CPU requests/second, 500 ms work, at most 8 total VUs (7 CPU workers plus 1 readiness monitor), and 300 seconds, with up to 2 seconds to finish in-flight work. Readiness adds at most one request each 10 seconds per monitor plus setup/teardown. Lower values are supported through CPU_RATE, CPU_WORK_MS, CPU_MAX_VUS and CPU_DURATION_SECONDS; values beyond the ceilings fail before HTTP. The normal launcher's `stress` and `load` both select this CPU load profile; CPU `soak` is unsupported. The separate `run-cpu.sh` remains available with explicit `ENV_FILE` and smoke/load arguments. No automatic escalation of load is provided.

Stop with Ctrl-C for unhealthy ALB targets or degraded normal app latency. The script aborts on readiness errors or readiness over 1 second, unexpected CPU responses, sustained unexpected errors of 1% or more, rejection rate of 50% or more, or CPU endpoint p95 of 1.5 seconds or more (rate/percentile thresholds begin evaluation after 15 seconds). Confirmed `cpu_demo_busy` 429 responses have their own counters/rate and are excluded from the CPU unexpected-error metric. Raw `http_req_failed` includes all 429s. Other 429s, malformed bodies, or busy-code responses from another endpoint remain unexpected. Dropped arrivals fail the final threshold; they indicate the requested rate was not fully delivered.

Watch AWS/ECS CPUUtilization and MemoryUtilization for ClusterName=banking-dev and ServiceName=banking-dev, plus desired/running/pending tasks, ALB healthy targets and normal readiness/latency. The target is a SERVICE average, including Alloy. The existing high alarm needs three 60-second periods above 60%; scale-in uses fifteen periods below 54% and can take longer than this test. Grafana's default window/refresh can lag the latest CloudWatch samples. Memory target tracking is also enabled at 70%, with a three-minute high alarm and a fifteen-minute low alarm below 63%. Either CPU or memory can request scale-out; both policies must agree before scale-in. Retained JVM heap may delay scale-in. Request count, latency or DB waiting alone do not trigger these policies. This initial workload is a calibration starting point, not a guarantee of reaching 60%.

The approved task profile is 0.5 vCPU / 2 GiB (Java 1536 MiB, Alloy 512 MiB). Scaling remains capped at 2–4 tasks, but two added tasks can cost approximately $53.06 for 730 hours before other AWS costs; deployments can temporarily run more tasks. CPU is shared with normal requests, even with a separate executor and recovery gap. A live sustained run requires separate approval; adding the endpoint does not execute it.

Run all harness tests with `npm test`, including CPU configuration and launcher runtime tests against a local HTTP fixture. `k6 inspect -e BASE_URL=https://example.test cpu-demo.js` checks the script without making HTTP requests. Per-run JSON reports omit setup data and JWTs.

The terminal and per-run `status-report.html` show HTTP status counts, percentages and requests/sec, including confirmed CPU busy 429s separately from unexpected/other 429s. The report covers this k6 run only, including authentication and health checks; it does not contain all ALB traffic. See [report definitions and how to open it](README.md#results).
