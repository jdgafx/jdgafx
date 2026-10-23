#!/usr/bin/env bash
# Start a persistent Chromium under a virtual screen with remote debugging on :9223.
# Usage: start-browser.sh [profile-dir]   (default: $CLAUDE_SCRATCH/cloud-browser-profile or /tmp/cloud-browser-profile)
# Scripts attach with: chromium.connectOverCDP('http://127.0.0.1:9223')
set -euo pipefail

PORT="${CDP_PORT:-9223}"
PROFILE="${1:-${CLAUDE_SCRATCH:-/tmp}/cloud-browser-profile}"
CHROME="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1)"

if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "already running on :$PORT"
  exit 0
fi
[ -x "$CHROME" ] || { echo "Chromium not found under /opt/pw-browsers" >&2; exit 1; }
mkdir -p "$PROFILE"

# Cloud containers run as root, where Chromium refuses to start sandboxed (Playwright adds the same flag).
EXTRA=()
[ "$(id -u)" = 0 ] && EXTRA+=(--no-sandbox)

nohup xvfb-run -a -s "-screen 0 1440x900x24" "$CHROME" "${EXTRA[@]}" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --proxy-server="${HTTPS_PROXY:?HTTPS_PROXY not set}" \
  --window-size=1440,900 \
  --no-first-run --no-default-browser-check --disable-dev-shm-usage \
  about:blank >"$PROFILE.log" 2>&1 &

for _ in $(seq 1 30); do
  curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && { echo "running on :$PORT, profile $PROFILE"; exit 0; }
  sleep 1
done
echo "Chromium did not start; see $PROFILE.log" >&2
exit 1
