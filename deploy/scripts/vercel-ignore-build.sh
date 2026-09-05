#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the protein-outfitters-design project.
#
# Vercel redeploys the static site on EVERY commit to main, including ones
# that only touch mobile/ (nested Expo workspace). This script tells Vercel
# to skip the build when nothing the site depends on changed.
#
# Exit 0  → skip the build      Exit 1 → build as normal
#
# Install: Vercel → protein-outfitters-design → Settings → Git →
#          Ignored Build Step → Command: `bash scripts/vercel-ignore-build.sh`
#          (Root Directory is deploy/, so the path is relative to it.)
set -u

# Vercel exposes the previous deployed SHA; fall back to HEAD^ for safety.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$BASE" ] || ! git cat-file -e "$BASE" 2>/dev/null; then
  BASE="HEAD^"
fi

CHANGED="$(git diff --name-only "$BASE" HEAD 2>/dev/null || true)"

# Nothing to compare (first deploy, shallow clone edge cases) → build.
if [ -z "$CHANGED" ]; then
  echo "ignore-build: no diff available, building"
  exit 1
fi

# Paths that the site does NOT depend on. Anything outside this list → build.
MOBILE_ONLY='^(mobile/|docs/mobile/|scripts/mobile/|move-source\.sh$|\.github/|tsconfig\.base\.json$|\.nvmrc$|package\.json$|package-lock\.json$)'

if echo "$CHANGED" | grep -vqE "$MOBILE_ONLY"; then
  echo "ignore-build: site-relevant files changed, building"
  exit 1
fi

echo "ignore-build: only mobile/shared/CI files changed, skipping"
exit 0
