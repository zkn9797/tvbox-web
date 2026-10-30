#!/bin/sh
# One container, three processes: web (foreground) + spider runtime + sniffer (background, auto-restarted).
mkdir -p /data/spider
[ "$(id -u)" = 0 ] && chown -R 1000:1000 /data 2>/dev/null
if [ "$(id -u)" = 0 ]; then DROP="setpriv --reuid=1000 --regid=1000 --init-groups"; export HOME=/home/app; else DROP=; fi
asapp() { $DROP "$@"; }
keep() { name=$1; shift; while :; do "$@"; echo "[$name] exited ($?), restarting in 3s"; sleep 3; done; }

if [ "$ENABLE_SPIDER" != 0 ]; then
  ( cd /app/spider && keep spider asapp env LD_LIBRARY_PATH=/app/android-libs DATA_DIR=/data/spider PORT=9978 \
      IDLE_UNLOAD_MIN="$IDLE_UNLOAD_MIN" CALL_TIMEOUT_S="$CALL_TIMEOUT_S" RUNTIME_TOKEN="$RUNTIME_TOKEN" \
      /opt/java/openjdk/bin/java $JAVA_OPTS -cp "/app/spider/spider-runtime.jar:/app/spider/lib/*" tvbox.runtime.Main ) &
else export SPIDER_RUNTIME=; fi

if [ "$ENABLE_SNIFFER" != 0 ] && [ -x "$CHROMIUM_PATH" ]; then
  ( cd /app/sniffer && keep sniffer asapp env PORT=9980 CHROMIUM_PATH="$CHROMIUM_PATH" IDLE_CLOSE_S="$IDLE_CLOSE_S" \
      MAX_PAGES="$MAX_PAGES" SNIFFER_TOKEN="$SNIFFER_TOKEN" node --max-old-space-size=48 sniffer.js ) &
else export SNIFFER_URL=; fi

cd /app
exec $DROP node --no-warnings --max-old-space-size=96 --max-semi-space-size=2 server/index.js
