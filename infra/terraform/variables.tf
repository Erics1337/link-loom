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

variable "alb_ingress_cidrs" {
  description = "CIDR ranges allowed to hit the ALB listener(s)."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_https" {
  description = "Enable HTTPS listener on the ALB."
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener. Required when enable_https=true."
  type        = string
  default     = null
}

variable "backend_image" {
  description = "Optional prebuilt image URI. If empty, Terraform expects ECR image at repository_url:image_tag."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Image tag to deploy when backend_image is empty."
  type        = string
  default     = "latest"
}

variable "build_backend_image" {
  description = "Build and push backend Docker image to ECR during terraform apply."
  type        = bool
  default     = true
}

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 2048
}

variable "desired_count" {
  description = "Number of ECS tasks to run."
  type        = number
  default     = 1
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.t4g.small"
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
