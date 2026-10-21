# DeployX Tester3 — Production Dockerfile
#
# DeployX contract:
#   1. EXPOSE the port the app listens on (reads PORT from env, default 3000)
#   2. GET /health returns 200
#   3. Run as a non-root user
# Storage additions:
#   4. /data exists and is owned by the app user, so the empty named volume
#      DeployX mounts there (deploy.volumes) starts out writable
#   5. No npm in the final image, so the Trivy scan (deploy.security_scan)
#      only sees what the app actually ships

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app

# The runtime doesn't need the package manager
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && mkdir -p /data && chown node:node /data

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production \
    DATA_DIR=/data
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

USER node
CMD ["node", "server.js"]
