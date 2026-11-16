# wanxing-web static image (add-wanxing-web): nginx serves the built face and
# reverse-proxies the two API planes — same-origin everywhere, no CORS.
#   docker build -t wanxing-web . (from wanxing-web/)
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
RUN npm run build

FROM nginx:1.27-bookworm
# envsubst 来自 gettext，标准 nginx 镜像不带它（fd-wire/web 2026-11-16 栽过一次）。
RUN apt-get update \
 && apt-get install -y --no-install-recommends gettext-base \
 && rm -rf /var/lib/apt/lists/*
# server 块是模板：启动时只替换 ${WANXING_FACADE_UPSTREAM}，渲染成普通静态配置
# 再交给 nginx——转发语义与手写静态配置完全一致（变量式 proxy_pass 不是同一个东西，
# 它改变 URI 传递方式，2026-11-16 曾因此打挂全站 /api）。
COPY nginx.conf /etc/nginx/conf.d/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html
# nginx 官方镜像的 entrypoint 会自动渲染 /etc/nginx/templates/*.template；
# 这里用显式 CMD 渲染到 conf.d，路径更直白，也便于本地 docker run 复现。
# 默认值是 IP 字面量：没有集群 DNS 的环境（构建池 smoke / 本地）也能启动；
# 生产由 deploy 的 env 指到真实 Service 名。
ENV WANXING_FACADE_UPSTREAM=127.0.0.1:3080
CMD ["/bin/sh", "-c", "set -e; command -v envsubst >/dev/null || { echo 'FATAL: envsubst missing (need gettext-base)' >&2; exit 1; }; envsubst '$WANXING_FACADE_UPSTREAM' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
