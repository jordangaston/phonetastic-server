---
tags: use-cases, deployment, infrastructure
summary: "Use case document for deploying phonetastic web server to Fly.io, phone agent to LiveKit Cloud, and database to Neon"
locked: false
---

# Deployment — Use Cases

## System Purpose

Deploy the phonetastic platform to production: the web server on Fly.io, the phone agent on LiveKit Cloud, and the database on Neon managed Postgres.

## Actors

| Actor | Description |
|-------|-------------|
| **Operator** | A developer or DevOps engineer who deploys, configures, and monitors the platform. Has access to Fly.io, LiveKit Cloud, and Neon dashboards and CLIs. |
| **Fly.io** | The hosting platform for the web server. Builds Docker images, runs machines, manages secrets, and routes HTTP traffic. |
| **LiveKit Cloud** | The managed hosting platform for the phone agent. Builds Docker images, runs agent instances, dispatches voice call jobs, and auto-scales. |
| **Neon** | The managed serverless Postgres provider. Hosts the database, provides pooled and direct connection endpoints, and handles autoscaling of compute. |
| **CI/CD** | The automated pipeline (e.g., GitHub Actions) that triggers deployments on code changes. |

## Glossary

| Term | Definition |
|------|------------|
| Pooled connection | A Neon connection string routed through PgBouncer (`-pooler` hostname). Used for application traffic. |
| Direct connection | A Neon connection string that bypasses PgBouncer. Required for schema migrations and DDL operations. |
| Release command | A Fly.io command that runs before new machines are started during a deploy. Used for database migrations. |
| Agent dispatch | The process by which LiveKit Cloud assigns an inbound phone call to an available agent instance. |
| CU (Compute Unit) | Neon's unit of compute capacity. 1 CU = ~4 GB RAM. |

---

## UC-D1: Provision the Database

**Primary Actor:** Operator

**Goal:** Create a Neon Postgres project with the required extensions and connection endpoints for production use.

### Preconditions
- Operator has a Neon account on a paid plan.
- No production database exists yet.

### Main Flow
1. Operator creates a Neon project in the target AWS region (matching the Fly.io app region).
2. Neon provisions a root branch (`main`), a default database (`phonetastic`), and a default role.
3. Operator enables the `pgvector` extension on the database.
4. Operator marks the root branch as protected.
5. Operator configures autoscaling (min and max CU).
6. Operator records the pooled and direct connection strings.

### Postconditions
- A Neon project exists with `pgvector` enabled.
- The root branch is protected against deletion and reset.
- Both pooled and direct connection strings are available.

### Extensions
- **1a.** Operator wants a staging environment → Create a child branch from `main` with its own connection strings.
- **5a.** Operator disables scale-to-zero for production → Set `suspend_timeout_seconds` via Neon API.

---

## UC-D2: Deploy the Web Server to Fly.io

**Primary Actor:** Operator

**Goal:** Deploy the phonetastic web server as a Fly.io application accessible over HTTPS.

### Preconditions
- The Neon database is provisioned (UC-D1).
- Secrets are configured for the web application (UC-D4).
- Operator has the Fly.io CLI (`flyctl`) installed and authenticated.
- The repository contains a `Dockerfile` and `fly.toml` for the web server.

### Main Flow
1. Operator runs `fly launch` (first deploy) or `fly deploy` (subsequent deploys).
2. Fly.io builds the Docker image using the multi-stage `Dockerfile`.
3. Fly.io executes the release command, which runs Drizzle and DBOS migrations against the Neon direct connection.
4. Fly.io starts new machines running the web server process.
5. Fly.io health-checks the `/health` endpoint.
6. Fly.io routes HTTPS traffic to healthy machines.

### Postconditions
- The web server is running and reachable at `https://<app-name>.fly.dev`.
- The database schema is up to date.
- Health checks are passing.

### Extensions
- **2a.** Docker build fails → Deploy aborts. Operator fixes the build error and redeploys.
- **3a.** Migration fails → Release command exits non-zero. Deploy aborts. No machines are updated. Operator fixes the migration and redeploys.
- **3b.** DBOS migration fails → Same as 3a.
- **5a.** Health check fails → Fly.io does not route traffic to the unhealthy machine. If all machines fail, the previous version remains active (rolling deploy).
- **6a.** Operator needs a custom domain → Configure DNS and TLS certificate via `fly certs add`.

---

## UC-D3: Deploy the Phone Agent to LiveKit Cloud

**Primary Actor:** Operator

**Goal:** Deploy the phonetastic phone agent to LiveKit Cloud so it can receive dispatched voice calls.

### Preconditions
- The Neon database is provisioned (UC-D1).
- Secrets are configured for the phone agent (UC-D4).
- Operator has the LiveKit CLI (`lk`) installed and authenticated.
- The repository contains a `Dockerfile` and `livekit.toml` for the agent.

### Main Flow
1. Operator runs `lk agent create` (first deploy) or `lk agent deploy` (subsequent deploys).
2. LiveKit Cloud uploads the source code and builds the Docker image.
3. LiveKit Cloud starts new agent instances alongside existing ones (rolling deploy).
4. New instances pass the health check on port 8081.
5. LiveKit Cloud routes new call dispatch jobs to healthy new instances.
6. Old instances drain active calls, then shut down.

### Postconditions
- Agent instances are running and registered with LiveKit Cloud.
- Inbound phone calls are dispatched to the agent.
- Health checks are passing.

