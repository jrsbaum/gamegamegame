FROM node:22-alpine AS deps

WORKDIR /app/lafarmer2
COPY apps/lafarmer2/package.json apps/lafarmer2/package-lock.json ./
RUN mkdir -p apps/web packages/content
COPY apps/lafarmer2/apps/web/package.json apps/web/package.json
COPY apps/lafarmer2/packages/content/package.json packages/content/package.json
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build

WORKDIR /app/lafarmer2
COPY --from=deps /app/lafarmer2/node_modules ./node_modules
COPY apps/lafarmer2/. .
RUN npm run build --workspace=@lafarmer2/web

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/lafarmer2/apps/web/dist /usr/share/nginx/html
COPY infra/docker/lafarmer2-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=12 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
