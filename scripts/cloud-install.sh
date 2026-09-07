#!/usr/bin/env bash
# scripts/cloud-install.sh — one-time environment install for Cursor Cloud
# Agents (wired into .cursor/environment.json "install"). Prepares Node
# dependencies and a local Postgres seeded with the full schema + demo data so
# the site and its serverless API run end-to-end without external services.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing Node dependencies (root + deploy)"
npm install
npm --prefix deploy install

echo "==> Provisioning local Postgres (schema + demo seed)"
bash scripts/dev-db.sh

echo "==> Install complete"
