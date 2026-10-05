# Verification

Run these checks from the main repository root. See the [quickstart](../QUICKSTART.md#run-the-checks) for prerequisites.

| Command | Coverage |
|---|---|
| `make verify` | Java checks and PostgreSQL tests, API schema, release policy, Terraform formatting/validation/mock tests, deployment scripts and Alloy configuration |
| `make smoke` | Build both images; test API operations, migration/rollback commands, API restart, telemetry delivery to the test receiver and receiver restart; remove the test stack afterward |
| `uv run deployment/deploy/tests/check_alloy_runtime.py` | Reuse the Alloy image with another service and a mounted configuration |
| `bash deployment/deploy/tests/test-container-volumes.sh` | Non-root volume access, both log-volume initialization orders, database CA access and existing-volume preservation |

The last two commands require local `banking-api:local` and `banking-alloy:local` images, built by `make smoke`. The production Dockerfile also needs a packaged JAR; see the [application build instructions](../app/README.md#runtime-and-delivery).

Repository-specific instructions:

- [Application tests](../app/docs/local-verification.md)
- [Infrastructure and deployment tests](../deployment/docs/local-verification.md)
- [Alloy image scan record](../deployment/deploy/monitoring/security-review.md)

The smoke sequence returns the balance to its starting value before restarting the API. It checks continuity after restart, but does not prove persistence of a nonzero balance change. Receiver request counts confirm local delivery, not backend parsing, durable buffering or loss-free outage recovery.

For documentation-only edits, check local links/anchors, fenced command syntax and referenced options against the scripts. Record those checks separately from `make verify`, `make smoke` and live deployment validation.

## Deployment checks

Local tests use disposable PostgreSQL, mocked AWS resources and a telemetry receiver. Before relying on an AWS deployment, verify:

1. Terraform plans, state locking, OIDC roles, private routing and SSM access in the target account.
2. ECR publication and fresh Fargate image pulls for the release digests.
3. Public HTTPS, two healthy tasks, RDS certificate/hostname verification and database-user permissions.
4. A deployment, failed migration and application rollback. Rollback does not reverse database migrations.
5. Logs, per-task metrics and traces in the remote monitoring backend; test credential rotation, an ingestion outage and task replacement.
6. SNS delivery, an RDS restore, teardown and remaining billable resources.

Record the commit, image digests, platform and results for each run. A local test or an earlier image scan does not establish the status of a later deployment.
