FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts index.html ./
COPY web ./web
COPY server ./server
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3340 DATA_FILE=/data/village.json
RUN mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY server ./server
USER node
EXPOSE 3340
HEALTHCHECK --interval=10s --timeout=4s --start-period=10s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3340/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
