# AWS credit-account compatibility and budget

Reviewed 26 September 2026 for the Terraform in `deployment/infra`, using Singapore (`ap-southeast-1`). **The default configuration cannot be certified as fully deployable on the AWS Free plan.** There is a documented EC2 size mismatch, account-specific service access/quotas are unverified, and image publication plus external endpoints still require setup. No AWS account was queried and no resources were deployed.

## Free plan versus credits

New eligible customers receive $100 at sign-up and can earn another $100; do not assume a $200 balance already exists. The Free plan ends after six months or when credits run out, whichever comes first. A Paid plan offers broader access and can retain eligible unexpired credits, but charges beyond credits are payable. Joining an AWS Organization or using Control Tower changes credit eligibility. Check your actual plan, credit balance, expiry and applicable services in Billing before provisioning. [AWS Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/).

## Component review

| Terraform component | Assessment and prerequisites |
|---|---|
| EC2 runner + 30 GiB gp3 EBS | Default `t3.medium` is absent from the published Free-plan list. The example profile now explicitly uses listed `t3.small` with an Amazon Linux 2023 x86_64 AMI. It has 2 GiB rather than 4 GiB: Java builds and image scans need capacity testing; do not assume performance equivalence. Check the account's EC2/EBS limits. |
| RDS PostgreSQL 17, `db.t4g.micro`, Single-AZ, 20–30 GiB gp3 | PostgreSQL micro instances are explicitly listed for the Free plan. Confirm PostgreSQL 17/class/storage orderability in the target region and account restrictions on storage/backup settings. Encryption and the RDS-managed master secret also require KMS/Secrets Manager access. |
| Public ALB, two subnets, HTTPS listener | ALB is explicitly listed for both plans. Supply a validated ACM certificate in this region and your own DNS name; neither is created by this Terraform. Public IPv4 and LCU usage add cost. |
| ECS cluster, two Fargate tasks, migration/bootstrap tasks | Each task uses 0.5 vCPU and 1 GiB. Credit affordability does not establish Free-plan Fargate access. Confirm that access and the On-Demand vCPU quota before applying. Two steady tasks use 1 vCPU; 200% deployment capacity uses 2 vCPU, plus 0.5 per concurrent migration/bootstrap task. |
| VPC, six subnets, routes, security groups, one NAT gateway and EIP | Standard regional resources; confirm NAT/EIP access and quotas on this account. NAT hourly/data-processing, public IPv4, cross-AZ and Internet transfer are billable. Both application AZs share one NAT, so this is not a fully redundant network. |
| IAM roles, policies, instance profile and GitHub OIDC | Require operator IAM permissions and account trust setup. No standalone IAM resource charge. Import an existing GitHub OIDC provider rather than duplicating it. |
| S3 state/log buckets and customer-managed KMS key | Require bucket/key permissions, unique bucket names and service availability. Storage, requests, versions and KMS usage can cost money. State bootstrap is independent and protected from ordinary teardown. |
| ECR | Two private repositories managed by Terraform. Budget for retained image storage, image transfer and NAT processing. Basic scan-on-push is configured; enhanced Inspector scanning is not enabled. Tagged release images require deliberate retention cleanup. Verify account access before apply. |
| Secrets Manager | Five runtime secrets and the RDS-managed master secret; values must be populated privately. Confirm account access, then budget for secret storage/API calls. |
| CloudWatch logs + six alarms, SNS email, Budgets | Confirm service access and email subscription. Seven-day log retention bounds retention, not ingestion cost. The existing account-wide $100 monthly budget alerts at $50 actual and $80 forecast; it is not a hard cap or a remaining-credit monitor. |
| External telemetry and DNS | Not provisioned by this Terraform and not paid for by AWS credits. Replace all example endpoints, publish tested immutable images and configure native machine authentication. Alloy must pass the publication scan before deployment. |

AWS sources: [eligible EC2 sizes and ALB](https://aws.amazon.com/free/compute/), [RDS Free plan](https://aws.amazon.com/rds/free/), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), [Fargate pricing](https://aws.amazon.com/fargate/pricing/), [VPC pricing](https://aws.amazon.com/vpc/pricing/). Items marked for confirmation are unresolved account checks, not a claim that the service is excluded.

## One-week planning estimate

Assume 168 hours, two continuously running Linux/x86 Fargate tasks, low traffic, Single-AZ RDS, one NAT and a runner stopped outside 30 build hours. No legacy 750-hour allowance or credit discount is subtracted from the gross spend estimate.

| Item | Basis | Approximate USD/week |
|---|---|---:|
| Runner | `t3.small`, $0.0264/h × 30h | 0.79 |
| Fargate | Two × (0.5 vCPU × $0.05056 + 1 GiB × $0.00553) × 168h | 10.35 |
| RDS compute | `db.t4g.micro`, $0.025/h × 168h | 4.20 |
| ALB | Base and low LCU allowance | 6.00 |
| NAT | Hourly plus low processing allowance | 15.00 |
| Public IPv4 | Two ALB addresses + one NAT address × $0.005/h × 168h | 2.52 |
| EBS, RDS storage/backups | Small-volume allowance | 2.00 |
| ECR, S3, KMS, secrets, monitoring and transfer | Low-usage allowance (recheck ECR storage/transfer) | 5.00 |
| **Worked estimate** | Rounded planning allocation | **45.86** |

Reserve **$50–65 for a week** including short migration/rollout tasks and uncertainty. This makes a short demo plausible within an actual $200 eligible balance; it is not evidence that every service accepts the Free plan. At the worked rate, 30 days is about $197 before contingency and an always-on runner adds roughly $15/month versus the 30-hours/week assumption. Do not expect $200 to run this unchanged for months. High traffic, image pulls, scans, burst CPU credits and log volume can exceed these allowances.

The EC2, Fargate, RDS and ALB rates were retrieved on 26 September 2026. The runner rate comes from the [AWS Singapore EC2 feed](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/Asia%20Pacific%20%28Singapore%29/Linux/index.json). Reprice with the regional [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-southeast-1/index.json), [RDS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-southeast-1/index.json) and [ELB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-southeast-1/index.json) feeds and an AWS Calculator estimate before applying. Allowance rows are estimates, not exact AWS quotes. Taxes, domains and externally hosted services are excluded.

## Before applying

1. Confirm actual credit balance, expiry, plan and allowed services in Billing. Do not upgrade the plan just to discover eligibility unless you accept paid overage exposure.
2. Verify the operator identity and regional EC2/RDS offerings, Fargate quota, NAT/EIP limits and ACM certificate. Use `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true --region ap-southeast-1` and `aws rds describe-orderable-db-instance-options --engine postgres --db-instance-class db.t4g.micro --region ap-southeast-1` as read-only starting checks; neither proves all service access.
3. Copy and fill the example profile, including its explicit runner size, backend, digests, endpoints and source SHA. Keep secret values out of Terraform. A successful plan does not guarantee apply-time account eligibility.
4. Pass the collector publication scan; validate registry pulls, telemetry gateways and the build runner's memory needs.
5. Inspect an authenticated plan and schedule cleanup after a short demo. Initial `service_enabled=false` still creates billable ALB/NAT/RDS/runner infrastructure.

Stop the runner between sessions; the runner cannot start itself while stopped. Review costs daily. Disable deletion protection deliberately for teardown, retain only necessary snapshots, and check residual S3 versions, snapshots, EBS, EIPs and KMS afterward. Stopping EC2 alone does not stop the rest of the bill. Backend/OIDC resources and external services have separate lifecycles.
