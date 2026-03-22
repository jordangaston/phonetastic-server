---
tags: deployment, tdd, infrastructure
summary: "Technical design document for deploying phonetastic to Fly.io, LiveKit Cloud, and Neon"
locked: false
---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Jordan | pending | |

---

# Architecture Overview

~~~mermaid
graph TB
    subgraph Internet
        U[End Users / Mobile App]
        P[Phone Callers via PSTN]
    end

    subgraph "Fly.io"
        WEB[phonetastic-web<br/>Fastify + DBOS]
    end

    subgraph "LiveKit Cloud"
        LK[LiveKit Server<br/>SIP + WebRTC]
        AGT[phonetastic-agent<br/>LiveKit Agents SDK]
    end

    subgraph "Neon"
        DB[(PostgreSQL<br/>+ pgvector)]
    end

    subgraph "External Services"
        TW[Twilio]
        RS[Resend]
        DG[Deepgram]
        CT[Cartesia]
        GM[Google Gemini]
        OAI[OpenAI]
        TG[Tigris S3]
        GD[GoDaddy DNS]
        FC[Firecrawl]
        OTEL[OTLP Collector]
    end

    U -->|HTTPS| WEB
    P -->|PSTN/SIP| LK
    LK -->|Dispatch| AGT
    AGT -->|WebRTC| LK
    WEB -->|Pooled TCP| DB
    AGT -->|Pooled TCP| DB
    WEB -->|HTTPS| TW & RS & OAI & TG & GD & FC & OTEL
    AGT -->|HTTPS/WSS| DG & CT & GM & OAI
    WEB -->|HTTPS| LK
~~~

The system deploys as three independent components: a web server on Fly.io serving the HTTP API, a voice agent on LiveKit Cloud handling phone calls, and a Neon-managed PostgreSQL database shared by both. Each component scales independently. The web server and agent share no runtime state except the database.

---

# Use Case Implementations

## Provision the Database — Implements UC-D1

### Neon Project Setup

```bash
# Install CLI
npm i -g neonctl
neonctl auth login

# Create project in us-east-2 (matches Fly.io iad region)
neonctl projects create --name phonetastic --region-id aws-us-east-2

# Enable pgvector
neonctl connection-string --project-id <id>
psql <direct-connection-string> -c 'CREATE EXTENSION IF NOT EXISTS vector;'

# Protect the production branch
# (via Neon Console: Settings → Branches → main → Protected)
```

### Connection Strings

Two connection strings are required:

| Purpose | Hostname Pattern | Used By |
|---------|-----------------|---------|
| Application traffic | `ep-<id>-pooler.<region>.aws.neon.tech` | Web server, Agent (runtime) |
| Migrations / DDL | `ep-<id>.<region>.aws.neon.tech` | Web server (release command only) |

The pooled connection routes through Neon's PgBouncer in transaction mode, supporting up to 10,000 concurrent client connections. The direct connection bypasses PgBouncer and is required for DDL operations — using pooled connections for migrations causes errors.

### Compute Sizing

| Setting | Value | Rationale |
|---------|-------|-----------|
| Min CU | 1 (4 GB RAM) | Working set fits in memory; avoids cold-start page fetches |
| Max CU | 4 (16 GB RAM) | Headroom for traffic spikes and complex queries |
| Scale-to-zero | Disabled | Production must respond immediately; no cold-start latency |

### Driver Configuration

The codebase currently uses `postgres.js` as the Postgres driver. This is compatible with Neon's pooled and direct endpoints over standard TCP. No driver change is needed.

**Critical constraint:** Do not add client-side connection pooling on top of Neon's pooled connection. The `postgres()` driver in `src/db/index.ts` must not set a `max` pool size that would double-pool. Neon's PgBouncer handles pooling.

### Database URL Construction

The current `buildDbUrl()` constructs a URL from individual `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` env vars. For Neon, the codebase must accept a single `DATABASE_URL` connection string instead, because Neon's pooled hostname includes the `-pooler` suffix and SSL parameters.

Two env vars replace the five existing ones:

| Env Var | Purpose |
|---------|---------|
| `DATABASE_URL` | Pooled connection string for runtime queries |
| `DIRECT_DATABASE_URL` | Direct connection string for migrations |

