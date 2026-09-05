#!/usr/bin/env bash
# move-source.sh — pull mobile/ + packages/shared source into the design repo
# with history, on top of the Cursor scaffold branch.
#
# Run from any machine that can see BOTH repos (your Mac is fine). The Cursor
# agent can't, because its token is scoped to one repo per run.
#
#   APP=~/code/protein-outfitters-app DESIGN=~/code/protein-outfitters-design bash move-source.sh
#
# Why not just the plain `git subtree add` from MIGRATE.md? The scaffold branch
# already has placeholder dirs at mobile/ and packages/shared, and
# `git subtree add` refuses to run when the prefix exists. This script removes
# the placeholders, imports the real source, then restores the overlay files
# (tsconfig/metro/eas/app.config/.env.example) that the import overwrote.
#
# Nothing is pushed. Review `git log` and `git status` at the end, then push.
set -euo pipefail

APP="${APP:-$HOME/code/protein-outfitters-app}"
DESIGN="${DESIGN:-$HOME/code/protein-outfitters-design}"
BRANCH="${BRANCH:-cursor/mobile-workspace-scaffold-8023}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP/.git" ]    || die "APP repo not found at $APP"
[ -d "$DESIGN/.git" ] || die "DESIGN repo not found at $DESIGN"
git -C "$APP" subtree --help >/dev/null 2>&1 || die "git subtree not available (git >= 1.7.11)"

# ---------------------------------------------------------------- 1. split
say "Splitting app/apps/mobile and app/packages/shared out of $APP (history kept)"
cd "$APP"
[ -z "$(git status --porcelain)" ] || die "app repo has uncommitted changes — commit or stash first"
git fetch -q origin
git checkout -q main
git pull -q --ff-only origin main
git branch -f split/mobile "$(git subtree split --prefix=app/apps/mobile main)"
git branch -f split/shared "$(git subtree split --prefix=app/packages/shared main)"
echo "  split/mobile → $(git rev-parse --short split/mobile)  ($(git rev-list --count split/mobile) commits)"
echo "  split/shared → $(git rev-parse --short split/shared)  ($(git rev-list --count split/shared) commits)"

# ---------------------------------------------------------------- 2. import
say "Importing into $DESIGN on branch $BRANCH"
cd "$DESIGN"
[ -z "$(git status --porcelain)" ] || die "design repo has uncommitted changes — commit or stash first"
git fetch -q origin
git checkout -q "$BRANCH"
git pull -q --ff-only origin "$BRANCH" || true
SCAFFOLD="$(git rev-parse HEAD)"
echo "  scaffold commit: $(git rev-parse --short "$SCAFFOLD")"

git remote get-url app >/dev/null 2>&1 || git remote add app "$APP"
git fetch -q app

say "Removing scaffold placeholders (git subtree add refuses an existing prefix)"
git rm -rq mobile packages/shared
git commit -qm "chore(mobile): drop scaffold placeholders ahead of subtree import"

say "git subtree add → mobile/"
git subtree add --prefix=mobile app split/mobile \
  -m "feat(mobile): import Expo app from protein-outfitters-app (history preserved)"

say "git subtree add → packages/shared/"
git subtree add --prefix=packages/shared app split/shared \
  -m "feat(shared): import shared package from protein-outfitters-app (history preserved)"

# ---------------------------------------------------------------- 3. overlay
say "Restoring overlay configs from the scaffold (subtree brought the app-repo versions)"
git checkout "$SCAFFOLD" -- \
  mobile/tsconfig.json \
  mobile/metro.config.js \
  mobile/eas.json \
  mobile/app.config.js \
  mobile/.env.example
# packages/shared/tsconfig.json is identical at both depths — keep the imported one.

say "Copying store docs from the app repo → docs/mobile/"
mkdir -p docs/mobile
for f in app-store-readiness reviewer-notes store-listing-copy setup-guide; do
  [ -f "$APP/app/docs/$f.md" ] && cp "$APP/app/docs/$f.md" docs/mobile/
done
# Fix the paths those docs reference
if command -v sed >/dev/null; then
  for f in docs/mobile/*.md; do
    sed -i.bak -e 's#app/apps/mobile#mobile#g' -e 's#app/packages/shared#packages/shared#g' -e 's#app/docs/#docs/mobile/#g' "$f" && rm -f "$f.bak"
  done
fi

say "Stripping the plaintext Google Maps key from mobile/app.json (app.config.js supplies it from env)"
node - <<'EOF'
const fs = require('fs');
const p = 'mobile/app.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
if (j.expo?.android?.config?.googleMaps) {
  delete j.expo.android.config;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('  removed expo.android.config.googleMaps.apiKey — ROTATE this key in Google Cloud, it is in the app repo history');
} else {
  console.log('  no googleMaps key in app.json, nothing to do');
}
EOF

say "Removing the pending-source shim"
git rm -q --ignore-unmatch scripts/mobile/pending-source.mjs scripts/mobile/pending-source.mjs

# ---------------------------------------------------------------- 4. lockfile
if [ "$SKIP_INSTALL" = "1" ]; then
  say "SKIP_INSTALL=1 — not running npm install (lockfile will be stale)"
else
  say "npm install (regenerates root package-lock.json with the real workspace deps)"
  npm install
fi

git add -A
git commit -qm "feat(mobile): wire imported source into workspace (overlay configs, docs, app.json key removal, lockfile)"

# ---------------------------------------------------------------- 5. report
say "Done — nothing pushed yet"
echo
git log --oneline -8
echo
echo "  mobile/ files:          $(git ls-files mobile | wc -l | tr -d ' ')"
echo "  packages/shared files:  $(git ls-files packages/shared | wc -l | tr -d ' ')"
echo "  mobile history:         $(git log --oneline -- mobile | wc -l | tr -d ' ') commits"
echo
echo "Next:"
echo "  npm run shared:test && npm run typecheck"
echo "  git push origin $BRANCH"
echo "  then open the PR (no auto-merge label) and set EXPO_TOKEN + the EAS secrets per docs/mobile/MIGRATE.md §7"
