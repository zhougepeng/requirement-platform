#!/usr/bin/env bash
set -euo pipefail

PLATFORM_ROOT="${REQUIREMENT_PLATFORM_DEPLOY_DIR:-}"
SERVICE_NAME="${REQUIREMENT_PLATFORM_SYSTEMD_SERVICE:-requirement-platform}"
PORT="${REQUIREMENT_PLATFORM_PORT:-3000}"
ARTIFACT_ROOT="${1:-}"

if [[ -z "$PLATFORM_ROOT" || -z "$ARTIFACT_ROOT" ]]; then
  echo "Usage: REQUIREMENT_PLATFORM_DEPLOY_DIR=/opt/requirement-platform $0 <release-directory>" >&2
  exit 1
fi
if [[ ! -f "$ARTIFACT_ROOT/.next/standalone/server.js" || ! -d "$ARTIFACT_ROOT/.next/standalone/.next/static" || ! -d "$ARTIFACT_ROOT/.next/standalone/public" ]]; then
  echo "Release artifact is incomplete: standalone server or static assets are missing." >&2
  exit 1
fi
if [[ ! -d "$PLATFORM_ROOT" ]]; then
  echo "Platform root does not exist: $PLATFORM_ROOT" >&2
  exit 1
fi

RELEASES_ROOT="$PLATFORM_ROOT/releases"
CURRENT_LINK="$PLATFORM_ROOT/current"
RELEASE_ID="${GITHUB_SHA:-$(date +%Y%m%d%H%M%S)}"
NEXT_RELEASE="$RELEASES_ROOT/$RELEASE_ID"
PREVIOUS_RELEASE=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"
fi

if [[ -e "$NEXT_RELEASE" ]]; then
  echo "Release already exists: $NEXT_RELEASE" >&2
  exit 1
fi
mkdir -p "$RELEASES_ROOT"
mkdir "$NEXT_RELEASE"
cp -a "$ARTIFACT_ROOT/." "$NEXT_RELEASE/"

ln -s "$NEXT_RELEASE" "$CURRENT_LINK.next"
mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"

if ! sudo systemctl restart "$SERVICE_NAME"; then
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    ln -s "$PREVIOUS_RELEASE" "$CURRENT_LINK.next"
    mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"
    sudo systemctl restart "$SERVICE_NAME" || true
  fi
  echo "New release failed to start; previous release was restored when available." >&2
  exit 1
fi

for _ in {1..10}; do
  if curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null && find "$NEXT_RELEASE/.next/standalone/.next/static" -type f -name '*.js' -print -quit | grep -q .; then
    echo "Requirement platform deployed and healthy on port ${PORT}."
    exit 0
  fi
  sleep 1
done

if [[ -n "$PREVIOUS_RELEASE" ]]; then
  ln -s "$PREVIOUS_RELEASE" "$CURRENT_LINK.next"
  mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"
  sudo systemctl restart "$SERVICE_NAME" || true
fi
echo "New release did not pass the HTTP health check; previous release was restored when available." >&2
exit 1
