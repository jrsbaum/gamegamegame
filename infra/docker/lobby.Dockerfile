FROM node:22-alpine AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace=apps/lobby

FROM nginx:1.27-alpine
COPY --from=build /app/apps/lobby/dist /usr/share/nginx/html
COPY infra/docker/lobby-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=4s --start-period=8s --retries=12 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
