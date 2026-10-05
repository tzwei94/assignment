# Grafana viewer access

The `banking-viewer` account has read-only access to the four prepared Banking API dashboards in **Banking API Review** (organization ID `2`). It is not a member of **Main Org.** and is not a Grafana server administrator.

## Sign in

- URL: [Grafana login](https://grafana.tzwei.me/login)
- Username: `banking-viewer`
- Password: obtain it privately from the environment owner. Do not commit it to documentation or dashboard exports.
- Organization: **Banking API Review**

| Dashboard | Link | Repository definition |
|---|---|---|
| Banking API · Overview | [Open overview](https://grafana.tzwei.me/d/banking-api-overview?orgId=2) | [JSON](banking-api-dashboard.json) |
| Banking API · Log Search | [Open log search](https://grafana.tzwei.me/d/banking-api-logs?orgId=2) | [JSON](banking-api-logs.json) |
| Banking API · Service Graph | [Open service graph](https://grafana.tzwei.me/d/banking-api-service-graph?orgId=2) | [JSON](banking-api-service-graph.json) |
| Banking API · ECS Infrastructure | [Open ECS infrastructure](https://grafana.tzwei.me/d/banking-ecs-infrastructure?orgId=2) | [JSON](banking-ecs-infrastructure.json) |

The overview is the organization home dashboard. The viewer can change time ranges and filters, inspect panels, and read results. It cannot save, edit, delete, or administer dashboards, create folders, manage users, or switch into Main Org. Kubernetes, node, CoreDNS, Grafana, and Prometheus infrastructure dashboards remain in Main Org.

## Access configuration

The account has the `Viewer` organization role. Each approved dashboard also grants user ID `2` explicit **View** permission (`permission: 1`); the organization Admin role has **Admin** permission (`permission: 4`). No Edit or Admin permission is assigned to the viewer. The separate organization contains only these dashboard copies, with Prometheus, Loki, Tempo, and CloudWatch data sources using the same UIDs as the source dashboards.

This is dashboard isolation, not telemetry-data isolation: Grafana OSS viewers can query data sources available in their organization, including data beyond a dashboard's filters. The shared telemetry backends are not tenant-filtered for this account. See [Grafana roles and permissions](https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/).

The CloudWatch connection permits metric listing and reads in `ap-southeast-1` across the AWS account. Its dashboard filters do not restrict which regional metrics a viewer can query. It grants no CloudWatch Logs access or AWS write permissions. See [connection details](ecs-infrastructure.md).

## Maintaining access

These are live Grafana database settings, not Terraform or Helm-managed user provisioning. Preserve the Grafana database/PVC and backups.

When updating dashboards, sign in as an administrator, select **Banking API Review**, and import the matching JSON above with its existing UID and overwrite enabled. Apply the same update to Main Org. if both copies should match. Changes to one organization do not automatically update the other. Keep the explicit per-dashboard View grant, and verify the resulting view as `banking-viewer`. Do not import unrelated dashboards or add this user to Main Org.

The data source UIDs are `prometheus`, `loki`, `tempo`, and `banking-cloudwatch`. Keep their settings aligned with the source organization when changing integrations. Keep backend and administrator credentials out of dashboard exports.

To rotate access, use Grafana server administration to change this user's password, update the private credential record and privately notify authorized viewers, and revoke existing sessions if necessary. To revoke access entirely, disable the user in server administration.

## Verification

The ECS infrastructure addition was verified live on 2026-09-27: both organization copies were saved, the viewer listed all four approved dashboards, and the new dashboard returned `canEdit`, `canSave`, and `canAdmin` as false. All 17 CloudWatch queries succeeded as the viewer. CPU, memory, target health, requests, response time, and 4xx series returned samples; neither 5xx series returned samples in the six-hour verification window. These absent event series were not converted to zero. The older checks below remain a historical record.

The following is the previously recorded verification from 2026-09-27 against Grafana 13.2.2 with the live `banking-viewer` account. It was not rerun during the documentation audit; recheck after user, organization, dashboard or backend changes:

- Browser login succeeded; the dashboard list contained exactly the three approved dashboards. The service graph rendered the Banking API database dependency.
- All three dashboard reads returned HTTP 200 with `canEdit`, `canSave`, and `canAdmin` false. Save attempts returned HTTP 403.
- Direct API reads of all 24 unrelated infrastructure dashboards were denied (HTTP 403/404). A browser request for CoreDNS with `orgId=1` returned HTTP 404.
- Switching to Main Org. returned HTTP 401. Supplying its organization header did not expose its dashboards.
- Folder creation, organization user management, and server settings returned HTTP 403.
- Prometheus, Loki, and Tempo query endpoints returned HTTP 200 as the viewer.
- The account belongs only to organization `2`, with role `Viewer`; server administrator privileges are disabled.

Grafana permission/search updates may take a short time to become visible. Recheck both the browser and API after imports or permission changes.
