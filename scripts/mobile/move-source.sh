#!/usr/bin/env bash
# move-source.sh — git subtree transplant of mobile/ + packages/shared
# from protein-outfitters-app into protein-outfitters-design.
#
# Usage:
#   APP=~/code/protein-outfitters-app \
#   DESIGN=~/code/protein-outfitters-design \
#   bash move-source.sh
#
# See docs/mobile/MIGRATE.md for the full runbook (overlays, hand-edits, EAS).
set -euo pipefail

APP="${APP:?Set APP to the protein-outfitters-app clone path}"
DESIGN="${DESIGN:?Set DESIGN to the protein-outfitters-design clone path}"

die() { echo "error: $*" >&2; exit 1; }

command -v git >/dev/null || die "git not found"
git subtree --help >/dev/null 2>&1 || die "git subtree not available (need git ≥ 1.7.11)"

[[ -d "$APP/.git" ]] || die "APP is not a git repo: $APP"
[[ -d "$DESIGN/.git" ]] || die "DESIGN is not a git repo: $DESIGN"

APP="$(cd "$APP" && pwd)"
DESIGN="$(cd "$DESIGN" && pwd)"

echo "==> APP     $APP"
echo "==> DESIGN  $DESIGN"

# --- preflight ---
if [[ -n "$(git -C "$APP" status --porcelain)" ]]; then
  die "APP working tree is dirty; commit or stash first"
fi
if [[ -n "$(git -C "$DESIGN" status --porcelain)" ]]; then
  die "DESIGN working tree is dirty; commit or stash first"
fi

# Paths inside the app monorepo (app/apps/mobile, app/packages/shared)
MOBILE_PREFIX="app/apps/mobile"
SHARED_PREFIX="app/packages/shared"

[[ -d "$APP/$MOBILE_PREFIX" ]] || die "missing $APP/$MOBILE_PREFIX"
[[ -d "$APP/$SHARED_PREFIX" ]] || die "missing $APP/$SHARED_PREFIX"

BRANCH="${BRANCH:-feat/mobile-workspace}"

# --- 1. Split from app repo ---
echo "==> subtree split in APP"
git -C "$APP" checkout main
git -C "$APP" pull --ff-only origin main || git -C "$APP" pull --ff-only

# Recreate split branches cleanly if they already exist
git -C "$APP" branch -D split/mobile 2>/dev/null || true
git -C "$APP" branch -D split/shared 2>/dev/null || true

git -C "$APP" subtree split --prefix="$MOBILE_PREFIX" -b split/mobile
git -C "$APP" subtree split --prefix="$SHARED_PREFIX" -b split/shared

# --- 2. Graft into design repo ---
echo "==> subtree add into DESIGN on branch $BRANCH"
git -C "$DESIGN" fetch origin main
git -C "$DESIGN" checkout -B "$BRANCH" origin/main

# Point remote "app" at the local clone (file:// so fetch works without network)
if git -C "$DESIGN" remote get-url app >/dev/null 2>&1; then
  git -C "$DESIGN" remote set-url app "$APP"
else
  git -C "$DESIGN" remote add app "$APP"
fi
git -C "$DESIGN" fetch app

# If prefixes already exist (scaffold placeholders), remove them so subtree add can run
if [[ -e "$DESIGN/mobile" ]]; then
  echo "==> removing existing DESIGN/mobile (scaffold) before subtree add"
  git -C "$DESIGN" rm -rf mobile >/dev/null 2>&1 || rm -rf "$DESIGN/mobile"
  git -C "$DESIGN" commit -m "chore(mobile): clear scaffold before subtree add" || true
fi
if [[ -e "$DESIGN/packages/shared" ]]; then
  echo "==> removing existing DESIGN/packages/shared (scaffold) before subtree add"
  git -C "$DESIGN" rm -rf packages/shared >/dev/null 2>&1 || rm -rf "$DESIGN/packages/shared"
  # keep packages/ dir
  mkdir -p "$DESIGN/packages"
  git -C "$DESIGN" add -A packages || true
  git -C "$DESIGN" commit -m "chore(shared): clear scaffold before subtree add" || true
fi

git -C "$DESIGN" subtree add --prefix=mobile app split/mobile
git -C "$DESIGN" subtree add --prefix=packages/shared app split/shared

# --- copy extras not in either subtree ---
echo "==> copy scripts/docs extras"
A="$APP/app"
mkdir -p "$DESIGN/scripts/mobile" "$DESIGN/docs/mobile"

copy_if() {
  local src="$1" dst="$2"
  if [[ -f "$src" ]]; then
    cp "$src" "$dst"
    echo "    copied $(basename "$src")"
  else
    echo "    skip (missing): $src"
  fi
}

copy_if "$A/scripts/build-icons.mjs"     "$DESIGN/scripts/mobile/build-icons.mjs"
copy_if "$A/docs/app-store-readiness.md" "$DESIGN/docs/mobile/app-store-readiness.md"
copy_if "$A/docs/reviewer-notes.md"      "$DESIGN/docs/mobile/reviewer-notes.md"
copy_if "$A/docs/store-listing-copy.md"  "$DESIGN/docs/mobile/store-listing-copy.md"
copy_if "$A/docs/setup-guide.md"         "$DESIGN/docs/mobile/setup-guide.md"
# alternate names seen in earlier drafts
copy_if "$A/docs/setup-guide.md"         "$DESIGN/docs/mobile/setup-guide.md"
copy_if "$A/scripts/build-icons.mjs"     "$DESIGN/scripts/mobile/build-icons.mjs"

git -C "$DESIGN" add scripts/mobile docs/mobile
git -C "$DESIGN" status --short

echo
echo "==> done. Next:"
echo "    1. Re-apply bundle overlays if subtree clobbered them (MIGRATE.md §3)"
echo "    2. Hand-edits in MIGRATE.md §4 (strip Maps key from mobile/app.json, etc.)"
echo "    3. npm install && npm run typecheck && npm run shared:test"
echo "    4. Commit remaining changes on $BRANCH and open/update the PR"
echo
echo "    DESIGN branch: $(git -C "$DESIGN" branch --show-current)"
echo "    DESIGN HEAD:   $(git -C "$DESIGN" rev-parse --short HEAD)"
