#!/bin/sh
set -e

echo "[entrypoint] waiting for postgres at ${DATABASE_HOST:-postgres}:${DATABASE_PORT:-5432}..."
until nc -z "${DATABASE_HOST:-postgres}" "${DATABASE_PORT:-5432}" 2>/dev/null; do
  sleep 1
done
echo "[entrypoint] postgres reachable."

echo "[entrypoint] running prisma db push..."
pnpm exec prisma db push --accept-data-loss --skip-generate

if [ "${SEED_ON_START}" = "true" ]; then
  echo "[entrypoint] seeding..."
  pnpm exec tsx prisma/seed.ts || echo "[entrypoint] seed failed (already seeded?). continuing."
fi

echo "[entrypoint] launching: $*"
exec "$@"
