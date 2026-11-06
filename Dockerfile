# syntax=docker/dockerfile:1
# Axiometer Dashboard — long-running Node server (the MQTT bridge needs a persistent process).
#
#   docker build -t axiometer-dashboard .
#   docker run -d -p 3000:3000 --env-file .env -v axiometer-data:/app/data axiometer-dashboard
#
# All configuration (broker, Maps key, password) is read at runtime, so one image works everywhere.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
# Toolchain only as a fallback in case no better-sqlite3 prebuilt binary matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/axiometer.db \
    MIGRATIONS_DIR=/app/drizzle
RUN groupadd --system app && useradd --system --gid app app && mkdir -p /app/data && chown app:app /app/data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
VOLUME ["/app/data"]
EXPOSE 3000
# Healthy = the web server answers. /api/health returns 503 while the broker is down, which is
# reported in the UI; it shouldn't make the orchestrator restart a container that is otherwise fine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(()=>process.exit(0)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
