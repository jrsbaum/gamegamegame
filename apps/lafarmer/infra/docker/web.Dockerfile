FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN mkdir -p apps/web packages/content-client packages/content
COPY apps/web/package.json apps/web/package.json
COPY packages/content-client/package.json packages/content-client/package.json
COPY packages/content/package.json packages/content/package.json
RUN npm ci

FROM node:22-alpine AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=packages/content && npm run build --workspace=apps/web

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
