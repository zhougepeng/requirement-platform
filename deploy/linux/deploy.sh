#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${REQUIREMENT_PLATFORM_DEPLOY_DIR:-}"
SERVICE_NAME="${REQUIREMENT_PLATFORM_SYSTEMD_SERVICE:-requirement-platform}"
PORT="${REQUIREMENT_PLATFORM_PORT:-3000}"
EXPECTED_HTTPS_REMOTE="https://github.com/zhougepeng/requirement-platform.git"
EXPECTED_SSH_REMOTE="git@github.com:zhougepeng/requirement-platform.git"

if [[ -z "$DEPLOY_ROOT" ]]; then
  echo "REQUIREMENT_PLATFORM_DEPLOY_DIR is required." >&2
  exit 1
fi
if [[ ! -d "$DEPLOY_ROOT/.git" ]]; then
  echo "Deployment directory is not a Git repository: $DEPLOY_ROOT" >&2
  exit 1
fi

branch="$(git -C "$DEPLOY_ROOT" branch --show-current)"
remote="$(git -C "$DEPLOY_ROOT" remote get-url origin)"
if [[ "$branch" != "main" ]]; then
  echo "Deployment directory must be on main, found: $branch" >&2
  exit 1
fi
if [[ "$remote" != "$EXPECTED_HTTPS_REMOTE" && "$remote" != "$EXPECTED_SSH_REMOTE" ]]; then
  echo "Deployment origin is not the configured requirement-platform repository." >&2
  exit 1
fi

git -C "$DEPLOY_ROOT" fetch --quiet origin main
if [[ -n "$(git -C "$DEPLOY_ROOT" status --porcelain)" ]]; then
  echo "Deployment directory has uncommitted changes; deployment stopped to protect local configuration." >&2
  exit 1
fi
git -C "$DEPLOY_ROOT" pull --ff-only origin main

pushd "$DEPLOY_ROOT" >/dev/null
npm ci
npm run build
popd >/dev/null

sudo systemctl restart "$SERVICE_NAME"
for _ in {1..10}; do
  if curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:${PORT}/" >/dev/null; then
    echo "Requirement platform deployed and healthy on port ${PORT}."
    exit 0
  fi
  sleep 1
done

echo "The service restarted but did not pass the local HTTP health check." >&2
exit 1
