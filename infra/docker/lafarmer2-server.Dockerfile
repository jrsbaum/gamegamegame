FROM node:22-alpine AS deps

WORKDIR /app/lafarmer2
COPY apps/lafarmer2/package.json apps/lafarmer2/package-lock.json ./
RUN mkdir -p apps/server packages/content
COPY apps/lafarmer2/apps/server/package.json apps/server/package.json
COPY apps/lafarmer2/packages/content/package.json packages/content/package.json
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build

WORKDIR /app/lafarmer2
COPY --from=deps /app/lafarmer2/node_modules ./node_modules
COPY apps/lafarmer2/. .
RUN npm run build --workspace=@lafarmer2/server

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app/lafarmer2
COPY --from=build /app/lafarmer2/package.json ./package.json
COPY --from=build /app/lafarmer2/package-lock.json ./package-lock.json
COPY --from=build /app/lafarmer2/node_modules ./node_modules
COPY --from=build /app/lafarmer2/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/lafarmer2/apps/server/dist ./apps/server/dist
COPY --from=build /app/lafarmer2/packages/content/package.json ./packages/content/package.json
COPY --from=build /app/lafarmer2/packages/content/dist ./packages/content/dist

USER node
EXPOSE 3338
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3338/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
