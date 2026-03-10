#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_FORMULA="postgresql@17"

log()   { echo "==> $1"; }
error() { echo "ERROR: $1" >&2; exit 1; }

# ── 1. PostgreSQL ──────────────────────────────────────────────────────────────

if ! command -v psql &>/dev/null; then
  if ! brew list "$PG_FORMULA" &>/dev/null; then
    log "Installing $PG_FORMULA via Homebrew..."
    brew install "$PG_FORMULA"
  fi
  export PATH="$(brew --prefix "$PG_FORMULA")/bin:$PATH"
fi

if ! brew services list | grep -q "${PG_FORMULA}.*started"; then
  log "Starting PostgreSQL..."
  brew services start "$PG_FORMULA"
  sleep 3
fi

# ── 2. Environment file ────────────────────────────────────────────────────────

ENV_FILE="$ROOT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Creating .env from .env.example..."
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  log "NOTICE: .env created — edit it to fill in API keys before running the app."
fi

# ── 3. Configure PostgreSQL for the application ────────────────────────────────

parse_env() { grep "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '"'; }

DB_USER="${DB_USER:-$(parse_env DB_USER)}"
DB_PASSWORD="${DB_PASSWORD:-$(parse_env DB_PASSWORD)}"
DB_HOST="${DB_HOST:-$(parse_env DB_HOST)}"
DB_PORT="${DB_PORT:-$(parse_env DB_PORT)}"
DB_DATABASE="${DB_DATABASE:-$(parse_env DB_DATABASE)}"

DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_DATABASE="${DB_DATABASE:-phonetastic_dev}"

PSQL_ADMIN="psql -h $DB_HOST -p $DB_PORT -U $(whoami) postgres"

role_exists() { $PSQL_ADMIN -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null | grep -q 1; }
db_exists()   { $PSQL_ADMIN -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_DATABASE'" 2>/dev/null | grep -q 1; }

if ! role_exists; then
  log "Creating PostgreSQL role '$DB_USER'..."
  if [ -n "$DB_PASSWORD" ]; then
    $PSQL_ADMIN -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';"
  else
    $PSQL_ADMIN -c "CREATE ROLE $DB_USER WITH LOGIN SUPERUSER;"
  fi
fi

if ! db_exists; then
  log "Creating database '$DB_DATABASE'..."
  $PSQL_ADMIN -c "CREATE DATABASE $DB_DATABASE OWNER $DB_USER;"
fi

# ── 4. Ngrok ───────────────────────────────────────────────────────────────────

if ! command -v ngrok &>/dev/null; then
  log "Installing ngrok via Homebrew..."
  brew install ngrok
fi

NGROK_AUTHTOKEN="${NGROK_AUTHTOKEN:-$(parse_env NGROK_AUTHTOKEN)}"

if [ -z "$NGROK_AUTHTOKEN" ] || [ "$NGROK_AUTHTOKEN" = "your-ngrok-authtoken" ]; then
  log "NOTICE: NGROK_AUTHTOKEN is not set. Skipping ngrok auth."
  log "  To set up the tunnel, add your token from https://dashboard.ngrok.com/get-started/your-authtoken"
  log "  and claim a free static domain at https://dashboard.ngrok.com/cloud-edge/domains"
  log "  Once you have a domain, set NGROK_DOMAIN in your .env file and send this value to Jordan for configuration."
else
  log "Configuring ngrok authtoken..."
  ngrok config add-authtoken "$NGROK_AUTHTOKEN"
fi

# ── 5. Install packages ────────────────────────────────────────────────────────

log "Installing npm packages..."
cd "$ROOT_DIR"
npm install

# ── 6. Generate BAML client ────────────────────────────────────────────────────

log "Generating BAML client..."
npx baml-cli generate

# ── 7. Enable pgvector extension ──────────────────────────────────────────────

log "Enabling pgvector extension..."
bash "$ROOT_DIR/scripts/enable-pgvector.sh"

# ── 8. Drizzle migrations ────────────────────────────────────────────────────

log "Running Drizzle migrations..."
npm run db:migrate

# ── 9. Test schema setup ────────────────────────────────────────────────────

log "Creating test schema and running migrations..."
npm run db:migrate:test

# ── 10. DBOS migrations ─────────────────────────────────────────────────────

log "Running DBOS migrations..."
npx dbos migrate

# ── 11. Seed voices ─────────────────────────────────────────────────────────

log "Seeding voices..."
npm run db:seed-voices

# ── 12. Build ────────────────────────────────────────────────────────────────

log "Building application..."
npm run build

# ── 13. Confirm environment ─────────────────────────────────────────────────

echo ""
log "Before continuing, make sure all API keys and service credentials are filled in at: $ENV_FILE"
echo ""
read -rp "Ready to continue? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  exit 1
fi

# ── 14. Tunnel ───────────────────────────────────────────────────────────────

log "Starting ngrok tunnel..."
npm run tunnel&

# ── 15. Start ────────────────────────────────────────────────────────────────

log "Starting application..."
npm start
