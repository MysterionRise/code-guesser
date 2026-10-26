# The game's container image (#170), built from a git checkout: `docker build -t codeguessr .`
#
# Two stages on one pinned base. The build stage installs the game's locked dependencies and builds Next's standalone
# server; the runtime stage keeps only that server, its static files, and the frozen artifact, and runs as `node`.
# The build context is what `.dockerignore` lets in: the game, the artifact parser, and the lockfile, never a journal,
# key, or local state. The runbook is docs/deploy.md.

# Node 24.22.0, as .nvmrc pins it, by the digest of its multi-platform index. Dependabot proposes new digests.
FROM node:24.22.0-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4 AS build

ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    CODEGUESSR_STANDALONE=1

RUN npm install --global --no-audit --no-fund pnpm@9.15.9

WORKDIR /app

# Manifests first, so the dependency layer is reused until the lockfile or a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/game/package.json apps/game/
COPY packages/artifact/package.json packages/artifact/
COPY packages/content/package.json packages/content/
COPY packages/domain/package.json packages/domain/
COPY packages/measurement/package.json packages/measurement/
COPY packages/test-support/package.json packages/test-support/
RUN pnpm install --frozen-lockfile --filter @codeguessr/game

COPY packages/artifact/src packages/artifact/src
COPY apps/game apps/game
RUN pnpm --filter @codeguessr/game build

FROM node:24.22.0-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4 AS runtime

# Only the container binds 0.0.0.0; the `dev` and `start` scripts keep 127.0.0.1. The state store and the event log
# live on the /data volume, which the entrypoint hands to `node`.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CODEGUESSR_STATE_DIR=/data/state \
    EXPERIMENT_EVENTS_DIR=/data/events

WORKDIR /app/apps/game

# The standalone server resolves the artifact and the question layers from its own directory, as `next start` does
# from the game's. The working tree keeps them mode 0600, so they are made readable here. The app stays root's and
# `node` can only read it, but for Next's cache directory: a request for `/_next/image` makes it before the 404.
COPY --from=build /app/apps/game/.next/standalone /app
COPY --from=build /app/apps/game/.next/static /app/apps/game/.next/static
COPY --from=build /app/apps/game/src/demo/generated /app/apps/game/src/demo/generated
COPY ops/deploy/entrypoint.sh /usr/local/bin/codeguessr-entrypoint
RUN chmod a+r /app/apps/game/src/demo/generated/*.json \
 && chmod 0755 /usr/local/bin/codeguessr-entrypoint \
 && mkdir -p /app/apps/game/.next/cache /data \
 && chown node:node /app/apps/game/.next/cache /data

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/codeguessr-entrypoint"]
CMD ["node", "server.js"]
