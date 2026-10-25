# Featherkeeper API
FROM node:22-bookworm-slim

# Set by the release workflow; shown in the footer and /api/health.
ARG VERSION=dev
ENV FEATHERKEEPER_VERSION=$VERSION \
    NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# libheif's command-line tools decode iPhone (HEIC) photos, which sharp's prebuilt binaries can't.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libheif-examples \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src

# Photos live in /data (mount a volume there). Owned by the unprivileged "node" user (uid 1000).
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
