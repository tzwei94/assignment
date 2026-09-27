# Banking API architecture

## Overview

AWS hosts the API, RDS, EC2 runner and private ECR repositories. Grafana/Prometheus/Loki/Tempo and homelab Alloy belong to the monitoring platform, with authenticated Cloudflare endpoints consumed by AWS clients and authorized users. AWS deployment owns the separate Fargate and runner Alloy configurations.

**Scope:** This document describes the checked-in implementation. Live health, credentials and AWS resource state must be verified separately using the [verification guide](verification.md). Operators supply and validate ECR images and external telemetry, DNS and TLS services. Use synthetic data and review the [AWS account compatibility and budget](budget.md) before applying Terraform.

[Open the interactive architecture](architecture/banking-platform.html). It represents the implemented logical architecture, including the monitoring operator ownership and task-local collection for all three telemetry signals; it is not a deployment-status view. The network table defines subnet placement. ECR, Secrets Manager and CloudWatch are regional services, not VPC instances. Arrows show caller/request direction: Fargate pulls toward Amazon ECR, and image bytes return in the response. Terraform control-plane calls, NAT, state and administration are described here.

## Components and network placement

| Component | Configured placement | Purpose and decision |
|---|---|---|
| GitHub | External hosted service | Separate repositories: `app` for Java/build/publish and `deployment` for Terraform/deployment. Example Terraform profiles use placeholder repository names; override them to match the actual repositories. |
| Application Load Balancer | Public subnet in each of two AZs | HTTPS entry point with ACM certificate; port 80 redirects to HTTPS if enabled. Target type `ip`. |
| Banking API | Private application subnets, two AZs | Two Java Fargate tasks with AZ spreading, no public IPs; one Alloy sidecar per task for logs, metrics and traces. Start at 0.5 vCPU / 1 GiB each, including the JVM and Alloy in the resource budget. |
| RDS PostgreSQL | Isolated DB subnet group spanning two AZs | Budget-first single-AZ `db.t4g.micro`, private endpoint, encrypted storage and backups. Multi-AZ primary/standby is a separately costed upgrade. |
| GitHub Actions runner | Private application subnet, separate runner SG | Publishes the image built on GitHub-hosted runners and runs Terraform releases. Default 2 vCPU / 4 GiB; the example selects 2 vCPU / 2 GiB. Stop outside publication/deployment windows. Repo-specific OIDC roles; minimal instance role. |
| Amazon ECR | AWS regional service | Terraform-managed API and Alloy repositories; immutable tags, encrypted storage and IAM-authenticated push/pull. |
| NAT gateway | One public subnet for budget-first demo | Outbound GitHub, package, certificate and AWS API access; shared by both AZs. Two NAT gateways are an upgrade, not this baseline. |
| Observability | External monitoring platform | Supplies authenticated Prometheus/Loki/Tempo ingestion and protected Grafana access. AWS owns its collectors and integration checks. |
| Cloudflare | Public edge and an operator-managed connector | Endpoint, tunnel and access-policy ownership belongs to the monitoring platform. AWS clients use the verified service contract. |
| Secrets Manager / KMS | Regional AWS services | Separate database, telemetry and authentication secrets; scoped access and encryption. ECR uses IAM. |
| S3 | Regional AWS service | Separate restricted buckets for Terraform state/release manifests and ALB access logs. RDS uses automated backups and final snapshots; backup-export storage is not provisioned. No public access. |
| CloudWatch / SNS | Regional AWS services | AWS metrics/alarms and confirmed notifications; seven-day task console logs. Application console logging is WARN and above; it is not a complete backup of the INFO-level file logs sent to Loki. |

Use one VPC and separate route tables for public, private application/tooling, and isolated database tiers. The runner occupies one AZ; security groups isolate it from application/database services. Database routes have no default internet/NAT route. Optional interface endpoints can replace NAT for specific AWS APIs after comparing costs; GitHub and Cloudflare still require Internet egress.

Fargate uses `awsvpc`, so ALB targets must be `ip`. [AWS load balancer configuration](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_LoadBalancer.html).

## Traffic and access controls

