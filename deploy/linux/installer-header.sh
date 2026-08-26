#!/usr/bin/env bash
set -euo pipefail

PLATFORM_ROOT="${REQUIREMENT_PLATFORM_INSTALL_DIR:-/opt/requirement-platform}"
SERVICE_USER="${REQUIREMENT_PLATFORM_SERVICE_USER:-requirement-platform}"
SERVICE_NAME="${REQUIREMENT_PLATFORM_SYSTEMD_SERVICE:-requirement-platform}"
MARKER="__RP_PAYLOAD_BELOW__"

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "This installer supports Linux x86_64 only." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null || ! command -v node >/dev/null; then
  echo "systemd and a system-level Node.js 20+ installation are required." >&2
  exit 1
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$node_major" -lt 20 ]]; then
  echo "Node.js 20+ is required; found $(node --version)." >&2
  exit 1
fi
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo, for example: sudo bash requirement-platform-linux-x64.run" >&2
  exit 1
fi

archive_line="$(awk -v marker="$MARKER" '$0 == marker { print NR + 1; exit }' "$0")"
if [[ -z "$archive_line" ]]; then
  echo "Installer payload is missing or damaged." >&2
  exit 1
fi
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT
tail -n "+$archive_line" "$0" | tar -xzf - -C "$temporary_root"
payload="$temporary_root/payload"
if [[ ! -f "$payload/.next/standalone/server.js" || ! -d "$payload/.next/static" || ! -f "$payload/VERSION" ]]; then
  echo "Installer payload is incomplete." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$PLATFORM_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$PLATFORM_ROOT" "$PLATFORM_ROOT/releases" "$PLATFORM_ROOT/data"

environment_file="$PLATFORM_ROOT/.env.local"
if [[ ! -f "$environment_file" ]]; then
  install -m 600 -o "$SERVICE_USER" -g "$SERVICE_USER" "$payload/server.env.example" "$environment_file"
  echo "Created $environment_file. Fill in the required Feishu and domain values, then run this installer again." >&2
  exit 2
fi

release_id="$(tr -d '\r\n' < "$payload/VERSION")"
if [[ ! "$release_id" =~ ^v[0-9][0-9A-Za-z._-]{0,63}$ ]]; then
  echo "Invalid release version in installer payload." >&2
  exit 1
fi
release_dir="$PLATFORM_ROOT/releases/$release_id"
current_link="$PLATFORM_ROOT/current"
previous_release=""
if [[ -L "$current_link" ]]; then previous_release="$(readlink -f "$current_link")"; fi
if [[ -e "$release_dir" ]]; then rm -rf "$release_dir"; fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$release_dir"
cp -a "$payload/." "$release_dir/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$release_dir"

sed "s|__PLATFORM_ROOT__|$PLATFORM_ROOT|g" "$release_dir/requirement-platform.service.template" > "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
ln -s "$release_dir" "$current_link.next"
mv -Tf "$current_link.next" "$current_link"
if ! systemctl enable --now "$SERVICE_NAME"; then
  if [[ -n "$previous_release" ]]; then
    ln -s "$previous_release" "$current_link.next"
    mv -Tf "$current_link.next" "$current_link"
    systemctl restart "$SERVICE_NAME" || true
  fi
  echo "New release failed to start; the previous release was restored when available." >&2
  exit 1
fi

for _ in {1..10}; do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:3000/ >/dev/null; then
    echo "Requirement Platform $release_id installed successfully."
    exit 0
  fi
  sleep 1
done

if [[ -n "$previous_release" ]]; then
  ln -s "$previous_release" "$current_link.next"
  mv -Tf "$current_link.next" "$current_link"
  systemctl restart "$SERVICE_NAME" || true
fi
echo "New release did not pass the HTTP health check; the previous release was restored when available." >&2
exit 1

exit 0
