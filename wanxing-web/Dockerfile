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
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
