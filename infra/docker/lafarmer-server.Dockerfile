FROM node:22-alpine AS deps

WORKDIR /app/lafarmer
COPY lafarmer/package.json lafarmer/package-lock.json ./
RUN mkdir -p apps/server packages/content
COPY lafarmer/apps/server/package.json apps/server/package.json
COPY lafarmer/packages/content/package.json packages/content/package.json
RUN npm ci

FROM node:22-alpine AS build

WORKDIR /app/lafarmer
COPY --from=deps /app/lafarmer/node_modules ./node_modules
COPY lafarmer/. .
RUN npm run build --workspace=apps/server

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/lafarmer/package.json ./package.json
COPY --from=build /app/lafarmer/package-lock.json ./package-lock.json
COPY --from=build /app/lafarmer/node_modules ./node_modules
COPY --from=build /app/lafarmer/apps/server ./apps/server
COPY --from=build /app/lafarmer/packages/content ./packages/content

USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start", "--workspace=apps/server"]
