output "aws_account_id" {
  description = "AWS account where resources were deployed."
  value       = data.aws_caller_identity.current.account_id
}

output "ecr_repository_url" {
  description = "ECR repository URL for backend Lambda images."
  value       = aws_ecr_repository.backend.repository_url
}

output "api_base_url" {
  description = "Base URL to configure as VITE_BACKEND_URL in the extension."
  value       = aws_apigatewayv2_api.backend.api_endpoint
}

output "ingest_queue_url" {
  description = "SQS queue URL for ingest jobs."
  value       = aws_sqs_queue.ingest.url
}

output "enrichment_queue_url" {
  description = "SQS queue URL for enrichment jobs."
  value       = aws_sqs_queue.enrichment.url
}

output "embedding_queue_url" {
  description = "SQS queue URL for embedding jobs."
  value       = aws_sqs_queue.embedding.url
}

output "clustering_queue_url" {
  description = "SQS queue URL for clustering jobs."
  value       = aws_sqs_queue.clustering.url
}
