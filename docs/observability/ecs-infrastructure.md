# ECS infrastructure dashboard

[Open the shared dashboard](https://grafana.tzwei.me/d/banking-ecs-infrastructure?orgId=2) using the existing `banking-viewer` login. The dashboard is also linked from the application overview. It is authenticated viewer sharing, not anonymous public access.

## Metrics

The [dashboard export](banking-ecs-infrastructure.json) queries the built-in CloudWatch data source, UID `banking-cloudwatch`, in both Main Org. and Banking API Review. It contains four current-value panels, six time-series panels, and an explanatory text panel.

| Signal | Namespace / metric | Statistic |
|---|---|---|
| Service CPU and memory | `AWS/ECS`: `CPUUtilization`, `MemoryUtilization` | Average and maximum |
| Target health | `AWS/ApplicationELB`: `HealthyHostCount`, `UnHealthyHostCount` | Minimum healthy, maximum unhealthy |
| Request volume | `AWS/ApplicationELB`: `RequestCount` | Sum per minute |
| Target response time | `AWS/ApplicationELB`: `TargetResponseTime` | Average and p95 |
| Target HTTP errors | `AWS/ApplicationELB`: `HTTPCode_Target_4XX_Count`, `HTTPCode_Target_5XX_Count` | Sum per minute |
| ALB HTTP errors | `AWS/ApplicationELB`: `HTTPCode_ELB_4XX_Count`, `HTTPCode_ELB_5XX_Count` | Sum per minute |

Queries use exact dimensions to avoid double-counting availability-zone series. ECS uses `ClusterName` and `ServiceName`. Target health, target response time, and target errors use `LoadBalancer` and `TargetGroup`; request volume and ALB-generated errors use `LoadBalancer` alone. Queries contain the deployed resource identifiers directly; update their dimensions if the ALB or target group is replaced. Query filters are not an authorization boundary.

CPU/memory percentages describe the ECS service's allocated resources, including the Alloy sidecar. ALB healthy targets do not represent ECS desired or running task counts. The healthy-target threshold of two matches this deployment's expected capacity. CloudWatch statistics use fixed 60-second buckets; request/error panels show counts per minute, not per second. The default window ends two minutes ago and refreshes every five minutes. Latest stats are the latest reported samples within the selected window, not a real-time control-plane status check.

Low traffic produces sparse latency data. AWS may omit error series when no events occur; empty series and missing samples remain absent rather than being replaced by zero. Container Insights is disabled in the cluster and Terraform, so this dashboard does not promise per-task CPU, memory, network, or storage breakdowns. No ECS deployment change is required.

## CloudWatch connection

The dedicated IAM user `banking-grafana-metrics` has the inline policy [ReadSingaporeMetrics](cloudwatch-metrics-policy.json), granting only `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData` in `ap-southeast-1`. There is no console login, AWS mutation permission, or CloudWatch Logs permission. These metric APIs use `Resource: "*"`; regional access is not limited to the Banking API's resources. Grafana OSS viewers can query the data source beyond the dashboard filters.

The external homelab Grafana uses the access/secret-key authentication provider. Its dedicated credential is stored in Grafana's encrypted data-source settings and in the operator's private credential directory, never in dashboard JSON or source control. The source uses `authType: keys` and `defaultRegion: ap-southeast-1`; its secure fields are `accessKey` and `secretKey`. See [Grafana's CloudWatch configuration and permissions reference](https://grafana.com/docs/grafana/latest/datasources/aws-cloudwatch/configure/).

The IAM user and Grafana data sources were configured operationally, outside the application's Terraform state. Preserve the Grafana database and its encryption configuration. For a new installation, create a dedicated metrics identity with the checked-in policy, configure this data-source UID in both organizations, and import the dashboard. Do not put credentials into the export. CloudWatch API reads can incur charges; the five-minute refresh avoids polling every minute.

To rotate the key, create a replacement for the dedicated user, update the private record and both Grafana data sources, verify dashboard queries as `banking-viewer`, then deactivate and delete the old key. To remove the integration, remove both data-source/dashboard copies and revoke the dedicated key and IAM user after checking for other consumers.

## Verification

On 2026-09-27, the live ECS service had two desired and two running tasks, with Container Insights disabled. Both dashboard copies were saved successfully. All 17 panel queries returned successful responses using the viewer account. CPU, memory, target health, request count, latency, and 4xx data had samples in the six-hour window. Target and ALB 5xx queries succeeded with no samples. The latest verified target counts were two healthy and zero unhealthy.

The viewer could list the four approved dashboards and read this dashboard with editing, saving, and administration disabled. An attempted save of the unchanged dashboard returned HTTP 403. Browser login and rendering were verified using the viewer account: CPU, memory, target health, request volume, response time, and available error series displayed successfully. Existing unrelated dashboards remain in Main Org.; this addition did not change the viewer's organization membership.
