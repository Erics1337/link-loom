SHELL := /bin/bash

TF_DIR := infra/terraform
TF_ENV_LOADER := ./scripts/load-terraform-env.sh
BACKEND_DIR := apps/backend
LAMBDA_IMAGE := link-loom-backend-lambda:test

USER_ID ?=
API_URL ?= $(shell $(TF_ENV_LOADER) terraform -chdir=$(TF_DIR) output -raw api_base_url 2>/dev/null)

.PHONY: help
help:
	@printf "Link Loom targets\n\n"
	@printf "Local:\n"
	@printf "  make dev                 Start all local app dev servers with Turbo\n"
	@printf "  make supabase-start      Start local Supabase\n"
	@printf "  make supabase-status     Print local Supabase URLs and keys\n\n"
	@printf "Validation:\n"
	@printf "  make backend-build       Typecheck/build backend\n"
	@printf "  make backend-test        Run backend tests\n"
	@printf "  make lambda-package      Verify backend Lambda production package\n"
	@printf "  make lambda-image        Build Lambda container image locally\n"
	@printf "  make tf-check            Terraform fmt check + validate\n"
	@printf "  make check               Run backend-build, lambda-package, tf-check\n\n"
	@printf "AWS deploy/smoke:\n"
	@printf "  make tf-env-print        Show Terraform env mapping without secret values\n"
	@printf "  make tf-init             Terraform init\n"
	@printf "  make tf-plan             Terraform plan\n"
	@printf "  make deploy              Terraform apply\n"
	@printf "  make smoke-prod          Curl deployed /health endpoint\n"
	@printf "  make smoke-ingest USER_ID=<uuid>  Trigger deployed ingest smoke test\n"
	@printf "  make logs-api            Tail API Lambda logs\n"
	@printf "  make logs-workers        Tail worker Lambda logs\n"
	@printf "  make destroy             Terraform destroy\n"

.PHONY: dev
dev:
	pnpm dev

.PHONY: supabase-start
supabase-start:
	npx supabase start

.PHONY: supabase-status
supabase-status:
	npx supabase status

.PHONY: backend-build
backend-build:
	pnpm --filter backend build

.PHONY: backend-test
backend-test:
	pnpm --filter backend test

.PHONY: lambda-package
lambda-package:
	rm -rf /tmp/link-loom-backend-lambda-package
	pnpm deploy --filter backend --prod /tmp/link-loom-backend-lambda-package
	test -f /tmp/link-loom-backend-lambda-package/dist/lambda/api.js
	test -f /tmp/link-loom-backend-lambda-package/dist/lambda/worker.js

.PHONY: lambda-image
lambda-image:
	docker build --platform linux/amd64 -f $(BACKEND_DIR)/Dockerfile.lambda -t $(LAMBDA_IMAGE) .

.PHONY: tf-init
tf-init:
	$(TF_ENV_LOADER) terraform -chdir=$(TF_DIR) init

.PHONY: tf-env-print
tf-env-print:
	@$(TF_ENV_LOADER) env | grep '^TF_VAR_' | sort | sed -E 's/(TF_VAR_.*key|TF_VAR_openai_api_key)=.*/\1=***/'

.PHONY: tf-fmt
tf-fmt:
	terraform fmt -recursive $(TF_DIR)

.PHONY: tf-fmt-check
tf-fmt-check:
	terraform fmt -check -recursive $(TF_DIR)

.PHONY: tf-validate
tf-validate:
	$(TF_ENV_LOADER) terraform -chdir=$(TF_DIR) validate

.PHONY: tf-check
tf-check: tf-fmt-check tf-validate

.PHONY: tf-plan
tf-plan:
	$(TF_ENV_LOADER) terraform -chdir=$(TF_DIR) plan

.PHONY: check
check: backend-build lambda-package tf-check

.PHONY: deploy
deploy:
	$(TF_ENV_LOADER) terraform -chdir=$(TF_DIR) apply

.PHONY: api-url
api-url:
	@$(TF_ENV_LOADER) terraform -chdir=$(TF_DIR) output -raw api_base_url
	@printf "\n"

.PHONY: smoke-prod
smoke-prod:
	@if [ -z "$(API_URL)" ]; then echo "No API_URL found. Run terraform apply or pass API_URL=https://..."; exit 1; fi
	curl -fsS "$(API_URL)/health"
	@printf "\n"

.PHONY: smoke-ingest
smoke-ingest:
	@if [ -z "$(API_URL)" ]; then echo "No API_URL found. Run terraform apply or pass API_URL=https://..."; exit 1; fi
	@if [ -z "$(USER_ID)" ]; then echo "Usage: make smoke-ingest USER_ID=<supabase-user-uuid>"; exit 1; fi
	curl -fsS -X POST "$(API_URL)/ingest" \
		-H 'Content-Type: application/json' \
		-d '{"userId":"$(USER_ID)","bookmarks":[{"id":"lambda-smoke-1","url":"https://example.com","title":"Lambda Smoke Test"}]}'
	@printf "\n"

.PHONY: logs-api
logs-api:
	$(TF_ENV_LOADER) sh -c 'aws logs tail "/aws/lambda/$$(terraform -chdir=$(TF_DIR) state show aws_lambda_function.api | awk -F" = " '\''/function_name/{gsub(/"/,"",$$2); print $$2; exit}'\'')" --follow'

.PHONY: logs-workers
logs-workers:
	@$(TF_ENV_LOADER) sh -c 'for resource in ingest_worker enrichment_worker embedding_worker clustering_worker; do \
		name=$$(terraform -chdir=$(TF_DIR) state show aws_lambda_function.$$resource | awk -F" = " '\''/function_name/{gsub(/"/,"",$$2); print $$2; exit}'\''); \
		echo "Logs for $$name:"; \
		aws logs tail "/aws/lambda/$$name" --since 15m || true; \
	done'

.PHONY: destroy
destroy:
	$(TF_ENV_LOADER) terraform -chdir=$(TF_DIR) destroy
