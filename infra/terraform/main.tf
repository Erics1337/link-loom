locals {
  name_prefix            = replace(var.project_name, "_", "-")
  backend_container_name = "backend"
  ecr_image              = "${aws_ecr_repository.backend.repository_url}:${var.image_tag}"
  container_image        = var.backend_image != "" ? var.backend_image : local.ecr_image
  redis_url              = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"

  tags = merge(
    {
      Project   = var.project_name
      ManagedBy = "terraform"
    },
    var.resource_tags
  )

  backend_environment = [
    { name = "FREE_TIER_LIMIT", value = tostring(var.free_tier_limit) },
    { name = "CLUSTER_NAME_CONCURRENCY", value = tostring(var.cluster_name_concurrency) },
    { name = "CLUSTER_NAME_MAX_RETRIES", value = tostring(var.cluster_name_max_retries) },
    { name = "CLUSTER_NAME_BASE_BACKOFF_MS", value = tostring(var.cluster_name_base_backoff_ms) },
    { name = "CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI", value = tostring(var.cluster_name_min_bookmarks_for_ai) }
  ]

  backend_secret_keys = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
    "REDIS_URL"
  ]
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_ecr_repository" "backend" {
  name                 = "${local.name_prefix}-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name_prefix}-backend"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_ecs_cluster" "backend" {
  name = "${local.name_prefix}-cluster"
  tags = local.tags
}

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "ALB security group"
  vpc_id      = data.aws_vpc.default.id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each          = toset(var.alb_ingress_cidrs)
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each          = var.enable_https ? toset(var.alb_ingress_cidrs) : toset([])
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_all_outbound" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "ecs" {
  name        = "${local.name_prefix}-ecs-sg"
  description = "ECS task security group"
  vpc_id      = data.aws_vpc.default.id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3333
  ip_protocol                  = "tcp"
  to_port                      = 3333
}

resource "aws_vpc_security_group_egress_rule" "ecs_all_outbound" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis-sg"
  description = "Redis security group"
  vpc_id      = data.aws_vpc.default.id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_ecs" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = 6379
  ip_protocol                  = "tcp"
  to_port                      = 6379
}

resource "aws_vpc_security_group_egress_rule" "redis_all_outbound" {
  security_group_id = aws_security_group.redis.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name_prefix}-redis-subnets"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.name_prefix}-redis"
  description                = "Redis for ${var.project_name} BullMQ queues"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  port                       = 6379
  parameter_group_name       = "default.redis7"
  num_cache_clusters         = 1
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  automatic_failover_enabled = false
  multi_az_enabled           = false
  apply_immediately          = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = false

  tags = local.tags
}

resource "aws_secretsmanager_secret" "backend_env" {
  name                    = "${local.name_prefix}/backend/env"
  description             = "Runtime environment for ${var.project_name} backend"
  recovery_window_in_days = 0
  tags                    = local.tags
}

resource "aws_secretsmanager_secret_version" "backend_env" {
  secret_id = aws_secretsmanager_secret.backend_env.id
  secret_string = jsonencode({
    SUPABASE_URL              = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    OPENAI_API_KEY            = var.openai_api_key
    REDIS_URL                 = local.redis_url
  })
}

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${local.name_prefix}-ecs-task-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = aws_secretsmanager_secret.backend_env.arn
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
  tags               = local.tags
}

resource "null_resource" "build_push_backend" {
  count = var.build_backend_image && var.backend_image == "" ? 1 : 0

  triggers = {
    image_tag            = var.image_tag
    dockerfile_hash      = filesha256("${path.module}/../../apps/backend/Dockerfile")
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
      docker build --platform linux/amd64 -f ${path.module}/../../apps/backend/Dockerfile -t ${aws_ecr_repository.backend.repository_url}:${var.image_tag} ${path.module}/../..
      docker push ${aws_ecr_repository.backend.repository_url}:${var.image_tag}
    EOT
  }
}

resource "aws_lb" "backend" {
  name               = "${local.name_prefix}-alb"
  load_balancer_type = "application"
  subnets            = data.aws_subnets.default.ids
  security_groups    = [aws_security_group.alb.id]
  tags               = local.tags
}

resource "aws_lb_target_group" "backend" {
  name        = "${local.name_prefix}-tg"
  port        = 3333
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 30
    timeout             = 5
  }

  tags = local.tags
}

resource "aws_lb_listener" "http_forward" {
  count             = var.enable_https ? 0 : 1
  load_balancer_arn = aws_lb.backend.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = var.enable_https ? 1 : 0
  load_balancer_arn = aws_lb.backend.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = var.enable_https ? 1 : 0
  load_balancer_arn = aws_lb.backend.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  lifecycle {
    precondition {
      condition     = var.certificate_arn != null && var.certificate_arn != ""
      error_message = "certificate_arn must be set when enable_https is true."
    }
  }
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name_prefix}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = local.backend_container_name
      image     = local.container_image
      essential = true
      portMappings = [
        {
          containerPort = 3333
          hostPort      = 3333
          protocol      = "tcp"
        }
      ]
      environment = local.backend_environment
      secrets = [
        for key in local.backend_secret_keys : {
          name      = key
          valueFrom = "${aws_secretsmanager_secret.backend_env.arn}:${key}::"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.backend.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  depends_on = [
    aws_secretsmanager_secret_version.backend_env,
    null_resource.build_push_backend
  ]

  tags = local.tags
}

resource "aws_ecs_service" "backend" {
  name            = "${local.name_prefix}-backend"
  cluster         = aws_ecs_cluster.backend.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 50
  health_check_grace_period_seconds  = 60
  force_new_deployment               = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    assign_public_ip = true
    security_groups  = [aws_security_group.ecs.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = local.backend_container_name
    container_port   = 3333
  }

  depends_on = [
    aws_lb_listener.http_forward,
    aws_lb_listener.http_redirect,
    aws_lb_listener.https
  ]

  tags = local.tags
}
