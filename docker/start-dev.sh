#!/bin/sh
# This script runs inside the Linux development image and must remain LF-only.
set -eu

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1440x900x24 &
sleep 1
openbox &
x11vnc -display :99 -localhost -forever -shared -rfbport 5900 &
websockify --web /usr/share/novnc 6080 localhost:5900 &

if [ -n "${RECALL_LCU_LOCKFILE:-}" ] && [ ! -r "$RECALL_LCU_LOCKFILE" ]; then
  echo "Recall is waiting for the League lockfile at $RECALL_LCU_LOCKFILE." >&2
  echo "Start/sign in to League, or set RECALL_LEAGUE_DIR to its installation directory." >&2
fi

pnpm theme:generate
exec pnpm exec vite --host 0.0.0.0 --port 3344
