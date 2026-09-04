#!/usr/bin/env bash
# scripts/dev-db.sh — provision a local Postgres for development.
#
# Installs Postgres if missing, starts the cluster, creates the `po` role and
# `protein_outfitters` database, then applies the full schema + demo seed.
# Idempotent: safe to run repeatedly. Requires passwordless sudo (available in
# Cursor Cloud Agent VMs).
#
# After this runs, the API endpoints in deploy/api/*.js work locally against:
#   DATABASE_URL=postgres://po:po@127.0.0.1:5432/protein_outfitters
set -euo pipefail
cd "$(dirname "$0")/.."

PG_VERSION=16
DB_NAME=protein_outfitters
DB_ROLE=po
DB_PASS=po

if ! command -v psql >/dev/null 2>&1; then
  echo "==> Installing PostgreSQL"
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
fi

echo "==> Starting PostgreSQL cluster ${PG_VERSION}/main"
sudo pg_ctlcluster "${PG_VERSION}" main start 2>/dev/null || true

echo "==> Waiting for Postgres to accept connections"
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

echo "==> Ensuring role '${DB_ROLE}' and database '${DB_NAME}'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_ROLE}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${DB_ROLE} LOGIN PASSWORD '${DB_PASS}' SUPERUSER;"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_ROLE}" "${DB_NAME}"

echo "==> Applying schema + demo seed"
DATABASE_URL="postgres://${DB_ROLE}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}" \
  node scripts/db-bootstrap.mjs --seed

echo "==> Local database ready: postgres://${DB_ROLE}:***@127.0.0.1:5432/${DB_NAME}"
