#!/usr/bin/env bash
# Auto-deploy backend: pull latest main IF newest incoming commit is by zaheer-bashir.
set -euo pipefail

DIR="/var/www/mr-aqar-staging/aqar-backend"
BRANCH="main"
AUTHOR_MATCH="zaheer-bashir"   # matches name or email, case-insensitive
PM2_NAME=" mr-aqar-staging-backend"

log() { echo "[$(date '+%F %T')] $*"; }

{
  cd "$DIR"
  git fetch --quiet origin "$BRANCH"
  local_rev=$(git rev-parse "$BRANCH")
  remote_rev=$(git rev-parse "origin/$BRANCH")

  if [ "$local_rev" = "$remote_rev" ]; then
    log "up to date, nothing to do."
    exit 0
  fi

  author=$(git log -1 --format='%an %ae' "origin/$BRANCH")
  if ! echo "$author" | grep -qi "$AUTHOR_MATCH"; then
    log "new commits but latest author '$author' is not $AUTHOR_MATCH — skipping."
    exit 0
  fi

  log "deploying $remote_rev by $author"
  git reset --hard "origin/$BRANCH"
  npm ci && npm run build && pm2 restart "$PM2_NAME"
  log "deployed."
} >> "$DIR/deploy.log" 2>&1

# ponytail: restart via pm2 (`pm2 start npm --name aqar-backend -- start` once).
# Swap `pm2 restart` for `systemctl restart <svc>` if you use systemd.
