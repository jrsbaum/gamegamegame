FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_GAME_SERVICE=all
ENV VITE_GAME_SERVICE=$VITE_GAME_SERVICE

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ENV GAME_SERVICE=all

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=4s --start-period=8s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist-server/server/index.js"]
