#!/usr/bin/env bash
set -euo pipefail

# Enables the pgvector extension on the local development database.
# Usage: bash scripts/enable-pgvector.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

log()   { echo "==> $1"; }
error() { echo "ERROR: $1" >&2; exit 1; }

parse_env() { grep "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '"'; }

if [ ! -f "$ENV_FILE" ]; then
  error ".env file not found. Run setup.sh first."
fi

DB_USER="${DB_USER:-$(parse_env DB_USER)}"
DB_HOST="${DB_HOST:-$(parse_env DB_HOST)}"
DB_PORT="${DB_PORT:-$(parse_env DB_PORT)}"
DB_DATABASE="${DB_DATABASE:-$(parse_env DB_DATABASE)}"

DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_DATABASE="${DB_DATABASE:-phonetastic_dev}"

log "Enabling pgvector extension on $DB_DATABASE..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_DATABASE" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"

log "pgvector extension enabled."
