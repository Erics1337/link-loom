output "aws_account_id" {
  description = "AWS account where resources were deployed."
  value       = data.aws_caller_identity.current.account_id
}

output "ecr_repository_url" {
  description = "ECR repository URL for backend images."
  value       = aws_ecr_repository.backend.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.backend.name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.backend.name
}

output "alb_dns_name" {
  description = "Public DNS name for the backend ALB."
  value       = aws_lb.backend.dns_name
}

output "api_base_url" {
  description = "Base URL to configure as VITE_BACKEND_URL in the extension."
  value       = var.enable_https ? "https://${aws_lb.backend.dns_name}" : "http://${aws_lb.backend.dns_name}"
}

output "redis_primary_endpoint" {
  description = "Internal Redis endpoint used by ECS tasks."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}
