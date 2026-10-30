# Optional tier-2 sniffer (headless Chromium). OFF by default - see README.
ARG REG=
FROM ${REG}node:22-alpine
ARG APK_MIRROR=
ARG NPM_REGISTRY=
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s#dl-cdn.alpinelinux.org#$APK_MIRROR#g" /etc/apk/repositories; fi \
 && apk add --no-cache chromium nss freetype harfbuzz ca-certificates \
 && rm -rf /usr/share/fonts/noto* /var/cache/apk/*
WORKDIR /app
COPY package.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY sniffer.js ./
ENV PORT=9980 CHROMIUM_PATH=/usr/bin/chromium IDLE_CLOSE_S=120 MAX_PAGES=2
USER node
EXPOSE 9980
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:9980/health >/dev/null || exit 1
CMD ["node", "--max-old-space-size=48", "sniffer.js"]
