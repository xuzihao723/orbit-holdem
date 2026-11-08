ARG NODE_IMAGE=node:24.14.1-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY . .
RUN apt-get update && apt-get install -y --no-install-recommends python3 python-is-python3 && rm -rf /var/lib/apt/lists/*
RUN npm ci && npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 WEB_DIST=/app/apps/web/dist DATABASE_PATH=/var/lib/orbit/orbit.sqlite
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build /app/packages/poker-core/package.json ./packages/poker-core/package.json
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /var/lib/orbit /var/backups/orbit && chown node:node /var/lib/orbit /var/backups/orbit
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /app/packages/poker-core/dist ./packages/poker-core/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/assets/LICENSES.md ./LICENSES-assets.md
COPY --from=build /app/scripts/backup-db.mjs /app/scripts/backup-worker.mjs /app/scripts/restore-db.mjs ./scripts/
COPY --from=build /app/scripts/lib/backup-check.mjs ./scripts/lib/backup-check.mjs
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD ["node","-e","fetch('http://127.0.0.1:3001/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node","apps/server/dist/index.js"]
