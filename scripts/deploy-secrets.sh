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
    if secrets lease "$vault_name" --ttl 5m --client-id "deploy-${target}" >/dev/null 2>&1; then
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
