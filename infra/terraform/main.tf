locals {
  name_prefix     = replace(var.project_name, "_", "-")
  ecr_image       = "${aws_ecr_repository.backend.repository_url}:${var.image_tag}"
  container_image = var.backend_image != "" ? var.backend_image : local.ecr_image

  tags = merge(
    {
      Project   = var.project_name
      ManagedBy = "terraform"
    },
    var.resource_tags
  )

  lambda_environment = {
    QUEUE_DRIVER                      = "sqs"
    SUPABASE_URL                      = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY         = var.supabase_service_role_key
    OPENAI_API_KEY                    = var.openai_api_key
    FREE_TIER_LIMIT                   = tostring(var.free_tier_limit)
    CLUSTER_NAME_CONCURRENCY          = tostring(var.cluster_name_concurrency)
    CLUSTER_NAME_MAX_RETRIES          = tostring(var.cluster_name_max_retries)
    CLUSTER_NAME_BASE_BACKOFF_MS      = tostring(var.cluster_name_base_backoff_ms)
    CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI = tostring(var.cluster_name_min_bookmarks_for_ai)
    INGEST_QUEUE_URL                  = aws_sqs_queue.ingest.url
    ENRICHMENT_QUEUE_URL              = aws_sqs_queue.enrichment.url
    EMBEDDING_QUEUE_URL               = aws_sqs_queue.embedding.url
    CLUSTERING_QUEUE_URL              = aws_sqs_queue.clustering.url
  }
}

data "aws_caller_identity" "current" {}

resource "aws_ecr_repository" "backend" {
  name                 = "${local.name_prefix}-backend-lambda"
  image_tag_mutability = "MUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

resource "null_resource" "build_push_backend" {
  count = var.build_backend_image && var.backend_image == "" ? 1 : 0

  triggers = {
    image_tag            = var.image_tag
    dockerfile_hash      = filesha256("${path.module}/../../apps/backend/Dockerfile.lambda")
    backend_package_hash = filesha256("${path.module}/../../apps/backend/package.json")
    lockfile_hash        = filesha256("${path.module}/../../pnpm-lock.yaml")
    source_hash = sha1(join("", [
      for file in sort(fileset("${path.module}/../../apps/backend/src", "**")) :
      filesha256("${path.module}/../../apps/backend/src/${file}")
    ]))
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-lc"]
    command     = <<-EOT
      set -euo pipefail
      ECR_REGISTRY="${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
      aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin "$ECR_REGISTRY"
      docker build --platform linux/amd64 -f ${path.module}/../../apps/backend/Dockerfile.lambda -t ${aws_ecr_repository.backend.repository_url}:${var.image_tag} ${path.module}/../..
      docker push ${aws_ecr_repository.backend.repository_url}:${var.image_tag}
    EOT
  }
}

resource "aws_sqs_queue" "ingest" {
  name                       = "${local.name_prefix}-ingest"
  visibility_timeout_seconds = var.worker_timeout_seconds + 30
  message_retention_seconds  = 1209600
  tags                       = local.tags
}

resource "aws_sqs_queue" "enrichment" {
  name                       = "${local.name_prefix}-enrichment"
  visibility_timeout_seconds = var.worker_timeout_seconds + 30
  message_retention_seconds  = 1209600
  tags                       = local.tags
}

resource "aws_sqs_queue" "embedding" {
  name                       = "${local.name_prefix}-embedding"
  visibility_timeout_seconds = var.worker_timeout_seconds + 30
  message_retention_seconds  = 1209600
  tags                       = local.tags
}

resource "aws_sqs_queue" "clustering" {
  name                       = "${local.name_prefix}-clustering"
  visibility_timeout_seconds = var.worker_timeout_seconds + 30
  message_retention_seconds  = 1209600
  tags                       = local.tags
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name_prefix}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_sqs" {
  name = "${local.name_prefix}-lambda-sqs"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = [
          aws_sqs_queue.ingest.arn,
          aws_sqs_queue.enrichment.arn,
          aws_sqs_queue.embedding.arn,
          aws_sqs_queue.clustering.arn
        ]
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name = "${local.name_prefix}-api"
  package_type  = "Image"
  image_uri     = local.container_image
  role          = aws_iam_role.lambda.arn
  timeout       = var.api_timeout_seconds
  memory_size   = var.api_memory_mb

  image_config {
    command = ["dist/lambda/api.handler"]
  }

  environment {
    variables = local.lambda_environment
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy.lambda_sqs,
    null_resource.build_push_backend
  ]

  tags = local.tags
}

