FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts/railway-start.sh ./scripts/railway-start.sh

RUN pnpm install --frozen-lockfile

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV BETTER_AUTH_SECRET=build-time-placeholder-secret-32chars
ENV CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @snapsocial/db generate \
  && pnpm --filter @snapsocial/web build

ENV NODE_ENV=production

CMD ["sh", "/app/scripts/railway-start.sh"]
