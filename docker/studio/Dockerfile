# syntax=docker/dockerfile:1.7
# Zellijfield AI studio — Next.js web app, standalone output, runs as non-root.
# Build context: repository root (see docker-compose.yml).

ARG NODE_IMAGE=node:22.23.4-slim

# ── deps: install workspace dependencies from the lockfile ──────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Electron is a devDependency for the desktop build only; never download its binary here.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/studio/package.json packages/studio/
COPY packages/Vibe-Workflow/packages/workflow-builder/package.json packages/Vibe-Workflow/packages/workflow-builder/
COPY packages/Open-Poe-AI/packages/agents/package.json packages/Open-Poe-AI/packages/agents/
COPY packages/Open-AI-Design-Agent/packages/design-agent/package.json packages/Open-AI-Design-Agent/packages/design-agent/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ── builder: build workspace packages, then the Next.js app ─────────────────────
FROM deps AS builder
COPY . .
RUN npm run build:packages && npm run build

# ── runner: only the standalone server ──────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    OUTPUTS_DIR=/outputs \
    WORKFLOWS_DIR=/workflows \
    MODELS_DIR=/models

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Mount points; bind mounts from the host replace these at runtime.
RUN mkdir -p /data /outputs /workflows /models && chown node:node /data /outputs

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.js"]