The `buildDbUrl()` function and `envSchema` must be updated to prefer `DATABASE_URL` when set, falling back to the individual vars for local development.

---

## Deploy the Web Server — Implements UC-D2

### Dockerfile

~~~dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npx baml-cli generate
RUN npm run build
RUN npm prune --omit=dev

FROM base AS production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/drizzle /app/drizzle
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/baml_src /app/baml_src

EXPOSE 8080
CMD ["node", "--import", "./dist/instrumentation.js", "dist/server.js"]
~~~

Key decisions:
- **Node 22-slim**: Debian-based (glibc), slim variant for smaller image.
- **Multi-stage build**: Dev dependencies installed for build, pruned for production.
- **`baml-cli generate`**: Runs during build so `src/baml_client/` is generated before `tsc`.
- **`drizzle/` copied**: Migration files needed by the release command.
- **Port 8080**: Fly.io convention. The `HOST` env var must be `0.0.0.0`.

### fly.toml

~~~toml
app = "phonetastic-web"
primary_region = "iad"
kill_signal = "SIGTERM"
kill_timeout = 30

[build]
dockerfile = "Dockerfile"

[deploy]
strategy = "rolling"
release_command = "node dist/db/migrate.js"

[env]
PORT = "8080"
HOST = "0.0.0.0"
NODE_ENV = "production"
LOG_LEVEL = "info"
TZ = "UTC"
GODADDY_DOMAIN = "mail.phonetastic.ai"
GOOGLE_REDIRECT_URI = "https://phonetastic-web.fly.dev/v1/google/callback"
TIGRIS_BUCKET_NAME = "phonetastic-uploads"
AWS_REGION = "auto"
AWS_ENDPOINT_URL_S3 = "https://fly.storage.tigris.dev"
OTEL_SERVICE_NAME = "phonetastic-web"

[http_service]
internal_port = 8080
force_https = true
auto_stop_machines = "stop"
auto_start_machines = true
min_machines_running = 1

[http_service.concurrency]
type = "requests"
soft_limit = 200
hard_limit = 250

[[http_service.checks]]
grace_period = "10s"
interval = "30s"
method = "GET"
timeout = "5s"
path = "/health"

[[vm]]
size = "shared-cpu-2x"
memory = "1gb"
~~~

### Release Command — Implements UC-D5

The release command `node dist/db/migrate.js` runs Drizzle migrations. This requires:

1. **Compiled migration script**: `src/db/migrate.ts` must be compiled to `dist/db/migrate.js` by `tsc`. The current script uses `tsx` at dev time but the compiled version runs directly with `node`.
2. **Direct connection string**: The migration script must read `DIRECT_DATABASE_URL` (not `DATABASE_URL`) to connect without PgBouncer.
3. **DBOS migrations**: Add `npx dbos migrate` to the release command, or chain both in a shell script.

Updated release command:

~~~toml
[deploy]
release_command = "node dist/db/migrate.js && npx dbos migrate"
~~~

The migration script must be updated to use `DIRECT_DATABASE_URL`:

```typescript
const url = process.env.DIRECT_DATABASE_URL ?? buildDbUrl();
```

### Secrets (Fly.io)