| Source | Destination | Allowed connection |
|---|---|---|
| API clients | ALB SG | TCP 443; optional TCP 80 redirect |
| ALB SG | API task SG | TCP 8080, HTTP target traffic and health checks |
| API task SG | Banking RDS SG | TCP 5432 with certificate-verified PostgreSQL TLS |
| Fargate / EC2 runner | Regional ECR API, Docker registry and image layers | HTTPS through the existing NAT; execution-role pull and OIDC build-role push permissions. |
| Fargate / runner collectors | Cloudflare telemetry hostname | HTTPS through NAT and Internet; authenticated ingestion APIs only |
| Monitoring tunnel connector | Cloudflare edge / origin services | Outbound encrypted tunnel; actual origin TLS boundary recorded in operator handoff |
| Authorized user | Operator-provided Grafana endpoint | HTTPS and Grafana authorization; see the [viewer guide](observability/README.md) for the recorded review environment |
| Runner | GitHub / package services | Outbound HTTPS through NAT; no inbound GitHub webhook port |
| EC2 / task roles | Authorized AWS services | HTTPS through NAT or chosen endpoints; least-privilege IAM |
| Authorized operator | EC2 administration | Systems Manager Session Manager; no public SSH or bastion |

Use SG-to-SG rules within AWS. Deny direct runner access to banking RDS; use isolated ECS migration tasks. The external-service contract requires private database/raw monitoring administration and authenticated published endpoints. Cluster administration and network controls belong to the monitoring operator; the AWS runner receives no cluster-admin/Proxmox credentials.

Client → ALB uses a publicly trusted certificate. ALB → task uses HTTP on port 8080 within private application subnets, restricted by security groups to traffic from the ALB. This hop is not encrypted. PostgreSQL clients use `sslmode=verify-full`, the current RDS CA bundle and enforced TLS. [ALB target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html), [RDS PostgreSQL TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html).

For the demonstration, use pre-provisioned test identities with JWT validation and per-account authorization; use the implemented RSA signing-key-derived public-key, issuer and audience validation. The issuer/test-token setup must be documented and must never permit a caller to choose an arbitrary account without authorization. Identity-provider expansion is outside the core demo.

The API issues 15-minute RS256 tokens at `POST /auth/token` using Basic credentials configured through `TOKEN_USERNAME` and `TOKEN_PASSWORD`. The server selects `TOKEN_SUBJECT` (default `alice`); banking routes accept Bearer tokens only. A shared `JWT_PRIVATE_KEY` from Secrets Manager keeps tokens valid across replicas and restarts. Public clients obtain tokens over HTTPS; local clients use loopback HTTP.

## Amazon ECR and Fargate integration

The dev Terraform root creates private `${name}/banking-api` and `${name}/banking-alloy` repositories. Tags are immutable, storage uses AES256 encryption, and basic scanning runs on push. Trivy remains the publication gate. Only untagged images expire after seven days; retain tagged images needed by release and rollback manifests.

The trusted application publisher assumes its GitHub OIDC build role and uses `aws ecr get-login-password` with Docker username `AWS`. Layer upload and push permissions are scoped to the application repository. Operator credentials publish Alloy. The deployment role has pull access and ECR metadata reads for Terraform refresh.

Fargate pulls directly from ECR through its task execution role; task definitions carry no external registry credentials. Application tasks can pull API and Alloy images; migration/bootstrap execution roles can pull only the API image. Secret injection retains separate DB, telemetry and authentication permissions. Restart tasks after injected-secret changes. [AWS task execution role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html).

Use `123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/banking-dev/banking-api@sha256:<digest>` (and `banking-alloy` for the collector). Private tasks use the existing NAT route to ECR and its image-layer storage. No registry traffic traverses Cloudflare or the homelab. ECR API/Docker interface endpoints plus an S3 gateway endpoint are a separately costed alternative, not provisioned here. Validate real image push/pull and a fresh Fargate task before claiming live integration. [Fargate networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html).

