FROM node:22-alpine AS build

WORKDIR /app

ARG GAME_APP=
ARG VITE_GAME_SERVICE=whoami
ENV GAME_APP=$GAME_APP
ENV VITE_GAME_SERVICE=$VITE_GAME_SERVICE

COPY . .
RUN npm ci
RUN APP="${GAME_APP:-$VITE_GAME_SERVICE}" && npm run build --workspace=apps/${APP}

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ARG GAME_APP=
ARG VITE_GAME_SERVICE=whoami
ENV GAME_APP=$GAME_APP
ENV VITE_GAME_SERVICE=$VITE_GAME_SERVICE
ENV GAME_SERVICE=$GAME_APP

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps

EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=4s --start-period=8s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "APP=\"${GAME_APP:-$VITE_GAME_SERVICE}\"; cd \"/app/apps/$APP\" && exec node dist-server/server/index.js"]
