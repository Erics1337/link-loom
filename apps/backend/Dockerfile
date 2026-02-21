FROM node:20-bookworm-slim

WORKDIR /app

# Use pnpm from the lockfile-defined toolchain.
RUN corepack enable

# Install workspace dependencies first to maximize layer cache reuse.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile

# Copy only the backend and required workspace package for build/runtime.
COPY apps/backend ./apps/backend
COPY packages/tsconfig ./packages/tsconfig

RUN pnpm --filter backend build

EXPOSE 3333

CMD ["pnpm", "--filter", "backend", "start"]
