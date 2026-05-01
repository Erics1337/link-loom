variable "project_name" {
  description = "Name prefix used for AWS resources."
  type        = string
  default     = "link-loom"
}

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "backend_image" {
  description = "Optional prebuilt Lambda container image URI. If empty, Terraform builds and pushes the backend image."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Image tag to deploy when backend_image is empty."
  type        = string
  default     = "latest"
}

variable "build_backend_image" {
  description = "Build and push backend Lambda Docker image to ECR during terraform apply."
  type        = bool
  default     = true
}

variable "api_memory_mb" {
  description = "Memory for the API Lambda."
  type        = number
  default     = 512
}

variable "api_timeout_seconds" {
  description = "Timeout for the API Lambda."
  type        = number
  default     = 30
}

variable "worker_memory_mb" {
  description = "Memory for ingest/enrichment/embedding worker Lambdas."
  type        = number
  default     = 1024
}

variable "worker_timeout_seconds" {
  description = "Timeout for ingest/enrichment/embedding worker Lambdas."
  type        = number
  default     = 120
}

variable "clustering_memory_mb" {
  description = "Memory for the clustering worker Lambda."
  type        = number
  default     = 2048
}

variable "clustering_timeout_seconds" {
  description = "Timeout for the clustering worker Lambda."
  type        = number
  default     = 900
}

variable "free_tier_limit" {
  description = "Backend FREE_TIER_LIMIT value."
  type        = number
  default     = 500
}

variable "cluster_name_concurrency" {
  description = "Backend CLUSTER_NAME_CONCURRENCY value."
  type        = number
  default     = 4
}

variable "cluster_name_max_retries" {
  description = "Backend CLUSTER_NAME_MAX_RETRIES value."
  type        = number
  default     = 5
}

variable "cluster_name_base_backoff_ms" {
  description = "Backend CLUSTER_NAME_BASE_BACKOFF_MS value."
  type        = number
  default     = 400
}

variable "cluster_name_min_bookmarks_for_ai" {
  description = "Backend CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI value."
  type        = number
  default     = 12
}

variable "supabase_url" {
  description = "Hosted Supabase project URL used by backend workers/API."
  type        = string
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "Supabase service role key used by backend."
  type        = string
  sensitive   = true
}

variable "openai_api_key" {
  description = "OpenAI API key used for embeddings/cluster naming."
  type        = string
  sensitive   = true
}

variable "resource_tags" {
  description = "Additional tags merged into all resources."
  type        = map(string)
  default     = {}
}
