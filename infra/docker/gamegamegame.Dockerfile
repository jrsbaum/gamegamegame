FROM node:22-alpine AS build

WORKDIR /app

ARG GAME_APP
ENV GAME_APP=$GAME_APP

COPY . .
RUN npm ci
RUN npm run build --workspace=apps/${GAME_APP}

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ARG GAME_APP
ENV GAME_APP=$GAME_APP
ENV GAME_SERVICE=$GAME_APP

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/${GAME_APP}/dist ./apps/${GAME_APP}/dist
COPY --from=build /app/apps/${GAME_APP}/dist-server ./apps/${GAME_APP}/dist-server

EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=4s --start-period=8s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "node apps/$GAME_APP/dist-server/server/index.js"]