Secrets are stored in the local `agent-secrets` encrypted vault and pushed to Fly.io via a deploy script. See [Configure Secrets](#configure-secrets--implements-uc-d4) for the full workflow.

---

## Deploy the Phone Agent — Implements UC-D3

### Dockerfile (Agent)

The agent needs a separate Dockerfile because:
- It runs a different entry point (`dist/agent.js start` vs `dist/server.js`).
- It must run `download-files` during build to cache Silero VAD model weights.
- It does not need `drizzle/` migration files.

~~~dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npx baml-cli generate
RUN npm run build
RUN node dist/agent.js download-files
RUN npm prune --omit=dev

FROM base AS production
ARG UID=10001
RUN adduser --disabled-password --gecos "" --home "/app" --shell "/sbin/nologin" --uid "${UID}" appuser
COPY --from=build --chown=appuser:appuser /app/node_modules /app/node_modules
COPY --from=build --chown=appuser:appuser /app/dist /app/dist
COPY --from=build --chown=appuser:appuser /app/package.json /app/package.json
COPY --from=build --chown=appuser:appuser /app/baml_src /app/baml_src
USER appuser

ENV OTEL_SERVICE_NAME="phonetastic-agent"

CMD ["node", "dist/agent.js", "start"]
~~~

Key decisions:
- **`download-files` during build**: Downloads Silero VAD weights into `node_modules` so they are available at runtime without network fetches during cold start.
- **Non-root user**: Required security practice for LiveKit Cloud.
- **`ca-certificates`**: Required for HTTPS connections to Neon, Deepgram, Cartesia, etc.
- **No `drizzle/` directory**: Agent does not run migrations.
- **Non-sensitive env vars as `ENV` directives**: LiveKit Cloud has no config-file equivalent of Fly.io's `[env]` section. Non-sensitive values are baked into the Dockerfile instead. Secrets set via `lk agent update-secrets` override these at runtime.

### livekit.toml

Created by `lk agent create` and stored in the repository root:

~~~toml
[project]
  subdomain = "<livekit-project-subdomain>"

[agent]
  id = "<agent-id>"
~~~

### .dockerignore (Shared)

~~~
node_modules/
.env
.env.*
tests/
KMS/
.claude/
.cursor/
.git/
docs/
scripts/
*.md
~~~

### Agent Secrets (LiveKit Cloud)

Secrets are stored in the local `agent-secrets` encrypted vault and pushed to LiveKit Cloud via a deploy script. See [Configure Secrets](#configure-secrets--implements-uc-d4) for the full workflow.

**Do NOT set** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, or `LIVEKIT_API_SECRET` — LiveKit Cloud auto-injects these. Setting them manually causes conflicts.

### Agent Dispatch

The agent registers with `agentName: "phonetastic-agent"` (set in `src/agent.ts` via `ServerOptions`). LiveKit Cloud uses explicit dispatch — when an inbound SIP call arrives, the dispatch rule routes it to the `phonetastic-agent` by name. The web server's `LiveKitService` dispatches agents using `AgentDispatchClient.createDispatch()`.

---

## Configure Secrets — Implements UC-D4

All secrets are managed through the `agent-secrets` encrypted vault. Secrets are stored locally, leased with time-bounded access, and pushed to deployment targets via a script. No plaintext secrets appear in shell history, source code, or Docker images.

### Vault Initialization (One-Time)

```bash
secrets init
```

This creates `~/.agent-secrets/` with an age-encrypted store, an X25519 identity key, and a daemon socket.

### Adding Secrets to the Vault

Each secret is added once. The vault encrypts it at rest with age encryption.

```bash
# Database connections
secrets add phonetastic_database_url
secrets add phonetastic_direct_database_url

# Core
secrets add phonetastic_app_key

# LiveKit (web server only — agent gets these auto-injected)
secrets add phonetastic_livekit_url
secrets add phonetastic_livekit_api_key
secrets add phonetastic_livekit_api_secret

# Twilio
secrets add phonetastic_twilio_account_sid
secrets add phonetastic_twilio_auth_token
secrets add phonetastic_twilio_verify_service_sid

# Resend
secrets add phonetastic_resend_api_key
secrets add phonetastic_resend_webhook_secret

# GoDaddy
secrets add phonetastic_godaddy_api_key
secrets add phonetastic_godaddy_api_secret

# Google OAuth
secrets add phonetastic_google_client_id
secrets add phonetastic_google_client_secret
secrets add phonetastic_google_redirect_uri

# AI / ML
secrets add phonetastic_google_api_key
secrets add phonetastic_openai_api_key
secrets add phonetastic_deepgram_api_key
secrets add phonetastic_cartesia_api_key
secrets add phonetastic_firecrawl_api_key

# Storage
secrets add phonetastic_tigris_bucket_name
secrets add phonetastic_aws_endpoint_url_s3

# Non-sensitive config (also stored in fly.toml [env] / Dockerfile.agent ENV)
secrets add phonetastic_godaddy_domain
secrets add phonetastic_google_redirect_uri
secrets add phonetastic_aws_region
secrets add phonetastic_otel_service_name_web
secrets add phonetastic_otel_service_name_agent

# Observability (optional)
secrets add phonetastic_otel_exporter_otlp_endpoint
secrets add phonetastic_otel_exporter_otlp_headers
```

Each `secrets add` prompts interactively for the value. Alternatively, pipe from stdin: `echo "sk-..." | secrets add phonetastic_openai_api_key`.

### Deploy Script

`scripts/deploy-secrets.sh` leases each secret from the vault and pushes it to the target platform. Leases are short-lived (default 1h) and logged in the audit trail.

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?Usage: deploy-secrets.sh <web|agent>}"

PREFIX="phonetastic"

# Maps vault name (phonetastic_<key>) to env var name (<KEY>).
# Secrets shared by both targets.
SHARED_SECRETS=(
  database_url:DATABASE_URL
  app_key:APP_KEY
  google_api_key:GOOGLE_API_KEY
  openai_api_key:OPENAI_API_KEY
  deepgram_api_key:DEEPGRAM_API_KEY
)

# Web-only secrets (sensitive credentials only — non-sensitive vars live in fly.toml [env])
WEB_SECRETS=(
  direct_database_url:DIRECT_DATABASE_URL
  livekit_url:LIVEKIT_URL
  livekit_api_key:LIVEKIT_API_KEY
  livekit_api_secret:LIVEKIT_API_SECRET
  twilio_account_sid:TWILIO_ACCOUNT_SID
  twilio_auth_token:TWILIO_AUTH_TOKEN
  twilio_verify_service_sid:TWILIO_VERIFY_SERVICE_SID
  resend_api_key:RESEND_API_KEY
  resend_webhook_secret:RESEND_WEBHOOK_SECRET
  godaddy_api_key:GODADDY_API_KEY
  godaddy_api_secret:GODADDY_API_SECRET
  google_client_id:GOOGLE_CLIENT_ID
  google_client_secret:GOOGLE_CLIENT_SECRET
  firecrawl_api_key:FIRECRAWL_API_KEY
)

# Agent-only secrets
AGENT_SECRETS=(
  cartesia_api_key:CARTESIA_API_KEY
)

# Optional secrets (pushed if they exist in the vault)
OPTIONAL_SECRETS=(
  otel_exporter_otlp_endpoint:OTEL_EXPORTER_OTLP_ENDPOINT
  otel_exporter_otlp_headers:OTEL_EXPORTER_OTLP_HEADERS
)

push_to_fly() {
  local vault_name="${PREFIX}_$1"
  local env_name="$2"
  local value
  value=$(secrets lease "$vault_name" --ttl 5m --client-id "deploy-web")
  fly secrets set "$env_name=$value" --stage --app phonetastic-web
}

push_to_livekit() {
  local vault_name="${PREFIX}_$1"
  local env_name="$2"
  local value
  value=$(secrets lease "$vault_name" --ttl 5m --client-id "deploy-agent")
  lk agent update-secrets --secrets "$env_name=$value"
}

push_entries() {
  local target="$1"
  shift
  for entry in "$@"; do
    local suffix="${entry%%:*}"
    local env_name="${entry##*:}"
    if [[ "$target" == "fly" ]]; then
      push_to_fly "$suffix" "$env_name"
    else
      push_to_livekit "$suffix" "$env_name"
    fi
  done
}

push_optional() {
  local target="$1"
  for entry in "${OPTIONAL_SECRETS[@]}"; do
    local suffix="${entry%%:*}"
    local env_name="${entry##*:}"
    local vault_name="${PREFIX}_${suffix}"
    if secrets lease "$vault_name" --ttl 5m --client-id "deploy-${target}" 2>/dev/null; then
      if [[ "$target" == "fly" ]]; then
        push_to_fly "$suffix" "$env_name"
      else
        push_to_livekit "$suffix" "$env_name"
      fi
    fi
  done
}

case "$TARGET" in
  web)
    # Non-sensitive vars (GODADDY_DOMAIN, GOOGLE_REDIRECT_URI, TIGRIS_BUCKET_NAME,
    # AWS_ENDPOINT_URL_S3, AWS_REGION, OTEL_SERVICE_NAME) live in fly.toml [env].
    push_entries fly "${SHARED_SECRETS[@]}" "${WEB_SECRETS[@]}"
    push_optional fly
    echo "Staged. Run 'fly secrets deploy --app phonetastic-web' or 'fly deploy' to apply."
    ;;
  agent)
    # LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET are auto-injected — do NOT push.
    # Non-sensitive vars (OTEL_SERVICE_NAME) are baked into the Dockerfile as ENV directives.
    push_entries livekit "${SHARED_SECRETS[@]}" "${AGENT_SECRETS[@]}"
    push_optional livekit
    echo "Agent secrets updated."
    ;;
  *)
    echo "Usage: deploy-secrets.sh <web|agent>" >&2
    exit 1
    ;;
