FROM node:22-alpine AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace=apps/caracol

FROM node:22-alpine AS production

WORKDIR /app/apps/caracol
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/caracol/ ./

EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=4s --start-period=8s --retries=12 CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist-server/server/index.js"]
