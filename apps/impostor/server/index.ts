import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from '../shared/protocol';
import { createGameManager } from './game';
import { isOriginAllowed, parseAllowedOrigins } from './origins';

const app = express();
const httpServer = createServer(app);
const allowedOrigins = parseAllowedOrigins(process.env.PUBLIC_ORIGIN);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
});
const gameManager = createGameManager(io, undefined, undefined, 'draw-impostor');

app.disable('x-powered-by');
app.get('/healthz', (request, response) => {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && isOriginAllowed(allowedOrigins, origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.json({ ok: true, service: 'impostor', rooms: gameManager.getRoomCount() });
});

const clientDist = path.resolve(process.cwd(), 'dist');
if (existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/socket.io')) return next();
    return response.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_request, response) => response.json({ service: 'impostor', healthz: '/healthz' }));
}

io.on('connection', (socket) => gameManager.bindSocket(socket));

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
const shutdown = (): void => {
  gameManager.dispose();
  io.close();
  httpServer.close(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
httpServer.listen(port, host, () => console.log(`[impostor] ouvindo em http://${host}:${port}`));