esac
```

Key design decisions:
- **Short-lived leases** (`--ttl 5m`): The secret value is leased only long enough to push it to the platform. The lease expires automatically.
- **`--client-id`**: Tags each lease in the audit log with the deploy target for traceability.
- **`--stage` for Fly.io**: Stages secrets without restarting machines. The next `fly deploy` applies them.
- **LiveKit auto-injected secrets excluded**: The script never pushes `LIVEKIT_URL`, `LIVEKIT_API_KEY`, or `LIVEKIT_API_SECRET` to LiveKit Cloud.
- **Optional secrets**: OTEL secrets are pushed only if they exist in the vault, allowing observability to be opt-in.
- **Non-sensitive vars excluded**: Values like `GODADDY_DOMAIN`, `GOOGLE_REDIRECT_URI`, `TIGRIS_BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, and `OTEL_SERVICE_NAME` live in `fly.toml [env]` (web) or `Dockerfile ENV` (agent). They are not pushed as secrets. The vault stores them as the single source of truth, but the config files are the delivery mechanism.

### Emergency Revocation

If a secret is compromised, revoke all active leases immediately:

```bash
secrets revoke --all
```

Then rotate the compromised credential, re-add it to the vault, and re-run the deploy script.

### Audit

Every lease, revocation, and rotation is logged:

