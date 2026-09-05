#!/usr/bin/env bash
# move-source.sh — copy the mobile workspace out of protein-outfitters-app
# into protein-outfitters-design (the canonical repo), per CONSOLIDATION.md
# step 2: "move protein-outfitters-app/app/apps/mobile to mobile/".
#
# Usage:
#   APP=~/code/protein-outfitters-app DESIGN=~/code/protein-outfitters-design bash move-source.sh
#   ... add --dry-run to see the plan without writing anything
#   ... add FORCE=1 to overwrite an existing DESIGN/mobile
#
# What lands in DESIGN/mobile/ (a self-contained npm workspace, so the
# existing relative paths — ../../tsconfig.base.json, metro workspaceRoot —
# keep working without edits):
#   apps/mobile/       Expo / EAS app            (from APP/app/apps/mobile)
#   packages/shared/   @protein-outfitters/shared (from APP/app/packages/shared)
#   scripts/           build-icons, bundle-data, seed, check-env
#   docs/              app-store readiness, store copy, privacy, terms
#   package.json, tsconfig.base.json, .nvmrc, .env.example, .gitignore
#
# Deliberately NOT copied:
#   apps/web/          Next.js site — design repo's deploy/ is canonical
#   supabase/          already identical in DESIGN/supabase (only README added)
#   node_modules, .expo, ios/, android/, package-lock.json (regenerate)
#
# Nothing is deleted from APP and nothing is committed — review `git status`
# in DESIGN afterwards.

set -euo pipefail

APP="${APP:-$HOME/code/protein-outfitters-app}"
DESIGN="${DESIGN:-$HOME/code/protein-outfitters-design}"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

SRC="$APP/app"
DEST="$DESIGN/mobile"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---- preflight ------------------------------------------------------------
[ -d "$SRC/apps/mobile" ]     || die "no Expo app at $SRC/apps/mobile (is APP right?)"
[ -d "$SRC/packages/shared" ] || die "no shared package at $SRC/packages/shared"
[ -f "$DESIGN/CONSOLIDATION.md" ] || die "$DESIGN doesn't look like protein-outfitters-design"
command -v rsync >/dev/null    || die "rsync not found"

if [ -e "$DEST" ] && [ "${FORCE:-0}" != "1" ]; then
  die "$DEST already exists — remove it or re-run with FORCE=1"
fi

if git -C "$DESIGN" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -n "$(git -C "$DESIGN" status --porcelain)" ] && [ "${FORCE:-0}" != "1" ]; then
    die "$DESIGN has uncommitted changes — commit/stash first so the move is reviewable (or FORCE=1)"
  fi
fi

APP_SHA="$(git -C "$APP" rev-parse --short HEAD 2>/dev/null || echo unknown)"

RSYNC_OPTS=(-a --exclude node_modules --exclude .expo --exclude .expo-shared \
            --exclude ios --exclude android --exclude dist --exclude build \
            --exclude '*.tsbuildinfo' --exclude .DS_Store --exclude .env --exclude '.env.local')
[ "$DRY_RUN" = 1 ] && RSYNC_OPTS+=(--dry-run -v)

copy() { # copy <src> <dest>
  say "copy ${1#$APP/}  ->  ${2#$DESIGN/}"
  [ "$DRY_RUN" = 1 ] || mkdir -p "$(dirname "$2")"
  rsync "${RSYNC_OPTS[@]}" "$1/" "$2/"
}

copy_file() {
  say "copy ${1#$APP/}  ->  ${2#$DESIGN/}"
  [ "$DRY_RUN" = 1 ] && return 0
  mkdir -p "$(dirname "$2")"; cp "$1" "$2"
}

say "APP    = $APP  (HEAD $APP_SHA)"
say "DESIGN = $DESIGN"
say "DEST   = $DEST"
[ "$DRY_RUN" = 1 ] && warn "dry run — nothing will be written"

# ---- the move -------------------------------------------------------------
copy "$SRC/apps/mobile"     "$DEST/apps/mobile"
copy "$SRC/packages/shared" "$DEST/packages/shared"
copy "$SRC/scripts"         "$DEST/scripts"
copy "$SRC/docs"            "$DEST/docs"

for f in tsconfig.base.json .nvmrc .env.example .gitignore; do
  [ -f "$SRC/$f" ] && copy_file "$SRC/$f" "$DEST/$f"
done

# supabase: only the functions README is missing from the design repo
if [ -f "$SRC/supabase/functions/README.md" ] && [ ! -f "$DESIGN/supabase/functions/README.md" ]; then
  copy_file "$SRC/supabase/functions/README.md" "$DESIGN/supabase/functions/README.md"
fi

# workspace package.json — same as the app repo's root one, minus the web
# workspace scripts (apps/web is not coming along).
say "write mobile/package.json (workspace root, web scripts dropped)"
if [ "$DRY_RUN" != 1 ]; then
  node - "$SRC/package.json" "$DEST/package.json" <<'NODE'
const fs = require('fs');
const [src, dest] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(src, 'utf8'));
pkg.name = 'protein-outfitters-mobile';
pkg.description = 'Protein Outfitters mobile (Expo) + shared package — lives inside protein-outfitters-design';
delete pkg.scripts.web;
fs.writeFileSync(dest, JSON.stringify(pkg, null, 2) + '\n');
NODE
fi

say "write mobile/README.md"
if [ "$DRY_RUN" != 1 ]; then
  cat > "$DEST/README.md" <<EOF
# Protein Outfitters — mobile workspace

Moved here from \`Mychalstitts/protein-outfitters-app\` (\`app/\`, commit \`$APP_SHA\`)
on $(date +%Y-%m-%d) by \`move-source.sh\`. The web app (\`apps/web\`) was **not**
moved — the static site + API in \`../deploy/\` is canonical.

\`\`\`
cd mobile
nvm use            # .nvmrc → Node $(cat "$SRC/.nvmrc" 2>/dev/null || echo 20)
npm install        # workspaces: apps/mobile, packages/shared
npm run mobile     # expo start
npm run typecheck  # tsc --build across workspaces
\`\`\`

EAS builds/updates run from \`apps/mobile\` (\`npm run build:preview --workspace apps/mobile\`).
Copy \`.env.example\` → \`.env\` with the Supabase values from \`../supabase/.env.example\`.

See \`../CONSOLIDATION.md\` for the full consolidation map.
EOF
fi

# ---- summary --------------------------------------------------------------
if [ "$DRY_RUN" = 1 ]; then
  say "dry run complete — re-run without --dry-run to copy"
else
  say "done. In $DESIGN:"
  git -C "$DESIGN" status --short | head -40 || true
  echo
  say "next: cd $DESIGN/mobile && npm install && npm run typecheck"
  say "then review, and commit with something like:"
  echo "      git -C \"$DESIGN\" add mobile supabase/functions/README.md"
  echo "      git -C \"$DESIGN\" commit -m 'Move mobile workspace from protein-outfitters-app ($APP_SHA)'"
fi
