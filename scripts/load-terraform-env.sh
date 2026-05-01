#!/usr/bin/env bash
set -euo pipefail

set_env_if_present() {
  local key="$1"
  local value="$2"

  if [[ -z "$key" || "$key" == \#* ]]; then
    return
  fi

  if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    printf -v "$key" '%s' "$value"
    export "$key"
  fi
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" && "$line" != \#* && "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    set_env_if_present "$key" "$value"
  done < "$file"
}

load_env_file "apps/backend/.env.production"
load_env_file "apps/web/.env.production"
load_env_file "apps/extension/.env.production"

export TF_VAR_project_name="${TF_VAR_project_name:-link-loom-prod}"
export TF_VAR_aws_region="${TF_VAR_aws_region:-us-east-1}"
export TF_VAR_backend_image="${TF_VAR_backend_image:-}"
export TF_VAR_image_tag="${TF_VAR_image_tag:-v1}"
export TF_VAR_build_backend_image="${TF_VAR_build_backend_image:-true}"
export TF_VAR_api_memory_mb="${TF_VAR_api_memory_mb:-512}"
export TF_VAR_api_timeout_seconds="${TF_VAR_api_timeout_seconds:-30}"
export TF_VAR_worker_memory_mb="${TF_VAR_worker_memory_mb:-1024}"
export TF_VAR_worker_timeout_seconds="${TF_VAR_worker_timeout_seconds:-120}"
export TF_VAR_clustering_memory_mb="${TF_VAR_clustering_memory_mb:-2048}"
export TF_VAR_clustering_timeout_seconds="${TF_VAR_clustering_timeout_seconds:-900}"

export TF_VAR_supabase_url="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-${VITE_SUPABASE_URL:-}}}"
export TF_VAR_supabase_service_role_key="${SUPABASE_SERVICE_ROLE_KEY:-}"
export TF_VAR_openai_api_key="${OPENAI_API_KEY:-}"

export TF_VAR_free_tier_limit="${FREE_TIER_LIMIT:-500}"
export TF_VAR_cluster_name_concurrency="${CLUSTER_NAME_CONCURRENCY:-4}"
export TF_VAR_cluster_name_max_retries="${CLUSTER_NAME_MAX_RETRIES:-5}"
export TF_VAR_cluster_name_base_backoff_ms="${CLUSTER_NAME_BASE_BACKOFF_MS:-400}"
export TF_VAR_cluster_name_min_bookmarks_for_ai="${CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI:-12}"

exec "$@"