resource "aws_lambda_function" "ingest_worker" {
  function_name = "${local.name_prefix}-ingest-worker"
  package_type  = "Image"
  image_uri     = local.container_image
  role          = aws_iam_role.lambda.arn
  timeout       = var.worker_timeout_seconds
  memory_size   = var.worker_memory_mb

  image_config {
    command = ["dist/lambda/worker.ingestHandler"]
  }

  environment {
    variables = local.lambda_environment
  }

  depends_on = [aws_lambda_function.api]
  tags       = local.tags
}

resource "aws_lambda_function" "enrichment_worker" {
  function_name = "${local.name_prefix}-enrichment-worker"
  package_type  = "Image"
  image_uri     = local.container_image
  role          = aws_iam_role.lambda.arn
  timeout       = var.worker_timeout_seconds
  memory_size   = var.worker_memory_mb

  image_config {
    command = ["dist/lambda/worker.enrichmentHandler"]
  }

  environment {
    variables = local.lambda_environment
  }

  depends_on = [aws_lambda_function.api]
  tags       = local.tags
}

resource "aws_lambda_function" "embedding_worker" {
  function_name = "${local.name_prefix}-embedding-worker"
  package_type  = "Image"
  image_uri     = local.container_image
  role          = aws_iam_role.lambda.arn
  timeout       = var.worker_timeout_seconds
  memory_size   = var.worker_memory_mb

  image_config {
    command = ["dist/lambda/worker.embeddingHandler"]
  }

  environment {
    variables = local.lambda_environment
  }

  depends_on = [aws_lambda_function.api]
  tags       = local.tags
}

resource "aws_lambda_function" "clustering_worker" {
  function_name = "${local.name_prefix}-clustering-worker"
  package_type  = "Image"
  image_uri     = local.container_image
  role          = aws_iam_role.lambda.arn
  timeout       = var.clustering_timeout_seconds
  memory_size   = var.clustering_memory_mb

  image_config {
    command = ["dist/lambda/worker.clusteringHandler"]
  }

  environment {
    variables = local.lambda_environment
  }

  depends_on = [aws_lambda_function.api]
  tags       = local.tags
}

resource "aws_lambda_event_source_mapping" "ingest" {
  event_source_arn        = aws_sqs_queue.ingest.arn
  function_name           = aws_lambda_function.ingest_worker.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "enrichment" {
  event_source_arn        = aws_sqs_queue.enrichment.arn
  function_name           = aws_lambda_function.enrichment_worker.arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "embedding" {
  event_source_arn        = aws_sqs_queue.embedding.arn
  function_name           = aws_lambda_function.embedding_worker.arn
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "clustering" {
  event_source_arn        = aws_sqs_queue.clustering.arn
  function_name           = aws_lambda_function.clustering_worker.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_apigatewayv2_api" "backend" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["*"]
    allow_methods = ["*"]
    allow_origins = ["*"]
  }

  tags = local.tags
}

resource "aws_apigatewayv2_integration" "backend" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "backend" {
  api_id    = aws_apigatewayv2_api.backend.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.backend.id}"
}

resource "aws_apigatewayv2_route" "backend_root" {
  api_id    = aws_apigatewayv2_api.backend.id
  route_key = "ANY /"
  target    = "integrations/${aws_apigatewayv2_integration.backend.id}"
}

resource "aws_apigatewayv2_stage" "backend" {
  api_id      = aws_apigatewayv2_api.backend.id
  name        = "$default"
  auto_deploy = true

  tags = local.tags
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.backend.execution_arn}/*/*"
}
