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

FROM ${BASE_IMAGE} AS builder
# aliyun mirror for the China build host (paas Dockerfile convention).
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY services ./services

FROM ${BASE_IMAGE} AS runtime
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
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
