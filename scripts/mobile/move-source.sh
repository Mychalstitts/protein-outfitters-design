#!/usr/bin/env bash
# Thin wrapper — canonical script lives at the design-repo root.
# Prefer:  APP=… DESIGN=… bash move-source.sh
exec "$(cd "$(dirname "$0")/../.." && pwd)/move-source.sh" "$@"