```bash
secrets audit              # Last 50 entries
secrets audit --tail 100   # Last 100 entries
```

### Secret Inventory

Env vars are delivered through two channels. **Config** values live in `fly.toml [env]` (web) or `Dockerfile ENV` (agent) and are committed to the repo. **Secret** values are pushed from the vault via `deploy-secrets.sh` and never appear in source control. Both channels are stored in the vault as the single source of truth.

| Env Var | Vault Name | Source | Fly.io (Web) | LiveKit Cloud (Agent) | Notes |
|---------|-----------|--------|:---:|:---:|-------|
| `DATABASE_URL` | `phonetastic_database_url` | secret | Yes | Yes | Pooled Neon connection |
| `DIRECT_DATABASE_URL` | `phonetastic_direct_database_url` | secret | Yes | No | Direct Neon connection (migrations only) |
| `APP_KEY` | `phonetastic_app_key` | secret | Yes | Yes | Encryption key |
| `GOOGLE_API_KEY` | `phonetastic_google_api_key` | secret | Yes | Yes | Gemini LLM (BAML + LiveKit agent plugin) |
| `LIVEKIT_URL` | `phonetastic_livekit_url` | secret | Yes | **No** | Auto-injected on LiveKit Cloud |
| `LIVEKIT_API_KEY` | `phonetastic_livekit_api_key` | secret | Yes | **No** | Auto-injected on LiveKit Cloud |
| `LIVEKIT_API_SECRET` | `phonetastic_livekit_api_secret` | secret | Yes | **No** | Auto-injected on LiveKit Cloud |
| `TWILIO_ACCOUNT_SID` | `phonetastic_twilio_account_sid` | secret | Yes | No | |
| `TWILIO_AUTH_TOKEN` | `phonetastic_twilio_auth_token` | secret | Yes | No | |
| `TWILIO_VERIFY_SERVICE_SID` | `phonetastic_twilio_verify_service_sid` | secret | Yes | No | |
| `RESEND_API_KEY` | `phonetastic_resend_api_key` | secret | Yes | No | |
| `RESEND_WEBHOOK_SECRET` | `phonetastic_resend_webhook_secret` | secret | Yes | No | |
| `GODADDY_API_KEY` | `phonetastic_godaddy_api_key` | secret | Yes | No | |
| `GODADDY_API_SECRET` | `phonetastic_godaddy_api_secret` | secret | Yes | No | |
| `GODADDY_DOMAIN` | `phonetastic_godaddy_domain` | config | Yes | No | fly.toml `[env]` |
| `GOOGLE_CLIENT_ID` | `phonetastic_google_client_id` | secret | Yes | No | |
| `GOOGLE_CLIENT_SECRET` | `phonetastic_google_client_secret` | secret | Yes | No | |
| `GOOGLE_REDIRECT_URI` | `phonetastic_google_redirect_uri` | config | Yes | No | fly.toml `[env]` |
| `FIRECRAWL_API_KEY` | `phonetastic_firecrawl_api_key` | secret | Yes | No | |
| `OPENAI_API_KEY` | `phonetastic_openai_api_key` | secret | Yes | Yes | Embeddings (web) + agent LLM |
| `DEEPGRAM_API_KEY` | `phonetastic_deepgram_api_key` | secret | Yes | Yes | Web needs it for LiveKit service config |
| `CARTESIA_API_KEY` | `phonetastic_cartesia_api_key` | secret | No | Yes | TTS, agent only |
| `TIGRIS_BUCKET_NAME` | `phonetastic_tigris_bucket_name` | config | Yes | No | fly.toml `[env]` |
| `AWS_ENDPOINT_URL_S3` | `phonetastic_aws_endpoint_url_s3` | config | Yes | No | fly.toml `[env]` |
| `AWS_REGION` | `phonetastic_aws_region` | config | Yes | No | fly.toml `[env]` |
| `OTEL_SERVICE_NAME` | `phonetastic_otel_service_name_web` | config | Yes | No | fly.toml `[env]` |
| `OTEL_SERVICE_NAME` | `phonetastic_otel_service_name_agent` | config | No | Yes | Dockerfile `ENV` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `phonetastic_otel_exporter_otlp_endpoint` | secret | Optional | Optional | |
| `OTEL_EXPORTER_OTLP_HEADERS` | `phonetastic_otel_exporter_otlp_headers` | secret | Optional | Optional | |
| `OTEL_SERVICE_NAME` | — | Yes (static) | Yes (static) | Different value per service |