### Extensions
- **2a.** Docker build fails → Deploy aborts. Operator fixes and redeploys.
- **2b.** Build exceeds 10-minute timeout or 1 GB context limit → Operator reduces build context via `.dockerignore` or optimizes the Dockerfile.
- **4a.** Health check does not pass within 5 minutes → Deploy fails. Operator investigates `prewarm` or startup errors via `lk agent logs`.
- **6a.** Active calls take longer than the drain timeout → LiveKit Cloud terminates remaining sessions. Operator increases `drain_timeout` if needed.

---

## UC-D4: Configure Secrets

**Primary Actor:** Operator

**Goal:** Store all credentials in the local `agent-secrets` encrypted vault and push them to Fly.io and LiveKit Cloud.

### Preconditions
- Operator has `agent-secrets` CLI installed and initialized (`secrets init`).
- All third-party API keys and connection strings are available.

### Main Flow
1. Operator adds each secret to the local vault using `secrets add <name>`.
2. Operator runs the deploy script `scripts/deploy-secrets.sh web`, which leases each web-server secret from the vault and pipes it to `fly secrets set --stage`.
3. Operator runs the deploy script `scripts/deploy-secrets.sh agent`, which leases each agent secret from the vault and pipes it to `lk agent update-secrets`.
4. Operator deploys the staged Fly.io secrets with `fly secrets deploy` (or lets the next `fly deploy` pick them up).

### Postconditions
- All secrets are encrypted at rest in `~/.agent-secrets/`.
- The web server has all required secrets (DATABASE_URL, DIRECT_DATABASE_URL, APP_KEY, TWILIO_*, RESEND_*, GODADDY_*, GOOGLE_*, FIRECRAWL_*, OPENAI_API_KEY, LIVEKIT_*, OTEL_*, TIGRIS_*).
- The agent has all required secrets (DATABASE_URL, APP_KEY, DEEPGRAM_API_KEY, CARTESIA_API_KEY, OPENAI_API_KEY).
- No plaintext secrets exist in source code, Docker images, or shell history.
- An audit log entry exists for every secret lease.

### Extensions
- **1a.** Secret already exists in the vault → Operator updates it by re-running `secrets add <name>` (overwrites).
- **2a.** A secret has a rotation hook (e.g., `gh auth refresh`) → The vault auto-rotates it on lease expiry. The deploy script leases a fresh value each time.
- **3a.** LiveKit Cloud auto-injects LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET → The deploy script must NOT push these to LiveKit Cloud. Setting them causes conflicts.
- **4a.** Operator wants to revoke all active leases immediately → Runs `secrets revoke --all` (killswitch).

---

## UC-D5: Run Database Migrations

**Primary Actor:** CI/CD (or Operator manually)

**Goal:** Apply pending schema changes to the production database before new application code runs.

### Preconditions
- The Neon database is provisioned (UC-D1).
- Pending Drizzle migration files exist in `drizzle/`.
- The direct (non-pooled) connection string is available.

### Main Flow
1. The Fly.io release command executes during deploy (UC-D2 step 3).
2. The migration script connects to Neon using the direct connection string.
3. Drizzle migrations run in order, applying pending DDL changes.
4. DBOS system migrations run.
5. The migration script exits with code 0.

### Postconditions
- All pending migrations have been applied.
- The database schema matches the deployed code's expectations.

### Extensions
- **2a.** Migration uses pooled connection → Migration fails with PgBouncer errors on DDL. Operator must use the direct connection string.
- **3a.** A migration fails → Script exits non-zero. Fly.io aborts the deploy. Operator reverts or fixes the migration.
- **3b.** Migration is not idempotent and a partial failure occurs → Operator must manually inspect the database state and resolve.

---

## UC-D6: Scale the Web Server

**Primary Actor:** Operator

**Goal:** Adjust the web server's capacity to handle traffic changes.

### Preconditions
- The web server is deployed (UC-D2).

### Main Flow
1. Operator adjusts machine count via `fly scale count` or configures autostop/autostart in `fly.toml`.
2. Fly.io starts or stops machines accordingly.
3. Traffic is load-balanced across running machines.

### Postconditions
- The desired number of machines are running.
- Traffic is distributed across healthy machines.

### Extensions
- **1a.** Operator scales vertically → Updates `[[vm]]` in `fly.toml` and redeploys. CLI-only changes (`fly scale vm`) reset on next deploy.
- **1b.** Operator enables autostop → Machines stop when idle and restart on incoming requests. `min_machines_running` keeps at least N running in the primary region.

---

## UC-D7: Monitor Deployments

**Primary Actor:** Operator

**Goal:** Verify that deployed services are healthy and performing correctly.

### Preconditions
- At least one service is deployed.

### Main Flow
1. Operator checks web server status via `fly status` and `fly logs`.
2. Operator checks agent status via `lk agent status` and `lk agent logs`.
3. Operator checks database metrics via the Neon console.
4. If OpenTelemetry is configured, operator views traces and logs in the observability platform.

### Postconditions
- Operator has visibility into the health and performance of all three components.

### Extensions
- **1a.** Web server health check is failing → Operator reads logs, identifies the issue, and redeploys or rolls back.
- **2a.** Agent is not accepting calls → Operator checks `lk agent logs` for registration or health check errors.
- **3a.** Database connections are saturated → Operator increases Neon CU or investigates connection leaks via `pg_stat_activity`.