For existing installations, apply the operator infrastructure migration before releasing new ECR digests. Keep old registry credentials and images available while old task revisions remain rollback targets. See [migration and retention](../deployment/README.md#registry-migration-and-retention).

## Terraform and delivery ownership

This project contains `app/`, `deployment/` and shared documentation. AWS Terraform lives in `deployment/infra/bootstrap`, `deployment/infra/modules` and `deployment/infra/environments/dev`. External service implementation, state and lifecycle are managed separately. The illustrated Kubernetes/Argo CD setup is one possible service host; operators may supply another compatible deployment. The AWS pipeline consumes endpoints and scoped credentials without administering the external cluster.

The operator bootstraps the backend and GitHub OIDC, then applies the single dev root before using the EC2 runner. App workflows test Java, build/scan once, push to ECR with a source-SHA/run/attempt tag and record the immutable digest. Initially, the operator supplies digest and source SHA to the deployment repo's `workflow_dispatch`, which verifies the handoff and applies Terraform. No cross-repository token is required; a narrowly scoped GitHub App trigger can be added later. One dev Terraform state owns infrastructure, task definitions and the service; backend/OIDC setup retain independent bootstrap states. The release engine rejects saved plans with non-ECS changes. No independent `UpdateService` deployment competes with Terraform.

The release process registers candidate task definitions without moving the active service, runs one migration task to completion, and then promotes the candidate through Terraform. Keep the previous working release identity and image for rollback. The [deployment guide](../deployment/README.md) defines the migration and promotion contract for the single dev root.

Use S3 versioning, encryption, restricted IAM and `use_lockfile = true` for state locking. Protect both state and saved plan files because they can contain sensitive data. Supply secret values through a controlled bootstrap/rotation procedure, not plaintext Terraform variables or EC2 user data. [Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3).

GitHub OIDC provides short-lived AWS credentials. Only the deployment repository/environment can assume deployment roles; the app repository's build role can authenticate to ECR and push only to its application repository. Match actual subjects/audiences, including immutable IDs where applicable, and keep operator infrastructure-write privileges separate from the release role's refresh reads and ECS writes. [GitHub OIDC with AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

Share the EC2 host through an organization runner group restricted to both repositories. For a personal account, register two services, one per repository, with separate users and temporary work/credential directories. A host-wide lock serializes the application publisher script and deployment release script. Checkout, artifact download and AWS authentication outside those scripts are not covered by that lock. This shares a trusted host, not a security boundary between repositories.

Only trusted main-branch/manual jobs use it. Untrusted PR code runs on isolated GitHub-hosted runners without AWS deployment credentials/private access; avoid checking out untrusted code in `pull_request_target`. Do not give the app workflow the deployment AWS role merely because it shares an EC2 host. [GitHub self-hosted runner security](https://docs.github.com/en/enterprise-cloud%40latest/actions/reference/security/secure-use).

## Reliability, monitoring and cost

The ECS service enables rolling deployment health checks and circuit-breaker rollback, with a fixed desired count of two. Autoscaling is not provisioned; add it only after measuring CPU/load and defining limits. Database pool limits must account for the maximum task count. Automated rollback needs an earlier successful deployment and does not reverse a database migration; first deployment failures require repair and retry. [ECS circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html).

Use structured API logs without tokens or sensitive banking data. ALB logs remain in S3 and AWS metrics/alarms in CloudWatch. Route application logs to homelab Loki with bounded retry/buffering and a documented fallback, avoiding duplicate ingestion. The six provisioned alarms cover ALB target 5xx errors, fewer than two healthy targets, ECS CPU, ECS memory, RDS free storage and EC2 status. Latency, failed deployments, registry/tunnel availability and runner disk require additional monitoring. Demonstrate one alarm notification.

Obtain monitoring readiness, retention and recovery evidence from the monitoring operator. Start AWS application scrapes at 60 seconds and coordinate retention with that project. Avoid request/account IDs in metric or Loki stream labels; measure ingestion volume and storage growth.

Homelab collectors cannot read Fargate's host/Docker socket. Runner-local Alloy can collect EC2 host metrics after its separate installer and credentials are configured; runner provisioning does not install it automatically. Each Fargate task has **one Alloy sidecar with three pipelines**; the Java application must supply each signal explicitly:

| Signal | Application instrumentation and task-local collection | Requested authenticated HTTPS destination |
|---|---|---|
| Logs | Logback writes newline-delimited JSON to rotating files on a shared ephemeral task volume; Alloy `loki.source.file` reads the files and `loki.write` forwards them. | `https://logs-ingest.example.com/loki/api/v1/push` → Loki |
| Metrics | Spring Boot Actuator with Micrometer's Prometheus registry exposes `/actuator/prometheus` on a task-local management listener; Alloy scrapes it and uses Prometheus remote write. | `https://metrics-ingest.example.com/api/v1/write` → Prometheus |
| Traces | The OpenTelemetry Spring Boot starter sends OTLP/HTTP to Alloy's loopback receiver, for example `http://127.0.0.1:4318/v1/traces`; Alloy batches/exports the traces. | `https://traces-ingest.example.com/v1/traces` → Tempo |

These are the implemented integration contracts with example destinations, not a live health report. Actuator, structured Logback and the OpenTelemetry Spring Boot starter are implemented; the local smoke test checks delivery of all three signals to a test receiver and trace/span log correlation. It does not validate ingestion by real Prometheus, Loki or Tempo services. The selected shared-file path requires no FireLens container. Mount application logs read-only in Alloy, keep its positions/queue storage writable separately, and configure bounded size/time rotation, total disk usage, retry queues and shutdown flushing. Ephemeral task storage cannot guarantee retention after task termination or a prolonged outage. Validate rotation, replacement and gateway-outage behavior. [Alloy file collection](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.file/), [Spring Boot metrics](https://docs.spring.io/spring-boot/reference/actuator/metrics.html)

Keep management and OTLP listeners inside the task; do not expose them through the ALB or task security group. Give metric series a unique per-task `instance` value so the two local scrape targets cannot collide. Keep trace/span IDs as JSON log fields for correlation, never Loki stream labels. Exclude account/request IDs and amounts from labels; keep tokens and financial payloads out of telemetry. With file-based logs and Actuator metrics, explicitly set the starter's `otel.logs.exporter=none` and `otel.metrics.exporter=none` settings in `application.yml` to avoid duplicate export paths; retain trace export and test trace-context injection into Logback. [OpenTelemetry starter configuration](https://opentelemetry.io/docs/zero-code/java/spring-boot-starter/sdk-configuration/), [Alloy remote write](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.remote_write/)

Telemetry endpoints expose only authenticated ingestion APIs through their tunnel/gateway, using native proxy credentials and HTTPS. Generic browser Access is unsuitable for machine ingestion; Access Service Auth requires verified client support. Keep raw Prometheus/Loki/Tempo query/admin endpoints private. Grafana access policy is configured externally. The recorded review environment uses a separate Grafana viewer organization; do not assume an additional Cloudflare Access policy is installed. Demonstrate a Java dashboard, redacted log query and unauthorized-ingestion rejection.

The monitoring operator owns the Tempo service and Grafana's internal Tempo data source. The requested trace gateway accepts authenticated OTLP/HTTP `POST /v1/traces`; query/admin routes remain private. The repository now includes [overview, logs and service graph dashboards](observability/README.md) and a [dated viewer-access verification record](observability/viewer-access.md#verification). These records do not establish current endpoint health. The example ingestion hostnames above must be replaced with operator-provided endpoints.

The app spans two AZs, but single-AZ RDS, one NAT, one runner and the homelab remain failure points. ECR or NAT unavailability can prevent deployments/replacement tasks. Homelab power, Internet or tunnel failures interrupt telemetry but no longer block image pulls. Existing tasks may continue; this is not full-system HA. Test RDS recovery and retain ECR release digests for rollback.

Follow [the AWS budget](budget.md), stop the runner outside build windows and review NAT/Internet traffic daily. External monitoring has its own hosting costs; ECR storage and image transfer belong to the AWS budget. AWS teardown never removes external monitoring services, data, tunnels or state; their lifecycle and cleanup remain with that project.

## Deployment acceptance

| Evaluation area | Evidence to retain for each deployment |
|---|---|
| Infrastructure and application correctness | ALB URL, healthy tasks, persisted balance/deposit/withdrawal tests, concurrent-withdrawal test |
| IaC and pipeline quality | Repeatable Terraform plans, successful trusted workflow, immutable image digest and rollback |
| Security | SG/IAM review, TLS checks, secrets handling, unauthorized-account denial |
| Monitoring, logging and tracing | Dashboard, redacted logs, a Java trace retrieved in Grafana, exercised alarm and notification |
| Documentation | Architecture, this design, setup/verification/rollback/teardown guide and source URLs |

The API supports balance queries, deposits and withdrawals on seeded accounts. Account creation and deletion are outside its scope.

## Reusable telemetry runtime

Each application task runs Java and Alloy directly as non-root containers. Their Dockerfiles prepare matching `/var/log/app` volume ownership; Java writes logs and Alloy reads them. Alloy bundles a generic pipeline with environment overrides and supports a mounted replacement configuration. Database trust is packaged in the Java image at `/opt/app/certs/rds-ca.pem`, so administrative database tasks run without an Alloy dependency. See the [telemetry image contract](../deployment/deploy/monitoring/README.md).
