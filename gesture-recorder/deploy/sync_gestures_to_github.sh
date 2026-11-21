#!/usr/bin/env bash
# Commit and push new/changed gesture files so they're always in GitHub.
# Cron example (every 15 min):  */15 * * * * /opt/Claudeskills/gesture-recorder/deploy/sync_gestures_to_github.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git add gestures/
if ! git diff --cached --quiet; then
  git commit -m "Sync gestures $(date -u +%Y-%m-%dT%H:%MZ)"
  git push origin HEAD
fi
