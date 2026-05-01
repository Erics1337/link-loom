# Link Loom AWS Terraform

This Terraform stack deploys the backend API/workers to AWS with a serverless, pay-per-use shape:

- ECR repository for one shared Lambda container image
- API Gateway HTTP API for the backend API
- Lambda function for the API
- SQS queues for ingest, enrichment, embedding, and clustering
- Lambda workers triggered by SQS
- IAM roles and CloudWatch logs

## What It Assumes

- You already have a hosted Supabase project.
- You have AWS CLI credentials configured for the target account.
- Terraform and Docker are installed locally.
- Lambdas do not run in a VPC by default, avoiding NAT Gateway and always-on networking cost.

## Environment

Terraform variables come from the existing production env files:

- `apps/backend/.env.production`
- `apps/web/.env.production`
- `apps/extension/.env.production`

The root Makefile maps those app env vars into Terraform's `TF_VAR_*` variables. Inspect the mapping without printing secrets:

```bash
make tf-env-print
```

Required source values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

## Deploy

```bash
make tf-init
make tf-check
make tf-plan
make deploy
make smoke-prod
```

If `build_backend_image = true`, `terraform apply` will:

1. Build `apps/backend/Dockerfile.lambda`
2. Push the image to ECR using `image_tag`
3. Deploy/update the API and worker Lambda functions with that image

## Outputs To Use In Extension

After apply:

```bash
terraform output api_base_url
```

Use `api_base_url` as:

- `VITE_BACKEND_URL` in `apps/extension/.env`

If you deploy the web app separately, also set:

- `VITE_WEB_APP_URL`

## Notes

- There is no Redis/ElastiCache in this stack.
- SQS replaces BullMQ as the production queue.
- API Gateway's default endpoint is HTTPS.
