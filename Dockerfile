# TVBox Web all-in-one image: web UI + Android jar spider runtime + headless-Chromium sniffer, ONE container.
# Multi-arch (linux/arm64, linux/amd64).  Mainland China build:
#   docker build --build-arg REG=docker.1ms.run/library/ --build-arg APT_MIRROR=mirrors.aliyun.com \
#                --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t tvbox-web .
# Smaller image without the browser sniffer:  --build-arg WITH_BROWSER=0
ARG REG=
FROM ${REG}node:22-bookworm-slim AS node
ARG NPM_REGISTRY=
WORKDIR /sniffer
COPY sniffer/package.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm install --omit=dev --no-audit --no-fund && npm cache clean --force

FROM ${REG}ibm-semeru-runtimes:open-17-jre AS jre

FROM ${REG}debian:bookworm-slim
ARG APT_MIRROR=
ARG WITH_BROWSER=1
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s#deb.debian.org#$APT_MIRROR#g" /etc/apt/sources.list.d/debian.sources; fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata tini wget psmisc procps \
      $( [ "$WITH_BROWSER" = 1 ] && echo chromium ) \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man /usr/share/locale \
 && useradd -r -u 1000 -m -s /usr/sbin/nologin app && mkdir -p /data && chown 1000:1000 /data
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# bionic-name stubs so Android NDK .so files from spider jars can dlopen on glibc (see Native.java)
COPY spider-runtime/android-shim /tmp/android-shim
RUN mkdir -p /app/android-libs && for d in /lib/aarch64-linux-gnu /lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib/x86_64-linux-gnu; do \
      [ -e $d/libc.so.6 ] || continue; cd /app/android-libs; ln -sf $d/libc.so.6 libc.so; ln -sf $d/libm.so.6 libm.so; ln -sf $d/libdl.so.2 libdl.so; \
      for l in liblog libandroid libz libstdc++ libc++_shared libjnigraphics libOpenSLES libEGL libGLESv2; do [ -e $l.so ] || ln -sf $d/libdl.so.2 $l.so; done; \
      [ -e $d/libz.so.1 ] && ln -sf $d/libz.so.1 libz.so; break; done \
 && a=$(uname -m); if [ -f /tmp/android-shim/$a/liblog.so ]; then rm -f /app/android-libs/liblog.so; cp /tmp/android-shim/$a/liblog.so /app/android-libs/liblog.so; fi; rm -rf /tmp/android-shim
WORKDIR /app
COPY spider-runtime/lib ./spider/lib
COPY spider-runtime/build/spider-runtime.jar ./spider/spider-runtime.jar
COPY --from=node /sniffer/node_modules ./sniffer/node_modules
COPY sniffer/sniffer.js ./sniffer/
COPY server ./server
COPY public ./public
COPY assets ./assets
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 NODE_ENV=production DATA_DIR=/data PORT=8686 TZ=Asia/Shanghai \
    NODE_TLS_REJECT_UNAUTHORIZED=0 JS_WORKERS=2 SEARCH_CONCURRENCY=5 \
    SPIDER_RUNTIME=http://127.0.0.1:9978 SNIFFER_URL=http://127.0.0.1:9980 \
    ENABLE_SPIDER=1 ENABLE_SNIFFER=1 \
    CHROMIUM_PATH=/usr/bin/chromium IDLE_CLOSE_S=120 MAX_PAGES=2 \
    IDLE_UNLOAD_MIN=10 CALL_TIMEOUT_S=25 \
    JAVA_OPTS="-Xmx224m -Xms16m -Xss320k -Xtune:virtualized -XX:+IdleTuningGcOnIdle -XX:+IdleTuningCompactOnIdle -XX:IdleTuningMinIdleWaitTime=60 -Xshareclasses:name=tvbox,cacheDir=/data/spider/scc,nonfatal -Xscmx40m -Dfile.encoding=UTF-8"
EXPOSE 8686
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD wget -q -O- http://127.0.0.1:8686/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/entrypoint.sh"]
