# Link Loom AWS Terraform

This Terraform stack deploys the backend API/workers to AWS with:

- ECR repository for backend image
- ECS Fargate cluster/service
- Application Load Balancer (public endpoint)
- ElastiCache Redis (BullMQ backend)
- IAM roles and CloudWatch log group
- Secrets Manager secret for backend runtime env

## What It Assumes

- You already have a hosted Supabase project.
- You have AWS CLI credentials configured for the target account.
- Terraform and Docker are installed locally.
- Deployment uses the account's **default VPC** and its subnets.

## Required Inputs

Copy the example vars file and fill real values:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Required secret values:

- `supabase_url`
- `supabase_service_role_key`
- `openai_api_key`

## Deploy

```bash
terraform init
terraform plan
terraform apply
```

If `build_backend_image = true`, `terraform apply` will:

1. Build `apps/backend/Dockerfile`
2. Push the image to ECR using `image_tag`
3. Deploy/update ECS service with that image

## Outputs To Use In Extension

After apply:

```bash
terraform output api_base_url
terraform output alb_dns_name
```

Use `api_base_url` as:

- `VITE_BACKEND_URL` in `apps/extension/.env`

If you deploy the web app separately, also set:

- `VITE_WEB_APP_URL`

## Notes

- ALB is HTTP-only by default (`enable_https = false`).
- To enable HTTPS:
  - set `enable_https = true`
  - set `certificate_arn` to an ACM cert in the same region.
