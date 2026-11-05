# syntax=docker/dockerfile:1
# ── fd-wanxing services image (add-facade-extraction 3.1) ────────────────────
#
# One image, two entries (build-arg SERVICE): the extracted wanxing facade and
# the fleet observer. Same shape as paas's platform image — multi-stage,
# builder compiles better-sqlite3, runtime carries the product only.
#
#   docker build --build-arg SERVICE=facade  -t wanxing-facade .
#   docker build --build-arg SERVICE=observer -t fleet-observer .

ARG BASE_IMAGE=node:22-bookworm-slim
# China-mirror opt-in (empty default: the GHA runner is US-based — see
# paas repo docs/IMAGE-RELEASE.md Dockerfile rules; Jenkins passes APT_MIRROR
# on the China build host).

FROM ${BASE_IMAGE} AS builder
ARG APT_MIRROR=""
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY services ./services

FROM ${BASE_IMAGE} AS runtime
ARG APT_MIRROR=""
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/services ./services

# The shared data root (wanxing.db / fleet-events.db) — mount a volume here.
ENV WANXING_DATA_ROOT=/data FLEET_DATA_ROOT=/data
RUN mkdir -p /data

ARG SERVICE=facade
ENV FLEET_ENTRY=${SERVICE}
CMD ["sh", "-c", "case \"$FLEET_ENTRY\" in facade) exec node services/wanxing-facade/index.js;; observer) exec node services/fleet-observer/index.js;; *) echo \"unknown SERVICE=$FLEET_ENTRY\"; exit 2;; esac"]