---

## Scale the Web Server — Implements UC-D6

### Horizontal Scaling

```bash
# Scale to 2 machines in primary region
fly scale count 2

# Scale across regions
fly scale count 2 --region iad,ewr
```

### Autostop / Autostart

Configured in `fly.toml`:

```toml
[http_service]
auto_stop_machines = "stop"      # Stop idle machines (no CPU/RAM charges)
auto_start_machines = true       # Restart on incoming requests
min_machines_running = 1         # Keep 1 machine always running in primary region
```

This keeps costs low during off-peak while ensuring at least one machine is always ready to serve requests without cold-start latency.

### Vertical Scaling

Update `fly.toml` and redeploy:

```toml
[[vm]]
size = "shared-cpu-4x"
memory = "2gb"
```

CLI changes via `fly scale vm` reset on next deploy — always update `fly.toml`.

---

## Monitor Deployments — Implements UC-D7

### Web Server (Fly.io)

```bash
fly status                 # Machine status, regions, health
fly logs                   # Live log stream
fly checks list            # Health check status
```

### Phone Agent (LiveKit Cloud)

```bash
lk agent status            # Replica count, deployment status
lk agent logs              # Live log stream
```

### Database (Neon)

- **Console dashboard**: Query performance, connection counts, compute usage
- **`pg_stat_statements`**: Top queries by time, calls, rows
- **`pg_stat_activity`**: Active connections and their state

### OpenTelemetry

Both services emit traces and logs to the configured OTLP endpoint when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. The web server uses `phonetastic-web` as service name; the agent uses `phonetastic-agent`.

---

# Data Model Changes

## Environment Variable Schema Update

The `envSchema` in `src/config/env.ts` must be updated to support `DATABASE_URL` as a single connection string:

