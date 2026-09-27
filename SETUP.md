# Set up AWS and deploy the application

Run the numbered steps in order. Commands run in **Bash on your workstation, from the main repository root**, unless a block says **on the EC2 runner**. Keep the same terminal open so exported variables remain available. Replace `REPLACE_...` values before running commands.

For a local-only demonstration, use [QUICKSTART.md](QUICKSTART.md). It needs no AWS account. The [architecture document](docs/architecture.md) explains the design and contains the diagram.

**Scope:** these commands describe setup from a fresh checkout and were checked against the repository on 27 September 2026. For an existing environment, load its outputs and resume at the unfinished step; do not repeat first-deployment bootstrap. This guide is not a live deployment-status report. Review the [Alloy validation record](deployment/deploy/monitoring/security-review.md) and pass the publication scan before publishing that image. Check [account eligibility and costs](docs/budget.md) before creating resources. Expect roughly $50–65 for a low-traffic week, not a permanently free deployment.

## macOS prerequisites

On a fresh Mac, install Apple's command line tools first. Complete the macOS dialog before continuing:

```sh
xcode-select --install
```

Install [uv using its official installer](https://docs.astral.sh/uv/getting-started/installation/), then open a new terminal so `uv` is on your PATH:

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Clone this repository with its submodules if needed, then start the menu from its root:

```sh
git clone --recurse-submodules https://github.com/tzwei94/assignment.git banking-demo
cd banking-demo
uv run deployment/deploy/scripts/setup.py
```

For an existing checkout, use its directory instead of cloning again. Choose **1 → 1** to check prerequisites, or **1 → 2** to install all prerequisites with one confirmation. This installs Homebrew when missing, CLI tools, Java 25/Node 24 and the Session Manager plugin, then opens an existing OrbStack or Docker Desktop installation (or asks which to install). Installers may request your macOS password. If Apple command line tools are missing, complete their macOS dialog and choose **1 → 2** again to resume. Complete any Docker app setup and rerun the checks once it starts; Compose and Buildx must be available.

The menu automatically uses Homebrew's Java 25, Node 24 and OpenSSL paths for commands it launches. It does not edit your shell startup files. For manual verification commands outside the menu, use:

```sh
export JAVA_HOME="$(brew --prefix openjdk@25)/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$(brew --prefix node@24)/bin:$(brew --prefix openssl@3)/bin:$PATH"
```

The required Terraform range is `>=1.10,<2.0`; the menu installs the HashiCorp tap package and checks its version. Java 25 and Node 24 are needed for full local verification; the Docker quickstart builds Java inside containers. uv manages Python for this menu and Maven is supplied by `app/mvnw`. AWS credentials and `gh auth login` are separate from package installation. Prerequisite checks/installations do not require AWS credentials.

## Interactive setup helper

For menu-driven setup through dev infrastructure, secrets and GitHub runner registration, run:

```sh
uv run deployment/deploy/scripts/setup.py
```

Start with **1** to check/install macOS prerequisites; only uv is needed to launch the menu. AWS operations require AWS CLI and Terraform as applicable. The helper wraps the existing AWS CLI and Terraform commands. Choose **3** to enter your AWS profile, region and API hostname. It uses profile credentials, ignores custom AWS endpoints left by local emulators, and binds progress to the verified account and region. Credentials are never saved in menu settings. Secret input is sent through private temporary files or stdin; local signing keys remain in ignored private storage.

The menu covers local checks, finding/requesting an ACM certificate, displaying DNS validation records and refreshing status, AMI and EC2/RDS checks, backend plan/apply/output loading, and GitHub OIDC detection/import/plan/apply. DNS editing remains manual; for Cloudflare use DNS only. Existing issued or pending certificates with the exact primary hostname are reused, with a selection prompt if several match.

Settings and reviewed plans are private under `deployment/.private/setup/`. Restarting the helper reloads them; shell exports are unnecessary inside the menu. Terraform outputs are loaded automatically after successful applies, or using **Load Terraform outputs** for a root already applied manually. For an existing backend, load its outputs before generating another plan. Plans generated outside the helper must be regenerated through its menu. Apply displays the saved plan and requires typing `yes`; changed plans, account mismatches and failed/partially applied plans require a new plan.

The menu follows this setup sequence; saved progress and teardown are at the end:

| Option | Action |
|---|---|
| 1 | Check/install macOS prerequisites and start Docker |
| 2 | Run local verification / smoke checks |
| 3 | Configure AWS profile, region, identity and API hostname |
| 4 | Configure alarm email, telemetry HTTPS URLs, repository names and backup retention |
| 5 | Request/reuse a certificate and check DNS validation |
| 6 | Check runner AMI, EC2 and PostgreSQL availability |
| 7 | Plan/apply the Terraform backend or load its outputs |
| 8 | Detect/import GitHub OIDC, then plan/apply or load outputs |
| 9 | Write/update the private dev configuration, generate a plan, review/apply it, or reload outputs |
| 10 | Show the API CNAME, check SNS subscription status and test HTTPS readiness |
| 11 | Populate telemetry or API-login credentials with hidden password input |
| 12 | Generate/reuse a signing key only when the remote signing secret is empty |
| 13 | Check SSM, connect, diagnose provisioning, repair the existing runner or poll a submitted command |
| 14 | Register app/deploy runners, write GitHub variables/secrets, or check runner status |
| 15 | View saved progress |
| 16 | Preview/review destruction of dev infrastructure; preserve backend and GitHub OIDC |

Run this menu on your workstation, not inside the EC2 shell. An SSM session launched by the menu returns to it when you exit. DNS edits and SNS email confirmation remain manual. GitHub configuration needs an authenticated `gh` CLI and an existing, protected `dev` environment; the menu does not silently create an unprotected environment.

For a fresh dev environment: finish options 1–8, then choose 9 → write configuration, 9 → plan, and 9 → review/apply. For an existing environment, the menu reads its current private profile and Terraform outputs. Writing configuration preserves release images, service flags, active task ARN and existing backup retention unless you explicitly change the retention in option 4. It does not synchronize later release manifests automatically: use section 11 before subsequent operator plans.

Normal dev plans containing deletion or replacement are blocked; intentional teardown uses the separate option 16. Changes to `runner-init.sh` update EC2 user data in place with a stop/start, preserving the registered runner and its EBS disk. Cloud-init does not automatically rerun after that update: use option 13 to apply provisioning changes explicitly. Reconcile the user-data update with an operator plan while runners are idle before a future release. Diagnostics and repairs save their SSM command ID; if a command is still running, poll it instead of starting another. A historical cloud-init failure is not cleared by rerunning the provisioning script.

Existing secret values require explicit replacement confirmation. A populated JWT signing secret is preserved. The helper reuses the guide's `.private/setup/demo-signing.key` if present; otherwise it creates a private key under `deployment/.private/setup/`. GitHub token-login secrets can be copied directly from the existing AWS `token-auth` secret without displaying or storing their values locally.

For registration, choose 14 → register, then `app` or `deploy`. The helper links to the repository's **New self-hosted runner** page; select Linux x64 and enter its reviewed version and SHA256. It uploads only the registration script through SSM, then starts an interactive session where you enter the short-lived registration token. The token never enters the SSM command payload or local command arguments. GitHub's existing registration script passes that token briefly in the runner's EC2 process arguments; this host must contain only trusted users. Already-registered runners are not reconfigured. Repeat for the other repository, then check both runners' status.

GitHub repositories using immutable OIDC subjects need their exact subject prefixes in the private dev profile before planning. Read them with `gh api repos/OWNER/REPO/actions/oidc/customization/sub` for each repository. Set `github_app_subject_prefix` and `github_deployment_subject_prefix` to the returned `sub_claim_prefix` (for example, `repo:OWNER@OWNER_ID/REPO@REPO_ID`). Leave these inputs null for legacy name-based subjects. Custom subject templates need separate review. Terraform appends the required `main` branch or `dev` environment context and never uses a wildcard. After changing the profile, update GitHub's `DEV_TFVARS_JSON` through option 14 → 2. See [GitHub immutable subject claims](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims).

For GitHub OIDC, choose **Detect/import existing GitHub provider** before the first plan. Import attaches the existing provider to this root; subsequent plans show any configuration differences. Preserve each bootstrap root's `terraform.tfstate` as well as the helper settings. The helper does not migrate bootstrap state into S3.

When switching from the menu to the manual commands below, run the **non-secret variable setup in section 1** in your current terminal, filling the GitHub repository names, alarm email and telemetry URLs. Later commands need `PROJECT_ROOT`, `DEV_ROOT`, `DEV_VARS`, `DEV_BACKEND` and those service settings. Then load the helper's verified values using this bridge from the main repository root:

```sh
python3 - <<'PYENV'
import json, os, shlex
from pathlib import Path
settings = json.loads(Path('deployment/.private/setup/settings.json').read_text())
names = dict(profile='AWS_PROFILE', region='AWS_REGION', account='ACCOUNT_ID',
             domain='API_HOST', certificate_arn='CERTIFICATE_ARN',
             runner_ami_id='RUNNER_AMI_ID', state_bucket='STATE_BUCKET',
             state_kms_arn='STATE_KMS_ARN', github_oidc_arn='GITHUB_OIDC_ARN')
missing = names.keys() - settings.keys()
if missing:
    raise SystemExit('Complete helper steps first: ' + ', '.join(sorted(missing)))
p = Path('deployment/.private/setup/shell-env.sh')
p.touch(mode=0o600)
os.chmod(p, 0o600)
p.write_text(''.join(f'export {env}={shlex.quote(settings[key])}\n' for key, env in names.items()))
PYENV
# Run only after the bridge above succeeds:
source deployment/.private/setup/shell-env.sh
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_IGNORE_CONFIGURED_ENDPOINT_URLS=true
export REGISTRY_HOST="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
export IMAGE_REPOSITORY="$REGISTRY_HOST/banking-dev/banking-api"
export ALLOY_REPOSITORY="$REGISTRY_HOST/banking-dev/banking-alloy"
```

Continue at the first manual step not already completed. After finishing menu options 8–14, image publication starts at section 8. Publishing images, database bootstrap, release and rollback remain separate guide steps; the menu does not dispatch deployments.

## 1. Prepare accounts, services and tools

| Prepare | What is needed |
|---|---|
| AWS | An eligible account, confirmed remaining credits, Singapore region access and an operator identity allowed to create the Terraform resources. Check EC2, Fargate, RDS, NAT/EIP, IAM, S3, KMS, Secrets Manager and monitoring access/quotas. |
| GitHub | Existing main, application and deployment repositories, with the application/deployment workflows at their respective repository roots. Default branch `main`; access to configure Actions, environments, variables and runners. |
| Domain/DNS | Your own API hostname and permission to create certificate-validation and API DNS records. |
| Container registry | Private AWS ECR repositories created by the dev Terraform root; IAM-authenticated push and pull. |
| Monitoring | Reachable HTTPS Loki push, Prometheus remote-write and Tempo OTLP/HTTP endpoints; scoped machine credentials and operator access to Grafana. These services are external to this Terraform. |
| Workstation | Git, Bash, Make, Docker with Compose/Buildx, AWS CLI v2, Session Manager plugin, GitHub CLI (`gh`), Terraform >=1.10,<2.0, `uv`, Python 3, `jq`, OpenSSL and curl. Java 25, Node.js 24 and unzip are needed for all local checks. |

Install the tools for your operating system, start Docker, then check:

```sh
git submodule update --init --recursive
docker info
docker compose version
docker buildx version
aws --version
session-manager-plugin --version
gh --version
terraform version
uv --version
python3 --version
jq --version
openssl version
java -version
node --version
command -v make curl unzip
gh auth login
```

Configure an AWS CLI profile using your approved operator credentials. For a credential-based profile, `aws configure --profile banking-demo` prompts without putting the values in shell history. Prefer temporary credentials; if supplied a session token, include it in the protected profile using your credential provider's instructions. Never use root access keys or put credentials in this project. Do not create an AWS Organization merely for this demo; it can affect Free Tier credits.

```sh
export AWS_PROFILE=banking-demo
export AWS_REGION=ap-southeast-1
export AWS_DEFAULT_REGION="$AWS_REGION"
aws sts get-caller-identity
```

Verify the returned account before continuing. The following variables are non-secret:

```sh
export PROJECT_ROOT="$PWD"
export GH_OWNER=REPLACE_GITHUB_OWNER
export APP_REPO=app
export DEPLOY_REPO=deployment
export API_HOST=api.REPLACE_YOUR_DOMAIN
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export REGISTRY_HOST="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
export IMAGE_REPOSITORY="$REGISTRY_HOST/banking-dev/banking-api"
export ALLOY_REPOSITORY="$REGISTRY_HOST/banking-dev/banking-alloy"
export ALARM_EMAIL=REPLACE_EMAIL
export LOKI_URL=https://logs-ingest.REPLACE_YOUR_DOMAIN/loki/api/v1/push
export METRICS_URL=https://metrics-ingest.REPLACE_YOUR_DOMAIN/api/v1/write
export TRACES_BASE_URL=https://traces-ingest.REPLACE_YOUR_DOMAIN
export STATE_BUCKET="banking-demo-state-$ACCOUNT_ID-$AWS_REGION"
export DEV_ROOT="$PROJECT_ROOT/deployment/infra/environments/dev"
export DEV_VARS="$DEV_ROOT/dev.tfvars.json"
export DEV_BACKEND="$DEV_ROOT/backend.hcl"
umask 077
mkdir -p .private/setup
```

Use the actual repository names if yours differ. Keep the resource name `banking-dev`: the deployment workflow currently uses that name. Pick a different globally unique state-bucket name if the suggested one is unavailable.

The repositories are already public; see the [current public repository review](docs/public-sharing.md). Self-hosted runner access needs an enforceable trust boundary: restrict an organization runner group to the trusted publication workflow on `main`. If your GitHub plan cannot enforce that boundary, keep the runner-connected repository private until the runner arrangement is revised. A workflow's `if` condition alone cannot make arbitrary PR workflow changes safe.

## 2. Run the local checks

Select an installed JDK 25 with `JAVA_HOME`, then:

```sh
make verify
make smoke
```

Expected: application checks, Terraform validation/tests and local API/telemetry smoke checks pass. Docker must be running. `make smoke` creates and removes a disposable local database and containers. These commands do not deploy AWS resources. Do not treat skipped or unavailable checks as passing.

## 3. Prepare the TLS certificate and runner AMI

Request a public ACM certificate in the same region as the ALB:

```sh
export CERTIFICATE_ARN="$(aws acm request-certificate \
  --domain-name "$API_HOST" --validation-method DNS \
  --query CertificateArn --output text)"
aws acm describe-certificate --certificate-arn "$CERTIFICATE_ARN" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
```

If the DNS records are not ready yet, repeat `describe-certificate`. Add the returned CNAME name/value at your DNS provider, then wait for validation:

```sh
aws acm wait certificate-validated --certificate-arn "$CERTIFICATE_ARN"
export RUNNER_AMI_ID="$(aws ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)"
aws ec2 describe-images --image-ids "$RUNNER_AMI_ID" \
  --query 'Images[].{Id:ImageId,Name:Name,Architecture:Architecture,Owner:OwnerId}'
aws ec2 describe-instance-types --instance-types t3.small \
  --query 'InstanceTypes[].{Type:InstanceType,FreeTier:FreeTierEligible,Memory:MemoryInfo.SizeInMiB}'
aws rds describe-orderable-db-instance-options --engine postgres \
  --db-instance-class db.t4g.micro \
  --query "OrderableDBInstanceOptions[?starts_with(EngineVersion, '17.')].{Version:EngineVersion,Storage:StorageType}"
```

Review the AMI and pin its returned ID in the profile. The example uses `t3.small` for Free-plan evaluation; its 2 GiB memory still needs capacity testing. Confirm Fargate access and enough On-Demand vCPU quota for rolling replacement and administrative tasks. These read-only queries do not prove all account permissions or eligibility.

## 4. Create the Terraform backend and GitHub OIDC provider

These are two independent bootstrap roots. They initially keep **local private state**; preserve that state securely. Never lose it or commit it. Optional migration to separate S3 state keys is described in the [deployment reference](deployment/README.md#prepare-aws).

```sh
terraform -chdir=deployment/infra/bootstrap/backend init
terraform -chdir=deployment/infra/bootstrap/backend plan \
  -var="region=$AWS_REGION" -var="bucket_name=$STATE_BUCKET" \
  -out="$PROJECT_ROOT/.private/setup/backend.tfplan"
terraform -chdir=deployment/infra/bootstrap/backend apply \
  "$PROJECT_ROOT/.private/setup/backend.tfplan"
export STATE_KMS_ARN="$(terraform -chdir=deployment/infra/bootstrap/backend output -raw kms_key_arn)"

terraform -chdir=deployment/infra/bootstrap/github-oidc init
aws iam list-open-id-connect-providers
```

If the list already includes `token.actions.githubusercontent.com`, import it once into this root before planning:

```sh
# Run only when that provider already exists and is not in this root's state.
terraform -chdir=deployment/infra/bootstrap/github-oidc import \
  -var="region=$AWS_REGION" aws_iam_openid_connect_provider.github \
  "arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
```

Continue with either the imported or new provider:

```sh
terraform -chdir=deployment/infra/bootstrap/github-oidc plan \
  -var="region=$AWS_REGION" -out="$PROJECT_ROOT/.private/setup/oidc.tfplan"
terraform -chdir=deployment/infra/bootstrap/github-oidc apply \
  "$PROJECT_ROOT/.private/setup/oidc.tfplan"
export GITHUB_OIDC_ARN="$(terraform -chdir=deployment/infra/bootstrap/github-oidc output -raw provider_arn)"
```

Read each plan before applying. Bootstrap backend/OIDC resources survive the later dev teardown.

## 5. Create the private dev configuration and infrastructure

The runner, ECR repositories and IAM permissions are needed before CI can publish its first image. For this first infrastructure-only apply, use deliberately inert image digests while `service_enabled=false` and `bootstrap_enabled=false`. Terraform registers task definitions but starts no application or administrative tasks. **Replace these digests with real published images in step 9 before running any task.** ALB, NAT, RDS and the runner incur charges from this step onward.

```sh
python3 - <<'PY'
import json, os
from pathlib import Path
e = os.environ
v = json.loads(Path(e['DEV_ROOT'], 'dev.tfvars.json.example').read_text())
v.update(name='banking-dev', region=e['AWS_REGION'], github_owner=e['GH_OWNER'],
    app_repository=e['APP_REPO'], deployment_repository=e['DEPLOY_REPO'],
    github_oidc_arn=e['GITHUB_OIDC_ARN'], state_bucket=e['STATE_BUCKET'],
    state_kms_arn=e['STATE_KMS_ARN'], certificate_arn=e['CERTIFICATE_ARN'],
    alarm_email=e['ALARM_EMAIL'], runner_ami_id=e['RUNNER_AMI_ID'],
    runner_instance_type='t3.small', final_snapshot_identifier='banking-dev-final-initial',
    image=e['IMAGE_REPOSITORY']+'@sha256:'+'0'*64,
    alloy_image=e['ALLOY_REPOSITORY']+'@sha256:'+'0'*64, source_sha='0'*40,
    loki_url=e['LOKI_URL'], metrics_url=e['METRICS_URL'], traces_base_url=e['TRACES_BASE_URL'],
    service_enabled=False, bootstrap_enabled=False, active_task_definition_arn='',
    seed_synthetic=True)
Path(e['DEV_VARS']).write_text(json.dumps(v, indent=2)+'\n')
b = dict(bucket=e['STATE_BUCKET'], key='dev/terraform.tfstate', region=e['AWS_REGION'],
    encrypt=True, use_lockfile=True, kms_key_id=e['STATE_KMS_ARN'])
Path(e['DEV_BACKEND']).write_text('\n'.join(f'{k} = {json.dumps(v)}' for k,v in b.items())+'\n')
PY
terraform -chdir="$DEV_ROOT" init -backend-config="$DEV_BACKEND"
terraform -chdir="$DEV_ROOT" plan -var-file="$DEV_VARS" \
  -out="$PROJECT_ROOT/.private/setup/dev.tfplan"
terraform -chdir="$DEV_ROOT" apply "$PROJECT_ROOT/.private/setup/dev.tfplan"
terraform -chdir="$DEV_ROOT" output -json contract > .private/setup/contract.json
export IMAGE_REPOSITORY="$(jq -r '.ecr_repositories["banking-api"]' .private/setup/contract.json)"
export ALLOY_REPOSITORY="$(jq -r '.ecr_repositories["banking-alloy"]' .private/setup/contract.json)"
export RUNNER_ID="$(jq -r .runner_instance_id .private/setup/contract.json)"
export API_URL="https://$API_HOST"
```

Before the first CI run, check the exact GitHub OIDC subject prefixes for both repositories. The optional `github_app_subject_prefix` and `github_deployment_subject_prefix` fields in the private dev profile accept `repo:OWNER/REPO` or `repo:OWNER@ID/REPO@ID`; Terraform appends the main-ref or environment suffix. If your repositories use ID-bearing subjects, set those exact prefixes and review/apply an operator plan before CI. The setup menu does not discover them. Preserve these fields in `DEV_TFVARS_JSON`; see [OIDC configuration](deployment/README.md#prepare-aws).

Read the SNS confirmation email and confirm the subscription. Point your API hostname to the `alb_dns_name` in `.private/setup/contract.json` using your DNS provider's CNAME or appropriate ALIAS record. Keep DNS traffic direct to the ALB for initial verification. An HTTP 503 is expected until the ECS service is deployed; certificate errors are not.

If RDS creation fails with `FreeTierRestrictionError` about backup retention, the standard seven-day retention was rejected by your account plan. Set `"db_backup_retention_period": 1` in the private dev profile to retry with the minimum enabled retention. This reduces the automated recovery window to one day. The numeric account maximum is not provided in that error; AWS acceptance must be verified on apply. Preserve this setting in the GitHub `DEV_TFVARS_JSON` profile for subsequent deployments.

After any partial apply, keep the existing state and generate a **new** full plan using the commands above; do not reuse the old saved plan or recreate successful resources manually. Review any updates or replacements before applying. Already-created infrastructure continues running while you resolve the error.

## 6. Populate secrets and create the demo signing key

Secrets Manager resources exist but their values are empty. For an existing installation upgrading to Basic token issuance, first apply the operator infrastructure changes for `jwt-signing`, `token-auth` and execution-role IAM; these changes cannot be applied by the application-only release workflow. This prompt stores the telemetry and token-issuance credentials without putting them in Terraform, shell history or command arguments:

```sh
python3 - <<'PY'
import getpass, json, subprocess, sys
from pathlib import Path
# The heredoc supplies Python code; read interactive input from the terminal.
sys.stdin = open('/dev/tty')
c = json.loads(Path('.private/setup/contract.json').read_text())
for name, arn in [('telemetry', c['secret_arns']['telemetry']),
                  ('token-auth', c['secret_arns']['token-auth'])]:
    print('Enter scoped credentials for', name)
    value = {'username': input('Username: '), 'password': getpass.getpass('Password/token: ')}
    subprocess.run(['python3', 'deployment/deploy/scripts/populate-secret.py', arn],
                   input=json.dumps(value), text=True, check=True)
PY
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out .private/setup/demo-signing.key
jq -n --rawfile key .private/setup/demo-signing.key '{private_key:$key}' | \
  python3 deployment/deploy/scripts/populate-secret.py \
  "$(jq -r '.secret_arns["jwt-signing"]' .private/setup/contract.json)"
```

ECR authentication uses IAM and needs no stored registry password. Store the shared signing key in `jwt-signing`; both tasks receive it through Secrets Manager. Keep any local copy private. Set GitHub environment secrets `TOKEN_USERNAME` and `TOKEN_PASSWORD` to the same values entered for `token-auth` (use `gh secret set NAME --repo "$GH_OWNER/$DEPLOY_REPO" --env dev` and its hidden prompt). Leave `app-db` and `migration-db` empty: the database bootstrap creates them. RDS manages its own master secret. This guide uses Singapore; if you adapt it to another region, pass `--region "$AWS_REGION"` to `populate-secret.py`.

## 7. Register the runner and configure GitHub

Find the Linux x64 runner version and SHA-256 in GitHub repository **Settings → Actions → Runners → New self-hosted runner**. Use a current runner with Node 24 action support (at least 2.329.0). Obtain a fresh registration token separately for each repository; do not save it in Git.

```sh
aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=$RUNNER_ID" \
  --query 'InstanceInformationList[].{Id:InstanceId,Status:PingStatus}'
aws ssm start-session --target "$RUNNER_ID"
```

Wait until the instance reports `Online`. In that **EC2 runner session**, check provisioning and save the exact contents of [register-runner.sh](deployment/deploy/provisioning/register-runner.sh) as `/tmp/register-runner.sh` using an editor:

```sh
# ON THE EC2 RUNNER: substitute the owner, repositories, version and checksum.
sudo cloud-init status --wait
sudo systemctl is-active docker
sudo vi /tmp/register-runner.sh
sudo bash /tmp/register-runner.sh OWNER/app app VERSION SHA256
sudo bash /tmp/register-runner.sh OWNER/deployment deploy VERSION SHA256
exit
```

Each invocation prompts for its repository's temporary token. Confirm both runners are online in GitHub. The app runner must have `banking-app`; the deployment runner must have `banking-deploy`. Both share Docker administrator access, so only trusted jobs may use this host. GitHub-hosted runners perform application tests/builds; the app self-hosted runner publishes the built image.

Back **on the workstation**, protect both `main` branches and create the deployment repository's `dev` environment in GitHub Settings. Restrict deployment branches to `main`, and configure approved operators/reviewers where supported. Set the variables:

```sh
gh variable set AWS_REGION --repo "$GH_OWNER/$APP_REPO" --body "$AWS_REGION"
gh variable set AWS_BUILD_ROLE_ARN --repo "$GH_OWNER/$APP_REPO" \
  --body "$(jq -r .build_role_arn .private/setup/contract.json)"
gh variable set IMAGE_REPOSITORY --repo "$GH_OWNER/$APP_REPO" --body "$IMAGE_REPOSITORY"
gh variable set DEPLOYMENT_REPOSITORY --repo "$GH_OWNER/$APP_REPO" --body "$GH_OWNER/$DEPLOY_REPO"

# Alloy publishing runs on hosted runners, without the dev environment.
gh variable set AWS_REGION --repo "$GH_OWNER/$DEPLOY_REPO" --body "$AWS_REGION"
gh variable set AWS_ALLOY_PUBLISH_ROLE_ARN --repo "$GH_OWNER/$DEPLOY_REPO" \
  --body "$(jq -er .alloy_publish_role_arn .private/setup/contract.json)"
gh variable set ALLOY_REPOSITORY --repo "$GH_OWNER/$DEPLOY_REPO" --body "$ALLOY_REPOSITORY"

gh variable set AWS_REGION --repo "$GH_OWNER/$DEPLOY_REPO" --env dev --body "$AWS_REGION"
gh variable set AWS_DEPLOY_ROLE_ARN --repo "$GH_OWNER/$DEPLOY_REPO" --env dev \
  --body "$(jq -r .deploy_role_arn .private/setup/contract.json)"
gh variable set STATE_BUCKET --repo "$GH_OWNER/$DEPLOY_REPO" --env dev --body "$STATE_BUCKET"
gh variable set API_URL --repo "$GH_OWNER/$DEPLOY_REPO" --env dev --body "$API_URL"
```

A GitHub App is needed only for the optional version-release PR/tag workflows, not basic application CI and AWS deployment. To enable it, follow the permission/key setup in [CI and Maven releases](app/docs/ci-cd.md#repository-setup), then configure `RELEASE_APP_ID` and the `RELEASE_APP_PRIVATE_KEY` secret as documented there.

## 8. Publish the application and Alloy images

Commit/review the application changes and merge or push the approved commit to its existing `main`. `app-ci.yml` runs on pushes, not `workflow_dispatch`. If a main-push run already exists, rerun that run after setup rather than making an empty commit:

```sh
gh run list --repo "$GH_OWNER/$APP_REPO" --workflow app-ci.yml --branch main
export APP_RUN_ID=REPLACE_MAIN_PUSH_RUN_ID
# Only if that selected run needs rerunning after configuration:
gh run rerun "$APP_RUN_ID" --repo "$GH_OWNER/$APP_REPO"
gh run watch "$APP_RUN_ID" --repo "$GH_OWNER/$APP_REPO" --exit-status
gh run download "$APP_RUN_ID" --repo "$GH_OWNER/$APP_REPO" \
  --name image-manifest --dir .private/setup/app-release
export IMAGE="$(jq -er .image .private/setup/app-release/image-manifest.json)"
export SOURCE_SHA="$(jq -er .source_sha .private/setup/app-release/image-manifest.json)"
```

Select a successful **main-push** run with publication, not a PR run. The manifest directory must be empty before downloading another run. The manifest is the authoritative pairing of source commit and immutable image digest.

For Alloy, use **Publish Alloy** in the deployment repository on `main`. It also runs automatically when the collector Dockerfile/configuration or its publishing script/workflow changes on `main`. The dedicated role and repository variables above must exist first; for an existing environment, apply the reviewed operator IAM change and refresh the contract before configuring the variables. The normal application deployment workflow cannot create the role.

```sh
gh workflow run publish-alloy.yml --repo "$GH_OWNER/$DEPLOY_REPO" --ref main
gh run list --repo "$GH_OWNER/$DEPLOY_REPO" --workflow publish-alloy.yml --branch main
export ALLOY_RUN_ID=REPLACE_SELECTED_ALLOY_RUN_ID
gh run watch "$ALLOY_RUN_ID" --repo "$GH_OWNER/$DEPLOY_REPO" --exit-status
export ALLOY_RUN_ATTEMPT="$(gh run view "$ALLOY_RUN_ID" --repo "$GH_OWNER/$DEPLOY_REPO" --json attempt --jq .attempt)"
gh run download "$ALLOY_RUN_ID" --repo "$GH_OWNER/$DEPLOY_REPO" \
  --name "alloy-image-manifest-$ALLOY_RUN_ID-$ALLOY_RUN_ATTEMPT" --dir .private/setup/alloy-release
export ALLOY_IMAGE="$(jq -er .alloy_image .private/setup/alloy-release/alloy-image-manifest.json)"
```

Choose the successful run for the intended collector commit and use an empty download directory. You can also copy `alloy_image` directly from its run summary. The app publish/release summary shows the matching application `image` and `source_sha`, all deployment input names and a copyable dispatch command. Keep the application `SOURCE_SHA` above; the Alloy manifest's `alloy_source_sha` belongs to the deployment repository. Use `action=deploy`, and set `first_release=true` only for the initial deployment after the next database bootstrap step; later deployments use `false`. Do not bypass the scanner or substitute mutable tags.

Operator publication remains available with `SOURCE_SHA="$(git -C deployment rev-parse HEAD)" deployment/deploy/scripts/publish-alloy.sh` and scoped ECR credentials; copy the final printed digest into `ALLOY_IMAGE`.

When upgrading from the older initializer-based task definition, rebuild and publish **both** images: Java owns `/opt/app/certs/rds-ca.pem`, and Alloy uses the generic `/var/log/app` mount with environment-configured telemetry. Keep the prior task definitions and image digests available for rollback. Database certificate rotation subsequently requires only a Java-image rebuild.

## 9. Set real release inputs and bootstrap the database

Replace the inactive placeholders in the profile:

```sh
python3 - <<'PY'
import json, os, re
from pathlib import Path
p=Path(os.environ['DEV_VARS']); v=json.loads(p.read_text())
for key, env in [('image','IMAGE'),('alloy_image','ALLOY_IMAGE')]:
    value=os.environ[env]
    assert re.fullmatch(r'[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}', value), env
    assert not value.endswith('0'*64), 'Replace the inactive digest'
    v[key]=value
v['source_sha']=os.environ['SOURCE_SHA']
assert re.fullmatch(r'[a-f0-9]{40}',v['source_sha']) and v['source_sha'] != '0'*40
p.write_text(json.dumps(v,indent=2)+'\n')
PY
export DOCKER_CONFIG="$PROJECT_ROOT/.private/setup/docker"
mkdir -p "$DOCKER_CONFIG"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$REGISTRY_HOST"
uv run --no-project python deployment/deploy/scripts/bootstrap-database.py \
  --config "$DEV_VARS" --backend "$DEV_BACKEND" --manifest-bucket "$STATE_BUCKET"
```

The operator identity needs ECR pull permissions; Fargate authenticates separately through its execution role. Expected final message: `Database initialized; bootstrap task and IAM role removed. Run first release next.` If it fails, inspect the restricted CloudWatch task logs and Terraform state; confirm temporary bootstrap permissions were removed before retrying. Never run first-deployment bootstrap against an existing service.

## 10. Deploy and verify

Upload the non-secret profile and dispatch deployment. The smoke check requests a fresh 15-minute token from `/auth/token` using the configured GitHub Basic-auth secrets after the service becomes healthy.

```sh
gh variable set DEV_TFVARS_JSON --repo "$GH_OWNER/$DEPLOY_REPO" --env dev < "$DEV_VARS"

gh workflow run deploy-dev.yml --repo "$GH_OWNER/$DEPLOY_REPO" --ref main \
  -f image="$IMAGE" -f alloy_image="$ALLOY_IMAGE" -f source_sha="$SOURCE_SHA" \
  -f action=deploy -f first_release=true
gh run list --repo "$GH_OWNER/$DEPLOY_REPO" --workflow deploy-dev.yml
export DEPLOY_RUN_ID=REPLACE_THE_NEW_DEPLOY_RUN_ID
gh run watch "$DEPLOY_RUN_ID" --repo "$GH_OWNER/$DEPLOY_REPO" --exit-status
```

The pipeline prepares candidate definitions, runs the database migration, starts two tasks, checks ALB health and authenticated API behavior, then saves a success manifest. A failure is not a successful deployment.

```sh
curl -fsS "$API_URL/readyz"
# Export TOKEN_USERNAME and TOKEN_PASSWORD matching token-auth before this check.
uv run --no-project python deployment/deploy/scripts/smoke.py
unset TOKEN_USERNAME TOKEN_PASSWORD
aws ecs describe-services --cluster banking-dev --services banking-dev \
  --query 'services[].{Desired:desiredCount,Running:runningCount,Task:taskDefinition}'
aws s3 cp "s3://$STATE_BUCKET/manifests/banking-dev.json" .private/setup/successful.json
```

Expected: readiness `UP`, smoke `PASS`, two desired/running tasks and a success manifest. Use the curl examples in [QUICKSTART.md](QUICKSTART.md#3-try-the-api) for manual operations, but use your public HTTPS `API_URL` and obtain a token with Basic-authenticated `POST /auth/token`.

For manual API checks, import the application's [Postman collection and environment](app/postman/README.md). Set `base_url` to the public HTTPS API hostname and `token_username` / `token_password` to the configured Basic credentials, then send **Get token**. Keep certificate verification enabled. The Banking folder changes the synthetic balance temporarily and restores it when the full default sequence succeeds; tokens expire after 15 minutes.

## 11. Check monitoring and preserve deployment settings

```sh
aws logs tail /ecs/banking-dev --since 10m
aws cloudwatch describe-alarms --alarm-name-prefix banking-dev \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue}'
aws sns list-subscriptions-by-topic \
  --topic-arn "$(jq -r .alarm_topic_arn .private/setup/contract.json)"
```

Confirm the subscription is not pending. For runner host metrics, separately install and configure [runner Alloy](deployment/deploy/monitoring/README.md); ordinary runner provisioning does not enable it. In Grafana, generate API traffic and verify application logs in Loki, metrics in Prometheus and traces in Tempo. Check that unauthenticated ingestion is rejected. Never publish logs containing tokens or account details. External dashboards, retention and credentials are managed with those services; this repository does not install them.

For a controlled SNS test, set the runner status alarm to `ALARM`, confirm email delivery, then let normal metric evaluation restore its real state:

```sh
aws cloudwatch set-alarm-state --alarm-name banking-dev-runner_status \
  --state-value ALARM --state-reason 'Operator notification test'
```

After each successful deployment, refresh the local operator profile before any general Terraform apply. Otherwise the initial `service_enabled=false` profile can remove the running service:

```sh
aws s3 cp "s3://$STATE_BUCKET/manifests/banking-dev.json" .private/setup/successful.json
python3 - <<'PY'
import json,os
from pathlib import Path
p=Path(os.environ['DEV_VARS']); v=json.loads(p.read_text())
m=json.loads(Path('.private/setup/successful.json').read_text())
for k in ['image','alloy_image','source_sha','active_task_definition_arn']: v[k]=m[k]
v.update(service_enabled=True,bootstrap_enabled=False)
p.write_text(json.dumps(v,indent=2)+'\n')
PY
gh variable set DEV_TFVARS_JSON --repo "$GH_OWNER/$DEPLOY_REPO" --env dev < "$DEV_VARS"
```

Record your application/IaC URLs, source SHA, image digests, architecture link, test results and deployment verification in the handoff. Keep account identifiers, private outputs and logs outside the public repository.

## 12. Later deployments and rollback

For another deployment: get the new successful application image manifest (step 8), update release inputs (step 9 without database bootstrap), check the Basic-auth secrets, and dispatch step 10 with **`first_release=false`**. Synchronize the operator profile after success (step 11).

For an application rollback to a version supporting `/auth/token`, dispatch:

```sh
gh workflow run deploy-dev.yml --repo "$GH_OWNER/$DEPLOY_REPO" --ref main \
  -f image="$IMAGE" -f alloy_image="$ALLOY_IMAGE" -f source_sha="$SOURCE_SHA" \
  -f action=rollback -f first_release=false
```

Watch the new run and repeat verification. Rollback selects the previous task definition from the success manifest and requires a previous successful release; it does not reverse database migrations. After rollback, repeat step 11 to synchronize the operator profile with the restored task definition and image identities in the success manifest. See the [deployment reference](deployment/README.md#database-bootstrap-and-release).

## 13. Stop or remove the demo

Stop the runner between deployment sessions; start it **before** dispatching another workflow:

```sh
aws ec2 stop-instances --instance-ids "$RUNNER_ID"
# Before the next deployment:
aws ec2 start-instances --instance-ids "$RUNNER_ID"
aws ec2 wait instance-running --instance-ids "$RUNNER_ID"
```

Stopping the runner does not stop ALB, NAT, Fargate, RDS or storage charges.

For full dev teardown: finish/cancel running jobs, disable deployment dispatch, remove both runner registrations in GitHub, and decide which database snapshot/logs to retain. Synchronize the operator profile using step 11 while the service is still present. Then disable deletion protection and select a unique final snapshot name:

```sh
gh workflow disable deploy-dev.yml --repo "$GH_OWNER/$DEPLOY_REPO"
python3 - <<'PY'
import datetime,json,os
from pathlib import Path
p=Path(os.environ['DEV_VARS']); v=json.loads(p.read_text())
v['deletion_protection']=False
v['final_snapshot_identifier']='banking-dev-final-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
p.write_text(json.dumps(v,indent=2)+'\n')
PY
terraform -chdir="$DEV_ROOT" plan -var-file="$DEV_VARS" \
  -out="$PROJECT_ROOT/.private/setup/disable-protection.tfplan"
terraform -chdir="$DEV_ROOT" apply "$PROJECT_ROOT/.private/setup/disable-protection.tfplan"
deployment/deploy/scripts/teardown.sh --plan
```

The shell helper `--apply` creates and immediately applies a new destroy plan; it does not apply the earlier `--plan` preview or prompt again. Prefer menu option 16 when you need to review and apply the same saved plan.

Review the plan. The ALB log bucket is `banking-dev-alb-$ACCOUNT_ID`; it must be empty to destroy. Archive anything required before deleting those logs. Never empty the separate state bucket as part of dev teardown.

```sh
# Destructive: deletes the demo's ALB logs after you have retained what is needed.
aws s3 rm "s3://banking-dev-alb-$ACCOUNT_ID" --recursive
deployment/deploy/scripts/teardown.sh --apply
docker logout "$REGISTRY_HOST"
unset DOCKER_CONFIG
```

If ALB log delivery adds objects during deletion, inspect the remaining bucket after the ALB is gone, then empty it and rerun teardown. Keep bootstrap state, state bucket/KMS, OIDC and required final snapshots until you deliberately retire them separately. Review remaining snapshots, volumes, addresses, S3 versions and KMS charges in AWS. External monitoring services have their own lifecycle. ECR repositories refuse deletion while nonempty: inspect and deliberately delete their images only after the rollback/retention window closes, then rerun teardown.

For an existing environment, follow the [registry migration and retention procedure](deployment/README.md#registry-migration-and-retention) before using the application-only release workflow.


## Destroy dev infrastructure with the menu

Run `uv run deployment/deploy/scripts/setup.py` and choose **16**. This only targets `deployment/infra/environments/dev`. It preserves the backend S3 bucket/KMS key, all Terraform state files, and the separately managed GitHub OIDC provider.

Pause deployment workflows before teardown. The submenu separates four actions:

1. Generate a protection-only plan for RDS/ALB. This uses targeted planning for teardown preparation and rejects unrelated resource changes.
2. Review/apply that plan, typing `UNPROTECT dev ACCOUNT_ID REGION` as displayed.
3. Generate a full dev destroy preview with `terraform plan -destroy`. It checks that protection is off, RDS will retain a named final snapshot, and ECR repositories are empty.
4. Review/apply the saved destroy plan, typing `DESTROY dev ACCOUNT_ID REGION` as displayed. This stops the API and deletes the dev infrastructure.

Choose 0 to return without applying. Planning itself does not change AWS resources. Changed configuration, changed plan files or account/region mismatches require a fresh plan. Every apply consumes dev plan approvals even if it fails partway; rerun the planning step to resume from the existing state. Do not remove state files. If abandoning teardown after disabling protection, use option 9 to plan restoring protection from the private profile (`deletion_protection = true`); its usual replacement guard still applies.

The menu never force-deletes ECR images. Archive or explicitly delete them separately if the repository check blocks teardown. Concurrent image pushes can still cause deletion to fail, so keep publishing stopped. RDS uses the configured final snapshot identifier; choose a unique identifier in the private profile before planning if that snapshot name already exists. Secrets are scheduled for deletion with the configured seven-day recovery window, which can block immediate recreation under the same names.

Final RDS snapshots, bootstrap storage and resources outside this dev state remain and may cost money. External DNS records, the separately requested ACM certificate, GitHub settings/runner registrations and local private files also remain. Destroy completion does not mean the AWS account is empty. The workflow uses Terraform's [saved destroy plans](https://developer.hashicorp.com/terraform/cli/commands/plan).
