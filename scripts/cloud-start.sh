#!/usr/bin/env bash
# scripts/cloud-start.sh — per-boot startup for Cursor Cloud Agents (wired into
# .cursor/environment.json "start"). The Postgres cluster + seeded data live in
# the environment snapshot created during install; this just brings the daemon
# back up and makes sure the role/db exist. Idempotent and fast.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_VERSION=16

echo "==> Starting PostgreSQL cluster ${PG_VERSION}/main"
sudo pg_ctlcluster "${PG_VERSION}" main start 2>/dev/null || true

for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

# Safety net in case the snapshot didn't retain the role/db (e.g. just-in-time
# boot without a build). dev-db.sh is fully idempotent.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='protein_outfitters'" | grep -q 1; then
  bash scripts/dev-db.sh
fi

echo "==> Postgres ready"
