#!/bin/sh
set -eu

cd /app

if [ "${SERVICE_ROLE:-web}" = "worker" ]; then
  exec pnpm --filter @snapsocial/worker start
fi

pnpm --filter @snapsocial/db exec prisma migrate deploy
if [ -n "${BOOTSTRAP_OWNER_EMAIL:-}" ]; then
  pnpm --filter @snapsocial/web exec tsx src/scripts/bootstrap.ts --email="$BOOTSTRAP_OWNER_EMAIL" || true
fi
exec pnpm --filter @snapsocial/web exec next start --port "${PORT:-3000}"
