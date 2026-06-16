#!/bin/bash
# Bring up the X-to-web stack, then a full XFCE session. The XFCE session runs in
# the foreground (as PID-1's child via tini) so the container's lifetime tracks
# the desktop; Xvfb/x11vnc/websockify run alongside it.
set -e

export DISPLAY=:0
SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1440x900x24}"
VNC_PORT="${VNC_PORT:-5900}"
WEB_PORT="${WEB_PORT:-6080}"

# 1. Virtual framebuffer.
Xvfb :0 -screen 0 "$SCREEN_GEOMETRY" -nolisten tcp &
for _ in $(seq 1 50); do
  if xdpyinfo -display :0 >/dev/null 2>&1; then break; fi
  sleep 0.2
done

# 2. Export the display over VNC. -nopw is acceptable only because this is meant
#    to run inside an isolated, no-egress network; add a password before exposing
#    it more broadly.
x11vnc -display :0 -forever -shared -nopw -rfbport "$VNC_PORT" -quiet -bg

# 3. Serve the noVNC web client + websocket.
websockify --web=/usr/share/novnc "$WEB_PORT" "localhost:${VNC_PORT}" &

# 4. The desktop. dbus-launch gives the session its own bus.
exec dbus-launch --exit-with-session startxfce4
