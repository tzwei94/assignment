# Quickstart

Start from a source copy containing both `app/` and `deployment/`. For a submodule-based clone, run `git submodule update --init --recursive`. Local startup runs the banking API, PostgreSQL, migrations, Alloy and a telemetry test receiver. AWS and a remote registry are not needed locally; the receiver has no Grafana UI.

## 1. Prerequisites

Install Git, Docker Desktop (or another running Docker Engine with Compose), Make, OpenSSL, curl, `jq` and `uv`. Use Bash or Zsh for the commands below. Java and Maven run inside the application build container.

On macOS, follow [the prerequisite bootstrap](SETUP.md#macos-prerequisites), then run `uv run deployment/deploy/scripts/setup.py` and choose **1** to check or install tools. AWS CLI, Terraform and the Session Manager plugin are only needed for AWS deployment; Java/Node are only needed for full local verification.

Clone the main repository, including its application and deployment submodules:

```sh
git clone --recurse-submodules https://github.com/tzwei94/banking-platform.git banking-demo
cd banking-demo
git submodule update --init --recursive
docker info
docker compose version
uv --version
```

All three source repositories are public. For an existing checkout, start with `cd` into its root and run the last four commands. `docker info` must succeed before continuing.

## 2. Start locally

Run these commands in the **same terminal**, starting in the workspace:

```sh
make -C app image
docker build -t banking-alloy:local deployment/deploy/monitoring

# Temporary credentials for this local demo.
umask 077
QUICKSTART_DIR="$(mktemp -d)"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out "$QUICKSTART_DIR/demo.key" 2>/dev/null
export JWT_PRIVATE_KEY="$(cat "$QUICKSTART_DIR/demo.key")"
export TOKEN_USERNAME=demo
export TOKEN_PASSWORD="$(openssl rand -hex 24)"
export TOKEN_SUBJECT=alice
export DB_PASSWORD="$(openssl rand -hex 24)"

compose=(docker compose -p banking-quickstart -f app/docker/docker-compose.infra.yml)
"${compose[@]}" up -d --wait db

# One-off Liquibase migration. The container exits and is removed afterward.
export DB_URL=jdbc:postgresql://db:5432/banking
export DB_USERNAME=banking_test
export DOCKER_NETWORK=banking-quickstart_default
export SEED_SYNTHETIC=true
make -C app migrate

"${compose[@]}" up -d

API_PORT="$("${compose[@]}" port api 8080 | awk -F: '{print $NF}')"
export API_URL="http://127.0.0.1:$API_PORT"
curl -fsS --retry 30 --retry-connrefused --retry-all-errors --retry-delay 1 "$API_URL/readyz"
```

Expected: `{"status":"UP"}`. Readiness checks database connectivity, not whether the banking schema has been migrated. The port is assigned automatically. The local API uses HTTP; public HTTPS terminates at the AWS load balancer.

The images prepare fresh shared log-volume permissions during their builds; there is no startup initializer. If reusing older local volumes, follow the [volume ownership guidance](deployment/deploy/monitoring/README.md#direct-startup-and-volume-ownership).

## 3. Try the API

The demo seeds Alice's account with **SGD 100**.

```sh
API_TOKEN="$(curl -fsS -X POST -u "$TOKEN_USERNAME:$TOKEN_PASSWORD" "$API_URL/auth/token" | jq -er .access_token)"
curl -fsS -H "Authorization: Bearer $API_TOKEN" \
  "$API_URL/accounts/00000000-0000-0000-0000-000000000001/balance"

# Status and logs:
"${compose[@]}" ps
"${compose[@]}" logs --tail=50 api alloy
```

Deposit SGD 10, then withdraw SGD 5. On a fresh database the balances become SGD 110 and SGD 105:

```sh
ACCOUNT_PATH=/accounts/00000000-0000-0000-0000-000000000001
curl -fsS -X POST "$API_URL$ACCOUNT_PATH/deposits" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: local-deposit-001' -d '{"amount":10.00}'
curl -fsS -X POST "$API_URL$ACCOUNT_PATH/withdrawals" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: local-withdrawal-001' -d '{"amount":5.00}'
curl -fsS -H "Authorization: Bearer $API_TOKEN" "$API_URL$ACCOUNT_PATH/balance"
```

Reusing a key with the same body returns the previous result; use a new key for a new operation. The demo token lasts 15 minutes; call `/auth/token` again with the command when it expires. See the [API contract](app/README.md#api-contract) for status codes. If startup fails, check `"${compose[@]}" logs db api`.

If you reopen the terminal, discover the port again with `docker port banking-quickstart-api-1 8080/tcp` (this does not require restoring Compose environment variables). Use the original local credentials; generating new ones does not update an existing database.

### Use Postman

Import [the collection](app/postman/Banking-API.postman_collection.json) and [environment template](app/postman/Local.postman_environment.json). Select the environment, set `base_url` to `$API_URL`, and set `token_username` / `token_password` to the `TOKEN_USERNAME` / `TOKEN_PASSWORD` used at startup. You can print these in your local terminal with `printf '%s\n' "$API_URL" "$TOKEN_USERNAME" "$TOKEN_PASSWORD"`.

Send **Authentication → Get token**; its response script saves `api_token` automatically. Tokens expire after 15 minutes; send Get token again to renew. Run Health, Authentication, then Banking in order. The default banking sequence deposits SGD 1, retries that deposit, and withdraws SGD 1. A successful sequence leaves the starting balance unchanged. See the [Postman guide](app/postman/README.md) for all variables and Newman instructions. Keep credential-bearing exports local.

### Database maintenance

Migrations run through a one-off `docker run`, using the database variables above. For rollback and checksum-clearing commands, see [database maintenance](app/README.md#rollback-and-checksum-maintenance). The initial rollback deletes both banking tables and their data; stop the API first and migrate again before restarting it.

## 4. Stop and reset

This removes the local containers and their demo data. Stop before repeating the startup commands, which generate new credentials.

```sh
"${compose[@]}" down -v
rm -f "$QUICKSTART_DIR/demo.key"
rmdir "$QUICKSTART_DIR"
unset DB_URL DB_USERNAME DB_PASSWORD DOCKER_NETWORK SEED_SYNTHETIC
unset JWT_PRIVATE_KEY TOKEN_USERNAME TOKEN_PASSWORD TOKEN_SUBJECT API_TOKEN
```

## Run the checks

From the workspace root:

| Command | Purpose |
|---|---|
| `make smoke` | Build both images, test the local stack, then clean it up automatically. |
| `make verify` | Validate both repositories: application tests, CI policy, API contract and mocked Terraform/deployment tests. Docker is also required for PostgreSQL and Alloy validation. |

`make verify` additionally needs **Java 25**, **Node.js 24**, **Terraform >=1.10,<2.0** (CI pins 1.16.1) and **unzip**. Install those versions, then select your installed JDK before running it:

```sh
export JAVA_HOME="/path/to/your/jdk-25"
export PATH="$JAVA_HOME/bin:$PATH"
make verify
```

## Deploy to AWS dev

Follow **[the AWS setup guide](SETUP.md)** from the main repository root. It covers all preparation steps and commands in execution order. Local startup and verification do not create AWS resources.