```typescript
// Add
DATABASE_URL: z.string().url().optional(),
DIRECT_DATABASE_URL: z.string().url().optional(),

// Keep existing DB_HOST, DB_PORT, etc. for local development fallback
```

The `buildDbUrl()` function in `src/db/index.ts` must prefer `DATABASE_URL` when set:

```typescript
export function buildDbUrl(): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_DATABASE } = env;
  const auth = DB_PASSWORD ? `${DB_USER}:${DB_PASSWORD}` : DB_USER;
  return `postgresql://${auth}@${DB_HOST}:${DB_PORT}/${DB_DATABASE}`;
}
```

The migration script must use `DIRECT_DATABASE_URL`:

```typescript
export function buildDirectDbUrl(): string {
  if (env.DIRECT_DATABASE_URL) return env.DIRECT_DATABASE_URL;
  return buildDbUrl(); // Fall back to regular URL for local dev
}
```

No database schema changes are required. The `drizzle/` migrations and DBOS system tables remain unchanged.

---

# File Inventory

| File | Purpose | New/Modified |
|------|---------|:---:|
| `Dockerfile` | Web server Docker image | New |
| `Dockerfile.agent` | Phone agent Docker image | New |
| `.dockerignore` | Excludes from Docker build context | New |
| `fly.toml` | Fly.io web server configuration | New |
| `livekit.toml` | LiveKit Cloud agent configuration | New (generated by `lk agent create`) |
| `scripts/deploy-secrets.sh` | Leases secrets from vault and pushes to Fly.io / LiveKit Cloud | New |
| `src/config/env.ts` | Add `DATABASE_URL`, `DIRECT_DATABASE_URL` | Modified |
| `src/db/index.ts` | `buildDbUrl()` prefers `DATABASE_URL` | Modified |
| `src/db/migrate.ts` | Use `DIRECT_DATABASE_URL` for migrations | Modified |

---

# Deployment Sequence

First-time setup runs these use cases in order:

~~~mermaid
graph LR
    D1[UC-D1<br/>Provision Database] --> D4[UC-D4<br/>Configure Secrets]
    D4 --> D2[UC-D2<br/>Deploy Web Server]
    D4 --> D3[UC-D3<br/>Deploy Agent]
    D2 --> D7[UC-D7<br/>Monitor]
    D3 --> D7
~~~

1. **UC-D1**: Provision Neon database, enable pgvector, record connection strings.
2. **UC-D4**: Set secrets on Fly.io and LiveKit Cloud.
3. **UC-D2 + UC-D3**: Deploy web server and agent in parallel. Web server's release command runs migrations (UC-D5).
4. **UC-D7**: Verify health across all three components.

Subsequent deploys are independent — the web server and agent can be deployed separately since they share no runtime coupling beyond the database.

---

# Region Strategy

| Component | Region | Provider Region ID | Rationale |
|-----------|--------|-------------------|-----------|
| Web server | US East (Virginia) | Fly.io `iad` | Low latency to US users, close to database |
| Agent | Auto (LiveKit Cloud) | LiveKit-managed | LiveKit Cloud places agents near its SIP infrastructure |
| Database | US East (Ohio) | Neon `aws-us-east-2` | Closest Neon region to Fly.io `iad` |

Latency between `iad` (Virginia) and `us-east-2` (Ohio) is ~10ms. This is acceptable for database queries. Neon does not offer `us-east-1` (Virginia) for all plans — verify availability during provisioning.

---

# Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | Should DBOS migrations run in the same release command as Drizzle, or in a separate step? | Affects release command reliability. If DBOS migrate fails after Drizzle succeeds, partial migration state results. |
| 2 | Does the agent need `DIRECT_DATABASE_URL`? It does not run migrations, but DBOS may need a non-pooled connection for its system tables. | Verify DBOS behavior with PgBouncer. |
| 3 | Should we set up a staging Neon branch and a staging Fly.io app? | Not required for initial deploy but recommended before accepting production traffic. |
| 4 | What Neon plan is needed? Free tier has mandatory scale-to-zero and limited branches. | Production requires a paid plan to disable scale-to-zero. |
| 5 | Is a CI/CD pipeline (GitHub Actions) in scope for this design? | Currently manual deploys via CLI. Automation is a follow-up. |
