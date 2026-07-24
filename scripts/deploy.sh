#!/usr/bin/env bash
# Auto-deploy backend: pull latest main whenever origin has new commits.
set -euo pipefail

DIR="/var/www/mr-aqar-staging/aqar-backend"
BRANCH="main"
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

  log "deploying $remote_rev"
  git reset --hard "origin/$BRANCH"
  npm ci && npm run build && pm2 restart "$PM2_NAME"
  log "deployed."
} >> "$DIR/deploy.log" 2>&1

# ponytail: restart via pm2 (`pm2 start npm --name aqar-backend -- start` once).
# Swap `pm2 restart` for `systemctl restart <svc>` if you use systemd.
